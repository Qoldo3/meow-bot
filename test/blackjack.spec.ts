import { describe, expect, it } from "vitest";
import {
  betExposure,
  canDouble,
  canSplit,
  dealerMustHit,
  handExposure,
  handValue,
  isNatural,
  nextPlayableHand,
  payoutFor,
  renderHand,
  resolveHandResult,
} from "../src/blackjack";
import { blackjackLobbyKeyboard, blackjackTableKeyboard } from "../src/keyboards";
import type { BlackjackHand, PublicBlackjackState } from "../src/types";

function c(rank: number, suit: number) {
  return { rank, suit };
}

function hand(cards: { rank: number; suit: number }[], bet = 1000): BlackjackHand {
  return { cards, bet, doubled: false, fromSplit: false, result: "pending" };
}

function seat(over: Partial<{ index: number; userId: number; name: string; chips: number; draft: number | null; pendingBet: number | null; hands: BlackjackHand[]; lastAction: string; left: boolean; busted: boolean; pvMsgId: number | null }> = {}) {
  return {
    index: 0,
    userId: 7,
    name: "Me",
    chips: 10000,
    draft: null,
    pendingBet: null,
    hands: [] as BlackjackHand[],
    lastAction: "",
    left: false,
    busted: false,
    pvMsgId: null,
    ...over,
  };
}

describe("hand values", () => {
  it("counts face cards as 10 and aces as 11", () => {
    expect(handValue([c(13, 0), c(11, 1)])).toEqual({ total: 20, soft: false });
    expect(handValue([c(14, 0), c(9, 1)])).toEqual({ total: 20, soft: true });
  });

  it("downgrades aces to 1 when needed to avoid busting", () => {
    expect(handValue([c(14, 0), c(14, 1)])).toEqual({ total: 12, soft: true });
    // A,A,9: one ace stays at 11 -> soft 21.
    expect(handValue([c(14, 0), c(14, 1), c(9, 2)])).toEqual({ total: 21, soft: true });
    expect(handValue([c(14, 0), c(14, 1), c(14, 2), c(10, 3)])).toEqual({ total: 13, soft: false });
  });

  it("detects natural blackjack only on exactly two cards", () => {
    expect(isNatural([c(14, 0), c(10, 1)])).toBe(true);
    expect(isNatural([c(14, 0), c(13, 1)])).toBe(true);
    expect(isNatural([c(14, 0), c(9, 1), c(2, 2)])).toBe(false);
    expect(isNatural([c(10, 0), c(10, 1)])).toBe(false);
  });
});

describe("dealer play (S17)", () => {
  it("hits below 17 and stands on 17+ including soft 17", () => {
    expect(dealerMustHit(16)).toBe(true);
    expect(dealerMustHit(17)).toBe(false);
    expect(dealerMustHit(21)).toBe(false);
  });
});

describe("settlement", () => {
  it("resolves win/loss/push vs the dealer (ties split)", () => {
    const h = hand([c(13, 0), c(9, 1)]); // 19
    expect(resolveHandResult(h, 18, false, false)).toBe("win");
    expect(resolveHandResult(h, 20, false, false)).toBe("loss");
    expect(resolveHandResult(h, 19, false, false)).toBe("push"); // tie -> split
    expect(resolveHandResult(h, 0, true, false)).toBe("win"); // dealer bust
  });

  it("a natural beats a drawn 21 but splits a dealer natural", () => {
    const natural = { ...hand([c(14, 0), c(10, 1)]), result: "natural" as const };
    expect(resolveHandResult(natural, 21, false, false)).toBe("win");
    expect(resolveHandResult(natural, 21, false, true)).toBe("push"); // natural vs natural
    const plain = hand([c(13, 0), c(8, 1), c(3, 2)]); // 21 in 3 cards
    expect(resolveHandResult(plain, 21, false, true)).toBe("loss");
  });

  it("a busted player hand always loses", () => {
    const bust = { ...hand([c(13, 0), c(10, 1), c(5, 2)]), result: "bust" as const };
    expect(resolveHandResult(bust, 0, true, false)).toBe("loss");
  });

  it("pays 2.5x for natural, 2x for win, half for push, 0 for loss", () => {
    expect(payoutFor("natural", 1000)).toBe(2500);
    expect(payoutFor("win", 1000)).toBe(2000);
    expect(payoutFor("push", 1000)).toBe(500);
    expect(payoutFor("push", 999)).toBe(499);
    expect(payoutFor("loss", 1000)).toBe(0);
    expect(payoutFor("bust", 1000)).toBe(0);
  });

  it("pays 2.5x for natural, 2x for win (odd bets floor)", () => {
    expect(payoutFor("natural", 1001)).toBe(2502);
    expect(payoutFor("win", 1001)).toBe(2002);
  });
});

