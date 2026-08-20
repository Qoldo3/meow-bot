import { sendMessage } from "./telegram";
import { escapeHtml } from "./utils";

/**
 * Sends the owner a one-line deploy notification (version id + time) once per
 * deploy. scripts/notify-deploy.mjs writes a `deploy_notify` marker into
 * bot_settings after each deploy; the every-minute cron compares it against
 * `deploy_notified` and messages the owner the first time it sees a new one.
 */
export async function runDeployNotify(db: D1Database, token: string, ownerId: string | undefined | null): Promise<void> {
  const owner = parseInt(ownerId ?? "", 10);
  if (!Number.isFinite(owner)) return;

  let pending: string | null = null;
  try {
    const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'deploy_notify'`).first<{ value: string }>();
    pending = row?.value ?? null;
  } catch (err) {
    console.error("[deploy-notify] read failed:", err);
    return;
  }
  if (!pending) return;

  const notified = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'deploy_notified'`).first<{ value: string }>();
  if (notified?.value === pending) return;

  let version = "?";
  let date = "";
  try {
    const p = JSON.parse(pending);
    version = typeof p.version === "string" ? p.version : "?";
    date = typeof p.date === "string" ? p.date : "";
  } catch {
    // Malformed marker — show the raw value instead of dropping the message.
    version = pending.slice(0, 40);
  }

  const text =
    `🚀 <b>ربات آپدیت شد!</b>\n\n` +
    `📦 نسخه: <code>${escapeHtml(version)}</code>` +
    (date ? `\n🕒 ${escapeHtml(date)}` : "");

  const sent = await sendMessage(token, owner, text);
  if (sent.ok) {
    await db
      .prepare(`INSERT INTO bot_settings (key, value) VALUES ('deploy_notified', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(pending)
      .run();
  }
}
