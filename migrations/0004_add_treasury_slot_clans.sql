-- Add treasury, lottery rounds/tickets/payouts, and clan tables

ALTER TABLE telegram_groups ADD COLUMN treasury_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_groups ADD COLUMN lottery_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE telegram_groups ADD COLUMN lottery_tax_percentage INTEGER NOT NULL DEFAULT 75;

-- Treasury transactions (audit/ledger)
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

-- Lottery rounds and tickets
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

-- Clan basics
CREATE TABLE IF NOT EXISTS group_clans (
    clan_id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    treasury_balance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clan_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clan_id INTEGER NOT NULL,
    telegram_user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_group ON group_treasury_transactions(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_group_created ON group_treasury_transactions(telegram_group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_reference ON group_treasury_transactions(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_lottery_rounds_group_status ON lottery_rounds(telegram_group_id, status);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_round_user ON lottery_tickets(lottery_round_id, telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_lottery_payouts_round ON lottery_payouts(lottery_round_id);

CREATE INDEX IF NOT EXISTS idx_clan_members_clan_user ON clan_members(clan_id, telegram_user_id);
