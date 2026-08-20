-- In-group Blackjack (بلکجک) games — group treasury is the house bank.
CREATE TABLE IF NOT EXISTS blackjack_games (
    game_id            TEXT PRIMARY KEY,
    telegram_group_id  INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'lobby', -- lobby, playing, ended, cancelled
    buy_in             INTEGER NOT NULL,
    host_user_id       INTEGER NOT NULL,
    message_id         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    ended_at           INTEGER
);

CREATE TABLE IF NOT EXISTS blackjack_game_players (
    game_id            TEXT NOT NULL,
    seat               INTEGER NOT NULL,
    telegram_user_id   INTEGER NOT NULL,
    buy_in             INTEGER NOT NULL,
    joined_at          INTEGER NOT NULL,
    PRIMARY KEY (game_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_blackjack_games_group_status
    ON blackjack_games(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_blackjack_game_players_user
    ON blackjack_game_players(telegram_user_id);
