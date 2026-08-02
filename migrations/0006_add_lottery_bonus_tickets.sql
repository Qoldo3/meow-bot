-- Add lottery bonus ticket tracking for every 6 meows
ALTER TABLE group_members ADD COLUMN lottery_bonus_tickets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE group_members ADD COLUMN lottery_meow_credit INTEGER NOT NULL DEFAULT 0;
