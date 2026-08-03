# Meow Bot 🐱

A Telegram points/gamification bot running on **Cloudflare Workers** (Hono + D1 + Durable Objects). Users earn "Meow Points" by typing *میو / meow* in groups, and can play lottery, dice, duels (ELO rated), clans, treasury and a full 2v2 **Hokm (حکم)** card game with a WebApp frontend.

## Features

- 💬 Meow earning with cooldowns, tiers (normal → rainbow → epic → king → diamond) and rank-based tax
- 🏆 Group & global leaderboards, daily streak rewards, `/me` profile, `/history`
- 🎰 Lottery (6-of-49, per-ticket numbers, tiered payouts, admin draws), 🎲 dice, 💸 `/pay` transfers
- ⚔️ Duels with ELO ratings (D1-persisted so they survive restarts)
- 🏦 Group treasury + tax pools, 👥 clans
- 🎉 Configurable bonus events (`/add event Name Multiplier Minutes`)
- ♠️ **Hokm 2v2**: Telegram lobby → WebApp (WebSocket) → Durable Object game engine with alarms for turn/trump/draw timeouts; free practice mode vs AI bots (`/hokm bot`, no money involved)
- 🔒 Owner panel (`/admin`) with broadcast, user management, DB repair, audit, and `/hokmcancel` to cancel an active Hokm game (refunds everyone)

## Commands

**Players**

- `/start` — welcome message + main menu
- `/me` — your profile (points, meows, duel rating, ranks, badge)
- `/top` — group leaderboard · `/global` — global leaderboard · `/duelrank` — duel ELO leaderboard
- `/daily` — daily reward (private chat only, 500 MP + streak)
- `/pay` — transfer points: `/pay @user 100` or reply to a message with `/pay 100`
- `/history` — your last transactions
- `/lottery` / `/gamble` / `قمار` — lottery status; `/lottery buy 3` to buy tickets
- `/dice` / `تاس` — roll the dice (doubles win big)
- `/treasury` — group treasury balance
- `/clan` / `/clans` — your clan; `/clan create Name`, `/clan join Name`
- `/settings` — group settings · `/events` — active bonus events
- `دعوا 500` (reply to someone) — challenge them to a duel (both stake the amount, ELO rated)
- `/hokm 4000` — start a real 2v2 Hokm game (pot 4000 → 1000 per player)
- `/hokm bot` — free practice game vs 3 AI bots (no betting)
- `میو` / `meow` — earn random Meow Points (respects cooldown)

**Owner only** (`BOT_OWNER_ID`): `/admin` panel, `/broadcast`, `/addpoints`, `/removepoints`,
`/resetuser`, `/userinfo`, `/banuser`, `/unbanuser`, `/repair`, `/refreshbadge`,
`/config`, `/groups`, `/duels`, `/audit`, `/hokmcancel`, and events
(`/add event Name Multiplier Minutes`, `/edit event …`, `/delete event`).

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

> ⚠️ For the "بازی را باز کن" WebApp button to work, register the worker
> domain in @BotFather (`/setdomain`) — otherwise Telegram rejects the button
> with `BUTTON_TYPE_INVALID`. The bot then falls back to a plain play link +
> cancel button, so games still start.

```jsonc
// wrangler.jsonc
"vars": { "HOKM_APP_URL": "https://meow-bot.<subdomain>.workers.dev" }
```

### Optional: KV cache & VIP user

- **KV cache**: create a KV namespace and uncomment `kv_namespaces` in `wrangler.jsonc`.
- **VIP user**: set `MEOW_VIP_USER_ID` var to a numeric Telegram id to give that user boosted meow tier chances (leave empty to disable).

## Operational notes

- **Expiry reliability**: duels and Hokm lobbies are refunded by a cron-triggered
  sweep (`src/sweep.ts`, every minute). In-request `setTimeout()` is unreliable
  on Workers (isolates get evicted), so it is deliberately not used.
- **One active Hokm game per group** is enforced when creating a lobby.
- The webhook endpoint requires `X-Telegram-Bot-Api-Secret-Token` == `WEBHOOK_SECRET`.
- `.dev.vars`, `.wrangler`, `dist` and `node_modules` are gitignored.

## Tests

```bash
npm test
```

Covers the Hokm engine, initData auth, lobby persistence (incl. AI bot
practice seats), lottery, pay transfers, treasury and group balance flows.
