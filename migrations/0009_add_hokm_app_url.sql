-- Store the WebApp base URL on each Hokm game so the board button works even
-- when HOKM_APP_URL is not configured (derived from the request origin at creation).
ALTER TABLE hokm_games ADD COLUMN app_url TEXT;

-- ---------------------------------------------------------------------------
-- Hard guarantee: at most one active (lobby/playing) game per group.
-- If the old pre-guard code ever ran and left duplicate active games, refund
-- their paid players BEFORE deleting the duplicates so no escrow is dropped.
-- ---------------------------------------------------------------------------

-- Refund ledger rows for players of duplicate games.
INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at)
SELECT hp.telegram_user_id, g.group_id, g.per_player, 'HOKM_REFUND', strftime('%s','now')
FROM hokm_game_players hp
JOIN hokm_games g ON g.game_id = hp.game_id
JOIN (
  SELECT game_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at DESC) AS rn
  FROM hokm_games WHERE status IN ('lobby', 'playing')
) d ON d.game_id = hp.game_id
WHERE hp.paid = 1 AND d.rn > 1;

-- Global balance refund.
UPDATE users
SET meow_points = meow_points + COALESCE((
  SELECT SUM(g.per_player)
  FROM hokm_game_players hp
  JOIN hokm_games g ON g.game_id = hp.game_id
  JOIN (
    SELECT game_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at DESC) AS rn
    FROM hokm_games WHERE status IN ('lobby', 'playing')
  ) d ON d.game_id = hp.game_id
  WHERE hp.paid = 1 AND d.rn > 1 AND hp.telegram_user_id = users.telegram_id
), 0);

-- Group balance refund.
UPDATE group_members
SET meow_points = meow_points + COALESCE((
  SELECT SUM(g.per_player)
  FROM hokm_game_players hp
  JOIN hokm_games g ON g.game_id = hp.game_id
  JOIN (
    SELECT game_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at DESC) AS rn
    FROM hokm_games WHERE status IN ('lobby', 'playing')
  ) d ON d.game_id = hp.game_id
  WHERE hp.paid = 1 AND d.rn > 1
    AND hp.telegram_user_id = group_members.telegram_user_id
    AND g.group_id = group_members.telegram_group_id
), 0);

-- Remove duplicate active games (keep the newest per group).
DELETE FROM hokm_games
WHERE game_id IN (
  SELECT game_id FROM (
    SELECT game_id,
           ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at DESC) AS rn
    FROM hokm_games
    WHERE status IN ('lobby', 'playing')
  ) WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hokm_games_one_active_per_group
  ON hokm_games(group_id)
  WHERE status IN ('lobby', 'playing');
