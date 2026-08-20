-- Backfill ends_at for pending_seller auctions created before 0017 ran:
-- 0017 only covered status = 'open', so auctions still awaiting the seller
-- had ends_at left NULL and would never auto-finish once accepted.
-- (handleSellerAction also sets ends_at on accept as a code-level fallback.)
UPDATE title_auctions
SET ends_at = created_at + 3600
WHERE status = 'pending_seller' AND ends_at IS NULL;