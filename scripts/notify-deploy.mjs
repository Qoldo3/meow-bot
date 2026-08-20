#!/usr/bin/env node
// Post-deploy notification: captures the freshly deployed version id + time
// and writes a `deploy_notify` marker into D1 bot_settings. The worker's
// every-minute cron (src/deployNotify.ts) picks the marker up, DMs the owner
// a one-line "bot updated" notice (using the bot's own secret token), and
// marks it as notified.
//
// Run automatically by `npm run deploy` after `wrangler deploy`.

import { execSync } from "node:child_process";

const D1_DB = "meow-bot-db";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function latestVersionId() {
  const out = run("npx wrangler deployments list");
  // Oldest-first output; the newest deployment's version is the last match.
  const ids = [...out.matchAll(/\(100%\)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)].map((m) => m[1]);
  return ids.length ? ids[ids.length - 1] : null;
}

try {
  const version = latestVersionId();
  if (!version) {
    console.error("[notify-deploy] could not determine deployed version id — skipping notify");
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 19).replace("T", " ");
  const payload = JSON.stringify({ version, date });
  const sqlValue = payload.replace(/'/g, "''"); // escape for SQL single-quoted literal
  const sql = `INSERT INTO bot_settings (key, value) VALUES ('deploy_notify', '${sqlValue}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  const quoted = sql.replace(/"/g, '\\"');

  run(`npx wrangler d1 execute ${D1_DB} --remote --command "${quoted}"`);
  console.log(`[notify-deploy] marker written for version ${version}`);
} catch (err) {
  console.error("[notify-deploy] failed:", err?.message ?? err);
  process.exit(1);
}
