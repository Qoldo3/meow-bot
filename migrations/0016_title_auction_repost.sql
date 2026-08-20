-- Re-post the auction board at most every 5 minutes (edits in between keep
-- the chat feed clean while still surfacing the live auction regularly).
ALTER TABLE title_auctions ADD COLUMN last_reposted_at INTEGER;
