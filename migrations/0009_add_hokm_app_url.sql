-- Store the WebApp base URL on each Hokm game so the board button works even
-- when HOKM_APP_URL is not configured (derived from the request origin at creation).
ALTER TABLE hokm_games ADD COLUMN app_url TEXT;

-- Hard guarantee: at most one active (lobby/playing) game per group.
-- Clean up any pre-existing duplicates first (keep the newest per group).
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
