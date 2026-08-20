export const DUEL_TIMEOUT_SEC = 60;
export const DICE_COOLDOWN_SEC = 5 * 60;
export const BROADCAST_PAGE_SIZE = 100;
/** Broadcasts send at most this many messages per invocation. Free plan caps
 * D1 at 50 queries AND outbound subrequests at 50 per invocation, and each
 * Telegram send is one subrequest — keep the chunk well under both limits. */
export const BROADCAST_CHUNK_SIZE = 40;
/** Pause between broadcast chunks so Telegram rate limits don't kick in. */
export const BROADCAST_CHUNK_SLEEP_MS = 1000;
export const MAX_AMOUNT = 1_000_000_000;

export const POKER_MIN_BUYIN = 10_000;
export const POKER_MAX_BUYIN = 500_000;
export const POKER_BUYIN_PRESETS = [10000, 25000, 50000, 100000, 250000, 500000];
export const POKER_MIN_PLAYERS = 2;
export const POKER_MAX_PLAYERS = 6;
export const POKER_MAX_GAMES_PER_GROUP = 2;
export const POKER_LOBBY_TIMEOUT_SEC = 5 * 60;
export const POKER_TURN_TIMEOUT_SEC = 90;
export const POKER_COUNTDOWN_TICK_MS = 10 * 1000;
export const POKER_BOT_ACTION_DELAY_MS = 1500;
export const POKER_HAND_LIMIT = 200;
export const POKER_ROUND_BREAK_MS = 60 * 1000;
export const POKER_RAISE_STEPS = [1000, 5000, 10000];
export const POKER_BLIND_BASE = 10;
export const POKER_BLIND_STEP_HANDS = 3;

export const BJ_MIN_BUYIN = 10_000;
export const BJ_MAX_BUYIN = 500_000;
export const BJ_BUYIN_PRESETS = [10000, 25000, 50000, 100000, 250000, 500000];
export const BJ_MAX_PLAYERS = 6;
export const BJ_MAX_GAMES_PER_GROUP = 2;
export const BJ_LOBBY_TIMEOUT_SEC = 60;
export const BJ_BET_TIMEOUT_SEC = 45;
export const BJ_TURN_TIMEOUT_SEC = 45;
export const BJ_ROUND_BREAK_MS = 60 * 1000;
export const BJ_COUNTDOWN_TICK_MS = 10 * 1000;
export const BJ_DEALER_REVEAL_MS = 2 * 1000;
export const BJ_MIN_BET = 1_000;
export const BJ_BET_STEPS = [1000, 5000, 10000];
export const BJ_HAND_LIMIT = 200;
/** Natural blackjack pays 3:2 (1.5x winnings on top of the returned bet). */
export const TITLE_MAX_PER_USER = 3;
export const TITLE_MAX_NAME_LEN = 20;
/** How long an existing-title auction waits for the seller to accept in PV. */
export const TITLE_SELLER_TIMEOUT_SEC = 10 * 60;
// How often the live auction board is re-posted (fresh message + delete old)
// instead of being edited in place.
export const TITLE_BOARD_REPOST_SEC = 5 * 60;
// Auctions run for this long from creation, then the sweep finishes them.
export const TITLE_AUCTION_DURATION_SEC = 60 * 60;
// An auction won't finish while a bid landed within this window (anti-snipe).
export const TITLE_AUCTION_SNIPE_GRACE_SEC = 30;
/** Seller share of total entry fees when a title is re-auctioned. */
export const TITLE_SELLER_ENTRY_SHARE = 0.2;
/** Title badge tiers by the price paid at auction — higher bids look fancier. */
export const TITLE_TIER_GOLD = 25_000;
export const TITLE_TIER_CROWN = 100_000;
export const TITLE_TIER_DIAMOND = 500_000;
/** Max length of a custom badge emoji (ZWJ sequences can be long). */
export const TITLE_MAX_EMOJI_LEN = 16;

export const BJ_BLACKJACK_PAYOUT = 2.5;
/** Regular wins pay even money (returned bet + 1x). */
export const BJ_WIN_PAYOUT = 2.0;
/** Worst-case house payout multiplier per initial hand (covers a natural). */
export const BJ_EXPOSURE_MULT = 2.5;

// ---------------------------------------------------------------------------
// Boosters — temporary per-group meow multipliers
// ---------------------------------------------------------------------------
export interface BoosterTier {
  id: string;
  label: string;
  multiplier: number;
  durationSec: number;
  cost: number;
  emoji: string;
}

export const BOOSTER_TIERS: BoosterTier[] = [
  { id: "2x", label: "2× Meow", multiplier: 2, durationSec: 60 * 60, cost: 4_000, emoji: "🟢" },
  { id: "4x", label: "4× Meow", multiplier: 4, durationSec: 60 * 60, cost: 8_000, emoji: "🟡" },
  { id: "8x", label: "8× Meow", multiplier: 8, durationSec: 60 * 60, cost: 20_000, emoji: "🔴" },
  { id: "12x", label: "12× Meow", multiplier: 12, durationSec: 60 * 60, cost: 32_000, emoji: "💎" },
];

/** Minimum time between booster purchases (per user, per group). */
export const BOOSTER_COOLDOWN_SEC = 4 * 60 * 60;

export function findBoosterTier(id: string): BoosterTier | undefined {
  return BOOSTER_TIERS.find((t) => t.id === id);
}
