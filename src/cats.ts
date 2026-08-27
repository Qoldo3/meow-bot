import { sendMessage } from "./telegram";
import { escapeHtml } from "./utils";
import { getGroupMemberBalance } from "./database";
import {
  CAT_ADOPT_COST,
  CAT_BOOST_TIERS,
  CAT_DEFAULT_NAME,
  CAT_LEVEL_CAP,
  CAT_LEVEL_REQ_BASE,
  CAT_NAME_MAX,
} from "./constants";

export type CatState = {
  telegram_group_id: number;
  telegram_user_id: number;
  name: string | null;
  level: number;
  progress: number;
  created_at: number;
  updated_at: number;
};

export type CatNotifyEvents = {
  leveledUp?: number;
};

/** MP needed to fill the progress bar of a cat at the given level. */
export function catLevelRequirement(level: number): number {
  return CAT_LEVEL_REQ_BASE * Math.max(1, level - 1);
}

/**
 * Meow boost multiplier for a cat level. Linear interpolation between the
 * tier points in CAT_BOOST_TIERS (1x at L0 → 1.25x at L1 → 2x at L5 → 3.5x at
 * L10 → 5.5x at L15 → 8x at L20, flat at the cap).
 */
export function catBoostForLevel(level: number): number {
  const tiers = CAT_BOOST_TIERS;
  let i = 0;
  while (i < tiers.length - 1 && level >= tiers[i + 1].level) i++;
  const lo = tiers[i];
  const hi = tiers[i + 1];
  if (!hi || lo.level === hi.level) return lo.cap;
  const t = Math.min(1, Math.max(0, (level - lo.level) / (hi.level - lo.level)));
  return Math.round((lo.cap + (hi.cap - lo.cap) * t) * 100) / 100;
}

/** Unicode progress bar, e.g. [██████░░░░] for 60%. */
export function formatXpBar(pct: number, width = 10): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export async function getCat(db: D1Database, groupId: number, userId: number): Promise<CatState | null> {
  const row = await db
    .prepare(`
      SELECT telegram_group_id, telegram_user_id, name, level, progress, created_at, updated_at
      FROM cats WHERE telegram_group_id = ? AND telegram_user_id = ?
    `)
    .bind(groupId, userId)
    .first<CatState>();
  return row ?? null;
}

/**
 * Debit the user's *group* balance (guarded) and log a transaction.
 * Cat adoption / transfer are group-scoped features — only the group balance
 * (group_members.meow_points) matters.  Poker, blackjack and other games
 * only update the group balance, so checking the global users.meow_points
 * here would incorrectly block users who earned points via games.
 */
