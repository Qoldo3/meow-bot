-- Boosters pause while an event is running: the countdown freezes at
-- booster_paused_at and resumes when the event stops. 0 = running.
ALTER TABLE group_members ADD COLUMN booster_paused_at INTEGER NOT NULL DEFAULT 0;