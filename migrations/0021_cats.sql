-- ============================================
-- CATS (per-group virtual cat adoption)
-- ============================================
CREATE TABLE IF NOT EXISTS cats (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    name TEXT,
    level INTEGER NOT NULL DEFAULT 1,
    progress INTEGER NOT NULL DEFAULT 0,
    last_fed_at INTEGER NOT NULL DEFAULT 0,
    last_warned_day INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cats_level ON cats(telegram_group_id, level DESC, progress DESC);