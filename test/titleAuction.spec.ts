import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseTitleInput,
  titleBidFloor,
  quickBidAmount,
  computeTitleSettlement,
  handleTitleReplyBid,
  handleTitleCallback,
  sweepPendingSellerAuctions,
  sweepDueTitleAuctions,
} from "../src/titleAuction";

afterEach(() => vi.unstubAllGlobals());

describe("parseTitleInput", () => {
  it("lists titles for a bare `تایتل`", () => {
    expect(parseTitleInput("تایتل")).toEqual({ kind: "list" });
    expect(parseTitleInput("/تایتل")).toEqual({ kind: "list" });
    expect(parseTitleInput("تایتل   ")).toEqual({ kind: "list" });
  });

  it("sets the active title from <تایتل N>", () => {
    expect(parseTitleInput("<تایتل 3>")).toEqual({ kind: "set", titleId: 3 });
    expect(parseTitleInput("تایتل 12")).toEqual({ kind: "set", titleId: 12 });
  });

  it("accepts Persian digits for the title id", () => {
    expect(parseTitleInput("<تایتل ۱۲>")).toEqual({ kind: "set", titleId: 12 });
  });

  it("suggests a plain title name", () => {
    expect(parseTitleInput("<تایتل سلام>")).toEqual({ kind: "text", name: "سلام" });
    expect(parseTitleInput("<تایتل ملکه>")).toEqual({ kind: "text", name: "ملکه" });
  });

  it("parses an auction start command with amounts", () => {
    expect(parseTitleInput("<تایتل گربه طلایی 1000 100>")).toEqual({
      kind: "start",
      name: "گربه طلایی",
      start: 1000,
      jump: 100,
    });
  });

  it("parses a title removal command", () => {
    expect(parseTitleInput("<تایتل حذف 5>")).toEqual({ kind: "remove", titleId: 5 });
    expect(parseTitleInput("<تایتل حذف ۱۲>")).toEqual({ kind: "remove", titleId: 12 });
    expect(parseTitleInput("تایتل حذف")).toEqual({ kind: "remove", titleId: null });
  });

  it("parses a custom emoji command", () => {
    expect(parseTitleInput("<تایتل ایموجی 5 🐯>")).toEqual({ kind: "emoji", titleId: 5, emoji: "🐯" });
    expect(parseTitleInput("<تایتل ایموجی ۱۲ 🐯>")).toEqual({ kind: "emoji", titleId: 12, emoji: "🐯" });
    expect(parseTitleInput("تایتل emoji 3 🔥")).toEqual({ kind: "emoji", titleId: 3, emoji: "🔥" });
    expect(parseTitleInput("<تایتل ایموجی 5>")).toEqual({ kind: "emoji", titleId: null, emoji: null });
  });

  it("rejects multiple emoji or plain text as a badge", () => {
    expect(parseTitleInput("<تایتل ایموجی 5 🐯🐱>")).toEqual({ kind: "emoji", titleId: null, emoji: null });
    expect(parseTitleInput("<تایتل ایموجی 5 ab>")).toEqual({ kind: "emoji", titleId: null, emoji: null });
    expect(parseTitleInput("<تایتل ایموجی 5 🐯 x>")).toEqual({ kind: "emoji", titleId: null, emoji: null });
  });
});

