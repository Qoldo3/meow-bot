import { describe, expect, it, vi } from "vitest";
import {
  boosterStateUpdate,
  getActiveBoosterMultiplier,
  getBoosterStatus,
  buyBooster,
  sweepBoosters,
} from "../src/database";
import { computeMeowEarnings } from "../src/handlers";

const now = Math.floor(Date.now() / 1000);

function makeBooster(overrides: Partial<Record<string, number>> = {}) {
  return {
    telegram_group_id: 1,
    telegram_user_id: 5,
    active_booster_multiplier: 2,
    active_booster_until: now + 3600,
    booster_paused_at: 0,
    ...overrides,
  };
}

function makeDb(opts: { event?: { start_at: number; end_at: number } | null; booster?: Record<string, number> | null } = {}) {
  let booster = opts.booster ? makeBooster(opts.booster) : null;
  let event = opts.event ?? null;

  const setBooster = (partial: Record<string, number>) => {
    booster = { telegram_group_id: 1, telegram_user_id: 5, ...partial };
  };

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => {
        const s = sql.toUpperCase();
        return {
          first: async () => {
            if (s.includes("FROM EVENTS")) return event;
            if (s.includes("FROM GROUP_MEMBERS")) return booster;
            return null;
          },
          run: async () => {
            if (s.includes("SET ACTIVE_BOOSTER_MULTIPLIER = 0")) {
              setBooster({ active_booster_multiplier: 0, active_booster_until: 0, booster_paused_at: 0 });
            } else if (s.includes("SET ACTIVE_BOOSTER_MULTIPLIER = ?, ACTIVE_BOOSTER_UNTIL = ?, BOOSTER_PAUSED_AT = ?")) {
              setBooster({ active_booster_multiplier: args[0], active_booster_until: args[1], booster_paused_at: args[2] });
            } else if (s.includes("SET ACTIVE_BOOSTER_UNTIL = ?, BOOSTER_PAUSED_AT = 0")) {
              booster = { ...booster!, active_booster_until: args[0], booster_paused_at: 0 };
            } else if (s.includes("SET ACTIVE_BOOSTER_UNTIL = ?, BOOSTER_PAUSED_AT = ?")) {
              booster = { ...booster!, active_booster_until: args[0], booster_paused_at: args[1] };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    }),
    batch: async (stmts: any[]) => {
      for (const st of stmts) {
        if (typeof st.run === "function") await st.run();
      }
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };

  return { db: db as unknown as D1Database, getBooster: () => booster, setEvent: (e: { start_at: number; end_at: number } | null) => (event = e) };
}

describe("boosterStateUpdate (pure transitions)", () => {
  it("leaves a running booster alone when no event is active", () => {
    const { db } = makeDb();
    expect(boosterStateUpdate(db, makeBooster(), null, now)).toBeNull();
  });

  it("pauses when an event starts while the booster is alive", () => {
    const { db } = makeDb();
    const event = { start_at: now - 60, end_at: now + 1800 };
    const update = boosterStateUpdate(db, makeBooster(), event, now);
    expect(update).not.toBeNull();
    expect(update!.state.paused).toBe(true);
    // Time from the event start (60s ago) is not counted.
    expect(update!.state.until).toBe(now + 3600 + 60);
  });

  it("drops a booster that already expired before the event started", () => {
    const { db } = makeDb();
    const event = { start_at: now - 60, end_at: now + 1800 };
    const update = boosterStateUpdate(db, makeBooster({ active_booster_until: now - 100 }), event, now);
    expect(update!.state).toEqual({ alive: false, paused: false, until: 0 });
  });

  it("keeps a paused booster paused while the event runs", () => {
    const { db } = makeDb();
    const event = { start_at: now - 60, end_at: now + 1800 };
    const paused = makeBooster({ booster_paused_at: now - 60 });
    expect(boosterStateUpdate(db, paused, event, now)).toBeNull();
  });

  it("resumes a paused booster once no event is running", () => {
    const { db } = makeDb();
    const paused = makeBooster({ booster_paused_at: now - 3600, active_booster_until: now - 3600 + 1800 });
    const update = boosterStateUpdate(db, paused, null, now);
    expect(update!.state.paused).toBe(false);
    expect(update!.state.alive).toBe(true);
    expect(update!.state.until).toBe(now + 1800);
  });
});

describe("getActiveBoosterMultiplier", () => {
  it("returns 1 for users without a booster", async () => {
    const { db } = makeDb({ booster: null });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(1);
  });

  it("applies the multiplier while running outside events", async () => {
    const { db } = makeDb({ booster: { active_booster_multiplier: 2 } });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(2);
  });

  it("suspends the multiplier while paused during an event", async () => {
    const { db } = makeDb({
      booster: { booster_paused_at: now },
      event: { start_at: now - 60, end_at: now + 1800 },
    });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(1);
  });

  it("pauses a running booster when the event starts, then resumes after it ends", async () => {
    const { db, setEvent, getBooster } = makeDb({
      booster: { active_booster_until: now + 3600 },
    });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(2);

    setEvent({ start_at: now - 60, end_at: now + 1800 });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(1);
    expect(getBooster()!.booster_paused_at).toBeGreaterThan(0);

    setEvent(null);
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(2);
    expect(getBooster()!.booster_paused_at).toBe(0);
  });

  it("drops an expired booster that was dead before the event", async () => {
    const { db, getBooster } = makeDb({
      booster: { active_booster_until: now - 100 },
      event: { start_at: now - 60, end_at: now + 1800 },
    });
    expect(await getActiveBoosterMultiplier(db, 1, 5)).toBe(1);
    expect(getBooster()!.active_booster_multiplier).toBe(0);
  });
});

describe("getBoosterStatus", () => {
  it("reports paused state with frozen remaining time", async () => {
    const { db } = makeDb({
      booster: { booster_paused_at: now, active_booster_until: now + 1800 },
      event: { start_at: now - 60, end_at: now + 1800 },
    });
    const status = await getBoosterStatus(db, 1, 5);
    expect(status?.paused).toBe(true);
    expect(status?.remaining).toBe(1800);
  });

  it("reports running state outside events", async () => {
    const { db } = makeDb({ booster: { active_booster_until: now + 1800 } });
    const status = await getBoosterStatus(db, 1, 5);
    expect(status?.paused).toBe(false);
    expect(status?.multiplier).toBe(2);
  });

  it("returns null once expired", async () => {
    const { db } = makeDb({ booster: { active_booster_until: now - 1 } });
    expect(await getBoosterStatus(db, 1, 5)).toBeNull();
  });
});

describe("buyBooster", () => {
  it("starts paused when bought during an event", async () => {
    const { db, getBooster } = makeDb({ event: { start_at: now - 60, end_at: now + 1800 } });
    const res = await buyBooster(db, 1, 5, 2, 3600, 1000);
    expect(res.success).toBe(true);
    expect(res.paused).toBe(true);
    expect(getBooster()!.booster_paused_at).toBeGreaterThan(0);
    expect(getBooster()!.active_booster_until).toBeGreaterThan(now);
  });

  it("runs immediately when no event is active", async () => {
    const { db, getBooster } = makeDb();
    const res = await buyBooster(db, 1, 5, 2, 3600, 1000);
    expect(res.success).toBe(true);
    expect(res.paused).toBe(false);
    expect(getBooster()!.booster_paused_at).toBe(0);
  });
});

describe("sweepBoosters", () => {
  it("resumes paused boosters once the event is over", async () => {
    const paused = makeBooster({ booster_paused_at: now - 1800, active_booster_until: now - 1800 + 600 });
    const running = makeBooster({ active_booster_until: now + 3600 });

    let rows: Record<string, number>[] = [running, paused];
    const statements: Array<{ sql: string; bindArgs: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => {
        const s = sql.toUpperCase();
        const stmt: Record<string, unknown> = { sql };
        stmt.bind = (...args: unknown[]) => {
          stmt.bindArgs = args;
          return stmt;
        };
        stmt.all = async () => {
          if (s.includes("FROM GROUP_MEMBERS")) return { results: rows };
          return { results: [] };
        };
        stmt.first = async () => {
          if (s.includes("FROM EVENTS")) return null;
          return null;
        };
        stmt.run = async () => {
          statements.push({ sql, bindArgs: (stmt.bindArgs as unknown[]) ?? [] });
          return { meta: { changes: 1 } };
        };
        return stmt;
      },
      batch: async (stmts: any[]) => {
        statements.push(...stmts.map((st: any) => ({ sql: st.sql ?? "", bindArgs: st.bindArgs ?? [] })));
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    } as unknown as D1Database;

    const changed = await sweepBoosters(db);
    expect(changed).toBe(1);
    expect(statements.length).toBe(1);
    // The paused one resumes (until reset, paused_at cleared); the running one
    // is untouched with no event active.
    expect(statements[0].sql.toLowerCase().includes("booster_paused_at = 0")).toBe(true);
  });
});

describe("computeMeowEarnings", () => {
  it("computes EV per meow and per hour from default tier settings", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          first: async () => null,
        }),
      }),
    } as unknown as D1Database;

    const { perMeow, perHour } = await computeMeowEarnings(db);
    expect(perMeow).toBeCloseTo(333.88, 1);
    expect(perHour).toBe(4007);
  });

  it("reflects config overrides (street-only when other chances are zeroed)", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            const key = String(args[0]);
            if (key === "meow_street_min") return { value: "100" };
            if (key === "meow_street_max") return { value: "200" };
            if (key === "meow_street_chance") return { value: "1" };
            if (key.endsWith("_chance")) return { value: "0" };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;

    const { perMeow, perHour } = await computeMeowEarnings(db);
    expect(perMeow).toBe(150);
    expect(perHour).toBe(1800);
  });
});