use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct UserCredential {
    pub user_id: Uuid,
    password_hash: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl UserCredential {
    pub fn new(
        user_id: Uuid,
        password_hash: String,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
    ) -> Self {
        Self {
            user_id,
            password_hash,
            created_at,
            updated_at,
        }
    }

    pub fn password_hash(&self) -> &str {
        &self.password_hash
    }
}

#[derive(Clone)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl UserSession {
    pub fn new(
        id: Uuid,
        user_id: Uuid,
        token_hash: String,
        expires_at: DateTime<Utc>,
        created_at: DateTime<Utc>,
    ) -> Self {
        Self {
            id,
            user_id,
            token_hash,
            expires_at,
            revoked_at: None,
            created_at,
        }
    }

    pub fn token_hash(&self) -> &str {
        &self.token_hash
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

impl From<&UserSession> for SessionInfo {
    fn from(session: &UserSession) -> Self {
        Self {
            id: session.id,
            user_id: session.user_id,
            expires_at: session.expires_at,
            created_at: session.created_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub title: String,
    pub notes: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub position: u32,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEvent {
    pub id: Uuid,
    pub plan_item_id: Uuid,
    pub changed_by_user_id: Uuid,
    pub is_completed: bool,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthView {
    pub user_id: Uuid,
    pub year: i32,
    pub month: u32,
    pub weeks: Vec<WeekView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekView {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub days: Vec<DayView>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub date: NaiveDate,
    pub items: Vec<PlanItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_item_serialization_matches_frontend_contract() {
        let user_id = Uuid::new_v4();
        let plan_item = PlanItem {
            id: Uuid::new_v4(),
            user_id,
            date: NaiveDate::from_ymd_opt(2026, 10, 14).expect("valid date"),
            title: "Water the plants".to_owned(),
            notes: None,
            due_at: None,
            position: 2,
            completed_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let value = serde_json::to_value(plan_item).expect("plan item should serialize");

        assert_eq!(value["userId"], user_id.to_string());
        assert_eq!(value["date"], "2026-10-14");
        assert_eq!(value["position"], 2);
        assert!(value.get("completedAt").is_some());
        assert!(value.get("user_id").is_none());
    }

    #[test]
    fn session_response_does_not_expose_token_hash() {
        let session = UserSession::new(
            Uuid::new_v4(),
            Uuid::new_v4(),
            "stored-token-hash".to_owned(),
            Utc::now(),
            Utc::now(),
        );

        assert_eq!(session.token_hash(), "stored-token-hash");
        let value = serde_json::to_value(SessionInfo::from(&session))
            .expect("session info should serialize");

        assert!(value.get("tokenHash").is_none());
        assert!(value.get("token_hash").is_none());
    }
}