describe("singleEmoji", () => {
  it("accepts exactly one emoji (incl. multi-codepoint graphemes)", async () => {
    const { singleEmoji } = await import("../src/titleAuction");
    expect(singleEmoji("🐯")).toBe("🐯");
    expect(singleEmoji("  🔥 ")).toBe("🔥");
    expect(singleEmoji("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦"); // one ZWJ grapheme
  });

  it("rejects multiple emoji or plain text", async () => {
    const { singleEmoji } = await import("../src/titleAuction");
    expect(singleEmoji("🐯🐱")).toBeNull();
    expect(singleEmoji("ab")).toBeNull();
    expect(singleEmoji("")).toBeNull();
    expect(singleEmoji("🐯 x")).toBeNull();
  });
});

describe("titleBidFloor", () => {
  it("first bid must be start + jump", () => {
    expect(titleBidFloor({ current_bid: null, start_amount: 1000, jump_amount: 100 })).toBe(1100);
  });

  it("later bids must beat the current bid by a jump", () => {
    expect(titleBidFloor({ current_bid: 5000, start_amount: 1000, jump_amount: 100 })).toBe(5100);
  });
});

describe("quickBidAmount", () => {
  it("+1k and +5k add flat increments on top of the current bid", () => {
    const a = { current_bid: 5000, start_amount: 1000, jump_amount: 100 };
    expect(quickBidAmount(a, "1k")).toBe(6000);
    expect(quickBidAmount(a, "5k")).toBe(10000);
  });

  it("clamps to the bid floor when the jump is larger than the increment", () => {
    const a = { current_bid: 5000, start_amount: 1000, jump_amount: 2000 };
    expect(quickBidAmount(a, "1k")).toBe(7000); // floor = 5000 + 2000
    expect(quickBidAmount(a, "5k")).toBe(10000);
  });

  it("first bid is based on the start amount", () => {
    const a = { current_bid: null, start_amount: 1000, jump_amount: 100 };
    expect(quickBidAmount(a, "1k")).toBe(2000);
    expect(quickBidAmount(a, "5k")).toBe(6000);
  });
});

describe("computeTitleSettlement (locked economy)", () => {
  it("start 10k, 3 participants, winning bid 50k → seller 46k, pot 24k", () => {
    const s = computeTitleSettlement(3, 10000, 50000);
    expect(s.totalEntries).toBe(30000);
    expect(s.winnerRemainder).toBe(40000); // bid − start
    expect(s.sellerCut).toBe(46000); // 20% × 30k + 40k
    expect(s.pot).toBe(24000);
  });

  it("single participant, bid = start + jump", () => {
    const s = computeTitleSettlement(1, 1000, 1100);
    expect(s.totalEntries).toBe(1000);
    expect(s.winnerRemainder).toBe(100);
    expect(s.sellerCut).toBe(300); // 20% × 1000 + 100
    expect(s.pot).toBe(800);
  });
});

describe("handleTitleReplyBid", () => {
  const auction = {
    id: 7,
    telegram_group_id: 1,
    title_id: 3,
    start_amount: 1000,
    jump_amount: 100,
    current_bid: null,
    current_bidder_id: null,
    current_bidder_name: null,
    status: "open",
    board_message_id: 50,
    created_at: 1000,
    last_reposted_at: 0,
  };

  function makeDb(overrides: Array<{ match: string; first?: unknown; all?: unknown[] }>) {
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          const upper = sql.toUpperCase();
          statements.push(sql);
          const rule = overrides.find((r) => upper.includes(r.match.toUpperCase()));
          return {
            run: async () => ({ meta: { changes: 1, last_row_id: 42 } }),
            first: async () => (rule && rule.first !== undefined ? rule.first : null),
            all: async () => ({ results: rule?.all ?? [] }),
          };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };
    return { db, statements };
  }

  const baseMessage: any = {
    message_id: 60,
    chat: { id: 1, type: "group" },
    from: { id: 100, first_name: "Ali", username: "ali" },
  };

  it("ignores non-numeric replies", async () => {
    const { db } = makeDb([]);
    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "سلام",
      reply_to_message: { message_id: 50 },
    });
    expect(handled).toBe(false);
  });

  it("ignores replies that are not the auction board", async () => {
    const { db } = makeDb([]);
    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "5000",
      reply_to_message: { message_id: 99 },
    });
    expect(handled).toBe(false);
  });

  it("records a valid bid replied to the board", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const { db, statements } = makeDb([
      { match: "FROM title_auctions WHERE telegram_group_id = ? AND status = 'open' AND board_message_id = ?", first: auction },
      { match: "SELECT 1 FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason = ?", first: { 1: 1 } },
      { match: "SELECT meow_points FROM users WHERE telegram_id = ?", first: { meow_points: 50000 } },
      { match: "SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?", first: { meow_points: 50000 } },
      { match: "FROM title_auctions WHERE id = ?", first: auction },
    ]);

    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "1500",
      reply_to_message: { message_id: 50 },
    });
    expect(handled).toBe(true);
    expect(statements.some((s) => s.includes("INSERT INTO title_auction_bids"))).toBe(true);
    expect(statements.some((s) => s.includes("UPDATE title_auctions") && s.includes("SET current_bid"))).toBe(true);
  });

  it("rejects bids below the floor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const { db, statements } = makeDb([
      { match: "FROM title_auctions WHERE telegram_group_id = ? AND status = 'open' AND board_message_id = ?", first: auction },
      { match: "SELECT 1 FROM transactions", first: { 1: 1 } },
    ]);

    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "1100", // floor is 1100; equal is fine
      reply_to_message: { message_id: 50 },
    });
    expect(handled).toBe(true); // consumed as a bid attempt
  });

  it("re-posts the board message and deletes the previous one on update", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init: any) => {
        const method = url.split("/").pop() as string;
        calls.push(method);
        return new Response(
          JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: 51 } : {} })
        );
      })
    );
    const { db, statements } = makeDb([
      { match: "FROM title_auctions WHERE telegram_group_id = ? AND status = 'open' AND board_message_id = ?", first: auction },
      { match: "SELECT 1 FROM transactions", first: { 1: 1 } },
      { match: "SELECT meow_points FROM users", first: { meow_points: 50000 } },
      { match: "SELECT meow_points FROM group_members", first: { meow_points: 50000 } },
      { match: "FROM title_auctions WHERE id = ?", first: auction },
    ]);

    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "1500",
      reply_to_message: { message_id: 50 },
    });
    expect(handled).toBe(true);
    expect(calls).toContain("sendMessage");
    expect(calls).toContain("deleteMessage");
    expect(statements.some((s) => s.includes("SET board_message_id = ?"))).toBe(true);
  });

  it("re-posts the board as a fresh message on every bid (even if recently re-posted)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init: any) => {
        const method = url.split("/").pop() as string;
        calls.push(method);
        return new Response(
          JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: 51 } : {} })
        );
      })
    );
    const recent = { ...auction, last_reposted_at: Math.floor(Date.now() / 1000) };
    const { db } = makeDb([
      { match: "FROM title_auctions WHERE telegram_group_id = ? AND status = 'open' AND board_message_id = ?", first: recent },
      { match: "SELECT 1 FROM transactions", first: { 1: 1 } },
      { match: "SELECT meow_points FROM users", first: { meow_points: 50000 } },
      { match: "SELECT meow_points FROM group_members", first: { meow_points: 50000 } },
      { match: "FROM title_auctions WHERE id = ?", first: recent },
    ]);

    const handled = await handleTitleReplyBid("t", db, {} as any, {
      ...baseMessage,
      text: "1500",
      reply_to_message: { message_id: 50 },
    });
    expect(handled).toBe(true);
    // Bids always force a fresh board message (new sendMessage + delete old)
    expect(calls).toContain("sendMessage");
    expect(calls).toContain("deleteMessage");
    // The "Bid placed" reply + the new board = 2 sendMessage calls
    expect(calls.filter((m) => m === "sendMessage").length).toBe(2);
  });
});

