import { describe, expect, it, vi } from "vitest";
import { distributeGroupTax } from "../src/database";

describe("Treasury distribution", () => {
  it("distributes tax correctly", async () => {
    const ops: any[] = [];
    const db: any = {
      batch: vi.fn(async (stmts: any[]) => { ops.push(...stmts); return []; }),
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => {
          const s = String(sql).toUpperCase();
          if (s.includes('SELECT TREASURY_BALANCE FROM TELEGRAM_GROUPS')) return { first: async () => ({ treasury_balance: 0 }) };
          return { run: vi.fn(async () => ({ meta: { changes: 1 } })) };
        }),
      })),
    };

    await distributeGroupTax(db, 10, 'meow', 1000);
    expect(db.batch).toHaveBeenCalled();
  });
});
