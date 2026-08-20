import { describe, expect, it } from "vitest";
import {
  blindsFor,
  cardToString,
  cardsToString,
  evaluateBest,
  handCategory,
  handName,
  newDeck,
  resolvePots,
  shuffle,
  splitAmount,
  toFaDigits,
} from "../src/poker";
import { pokerLobbyKeyboard, pokerTableKeyboard } from "../src/keyboards";

function c(rank: number, suit: number) {
  return { rank, suit };
}

describe("deck helpers", () => {
  it("builds a 52-card deck with unique cards", () => {
    const deck = newDeck();
    expect(deck).toHaveLength(52);
    const seen = new Set(deck.map((x) => `${x.rank}-${x.suit}`));
    expect(seen.size).toBe(52);
  });

  it("shuffle preserves all cards", () => {
    const deck = newDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    const sortKey = (cards: typeof deck) => [...cards].sort((a, b) => a.rank - b.rank || a.suit - b.suit).map((x) => `${x.rank}${x.suit}`).join(",");
    expect(sortKey(shuffled)).toBe(sortKey(deck));
  });

  it("renders cards and converts digits to Persian", () => {
    expect(cardToString(c(14, 0))).toBe("A♠");
    expect(cardToString(c(10, 2))).toBe("10♦");
    expect(cardsToString([c(13, 1), c(11, 3)])).toBe("K♥ J♣");
    expect(toFaDigits(123456)).toBe("۱۲۳۴۵۶");
  });
});

describe("hand evaluation", () => {
  it("orders hand categories correctly", () => {
    const royalFlush = evaluateBest([c(14, 0), c(13, 0), c(12, 0), c(11, 0), c(10, 0)]);
    const straightFlush = evaluateBest([c(9, 0), c(8, 0), c(7, 0), c(6, 0), c(5, 0)]);
    const fourKind = evaluateBest([c(13, 0), c(13, 1), c(13, 2), c(13, 3), c(14, 0)]);
    const fullHouse = evaluateBest([c(13, 0), c(13, 1), c(13, 2), c(12, 0), c(12, 1)]);
    const flush = evaluateBest([c(14, 0), c(13, 0), c(12, 0), c(11, 0), c(9, 0)]);
    const straight = evaluateBest([c(14, 0), c(13, 1), c(12, 2), c(11, 3), c(10, 0)]);
    const threeKind = evaluateBest([c(11, 0), c(11, 1), c(11, 2), c(5, 0), c(4, 1)]);
    const twoPair = evaluateBest([c(11, 0), c(11, 1), c(9, 0), c(9, 1), c(5, 0)]);
    const onePair = evaluateBest([c(11, 0), c(11, 1), c(9, 0), c(7, 1), c(5, 0)]);
    const highCard = evaluateBest([c(14, 0), c(13, 1), c(12, 2), c(9, 3), c(5, 0)]);

    const sorted = [highCard, onePair, twoPair, threeKind, straight, flush, fullHouse, fourKind, straightFlush, royalFlush];
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i]).toBeLessThan(sorted[i + 1]);
    }
    expect(handCategory(royalFlush)).toBe(8);
    expect(handCategory(fourKind)).toBe(7);
    expect(handCategory(highCard)).toBe(0);
  });

  it("recognizes the A-2-3-4-5 wheel straight", () => {
    const wheel = evaluateBest([c(14, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)]);
    expect(handCategory(wheel)).toBe(4);
  });

  it("picks the best of 7 cards", () => {
    // Board + two hole cards: hole pair of aces should beat the board's pair of kings
    const board = [c(13, 0), c(13, 1), c(7, 2), c(3, 3), c(9, 0)];
    const withAces = evaluateBest([...board, c(14, 0), c(14, 1)]);
    const withQueens = evaluateBest([...board, c(12, 0), c(12, 1)]);
    expect(handName(withAces)).toBe("Two Pair");
    expect(withAces).toBeGreaterThan(withQueens);
  });

  it("breaks flush ties on the 5th card", () => {
    const higher = evaluateBest([c(14, 0), c(13, 0), c(12, 0), c(11, 0), c(9, 0)]);
    const lower = evaluateBest([c(14, 1), c(13, 1), c(12, 1), c(11, 1), c(8, 1)]);
    expect(handCategory(higher)).toBe(5);
    expect(higher).toBeGreaterThan(lower);
  });

  it("breaks high-card ties on the 5th card", () => {
    const higher = evaluateBest([c(14, 0), c(13, 1), c(12, 2), c(9, 3), c(5, 0)]);
    const lower = evaluateBest([c(14, 1), c(13, 2), c(12, 3), c(9, 0), c(4, 1)]);
    expect(handCategory(higher)).toBe(0);
    expect(higher).toBeGreaterThan(lower);
  });
});

