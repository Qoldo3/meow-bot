-- ============================================
-- CATS: remove decay (no more starvation)
-- ============================================
ALTER TABLE cats DROP COLUMN last_fed_at;
ALTER TABLE cats DROP COLUMN last_warned_day;
