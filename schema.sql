-- ============================================
-- USERS (global player data)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_at INTEGER,
    last_meow_at INTEGER,
    created_at INTEGER NOT NULL
);

-- ============================================
-- TELEGRAM GROUPS
-- ============================================
CREATE TABLE IF NOT EXISTS telegram_groups (
    telegram_group_id INTEGER PRIMARY KEY,
    title TEXT,
    bot_enabled INTEGER NOT NULL DEFAULT 1,
    cooldown_seconds INTEGER NOT NULL DEFAULT 300,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ============================================
-- GROUP MEMBERS (per-group stats with name caching)
-- ============================================
CREATE TABLE IF NOT EXISTS group_members (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    last_meow_at INTEGER,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

-- ============================================
-- TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    group_id INTEGER,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================
-- BOT SETTINGS (maintenance mode, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_points ON users(meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_points ON group_members(telegram_group_id, meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(telegram_user_id);