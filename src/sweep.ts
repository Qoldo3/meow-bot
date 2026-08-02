import { DUEL_TIMEOUT_SEC, HOKM_LOBBY_TIMEOUT_SEC } from "./constants";
import { telegramRequest, editMessageText } from "./telegram";
import { cancelHokmGame } from "./hokmLobby";
import { escapeHtml } from "./utils";

/**
 * Scheduled cleanup (runs every minute via the cron trigger in wrangler.jsonc).
 *
 * The in-request setTimeout() paths in duel.ts / handlers.ts are best-effort:
 * a Worker isolate may be evicted before the timer fires, which would leave
 * money stuck in expired duels or Hokm lobbies. This sweep is the reliable
 * backstop — it finds expired rows in D1, refunds them and edits the
 * Telegram messages.
 */
export async function sweepExpiredDuels(db: D1Database, token: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - DUEL_TIMEOUT_SEC;

  const rows = await db
    .prepare(
      `SELECT duel_id, challenger_name, target_name, amount, group_id, message_id
       FROM active_duels WHERE status = 'pending' AND created_at < ?`
    )
    .bind(cutoff)
    .all<{
      duel_id: string;
      challenger_name: string;
      target_name: string;
      amount: number;
      group_id: number;
      message_id: number;
    }>();

  if (!rows.results.length) return 0;

  // D1 batch() is capped at 100 statements — chunk the deletes just in case.
  const chunkSize = 100;
  for (let i = 0; i < rows.results.length; i += chunkSize) {
    const chunk = rows.results.slice(i, i + chunkSize);
    await db.batch(chunk.map((d) => db.prepare(`DELETE FROM active_duels WHERE duel_id = ?`).bind(d.duel_id)));
  }

  let edited = 0;
  for (const d of rows.results) {
    if (!d.message_id) continue;
    const res = await telegramRequest(token, "editMessageText", {
      chat_id: d.group_id,
      message_id: d.message_id,
      text:
        `⏱️ <b>دعوا منقضی شد!</b>\n` +
        `🐱 ${escapeHtml(d.challenger_name)} 🆚 ${escapeHtml(d.target_name)}\n` +
        `💰 ${d.amount} MP\n\n` +
        `❌ ${escapeHtml(d.target_name)} جواب نداد.`,
      parse_mode: "HTML",
    });
    if (res.ok) edited++;
  }
  return edited;
}

export async function sweepExpiredHokmLobbies(db: D1Database, token: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - HOKM_LOBBY_TIMEOUT_SEC;

  const rows = await db
    .prepare(
      `SELECT game_id, group_id, board_msg_id
       FROM hokm_games WHERE status = 'lobby' AND created_at < ?`
    )
    .bind(cutoff)
    .all<{ game_id: string; group_id: number; board_msg_id: number | null }>();

  let cancelled = 0;
  for (const g of rows.results) {
    await cancelHokmGame(db, g.game_id);
    cancelled++;
    if (g.board_msg_id) {
      await editMessageText(
        token,
        g.group_id,
        g.board_msg_id,
        `⏱️ <b>بازی حکم منقضی شد!</b>\n\nهیچ‌کس دیگه‌ای نیومد. مبلغ‌ها برگشت.`
      );
    }
  }
  return cancelled;
}

export async function runSweep(db: D1Database, token: string): Promise<{ duels: number; lobbies: number }> {
  if (!token) return { duels: 0, lobbies: 0 };
  const duels = await sweepExpiredDuels(db, token);
  const lobbies = await sweepExpiredHokmLobbies(db, token);
  if (duels > 0 || lobbies > 0) {
    console.log(`[sweep] expired duels: ${duels}, hokm lobbies: ${lobbies}`);
  }
  return { duels, lobbies };
}
