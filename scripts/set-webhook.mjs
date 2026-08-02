#!/usr/bin/env node
/**
 * Registers the Telegram webhook for the deployed worker.
 *
 * Usage:
 *   node scripts/set-webhook.mjs <BOT_TOKEN> <WEBHOOK_URL> [SECRET_TOKEN]
 *
 * Example:
 *   node scripts/set-webhook.mjs 123456:ABC... https://meow-bot.example.workers.dev/telegram/webhook my-secret
 *
 * The WEBHOOK_URL must point at the worker's /telegram/webhook route and the
 * SECRET_TOKEN must match the WEBHOOK_SECRET binding set on the worker.
 */
const [token, url, secret] = process.argv.slice(2);
if (!token || !url) {
  console.error("Usage: node scripts/set-webhook.mjs <BOT_TOKEN> <WEBHOOK_URL> [SECRET_TOKEN]");
  process.exit(1);
}

const body = {
  url,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
};
if (secret) body.secret_token = secret;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
if (!json.ok) {
  console.error("setWebhook failed:", JSON.stringify(json));
  process.exit(1);
}
console.log("Webhook registered:", JSON.stringify(json.result));
