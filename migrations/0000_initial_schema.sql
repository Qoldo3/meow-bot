CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_daily_at INTEGER,
    last_meow_at INTEGER,
    created_at INTEGER NOT NULL,
    is_banned INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS telegram_groups (
    telegram_group_id INTEGER PRIMARY KEY,
    title TEXT,
    bot_enabled INTEGER NOT NULL DEFAULT 1,
    cooldown_seconds INTEGER NOT NULL DEFAULT 300,
    meow_tax_pool INTEGER NOT NULL DEFAULT 0,
    duel_tax_pool INTEGER NOT NULL DEFAULT 0,
    lottery_ticket_price INTEGER NOT NULL DEFAULT 100,
    lottery_pot INTEGER NOT NULL DEFAULT 0,
    lottery_ticket_sales INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS group_members (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    last_meow_at INTEGER,
    last_dice_at INTEGER,
    lottery_bonus_tickets INTEGER NOT NULL DEFAULT 0,
    lottery_meow_credit INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    group_id INTEGER,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_duels (
    duel_id TEXT PRIMARY KEY,
    challenger_id INTEGER NOT NULL,
    challenger_name TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    target_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    bonus_multiplier INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_points ON users(meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_points ON group_members(telegram_group_id, meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_active_duels_target ON active_duels(group_id, target_id, status);
CREATE INDEX IF NOT EXISTS idx_active_duels_created ON active_duels(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user_amount ON transactions(telegram_user_id, amount);
CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active, start_at, end_at);
