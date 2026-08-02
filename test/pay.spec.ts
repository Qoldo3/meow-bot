import { describe, expect, it } from "vitest";
import { applyPayTransfer } from "../src/database";

describe("applyPayTransfer", () => {
  it("updates both user balances and group leaderboard rows for a group transfer", async () => {
    let batchSize = 0;
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (sql.includes("SELECT meow_points FROM users") || sql.includes("SELECT meow_points FROM group_members")) {
              return { meow_points: 100 };
            }
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
      batch: async (statements: Array<{ sql?: string }>) => {
        batchSize = statements.length;
        return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    const ok = await applyPayTransfer(db, 1, 2, 99, 10, 1710000000);

    expect(ok).toBe(true);
    expect(batchSize).toBeGreaterThan(0);
  });
});
