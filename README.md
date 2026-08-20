# Meow Bot 🐱

A Telegram points/gamification bot running on **Cloudflare Workers** (Hono + D1). Users earn "Meow Points" by typing *میو / meow* in groups, and can play lottery, dice, duels (ELO rated), treasury and more.

## Features

- 💬 Meow earning with cooldowns, 12 reward tiers and rank-based tax
- 🏆 Group leaderboard, `/me` profile, `/history`
- 🎰 Lottery (6-of-49, per-ticket numbers, tiered payouts, admin draws), 🎲 dice, 💸 `/pay` transfers
- 🏅 Title auctions — per-group titles won via owner-run auctions, displayed in `/top`
- ⚔️ Duels with ELO ratings (D1-persisted so they survive restarts)
- 🏦 Group treasury + tax pools
- 🎉 Configurable bonus events (`/add event Name Multiplier Minutes`)
- 🔒 Owner panel (`/admin`) with broadcast, user management, DB repair, and audit

## Commands

**Players**

- `/start` — welcome message + main menu
- `/me` — your profile (points, meows, duel rating, ranks, badge)
- `/top` — group leaderboard · `/duelrank` — duel ELO leaderboard
- `/pay` — transfer points: `/pay @user 100` or reply to a message with `/pay 100`
- `/history` — your last transactions
- `/lottery` / `/gamble` / `قمار` — lottery status; `/lottery buy 3` to buy tickets
- `/dice` / `تاس` — roll the dice (doubles win big)
- `/treasury` — group treasury balance
- `تایتل` — your titles; `<تایتل 3>` — set the active `/top` title; `<تایتل نام>` — suggest a title
- `/settings` — group settings · `/events` — active bonus events
- `دعوا 500` (reply to someone) — challenge them to a duel (both stake the amount, ELO rated)
- `میو` / `meow` — earn random Meow Points (respects cooldown)

**Owner only** (`BOT_OWNER_ID`): `/admin` panel, `/broadcast`, `/addpoints`, `/removepoints`,
`/resetuser`, `/userinfo`, `/banuser`, `/unbanuser`, `/repair`, `/refreshbadge`,
`/config`, `/groups`, `/duels`, `/audit`, and events.
Title auctions: `<تایتل نام 1000 100>` starts an auction (entry fee + jump); reply to a
user's message with `<تایتل نام>` assigns a title directly; the 🏁 button ends an auction.
Money flows to the lottery pot; re-auctioning an owned title pays the seller 20% of entry
fees + (winning bid − entry).
(`/add event Name Multiplier Minutes`, `/edit event …`, `/delete event`).

## Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Hono](https://hono.dev/)
- **D1** (SQLite) — persistence
- **KV** *(optional)* — 30s active-event cache (`CACHE` binding, not configured by default)
- **Cron trigger** — reliable every-minute sweep for expired duels

## Project layout

```
src/
  app.ts          Hono router: webhook + health
  handlers.ts     All Telegram command & callback handlers
  database.ts     D1 access layer (users, groups, lottery, treasury…)
  duel.ts         Duels + ELO
  owner.ts        Owner/admin panel
  keyboards.ts    Inline keyboards
  titleAuction.ts Per-group title auctions (commands, bidding, settlement)
  sweep.ts        Scheduled cleanup for expired duels
migrations/       D1 migrations (0000 → 0018)
test/             Vitest suite (Workers pool)
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in TELEGRAM_BOT_TOKEN, BOT_OWNER_ID, WEBHOOK_SECRET
npx wrangler d1 migrations apply meow-bot-db --local   # apply D1 migrations locally
npm run dev                       # starts wrangler dev
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

### Optional: KV cache & VIP user

- **KV cache**: create a KV namespace and uncomment `kv_namespaces` in `wrangler.jsonc`.
- **VIP user**: set `MEOW_VIP_USER_ID` var to a numeric Telegram id to give that user boosted meow tier chances silently (renormalized odds: the bottom tier nearly disappears and higher tiers get ~2–3×) — no visible badge or indicator (leave empty to disable).

## Operational notes

- **Expiry reliability**: expired duels are cleaned up by a cron-triggered
  sweep (`src/sweep.ts`, every minute). No points are escrowed at duel creation
  (both players are debited at accept), so the sweep only removes stale rows.
  In-request `setTimeout()` is unreliable on Workers (isolates get evicted), so
  it is deliberately not used.
- The webhook endpoint requires `X-Telegram-Bot-Api-Secret-Token` == `WEBHOOK_SECRET`.
- `.dev.vars`, `.wrangler`, `dist` and `node_modules` are gitignored.

## Tests

```bash
npm test
```

Covers duels, lottery, pay transfers, treasury, Poker, Blackjack, title auctions and group-balance flows.