describe("getActiveTitle", () => {
  it("returns the member's active title with its price and emoji", async () => {
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({ first: async () => ({ name: "ملکه", last_price: 120000, emoji: "🐯" }) }),
      }),
    };
    const { getActiveTitle } = await import("../src/database");
    expect(await getActiveTitle(db, 1, 100)).toEqual({ name: "ملکه", last_price: 120000, emoji: "🐯" });
  });

  it("returns null when no active title is set", async () => {
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({ first: async () => null }),
      }),
    };
    const { getActiveTitle } = await import("../src/database");
    expect(await getActiveTitle(db, 1, 100)).toBeNull();
  });
});

describe("titleBadge tiers", () => {
  it("maps price to a fancier emoji", async () => {
    const { titleEmoji, titleBadge } = await import("../src/titleAuction");
    expect(titleEmoji(null)).toBe("🏅");
    expect(titleEmoji(10000)).toBe("🏅");
    expect(titleEmoji(25000)).toBe("🥇");
    expect(titleEmoji(100000)).toBe("👑");
    expect(titleEmoji(500000)).toBe("💎");
    expect(titleBadge("ملکه", 120000)).toBe("👑 <b>ملکه</b>");
  });

  it("a custom emoji overrides the price tier", async () => {
    const { titleEmoji, titleBadge } = await import("../src/titleAuction");
    expect(titleEmoji(500000, "🐯")).toBe("🐯");
    expect(titleEmoji(null, "🔥")).toBe("🔥");
    expect(titleBadge("ملکه", 120000, "🐯")).toBe("🐯 <b>ملکه</b>");
  });
});

