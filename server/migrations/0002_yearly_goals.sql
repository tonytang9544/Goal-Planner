CREATE TABLE yearly_goals (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX yearly_goals_user_year_idx ON yearly_goals(user_id, year, created_at);

CREATE TABLE goal_objectives (
    id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL REFERENCES yearly_goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE (goal_id, position)
);

CREATE INDEX goal_objectives_goal_position_idx ON goal_objectives(goal_id, position);

CREATE TABLE objective_weeks (
    objective_id TEXT NOT NULL REFERENCES goal_objectives(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    PRIMARY KEY (objective_id, week_start)
);

CREATE INDEX objective_weeks_week_idx ON objective_weeks(week_start);
