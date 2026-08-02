# Hokm (حکم) — Implementation Plan

2v2 human-only Hokm with MP betting, built as a Telegram Mini App on the existing Meow bot
(Cloudflare Worker + D1 + Durable Objects). **Design only — no code in this doc.**

## 1. Locked decisions

| # | Decision | Detail |
|---|----------|--------|
| 1 | Teams | Free seats; seats 0&2 = Team A, seats 1&3 = Team B (partners opposite). |
| 2 | Flow | `/hokm {bet}` in a group → duel-style inline accepts from 3 others → bot posts the Mini App board message in the group. |
| 3 | Bet | `{bet}` = total pot. Each player pays `bet/4`. Winning team splits the pot (`pot/2` per winner). **Pot resolves at end of the match (first team to 7 points).** |
| 4 | Observers | In-app read-only (no hands) + live group board message (throttled). |
| 5 | Leaver | Mid-match: leaver's team forfeits → other team wins the pot. Pre-match no-show: cancel + refund all. |
| 6 | Stack | Cloudflare: Durable Object per game (WebSocket Hibernation), DO SQLite storage, Alarms for turn timers, D1 ledger. |

Authentic ruleset (corrected from research): no "5♠ picks trump". First-hand hakem is
drawn by revealing cards face-up until an Ace appears. The hakem calls trump **seeing only
their first 5 dealt cards**, then the deal completes to 13 each. First team to 7 tricks
takes the hand (1 pt); kot = hakem's team sweeps 7-0 (2 pts); hakem-koti = opponents sweep
the hakem's team (3 pts). First to 7 points wins the match. Rank: A K Q J 10 9 8 7 6 5 4 3 2.

## 2. Architecture

```
Telegram group                    Worker (Hono)                        Durable Object
┌──────────────┐   webhook     ┌──────────────────────┐   fetch      ┌─────────────────────┐
│ /hokm 1000   │ ───────────▶ │ handleHokmRequest     │              │  HokmGame (per game) │
│ accepts (x3) │ ───────────▶ │ handleHokmAccept      │              │  ─────────────────── │
│ Mini App btn │ ◀─────────── │ board message         │  name=gameId │  state machine       │
│              │              │                       │              │  WS hub (4+obs)      │
└──────────────┘              │ /api/hokm/:id/ws ◀─── WebSocket ──▶ │  alarms (turn timer) │
                              │ /hokm/:id            ── static ──▶ │  D1 payouts           │
                              │ (Mini App HTML/JS)    assets       └──────────┬────────────┘
                              └──────────────────────┘                        │
                                        │  D1: hokm_games, hokm_game_players, │ transactions
                                        └─────────────────────────────────────┘
```

- **Lobby phase lives in D1** (like `active_duels`), handled by webhook callbacks.
- **The DO is created on the 4th accept** (`ctx.env.HOKM_GAME.get(gameId)`), keyed by game id.
  From that point the DO owns match state, WebSockets, alarms, and D1 payout writes.
- Mini App connects over WebSocket to `/api/hokm/:id/ws?initData=...`; the Worker
  validates initData and forwards the upgrade to the DO (`ctx.env.HOKM_GAME.get(id).fetch(ws)`).

## 3. D1 schema (migrations/0008_hokm.sql)

```sql
-- One row per game; drives the lobby and is the payout audit record.
CREATE TABLE IF NOT EXISTS hokm_games (
  game_id        TEXT PRIMARY KEY,
  group_id       INTEGER NOT NULL,
  creator_id     INTEGER NOT NULL,
  bet            INTEGER NOT NULL,   -- total pot
  per_player     INTEGER NOT NULL,   -- bet / 4
  status         TEXT NOT NULL DEFAULT 'lobby', -- lobby | playing | ended | cancelled
  board_msg_id   INTEGER,            -- group board message to edit
  winner_team    INTEGER,            -- 0 | 1 | NULL
  result         TEXT,               -- 'match' | 'forfeit:<user_id>'
  created_at     INTEGER NOT NULL,
  started_at     INTEGER,
  ended_at       INTEGER
);

-- Players + seats + escrow accounting.
CREATE TABLE IF NOT EXISTS hokm_game_players (
  game_id        TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  seat           INTEGER NOT NULL,   -- 0..3 (fixed at 4th accept)
  team           INTEGER NOT NULL,   -- seat % 2
  username       TEXT,
  first_name     TEXT NOT NULL,
  paid           INTEGER NOT NULL DEFAULT 0,  -- escrow deduction applied
  accepted_at    INTEGER NOT NULL,
  PRIMARY KEY (game_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_hokm_games_group_status ON hokm_games(group_id, status);
CREATE INDEX IF NOT EXISTS idx_hokm_players_game ON hokm_game_players(game_id);
```

