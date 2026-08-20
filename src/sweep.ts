import { DUEL_TIMEOUT_SEC } from "./constants";
import { telegramRequest } from "./telegram";
import { escapeHtml } from "./utils";
import {
  sweepPendingSellerAuctions,
  sweepDueTitleAuctions,
  sweepRepostAuctions,
  recoverStuckSettlingAuctions,
} from "./titleAuction";
import { sweepBoosters } from "./database";

/**
 * Scheduled cleanup (runs every minute via the cron trigger in wrangler.jsonc).
 *
 * The in-request setTimeout() paths in duel.ts / handlers.ts are best-effort:
 * a Worker isolate may be evicted before the timer fires, which would leave
 * expired duels stuck in the DB. This sweep is the reliable backstop — it
 * finds expired rows in D1, deletes them and edits the Telegram messages.
 *
 * Note: no points are escrowed at duel creation (both players are debited at
 * accept time), so there is nothing to refund here — just cleanup.
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

  // D1 batch() caps at 100 statements, and the Free plan caps D1 at 50
  // queries per invocation (each statement counts) — chunk at 40.
  const chunkSize = 40;
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

export async function runSweep(db: D1Database, token: string): Promise<{ duels: number; titleAuctions: number; dueAuctions: number; repostedAuctions: number; recoveredSettling: number; boosters: number }> {
  if (!token) return { duels: 0, titleAuctions: 0, dueAuctions: 0, repostedAuctions: 0, recoveredSettling: 0, boosters: 0 };

  // Each step is independent: a failure in one must not kill the sweep for the
  // rest (a stuck auction already costs money — a crashed step would too).
  const step = async (fn: () => Promise<number>, label: string): Promise<number> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[sweep] ${label} failed`, err);
      return 0;
    }
  };

  const duels = await step(() => sweepExpiredDuels(db, token), "duels");
  if (duels > 0) {
    console.log(`[sweep] expired duels: ${duels}`);
  }
  const titleAuctions = await step(() => sweepPendingSellerAuctions(db, token), "pending seller auctions");
  if (titleAuctions > 0) {
    console.log(`[sweep] cancelled title auctions: ${titleAuctions}`);
  }
  const recoveredSettling = await step(() => recoverStuckSettlingAuctions(db, token), "stuck settling auctions");
  if (recoveredSettling > 0) {
    console.log(`[sweep] recovered stuck settling auctions: ${recoveredSettling}`);
  }
  const dueAuctions = await step(() => sweepDueTitleAuctions(db, token), "due title auctions");
  if (dueAuctions > 0) {
    console.log(`[sweep] finished title auctions: ${dueAuctions}`);
  }
  const repostedAuctions = await step(() => sweepRepostAuctions(db, token), "title auction boards");
  if (repostedAuctions > 0) {
    console.log(`[sweep] reposted title auction boards: ${repostedAuctions}`);
  }
  // Boosters freeze while an event runs and resume when it stops. The sweep is
  // what flips those states even when nobody meows.
  const boosters = await step(() => sweepBoosters(db), "boosters");
  if (boosters > 0) {
    console.log(`[sweep] booster states updated: ${boosters}`);
  }
  return { duels, titleAuctions, dueAuctions, repostedAuctions, recoveredSettling, boosters };
}
