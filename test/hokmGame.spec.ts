import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addHokmPlayer,
  createHokmGame,
  hokmBotUserId,
  setHokmGamePlaying,
} from "../src/hokmLobby";

// The vitest pool does not apply D1 migrations automatically, so create just
// the tables the HokmGame Durable Object touches.
beforeAll(async () => {
  // The vitest pool does not apply D1 migrations automatically, so create
  // just the tables the HokmGame Durable Object touches.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS hokm_games (game_id TEXT PRIMARY KEY, group_id INTEGER NOT NULL, creator_id INTEGER NOT NULL, bet INTEGER NOT NULL, per_player INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'lobby', board_msg_id INTEGER, winner_team INTEGER, result TEXT, created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER, app_url TEXT)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS hokm_game_players (game_id TEXT NOT NULL, telegram_user_id INTEGER NOT NULL, seat INTEGER NOT NULL, team INTEGER NOT NULL, username TEXT, first_name TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, accepted_at INTEGER NOT NULL, PRIMARY KEY (game_id, telegram_user_id))"
  );
});

// Mirrors the practice-mode flow in handlers.ts: one human + three AI bots
// (paid=0, so no escrow is involved for the bots).
async function seedPracticeGame(gameId: string, groupId = 10): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await createHokmGame(env.DB, {
    gameId,
    groupId,
    creatorId: 100,
    bet: 4000,
    perPlayer: 1000,
    boardMsgId: 1,
    appUrl: "https://example.com",
    createdAt: now,
  });
  await addHokmPlayer(env.DB, gameId, {
    userId: 100,
    username: null,
    firstName: "Human",
    seat: 0,
    acceptedAt: now,
  });
  for (let seat = 1; seat <= 3; seat++) {
    await addHokmPlayer(env.DB, gameId, {
      userId: hokmBotUserId(seat),
      username: null,
      firstName: `Bot ${seat}`,
      seat,
      acceptedAt: now,
      paid: 0,
    });
  }
  await setHokmGamePlaying(env.DB, gameId, now);
}

interface BotGameHandle {
  g: {
    phase: string;
    seats: Array<{ userId: number } | null>;
  } | null;
  connectedSeats(): number[];
  isBot(seat: number): boolean;
  turnDeadlineFor(seat: number): number;
  checkAllJoined(): Promise<void>;
}
describe("HokmGame DO - practice mode with AI bots", () => {
  it("loads bot seats, counts them connected, gives bots short deadlines", async () => {
    const gameId = "bot-game-1";
    await seedPracticeGame(gameId);

    const stub = env.HOKM_GAME.get(env.HOKM_GAME.idFromName(gameId));
    await runInDurableObject(stub, async (instance) => {
      const inst = instance as unknown as BotGameHandle & { load(gameId?: string): Promise<void> };
      await inst.load(gameId);
      expect(inst.g).not.toBeNull();
      expect(inst.g!.phase).toBe("waiting_join");
      // Seat 0 is the human; seats 1-3 are the AI bots.
      expect(inst.g!.seats.map((s) => s?.userId)).toEqual([100, -1001, -1002, -1003]);

      // Bot seats count as connected even with no websocket open.
      expect(inst.connectedSeats()).toEqual([1, 2, 3]);

      expect(inst.isBot(0)).toBe(false);
      expect(inst.isBot(1)).toBe(true);
      expect(inst.isBot(3)).toBe(true);

      // Bots act after the short engine delay; humans get the full turn timeout.
      const humanDeadline = inst.turnDeadlineFor(0) - Date.now();
      const botDeadline = inst.turnDeadlineFor(1) - Date.now();
      expect(humanDeadline).toBeGreaterThan(5000);
      expect(botDeadline).toBeLessThan(5000);

      // With the human seat not connected, the match must not start yet.
      await inst.checkAllJoined();
      expect(inst.g!.phase).toBe("waiting_join");
    });
  });
});
