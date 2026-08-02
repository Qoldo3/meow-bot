import { describe, expect, it, vi } from "vitest";
import { purchaseLotteryTickets, drawLotteryRound, startLotteryRound, calculateLotteryPayouts } from "../src/database";

// Note: these tests use simple mocked DB objects to validate control flow and SQL calls.

describe("Lottery flow", () => {
  it("starts a new round", async () => {
    const db: any = {
      batch: vi.fn(async (stmts: any[]) => []),
      prepare: vi.fn((sql: string) => {
        return {
          bind: (..._args: any[]) => {
            const s = sql.toUpperCase();
            if (s.includes('COALESCE(MAX(ROUND_NUMBER)')) return { sql, first: async () => ({ max_round: 0 }) };
            if (s.includes('SELECT LOTTERY_TICKET_PRICE')) return { sql, first: async () => ({ lottery_ticket_price: 150 }) };
            if (s.includes('INSERT INTO LOTTERY_ROUNDS')) return { sql, run: async () => ({ meta: { last_row_id: 7 } }) };
            if (s.includes('SELECT TREASURY_BALANCE FROM TELEGRAM_GROUPS')) return { sql, first: async () => ({ treasury_balance: 0 }) };
            return { sql, run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
          }
        };
      })
    };

    const id = await startLotteryRound(db, 1, 150, 75);
    expect(id).toBe(7);
    expect(db.prepare).toHaveBeenCalled();
  });

  it("uses a clear tiered payout structure for 3-match wins", () => {
    const payouts = calculateLotteryPayouts(16000, {
      3: [{ ticketId: 1, userId: 100, numbers: "1,2,3,4,5,6", displayName: "Ali" }],
    });

    expect(payouts.totalPaid).toBe(3200);
    expect(payouts.payouts[0]).toMatchObject({ matchCount: 3, amount: 3200, displayName: "Ali" });
  });

  it("purchase fails with insufficient funds", async () => {
    const db: any = {
      batch: vi.fn(async (stmts: any[]) => {
        // if first statement is a guarded deduction, simulate insufficient funds by returning 0 changes for it
        const firstSql = String(stmts[0]?.sql || stmts[0]?.toString || '').toUpperCase();
        if (firstSql.includes('UPDATE GROUP_MEMBERS SET MEOW_POINTS = MEOW_POINTS -')) {
          const res = stmts.map(() => ({ meta: { changes: 1 } }));
          res[0] = { meta: { changes: 0 } };
          return res;
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      }),
      prepare: vi.fn((sql: string) => {
        return {
          bind: (..._args: any[]) => {
            const s = sql.toUpperCase();
            if (s.includes("FROM LOTTERY_ROUNDS WHERE TELEGRAM_GROUP_ID")) return { sql, first: async () => null };
            if (s.includes("SELECT COALESCE(MAX(ROUND_NUMBER)")) return { sql, first: async () => ({ max_round: 0 }) };
            if (s.includes('SELECT LOTTERY_TICKET_PRICE')) return { sql, first: async () => ({ lottery_ticket_price: 100 }) };
            if (s.includes("UPDATE GROUP_MEMBERS SET MEOW_POINTS = MEOW_POINTS -")) return { sql, run: async () => ({ meta: { changes: 0 } }) };
            if (s.includes('INSERT INTO LOTTERY_ROUNDS')) return { sql, run: async () => ({ meta: { last_row_id: 9 } }) };
            if (s.includes('SELECT ID, TICKET_PRICE FROM LOTTERY_ROUNDS WHERE ID')) return { sql, first: async () => ({ id: 9, ticket_price: 100 }) };
            if (s.includes('SELECT TREASURY_BALANCE FROM TELEGRAM_GROUPS')) return { sql, first: async () => ({ treasury_balance: 0 }) };
            return { sql, run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) };
          }
        };
      })
    };

    const res = await purchaseLotteryTickets(db, 1, 1000, 1);
    expect(res.success).toBe(false);
    expect(res.reason).toBe('insufficient_funds');
  });

});
