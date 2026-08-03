import { generateDuelId, isValidDuelId } from "./utils";

export interface HokmGameRow {
  game_id: string;
  group_id: number;
  creator_id: number;
  bet: number;
  per_player: number;
  status: "lobby" | "playing" | "ended" | "cancelled";
  board_msg_id: number | null;
  app_url: string | null;
  winner_team: number | null;
  result: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface HokmPlayerRow {
  game_id: string;
  telegram_user_id: number;
  seat: number;
  team: number;
  username: string | null;
  first_name: string;
  paid: number;
  accepted_at: number;
}

export function generateHokmId(): string {
  return generateDuelId();
}

export function isValidHokmGameId(id: string): boolean {
  return isValidDuelId(id);
}

export async function createHokmGame(
  db: D1Database,
  game: {
    gameId: string;
    groupId: number;
    creatorId: number;
    bet: number;
    perPlayer: number;
    boardMsgId: number;
    createdAt: number;
    appUrl?: string;
  }
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO hokm_games (game_id, group_id, creator_id, bet, per_player, board_msg_id, app_url, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'lobby', ?)`
      )
      .bind(game.gameId, game.groupId, game.creatorId, game.bet, game.perPlayer, game.boardMsgId, game.appUrl ?? null, game.createdAt)
      .run();
    return true;
  } catch {
    // Unique partial index (one active game per group) — someone else won the race.
    return false;
  }
}

export async function getHokmGame(db: D1Database, gameId: string): Promise<HokmGameRow | null> {
  const row = await db
    .prepare(
      `SELECT game_id, group_id, creator_id, bet, per_player, status, board_msg_id, app_url, winner_team, result, created_at, started_at, ended_at
       FROM hokm_games WHERE game_id = ?`
    )
    .bind(gameId)
    .first<HokmGameRow>();
  return row ?? null;
}

/** Returns a live (lobby or playing) game for the group, if any. */
export async function getActiveHokmGame(db: D1Database, groupId: number): Promise<HokmGameRow | null> {
  const row = await db
    .prepare(
      `SELECT game_id, group_id, creator_id, bet, per_player, status, board_msg_id, app_url, winner_team, result, created_at, started_at, ended_at
       FROM hokm_games WHERE group_id = ? AND status IN ('lobby', 'playing') ORDER BY created_at DESC LIMIT 1`
    )
    .bind(groupId)
    .first<HokmGameRow>();
  return row ?? null;
}

/**
 * Atomically reserves a seat. Returns false when the seat is already taken,
 * the user already joined, or the game is no longer in lobby. The guarded
 * single-statement INSERT is race-free — concurrent accepts cannot both take
 * the same seat.
 */
export async function addHokmPlayer(
  db: D1Database,
  gameId: string,
  player: { userId: number; username: string | null; firstName: string; seat: number; acceptedAt: number; paid?: number }
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO hokm_game_players (game_id, telegram_user_id, seat, team, username, first_name, paid, accepted_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM hokm_game_players WHERE game_id = ? AND seat = ?)
         AND NOT EXISTS (SELECT 1 FROM hokm_game_players WHERE game_id = ? AND telegram_user_id = ?)
         AND (SELECT status FROM hokm_games WHERE game_id = ?) = 'lobby'`
    )
    .bind(
      gameId, player.userId, player.seat, player.seat % 2, player.username, player.firstName, player.paid ?? 1, player.acceptedAt,
      gameId, player.seat,
      gameId, player.userId,
      gameId
    )
    .run();
  return res.meta.changes > 0;
}

export async function removeHokmPlayer(db: D1Database, gameId: string, userId: number): Promise<void> {
  await db.prepare(`DELETE FROM hokm_game_players WHERE game_id = ? AND telegram_user_id = ?`).bind(gameId, userId).run();
}

/** Reverses a Hokm escrow (full refund to user + group balances with a ledger row). */
export async function refundHokmEscrow(
  db: D1Database,
  groupId: number,
  userId: number,
  amount: number,
  reason = "HOKM_REFUND"
): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, userId),
    db
      .prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(amount, groupId, userId),
    db
      .prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, groupId, amount, reason, Math.floor(Date.now() / 1000)),
  ]);
}

export async function getHokmPlayers(db: D1Database, gameId: string): Promise<HokmPlayerRow[]> {
  const result = await db
    .prepare(
      `SELECT game_id, telegram_user_id, seat, team, username, first_name, paid, accepted_at
       FROM hokm_game_players WHERE game_id = ? ORDER BY seat ASC`
    )
    .bind(gameId)
    .all<HokmPlayerRow>();
  return result.results ?? [];
}

export async function setHokmGameBoardMsg(db: D1Database, gameId: string, msgId: number): Promise<void> {
  await db.prepare(`UPDATE hokm_games SET board_msg_id = ? WHERE game_id = ?`).bind(msgId, gameId).run();
}

/**
 * Atomically moves the game from lobby to playing. Returns false when another
 * concurrent join already started it — callers must treat that as "someone
 * else won the race" and skip the start flow.
 */
export async function setHokmGamePlaying(db: D1Database, gameId: string, startedAt: number): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE hokm_games SET status = 'playing', started_at = ? WHERE game_id = ? AND status = 'lobby'`)
    .bind(startedAt, gameId)
    .run();
  return res.meta.changes > 0;
}

export async function settleHokmMatch(
  db: D1Database,
  gameId: string,
  winnerTeam: number,
  result: string
): Promise<void> {
  const game = await getHokmGame(db, gameId);
  if (!game || game.status === "ended" || game.status === "cancelled") return;

  const players = await getHokmPlayers(db, gameId);
  const now = Math.floor(Date.now() / 1000);
  const reward = Math.floor(game.bet / 2);

  const batch: D1PreparedStatement[] = [];
  for (const p of players) {
    if (p.paid !== 1) continue;
    if (p.seat % 2 === winnerTeam) {
      batch.push(
        db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(reward, p.telegram_user_id),
        db
          .prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
          .bind(reward, game.group_id, p.telegram_user_id),
        db
          .prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(p.telegram_user_id, game.group_id, reward, `HOKM_WIN`, now)
      );
    }
  }
  batch.push(
    db
      .prepare(`UPDATE hokm_games SET status = 'ended', winner_team = ?, result = ?, ended_at = ? WHERE game_id = ?`)
      .bind(winnerTeam, result, now, gameId)
  );

  await db.batch(batch);
}

export async function cancelHokmGame(db: D1Database, gameId: string): Promise<void> {
  const game = await getHokmGame(db, gameId);
  if (!game || game.status === "ended" || game.status === "cancelled") return;

  const players = await getHokmPlayers(db, gameId);
  const now = Math.floor(Date.now() / 1000);

  const batch: D1PreparedStatement[] = [];
  for (const p of players) {
    if (p.paid !== 1) continue;
    batch.push(
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(game.per_player, p.telegram_user_id),
      db
        .prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
        .bind(game.per_player, game.group_id, p.telegram_user_id),
      db
        .prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(p.telegram_user_id, game.group_id, game.per_player, `HOKM_REFUND`, now)
    );
  }
  batch.push(
    db
      .prepare(`UPDATE hokm_games SET status = 'cancelled', result = 'cancelled', ended_at = ? WHERE game_id = ?`)
      .bind(now, gameId)
  );

  await db.batch(batch);
}

/** Stable negative user id for an AI bot seat — never collides with real Telegram ids. */
export function hokmBotUserId(seat: number): number {
  return -(1000 + seat);
}

export function isHokmBotUserId(userId: number): boolean {
  return userId < 0;
}
