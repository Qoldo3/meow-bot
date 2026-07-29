import { DuelState } from "./types";
import { DUEL_TIMEOUT_SEC } from "./constants";
import { telegramRequest } from "./telegram";

export async function createDuel(db: D1Database, duel: DuelState): Promise<void> {
  await db.prepare(`
    INSERT INTO active_duels (duel_id, challenger_id, challenger_name, target_id, target_name, amount, group_id, message_id, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(duel.id, duel.challengerId, duel.challengerName, duel.targetId, duel.targetName, duel.amount, duel.groupId, duel.messageId, duel.createdAt).run();
}

export async function getDuel(db: D1Database, duelId: string): Promise<DuelState | null> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`DELETE FROM active_duels WHERE status = 'pending' AND created_at < ?`).bind(now - DUEL_TIMEOUT_SEC).run();

  const row = await db.prepare(`
    SELECT duel_id, challenger_id, challenger_name, target_id, target_name, amount, group_id, message_id, created_at
    FROM active_duels WHERE duel_id = ? AND status = 'pending'
  `).bind(duelId).first<{
    duel_id: string; challenger_id: number; challenger_name: string;
    target_id: number; target_name: string; amount: number;
    group_id: number; message_id: number; created_at: number;
  }>();

  if (!row) return null;
  return {
    id: row.duel_id,
    challengerId: row.challenger_id,
    challengerName: row.challenger_name,
    targetId: row.target_id,
    targetName: row.target_name,
    amount: row.amount,
    groupId: row.group_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

export async function deleteDuel(db: D1Database, duelId: string): Promise<void> {
  await db.prepare(`DELETE FROM active_duels WHERE duel_id = ?`).bind(duelId).run();
}

export async function findOpenDuelAgainst(db: D1Database, groupId: number, targetId: number): Promise<string | undefined> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`DELETE FROM active_duels WHERE status = 'pending' AND created_at < ?`).bind(now - DUEL_TIMEOUT_SEC).run();

  const row = await db.prepare(`
    SELECT duel_id FROM active_duels
    WHERE group_id = ? AND target_id = ? AND status = 'pending'
    LIMIT 1
  `).bind(groupId, targetId).first<{ duel_id: string }>();
  return row?.duel_id;
}

export async function scheduleDuelTimeout(
  c: any,
  token: string,
  db: D1Database,
  duelId: string
) {
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(async () => {
      try {
        const duel = await getDuel(db, duelId);
        if (!duel) {
          resolve();
          return;
        }

        await deleteDuel(db, duelId);
        await telegramRequest(token, "editMessageText", {
          chat_id: duel.groupId,
          message_id: duel.messageId,
          text:
            `⏱️ <b>دعوا منقضی شد!</b>
` +
            `🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}
` +
            `💰 ${duel.amount} MP

` +
            `❌ ${escapeHtml(duel.targetName)} جواب نداد.`,
          parse_mode: "HTML",
        });
      } catch (e) {
        console.error("Duel timeout error:", e);
      }
      resolve();
    }, DUEL_TIMEOUT_SEC * 1000);
  });

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(timeoutPromise);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
