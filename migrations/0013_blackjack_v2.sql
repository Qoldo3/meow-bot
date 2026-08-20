-- Blackjack v2: per-group settings + per-player stats + insurance support.
-- Per-group table tuning (admins via /blackjack settings).
ALTER TABLE telegram_groups ADD COLUMN blackjack_min_bet INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE telegram_groups ADD COLUMN blackjack_break_sec INTEGER NOT NULL DEFAULT 60;
ALTER TABLE telegram_groups ADD COLUMN blackjack_turn_sec INTEGER NOT NULL DEFAULT 45;

-- Per-player lifetime stats per group (leaderboard).
CREATE TABLE IF NOT EXISTS blackjack_player_stats (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    first_name TEXT,
    username TEXT,
    hands_played INTEGER NOT NULL DEFAULT 0,
    blackjacks INTEGER NOT NULL DEFAULT 0,
    net_winnings INTEGER NOT NULL DEFAULT 0,
    biggest_win INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blackjack_stats_net
    ON blackjack_player_stats(telegram_group_id, net_winnings DESC);
