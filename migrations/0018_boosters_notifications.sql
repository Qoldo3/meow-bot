-- Boosters: per-group temporary meow multipliers
ALTER TABLE group_members ADD COLUMN active_booster_multiplier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE group_members ADD COLUMN active_booster_until INTEGER NOT NULL DEFAULT 0;

-- Notifications: opt-out DM notifications for lottery wins, etc.
ALTER TABLE users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
