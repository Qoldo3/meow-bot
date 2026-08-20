import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { awardMeow, handleDice } from "../src/handlers";
import { sendMessage } from "../src/telegram";
import type { TelegramUser, TelegramChat } from "../src/types";

// Avoid real Telegram API calls in these unit tests.
vi.mock("../src/telegram", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  answerCallback: vi.fn(async () => ({ ok: true })),
  editMessageText: vi.fn(async () => ({ ok: true })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
  isGroupAdmin: vi.fn(async () => true),
  telegramRequest: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  setMyCommands: vi.fn(async () => ({ ok: true })),
}));

type BindCall = { sql: string; args: unknown[] };

function makeDb(opts: { credit?: number | null; meows?: number | null; upsertChanges?: number } = {}) {
  const bindCalls: BindCall[] = [];
  const db: any = {
    bindCalls,
    prepare: vi.fn((sql: string) => {
      const s = sql.toUpperCase();
      return {
        bind: (...args: unknown[]) => {
          bindCalls.push({ sql: s, args });
          if (s.includes("SELECT VALUE FROM BOT_SETTINGS")) return { first: async () => null };
          if (s.includes("SELECT BONUS_MULTIPLIER FROM EVENTS")) return { first: async () => null };
          if (s.includes("FROM TELEGRAM_GROUPS WHERE TELEGRAM_GROUP_ID")) {
            return {
              first: async () => ({
                bot_enabled: 1,
                cooldown_seconds: 300,
                meow_tax_pool: 0,
                duel_tax_pool: 0,
                lottery_enabled: 1,
                lottery_tax_percentage: 75,
                lottery_ticket_price: 100,
                lottery_pot: 0,
                lottery_ticket_sales: 0,
                treasury_balance: 0,
              }),
            };
          }
          if (s.includes("COUNT(*) + 1 AS RANK")) return { first: async () => ({ rank: 5 }) };
          if (s.includes("SELECT LOTTERY_MEOW_CREDIT")) {
            return { first: async () => ({ lottery_meow_credit: opts.credit ?? 0, total_meows: opts.meows ?? null }) };
          }
          return {
            run: async () => ({ meta: { changes: opts.upsertChanges ?? 1 } }),
            first: async () => null,
            all: async () => ({ results: [] }),
          };
        },
      };
    }),
    batch: vi.fn(async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } }))),
  };
  return db;
}

const user: TelegramUser = { id: 123, first_name: "Ali", username: "ali" };
const chat: TelegramChat = { id: -100111, type: "supergroup", title: "Test Group" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("meow -> free lottery ticket (every 3 meows)", () => {
  it("flags a ticket as earned when the current credit is 2 (the 3rd meow)", async () => {
    const db = makeDb({ credit: 2 });
    const res = await awardMeow(db, user, chat);

    expect(res).toMatchObject({ cooldown: false });
    if ("points" in res) {
      expect(res.lotteryTicketEarned).toBe(true);
    }
  });

  it("does not flag a ticket for other credits", async () => {
    for (const credit of [0, 1, 4] as const) {
      const db = makeDb({ credit });
      const res = await awardMeow(db, user, chat);
      if ("points" in res) {
        expect(res.lotteryTicketEarned).toBe(false);
      }
    }
  });

  it("does not flag a ticket for a brand-new member (no credit row yet)", async () => {
    const db = makeDb({ credit: null });
    const res = await awardMeow(db, user, chat);
    if ("points" in res) {
      expect(res.lotteryTicketEarned).toBe(false);
    }
  });

  it("applies the VIP boost silently (same result shape, no visible flag)", async () => {
    const db = makeDb({});
    const res = await awardMeow(db, user, chat, "123");
    if ("points" in res) {
      expect(res).not.toHaveProperty("vip");
    }
  });

  it("flags the first meow and every-tenth milestones", async () => {
    const db = makeDb({ meows: 9 });
    const res = await awardMeow(db, user, chat);
    if ("points" in res) {
      expect(res.firstMeow).toBe(false);
      expect(res.milestone).toBe(true);
    }

    const freshDb = makeDb({ meows: null });
    const freshRes = await awardMeow(freshDb, user, chat);
    if ("points" in freshRes) {
      expect(freshRes.firstMeow).toBe(true);
      expect(freshRes.milestone).toBe(false);
    }
  });

  it("still keeps the meow credit progression in the upsert SQL", async () => {
    const db = makeDb({ credit: 2 });
    await awardMeow(db, user, chat);

    const upsert = db.bindCalls.find((c) => c.sql.includes("INSERT INTO GROUP_MEMBERS"));
    expect(upsert).toBeTruthy();
    const sql = upsert!.sql; // stored uppercased by the mock
    expect(sql).toContain("LOTTERY_BONUS_TICKETS = GROUP_MEMBERS.LOTTERY_BONUS_TICKETS + CAST((GROUP_MEMBERS.LOTTERY_MEOW_CREDIT + 1) / 3 AS INTEGER)");
    expect(sql).toContain("LOTTERY_MEOW_CREDIT = (GROUP_MEMBERS.LOTTERY_MEOW_CREDIT + 1) % 3");
  });
});

describe("dice prize", () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockClear();
  });

  const fakeMessage = (id: number) => ({
    message_id: id,
    from: user,
    chat,
    text: "/dice",
  });

  it("doubles the prize when both dice show 6", async () => {
    const db = makeDb();
    // rand1 -> die1 = 6, rand2 -> die2 = 6, rand3 -> base reward 1500 (then doubled)
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.98)
      .mockReturnValueOnce(0);

    await handleDice("token", db, {} as any, fakeMessage(1));

    const groupInsert = db.bindCalls.find((c) => c.sql.includes("INSERT INTO GROUP_MEMBERS"));
    // bind order: group_id, user_id, username, first_name, reward, now, cooldown-cutoff
    expect(groupInsert!.args[4]).toBe(3000);

    const text = String(vi.mocked(sendMessage).mock.calls.at(-1)?.[2]);
    expect(text).toContain("شش شش");
    expect(text).toContain("3000");
  });

  it("keeps the normal single prize for a regular pair", async () => {
    const db = makeDb();
    // die1 = 1, die2 = 1, base reward = 1500 + floor(0.5 * 501) = 1750 (not doubled)
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.02)
      .mockReturnValueOnce(0.5);

    await handleDice("token", db, {} as any, fakeMessage(2));

    const groupInsert = db.bindCalls.find((c) => c.sql.includes("INSERT INTO GROUP_MEMBERS"));
    expect(groupInsert!.args[4]).toBe(1750);

    const text = String(vi.mocked(sendMessage).mock.calls.at(-1)?.[2]);
    expect(text).toContain("1750");
    expect(text).not.toContain("شش شش");
  });

  it("pays nothing when the dice do not match", async () => {
    const db = makeDb();
    // die1 = 1, die2 = 4 -> no reward roll happens
    vi.spyOn(Math, "random").mockReturnValueOnce(0.01).mockReturnValueOnce(0.5);

    await handleDice("token", db, {} as any, fakeMessage(3));

    const groupInsert = db.bindCalls.find((c) => c.sql.includes("INSERT INTO GROUP_MEMBERS"));
    expect(groupInsert!.args[4]).toBe(0);
  });
});

