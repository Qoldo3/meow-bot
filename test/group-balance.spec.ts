import { describe, expect, it } from "vitest";
import { getGroupMemberBalance } from "../src/database";

describe("getGroupMemberBalance", () => {
  it("returns the balance for the specified group member", async () => {
    let boundArgs: unknown[] = [];

    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          boundArgs = args;
          return {
            first: async () => ({ meow_points: 42 }),
          };
        },
      }),
    } as unknown as D1Database;

    await expect(getGroupMemberBalance(db, 12345, 67890)).resolves.toBe(42);
    expect(boundArgs).toEqual([12345, 67890]);
  });
});
