export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export type Card = string;

export const SUIT_SYMBOL: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

const RANK_VALUES: Record<string, number> = {
  A: 12,
  K: 11,
  Q: 10,
  J: 9,
  "10": 8,
  "9": 7,
  "8": 6,
  "7": 5,
  "6": 4,
  "5": 3,
  "4": 2,
  "3": 1,
  "2": 0,
};

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

export function shuffle(deck: Card[], rng: () => number = Math.random): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function suitOf(card: Card): Suit {
  return card.slice(-1) as Suit;
}

export function rankOf(card: Card): string {
  return card.slice(0, -1);
}

export function rankValue(card: Card): number {
  return RANK_VALUES[rankOf(card)] ?? 0;
}

export function isAce(card: Card): boolean {
  return rankOf(card) === "A";
}

export function sortCards(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => rankValue(b) - rankValue(a));
}

export function hasSuit(hand: Card[], suit: Suit): boolean {
  return hand.some((c) => suitOf(c) === suit);
}

export function legalPlays(hand: Card[], ledSuit: Suit | null): Card[] {
  if (ledSuit == null) return [...hand];
  if (hasSuit(hand, ledSuit)) return hand.filter((c) => suitOf(c) === ledSuit);
  return [...hand];
}

export function isLegal(hand: Card[], card: Card, ledSuit: Suit | null): boolean {
  if (!hand.includes(card)) return false;
  if (ledSuit == null) return true;
  if (suitOf(card) === ledSuit) return true;
  return !hasSuit(hand, ledSuit);
}

export function lowestLegalCard(hand: Card[], ledSuit: Suit | null): Card | null {
  const plays = legalPlays(hand, ledSuit);
  if (plays.length === 0) return hand[0] ?? null;
  return plays.reduce((low, c) => (rankValue(c) < rankValue(low) ? c : low));
}

export function highestCard(hand: Card[]): Card {
  return [...hand].sort((a, b) => rankValue(b) - rankValue(a))[0];
}

export function resolveTrick(plays: Array<{ seat: number; card: string }>, trumpSuit: Suit): number {
  if (plays.length === 0) return -1;
  const ledSuit = suitOf(plays[0].card);
  let winner = plays[0];
  for (const play of plays.slice(1)) {
    const s = suitOf(play.card);
    const ws = suitOf(winner.card);
    let beats = false;
    if (s === trumpSuit) {
      beats = ws !== trumpSuit || rankValue(play.card) > rankValue(winner.card);
    } else if (s === ledSuit) {
      beats = ws !== trumpSuit && rankValue(play.card) > rankValue(winner.card);
    }
    if (beats) winner = play;
  }
  return winner.seat;
}

export function firstAceSeat(order: Card[]): { seat: number; index: number } {
  for (let i = 0; i < order.length; i++) {
    if (isAce(order[i])) return { seat: i % 4, index: i };
  }
  return { seat: 0, index: 0 };
}

export function dealHands(
  hakemSeat: number,
  rng: () => number = Math.random
): { hands: Card[][]; firstFive: Card[] } {
  const d = shuffle(newDeck(), rng);
  const firstFive = d.slice(0, 5);
  const hands: Card[][] = new Array(4);
  hands[hakemSeat] = d.slice(0, 13);
  hands[(hakemSeat + 1) % 4] = d.slice(13, 26);
  hands[(hakemSeat + 2) % 4] = d.slice(26, 39);
  hands[(hakemSeat + 3) % 4] = d.slice(39, 52);
  return { hands, firstFive };
}

export function scoreHand(
  hakemSeat: number,
  tricksByTeam: [number, number]
): { winnerTeam: number; points: number } {
  const hakemTeam = hakemSeat % 2;
  const winnerTeam = tricksByTeam[0] >= 7 ? 0 : tricksByTeam[1] >= 7 ? 1 : tricksByTeam[0] > tricksByTeam[1] ? 0 : 1;
  if (tricksByTeam[winnerTeam] < 7) {
    throw new Error("hand is not complete");
  }
  let points = 1;
  if (winnerTeam === hakemTeam) {
    if (tricksByTeam[1 - winnerTeam] === 0) points = 2; // kot
  } else {
    if (tricksByTeam[hakemTeam] === 0) points = 3; // hakem-koti
  }
  return { winnerTeam, points };
}

export function teamOf(seat: number): number {
  return seat % 2;
}