describe("exposure", () => {
  it("initial bets reserve 2.5x (covers a natural)", () => {
    expect(betExposure(1000)).toBe(2500);
  });

  it("active hands reserve 2x, naturals 2.5x", () => {
    expect(handExposure(hand([c(10, 0), c(9, 1)]))).toBe(2000);
    const doubled = { ...hand([c(10, 0), c(9, 1)], 2000), doubled: true };
    expect(handExposure(doubled)).toBe(4000);
    const natural = { ...hand([c(14, 0), c(10, 1)]), result: "natural" as const };
    expect(handExposure(natural)).toBe(2500);
  });
});


describe("turn advancing (nextPlayableHand)", () => {
  function seatLike(index: number, hands: BlackjackHand[], extra: Partial<{ left: boolean; busted: boolean }> = {}) {
    return { index, left: false, busted: false, hands, ...extra };
  }

  it("moves to the next seat's first pending hand", () => {
    const seats = [
      seatLike(0, [hand([c(9, 0), c(9, 1)])]),
      seatLike(1, [hand([c(10, 0), c(10, 1)])]),
      seatLike(2, [hand([c(8, 0), c(8, 1)])]),
    ];
    expect(nextPlayableHand(seats, 0, 0)).toEqual({ seatIndex: 1, handIndex: 0 });
    expect(nextPlayableHand(seats, 2, 0)).toEqual({ seatIndex: 0, handIndex: 0 }); // wraps
    expect(nextPlayableHand(seats, 1, 0)).toEqual({ seatIndex: 2, handIndex: 0 });
  });

  it("after a split, plays the player's second hand before the next seat", () => {
    // Seat 0 split into two pending hands; seat 1 also has a pending hand.
    const seats = [
      seatLike(0, [
        { ...hand([c(8, 0), c(13, 1)]), result: "stand" },
        { ...hand([c(8, 1), c(2, 2)]), result: "pending" },
      ]),
      seatLike(1, [hand([c(10, 0), c(10, 1)])]),
    ];
    // After hand 0 of seat 0 stood, the next action is seat 0's second hand,
    // NOT seat 1.
    expect(nextPlayableHand(seats, 0, 0)).toEqual({ seatIndex: 0, handIndex: 1 });
    // After that second hand finishes, move on to seat 1.
    expect(nextPlayableHand(seats, 0, 1)).toEqual({ seatIndex: 1, handIndex: 0 });
  });

  it("skips natural/bust/stand hands and absent or left seats", () => {
    const seats = [
      seatLike(0, [{ ...hand([c(14, 0), c(10, 1)]), result: "natural" }]),
      seatLike(1, [], { left: true }),
      seatLike(2, [{ ...hand([c(10, 0), c(9, 1), c(5, 2)]), result: "bust" }]),
      seatLike(3, [hand([c(7, 0), c(7, 1)])]),
    ];
    expect(nextPlayableHand(seats, 0, 0)).toEqual({ seatIndex: 3, handIndex: 0 });
  });

  it("returns null when every hand is settled", () => {
    const seats = [
      seatLike(0, [{ ...hand([c(9, 0), c(9, 1)]), result: "stand" }]),
      seatLike(1, [{ ...hand([c(10, 0), c(10, 1)]), result: "stand" }]),
    ];
    expect(nextPlayableHand(seats, 0, 0)).toBeNull();
  });
});

describe("split / double legality", () => {
  it("splits matching pairs, capped at 4 hands, never re-splitting aces", () => {
    const s = seat({ chips: 5000 });
    expect(canSplit(hand([c(8, 0), c(8, 1)]), s)).toBe(true);
    expect(canSplit(hand([c(8, 0), c(9, 1)]), s)).toBe(false); // not a pair
    const fourHands = { ...s, hands: [hand([c(2, 0), c(2, 1)]), hand([c(2, 2), c(2, 3)]), hand([c(3, 0), c(3, 1)]), hand([c(3, 2), c(3, 3)])] };
    expect(canSplit(hand([c(8, 0), c(8, 1)]), fourHands)).toBe(false);
    const aceSplitHand = { ...hand([c(14, 0), c(14, 1)]), fromSplit: true };
    expect(canSplit(aceSplitHand, s)).toBe(false);
  });

  it("doubles only on two cards with chips to cover, never after ace-split", () => {
    const s = seat({ chips: 5000 });
    expect(canDouble(hand([c(9, 0), c(9, 1)]), s)).toBe(true);
    expect(canDouble(hand([c(9, 0), c(9, 1), c(2, 2)]), s)).toBe(false); // 3 cards
    expect(canDouble(hand([c(9, 0), c(9, 1)]), seat({ chips: 500 }))).toBe(false); // poor
    const aceSplit = { ...hand([c(14, 0), c(7, 1)]), fromSplit: true };
    expect(canDouble(aceSplit, s)).toBe(false);
  });
});

