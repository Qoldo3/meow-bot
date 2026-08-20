# Title Auction (حراج عنوان) — Design

Per-group title auction system. Titles are unique **per group**, are won via owner-run
auctions, and display in front of the owner's name in `/top`. A user can hold up to **3
titles** per group and picks which one is shown.

**Design only — no code in this doc.** All decisions below are locked.

## 1. Locked decisions

| # | Decision |
|---|----------|
| 1 | Winning bid **includes** the winner's entry fee; at the end the winner pays `bid − start` |
| 2 | New-title auctions: 100% of all money → lottery pot |
| 3 | Bids validated against balance at bid time — can't bid what you don't have (no escrow/hold) |
| 4 | Titles are per-group: unique per group, shown in that group's `/top` only |
| 5 | Owner direct-assign: reply to the user's message + `<تایتل نام>` |
| 6 | Owner replying = assign; non-owner or non-reply = suggest a title |
| 7 | On a normal end, entry fees are **never refunded**; the current top bidder is locked in; other participants may leave but lose their entry fee. On an owner **cancel**, all entry fees are refunded in full |
| 8 | The seller cannot bid on their own title |
| 9 | No bids below start → auction cancelled, title stays with its owner |
| 10 | Join = inline button → user-scoped confirm prompt showing the bidder's name |
| 11 | Auctions last **1 hour** from creation (`ends_at`), shown on the board in Tehran time; the every-minute sweep auto-finishes them |
| 12 | **Anti-snipe:** an auction won't finish while a bid landed within the last 30s |
| 13 | Owner replying to a user with a bare `تایتل` lists that user's titles |

## 2. Economy (corrected)

- **Join:** every participant pays `start` immediately — deducted from **both** the global
  (`users`) and group (`group_members`) balances, like duels. Transaction `TITLE_ENTRY`.
- **Bidding:** no holds. Each bid is checked against the bidder's current balance.
- **End:** the winner pays `bid − start` (guarded deduction — see §5.3). Their total outlay
  is the bid, entry fee included.
- **New title:** 100% of everything → `telegram_groups.lottery_pot`.
- **Existing title:** the seller gets `20% × (Σ entry fees) + (winning bid − start)`;
  the remainder → lottery pot.
- **Example:** start 10k, 3 participants, winning bid 50k →
  entry 30k + winner remainder 40k = **70k total**;
  seller 20%×30k + (50k−10k) = 6k + 40k = **46k**; lottery pot **24k**. (46 + 24 = 70 ✓)

## 3. Commands

| Input | Meaning |
|-------|---------|
| `تایتل` | List your titles with their unique IDs (owner also gets auction help) |
| `<تایتل 3>` | Set title ID 3 as your active `/top` title |
| `<تایتل سلام>` | Suggest a new title → bot DMs the owner a proposal |
| `<تایتل نام 1000 100>` (owner) | Start an auction (title, start amount, jump amount) |
| `<تایتل حذف 5>` | Remove title ID 5 (its owner, or the bot owner for any title; blocked while the title is being auctioned) |
| `<تایتل ایموجی 5 🐯>` | Set a custom badge emoji for title ID 5 (its owner, or the bot owner for any title); overrides the price-tier emoji everywhere |
| reply + `<تایتل ملکه>` (owner) | Directly assign that title to the replied user |
| 🏁 button on the board (owner) | End the auction; highest bid wins |

## 4. Auction lifecycle

```
open (join + bid, until owner ends) → ended | cancelled
```

1. **Start (owner):** validate title name, start/jump amounts, no active auction in the
   group, no duplicate title (for new titles). Post the board message with the inline
   keyboard.
2. **Join:** tap `✅ شرکت در حراج` → user-scoped confirm prompt (`✅ @alice — پرداخت 10k
   برای شرکت؟` تأیید / لغو) → entry deducted from both balances, `TITLE_ENTRY` recorded,
   board updated (edited in place) with the participant list.
3. **Bid:** participants only; floor = `current bid + jump`; quick buttons
   (`+جِفت`, `+۵x`) or a custom amount via reply; balance-checked, not held; the board is
   edited in place (re-posted at most every 5 min — fresh message + delete old — to stay
   visible in the feed) with leader + current bid + participant list.
4. **Auto-finish:** the board shows `⏳ Ends: <Tehran time>` (1h after creation). The
   every-minute sweep finishes the auction once `ends_at` passes and no bid landed in the
   last 30s (anti-snipe). The owner's 🏁 button finishes it immediately.
5. **End:** winner pays `bid − start` (guarded), title transfers to the winner,
   seller cut paid (both balances) when re-auctioning, remainder credited to
   `lottery_pot`. `/top` renders `🏅 {title}` in front of the winner's name.

**Where titles display:** the active title replaces the player's name in `/top`, the
meow reply, the dice reply, and in poker / blackjack (seat names on the lobby, table,
action log and winner messages; bots keep their bot names).

## 5. Rules & edge cases (locked)

1. **3-title cap:** a user can't win an auction if they already hold 3 titles — fall back
   to the next-highest bidder. Owner direct-assign follows the same cap (free a slot first).
2. **Owner cancels (or ends with no bids):** all entry fees are refunded to every
   participant (`TITLE_REFUND`), and the title stays with its owner.
3. **Balance drops between bid and end:** final deduction is guarded
   (`WHERE meow_points >= ?`); if insufficient, fall back to the next-highest bidder.
4. **Bid floor:** first bid = `start + jump` (a bid of exactly `start` would pay nothing
   beyond the entry fee).
5. **Seller response window:** 10 minutes to accept/decline a re-auction prompt; timeout
   or decline → auction cancelled.

## 6. Existing-title re-auction

1. Owner starts an auction for a title that already has an owner.
2. Bot DMs the current owner (seller): "این عنوان حراج میشود — 20٪ ورودیها +
   (پیشنهاد برنده − start) به شما میرسد. میپذیرید؟" with تأیید / رد buttons.
3. If the seller never `/start`'ed the bot, the bot notifies them **in the group** to
   `/start` first, then sends the prompt.
4. Seller accepts → auction opens. Seller is excluded from bidding (#8).
5. End → title transfers, seller cut paid, remainder → lottery pot.

## 7. Data model (per group)

- `titles` — id, group_id, name (UNIQUE per group), owner_user_id, status
  (`owned` | `auctioning`), created_at, last_price
- `group_members.active_title_id` — which of the user's titles shows in `/top`
- `title_auctions` — id, group_id, title_id (nullable for new titles), start, jump,
  current_bid, current_bidder_id, status (`open` | `ended` | `cancelled`),
  board_message_id, created_at, ended_at
- `title_auction_bids` — auction_id, user_id, amount, created_at
- Participants derived from `TITLE_ENTRY` transactions (no refund path exists)
- Transactions reasons: `TITLE_ENTRY`, `TITLE_WIN`, `TITLE_SELLER`
- Proceeds → `telegram_groups.lottery_pot` (visible via existing lottery flow)

## 8. Inline board keyboard

- `✅ شرکت در حراج` (→ user-scoped confirm with the user's name)
- `⬆️ +1k` / `⬆️ +5k` quick bids (flat increments, clamped to the bid floor) · `🔢 Custom bid` (reply with amount) — the board and bid UI are in English
- `🔄 بهروزرسانی`
- `🏁 پایان حراج` · `❌ لغو حراج` (owner only)

All callbacks user-scoped with the existing `:user:{id}` suffix pattern so a tapped
button only acts for the intended user.

## 9. Out of scope

- Cross-group titles (locked: per-group only)
- Title expiry / time-limited titles
- Seller choosing their cut percentage
