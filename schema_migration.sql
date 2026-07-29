-- ============================================
-- PRODUCTION FIXES — Run this migration before deploying
-- ============================================

-- 1. Persist duels to D1 (CRITICAL: in-memory Map breaks on Workers)
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
CREATE INDEX IF NOT EXISTS idx_active_duels_target ON active_duels(group_id, target_id, status);
CREATE INDEX IF NOT EXISTS idx_active_duels_created ON active_duels(created_at);

-- 2. Add composite index for transaction repair query
CREATE INDEX IF NOT EXISTS idx_transactions_user_amount ON transactions(telegram_user_id, amount);
