use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    time::Duration,
};

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use chrono::{DateTime, Days, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

use crate::models::{PlanItem, User};

const SESSION_COOKIE: &str = "home_planner_session";
const SESSION_DURATION: Duration = Duration::from_secs(60 * 60 * 24 * 14);
const PLAN_RANGE_LIMIT_DAYS: i64 = 400;
const STREAK_LOOKBACK_DAYS: u64 = 365;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub household_timezone: Tz,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/register", post(register))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/session", get(session))
        .route("/api/plans", get(list_plans).post(create_plan))
        .route("/api/plans/{id}", put(update_plan).delete(delete_plan))
        .route("/api/plans/order", put(reorder_plans))
        .route("/api/plans/{id}/completion", patch(set_completion))
        .route("/api/household/today", get(household_today))
        .with_state(state)
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: &'static str,
}

impl ApiError {
    fn new(status: StatusCode, message: &'static str) -> Self {
        Self { status, message }
    }

    fn bad_request(message: &'static str) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Sign in to continue")
    }

    fn not_found() -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "The requested resource was not found",
        )
    }

    fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The request could not be completed",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        eprintln!("database request failed: {error}");
        Self::internal()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountInput {
    username: String,
    #[serde(default)]
    display_name: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    user: User,
    expires_at: DateTime<Utc>,
    household_time_zone: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanInput {
    date: NaiveDate,
    title: String,
    notes: Option<String>,
    due_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    position: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletionInput {
    completed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReorderInput {
    date: NaiveDate,
    item_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
struct PlanRange {
    start: String,
    end: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdToday {
    date: NaiveDate,
    time_zone: String,
    users: Vec<HouseholdUserDay>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdUserDay {
    user: User,
    targets: Vec<HouseholdTarget>,
    completed: usize,
    all_targets_streak: u32,
    at_least_one_streak: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdTarget {
    id: Uuid,
    title: String,
    due_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    position: u32,
}

#[derive(Clone)]
struct HistoricalSnapshot {
    date: NaiveDate,
    completed: bool,
    deleted: bool,
}

struct HistoricalEvent {
    item_id: String,
    snapshot: HistoricalSnapshot,
    recorded_at: DateTime<Utc>,
}

async fn register(
    State(state): State<AppState>,
    Json(input): Json<AccountInput>,
) -> Result<Response, ApiError> {
    let username = validate_username(&input.username)?;
    let display_name = validate_display_name(&input.display_name)?;
    validate_password(&input.password)?;
    let password_hash = hash_password(input.password).await?;
    let now = Utc::now();
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let (token, token_hash) = new_session_token();
    let expires_at =
        now + chrono::Duration::from_std(SESSION_DURATION).map_err(|_| ApiError::internal())?;
    let mut transaction = state.pool.begin().await?;

    let insertion = sqlx::query(
        "INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id.to_string())
    .bind(&username)
    .bind(&display_name)
    .bind(password_hash)
    .bind(timestamp(now))
    .bind(timestamp(now))
    .execute(&mut *transaction)
    .await;

    if let Err(error) = insertion {
        if matches!(&error, sqlx::Error::Database(database_error) if database_error.is_unique_violation())
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "That username is already in use",
            ));
        }
        return Err(error.into());
    }

    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(session_id.to_string())
    .bind(user_id.to_string())
    .bind(token_hash)
    .bind(timestamp(expires_at))
    .bind(timestamp(now))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let user = User {
        id: user_id,
        username,
        display_name,
        created_at: now,
        updated_at: now,
    };
    auth_response(user, expires_at, state.household_timezone.name(), token)
}

async fn login(
    State(state): State<AppState>,
    Json(input): Json<AccountInput>,
) -> Result<Response, ApiError> {
    validate_password(&input.password)?;
    let username = input.username.trim().to_lowercase();
    let row = sqlx::query(
        "SELECT id, username, display_name, password_hash, created_at, updated_at FROM users WHERE username = ? COLLATE NOCASE",
    )
    .bind(username)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    let password_hash: String = row.try_get("password_hash").map_err(ApiError::from)?;
    if !verify_password(input.password, password_hash).await? {
        return Err(ApiError::unauthorized());
    }

    let user = user_from_row(&row)?;
    let now = Utc::now();
    let expires_at =
        now + chrono::Duration::from_std(SESSION_DURATION).map_err(|_| ApiError::internal())?;
    let (token, token_hash) = new_session_token();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user.id.to_string())
    .bind(token_hash)
    .bind(timestamp(expires_at))
    .bind(timestamp(now))
    .execute(&state.pool)
    .await?;

    auth_response(user, expires_at, state.household_timezone.name(), token)
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    if let Some(token) = session_token(&headers) {
        let now = timestamp(Utc::now());
        sqlx::query(
            "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .bind(now)
        .bind(hash_token(&token))
        .execute(&state.pool)
        .await?;
    }
    let mut response = (StatusCode::NO_CONTENT, "").into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "home_planner_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        ),
    );
    Ok(response)
}

async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthResponse>, ApiError> {
    let (user, expires_at) = authenticated_user(&state, &headers).await?;
    Ok(Json(AuthResponse {
        user,
        expires_at,
        household_time_zone: state.household_timezone.name().to_owned(),
    }))
}

async fn list_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(range): Query<PlanRange>,
) -> Result<Json<Vec<PlanItem>>, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let start = parse_date(&range.start)?;
    let end = parse_date(&range.end)?;
    if end < start || (end - start).num_days() > PLAN_RANGE_LIMIT_DAYS {
        return Err(ApiError::bad_request("The requested date range is invalid"));
    }
    let rows = sqlx::query(
        "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, position, created_at",
    )
    .bind(user.id.to_string())
    .bind(start.to_string())
    .bind(end.to_string())
    .fetch_all(&state.pool)
    .await?;
    let items = rows
        .iter()
        .map(plan_item_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(items))
}

async fn create_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<PlanInput>,
) -> Result<(StatusCode, Json<PlanItem>), ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let (title, notes) = validate_plan_fields(input.title, input.notes)?;
    let now = Utc::now();
    let id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    let position = match input.position {
        Some(position) => position,
        None => sqlx::query(
            "SELECT COUNT(*) AS item_count FROM plan_items WHERE user_id = ? AND date = ?",
        )
        .bind(user.id.to_string())
        .bind(input.date.to_string())
        .fetch_one(&mut *transaction)
        .await?
        .try_get::<i64, _>("item_count")
        .map_err(ApiError::from)?
        .try_into()
        .map_err(|_| ApiError::internal())?,
    };
    let item = PlanItem {
        id,
        user_id: user.id,
        date: input.date,
        title,
        notes,
        due_at: input.due_at,
        position,
        completed_at: input.completed_at,
        created_at: now,
        updated_at: now,
    };
    insert_plan(&mut transaction, &item).await?;
    record_plan_history(&mut transaction, &item, false, now).await?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PlanInput>,
) -> Result<Json<PlanItem>, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let (title, notes) = validate_plan_fields(input.title, input.notes)?;
    let mut transaction = state.pool.begin().await?;
    let old_row = sqlx::query(
        "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let old_item = plan_item_from_row(&old_row)?;
    let now = Utc::now();
    let position = if let Some(position) = input.position {
        position
    } else if input.date == old_item.date {
        old_item.position
    } else {
        sqlx::query("SELECT COUNT(*) AS item_count FROM plan_items WHERE user_id = ? AND date = ?")
            .bind(user.id.to_string())
            .bind(input.date.to_string())
            .fetch_one(&mut *transaction)
            .await?
            .try_get::<i64, _>("item_count")
            .map_err(ApiError::from)?
            .try_into()
            .map_err(|_| ApiError::internal())?
    };
    let item = PlanItem {
        id,
        user_id: user.id,
        date: input.date,
        title,
        notes,
        due_at: input.due_at,
        position,
        completed_at: input.completed_at,
        created_at: old_item.created_at,
        updated_at: now,
    };
    sqlx::query(
        "UPDATE plan_items SET date = ?, title = ?, notes = ?, due_at = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(item.date.to_string())
    .bind(&item.title)
    .bind(&item.notes)
    .bind(item.due_at.map(timestamp))
    .bind(i64::from(item.position))
    .bind(item.completed_at.map(timestamp))
    .bind(timestamp(now))
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&mut *transaction)
    .await?;
    record_plan_history(&mut transaction, &item, false, now).await?;
    if old_item.date != item.date {
        compact_day(&mut transaction, user.id, old_item.date, now).await?;
    }
    transaction.commit().await?;
    Ok(Json(item))
}

