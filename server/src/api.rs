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
use chrono::{DateTime, Datelike, Days, NaiveDate, TimeZone, Utc};
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
        .route("/api/accounts", get(list_accounts))
        .route("/api/account/password", put(change_password))
        .route("/api/accounts/{id}", axum::routing::delete(delete_account))
        .route("/api/goals", get(list_goals).post(create_goal))
        .route("/api/goals/{id}", put(update_goal).delete(delete_goal))
        .route("/api/plans", get(list_plans).post(create_plan))
        .route("/api/plans/{id}", put(update_plan).delete(delete_plan))
        .route("/api/plans/order", put(reorder_plans))
        .route("/api/plans/{id}/completion", patch(set_completion))
        .route("/api/household/today", get(household_today))
        .route("/api/household/competition", get(household_competition))
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChangePasswordInput {
    current_password: String,
    new_password: String,
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

#[derive(Deserialize)]
struct GoalQuery {
    year: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoalInput {
    year: i32,
    title: String,
    objectives: Vec<GoalObjectiveInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoalObjectiveInput {
    title: String,
    week_starts: Vec<NaiveDate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YearlyGoal {
    id: Uuid,
    user_id: Uuid,
    year: i32,
    title: String,
    objectives: Vec<GoalObjective>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalObjective {
    id: Uuid,
    title: String,
    position: u32,
    week_starts: Vec<NaiveDate>,
}

#[derive(Deserialize)]
struct CompetitionQuery {
    period: String,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdCompetition {
    period: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    time_zone: String,
    users: Vec<CompetitionUser>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompetitionUser {
    user: User,
    all_targets_streak: u32,
    at_least_one_streak: u32,
    planned: usize,
    completed: usize,
    completion_percent: u32,
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

async fn list_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<User>>, ApiError> {
    authenticated_user(&state, &headers).await?;
    let rows = sqlx::query(
        "SELECT id, username, display_name, created_at, updated_at FROM users ORDER BY display_name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    let users = rows
        .iter()
        .map(user_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(users))
}

async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ChangePasswordInput>,
) -> Result<StatusCode, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    validate_password(&input.new_password)?;
    let row = sqlx::query("SELECT password_hash FROM users WHERE id = ?")
        .bind(user.id.to_string())
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(ApiError::unauthorized)?;
    let password_hash: String = row.try_get("password_hash").map_err(ApiError::from)?;
    if !verify_password(input.current_password, password_hash).await? {
        return Err(ApiError::bad_request("Current password is incorrect"));
    }

    let token = session_token(&headers).ok_or_else(ApiError::unauthorized)?;
    let token_hash = hash_token(&token);
    let new_password_hash = hash_password(input.new_password).await?;
    let now = timestamp(Utc::now());
    let mut transaction = state.pool.begin().await?;
    sqlx::query("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .bind(new_password_hash)
        .bind(&now)
        .bind(user.id.to_string())
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL",
    )
    .bind(now)
    .bind(user.id.to_string())
    .bind(token_hash)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    if id == user.id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "You cannot remove your own account",
        ));
    }

    let mut transaction = state.pool.begin().await?;
    let result = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id.to_string())
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_goals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GoalQuery>,
) -> Result<Json<Vec<YearlyGoal>>, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    if let Some(year) = query.year {
        validate_goal_year(year)?;
    }
    let rows = sqlx::query(
        "SELECT id, user_id, year, title, created_at, updated_at FROM yearly_goals WHERE user_id = ? AND (? IS NULL OR year = ?) ORDER BY year DESC, created_at, id",
    )
    .bind(user.id.to_string())
    .bind(query.year)
    .bind(query.year)
    .fetch_all(&state.pool)
    .await?;
    let mut goals = Vec::with_capacity(rows.len());
    for row in rows {
        let goal_id: String = row.try_get("id").map_err(ApiError::from)?;
        let objective_rows = sqlx::query(
            "SELECT id, title, position FROM goal_objectives WHERE goal_id = ? ORDER BY position",
        )
        .bind(&goal_id)
        .fetch_all(&state.pool)
        .await?;
        let mut objectives = Vec::with_capacity(objective_rows.len());
        for objective_row in objective_rows {
            let objective_id: String = objective_row.try_get("id").map_err(ApiError::from)?;
            let week_rows = sqlx::query(
                "SELECT week_start FROM objective_weeks WHERE objective_id = ? ORDER BY week_start",
            )
            .bind(&objective_id)
            .fetch_all(&state.pool)
            .await?;
            let week_starts = week_rows
                .iter()
                .map(|week_row| {
                    parse_date(
                        &week_row
                            .try_get::<String, _>("week_start")
                            .map_err(ApiError::from)?,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            let position: i64 = objective_row.try_get("position").map_err(ApiError::from)?;
            objectives.push(GoalObjective {
                id: parse_uuid(objective_id)?,
                title: objective_row.try_get("title").map_err(ApiError::from)?,
                position: position.try_into().map_err(|_| ApiError::internal())?,
                week_starts,
            });
        }
        goals.push(YearlyGoal {
            id: parse_uuid(goal_id)?,
            user_id: parse_uuid(row.try_get("user_id").map_err(ApiError::from)?)?,
            year: row.try_get("year").map_err(ApiError::from)?,
            title: row.try_get("title").map_err(ApiError::from)?,
            objectives,
            created_at: parse_timestamp(row.try_get("created_at").map_err(ApiError::from)?)?,
            updated_at: parse_timestamp(row.try_get("updated_at").map_err(ApiError::from)?)?,
        });
    }
    Ok(Json(goals))
}

async fn create_goal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<GoalInput>,
) -> Result<(StatusCode, Json<YearlyGoal>), ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    validate_goal_input(&input)?;
    let now = Utc::now();
    let id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO yearly_goals (id, user_id, year, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(user.id.to_string())
    .bind(input.year)
    .bind(input.title.trim())
    .bind(timestamp(now))
    .bind(timestamp(now))
    .execute(&mut *transaction)
    .await?;
    let objectives = insert_goal_objectives(&mut transaction, id, &input.objectives).await?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(YearlyGoal {
            id,
            user_id: user.id,
            year: input.year,
            title: input.title.trim().to_owned(),
            objectives,
            created_at: now,
            updated_at: now,
        }),
    ))
}

async fn update_goal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<GoalInput>,
) -> Result<Json<YearlyGoal>, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    validate_goal_input(&input)?;
    let mut transaction = state.pool.begin().await?;
    let row = sqlx::query("SELECT created_at FROM yearly_goals WHERE id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let created_at = parse_timestamp(row.try_get("created_at").map_err(ApiError::from)?)?;
    let now = Utc::now();
    sqlx::query(
        "UPDATE yearly_goals SET year = ?, title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(input.year)
    .bind(input.title.trim())
    .bind(timestamp(now))
    .bind(id.to_string())
    .bind(user.id.to_string())
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM goal_objectives WHERE goal_id = ?")
        .bind(id.to_string())
        .execute(&mut *transaction)
        .await?;
    let objectives = insert_goal_objectives(&mut transaction, id, &input.objectives).await?;
    transaction.commit().await?;
    Ok(Json(YearlyGoal {
        id,
        user_id: user.id,
        year: input.year,
        title: input.title.trim().to_owned(),
        objectives,
        created_at,
        updated_at: now,
    }))
}

async fn delete_goal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let (user, _) = authenticated_user(&state, &headers).await?;
    let result = sqlx::query("DELETE FROM yearly_goals WHERE id = ? AND user_id = ?")
        .bind(id.to_string())
        .bind(user.id.to_string())
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn insert_goal_objectives(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    goal_id: Uuid,
    inputs: &[GoalObjectiveInput],
) -> Result<Vec<GoalObjective>, ApiError> {
    let mut objectives = Vec::with_capacity(inputs.len());
    for (position, input) in inputs.iter().enumerate() {
        let id = Uuid::new_v4();
        let title = input.title.trim().to_owned();
        sqlx::query(
            "INSERT INTO goal_objectives (id, goal_id, title, position) VALUES (?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(goal_id.to_string())
        .bind(&title)
        .bind(i64::try_from(position).map_err(|_| ApiError::internal())?)
        .execute(&mut **transaction)
        .await?;
        for week_start in &input.week_starts {
            sqlx::query("INSERT INTO objective_weeks (objective_id, week_start) VALUES (?, ?)")
                .bind(id.to_string())
                .bind(week_start.to_string())
                .execute(&mut **transaction)
                .await?;
        }
        objectives.push(GoalObjective {
            id,
            title,
            position: u32::try_from(position).map_err(|_| ApiError::internal())?,
            week_starts: input.week_starts.clone(),
        });
    }
    Ok(objectives)
}

fn validate_goal_year(year: i32) -> Result<(), ApiError> {
    if !(1..=9999).contains(&year) {
        return Err(ApiError::bad_request(
            "Goal year must be between 1 and 9999",
        ));
    }
    Ok(())
}

fn validate_goal_input(input: &GoalInput) -> Result<(), ApiError> {
    validate_goal_year(input.year)?;
    if input.title.trim().is_empty() || input.title.trim().chars().count() > 120 {
        return Err(ApiError::bad_request(
            "Goal title must be between 1 and 120 characters",
        ));
    }
    if input.objectives.is_empty() || input.objectives.len() > 20 {
        return Err(ApiError::bad_request(
            "A goal must have between 1 and 20 objectives",
        ));
    }
    let year_start = NaiveDate::from_ymd_opt(input.year, 1, 1).ok_or_else(ApiError::internal)?;
    let year_end = NaiveDate::from_ymd_opt(input.year, 12, 31).ok_or_else(ApiError::internal)?;
    for objective in &input.objectives {
        if objective.title.trim().is_empty() || objective.title.trim().chars().count() > 160 {
            return Err(ApiError::bad_request(
                "Objective title must be between 1 and 160 characters",
            ));
        }
        if objective.week_starts.len() > 54 {
            return Err(ApiError::bad_request(
                "An objective may be assigned to at most 54 weeks",
            ));
        }
        let unique_weeks = objective.week_starts.iter().collect::<HashSet<_>>();
        if unique_weeks.len() != objective.week_starts.len()
            || objective.week_starts.iter().any(|week_start| {
                week_start.weekday().num_days_from_monday() != 0
                    || *week_start > year_end
                    || week_start
                        .checked_add_days(Days::new(6))
                        .is_none_or(|week_end| week_end < year_start)
            })
        {
            return Err(ApiError::bad_request(
                "Objective weeks must be unique Monday-start weeks that overlap the goal year",
            ));
        }
    }
    Ok(())
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

async fn household_today(State(state): State<AppState>) -> Result<Json<HouseholdToday>, ApiError> {
    let now = Utc::now();
    let today = now.with_timezone(&state.household_timezone).date_naive();
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
        let events = user_history(&state.pool, user.id).await?;
        let (all_targets_streak, at_least_one_streak) =
            user_streaks(&events, today, state.household_timezone)?;
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

async fn household_competition(
    State(state): State<AppState>,
    Query(query): Query<CompetitionQuery>,
) -> Result<Json<HouseholdCompetition>, ApiError> {
    let now = Utc::now();
    let today = now.with_timezone(&state.household_timezone).date_naive();
    let (start_date, end_date) = match query.period.as_str() {
        "week" => (
            today - Days::new(u64::from(today.weekday().num_days_from_monday())),
            today + Days::new(u64::from(6 - today.weekday().num_days_from_monday())),
        ),
        "month" => {
            let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .ok_or_else(ApiError::internal)?;
            let next_month = if today.month() == 12 {
                NaiveDate::from_ymd_opt(today.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(today.year(), today.month() + 1, 1)
            }
            .ok_or_else(ApiError::internal)?;
            (start, next_month - Days::new(1))
        }
        _ => {
            return Err(ApiError::bad_request(
                "Competition period must be week or month",
            ));
        }
    };

    let rows = sqlx::query(
        "SELECT id, username, display_name, created_at, updated_at FROM users ORDER BY display_name COLLATE NOCASE",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut users = Vec::with_capacity(rows.len());
    for row in rows {
        let user = user_from_row(&row)?;
        let events = user_history(&state.pool, user.id).await?;
        let (all_targets_streak, at_least_one_streak) =
            user_streaks(&events, today, state.household_timezone)?;
        let (planned, completed) = completion_totals_for_period(
            &events,
            start_date,
            end_date,
            today,
            state.household_timezone,
            now,
        )?;
        let completion_percent = if planned == 0 {
            0
        } else {
            u32::try_from(completed * 100 / planned).map_err(|_| ApiError::internal())?
        };
        users.push(CompetitionUser {
            user,
            all_targets_streak,
            at_least_one_streak,
            planned,
            completed,
            completion_percent,
        });
    }

    Ok(Json(HouseholdCompetition {
        period: query.period,
        start_date,
        end_date,
        time_zone: state.household_timezone.name().to_owned(),
        users,
    }))
}

fn completion_totals_for_period(
    events: &[HistoricalEvent],
    start_date: NaiveDate,
    end_date: NaiveDate,
    today: NaiveDate,
    timezone: Tz,
    now: DateTime<Utc>,
) -> Result<(usize, usize), ApiError> {
    let mut current_by_item: HashMap<&str, &HistoricalSnapshot> = HashMap::new();
    let mut event_index = 0;
    let mut planned = 0;
    let mut completed = 0;
    let mut day = start_date;
    let last_scored_day = end_date.min(today);

    while day <= last_scored_day {
        let day_end = if day < today {
            start_of_local_day(day.succ_opt().ok_or_else(ApiError::internal)?, timezone)?
        } else {
            now
        };
        while event_index < events.len() && events[event_index].recorded_at < day_end {
            let event = &events[event_index];
            current_by_item.insert(&event.item_id, &event.snapshot);
            event_index += 1;
        }
        for snapshot in current_by_item.values() {
            if snapshot.date == day && !snapshot.deleted {
                planned += 1;
                if snapshot.completed {
                    completed += 1;
                }
            }
        }
        day = day.succ_opt().ok_or_else(ApiError::internal)?;
    }

    Ok((planned, completed))
}

async fn user_history(pool: &SqlitePool, user_id: Uuid) -> Result<Vec<HistoricalEvent>, ApiError> {
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
    Ok(events)
}

fn user_streaks(
    events: &[HistoricalEvent],
    today: NaiveDate,
    timezone: Tz,
) -> Result<(u32, u32), ApiError> {
    let cutoff_day = today - Days::new(STREAK_LOOKBACK_DAYS);
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
    if !(4..=128).contains(&password.len()) {
        return Err(ApiError::bad_request(
            "Password must be between 4 and 128 bytes",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        item_id: &str,
        date: &str,
        completed: bool,
        deleted: bool,
        recorded_at: &str,
    ) -> HistoricalEvent {
        HistoricalEvent {
            item_id: item_id.to_owned(),
            snapshot: HistoricalSnapshot {
                date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
                completed,
                deleted,
            },
            recorded_at: recorded_at.parse().unwrap(),
        }
    }

    #[test]
    fn period_completion_freezes_closed_days_and_keeps_today_live() {
        let events = vec![
            event("first", "2026-10-12", false, false, "2026-10-12T10:00:00Z"),
            event("first", "2026-10-12", true, false, "2026-10-13T08:00:00Z"),
            event("second", "2026-10-13", true, false, "2026-10-13T10:00:00Z"),
            event("second", "2026-10-13", false, true, "2026-10-14T00:01:00Z"),
            event("third", "2026-10-14", false, false, "2026-10-14T09:00:00Z"),
            event("third", "2026-10-14", true, false, "2026-10-14T11:00:00Z"),
        ];
        let start = NaiveDate::parse_from_str("2026-10-12", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-10-18", "%Y-%m-%d").unwrap();
        let today = NaiveDate::parse_from_str("2026-10-14", "%Y-%m-%d").unwrap();
        let now = "2026-10-14T12:00:00Z".parse().unwrap();

        let totals =
            completion_totals_for_period(&events, start, end, today, chrono_tz::UTC, now).unwrap();

        assert_eq!(totals, (3, 2));
    }
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
