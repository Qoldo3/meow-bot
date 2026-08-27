import { describe, expect, it, vi } from "vitest";
import {
  catBoostForLevel,
  catLevelRequirement,
  feedCat,
  formatXpBar,
  transferToCat,
  adoptCat,
  CatState,
} from "../src/cats";
import { isMeowCat } from "../src/utils";

const mkCat = (overrides: Partial<CatState> = {}): CatState => ({
  telegram_group_id: 1,
  telegram_user_id: 42,
  name: "ببر",
  level: 3,
  progress: 5000,
  created_at: Math.floor(Date.now() / 1000),
  updated_at: Math.floor(Date.now() / 1000),
  ...overrides,
});

/** D1 mock that routes SELECTs to a provided row and records UPDATE binds. */
function mkDb(cat: CatState | null) {
  const updates: any[] = [];
  const db: any = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => {
        if (String(sql).includes("SELECT telegram_group_id, telegram_user_id")) {
          return { first: async () => cat };
        }
        if (String(sql).includes("SELECT meow_points FROM users")) {
          return { first: async () => ({ meow_points: 1_000_000 }) };
        }
        if (String(sql).includes("SELECT meow_points FROM group_members")) {
          return { first: async () => ({ meow_points: 1_000_000 }) };
        }
        updates.push({ sql: String(sql), args });
        return { run: vi.fn(async () => ({ meta: { changes: 1 } })) };
      }),
    })),
    batch: vi.fn(async (stmts: any[]) => stmts.map(() => ({ meta: { changes: 1 } }))),
  };
  return { db, updates };
}

describe("catLevelRequirement", () => {
  it("uses the base requirement for levels 0-2 and scales from there", () => {
    expect(catLevelRequirement(0)).toBe(10_000);
    expect(catLevelRequirement(1)).toBe(10_000);
    expect(catLevelRequirement(2)).toBe(10_000);
    expect(catLevelRequirement(3)).toBe(20_000);
    expect(catLevelRequirement(10)).toBe(90_000);
    expect(catLevelRequirement(20)).toBe(190_000);
  });
});

describe("catBoostForLevel", () => {
  it("hits the tier caps exactly", () => {
    expect(catBoostForLevel(0)).toBe(1.0);
    expect(catBoostForLevel(1)).toBe(1.25);
    expect(catBoostForLevel(5)).toBe(2.0);
    expect(catBoostForLevel(10)).toBe(3.5);
    expect(catBoostForLevel(15)).toBe(5.5);
    expect(catBoostForLevel(20)).toBe(8.0);
  });

  it("interpolates linearly between tier points", () => {
    expect(catBoostForLevel(3)).toBe(1.63); // 1.25 → 2.0 across 1..5
    expect(catBoostForLevel(7)).toBe(2.6); // 2.0 → 3.5 across 5..10
    expect(catBoostForLevel(17)).toBe(6.5); // 5.5 → 8.0 across 15..20
  });

  it("caps at 8x beyond level 20", () => {
    expect(catBoostForLevel(25)).toBe(8.0);
    expect(catBoostForLevel(99)).toBe(8.0);
  });
});

describe("formatXpBar", () => {
  it("renders full, empty and partial bars", () => {
    expect(formatXpBar(0)).toBe("░".repeat(10));
    expect(formatXpBar(100)).toBe("█".repeat(10));
    expect(formatXpBar(50)).toBe("█████░░░░░");
    expect(formatXpBar(60)).toBe("██████░░░░");
    expect(formatXpBar(-5)).toBe("░".repeat(10));
    expect(formatXpBar(150)).toBe("█".repeat(10));
  });
});

describe("feedCat", () => {
  it("fills progress and levels up across thresholds", async () => {
    const cat = mkCat({ level: 1, progress: 0 });
    const { db } = mkDb(cat);
    const { cat: updated, leveledUp } = await feedCat(db, 1, 42, 25_000, cat.updated_at + 60);
    expect(leveledUp).toBe(2); // 10k → L2, 10k → L3, 5k left
    expect(updated.level).toBe(3);
    expect(updated.progress).toBe(5_000);
  });

  it("caps the level and the progress bar at level 20", async () => {
    const cat = mkCat({ level: 20, progress: 190_000 });
    const { db } = mkDb(cat);
    const { cat: updated, leveledUp } = await feedCat(db, 1, 42, 50_000, cat.updated_at + 60);
    expect(leveledUp).toBe(0);
    expect(updated.level).toBe(20);
    expect(updated.progress).toBe(190_000);
  });

  it("keeps existing progress when feeding again", async () => {
    const cat = mkCat({ level: 2, progress: 4_000 });
    const { db } = mkDb(cat);
    const { cat: updated, leveledUp } = await feedCat(db, 1, 42, 5_000, cat.updated_at + 60);
    expect(leveledUp).toBe(0);
    expect(updated.level).toBe(2);
    expect(updated.progress).toBe(9_000);
  });
});

describe("adoptCat / transferToCat", () => {
  it("debits the adoption cost and inserts the cat", async () => {
    const { db, updates } = mkDb(mkCat({ name: "پشمالو" }));
    const now = Math.floor(Date.now() / 1000);
    const result = await adoptCat(db, 1, 42, "پشمالو", now);
    expect(result.ok).toBe(true);
    expect(updates.some((u) => u.sql.includes("group_members") && u.sql.includes("meow_points -"))).toBe(true);
    expect(updates.some((u) => u.sql.includes("INSERT INTO cats"))).toBe(true);
  });

  it("rejects adoption when the balance is too low", async () => {
    const cat = null;
    const db: any = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => {
          if (String(sql).includes("SELECT meow_points FROM group_members")) {
            return { first: async () => ({ meow_points: 100 }) };
          }
          return { first: async () => ({ meow_points: 100 }) };
        }),
      })),
    };
    const result = await adoptCat(db, 1, 42, null, Math.floor(Date.now() / 1000));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("balance");
  });

  it("feeds the cat on a direct transfer", async () => {
    const cat = mkCat({ level: 1, progress: 0 });
    const { db } = mkDb(cat);
    const result = await transferToCat(db, 1, 42, 15_000, cat.updated_at + 60);
    expect(result.ok).toBe(true);
    expect(result.leveledUp).toBe(1);
    expect(result.cat?.level).toBe(2);
    expect(result.cat?.progress).toBe(5_000);
  });

  it("rejects a transfer without a cat", async () => {
    const { db } = mkDb(null);
    const result = await transferToCat(db, 1, 42, 1_000, Math.floor(Date.now() / 1000));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_cat");
  });
});

describe("isMeowCat", () => {
  it("recognizes the feed command but not plain meows", () => {
    expect(isMeowCat("میو گربه")).toBe(true);
    expect(isMeowCat("meow cat")).toBe(true);
    expect(isMeowCat("میوگربه")).toBe(true);
    expect(isMeowCat("/میو گربه")).toBe(true);
    expect(isMeowCat("میو")).toBe(false);
    expect(isMeowCat("meow")).toBe(false);
    expect(isMeowCat("میو گربه 5")).toBe(false);
    expect(isMeowCat("میو میو")).toBe(false);
  });
});