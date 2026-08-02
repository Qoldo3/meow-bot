-- Hokm (حکم): 2v2 card game tables
CREATE TABLE IF NOT EXISTS hokm_games (
  game_id        TEXT PRIMARY KEY,
  group_id       INTEGER NOT NULL,
  creator_id     INTEGER NOT NULL,
  bet            INTEGER NOT NULL,
  per_player     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'lobby',
  board_msg_id   INTEGER,
  winner_team    INTEGER,
  result         TEXT,
  created_at     INTEGER NOT NULL,
  started_at     INTEGER,
  ended_at       INTEGER
);

CREATE TABLE IF NOT EXISTS hokm_game_players (
  game_id          TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  seat             INTEGER NOT NULL,
  team             INTEGER NOT NULL,
  username         TEXT,
  first_name       TEXT NOT NULL,
  paid             INTEGER NOT NULL DEFAULT 0,
  accepted_at      INTEGER NOT NULL,
  PRIMARY KEY (game_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_hokm_games_group_status ON hokm_games(group_id, status);
CREATE INDEX IF NOT EXISTS idx_hokm_players_game ON hokm_game_players(game_id);
