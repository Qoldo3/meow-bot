import { POKER_BLIND_BASE, POKER_BLIND_STEP_HANDS } from "./constants";

export type Card = { rank: number; suit: number };

export const SUIT_SYMBOLS: Record<number, string> = {
  0: "♠",
  1: "♥",
  2: "♦",
  3: "♣",
};

export const RANK_LABELS: Record<number, string> = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "10",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (let rank = 2; rank <= 14; rank++) {
    for (let suit = 0; suit < 4; suit++) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle<T>(input: readonly T[]): T[] {
  const arr = input.slice();
  // Fisher-Yates with a CSPRNG (Web Crypto) rather than Math.random, which
  // Cloudflare documents as not cryptographically secure. This matters for
  // card games that wager real points: the order must be unpredictable and
  // unbiased. Rejection sampling keeps the index uniform with no modulo bias.
  const buf = new Uint32Array(1);
  for (let i = arr.length - 1; i > 0; i--) {
    const limit = i + 1;
    const max = Math.floor(0xffffffff / limit) * limit;
    let r: number;
    do {
      crypto.getRandomValues(buf);
      r = buf[0];
    } while (r >= max);
    const j = r % limit;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Uniform integer in [0, limit) via CSPRNG rejection sampling (no modulo bias). */
export function cryptoRandomInt(limit: number): number {
  const buf = new Uint32Array(1);
  const max = Math.floor(0xffffffff / limit) * limit;
  let r: number;
  do {
    crypto.getRandomValues(buf);
    r = buf[0];
  } while (r >= max);
  return r % limit;
}

export function cardToString(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

export function cardsToString(cards: Card[]): string {
  return cards.map(cardToString).join(" ");
}

/** Persian digit conversion for chips / counts shown in the group. */
export function toFaDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

// ---------------------------------------------------------------------------
// Hand evaluation. A hand scores as a single number; higher is better. The
// score packs the category (highest digit) then the tie-breaking ranks, each
// as a base-15 digit (ranks run 2..14).
// ---------------------------------------------------------------------------

export const HAND_NAMES: Record<number, string> = {
  8: "Royal/Straight Flush",
  7: "Four of a Kind",
  6: "Full House",
  5: "Flush",
  4: "Straight",
  3: "Three of a Kind",
  2: "Two Pair",
  1: "One Pair",
  0: "High Card",
};

const BASE = 15;

function straightHigh(ranks: number[]): number | null {
  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  if (uniq.length < 5) return null;
  // A-2-3-4-5 wheel: treat ace as low.
  const wheel = uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[uniq.length - 1] === 14;
  if (wheel) return 5;
  for (let i = uniq.length - 1; i >= 4; i--) {
    if (uniq[i] - uniq[i - 4] === 4) return uniq[i];
  }
  return null;
}

function evaluate5(cards: Card[]): number {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const high = ranks[0];

  const straight = straightHigh(ranks);
  if (flush && straight != null) return 8 * BASE ** 5 + straight * BASE ** 4;

  const [g0, g1] = grouped;
  if (g0[1] === 4) return 7 * BASE ** 5 + g0[0] * BASE ** 4 + g1[0] * BASE ** 3;
  if (g0[1] === 3 && g1[1] === 2) return 6 * BASE ** 5 + g0[0] * BASE ** 4 + g1[0] * BASE ** 3;
  if (flush) return flushScore(ranks, 5);
  if (straight != null) return 4 * BASE ** 5 + straight * BASE ** 4;

  if (g0[1] === 3) {
    const kickers = grouped.slice(1).map((g) => g[0]);
    return 3 * BASE ** 5 + g0[0] * BASE ** 4 + kickers[0] * BASE ** 3 + kickers[1] * BASE ** 2;
  }
  if (g0[1] === 2 && g1[1] === 2) {
    const pairHigh = Math.max(g0[0], g1[0]);
    const pairLow = Math.min(g0[0], g1[0]);
    const kicker = grouped.find((g) => g[1] === 1)![0];
    return 2 * BASE ** 5 + pairHigh * BASE ** 4 + pairLow * BASE ** 3 + kicker * BASE ** 2;
  }
  if (g0[1] === 2) {
    const kickers = grouped.filter((g) => g[1] === 1).map((g) => g[0]);
    return 1 * BASE ** 5 + g0[0] * BASE ** 4 + kickers[0] * BASE ** 3 + kickers[1] * BASE ** 2 + kickers[2] * BASE;
  }
  return flushScore(ranks, 0);
}

function flushScore(ranks: number[], category: number): number {
  return category * BASE ** 5 + ranks[0] * BASE ** 4 + ranks[1] * BASE ** 3 + ranks[2] * BASE ** 2 + ranks[3] * BASE + ranks[4];
}

/** Best 5-card score from any 5 of the given cards (5 or 7 card inputs). */
export function evaluateBest(cards: Card[]): number {
  if (cards.length === 5) return evaluate5(cards);
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            const score = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (score > best) best = score;
          }
        }
      }
    }
  }
  return best;
}