async fn delete_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let mut transaction = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let item = plan_item_from_row(&row)?;
    let now = Utc::now();
    record_plan_history(&mut transaction, &item, true, now).await?;
    sqlx::query("DELETE FROM plan_items WHERE id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .execute(&mut *transaction)
        .await?;
    compact_day(&mut transaction, user.id, item.date, now).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_completion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<CompletionInput>,
) -> Result<Json<PlanItem>, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let mut transaction = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE id = ? AND user_id = ?",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let mut item = plan_item_from_row(&row)?;
    let now = Utc::now();
    item.completed_at = if input.completed { Some(now) } else { None };
    item.updated_at = now;
    sqlx::query(
        "UPDATE plan_items SET completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(item.completed_at.map(timestamp))
    .bind(timestamp(now))
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&mut *transaction)
    .await?;
    record_plan_history(&mut transaction, &item, false, now).await?;
    transaction.commit().await?;
    Ok(Json(item))
}

async fn reorder_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ReorderInput>,
) -> Result<StatusCode, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let mut transaction = state.pool.begin().await?;
    let rows = sqlx::query(
        "SELECT id FROM plan_items WHERE user_id = ? AND date = ? ORDER BY position, created_at",
    )
    .bind(user.id.to_string())
    .bind(input.date.to_string())
    .fetch_all(&mut *transaction)
    .await?;
    let existing = rows
        .iter()
        .map(|row| row.try_get::<String, _>("id").map_err(ApiError::from))
        .collect::<Result<Vec<_>, _>>()?;
    let requested = input
        .item_ids
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>();
    let requested_set = requested.iter().collect::<HashSet<_>>();
    if existing.len() != requested.len()
        || requested_set.len() != requested.len()
        || existing.iter().any(|id| !requested_set.contains(id))
    {
        return Err(ApiError::bad_request(
            "The order must include each plan for that day exactly once",
        ));
    }

    let now = Utc::now();
    for (position, id) in input.item_ids.iter().enumerate() {
        sqlx::query("UPDATE plan_items SET position = ?, updated_at = ? WHERE id = ? AND user_id = ? AND date = ?")
            .bind(i64::try_from(position).map_err(|_| ApiError::internal())?)
            .bind(timestamp(now))
            .bind(id.to_string())
            .bind(user.id.to_string())
            .bind(input.date.to_string())
            .execute(&mut *transaction)
            .await?;
        let row = sqlx::query(
            "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE id = ? AND user_id = ?",
        )
        .bind(id.to_string())
        .bind(user.id.to_string())
        .fetch_one(&mut *transaction)
        .await?;
        let item = plan_item_from_row(&row)?;
        record_plan_history(&mut transaction, &item, false, now).await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn household_today(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<HouseholdToday>, ApiError> {
    authenticated_user(&state, &headers).await?;
    let today = Utc::now()
        .with_timezone(&state.household_timezone)
        .date_naive();
    let rows = sqlx::query(
        "SELECT id, username, display_name, created_at, updated_at FROM users ORDER BY display_name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut users = Vec::with_capacity(rows.len());
    for row in rows {
        let user = user_from_row(&row)?;
        let targets = sqlx::query(
            "SELECT id, title, due_at, completed_at, position FROM plan_items WHERE user_id = ? AND date = ? ORDER BY position, created_at",
        )
        .bind(user.id.to_string())
        .bind(today.to_string())
        .fetch_all(&state.pool)
        .await?
        .iter()
        .map(household_target_from_row)
        .collect::<Result<Vec<_>, _>>()?;
        let completed = targets
            .iter()
            .filter(|target| target.completed_at.is_some())
            .count();
        let (all_targets_streak, at_least_one_streak) =
            user_streaks(&state.pool, user.id, today, state.household_timezone).await?;
        users.push(HouseholdUserDay {
            user,
            targets,
            completed,
            all_targets_streak,
            at_least_one_streak,
        });
    }
    Ok(Json(HouseholdToday {
        date: today,
        time_zone: state.household_timezone.name().to_owned(),
        users,
    }))
}

async fn user_streaks(
    pool: &SqlitePool,
    user_id: Uuid,
    today: NaiveDate,
    timezone: Tz,
) -> Result<(u32, u32), ApiError> {
    let cutoff_day = today - Days::new(STREAK_LOOKBACK_DAYS);
    let rows = sqlx::query(
        "SELECT item_id, date, completed_at, is_deleted, recorded_at FROM plan_item_history WHERE user_id = ? ORDER BY recorded_at, id",
    )
    .bind(user_id.to_string())
    .fetch_all(pool)
    .await?;
    let events = rows
        .iter()
        .map(history_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    let mut current_by_item: HashMap<String, HistoricalSnapshot> = HashMap::new();
    let mut event_index = 0;
    let mut daily_results = HashMap::new();
    let mut day = cutoff_day;

    while day < today {
        let day_end = start_of_local_day(day.succ_opt().ok_or_else(ApiError::internal)?, timezone)?;
        while event_index < events.len() && events[event_index].recorded_at < day_end {
            let event = &events[event_index];
            current_by_item.insert(event.item_id.clone(), event.snapshot.clone());
            event_index += 1;
        }
        let day_items = current_by_item
            .values()
            .filter(|snapshot| snapshot.date == day && !snapshot.deleted);
        let mut total = 0;
        let mut complete = 0;
        for snapshot in day_items {
            total += 1;
            if snapshot.completed {
                complete += 1;
            }
        }
        daily_results.insert(day, (total, complete));
        day = day.succ_opt().ok_or_else(ApiError::internal)?;
    }

    while event_index < events.len() {
        let event = &events[event_index];
        current_by_item.insert(event.item_id.clone(), event.snapshot.clone());
        event_index += 1;
    }
    let today_items = current_by_item
        .values()
        .filter(|snapshot| snapshot.date == today && !snapshot.deleted);
    let mut today_total = 0;
    let mut today_complete = 0;
    for snapshot in today_items {
        today_total += 1;
        if snapshot.completed {
            today_complete += 1;
        }
    }
    let mut all_streak = 0;
    let mut any_streak = 0;
    if today_total > 0 && today_complete == today_total {
        all_streak += 1;
    }
    if today_complete > 0 {
        any_streak += 1;
    }
    let mut day = today.pred_opt().ok_or_else(ApiError::internal)?;
    while day >= cutoff_day {
        let (total, complete) = daily_results.get(&day).copied().unwrap_or_default();
        if total == 0 {
            break;
        }
        if complete == total {
            all_streak += 1;
        } else {
            break;
        }
        day = day.pred_opt().ok_or_else(ApiError::internal)?;
    }

    let mut day = today.pred_opt().ok_or_else(ApiError::internal)?;
    while day >= cutoff_day {
        let (total, complete) = daily_results.get(&day).copied().unwrap_or_default();
        if total == 0 || complete == 0 {
            break;
        }
        any_streak += 1;
        day = day.pred_opt().ok_or_else(ApiError::internal)?;
    }
    Ok((all_streak, any_streak))
}

fn start_of_local_day(date: NaiveDate, timezone: Tz) -> Result<DateTime<Utc>, ApiError> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or_else(ApiError::internal)?;
    timezone
        .from_local_datetime(&midnight)
        .earliest()
        .or_else(|| timezone.from_local_datetime(&midnight).latest())
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(ApiError::internal)
}

async fn insert_plan(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    item: &PlanItem,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO plan_items (id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(item.id.to_string())
    .bind(item.user_id.to_string())
    .bind(item.date.to_string())
    .bind(&item.title)
    .bind(&item.notes)
    .bind(item.due_at.map(timestamp))
    .bind(i64::from(item.position))
    .bind(item.completed_at.map(timestamp))
    .bind(timestamp(item.created_at))
    .bind(timestamp(item.updated_at))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn record_plan_history(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    item: &PlanItem,
    deleted: bool,
    recorded_at: DateTime<Utc>,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO plan_item_history (item_id, user_id, date, title, due_at, position, completed_at, is_deleted, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(item.id.to_string())
    .bind(item.user_id.to_string())
    .bind(item.date.to_string())
    .bind(&item.title)
    .bind(item.due_at.map(timestamp))
    .bind(i64::from(item.position))
    .bind(item.completed_at.map(timestamp))
    .bind(i64::from(deleted))
    .bind(timestamp(recorded_at))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn compact_day(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: Uuid,
    date: NaiveDate,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    let rows = sqlx::query(
        "SELECT id, user_id, date, title, notes, due_at, position, completed_at, created_at, updated_at FROM plan_items WHERE user_id = ? AND date = ? ORDER BY position, created_at",
    )
    .bind(user_id.to_string())
    .bind(date.to_string())
    .fetch_all(&mut **transaction)
    .await?;
    for (position, row) in rows.iter().enumerate() {
        let mut item = plan_item_from_row(row)?;
        let next_position = u32::try_from(position).map_err(|_| ApiError::internal())?;
        if item.position != next_position {
            item.position = next_position;
            item.updated_at = now;
            sqlx::query(
                "UPDATE plan_items SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            )
            .bind(i64::from(next_position))
            .bind(timestamp(now))
            .bind(item.id.to_string())
            .bind(user_id.to_string())
            .execute(&mut **transaction)
            .await?;
            record_plan_history(transaction, &item, false, now).await?;
        }
    }
    Ok(())
}

async fn authenticated_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(User, DateTime<Utc>), ApiError> {
    let token = session_token(headers).ok_or_else(ApiError::unauthorized)?;
    let row = sqlx::query(
        "SELECT users.id, users.username, users.display_name, users.created_at, users.updated_at, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?",
    )
    .bind(hash_token(&token))
    .bind(timestamp(Utc::now()))
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(ApiError::unauthorized)?;
    let user = user_from_row(&row)?;
    let expires_at = parse_timestamp(
        row.try_get::<String, _>("expires_at")
            .map_err(ApiError::from)?,
    )?;
    Ok((user, expires_at))
}

fn user_from_row(row: &SqliteRow) -> Result<User, ApiError> {
    Ok(User {
        id: parse_uuid(row.try_get("id").map_err(ApiError::from)?)?,
        username: row.try_get("username").map_err(ApiError::from)?,
        display_name: row.try_get("display_name").map_err(ApiError::from)?,
        created_at: parse_timestamp(row.try_get("created_at").map_err(ApiError::from)?)?,
        updated_at: parse_timestamp(row.try_get("updated_at").map_err(ApiError::from)?)?,
    })
}

fn plan_item_from_row(row: &SqliteRow) -> Result<PlanItem, ApiError> {
    let position: i64 = row.try_get("position").map_err(ApiError::from)?;
    Ok(PlanItem {
        id: parse_uuid(row.try_get("id").map_err(ApiError::from)?)?,
        user_id: parse_uuid(row.try_get("user_id").map_err(ApiError::from)?)?,
        date: parse_date(&row.try_get::<String, _>("date").map_err(ApiError::from)?)?,
        title: row.try_get("title").map_err(ApiError::from)?,
        notes: row.try_get("notes").map_err(ApiError::from)?,
        due_at: parse_optional_timestamp(row.try_get("due_at").map_err(ApiError::from)?)?,
        position: position.try_into().map_err(|_| ApiError::internal())?,
        completed_at: parse_optional_timestamp(
            row.try_get("completed_at").map_err(ApiError::from)?,
        )?,
        created_at: parse_timestamp(row.try_get("created_at").map_err(ApiError::from)?)?,
        updated_at: parse_timestamp(row.try_get("updated_at").map_err(ApiError::from)?)?,
    })
}

fn household_target_from_row(row: &SqliteRow) -> Result<HouseholdTarget, ApiError> {
    let position: i64 = row.try_get("position").map_err(ApiError::from)?;
    Ok(HouseholdTarget {
        id: parse_uuid(row.try_get("id").map_err(ApiError::from)?)?,
        title: row.try_get("title").map_err(ApiError::from)?,
        due_at: parse_optional_timestamp(row.try_get("due_at").map_err(ApiError::from)?)?,
        completed_at: parse_optional_timestamp(
            row.try_get("completed_at").map_err(ApiError::from)?,
        )?,
        position: position.try_into().map_err(|_| ApiError::internal())?,
    })
}

fn history_from_row(row: &SqliteRow) -> Result<HistoricalEvent, ApiError> {
    let deleted: i64 = row.try_get("is_deleted").map_err(ApiError::from)?;
    let completed_at: Option<String> = row.try_get("completed_at").map_err(ApiError::from)?;
    Ok(HistoricalEvent {
        item_id: row.try_get("item_id").map_err(ApiError::from)?,
        snapshot: HistoricalSnapshot {
            date: parse_date(&row.try_get::<String, _>("date").map_err(ApiError::from)?)?,
            completed: completed_at.is_some(),
            deleted: deleted != 0,
        },
        recorded_at: parse_timestamp(row.try_get("recorded_at").map_err(ApiError::from)?)?,
    })
}

fn validate_username(value: &str) -> Result<String, ApiError> {
    let username = value.trim().to_lowercase();
    if !(3..=32).contains(&username.len())
        || !username.bytes().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, b'_' | b'-')
        })
    {
        return Err(ApiError::bad_request(
            "Username must be 3–32 characters using letters, numbers, _ or -",
        ));
    }
    Ok(username)
}

fn validate_display_name(value: &str) -> Result<String, ApiError> {
    let display_name = value.trim();
    if display_name.is_empty() || display_name.chars().count() > 60 {
        return Err(ApiError::bad_request(
            "Display name must be between 1 and 60 characters",
        ));
    }
    Ok(display_name.to_owned())
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if !(12..=128).contains(&password.len()) {
        return Err(ApiError::bad_request(
            "Password must be between 12 and 128 bytes",
        ));
    }
    Ok(())
}

fn validate_plan_fields(
    title: String,
    notes: Option<String>,
) -> Result<(String, Option<String>), ApiError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(ApiError::bad_request(
            "Plan title must be between 1 and 120 characters",
        ));
    }
    if notes
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1000)
    {
        return Err(ApiError::bad_request(
            "Plan notes must be at most 1000 characters",
        ));
    }
    Ok((
        title.to_owned(),
        notes
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
    ))
}

async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|_| ApiError::internal())
    })
    .await
    .map_err(|error| {
        eprintln!("password hashing task failed: {error}");
        ApiError::internal()
    })?
}

