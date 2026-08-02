-- Add global duel rating (ELO) column
ALTER TABLE users ADD COLUMN duel_rating INTEGER NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS idx_users_duel_rating ON users(duel_rating DESC);
