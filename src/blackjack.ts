import { BJ_BLACKJACK_PAYOUT, BJ_EXPOSURE_MULT, BJ_WIN_PAYOUT } from "./constants";
import { cardsToString } from "./poker";
import type { Card } from "./poker";
import type { BlackjackHand, BlackjackHandResult, BlackjackSeat } from "./types";

export type HandValue = { total: number; soft: boolean };

/**
 * Standard blackjack hand value. Aces count 11 unless that busts the hand,
 * in which case they drop to 1 one at a time. `soft` is true while any ace
 * is still being counted as 11.
 */
export function handValue(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 14) {
      total += 11;
      aces++;
    } else {
      total += Math.min(10, c.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/** Natural blackjack: exactly two cards totalling 21. */
export function isNatural(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Dealer stands on soft 17 (S17): hits only while below 17. */
export function dealerMustHit(total: number): boolean {
  return total < 17;
}

export function canSplit(hand: BlackjackHand, seat: BlackjackSeat): boolean {
  if (hand.cards.length !== 2) return false;
  if (hand.cards[0].rank !== hand.cards[1].rank) return false;
  if (hand.doubled) return false;
  // Aces split once and never re-split.
  if (hand.fromSplit && hand.cards[0].rank === 14) return false;
  if (seat.hands.length >= 4) return false;
  if (seat.chips < hand.bet) return false;
  return true;
}

export function canDouble(hand: BlackjackHand, seat: BlackjackSeat): boolean {
  if (hand.cards.length !== 2) return false;
  if (hand.doubled) return false;
  // Split aces get one card each and cannot be doubled.
  if (hand.fromSplit && hand.cards[0].rank === 14) return false;
  if (seat.chips < hand.bet) return false;
  return true;
}

/**
 * Resolve one player hand against the final dealer hand. `dealerBust` and
 * `dealerNatural` describe the dealer's final state; a player bust was
 * already recorded on the hand itself.
 *
 * House rule: ties SPLIT — the player gets half their bet back and the
 * house keeps the other half (both for equal totals and natural-vs-natural).
 */
export function resolveHandResult(
  hand: BlackjackHand,
  dealerTotal: number,
  dealerBust: boolean,
  dealerNatural: boolean
): BlackjackHandResult {
  if (hand.result === "bust") return "loss";
  if (dealerNatural) return hand.result === "natural" ? "push" : "loss";
  if (hand.result === "natural") return "win";
  if (dealerBust) return "win";
  const playerTotal = handValue(hand.cards).total;
  if (playerTotal > dealerTotal) return "win";
  if (playerTotal < dealerTotal) return "loss";
  return "push";
}

/**
 * Chips returned to the player for a settled hand (the bet was already
 * deducted from their stack when the bet was placed). Natural = 2.5x bet,
 * win = 2x, push = half the bet back, loss = 0.
 */
export function payoutFor(result: BlackjackHandResult, bet: number): number {
  const mult =
    result === "natural"
      ? BJ_BLACKJACK_PAYOUT
      : result === "win"
        ? BJ_WIN_PAYOUT
        : result === "push"
          ? 0.5
          : 0;
  return Math.floor(bet * mult);
}

/** Worst-case house payout for a single hand (natural-eligible = 2.5x). */
export function handExposure(hand: BlackjackHand): number {
  const mult = hand.result === "natural" ? BJ_BLACKJACK_PAYOUT : BJ_WIN_PAYOUT;
  return Math.floor(hand.bet * mult);
}

/** Worst-case house payout for a bet not yet dealt (covers a potential natural). */
export function betExposure(bet: number): number {
  return Math.floor(bet * BJ_EXPOSURE_MULT);
}

/** Compact face-up hand render used in the table message. */
export function renderHand(hand: BlackjackHand): string {
  const value = handValue(hand.cards);
  const cards = cardsToString(hand.cards);
  const label =
    hand.result === "natural"
      ? "Blackjack!"
      : hand.result === "bust"
        ? "Bust"
        : hand.result === "win" || hand.result === "loss" || hand.result === "push"
          ? hand.result.toUpperCase()
          : String(value.total);
  const doubled = hand.doubled ? " (2x)" : "";
  return `🂠 ${cards} = <b>${label}${doubled}</b>`;
}

/**
 * Find the next hand that still needs a decision, scanning in play order:
 * later hands of the same seat first, then subsequent seats (wrapping).
 * `fromSeat`/`fromHand` identify the hand that was just played.
 */
export function nextPlayableHand(
  seats: Array<{
    index: number;
    left: boolean;
    busted: boolean;
    hands: BlackjackHand[];
  }>,
  fromSeat: number,
  fromHand: number
): { seatIndex: number; handIndex: number } | null {
  const n = seats.length;
  for (let i = 0; i < n; i++) {
    const seat = seats[(fromSeat + i) % n];
    if (seat.left || seat.busted || !seat.hands.length) continue;
    const startHand = i === 0 ? Math.max(0, fromHand + 1) : 0;
    for (let h = startHand; h < seat.hands.length; h++) {
      if (seat.hands[h].result === "pending") return { seatIndex: seat.index, handIndex: h };
    }
  }
  return null;
}