export function handCategory(score: number): number {
  return Math.floor(score / BASE ** 5);
}

export function handName(score: number): string {
  return HAND_NAMES[handCategory(score)] ?? "High Card";
}

// ---------------------------------------------------------------------------
// Blinds (mini-SNG): start at ~1% of the buy-in, escalate every N hands, and
// cap at 20% of the buy-in so stacks are never swallowed by a single blind.
// ---------------------------------------------------------------------------

export function blindsFor(handNumber: number, buyIn: number): { small: number; big: number } {
  const base = Math.max(POKER_BLIND_BASE, Math.round(buyIn / 100));
  const level = Math.floor((handNumber - 1) / POKER_BLIND_STEP_HANDS);
  const cap = Math.max(base, Math.floor(buyIn / 5));
  const big = Math.min(cap, base * 2 ** level);
  return { small: Math.max(1, Math.floor(big / 2)), big };
}

// ---------------------------------------------------------------------------
// Side pots / showdown settlement (pure, testable).
// ---------------------------------------------------------------------------

export type PotPlayer = {
  index: number;
  totalBetThisHand: number;
  folded: boolean;
  holeCards: Card[];
};

export type PotResult = {
  potId: number;
  amount: number;
  winners: number[]; // seat indexes
  winnerCards: Card[][];
  score: number;
};

/**
 * Compute side pots from each player's cumulative contribution and resolve
 * winners per pot using the community board. Folded players contribute but
 * never win. Ties split the pot (remainder goes to the earliest seat).
 */
export function resolvePots(board: Card[], players: PotPlayer[]): PotResult[] {
  const levels = [...new Set(players.map((p) => p.totalBetThisHand))].sort((a, b) => a - b);
  const results: PotResult[] = [];
  let prev = 0;
  let lastWinnerLevel: PotResult | null = null;

  for (const level of levels) {
    const contributors = players.filter((p) => p.totalBetThisHand >= level);
    const amount = (level - prev) * contributors.length;
    prev = level;
    if (amount <= 0) continue;

    const eligible = contributors.filter((p) => !p.folded);

    // Dead money: everyone who reached this level folded, so nobody can win it.
    // Per poker rules it rolls into the nearest lower pot with eligible winners.
    if (eligible.length === 0) {
      if (lastWinnerLevel) lastWinnerLevel.amount += amount;
      continue;
    }

    let winners: number[] = [];
    let winnerCards: Card[][] = [];
    let score = -1;

    if (eligible.length === 1) {
      const sole = eligible[0];
      winners = [sole.index];
      winnerCards = [sole.holeCards];
      score = evaluateBest([...board, ...sole.holeCards]);
    } else if (eligible.length > 1) {
      let best = -1;
      for (const p of eligible) {
        const s = evaluateBest([...board, ...p.holeCards]);
        if (s > best) best = s;
      }
      score = best;
      for (const p of eligible) {
        const s = evaluateBest([...board, ...p.holeCards]);
        if (s === best) {
          winners.push(p.index);
          winnerCards.push(p.holeCards);
        }
      }
    }

    const result: PotResult = { potId: results.length, amount, winners, winnerCards, score };
    results.push(result);
    lastWinnerLevel = result;
  }

  return results;
}

/** Split an amount evenly among winners; give the remainder to the first. */
export function splitAmount(amount: number, winners: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (!winners.length) return map;
  const base = Math.floor(amount / winners.length);
  const rem = amount - base * winners.length;
  winners.forEach((seat, i) => map.set(seat, base + (i === 0 ? rem : 0)));
  return map;
}