describe("creative meow messages", () => {
  it("substitutes points into a random tier variant", async () => {
    const { tierMessage } = await import("../src/handlers");
    const tier: any = { variants: [`یه داستان گربه‌ای\n+{points} امتیاز`] };
    expect(tierMessage(tier, 123)).toBe(`یه داستان گربه‌ای\n+123 امتیاز`);
  });

  it("uses night variants at night and day variants otherwise", async () => {
    const { tierMessage } = await import("../src/handlers");
    const tier: any = { variants: ["day"], nightVariants: ["night"] };
    expect(tierMessage(tier, 1, 12)).toBe("day");
    expect(tierMessage(tier, 1, 23)).toBe("night");
    expect(tierMessage(tier, 1, 3)).toBe("night");
  });

  it("falls back to a plain meow when a tier has no variants", async () => {
    const { tierMessage } = await import("../src/handlers");
    const tier: any = { variants: [] };
    expect(tierMessage(tier, 50)).toBe(`🐱 میو!\n+50 امتیاز`);
  });

  it("serves creative lines from the cooldown, milestone and fact pools", async () => {
    const { randomCooldownLine, meowMilestoneLine, randomCatFact } = await import("../src/handlers");
    expect(randomCooldownLine()).toContain("{duration}");
    expect(meowMilestoneLine(true, false)).toBeTruthy();
    expect(meowMilestoneLine(false, true)).toBeTruthy();
    expect(meowMilestoneLine(false, false)).toBeNull();
    expect(randomCatFact().length).toBeGreaterThan(0);
  });
});

describe("VIP tier odds", () => {
  const base = [
    { key: "street", chance: 0.55 },
    { key: "lucky", chance: 0.33 },
    { key: "rainbow", chance: 0.085 },
    { key: "legend", chance: 0.025 },
    { key: "king", chance: 0.007 },
    { key: "diamond", chance: 0.0025 },
    { key: "galaxy", chance: 0.0005 },
  ];

  it("leaves non-VIP tiers untouched", async () => {
    const { adjustMeowTierChancesForSpecialUser } = await import("../src/handlers");
    const tiers: any = base.map((t) => ({ ...t }));
    expect(adjustMeowTierChancesForSpecialUser(tiers, 999, "123")).toBe(tiers);
  });

  it("renormalizes VIP chances: bottom tier shrinks, higher tiers grow", async () => {
    const { adjustMeowTierChancesForSpecialUser } = await import("../src/handlers");
    const tiers: any = base.map((t) => ({ ...t }));
    const vip = adjustMeowTierChancesForSpecialUser(tiers, 123, "123");

    const sum = vip.reduce((acc: number, t: any) => acc + t.chance, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(vip[0].chance).toBeLessThan(tiers[0].chance); // street nearly gone
    expect(vip[1].chance).toBeGreaterThan(tiers[1].chance); // lucky dominates
    expect(vip[6].chance).toBeGreaterThan(tiers[6].chance); // galaxy ~2x
    expect(tiers[0].chance).toBe(0.55); // originals untouched
  });
});
