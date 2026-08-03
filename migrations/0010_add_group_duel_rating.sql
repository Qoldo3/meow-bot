-- Add per-group duel rating (ELO) column to group_members
ALTER TABLE group_members ADD COLUMN duel_rating INTEGER NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS idx_group_members_duel_rating ON group_members(telegram_group_id, duel_rating DESC);
