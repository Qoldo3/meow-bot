-- ============================================
-- Consolidated schema (source of truth: migrations/0000..0007 + 0010..0018)
-- ============================================

-- ============================================
-- USERS (global player data)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    last_meow_at INTEGER,
    created_at INTEGER NOT NULL,
    is_banned INTEGER DEFAULT 0,
    duel_rating INTEGER NOT NULL DEFAULT 1000,
    notifications_enabled INTEGER NOT NULL DEFAULT 1
);

-- ============================================
-- TELEGRAM GROUPS
-- ============================================
CREATE TABLE IF NOT EXISTS telegram_groups (
    telegram_group_id INTEGER PRIMARY KEY,
    title TEXT,
    bot_enabled INTEGER NOT NULL DEFAULT 1,
    cooldown_seconds INTEGER NOT NULL DEFAULT 300,
    meow_tax_pool INTEGER NOT NULL DEFAULT 0,
    duel_tax_pool INTEGER NOT NULL DEFAULT 0,
    lottery_ticket_price INTEGER NOT NULL DEFAULT 100,
    lottery_pot INTEGER NOT NULL DEFAULT 0,
    lottery_ticket_sales INTEGER NOT NULL DEFAULT 0,
    treasury_balance INTEGER NOT NULL DEFAULT 0,
    lottery_enabled INTEGER NOT NULL DEFAULT 1,
    lottery_tax_percentage INTEGER NOT NULL DEFAULT 75,
    blackjack_min_bet INTEGER NOT NULL DEFAULT 1000,
    blackjack_break_sec INTEGER NOT NULL DEFAULT 60,
    blackjack_turn_sec INTEGER NOT NULL DEFAULT 45,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1
);

-- ============================================
-- GROUP MEMBERS (per-group stats with name caching)
-- ============================================
CREATE TABLE IF NOT EXISTS group_members (
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT,
    meow_points INTEGER NOT NULL DEFAULT 0,
    total_meows INTEGER NOT NULL DEFAULT 0,
    last_meow_at INTEGER,
    last_dice_at INTEGER,
    lottery_bonus_tickets INTEGER NOT NULL DEFAULT 0,
    lottery_meow_credit INTEGER NOT NULL DEFAULT 0,
    duel_rating INTEGER NOT NULL DEFAULT 1000,
    active_title_id INTEGER,
    active_booster_multiplier INTEGER NOT NULL DEFAULT 0,
    active_booster_until INTEGER NOT NULL DEFAULT 0,
    booster_paused_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

-- ============================================
-- TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    group_id INTEGER,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================
-- BOT SETTINGS (maintenance mode, config, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- ACTIVE DUELS (persisted so duels survive restarts)
-- ============================================
CREATE TABLE IF NOT EXISTS active_duels (
    duel_id TEXT PRIMARY KEY,
    challenger_id INTEGER NOT NULL,
    challenger_name TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    target_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

-- ============================================
-- EVENTS (bonus multiplier periods)
-- ============================================
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    bonus_multiplier INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- ============================================
-- GROUP TREASURY (audit/ledger)
-- ============================================
CREATE TABLE IF NOT EXISTS group_treasury_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER,
    amount INTEGER NOT NULL,
    balance_before INTEGER,
    balance_after INTEGER,
    reference_type TEXT,
    reference_id TEXT,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================
-- LOTTERY
-- ============================================
CREATE TABLE IF NOT EXISTS lottery_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    ticket_price INTEGER NOT NULL,
    tax_percentage INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open, drawn, cancelled
    winning_numbers TEXT,
    started_at INTEGER NOT NULL,
    drawn_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lottery_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lottery_round_id INTEGER NOT NULL,
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    numbers TEXT NOT NULL,
    amount_paid INTEGER NOT NULL,
    purchased_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lottery_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lottery_round_id INTEGER NOT NULL,
    lottery_ticket_id INTEGER,
    telegram_group_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    match_count INTEGER NOT NULL,
    tier_pct INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================
-- POKER (in-group Texas Hold'em)
-- ============================================
CREATE TABLE IF NOT EXISTS poker_games (
    game_id TEXT PRIMARY KEY,
    telegram_group_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby', -- lobby, playing, ended, cancelled
    buy_in INTEGER NOT NULL,
    host_user_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS poker_game_players (
    game_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    buy_in INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, seat)
);

-- ============================================
-- TITLES (per-group titles shown in /top, won via auction)
-- ============================================
CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    owner_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'owned', -- owned | auctioning
    last_price INTEGER,
    emoji TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(telegram_group_id, name)
);

CREATE TABLE IF NOT EXISTS title_auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    title_id INTEGER,
    start_amount INTEGER NOT NULL,
    jump_amount INTEGER NOT NULL,
    current_bid INTEGER,
    current_bidder_id INTEGER,
    current_bidder_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending_seller', -- pending_seller | open | settling | cancelling | ended | cancelled
    board_message_id INTEGER,
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    last_reposted_at INTEGER,
    ends_at INTEGER
);

CREATE TABLE IF NOT EXISTS title_auction_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================
-- BLACKJACK (بلک‌جک — group treasury is the house)
-- ============================================
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

CREATE TABLE IF NOT EXISTS blackjack_player_stats (
    telegram_group_id  INTEGER NOT NULL,
    telegram_user_id   INTEGER NOT NULL,
    first_name         TEXT,
    username           TEXT,
    hands_played       INTEGER NOT NULL DEFAULT 0,
    blackjacks         INTEGER NOT NULL DEFAULT 0,
    net_winnings       INTEGER NOT NULL DEFAULT 0,
    biggest_win        INTEGER NOT NULL DEFAULT 0,
    updated_at         INTEGER NOT NULL,
    PRIMARY KEY (telegram_group_id, telegram_user_id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_points ON users(meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_users_duel_rating ON users(duel_rating DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_points ON group_members(telegram_group_id, meow_points DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_amount ON transactions(telegram_user_id, amount);
CREATE INDEX IF NOT EXISTS idx_active_duels_target ON active_duels(group_id, target_id, status);
CREATE INDEX IF NOT EXISTS idx_active_duels_created ON active_duels(created_at);
CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_group ON group_treasury_transactions(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_group_created ON group_treasury_transactions(telegram_group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_reference ON group_treasury_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_lottery_rounds_group_status ON lottery_rounds(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_round_user ON lottery_tickets(lottery_round_id, telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_lottery_payouts_round ON lottery_payouts(lottery_round_id);
CREATE INDEX IF NOT EXISTS idx_poker_games_group_status ON poker_games(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_poker_game_players_user ON poker_game_players(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_blackjack_games_group_status ON blackjack_games(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_blackjack_game_players_user ON blackjack_game_players(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_net ON blackjack_player_stats(telegram_group_id, net_winnings DESC);
CREATE INDEX IF NOT EXISTS idx_titles_group_owner ON titles(telegram_group_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_title_auctions_group_status ON title_auctions(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_title_auction_bids_auction ON title_auction_bids(auction_id);