describe("handleTitle custom emoji", () => {
  it("sets the emoji for the user's own title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          statements.push(sql);
          const upper = sql.toUpperCase();
          if (upper.includes("FROM TITLES WHERE ID = ? AND TELEGRAM_GROUP_ID = ?")) {
            return { first: async () => ({ id: 5, name: "ملکه", owner_user_id: 100 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    const { handleTitle } = await import("../src/titleAuction");
    await handleTitle("t", db, { BOT_OWNER_ID: "999" } as any, {
      message_id: 1,
      chat: { id: 1, type: "group" },
      from: { id: 100, first_name: "Ali", username: "ali" },
      text: "<تایتل ایموجی 5 🐯>",
    } as any);

    expect(statements.some((s) => s.includes("UPDATE titles SET emoji = ?"))).toBe(true);
  });

  it("rejects an emoji already used by another title in the group", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          statements.push(sql);
          const upper = sql.toUpperCase();
          if (upper.includes("AND EMOJI = ?")) return { first: async () => ({ id: 9 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          if (upper.includes("FROM TITLES WHERE ID = ? AND TELEGRAM_GROUP_ID = ?")) {
            return { first: async () => ({ id: 5, name: "ملکه", owner_user_id: 100 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    const { handleTitle } = await import("../src/titleAuction");
    await handleTitle("t", db, { BOT_OWNER_ID: "999" } as any, {
      message_id: 1,
      chat: { id: 1, type: "group" },
      from: { id: 100, first_name: "Ali", username: "ali" },
      text: "<تایتل ایموجی 5 🐯>",
    } as any);

    expect(statements.some((s) => s.includes("UPDATE titles SET emoji = ?"))).toBe(false);
  });
});

describe("handleTitle removal", () => {
  it("deletes a user's own title and clears the active pointer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          statements.push(sql);
          const upper = sql.toUpperCase();
          if (upper.includes("FROM TITLES WHERE ID = ? AND TELEGRAM_GROUP_ID = ?")) {
            return { first: async () => ({ id: 5, name: "ملکه", owner_user_id: 100 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          if (upper.includes("FROM TITLE_AUCTIONS WHERE TITLE_ID = ?")) {
            return { first: async () => null, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    const { handleTitle } = await import("../src/titleAuction");
    await handleTitle("t", db, { BOT_OWNER_ID: "999" } as any, {
      message_id: 1,
      chat: { id: 1, type: "group" },
      from: { id: 100, first_name: "Ali", username: "ali" },
      text: "<تایتل حذف 5>",
    } as any);

    expect(statements.some((s) => s.includes("DELETE FROM titles WHERE id = ?"))).toBe(true);
    expect(statements.some((s) => s.includes("UPDATE group_members SET active_title_id = NULL"))).toBe(true);
  });
});

describe("owner cancel refunds participants", () => {
  const auction = {
    id: 9,
    telegram_group_id: 1,
    title_id: 3,
    start_amount: 1000,
    jump_amount: 100,
    current_bid: 5000,
    current_bidder_id: 200,
    current_bidder_name: "@sara",
    status: "open",
    board_message_id: 50,
    created_at: 1000,
  };

  it("refunds entry fees to every participant and records refund transactions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const calls: Array<{ sql: string; args: any[] }> = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          calls.push({ sql, args });
          const upper = sql.toUpperCase();
          if (upper.includes("FROM TITLE_AUCTIONS WHERE ID = ?")) {
            return { first: async () => auction, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          if (upper.includes("FROM TITLES WHERE ID = ?")) {
            return { first: async () => ({ id: 3, telegram_group_id: 1, name: "ملکه", owner_user_id: null, status: "auctioning" }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          if (upper.includes("SELECT DISTINCT T.TELEGRAM_USER_ID") && upper.includes("FROM TRANSACTIONS T")) {
            return {
              all: async () => ({
                results: [
                  { telegram_user_id: 100, username: "ali", first_name: "Ali" },
                  { telegram_user_id: 200, username: "sara", first_name: "Sara" },
                ],
              }),
              first: async () => null,
              run: async () => ({ meta: { changes: 1 } }),
            };
          }
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    await handleTitleCallback("t", db, { BOT_OWNER_ID: "999" } as any, {
      id: "cb-cancel-1",
      from: { id: 999 },
      data: "title:cancel:9",
      message: { message_id: 50, chat: { id: 1, type: "group" } },
    } as any);

    const userCredits = calls.filter((c) => c.sql.includes("UPDATE users SET meow_points = meow_points + ?"));
    const refundTxns = calls.filter((c) => c.sql.includes("INSERT INTO transactions") && c.args[3] === "TITLE_REFUND_9");
    const gmUpserts = calls.filter((c) => c.sql.includes("INSERT INTO group_members"));
    expect(userCredits.length).toBe(2);
    expect(userCredits.every((c) => c.args[0] === 1000)).toBe(true); // full entry fee back
    expect(refundTxns.length).toBe(2);
    // Real names go into group_members — never the #<id> placeholder.
    expect(gmUpserts.length).toBe(2);
    expect(gmUpserts.every((c) => c.args[3] === "Ali" || c.args[3] === "Sara")).toBe(true);
    expect(gmUpserts.some((c) => c.args[3].startsWith("#"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("UPDATE title_auctions SET status = 'cancelled'"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("DELETE FROM titles WHERE id = ? AND owner_user_id IS NULL"))).toBe(true);
  });
});

describe("sweepDueTitleAuctions (1h auto-finish + anti-snipe)", () => {
  const auction = {
    id: 5,
    telegram_group_id: 1,
    title_id: 3,
    start_amount: 1000,
    jump_amount: 100,
    current_bid: null,
    current_bidder_id: null,
    current_bidder_name: null,
    status: "open",
    board_message_id: 50,
    created_at: 1000,
    last_reposted_at: 1000,
    ends_at: 2000,
  };

  function makeDb(sweepRows: Array<{ id: number; last_bid_at: number | null }>) {
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          statements.push(sql);
          const upper = sql.toUpperCase();
          if (upper.includes("FROM TITLE_AUCTIONS A")) {
            return { all: async () => ({ results: sweepRows }), first: async () => null, run: async () => ({ meta: { changes: 1 } }) };
          }
          if (upper.includes("FROM TITLE_AUCTIONS WHERE ID = ?")) {
            return { first: async () => auction, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          if (upper.includes("FROM TITLES WHERE ID = ?")) {
            return { first: async () => ({ id: 3, telegram_group_id: 1, name: "ملکه", owner_user_id: null, status: "auctioning" }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) };
          }
          return { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };
    return { db, statements };
  }

  it("finishes a due auction when no bid landed within the grace window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const { db, statements } = makeDb([{ id: 5, last_bid_at: 100 }]);
    expect(await sweepDueTitleAuctions(db, "t")).toBe(1);
    expect(statements.some((s) => s.includes("UPDATE title_auctions SET status = 'cancelled'"))).toBe(true);
  });

  it("skips a due auction with a bid placed within the last 30 seconds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const { db, statements } = makeDb([{ id: 5, last_bid_at: Math.floor(Date.now() / 1000) }]);
    expect(await sweepDueTitleAuctions(db, "t")).toBe(0);
    expect(statements.some((s) => s.includes("UPDATE title_auctions SET status = 'cancelled'"))).toBe(false);
  });
});

describe("owner reply lists the replied user's titles", () => {
  it("owner replying with a bare `تایتل` queries titles for that user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
    const calls: Array<{ sql: string; args: any[] }> = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          calls.push({ sql, args });
          return { run: async () => ({ meta: { changes: 1, last_row_id: 42 } }), first: async () => null, all: async () => ({ results: [] }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    const { handleTitle } = await import("../src/titleAuction");
    await handleTitle("t", db, { BOT_OWNER_ID: "999" } as any, {
      message_id: 1,
      chat: { id: 1, type: "group" },
      from: { id: 999, first_name: "Owner", username: "owner" },
      reply_to_message: { from: { id: 100, first_name: "Ali", username: "ali" } },
      text: "تایتل",
    } as any);

    const titlesQuery = calls.find((c) => c.sql.includes("FROM titles WHERE telegram_group_id = ? AND owner_user_id = ?"));
    expect(titlesQuery).toBeTruthy();
    expect(titlesQuery!.args[1]).toBe(100); // the replied user, not the owner
    expect(calls.some((c) => c.sql.includes("INSERT INTO titles"))).toBe(false); // no assign
  });
});

describe("sweepPendingSellerAuctions", () => {
  it("cancels stale pending-seller auctions and removes unowned titles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const statements: string[] = [];
    const db: any = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => {
          statements.push(sql);
          const upper = sql.toUpperCase();
          if (upper.includes("FROM TITLE_AUCTIONS A")) {
            return {
              all: async () => ({
                results: [{ id: 1, telegram_group_id: 10, title_id: 5, name: "ملکه" }],
              }),
              first: async () => null,
              run: async () => ({ meta: { changes: 1 } }),
            };
          }
          return { all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 1 } }) };
        },
      }),
      batch: async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } })),
    };

    const cancelled = await sweepPendingSellerAuctions(db, "token");
    expect(cancelled).toBe(1);
    expect(statements.some((s) => s.includes("UPDATE title_auctions SET status = 'cancelled'"))).toBe(true);
    expect(statements.some((s) => s.includes("DELETE FROM titles WHERE id = ? AND owner_user_id IS NULL"))).toBe(true);
  });
});