describe("rendering", () => {
  it("renders hands with totals and results", () => {
    expect(renderHand(hand([c(13, 0), c(9, 1)]))).toContain("K♠ 9♥");
    const natural = { ...hand([c(14, 0), c(10, 1)]), result: "natural" as const };
    expect(renderHand(natural)).toContain("Blackjack");
  });
});

describe("blackjack keyboards", () => {
  const baseState: PublicBlackjackState = {
    gameId: "b1_abc123",
    groupId: 1,
    messageId: 1,
    stage: "lobby",
    buyIn: 10000,
    roundNumber: 0,
    dealerCards: [],
    dealerHoleRevealed: false,
    currentSeat: null,
    currentHand: null,
    actionDeadline: null,
    betDeadline: null,
    lobbyDeadline: Date.now() + 60000,
    breakDeadline: null,
    hostId: 42,
    cancelled: false,
    seats: [],
    lastActionText: "",
    resultText: null,
    endedAt: null,
  };

  it("renders the lobby keyboard with a mode toggle", () => {
    const kb = blackjackLobbyKeyboard("b1_abc123", "single");
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`bj:lobby:b1_abc123:join`);
    expect(data).toContain(`bj:lobby:b1_abc123:start`);
    expect(data).toContain(`bj:lobby:b1_abc123:cancel`);
    expect(data).toContain(`bj:lobby:b1_abc123:mode`);
  });

  it("shows the betting panel scoped to the current bettor", () => {
    const st: PublicBlackjackState = {
      ...baseState,
      stage: "betting",
      currentSeat: 2,
      seats: [
        { ...seat({ index: 0, userId: 42, name: "Host", pendingBet: 2000 }), hands: [] },
        { ...seat({ index: 1, userId: 9, name: "Other", pendingBet: null }), hands: [] },
        { ...seat({ index: 2, userId: 7, name: "Me", pendingBet: null }), hands: [] },
      ],
    };
    const kb = blackjackTableKeyboard(st.gameId, st);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`bj:bet:${st.gameId}:draft:user:7`);
    expect(data).toContain(`bj:bet:${st.gameId}:skip:user:7`);
  });

  it("swaps to a bet-confirm panel while drafting", () => {
    const st: PublicBlackjackState = {
      ...baseState,
      stage: "betting",
      currentSeat: 0,
      seats: [
        { ...seat({ index: 0, userId: 7, name: "Me", pendingBet: null, draft: 5000 }), hands: [] },
      ],
    };
    const kb = blackjackTableKeyboard(st.gameId, st);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`bj:bet:${st.gameId}:adj:-10000:user:7`);
    expect(data).toContain(`bj:bet:${st.gameId}:adj:1000:user:7`);
    expect(data).toContain(`bj:bet:${st.gameId}:confirm:user:7`);
    expect(data).toContain(`bj:bet:${st.gameId}:back:user:7`);
  });

  it("shows hit/stand/double/split for the acting player's pending hand", () => {
    const st: PublicBlackjackState = {
      ...baseState,
      stage: "playing",
      currentSeat: 0,
      currentHand: 0,
      seats: [
        { ...seat({ index: 0, userId: 7, name: "Me" }), hands: [hand([c(9, 0), c(8, 1)])] },
      ],
    };
    const kb = blackjackTableKeyboard(st.gameId, st);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`bj:act:${st.gameId}:hit:user:7`);
    expect(data).toContain(`bj:act:${st.gameId}:stand:user:7`);
    expect(data).toContain(`bj:act:${st.gameId}:double:user:7`);
    expect(data).toContain(`bj:act:${st.gameId}:split:user:7`);
  });

  it("offers join + cash out between rounds", () => {
    const st: PublicBlackjackState = {
      ...baseState,
      stage: "settled",
      roundNumber: 1,
      seats: [{ ...seat({ index: 0, userId: 7, name: "Me" }), hands: [hand([c(9, 0), c(8, 1)])] }],
    };
    const kb = blackjackTableKeyboard(st.gameId, st);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(`bj:lobby:${st.gameId}:join`);
    expect(data).toContain(`bj:leavegame:${st.gameId}`);
  });
});
