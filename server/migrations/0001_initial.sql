CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE plan_items (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    due_at TEXT,
    position INTEGER NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX plan_items_user_date_position_idx ON plan_items(user_id, date, position);

CREATE TABLE plan_item_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    due_at TEXT,
    position INTEGER NOT NULL,
    completed_at TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL
);

CREATE INDEX plan_item_history_recorded_at_idx ON plan_item_history(recorded_at);
CREATE INDEX plan_item_history_user_recorded_idx ON plan_item_history(user_id, recorded_at);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
