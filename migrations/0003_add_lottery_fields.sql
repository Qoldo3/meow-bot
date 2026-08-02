ALTER TABLE telegram_groups ADD COLUMN meow_tax_pool INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_groups ADD COLUMN duel_tax_pool INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_groups ADD COLUMN lottery_ticket_price INTEGER NOT NULL DEFAULT 100;
ALTER TABLE telegram_groups ADD COLUMN lottery_pot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_groups ADD COLUMN lottery_ticket_sales INTEGER NOT NULL DEFAULT 0;
