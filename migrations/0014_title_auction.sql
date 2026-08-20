-- Title auction (per-group titles shown in /top)
ALTER TABLE group_members ADD COLUMN active_title_id INTEGER;

-- Titles are unique per group. owner_user_id is NULL while a brand-new title
-- is being auctioned for the first time.
CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    owner_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'owned', -- owned | auctioning
    last_price INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(telegram_group_id, name)
);

-- One active auction per group. A re-auction of an owned title starts in
-- 'pending_seller' until the current owner accepts the prompt in PV.
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
    ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS title_auction_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_titles_group_owner ON titles(telegram_group_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_title_auctions_group_status ON title_auctions(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_title_auction_bids_auction ON title_auction_bids(auction_id);
