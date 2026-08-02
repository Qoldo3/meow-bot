import { describe, expect, it } from "vitest";
import {
  newDeck,
  shuffle,
  rankValue,
  suitOf,
  isLegal,
  legalPlays,
  lowestLegalCard,
  highestCard,
  resolveTrick,
  scoreHand,
  dealHands,
  firstAceSeat,
  isAce,
} from "../src/hokm";

describe("deck", () => {
  it("creates 52 unique cards", () => {
    const deck = newDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("shuffle keeps all cards", () => {
    const deck = newDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
  });
});

describe("card values", () => {
  it("ranks ace above king above 2", () => {
    expect(rankValue("AS")).toBeGreaterThan(rankValue("KS"));
    expect(rankValue("KS")).toBeGreaterThan(rankValue("2S"));
    expect(rankValue("10H")).toBeGreaterThan(rankValue("9H"));
  });

  it("extracts suit", () => {
    expect(suitOf("10H")).toBe("H");
    expect(suitOf("AD")).toBe("D");
  });

  it("sorts descending", () => {
    const sorted = [rankValue(highestCard(["2C", "AS", "KH"]))];
    expect(sorted[0]).toBe(12);
  });
});

describe("legality", () => {
  it("must follow led suit when able", () => {
    const hand = ["2S", "3S", "AH"];
    expect(isLegal(hand, "3S", "S", null)).toBe(true);
    expect(isLegal(hand, "AH", "S", null)).toBe(false);
  });

  it("may play off-suit when void", () => {
    const hand = ["2H", "3D"];
    expect(isLegal(hand, "3D", "S", null)).toBe(true);
    expect(isLegal(hand, "AH", "C", null)).toBe(false);
  });

  it("legalPlays returns only led suit when able", () => {
    const hand = ["2S", "3S", "AH"];
    const plays = legalPlays(hand, "S", null);
    expect(plays).toEqual(expect.arrayContaining(["2S", "3S"]));
    expect(plays).not.toContain("AH");
  });

  it("lowestLegalCard picks lowest follow", () => {
    const hand = ["AS", "3S", "AH"];
    expect(lowestLegalCard(hand, "S", null)).toBe("3S");
  });
});

describe("trick resolution", () => {
  it("highest led suit wins without trump", () => {
    const winner = resolveTrick(
      [
        { seat: 0, card: "KS" },
        { seat: 1, card: "AS" },
        { seat: 2, card: "QS" },
        { seat: 3, card: "10S" },
      ],
      "H"
    );
    expect(winner).toBe(1);
  });

  it("trump beats non-trump", () => {
    const winner = resolveTrick(
      [
        { seat: 0, card: "AS" },
        { seat: 1, card: "2H" },
        { seat: 2, card: "KS" },
        { seat: 3, card: "3S" },
      ],
      "H"
    );
    expect(winner).toBe(1);
  });

  it("higher trump beats lower trump", () => {
    const winner = resolveTrick(
      [
        { seat: 0, card: "2H" },
        { seat: 1, card: "AH" },
      ],
      "H"
    );
    expect(winner).toBe(1);
  });
});

describe("scoring", () => {
  it("normal win is 1 point", () => {
    const r = scoreHand(0, [7, 6]);
    expect(r.winnerTeam).toBe(0);
    expect(r.points).toBe(1);
  });

  it("kot (hakem sweeps 7-0) is 2 points", () => {
    const r = scoreHand(0, [7, 0]);
    expect(r.winnerTeam).toBe(0);
    expect(r.points).toBe(2);
  });

  it("hakem-koti (opponents sweep 7-0) is 3 points", () => {
    const r = scoreHand(0, [0, 7]);
    expect(r.winnerTeam).toBe(1);
    expect(r.points).toBe(3);
  });

  it("opponents win 7-6 for 1 point", () => {
    const r = scoreHand(0, [6, 7]);
    expect(r.winnerTeam).toBe(1);
    expect(r.points).toBe(1);
  });
});

describe("dealing", () => {
  it("deals 13 to each seat and 5 first cards to hakem", () => {
    const { hands, firstFive } = dealHands(2);
    for (const hand of hands) expect(hand).toHaveLength(13);
    expect(firstFive).toHaveLength(5);
    for (const c of firstFive) {
      expect(hands[2]).toContain(c);
    }
  });
});

describe("hakem draw", () => {
  it("finds first ace seat by round-robin", () => {
    const order = ["2S", "3H", "4D", "5C", "6S", "AH"];
    const { seat, index } = firstAceSeat(order);
    expect(index).toBe(5);
    expect(seat).toBe(1); // index % 4
    expect(isAce(order[index])).toBe(true);
  });
});
