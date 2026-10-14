use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: Uuid,
    pub name: String,
    pub columns: Vec<BoardColumn>,
    pub labels: Vec<Label>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub id: Uuid,
    pub board_id: Uuid,
    pub name: String,
    pub position: u32,
    pub cards: Vec<Card>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: Uuid,
    pub column_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub label_ids: Vec<Uuid>,
    pub position: u32,
    pub is_completed: bool,
    pub due_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: Uuid,
    pub board_id: Uuid,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_serialization_uses_frontend_field_names_and_persists_order() {
        let column_id = Uuid::new_v4();
        let card = Card {
            id: Uuid::new_v4(),
            column_id,
            title: "Plan dinner".to_owned(),
            description: None,
            label_ids: Vec::new(),
            position: 3,
            is_completed: false,
            due_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let value = serde_json::to_value(card).expect("card should serialize");

        assert_eq!(value["columnId"], column_id.to_string());
        assert_eq!(value["position"], 3);
        assert!(value.get("createdAt").is_some());
        assert!(value.get("created_at").is_none());
    }
}
