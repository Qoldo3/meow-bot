-- Auctions last 1 hour: ends_at is set when the auction is created and the
-- sweep finishes it once ends_at passes AND no bid landed in the last 30s.
ALTER TABLE title_auctions ADD COLUMN ends_at INTEGER;

-- Backfill auctions already open at deploy time (1h from their creation).
UPDATE title_auctions
SET ends_at = created_at + 3600
WHERE status = 'open' AND ends_at IS NULL;