async fn verify_password(password: String, encoded_hash: String) -> Result<bool, ApiError> {
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&encoded_hash).map_err(|_| ApiError::internal())?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|error| {
        eprintln!("password verification task failed: {error}");
        ApiError::internal()
    })?
}

fn auth_response(
    user: User,
    expires_at: DateTime<Utc>,
    household_time_zone: &str,
    token: String,
) -> Result<Response, ApiError> {
    let max_age = SESSION_DURATION.as_secs();
    let cookie =
        format!("{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}");
    let mut response = (
        StatusCode::OK,
        Json(AuthResponse {
            user,
            expires_at,
            household_time_zone: household_time_zone.to_owned(),
        }),
    )
        .into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(|_| ApiError::internal())?,
    );
    Ok(response)
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(name, value)| (name == SESSION_COOKIE).then(|| value.to_owned()))
}

fn new_session_token() -> (String, String) {
    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let hash = hash_token(&token);
    (token, hash)
}

fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_date(value: &str) -> Result<NaiveDate, ApiError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ApiError::bad_request("Date must use YYYY-MM-DD format"))
}

fn parse_uuid(value: String) -> Result<Uuid, ApiError> {
    Uuid::from_str(&value).map_err(|_| ApiError::internal())
}

fn parse_timestamp(value: String) -> Result<DateTime<Utc>, ApiError> {
    DateTime::parse_from_rfc3339(&value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| ApiError::internal())
}

fn parse_optional_timestamp(value: Option<String>) -> Result<Option<DateTime<Utc>>, ApiError> {
    value.map(parse_timestamp).transpose()
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
