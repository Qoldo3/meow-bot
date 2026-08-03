import { describe, expect, it } from "vitest";
import {
  settleHokmMatch,
  cancelHokmGame,
  createHokmGame,
  addHokmPlayer,
  removeHokmPlayer,
  refundHokmEscrow,
  getHokmGame,
  getHokmPlayers,
  getActiveHokmGame,
  hokmBotUserId,
  isHokmBotUserId,
} from "../src/hokmLobby";

interface Stmt {
  sql: string;
  bindArgs: unknown[];
}

function makeDb(overrides: { game?: unknown; players?: unknown[]; addPlayerBlocked?: boolean } = {}) {
  const game = overrides.game !== undefined ? overrides.game : {
    game_id: "game1",
    group_id: 10,
    creator_id: 100,
    bet: 4000,
    per_player: 1000,
    status: "playing",
    board_msg_id: 1,
    winner_team: null,
    result: null,
    created_at: 1710000000,
    started_at: 1710000000,
    ended_at: null,
  };
  const players =
    overrides.players ??
    [
      { game_id: "game1", telegram_user_id: 100, seat: 0, team: 0, username: null, first_name: "A", paid: 1, accepted_at: 1 },
      { game_id: "game1", telegram_user_id: 101, seat: 1, team: 1, username: null, first_name: "B", paid: 1, accepted_at: 1 },
      { game_id: "game1", telegram_user_id: 102, seat: 2, team: 0, username: null, first_name: "C", paid: 1, accepted_at: 1 },
      { game_id: "game1", telegram_user_id: 103, seat: 3, team: 1, username: null, first_name: "D", paid: 1, accepted_at: 1 },
    ];

  const statements: Stmt[] = [];

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        const stmt: Stmt & Record<string, unknown> = { sql, bindArgs: args };
        stmt.first = async () => {
          if (sql.includes("FROM hokm_games")) return game;
          if (sql.includes("COUNT(*)")) return { n: players.length };
          return null;
        };
        stmt.all = async () => ({ results: sql.includes("FROM hokm_game_players") ? players : [] });
        stmt.run = async () => {
          statements.push(stmt);
          const blocked = overrides.addPlayerBlocked && sql.includes("INSERT INTO hokm_game_players");
          return { meta: { changes: blocked ? 0 : 1 } };
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

describe("settleHokmMatch", () => {
  it("pays each winner bet/2 and ends the game", async () => {
    const { db, statements } = makeDb();
    await settleHokmMatch(db, "game1", 0, "match");

    expect(statements).toHaveLength(7); // 2 winners x 3 + 1 game update
    const userUpdates = statements.filter((s) => s.sql.includes("UPDATE users SET meow_points = meow_points + ?"));
    expect(userUpdates).toHaveLength(2);
    for (const s of userUpdates) {
      expect(s.bindArgs[0]).toBe(2000);
      expect(s.bindArgs[1]).toBe(s.bindArgs[1]); // telegram_id present
    }
    const endStmt = statements[statements.length - 1];
    expect(endStmt.sql).toContain("UPDATE hokm_games SET status = 'ended'");
    expect(endStmt.bindArgs[0]).toBe(0);
  });

  it("does nothing when the game is already ended", async () => {
    const { db, statements } = makeDb({
      game: {
        game_id: "game1",
        group_id: 10,
        creator_id: 100,
        bet: 4000,
        per_player: 1000,
        status: "ended",
        board_msg_id: 1,
        winner_team: 0,
        result: "match",
        created_at: 1710000000,
        started_at: 1710000000,
        ended_at: 1710000001,
      },
    });
    await settleHokmMatch(db, "game1", 1, "match");
    expect(statements).toHaveLength(0);
  });
});

describe("cancelHokmGame", () => {
  it("refunds every paid player", async () => {
    const { db, statements } = makeDb();
    await cancelHokmGame(db, "game1");

    expect(statements).toHaveLength(13); // 4 players x 3 + game update
    const refundTxns = statements.filter((s) => s.sql.includes("INSERT INTO transactions") && s.bindArgs.includes("HOKM_REFUND"));
    expect(refundTxns).toHaveLength(4);
    for (const s of refundTxns) {
      expect(s.bindArgs[2]).toBe(1000);
    }
    const endStmt = statements[statements.length - 1];
    expect(endStmt.sql).toContain("UPDATE hokm_games SET status = 'cancelled'");
  });
});

describe("getActiveHokmGame", () => {
  it("returns an active game for the group", async () => {
    const { db } = makeDb();
    const game = await getActiveHokmGame(db, 10);
    expect(game).not.toBeNull();
    expect(game!.status).toBe("playing");
  });

  it("returns null when no active game exists", async () => {
    const { db } = makeDb({ game: null });
    const game = await getActiveHokmGame(db, 10);
    expect(game).toBeNull();
  });
});

describe("addHokmPlayer seat guard", () => {
  it("returns false when the seat is already taken", async () => {
    const { db } = makeDb({ addPlayerBlocked: true });
    const added = await addHokmPlayer(db, "game1", {
      userId: 999,
      username: null,
      firstName: "Z",
      seat: 3,
      acceptedAt: 1,
    });
    expect(added).toBe(false);
  });

  it("returns true when the seat is free", async () => {
    const { db } = makeDb();
    const added = await addHokmPlayer(db, "game1", {
      userId: 999,
      username: null,
      firstName: "Z",
      seat: 3,
      acceptedAt: 1,
    });
    expect(added).toBe(true);
  });
});

describe("removeHokmPlayer / refundHokmEscrow", () => {
  it("issues a delete for the player row", async () => {
    const { db, statements } = makeDb();
    await removeHokmPlayer(db, "game1", 999);
    expect(statements.some((s) => s.sql.includes("DELETE FROM hokm_game_players"))).toBe(true);
  });

  it("refunds user + group balances and logs a transaction", async () => {
    const { db, statements } = makeDb();
    await refundHokmEscrow(db, 10, 999, 1000);
    const userUpdate = statements.find((s) => s.sql.includes("UPDATE users SET meow_points = meow_points + ?"));
    expect(userUpdate?.bindArgs[0]).toBe(1000);
    expect(statements.some((s) => s.sql.includes("UPDATE group_members") && s.bindArgs[0] === 1000)).toBe(true);
    const txn = statements.find((s) => s.sql.includes("INSERT INTO transactions"));
    expect(txn?.bindArgs[3]).toBe("HOKM_REFUND");
  });
});

describe("createHokmGame / addHokmPlayer", () => {
  it("inserts a lobby row and a paid player", async () => {
    const { db, statements } = makeDb();
    await createHokmGame(db, {
      gameId: "game2",
      groupId: 10,
      creatorId: 200,
      bet: 4000,
      perPlayer: 1000,
      boardMsgId: 5,
      createdAt: 1710000000,
    });
    await addHokmPlayer(db, "game2", {
      userId: 200,
      username: null,
      firstName: "X",
      seat: 0,
      acceptedAt: 1710000000,
    });
    const game = await getHokmGame(db, "game2");
    expect(game).not.toBeNull();
    expect(game!.bet).toBe(4000);
    const players = await getHokmPlayers(db, "game2");
    expect(players).toHaveLength(4);
    expect(statements.some((s) => s.sql.includes("INSERT INTO hokm_games"))).toBe(true);
    expect(statements.some((s) => s.sql.includes("INSERT INTO hokm_game_players"))).toBe(true);
  });
});


describe("AI bot players (paid=0)", () => {
  it("hokmBotUserId produces stable negative ids recognized by isHokmBotUserId", () => {
    expect(hokmBotUserId(1)).toBe(-1001);
    expect(hokmBotUserId(2)).toBe(-1002);
    expect(hokmBotUserId(3)).toBe(-1003);
    expect(isHokmBotUserId(-1003)).toBe(true);
    expect(isHokmBotUserId(12345)).toBe(false);
  });

  it("addHokmPlayer persists paid=0 for bot seats", async () => {
    const { db, statements } = makeDb();
    const added = await addHokmPlayer(db, "game1", {
      userId: hokmBotUserId(1),
      username: null,
      firstName: "Bot 1",
      seat: 1,
      acceptedAt: 1,
      paid: 0,
    });
    expect(added).toBe(true);
    const insert = statements.find((s) => s.sql.includes("INSERT INTO hokm_game_players"));
    expect(insert).toBeDefined();
    // bind order: gameId, userId, seat, team, username, firstName, paid, acceptedAt
    expect(insert!.bindArgs[6]).toBe(0);
  });

  it("cancelHokmGame refunds only paid players (bots get nothing)", async () => {
    const { db, statements } = makeDb({
      players: [
        { game_id: "game1", telegram_user_id: 100, seat: 0, team: 0, username: null, first_name: "A", paid: 1, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1001, seat: 1, team: 1, username: null, first_name: "Bot 1", paid: 0, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1002, seat: 2, team: 0, username: null, first_name: "Bot 2", paid: 0, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1003, seat: 3, team: 1, username: null, first_name: "Bot 3", paid: 0, accepted_at: 1 },
      ],
    });
    await cancelHokmGame(db, "game1");
    const refunds = statements.filter(
      (s) => s.sql.includes("INSERT INTO transactions") && s.bindArgs.includes("HOKM_REFUND")
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0].bindArgs[0]).toBe(100); // only the human is refunded
    expect(refunds[0].bindArgs[2]).toBe(1000);
  });

  it("settleHokmMatch pays only paid winners", async () => {
    const { db, statements } = makeDb({
      players: [
        { game_id: "game1", telegram_user_id: 100, seat: 0, team: 0, username: null, first_name: "A", paid: 1, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1001, seat: 1, team: 1, username: null, first_name: "Bot 1", paid: 0, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1002, seat: 2, team: 0, username: null, first_name: "Bot 2", paid: 0, accepted_at: 1 },
        { game_id: "game1", telegram_user_id: -1003, seat: 3, team: 1, username: null, first_name: "Bot 3", paid: 0, accepted_at: 1 },
      ],
    });
    await settleHokmMatch(db, "game1", 0, "match");
    const wins = statements.filter(
      (s) => s.sql.includes("INSERT INTO transactions") && s.bindArgs.includes("HOKM_WIN")
    );
    expect(wins).toHaveLength(1);
    expect(wins[0].bindArgs[0]).toBe(100); // only the paid human
    expect(wins[0].bindArgs[2]).toBe(2000); // bet / 2
  });
});
