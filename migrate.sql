-- Add missing columns to users
ALTER TABLE users ADD COLUMN last_meow_at INTEGER;

-- Add missing columns to group_members
ALTER TABLE group_members ADD COLUMN username TEXT;
ALTER TABLE group_members ADD COLUMN first_name TEXT;
ALTER TABLE group_members ADD COLUMN last_meow_at INTEGER;

-- Add missing column to transactions
ALTER TABLE transactions ADD COLUMN group_id INTEGER;