Escrow uses the **existing** `users`, `group_members`, `transactions` tables — same pattern as
`handleDuelAccept` (`db.batch` with `WHERE ... AND meow_points >= ?` + `meta.changes` check).
No new money tables.

## 4. Lobby flow (`handleHokmRequest` / `handleHokmAccept`, mirrors duel)

1. `/hokm 1000` (any group member) → validate amount (`safeParseAmount`), require `bet % 4 == 0`,
   check the creator's `users` + `group_members` balance ≥ `bet/4` (per-player stake).
2. Post accept message with a 4-seat keyboard:
   `["✅ صندلی ۱", "✅ صندلی ۲", "✅ صندلی ۳"]` → callbacks `hokm:seat:<gameId>:<seatN>`.
   Each accept deducts `bet/4` from that player immediately (escrow), records
   `transactions` reason `HOKM_BET`, sets `paid=1`. Deduct **at accept**, refund on cancel
   (identical timing to duels, so no new "pending funds" model).
3. Guard rails: cannot take the creator's seat, no duplicate user, balance re-checked with
   `meta.changes`, seat taken → reject.
4. Lobby timeout: reuse `scheduleDuelTimeout` pattern with `HOKM_LOBBY_TIMEOUT_SEC = 60`.
   Expired → refund every `paid=1` player (users + group_members + `HOKM_REFUND` txn),
   set status `cancelled`.
5. On the 3rd accept (4 players, seats fixed, creator at seat 0) → status `playing`,
   `started_at`, **create the DO**, post the board message with 4 `web_app` buttons:
   `{ text: "♠️ باز کردن بازی", web_app: { url: `${HOKM_APP_URL}/hokm.html?game=${gameId}` } }`.
