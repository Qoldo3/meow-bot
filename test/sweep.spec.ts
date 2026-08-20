import { describe, expect, it, vi, afterEach } from "vitest";
import { sweepExpiredDuels } from "../src/sweep";

interface Stmt {
  sql: string;
  bindArgs: unknown[];
}

function makeDb(overrides: { duels?: unknown[] } = {}) {
  const duels = overrides.duels ?? [];
  const statements: Stmt[] = [];

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        const stmt = { sql, bindArgs: args } as Stmt & Record<string, unknown>;
        stmt.all = async () => {
          if (sql.includes("FROM active_duels")) return { results: duels };
          return { results: [] };
        };
        stmt.run = async () => {
          statements.push(stmt);
          return { meta: { changes: 1 } };
        };
        return stmt;
      },
    }),
    batch: async (stmts: Array<{ sql?: string; bindArgs?: unknown[] }>) => {
      statements.push(...(stmts as Stmt[]));
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;

  return { db, statements };
}

describe("sweepExpiredDuels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes expired duels and edits their messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const { db, statements } = makeDb({
      duels: [
        {
          duel_id: "abc123",
          challenger_name: "A",
          target_name: "B",
          amount: 100,
          group_id: 10,
          message_id: 7,
        },
      ],
    });

    const edited = await sweepExpiredDuels(db, "token");
    expect(edited).toBe(1);
    const deletes = statements.filter((s) => s.sql.includes("DELETE FROM active_duels"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].bindArgs[0]).toBe("abc123");
  });

  it("returns 0 when there is nothing expired", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    const { db, statements } = makeDb();
    expect(await sweepExpiredDuels(db, "token")).toBe(0);
    expect(statements).toHaveLength(0);
  });
});