describe("blinds escalation", () => {
  it("returns base blinds for the first level", () => {
    expect(blindsFor(1, 1000)).toEqual({ small: 5, big: 10 });
    expect(blindsFor(3, 1000)).toEqual({ small: 5, big: 10 });
  });

  it("scales base blinds with the buy-in", () => {
    expect(blindsFor(1, 10000)).toEqual({ small: 50, big: 100 });
    expect(blindsFor(1, 50000)).toEqual({ small: 250, big: 500 });
  });

  it("doubles blinds every POKER_BLIND_STEP_HANDS hands", () => {
    expect(blindsFor(4, 1000)).toEqual({ small: 10, big: 20 });
    expect(blindsFor(7, 1000)).toEqual({ small: 20, big: 40 });
    expect(blindsFor(10, 1000)).toEqual({ small: 40, big: 80 });
  });

  it("caps blinds at 20% of the buy-in", () => {
    const late = blindsFor(100, 1000);
    expect(late.big).toBe(200);
    expect(late.small).toBe(100);
  });
});

describe("side pots", () => {
  const board = [c(2, 0), c(3, 1), c(4, 2), c(5, 3), c(8, 0)];

  it("splits a pot into side pots by contribution and awards to the best hand", () => {
    const players = [
      { index: 0, totalBetThisHand: 100, folded: false, holeCards: [c(14, 0), c(14, 1)] },
      { index: 1, totalBetThisHand: 50, folded: true, holeCards: [c(10, 0), c(10, 1)] },
      { index: 2, totalBetThisHand: 100, folded: false, holeCards: [c(13, 0), c(12, 0)] },
    ];
    const pots = resolvePots(board, players);

    expect(pots).toHaveLength(2);
    expect(pots[0].amount).toBe(150); // 50 x 3 contributors
    expect(pots[1].amount).toBe(100); // 50 x 2 contributors
    expect(pots[0].winners).toEqual([0]); // seat 0's pair of aces beats high card
    expect(pots[1].winners).toEqual([0]);
  });

  it("gives an uncontested side pot to the sole un-folded contributor", () => {
    const players = [
      { index: 0, totalBetThisHand: 200, folded: false, holeCards: [c(14, 0), c(14, 1)] },
      { index: 1, totalBetThisHand: 50, folded: true, holeCards: [c(10, 0), c(10, 1)] },
      { index: 2, totalBetThisHand: 50, folded: true, holeCards: [c(13, 0), c(12, 0)] },
    ];
    const pots = resolvePots(board, players);
    expect(pots).toHaveLength(2);
    expect(pots[0].winners).toEqual([0]);
    expect(pots[1].winners).toEqual([0]);
    expect(pots[0].amount + pots[1].amount).toBe(300); // full contributions returned
  });

  it("hands tied pots to all equal-scoring players", () => {
    const boardTie = [c(2, 0), c(3, 1), c(4, 2), c(5, 3), c(8, 0)];
    const players = [
      { index: 0, totalBetThisHand: 100, folded: false, holeCards: [c(14, 0), c(13, 0)] },
      { index: 1, totalBetThisHand: 100, folded: false, holeCards: [c(14, 1), c(13, 1)] },
    ];
    const pots = resolvePots(boardTie, players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(200);
    expect(pots[0].winners).toEqual([0, 1]);
  });

  it("splits amounts evenly and gives the remainder to the first winner", () => {
    expect([...splitAmount(100, [0, 1, 2]).entries()]).toEqual([
      [0, 34],
      [1, 33],
      [2, 33],
    ]);
    expect([...splitAmount(50, [0]).entries()]).toEqual([[0, 50]]);
  });

  it("rolls dead money from a fully-folded pot level into the lower pot", () => {
    // Preflop: A all-in 1000, C all-in 1500, B raises to 2000 and folds on the
    // flop. The 2000 level's only contributor (B) folded — that dead 500 MP
    // must roll into the 1500 level instead of vanishing.
    const players = [
      { index: 0, totalBetThisHand: 1000, folded: false, holeCards: [c(14, 0), c(14, 1)] },
      { index: 1, totalBetThisHand: 2000, folded: true, holeCards: [c(10, 0), c(10, 1)] },
      { index: 2, totalBetThisHand: 1500, folded: false, holeCards: [c(13, 0), c(12, 0)] },
    ];
    const pots = resolvePots(board, players);

    expect(pots).toHaveLength(2);
    expect(pots[0].amount).toBe(3000); // 1000 x 3
    expect(pots[1].amount).toBe(1500); // 500 x 2 (B + C) + 500 dead money from B's fold
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(4500); // every chip is distributed
    expect(pots[1].winners).toEqual([2]); // C wins the rolled-up side pot
  });
});

describe("poker keyboards", () => {
  const baseState = {
    gameId: "p1_abc123",
    groupId: 1,
    messageId: 1,
    stage: "preflop",
    buyIn: 10000,
    pot: 300,
    board: [],
    currentBet: 100,
    lastRaiseSize: 100,
    draft: null,
    currentTurn: 2,
    actionDeadline: Date.now() + 90000,
    handNumber: 1,
    hostId: 42,
    cancelled: false,
    seats: [
      { index: 0, userId: 42, name: "Host", chips: 9000, holeCardCount: 2, folded: false, allIn: false, hasActed: true, committedThisStreet: 100, lastAction: "", isBot: false, pendingDeal: false, left: false },
      { index: 1, userId: -1001, name: "Bot1", chips: 10000, holeCardCount: 2, folded: false, allIn: false, hasActed: false, committedThisStreet: 50, lastAction: "", isBot: true, pendingDeal: false, left: false },
      { index: 2, userId: 7, name: "Me", chips: 9000, holeCardCount: 2, folded: false, allIn: false, hasActed: false, committedThisStreet: 50, lastAction: "", isBot: false, pendingDeal: false, left: false },
    ],
    lastActionText: "",
    resultText: null,
    winnerIds: null,
  };

  it("renders the lobby keyboard", () => {
    const kb = pokerLobbyKeyboard("p1_abc123");
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("✅ Join");
    expect(labels).toContain("🤖 Add bot");
    expect(labels).toContain("▶️ Start");
    expect(labels).toContain("🎚 Buy-in");
  });

  it("renders +1K / +5K / +10K raise buttons scoped to the current player", () => {
    const kb = pokerTableKeyboard(baseState.gameId, baseState as any);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`poker:act:${baseState.gameId}:call:user:7`);
    expect(data).toContain(`poker:act:${baseState.gameId}:fold:user:7`);
    expect(data).toContain(`poker:act:${baseState.gameId}:allin:user:7`);
    expect(data).toContain(`poker:act:${baseState.gameId}:raise:1000:user:7`);
    expect(data).toContain(`poker:act:${baseState.gameId}:raise:5000:user:7`);
    expect(data).toContain(`poker:act:${baseState.gameId}:raise:10000:user:7`);
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("+1K");
    expect(labels).toContain("+5K");
    expect(labels).toContain("+10K");
  });

  it("renders a cash-out button between rounds", () => {
    const showdown = { ...baseState, stage: "showdown", currentTurn: null, resultText: "🏆 Host wins 300 MP" };
    const kb = pokerTableKeyboard(showdown.gameId, showdown as any);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toEqual([`poker:leavegame:${showdown.gameId}`]);
  });

  it("swaps to a raise-confirm panel while a draft is active", () => {
    const drafting = { ...baseState, draft: 7000 };
    const kb = pokerTableKeyboard(drafting.gameId, drafting as any);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:-10000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:-5000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:-1000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:1000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:5000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:adj:10000:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:confirm:user:7`);
    expect(data).toContain(`poker:act:${drafting.gameId}:back:user:7`);
    expect(labels).toContain("✅ Confirm: 7000");
    // The normal action buttons are hidden while drafting.
    expect(data.some((d) => d.includes(":call:") || d.includes(":fold:") || d.includes(":allin:") || d.includes(":raise:"))).toBe(false);
  });
});