6. Pre-match no-show: DO sets alarm `HOKM_JOIN_TIMEOUT_SEC = 300`. If any seat never connects
   → cancel + refund all four (nobody loses points pre-match). The **leaver rule (#5) applies
   only after the match starts.**

## 5. WebSocket auth (Mini App → Worker)

Standard Telegram initData HMAC validation (`src/hokmAuth.ts`), done in the Worker **before**
forwarding the socket to the DO:

1. Parse the `initData` query string from the WS URL.
2. `data_check_string` = all key/value pairs except `hash`, sorted by key, joined as
   `key=value` with `\n`.
3. `secret = HMAC_SHA256(key = "WebAppData", data = bot_token)`.
4. `calc  = HMAC_SHA256(key = secret, data = data_check_string)` hex; compare to `hash`
   with a constant-time compare.
5. Reject if `auth_date` is older than 24h. Parse `user.id` from the JSON `user` field.
6. Bind result `{ userId, authDate }`; then check the game id in the URL against
   `hokm_game_players`. Paid player → seat; anyone else → observer (read-only).

`initData` from an inline-button Mini App carries `user` + `chat_instance` but **no `chat`**,
so seat claims are validated against the D1 player list, never from initData alone.

## 6. HokmGame Durable Object (`src/hokmGame.ts`)

### 6.1 Persistence
- Single `state` JSON blob in `storage.put("state", ...)` after every mutation (`persist()` helper).
- Restore `state` from storage on first access after wake (hibernation-safe).
- Keep the WS→seat map in memory via `serializeAttachment`/`deserializeAttachment`
  (`{ wsId: { userId, seat } | { userId, observer: true } }`).

### 6.2 State machine phases
```
lobby(handled in D1) → waiting_join → drawing_hakem → dealing → trump_call
  → trick_loop (×n) → hand_over → (match_over | next hand → dealing) → match_over → paid
```
- `waiting_join`: all 4 connected → `drawing_hakem`.
- `drawing_hakem`: reveal shuffled cards one-by-one (500ms broadcast) until an Ace → that
  seat is hakem. (Teams stay fixed; the traditional second-Ace partner rule is skipped.)
- `dealing`: deal 13 each, but **hakem's first 5 cards are dealt first** and flagged.
- `trump_call`: only the hakem sees their first 5 cards; picks suit → broadcast suit + continue
  deal to 13 (hakem's other 8 revealed). Alarm `HOKM_TRUMP_TIMEOUT_SEC = 30` → auto-pick the
  suit of the hakem's highest-rank card among the first 5.
- `trick_loop`: leader plays → follow-suit enforced by the rules engine → after 4 plays
  `resolveTrick` → winner leads next trick. Hands update after each play so observers can
  follow live.
- `hand_over`: score the hand (1/2/3 pts), update match scores, board message edit,
  hakem rotation (win → stay; loss → pass to player on the right, old hakem deals).
- `match_over`: first to 7 → payout (below), close sockets with a final `game_over` event.

### 6.3 WebSockets (Hibernation API)
- `fetch()` handles the upgrade path: Worker already validated initData and passes a header
  `X-Hokm-User`/`X-Hokm-Seat` (set by the Worker) → `state.acceptWebSocket(server)`.
- `webSocketMessage(ws, msg)`: JSON actions `join` (reconnect), `trump`, `play`, `observe`,
  `leave`. Every handler re-checks the seat attachment; every mutation calls `persist()` +
  `broadcast()`.
- `webSocketClose(ws, ...)`: mark seat disconnected, broadcast `player_disconnected`.
  **No instant forfeit** — a reconnect within `HOKM_RECONNECT_GRACE_SEC = 90` keeps the seat.
- `broadcast(event, payload, {seat?, excludeSeat?})` iterates `ctx.getWebSockets()`.
- Observers receive all events **except** `hand`, `hand_own`, and trump-choice data.

### 6.4 Turn timers & auto-play (Alarms)
- Constants: `HOKM_TURN_TIMEOUT_SEC = 60`, `HOKM_TRUMP_TIMEOUT_SEC = 30`,
  `HOKM_JOIN_TIMEOUT_SEC = 300`, `HOKM_RECONNECT_GRACE_SEC = 90`, `HOKM_AFK_STRIKES = 2`.
- Every transition into a "waiting on player" phase sets `storage.setAlarm(now + timeout)`
  and records `turnDeadline` in state. Incoming messages clear/set as needed.
- `alarm()` fires after hibernation (alarms persist): if the same player is still due,
  auto-play their **lowest legal card** and increment their strike. At `HOKM_AFK_STRIKES`
  (total per match, not consecutive) → **forfeit**: other team wins the pot (see §8),
  broadcast `game_over`, close all sockets.

## 7. Rules engine (`src/hokm.ts`, pure & unit-testable)

- `newDeck()` (52), `shuffle()` (Fisher-Yates with `crypto.getRandomValues`), `deal()`.
- `isLegal(card, ledSuit, trumpSuit, hand)`: must follow led suit if able; else any card.
- `resolveTrick(plays: {seat, card}[], trumpSuit)`: highest trump wins, else highest of led suit.
- `scoreHand(tricksTeamA, tricksTeamB, hakemTeam, kot threshold=7)`: 1 / 2 (kot) / 3 (hakem-koti).
- `nextState` transitions tested in isolation from the DO (vitest, existing `test/` setup).

## 8. Payout & settlement

- **Winners** (Team that reaches 7, or survives the forfeit): `+pot/2` each to `users` and
  `group_members`; `transactions` reason `HOKM_WIN`.
- **Losers**: keep the `HOKM_BET` debit (already recorded at accept).
- **Forfeit**: same as a win for the other team; `result = 'forfeit:<user_id>'`.
- **Pre-match cancel/refund**: `+bet/4` back to every `paid=1` player; `HOKM_REFUND`.
- All money writes are `db.batch` in the DO (DO has `DB` binding) or the lobby handler;
  the sum always equals zero (no tax — matches duels; `distributeGroupTax` is available later
  if you want a rake).
- Update `hokm_games.status='ended'`, `winner_team`, `ended_at`; edit the board message.

## 9. Board message (group, tier-1 observability)

- Posted once with the 4 `web_app` buttons at match start.
- Edited only on **phase transitions** (hand end, match end, forfeit) to avoid spamming:
  shows teams, current match score, hand score, trump suit, hakem.
- Per-trick updates stay in the Mini App via WS.

## 10. Frontend (Mini App)

Static assets served by the Worker (`assets` config, `public/hokm/`). Zero-build
vanilla HTML/CSS/JS to start (RTL, Persian). Views:

1. **Lobby/join** — seat map, "منتظر بازیکنها..." spinner, your seat + team.
2. **Trump call modal** (hakem only) — first 5 cards + 4 suit buttons.
3. **Hakem draw** — face-up card reveals until the Ace appears.
4. **Table** — RTL; top bar (match score, hand tricks, trump suit indicator), trick area
   (played cards + turn highlight), own fanned hand (tap → play), partners/opponents as card backs.
5. **Result** — pot split, scores, "بازی مجدد" (posts a fresh `/hokm` for the same 4 players).

WebSocket client: `new WebSocket(`${wss}://${host}/api/hokm/${gameId}?initData=${encodeURIComponent(initData)}`)`,
reconnect with backoff while the game is still `playing`, `Telegram.WebApp.ready()`,
`Telegram.WebApp.MainButton` for confirm actions, `themeParams` for dark-mode styling.

## 11. Wiring & file changes

| File | Change |
|------|--------|
| `src/hokm.ts` | **New** — pure rules engine. |
| `src/hokmAuth.ts` | **New** — initData HMAC validation. |
| `src/hokmLobby.ts` | **New** — lobby create/accept/cancel/refund/board (mirrors `duel.ts`). |
| `src/hokmGame.ts` | **New** — HokmGame DO (state machine, WS, alarms, payouts). |
| `src/index.ts` | Export the DO class (alongside default `app`). |
| `src/app.ts` | Wire `/hokm` command; add `GET /hokm/:id` (assets), `GET /api/hokm/:id/ws` (initData → DO upgrade). |
| `src/handlers.ts` | `handleHokmRequest`, `handleHokmAccept`, `hokm:seat:*` case in `handleCallbackQuery` (line ~1668 area). |
| `src/keyboards.ts` | `hokmSeatKeyboard`, `hokmBoardKeyboard(web_app buttons)`. |
| `src/constants.ts` | HOKM_* constants. |
| `src/types.ts` | `Bindings` + `HOKM_GAME` DO namespace; `HokmGameState`, `HokmPlayer` types. |
| `wrangler.jsonc` | `durable_objects.bindings`, `migrations` (new_sqlite_classes), `assets`, `HOKM_APP_URL` var. |
| `worker-configuration.d.ts` | Regenerate via `npx wrangler types`. |
| `migrations/0008_hokm.sql` | §3 schema. |
| `public/hokm/*` | Mini App HTML/CSS/JS. |
| `test/hokm.test.ts`, `test/hokmGame.test.ts` | Rules engine + DO tests (vitest-pool-workers). |

## 12. Order of work (suggested)

1. Schema migration + `wrangler.jsonc` DO binding + `wrangler types`.
2. Pure rules engine + unit tests (deck/shuffle/legality/trick/scoring).
3. Lobby (D1 accept flow) + tests.
4. DO skeleton: join/observe + WS broadcast, hakem draw + trump call.
5. Trick loop + hand scoring + match scoring.
6. Alarms/auto-play + forfeit + payouts + board edits.
7. Mini App frontend (views 1→5).
8. End-to-end test on a dev bot via `wrangler dev`.

## 13. Open items (confirm before building)

- **Kot double** nuance: apply exact 1/2/3 scoring as researched — OK?
- **Pre-match no-show** = cancel + refund (not forfeit) — OK?
- **Rematch**: same 4 players, fresh `/hokm` (new pot) — OK?
- **Board message** edits only on phase transitions (not per trick) — OK?
