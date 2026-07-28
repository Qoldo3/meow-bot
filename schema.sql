CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    telegram_group_id INTEGER PRIMARY KEY,
    title TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_points
ON users(meow_points DESC);

CREATE INDEX IF NOT EXISTS idx_group_members_points
ON group_members(telegram_group_id, meow_points DESC);