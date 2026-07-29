import { TelegramChat, TelegramUser } from "./types";

export async function ensureUser(db: D1Database, user: TelegramUser) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO users (telegram_id, username, first_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `)
    .bind(user.id, user.username ?? null, user.first_name, now)
    .run();
}

export async function ensureGroup(db: D1Database, chat: TelegramChat) {
  if (chat.type !== "group" && chat.type !== "supergroup") return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO telegram_groups (telegram_group_id, title, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(telegram_group_id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        is_active = 1
    `)
    .bind(chat.id, chat.title ?? "Unknown Group", now, now)
    .run();
}

export async function deactivateGroup(db: D1Database, groupId: number) {
  await db
    .prepare(`UPDATE telegram_groups SET is_active = 0, updated_at = ? WHERE telegram_group_id = ?`)
    .bind(Math.floor(Date.now() / 1000), groupId)
    .run();
}

export async function getGroupSettings(db: D1Database, groupId: number) {
  const row = await db
    .prepare(`SELECT bot_enabled, cooldown_seconds FROM telegram_groups WHERE telegram_group_id = ?`)
    .bind(groupId)
    .first<{ bot_enabled: number; cooldown_seconds: number }>();
  return {
    enabled: row ? row.bot_enabled === 1 : true,
    cooldown: row ? row.cooldown_seconds : 300,
  };
}

export async function getUserStats(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT meow_points, total_meows FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ meow_points: number; total_meows: number }>();
}

export async function getGlobalRank(db: D1Database, userId: number): Promise<number> {
  const result = await db
    .prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users
      WHERE meow_points > (SELECT meow_points FROM users WHERE telegram_id = ?)
    `)
    .bind(userId)
    .first<{ rank: number }>();
  return result?.rank ?? 0;
}

export async function isMaintenanceMode(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
  return row?.value === "1";
}

export async function findUserByUsername(db: D1Database, rawUsername: string) {
  return db
    .prepare(`SELECT telegram_id, first_name FROM users WHERE LOWER(username) = LOWER(?)`)
    .bind(rawUsername)
    .first<{ telegram_id: number; first_name: string }>();
}

export async function findUserById(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT telegram_id, username, first_name, meow_points, total_meows, daily_streak, last_daily_at, created_at FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ telegram_id: number; username: string | null; first_name: string; meow_points: number; total_meows: number; daily_streak: number; last_daily_at: number | null; created_at: number }>();
}

export async function isUserBanned(db: D1Database, userId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT is_banned FROM users WHERE telegram_id = ?`).bind(userId).first<{ is_banned: number }>();
  return row ? row.is_banned === 1 : false;
}

export async function getBotSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setBotSetting(db: D1Database, key: string, value: string) {
  await db.prepare(`INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

export async function getUserTransactions(db: D1Database, userId: number, limit: number = 20) {
  return db
    .prepare(`
      SELECT amount, reason, group_id, created_at
      FROM transactions
      WHERE telegram_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all<{ amount: number; reason: string; group_id: number | null; created_at: number }>();
}

export async function getUserGroupMemberships(db: D1Database, userId: number) {
  return db
    .prepare(`
      SELECT g.title, gm.meow_points, gm.total_meows
      FROM group_members gm
      JOIN telegram_groups g ON g.telegram_group_id = gm.telegram_group_id
      WHERE gm.telegram_user_id = ? AND g.is_active = 1
      ORDER BY gm.meow_points DESC
    `)
    .bind(userId)
    .all<{ title: string; meow_points: number; total_meows: number }>();
}
