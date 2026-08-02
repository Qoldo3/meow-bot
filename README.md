# Meow Bot 🐱

A Telegram points/gamification bot running on **Cloudflare Workers** (Hono + D1 + Durable Objects). Users earn "Meow Points" by typing *میو / meow* in groups, and can play lottery, dice, duels (ELO rated), clans, treasury and a full 2v2 **Hokm (حکم)** card game with a WebApp frontend.

## Features

- 💬 Meow earning with cooldowns, tiers (normal → rainbow → epic → king → diamond) and rank-based tax
- 🏆 Group & global leaderboards, daily streak rewards, `/me` profile, `/history`
- 🎰 Lottery (6-of-49, per-ticket numbers, tiered payouts, admin draws), 🎲 dice, 💸 `/pay` transfers
- ⚔️ Duels with ELO ratings (D1-persisted so they survive restarts)
- 🏦 Group treasury + tax pools, 👥 clans
- 🎉 Configurable bonus events (`/add event Name Multiplier Minutes`)
- ♠️ **Hokm 2v2**: Telegram lobby → WebApp (WebSocket) → Durable Object game engine with alarms for turn/trump/draw timeouts
- 🔒 Owner panel (`/admin`) with broadcast, user management, DB repair and audit

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Hono](https://hono.dev/)
- **D1** (SQLite) — persistence
- **Durable Objects** — Hokm game state + alarms
- **KV** *(optional)* — 30s active-event cache (`CACHE` binding, not configured by default)
- **Cron trigger** — reliable every-minute sweep for expired duels / Hokm lobbies

## Project layout

```
src/
  app.ts          Hono router: webhook, health, Hokm WebSocket upgrade
  handlers.ts     All Telegram command & callback handlers
  database.ts     D1 access layer (users, groups, lottery, clans, treasury…)
  duel.ts         Duels + ELO
  hokm.ts         Pure card-game logic (shuffle, tricks, scoring)
  hokmAuth.ts     Telegram Mini App initData validation (HMAC-SHA256)
  hokmLobby.ts    Hokm lobby persistence (D1)
  hokmGame.ts     Durable Object: live game engine + WebSockets + alarms
  owner.ts        Owner/admin panel
  keyboards.ts    Inline keyboards
  sweep.ts        Scheduled cleanup for expired duels & lobbies
public/           Hokm WebApp (hokm.html, app.js, style.css)
migrations/       D1 migrations (0000 → 0009)
test/             Vitest suite (Workers pool)
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in TELEGRAM_BOT_TOKEN, BOT_OWNER_ID, WEBHOOK_SECRET
npx wrangler d1 migrations apply meow-bot-db --local   # apply D1 migrations locally
npm run dev                       # starts wrangler dev (also serves public/)
npm test                          # vitest (Workers pool)
npm run cf-typegen                # regenerate worker-configuration.d.ts
```

## Deploying

```bash
# 1. Create the D1 database (one time) and apply migrations
npx wrangler d1 create meow-bot-db
# update database_id in wrangler.jsonc with the printed id
npx wrangler d1 migrations apply meow-bot-db --remote

# 2. Set secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put BOT_OWNER_ID
npx wrangler secret put WEBHOOK_SECRET

# 3. Deploy
npm run deploy

# 4. Register the webhook (point at your worker's /telegram/webhook route)
node scripts/set-webhook.mjs <BOT_TOKEN> https://meow-bot.<subdomain>.workers.dev/telegram/webhook <WEBHOOK_SECRET>
```

### Hokm WebApp URL

The Hokm "open game" button needs the public URL of the worker. It is derived
automatically from the request origin at game creation; you can also set it
explicitly:

```jsonc
// wrangler.jsonc
"vars": { "HOKM_APP_URL": "https://meow-bot.<subdomain>.workers.dev" }
```

### Optional: KV cache & VIP user

- **KV cache**: create a KV namespace and uncomment `kv_namespaces` in `wrangler.jsonc`.
- **VIP user**: set `MEOW_VIP_USER_ID` var to a numeric Telegram id to give that user boosted meow tier chances (leave empty to disable).

## Operational notes

- **Expiry reliability**: duels and Hokm lobbies have an in-request `setTimeout`
  fast path *and* a cron-triggered sweep (`src/sweep.ts`, every minute) as the
  reliable backstop so escrowed points are always returned.
- **One active Hokm game per group** is enforced when creating a lobby.
- The webhook endpoint requires `X-Telegram-Bot-Api-Secret-Token` == `WEBHOOK_SECRET`.
- `.dev.vars`, `.wrangler`, `dist` and `node_modules` are gitignored.

## Tests

```bash
npm test
```

Covers the Hokm engine, initData auth, lobby persistence, lottery, pay
transfers, treasury and group balance flows (43 tests).
