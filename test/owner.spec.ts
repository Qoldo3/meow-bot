import { describe, expect, it, vi } from "vitest";
import { parseReplyAction } from "../src/utils";
import { escapeLike, searchUsers } from "../src/database";
import { resolveUserByIdOrUsername, computeConfigValue, validateConfigPair } from "../src/owner";

describe("parseReplyAction", () => {
  it("accepts Persian digits for افزودن", () => {
    expect(parseReplyAction("افزودن ۱۰۰")).toEqual({ kind: "add", amount: 100 });
  });

  it("accepts Arabic digits for افزودن", () => {
    expect(parseReplyAction("افزودن ٥٠")).toEqual({ kind: "add", amount: 50 });
  });

  it("accepts Persian digits for +", () => {
    expect(parseReplyAction("+۱۲۳۴")).toEqual({ kind: "add", amount: 1234 });
  });

  it("accepts Persian digits for کسر", () => {
    expect(parseReplyAction("کسر ۱۵۰")).toEqual({ kind: "remove", amount: 150 });
  });

  it("accepts Persian digits for -", () => {
    expect(parseReplyAction("-۲۰")).toEqual({ kind: "remove", amount: 20 });
  });

  it("still accepts ASCII digits", () => {
    expect(parseReplyAction("افزودن 100")).toEqual({ kind: "add", amount: 100 });
  });

  it("recognizes اطلاعات", () => {
    expect(parseReplyAction("اطلاعات")).toEqual({ kind: "userinfo", amount: null });
  });

  it("returns null for garbage", () => {
    expect(parseReplyAction("hello")).toBeNull();
    expect(parseReplyAction("")).toBeNull();
  });
});

describe("resolveUserByIdOrUsername", () => {
  function dbWith(byId: any, byUsername: any) {
    return {
      prepare: vi.fn((sql: string) => ({
        bind: (..._args: any[]) => {
          const s = sql.toUpperCase();
          if (s.includes("WHERE LOWER(USERNAME)")) return { first: async () => byUsername };
          if (s.includes("FROM USERS WHERE TELEGRAM_ID")) return { first: async () => byId };
          return { first: async () => null };
        },
      })),
    };
  }

  it("resolves by numeric ID", async () => {
    const user = { telegram_id: 5, username: "ali", first_name: "Ali", meow_points: 100, total_meows: 2, created_at: 1 };
    const db: any = dbWith(user, null);
    const res = await resolveUserByIdOrUsername(db, "5");
    expect(res.byId).toBe(true);
    expect(res.user).toEqual(user);
  });

  it("resolves by Persian-digit ID", async () => {
    const user = { telegram_id: 5, username: "ali", first_name: "Ali", meow_points: 100, total_meows: 2, created_at: 1 };
    const db: any = dbWith(user, null);
    const res = await resolveUserByIdOrUsername(db, "۵");
    expect(res.byId).toBe(true);
    expect(res.user?.telegram_id).toBe(5);
  });

  it("resolves by @username and returns full profile", async () => {
    const user = { telegram_id: 5, username: "ali", first_name: "Ali", meow_points: 100, total_meows: 2, created_at: 1 };
    const db: any = dbWith(user, { telegram_id: 5, first_name: "Ali" });
    const res = await resolveUserByIdOrUsername(db, "@ALI");
    expect(res.byId).toBe(false);
    expect(res.user?.meow_points).toBe(100);
  });

  it("returns null when not found", async () => {
    const db: any = dbWith(null, null);
    const res = await resolveUserByIdOrUsername(db, "999999");
    expect(res.user).toBeNull();
  });
});

describe("searchUsers", () => {
  it("escapes LIKE wildcards and binds fuzzy query", async () => {
    expect(escapeLike("100%_")).toBe("100\\%\\_");
    expect(escapeLike("plain")).toBe("plain");

    const db: any = {
      prepare: vi.fn((sql: string) => ({
        bind: (...args: any[]) => ({
          all: async () => ({ results: [{ telegram_id: 1, first_name: "Ali", username: "ali" }] }),
          _args: args,
        }),
      })),
    };

    const res = await searchUsers(db, "ali", 10);
    expect(res.results[0]?.first_name).toBe("Ali");
    const sql = String(db.prepare.mock.calls[0][0]).toUpperCase();
    expect(sql).toContain("ESCAPE");
    expect(sql).toContain("LIKE ?");
  });
});

describe("config editor", () => {
  const intSetting = { key: "cooldown_seconds", type: "int" as const };
  const floatSetting = { key: "meow_street_chance", type: "float" as const };
  const minSetting = { key: "meow_amount_min", type: "int" as const };
  const maxSetting = { key: "meow_amount_max", type: "int" as const };

  it("adds to an int setting", () => {
    expect(computeConfigValue(intSetting, "10", 5)).toEqual({ value: 15 });
  });

  it("clamps int at 0", () => {
    expect(computeConfigValue(intSetting, "3", -10)).toEqual({ value: 0 });
  });

  it("rounds float to 4 decimals", () => {
    expect(computeConfigValue(floatSetting, "0.5", 0.33333)).toEqual({ value: 0.8333 });
  });

  it("clamps chance floats to [0,1]", () => {
    expect(computeConfigValue(floatSetting, "0.9", 1)).toEqual({ value: 1 });
    expect(computeConfigValue(floatSetting, "0.1", -5)).toEqual({ value: 0 });
  });

  it("rejects min > max", () => {
    expect(validateConfigPair(minSetting.key, 200, maxSetting.key, 100)).toContain(">");
  });

  it("rejects max < min", () => {
    expect(validateConfigPair(maxSetting.key, 50, minSetting.key, 100)).toContain("<");
  });

  it("accepts a valid pair", () => {
    expect(validateConfigPair(minSetting.key, 50, maxSetting.key, 100)).toBeNull();
    expect(validateConfigPair(maxSetting.key, 100, minSetting.key, 50)).toBeNull();
  });

  it("ignores non-pair keys", () => {
    expect(validateConfigPair("cooldown_seconds", 5, "other", 3)).toBeNull();
  });
});