async function debitGroupPoints(db: D1Database, groupId: number, userId: number, amount: number, now: number, reason: string): Promise<boolean> {
  const groupBal = await getGroupMemberBalance(db, groupId, userId);
  if (groupBal < amount) return false;

  const debit = await db
    .prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`)
    .bind(amount, groupId, userId, amount)
    .run();
  if (debit.meta.changes === 0) return false;

  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, groupId, -amount, reason, Math.floor(now)).run();
  return true;
}

/** Adopt a cat: pays CAT_ADOPT_COST, starts at Lv.1 with an empty bar. */
export async function adoptCat(db: D1Database, groupId: number, userId: number, name: string | null, now: number): Promise<{ ok: boolean; reason?: "balance"; cat?: CatState }> {
  if (!(await debitGroupPoints(db, groupId, userId, CAT_ADOPT_COST, now, "CAT_ADOPT"))) {
    return { ok: false, reason: "balance" };
  }
  const safeName = (name ?? CAT_DEFAULT_NAME).trim().slice(0, CAT_NAME_MAX) || CAT_DEFAULT_NAME;
  await db
    .prepare(`
      INSERT INTO cats (telegram_group_id, telegram_user_id, name, level, progress, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, ?, ?)
    `)
    .bind(groupId, userId, safeName, Math.floor(now), Math.floor(now))
    .run();
  const cat = await getCat(db, groupId, userId);
  return cat ? { ok: true, cat } : { ok: false, reason: "balance" };
}

/**
 * Add MP to the cat's progress bar, leveling up across thresholds (capped at
 * CAT_LEVEL_CAP).
 */
export async function feedCat(db: D1Database, groupId: number, userId: number, amount: number, now: number): Promise<{ cat: CatState; leveledUp: number }> {
  const existing = await getCat(db, groupId, userId);
  if (!existing) throw new Error("cat not found");

  let level = existing.level;
  let progress = existing.progress + amount;
  let leveledUp = 0;
  while (level < CAT_LEVEL_CAP) {
    const req = catLevelRequirement(level);
    if (progress < req) break;
    progress -= req;
    level++;
    leveledUp++;
  }
  if (level >= CAT_LEVEL_CAP) {
    progress = Math.min(progress, catLevelRequirement(CAT_LEVEL_CAP));
  }

  await db
    .prepare(`
      UPDATE cats SET level = ?, progress = ?, updated_at = ?
      WHERE telegram_group_id = ? AND telegram_user_id = ?
    `)
    .bind(level, progress, Math.floor(now), groupId, userId)
    .run();

  return {
    cat: { ...existing, level, progress, updated_at: Math.floor(now) },
    leveledUp,
  };
}

/** Direct wallet → cat transfer (1:1, no fee). */
export async function transferToCat(
  db: D1Database,
  groupId: number,
  userId: number,
  amount: number,
  now: number
): Promise<{ ok: boolean; reason?: "balance" | "no_cat"; cat?: CatState; leveledUp?: number }> {
  const cat = await getCat(db, groupId, userId);
  if (!cat) return { ok: false, reason: "no_cat" };

  if (!(await debitGroupPoints(db, groupId, userId, amount, now, "CAT_TRANSFER"))) {
    return { ok: false, reason: "balance" };
  }
  const { cat: updatedCat, leveledUp } = await feedCat(db, groupId, userId, amount, now);
  return { ok: true, cat: updatedCat, leveledUp };
}

export async function getTopCats(db: D1Database, groupId: number, limit = 5) {
  return db
    .prepare(`
      SELECT COALESCE(c.name, gm.first_name, 'گربه') AS name, c.level, c.progress
      FROM cats c
      LEFT JOIN group_members gm ON gm.telegram_group_id = c.telegram_group_id AND gm.telegram_user_id = c.telegram_user_id
      WHERE c.telegram_group_id = ?
      ORDER BY c.level DESC, c.progress DESC
      LIMIT ?
    `)
    .bind(groupId, limit)
    .all<{ name: string; level: number; progress: number }>();
}

export function renderCatCard(cat: CatState, boost: number): string {
  const req = catLevelRequirement(cat.level);
  const pct = req > 0 ? Math.min(100, Math.floor((cat.progress / req) * 100)) : 0;
  const name = escapeHtml(cat.name ?? CAT_DEFAULT_NAME);

  return (
    `🐱 <b>${name}</b> — Lv.${cat.level}\n` +
    `بونوس میو: ×${boost}\n\n` +
    `📊 XP: ${cat.progress.toLocaleString("en-US")} / ${req.toLocaleString("en-US")} MP\n` +
    `${formatXpBar(pct)} ${pct}%\n\n` +
    `💡 تغذیه: <code>میو گربه</code> یا <code>انتقال گربه 5000</code>`
  );
}

/**
 * Private-message notifications for cat events (level up). The owner receives
 * a tracking copy when ownerId is provided.
 * Note: PMs only reach users who have started the bot.
 */
export async function notifyCatEvents(
  token: string,
  db: D1Database,
  groupId: number,
  userId: number,
  events: CatNotifyEvents,
  ownerId?: string
): Promise<void> {
  const cat = await getCat(db, groupId, userId);
  if (!cat) return;
  const name = escapeHtml(cat.name ?? CAT_DEFAULT_NAME);
  const boost = catBoostForLevel(cat.level);

  const texts: string[] = [];
  if (events.leveledUp && events.leveledUp > 0) {
    texts.push(`🎉 ${name} به Lv.${cat.level} رسید! بونوس میو حالا ×${boost}`);
  }

  for (const text of texts) {
    await sendMessage(token, userId, text);
    if (ownerId) {
      await sendMessage(token, Number(ownerId), `[گربه گروه ${groupId}] ${text}`);
    }
  }
}