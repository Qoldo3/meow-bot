import { sendMessage, answerCallback, editMessageText, deleteMessage } from "./telegram";
import { isOwner } from "./owner";
import { ensureGroup, ensureUser } from "./database";
import { escapeHtml, safeParseAmount, toEnglishNumbers, formatTehranTime } from "./utils";
import {
  TITLE_MAX_PER_USER,
  TITLE_MAX_NAME_LEN,
  TITLE_MAX_EMOJI_LEN,
  TITLE_SELLER_ENTRY_SHARE,
  TITLE_SELLER_TIMEOUT_SEC,
  TITLE_BOARD_REPOST_SEC,
  TITLE_AUCTION_DURATION_SEC,
  TITLE_AUCTION_SNIPE_GRACE_SEC,
  TITLE_TIER_GOLD,
  TITLE_TIER_CROWN,
  TITLE_TIER_DIAMOND,
} from "./constants";
import {
  titleBoardKeyboard,
  titleSellerPromptKeyboard,
  titleJoinConfirmKeyboard,
} from "./keyboards";
import { Bindings, TelegramCallbackQuery, TelegramMessage } from "./types";

// ---------------------------------------------------------------------------
// Pure parsing / math (unit-testable)
// ---------------------------------------------------------------------------

export type TitleInput =
  | { kind: "list" }
  | { kind: "set"; titleId: number }
  | { kind: "text"; name: string }
  | { kind: "start"; name: string; start: number; jump: number }
  | { kind: "remove"; titleId: number | null }
  | { kind: "emoji"; titleId: number | null; emoji: string | null };

export function parseTitleInput(text: string): TitleInput {
  const trimmed = text.trim().replace(/[<>]/g, "").trim();
  let rest = trimmed;
  if (rest.startsWith("/")) rest = rest.slice(1).trim();
  if (rest.startsWith("تایتل")) rest = rest.slice("تایتل".length).trim();
  if (!rest) return { kind: "list" };

  const tokens = rest.split(/\s+/).filter(Boolean);

  // <تایتل 3> — set active title
  if (tokens.length === 1 && /^\d+$/.test(toEnglishNumbers(tokens[0]))) {
    return { kind: "set", titleId: parseInt(toEnglishNumbers(tokens[0]), 10) };
  }

  // <تایتل حذف 5> — remove a title (its owner, or the bot owner for any title)
  if (tokens[0] === "حذف") {
    if (tokens.length >= 2 && /^\d+$/.test(toEnglishNumbers(tokens[1]))) {
      return { kind: "remove", titleId: parseInt(toEnglishNumbers(tokens[1]), 10) };
    }
    return { kind: "remove", titleId: null };
  }

  // <تایتل ایموجی 5 🐯> — set the custom badge emoji for a title
  if (tokens[0] === "ایموجی" || tokens[0] === "emoji") {
    if (tokens.length >= 3 && /^\d+$/.test(toEnglishNumbers(tokens[1]))) {
      const emoji = singleEmoji(tokens.slice(2).join(" "));
      if (emoji) {
        return { kind: "emoji", titleId: parseInt(toEnglishNumbers(tokens[1]), 10), emoji };
      }
    }
    return { kind: "emoji", titleId: null, emoji: null };
  }

  // <تایتل نام start jump> — start an auction (owner)
  if (tokens.length >= 3) {
    const start = safeParseAmount(tokens[tokens.length - 2]);
    const jump = safeParseAmount(tokens[tokens.length - 1]);
    if (start !== null && jump !== null) {
      const name = tokens.slice(0, -2).join(" ").trim();
      if (name) return { kind: "start", name, start, jump };
    }
  }

  // anything else → a title name (suggest or assign)
  return { kind: "text", name: rest.trim() };
}

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/u;

/**
 * Extract exactly one emoji from a string, or null.
 * Accepts a single grapheme containing an emoji codepoint — so multi-codepoint
 * emoji (ZWJ families, skin tones, flags) are fine, but "🐯🐱" or "ab" is not.
 */
export function singleEmoji(s: string): string | null {
  const clean = s.trim();
  if (!clean) return null;
  let graphemes: string[];
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    graphemes = [...segmenter.segment(clean)].map((g) => g.segment);
  } else {
    graphemes = Array.from(clean);
  }
  if (graphemes.length !== 1) return null;
  const g = graphemes[0];
  if (g.length > TITLE_MAX_EMOJI_LEN) return null;
  if (!EMOJI_RE.test(g)) return null;
  return g;
}

/** Badge emoji for a title: a custom emoji if set, else tiered by price paid. */
export function titleEmoji(lastPrice: number | null | undefined, customEmoji?: string | null): string {
  if (customEmoji) return customEmoji;
  if (lastPrice == null) return "🏅";
  if (lastPrice >= TITLE_TIER_DIAMOND) return "💎";
  if (lastPrice >= TITLE_TIER_CROWN) return "👑";
  if (lastPrice >= TITLE_TIER_GOLD) return "🥇";
  return "🏅";
}

/** Bold, tiered display for a title (HTML context — safe to embed directly). */
export function titleBadge(name: string, lastPrice?: number | null, customEmoji?: string | null): string {
  return `${titleEmoji(lastPrice, customEmoji)} <b>${escapeHtml(name)}</b>`;
}

export function titleBidFloor(a: { current_bid: number | null; start_amount: number; jump_amount: number }): number {
  if (a.current_bid == null) return a.start_amount + a.jump_amount;
  return a.current_bid + a.jump_amount;
}

/**
 * Quick-bid amount for the board buttons: flat +1k / +5k increments, clamped to
 * the bid floor so a jump larger than the increment never leaves a button below
 * the minimum bid.
 */
export function quickBidAmount(a: { current_bid: number | null; start_amount: number; jump_amount: number }, mode: string): number {
  const inc = mode === "5k" ? 5000 : 1000;
  const floor = titleBidFloor(a);
  const base = a.current_bid ?? a.start_amount;
  return Math.max(base + inc, floor);
}

/**
 * Auction settlement math.
 * The winning bid includes the winner's entry fee, so at the end the winner
 * pays `bid - start`. The seller (re-auction only) gets 20% of all entry fees
 * plus `bid - start`; everything else goes to the lottery pot.
 */
export function computeTitleSettlement(participantCount: number, startAmount: number, winningBid: number) {
  const totalEntries = participantCount * startAmount;
  const winnerRemainder = winningBid - startAmount;
  const sellerEntryShare = Math.floor(totalEntries * TITLE_SELLER_ENTRY_SHARE);
  const sellerCut = sellerEntryShare + winnerRemainder;
  const pot = totalEntries + winnerRemainder - sellerCut;
  return { totalEntries, winnerRemainder, sellerCut, pot };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface TitleRow {
  id: number;
  telegram_group_id: number;
  name: string;
  owner_user_id: number | null;
  status: string;
}

interface AuctionRow {
  id: number;
  telegram_group_id: number;
  title_id: number | null;
  start_amount: number;
  jump_amount: number;
  current_bid: number | null;
  current_bidder_id: number | null;
  current_bidder_name: string | null;
  status: string;
  board_message_id: number | null;
  created_at: number;
  last_reposted_at: number | null;
  ends_at: number | null;
}

const AUCTION_COLUMNS = `id, telegram_group_id, title_id, start_amount, jump_amount,
  current_bid, current_bidder_id, current_bidder_name, status, board_message_id, created_at, last_reposted_at, ends_at`;

function getAuction(db: D1Database, auctionId: number): Promise<AuctionRow | null> {
  return db.prepare(`SELECT ${AUCTION_COLUMNS} FROM title_auctions WHERE id = ?`).bind(auctionId).first<AuctionRow>();
}

function getTitle(db: D1Database, titleId: number | null): Promise<TitleRow | null> {
  if (titleId == null) return Promise.resolve(null);
  return db.prepare(`SELECT id, telegram_group_id, name, owner_user_id, status FROM titles WHERE id = ?`).bind(titleId).first<TitleRow>();
}

async function getTitleName(db: D1Database, titleId: number | null): Promise<string> {
  const t = await getTitle(db, titleId);
  return t?.name ?? "؟";
}

async function countParticipants(db: D1Database, groupId: number, auctionId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as c FROM transactions WHERE group_id = ? AND reason = ?`)
    .bind(groupId, `TITLE_ENTRY_${auctionId}`)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function isParticipant(db: D1Database, groupId: number, userId: number, auctionId: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason = ? LIMIT 1`)
    .bind(userId, groupId, `TITLE_ENTRY_${auctionId}`)
    .first<{ 1: number }>();
  return !!row;
}

async function checkBalances(db: D1Database, groupId: number, userId: number, amount: number): Promise<boolean> {
  const u = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(userId).first<{ meow_points: number }>();
  const g = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, userId)
    .first<{ meow_points: number }>();
  return !!u && u.meow_points >= amount && !!g && g.meow_points >= amount;
}

/** Guarded debit from both balances; refunds partial applies (all-or-nothing). */
async function debitBoth(db: D1Database, groupId: number, userId: number, amount: number): Promise<boolean> {
  const res = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(amount, userId, amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(amount, groupId, userId, amount),
  ]);
  if (res[0].meta.changes === 0 || res[1].meta.changes === 0) {
    const refunds: any[] = [];
    if (res[0].meta.changes > 0) refunds.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, userId));
    if (res[1].meta.changes > 0) refunds.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(amount, groupId, userId));
    if (refunds.length) await db.batch(refunds);
    return false;
  }
  return true;
}

/** Credit to both balances; the group side upserts in case the row doesn't exist yet. */
async function creditBoth(db: D1Database, groupId: number, userId: number, username: string | null, firstName: string | null, amount: number) {
  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, userId),
    db.prepare(
      `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL)
       ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         meow_points = group_members.meow_points + excluded.meow_points`
    ).bind(groupId, userId, username ?? null, firstName ?? "?", amount),
  ]);
}

function displayName(u: { username?: string | null; first_name?: string | null }): string {
  // Usernames are platform-restricted to [a-zA-Z0-9_], but escape anyway so
  // the helper is always HTML-safe; names that are ALREADY escaped (stored
  // from a previous displayName call) are returned untouched by escapeHtml
  // only for the literal chars — callers re-escape stored names via
  // escapeStoredName() to avoid double-escaping.
  return u.username ? `@${escapeHtml(u.username)}` : escapeHtml(u.first_name ?? "کاربر");
}

/**
 * Names stored on title_auctions (current_bidder_name / winner names) were
 * produced by displayName() which already escapes; escaping again would turn
 * `&lt;` into `&amp;lt;`. Re-escape only the unescaped form.
 */
function escapeStoredName(name: string): string {
  return name.includes("&lt;") || name.includes("&amp;") ? name : escapeHtml(name);
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

interface ParticipantRow {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
}

/** Everyone who paid the entry fee, in join order (names resolved from users). */
async function getParticipants(db: D1Database, groupId: number, auctionId: number): Promise<ParticipantRow[]> {
  const rows = await db
    .prepare(
      `SELECT t.telegram_user_id, u.username, u.first_name
       FROM transactions t
       LEFT JOIN users u ON u.telegram_id = t.telegram_user_id
       WHERE t.group_id = ? AND t.reason = ?
       ORDER BY t.id`
    )
    .bind(groupId, `TITLE_ENTRY_${auctionId}`)
    .all<ParticipantRow>();
  return rows.results;
}

function auctionBoardText(a: AuctionRow, participants: ParticipantRow[], titleName: string) {
  const leader =
    a.current_bid != null && a.current_bidder_name
      ? `🏆 Top bid: <b>${escapeStoredName(a.current_bidder_name)}</b> — ${a.current_bid} MP`
      : `🏆 No bids yet.`;
  const list = participants.length
    ? participants.map((p) => `• ${displayName(p)}`).join("\n")
    : "—";
  const endsAt = a.ends_at != null ? `⏳ Ends: <b>${formatTehranTime(a.ends_at)}</b> (تهران)\n` : "";
  return (
    `🎯 <b>Title Auction</b>\n\n` +
    `🏷️ Title: <b>${escapeHtml(titleName)}</b>\n` +
    endsAt +
    `💵 Entry: <b>${a.start_amount} MP</b>\n` +
    `📈 Jump: <b>${a.jump_amount} MP</b>\n` +
    `👥 Participants (<b>${participants.length}</b>):\n${list}\n\n` +
    leader +
    `\n\n💡 Joining pays the entry fee. Next bid: min <b>${titleBidFloor(a)} MP</b>.`
  );
}

async function postBoard(token: string, db: D1Database, groupId: number, auctionId: number) {
  const a = await getAuction(db, auctionId);
  if (!a || a.board_message_id || a.status !== "open") return;
  const titleName = await getTitleName(db, a.title_id);
  const participants = await getParticipants(db, groupId, auctionId);
  const sent = await sendMessage(token, groupId, auctionBoardText(a, participants, titleName), {
    reply_markup: titleBoardKeyboard(auctionId),
  });
  if (sent.ok && sent.result?.message_id) {
    await db
      .prepare(`UPDATE title_auctions SET board_message_id = ?, last_reposted_at = ? WHERE id = ? AND board_message_id IS NULL`)
      .bind(sent.result.message_id, Math.floor(Date.now() / 1000), auctionId)
      .run();
  }
}

/**
 * Refresh the live board. By default edits the message in place; re-posts as a
 * fresh message (deleting the old one) when forceRepost is true (e.g. on bids)
 * or at least TITLE_BOARD_REPOST_SEC seconds since the last re-post.
 */
async function renderBoard(token: string, db: D1Database, auctionId: number, forceRepost = false) {
  const a = await getAuction(db, auctionId);
  // Only touch live boards: a concurrent finish (owner button or sweep) may
  // have claimed the auction between the write and this render — editing over
  // its result message would silently lose the settlement announcement.
  if (!a || !a.board_message_id || a.status !== "open") return;
  const titleName = await getTitleName(db, a.title_id);
  const participants = await getParticipants(db, a.telegram_group_id, auctionId);
  const text = auctionBoardText(a, participants, titleName);
  const now = Math.floor(Date.now() / 1000);
  const due = forceRepost || a.last_reposted_at == null || now - a.last_reposted_at >= TITLE_BOARD_REPOST_SEC;

  if (!due) {
    await editMessageText(token, a.telegram_group_id, a.board_message_id, text, titleBoardKeyboard(auctionId));
    return;
  }

  const sent = await sendMessage(token, a.telegram_group_id, text, {
    reply_markup: titleBoardKeyboard(auctionId),
  });
  if (sent.ok && sent.result?.message_id) {
    const newId = sent.result.message_id;
    const oldId = a.board_message_id;
    // Guarded swap: if a concurrent render already re-pointed the board to a
    // newer message, we lost the race — delete OUR message instead of theirs.
    const upd = await db
      .prepare(`UPDATE title_auctions SET board_message_id = ?, last_reposted_at = ? WHERE id = ? AND board_message_id = ?`)
      .bind(newId, now, auctionId, oldId)
      .run();
    if (upd.meta.changes === 0) {
      await deleteMessage(token, a.telegram_group_id, newId);
      return;
    }
    if (newId !== oldId) {
      await deleteMessage(token, a.telegram_group_id, oldId);
    }
  }
}

/** Refund the entry fee to everyone who joined; returns the number refunded. */
async function refundAuctionParticipants(db: D1Database, a: AuctionRow, now: number): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT t.telegram_user_id, u.username, u.first_name
       FROM transactions t
       LEFT JOIN users u ON u.telegram_id = t.telegram_user_id
       WHERE t.group_id = ? AND t.reason = ?`
    )
    .bind(a.telegram_group_id, `TITLE_ENTRY_${a.id}`)
    .all<{ telegram_user_id: number; username: string | null; first_name: string | null }>();
  if (!rows.results.length) return 0;

  const stmts: any[] = [];
  for (const r of rows.results) {
    stmts.push(
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(a.start_amount, r.telegram_user_id),
      db.prepare(
        `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at)
         VALUES (?, ?, ?, ?, ?, 0, NULL)
         ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
           username = excluded.username,
           first_name = excluded.first_name,
           meow_points = group_members.meow_points + excluded.meow_points`
      ).bind(a.telegram_group_id, r.telegram_user_id, r.username ?? null, r.first_name ?? "?", a.start_amount),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(r.telegram_user_id, a.telegram_group_id, a.start_amount, `TITLE_REFUND_${a.id}`, now),
    );
  }
  // 3 statements per participant — chunk for D1's 100-statement batch cap and
  // the Free plan's 50 queries-per-invocation limit (each statement counts).
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
  return rows.results.length;
}

async function cancelAuction(db: D1Database, a: AuctionRow, now: number) {
  // Whole money goes back to the participants (entry fees are escrowed).
  await refundAuctionParticipants(db, a, now);
  await db.batch([
    db.prepare(`UPDATE title_auctions SET status = 'cancelled', ended_at = ? WHERE id = ?`).bind(now, a.id),
    // Only brand-new (unowned) titles are removed; owned titles keep their owner.
    db.prepare(`DELETE FROM titles WHERE id = ? AND owner_user_id IS NULL`).bind(a.title_id),
  ]);
}

/**
 * Owner-only: cancel a live auction (refunds entry fees to participants and
 * edits the board message). Returns a short status string for the caller.
 * Reused by the owner panel (🏷️ auctions page) and the board's ❌ Cancel button.
 */
export async function cancelAuctionById(
  token: string,
  db: D1Database,
  auctionId: number,
  chatId: number
): Promise<string> {
  const a = await getAuction(db, auctionId);
  if (!a || a.telegram_group_id !== chatId || a.status !== "open") {
    return "❌ حراج فعال نیست.";
  }
  const claim = await db.prepare(`UPDATE title_auctions SET status = 'cancelling' WHERE id = ? AND status = 'open'`).bind(auctionId).run();
  if (claim.meta.changes === 0) {
    return "❌ حراج در حال پایان است.";
  }
  const claimedAuction = await getAuction(db, auctionId);
  if (!claimedAuction) {
    return "❌ حراج پیدا نشد.";
  }
  const title = await getTitle(db, claimedAuction.title_id);
  await cancelAuction(db, claimedAuction, Math.floor(Date.now() / 1000));
  if (a.board_message_id) {
    await editMessageText(token, chatId, a.board_message_id, `❌ حراج عنوان <b>${escapeHtml(title?.name ?? "؟")}</b> توسط صاحب ربات لغو شد.\n\nورودی‌ها به شرکت‌کنندگان بازگردانده شد.`);
  }
  return "حراج لغو شد.";
}

/** Render a bot command inside a <code> block with angle brackets escaped, so
 *  Telegram's HTML parser doesn't mistake <تایتل …> for an (unsupported) tag. */
const codeCmd = (t: string) => `<code>${escapeHtml(t)}</code>`;

const OWNER_HELP_TEXT =
  `⚙️ <b>مدیریت عنوان (صاحب ربات)</b>\n` +
  `• حراج جدید: ${codeCmd(`<تایتل نام 1000 100>`)} \n` +
  `• اختصاص مستقیم: روی پیام کاربر ریپلای کن + ${codeCmd(`<تایتل نام>`)} \n` +
  `• تغییر نشان هر عنوان: ${codeCmd(`<تایتل ایموجی شناسه ایموجی>`)} \n` +
  `• حذف هر عنوان: ${codeCmd(`<تایتل حذف شناسه>`)} \n` +
  `• پایان حراج: دکمه 🏁 روی پیام حراج\n` +
  `• حراج عنوان موجود: مالک قبلی در پیوی تأیید می‌کند`;

// ---------------------------------------------------------------------------
// Text commands
// ---------------------------------------------------------------------------

export async function handleTitle(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") {
    await sendMessage(token, message.chat.id, "🐱 عنوان‌ها فقط داخل گروه کار می‌کنند!");
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const groupId = message.chat.id;
  const userId = message.from.id;
  const owner = isOwner(env, userId);
  const input = parseTitleInput(message.text || "");

  // Owner replying to a user: bare `تایتل` lists that user's titles;
  // a name assigns it directly (locked decision #6).
  const replyTarget = message.reply_to_message?.from;
  if (owner && replyTarget) {
    if (replyTarget.is_bot) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌توانی به ربات عنوان بدهی!");
      return;
    }
    if (input.kind === "list") {
      await showMyTitles(token, db, groupId, replyTarget.id, owner, message, replyTarget);
      return;
    }
    if (input.kind === "text" || input.kind === "start") {
      await assignTitle(token, db, groupId, replyTarget, input.name, message);
      return;
    }
  }

  if (input.kind === "list") {
    await showMyTitles(token, db, groupId, userId, owner, message);
    return;
  }

  if (input.kind === "set") {
    await setActiveTitle(token, db, groupId, userId, input.titleId, message);
    return;
  }

  if (input.kind === "remove") {
    await removeTitle(token, db, groupId, userId, owner, input.titleId, message);
    return;
  }

  if (input.kind === "emoji") {
    await setTitleEmoji(token, db, groupId, userId, owner, input.titleId, input.emoji, message);
    return;
  }

  if (input.kind === "start") {
    if (!owner) {
      // Non-owners can only suggest — ignore the amounts.
      await suggestTitle(token, db, env, groupId, input.name, message);
      return;
    }
    await startAuction(token, db, env, groupId, message);
    return;
  }

  await suggestTitle(token, db, env, groupId, input.name, message);
}

async function showMyTitles(
  token: string,
  db: D1Database,
  groupId: number,
  userId: number,
  owner: boolean,
  message: TelegramMessage,
  target?: { id: number; username?: string | null; first_name?: string }
) {
  const subjectId = target?.id ?? userId;
  const subjectLabel = target ? displayName(target) : "شما";
  const titles = await db
    .prepare(`SELECT id, name, status, last_price, emoji FROM titles WHERE telegram_group_id = ? AND owner_user_id = ? ORDER BY id`)
    .bind(groupId, subjectId)
    .all<{ id: number; name: string; status: string; last_price: number | null; emoji: string | null }>();

  const member = await db
    .prepare(`SELECT active_title_id FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, subjectId)
    .first<{ active_title_id: number | null }>();

  if (!titles.results.length) {
    let text = target
      ? `🏅 <b>${subjectLabel}</b> هنوز عنوانی در این گروه ندارد.`
      : `🏅 شما هنوز عنوانی در این گروه ندارید.\n\nبرای کسب عنوان، در حراج‌های گروه شرکت کنید (دکمه «✅ شرکت در حراج» روی پیام حراج).`;
    if (owner && !target) text += `\n\n${OWNER_HELP_TEXT}`;
    await sendMessage(token, message.chat.id, text);
    return;
  }

  const lines = titles.results.map((t, i) => {
    const active = t.id === member?.active_title_id ? " — ✅ فعال" : "";
    const price = t.last_price != null ? ` — ${t.last_price.toLocaleString("en-US")} MP` : "";
    return `${i + 1}. [${t.id}] ${titleBadge(t.name, t.last_price, t.emoji)}${price}${active}`;
  });

  let text = `🏅 <b>عنوان‌های ${subjectLabel}</b> (این گروه)\n\n${lines.join("\n")}`;
  if (!target) {
    text +=
      `\n\nبرای نمایش یکی از عنوان‌ها در /top:\n${codeCmd(`<تایتل ${titles.results[0].id}>`)}\n` +
      `برای تغییر نشان یک عنوان:\n${codeCmd(`<تایتل ایموجی ${titles.results[0].id} ایموجی>`)} \n` +
      `برای حذف یکی از عنوان‌ها:\n${codeCmd(`<تایتل حذف ${titles.results[0].id}>`)}`;
    if (owner) text += `\n\n${OWNER_HELP_TEXT}`;
  }

  await sendMessage(token, message.chat.id, text);
}

async function setActiveTitle(token: string, db: D1Database, groupId: number, userId: number, titleId: number, message: TelegramMessage) {
  const title = await db
    .prepare(`SELECT id, name FROM titles WHERE id = ? AND telegram_group_id = ? AND owner_user_id = ?`)
    .bind(titleId, groupId, userId)
    .first<{ id: number; name: string }>();

  if (!title) {
    await sendMessage(token, message.chat.id, "🐱 این عنوان برای شما نیست یا وجود ندارد. با <code>تایتل</code> عنوان‌های خود را ببینید.");
    return;
  }

  await db
    .prepare(
      `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, active_title_id)
       VALUES (?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         active_title_id = excluded.active_title_id`
    )
    .bind(groupId, userId, message.from?.username ?? null, message.from?.first_name ?? "?", titleId)
    .run();

  await sendMessage(token, message.chat.id, `✅ عنوان <b>${escapeHtml(title.name)}</b> فعال شد و در /top نمایش داده می‌شود.`);
}

async function suggestTitle(token: string, db: D1Database, env: Bindings, groupId: number, name: string, message: TelegramMessage) {
  const cleanName = name.trim();
  if (!cleanName) return;

  if (cleanName.length > TITLE_MAX_NAME_LEN) {
    await sendMessage(token, message.chat.id, `🐱 طول عنوان حداکثر ${TITLE_MAX_NAME_LEN} کاراکتر است.`);
    return;
  }

  const dup = await db
    .prepare(`SELECT id, owner_user_id FROM titles WHERE telegram_group_id = ? AND name = ? COLLATE NOCASE`)
    .bind(groupId, cleanName)
    .first<{ id: number; owner_user_id: number | null }>();

  if (dup) {
    const owned = dup.owner_user_id != null;
    await sendMessage(
      token,
      message.chat.id,
      owned
        ? `🏷️ عنوان <b>${escapeHtml(cleanName)}</b> قبلاً در این گروه وجود دارد.\nبرای حراج آن، صاحب ربات می‌تواند با ${codeCmd(`<تایتل ${cleanName} 1000 100>`)} حراج راه بیندازد.`
        : `🏷️ عنوان <b>${escapeHtml(cleanName)}</b> در حال حراج است.`
    );
    return;
  }

  const suggester = displayName(message.from ?? {});
  const groupLabel = message.chat.title ? escapeHtml(message.chat.title) : String(groupId);
  const ownerText =
    `🏷️ <b>پیشنهاد عنوان جدید</b>\n\n` +
    `عنوان: <b>${escapeHtml(cleanName)}</b>\n` +
    `پیشنهاددهنده: ${suggester}\n` +
    `گروه: ${groupLabel}\n\n` +
    `برای شروع حراج در گروه:\n${codeCmd(`<تایتل ${cleanName} 1000 100>`)}`;
  const ownerId = parseInt(env.BOT_OWNER_ID, 10);
  if (Number.isFinite(ownerId)) {
    await sendMessage(token, ownerId, ownerText);
  }

  await sendMessage(token, message.chat.id, `✅ پیشنهاد <b>${escapeHtml(cleanName)}</b> برای صاحب ربات ارسال شد.`);
}

async function assignTitle(token: string, db: D1Database, groupId: number, target: { id: number; username?: string | null; first_name?: string }, name: string, message: TelegramMessage) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > TITLE_MAX_NAME_LEN) {
    await sendMessage(token, message.chat.id, `🐱 نام عنوان نامعتبر است (حداکثر ${TITLE_MAX_NAME_LEN} کاراکتر).`);
    return;
  }

  const dup = await db
    .prepare(`SELECT id FROM titles WHERE telegram_group_id = ? AND name = ? COLLATE NOCASE`)
    .bind(groupId, cleanName)
    .first<{ id: number }>();
  if (dup) {
    await sendMessage(token, message.chat.id, `🏷️ عنوان <b>${escapeHtml(cleanName)}</b> قبلاً در این گروه وجود دارد.`);
    return;
  }

  const count = await db
    .prepare(`SELECT COUNT(*) as c FROM titles WHERE telegram_group_id = ? AND owner_user_id = ?`)
    .bind(groupId, target.id)
    .first<{ c: number }>();
  if ((count?.c ?? 0) >= TITLE_MAX_PER_USER) {
    await sendMessage(token, message.chat.id, `🐱 این کاربر ${TITLE_MAX_PER_USER} عنوان دارد و ظرفیتش پر است.`);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const res = await db
    .prepare(`INSERT INTO titles (telegram_group_id, name, owner_user_id, status, created_at) VALUES (?, ?, ?, 'owned', ?)`)
    .bind(groupId, cleanName, target.id, now)
    .run();
  const titleId = res.meta?.last_row_id ?? null;

  // Set as active if the target has no active title yet.
  const member = await db
    .prepare(`SELECT active_title_id FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, target.id)
    .first<{ active_title_id: number | null }>();
  if (titleId != null && (!member || member.active_title_id == null)) {
    await db
      .prepare(
        `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, active_title_id)
         VALUES (?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
           username = excluded.username,
           first_name = excluded.first_name,
           active_title_id = excluded.active_title_id`
      )
      .bind(groupId, target.id, target.username ?? null, target.first_name ?? "?", titleId)
      .run();
  }

  await sendMessage(token, message.chat.id, `✅ عنوان <b>${escapeHtml(cleanName)}</b> به ${displayName(target)} داده شد.`);
}

async function removeTitle(token: string, db: D1Database, groupId: number, userId: number, owner: boolean, titleId: number | null, message: TelegramMessage) {
  if (titleId == null) {
    await sendMessage(token, message.chat.id, `🐱 برای حذف عنوان، شناسه آن را بفرست: ${codeCmd(`<تایتل حذف شناسه>`)}`);
    return;
  }

  const title = await db
    .prepare(`SELECT id, name, owner_user_id FROM titles WHERE id = ? AND telegram_group_id = ?`)
    .bind(titleId, groupId)
    .first<{ id: number; name: string; owner_user_id: number | null }>();

  if (!title) {
    await sendMessage(token, message.chat.id, "🐱 این عنوان در این گروه وجود ندارد.");
    return;
  }

  // A user can only remove their own titles; the owner can remove any.
  if (!owner && title.owner_user_id !== userId) {
    await sendMessage(token, message.chat.id, "🐱 فقط مالک عنوان یا صاحب ربات می‌تواند آن را حذف کند.");
    return;
  }

  // Never remove a title that is being auctioned (also while a settlement is
  // in flight — the winner would pay for a title that no longer exists).
  const activeAuction = await db
    .prepare(`SELECT id FROM title_auctions WHERE title_id = ? AND status IN ('pending_seller','open','settling','cancelling') LIMIT 1`)
    .bind(titleId)
    .first<{ id: number }>();
  if (activeAuction) {
    await sendMessage(token, message.chat.id, "🎯 این عنوان در حال حراج است و تا پایان حراج قابل حذف نیست.");
    return;
  }

  await db.batch([
    db.prepare(`DELETE FROM titles WHERE id = ? AND telegram_group_id = ?`).bind(titleId, groupId),
    db.prepare(`UPDATE group_members SET active_title_id = NULL WHERE telegram_group_id = ? AND active_title_id = ?`).bind(groupId, titleId),
  ]);

  await sendMessage(token, message.chat.id, `🗑️ عنوان <b>${escapeHtml(title.name)}</b> حذف شد.`);
}

async function setTitleEmoji(token: string, db: D1Database, groupId: number, userId: number, owner: boolean, titleId: number | null, emoji: string | null, message: TelegramMessage) {
  if (titleId == null) {
    await sendMessage(token, message.chat.id, `🐱 برای تغییر نشان، شناسه و ایموجی عنوان را بفرست: ${codeCmd(`<تایتل ایموجی شناسه ایموجی>`)}`);
    return;
  }

  const single = singleEmoji(emoji ?? "");
  if (!single) {
    await sendMessage(token, message.chat.id, `🐱 نشان باید دقیقاً یک ایموجی باشد: ${codeCmd(`<تایتل ایموجی شناسه ایموجی>`)}`);
    return;
  }

  const title = await db
    .prepare(`SELECT id, name, owner_user_id FROM titles WHERE id = ? AND telegram_group_id = ?`)
    .bind(titleId, groupId)
    .first<{ id: number; name: string; owner_user_id: number | null }>();

  if (!title) {
    await sendMessage(token, message.chat.id, "🐱 این عنوان در این گروه وجود ندارد.");
    return;
  }

  // The title's owner can set its emoji; the bot owner can set any.
  if (!owner && title.owner_user_id !== userId) {
    await sendMessage(token, message.chat.id, "🐱 فقط مالک عنوان یا صاحب ربات می‌تواند نشان آن را تغییر دهد.");
    return;
  }

  // Emojis are unique per group — no two titles may share the same badge.
  const dup = await db
    .prepare(`SELECT id FROM titles WHERE telegram_group_id = ? AND emoji = ? AND id != ?`)
    .bind(groupId, single, titleId)
    .first<{ id: number }>();
  if (dup) {
    await sendMessage(token, message.chat.id, "🐱 این ایموجی قبلاً برای عنوان دیگری در این گروه استفاده شده است. هر نشان فقط یک بار قابل استفاده است.");
    return;
  }

  await db
    .prepare(`UPDATE titles SET emoji = ? WHERE id = ? AND telegram_group_id = ?`)
    .bind(single, titleId, groupId)
    .run();

  await sendMessage(token, message.chat.id, `✅ نشان عنوان <b>${escapeHtml(title.name)}</b> به «${single}» تغییر کرد.`);
}

async function startAuction(token: string, db: D1Database, env: Bindings, groupId: number, message: TelegramMessage) {
  const input = parseTitleInput(message.text || "");
  if (input.kind !== "start" || !message.from) return;
  const { name, start, jump } = input;

  if (name.length > TITLE_MAX_NAME_LEN) {
    await sendMessage(token, message.chat.id, `🐱 طول عنوان حداکثر ${TITLE_MAX_NAME_LEN} کاراکتر است.`);
    return;
  }

  const active = await db
    .prepare(`SELECT id FROM title_auctions WHERE telegram_group_id = ? AND status IN ('pending_seller','open') LIMIT 1`)
    .bind(groupId)
    .first<{ id: number }>();
  if (active) {
    await sendMessage(token, message.chat.id, "🎯 یک حراج فعال در این گروه وجود دارد. اول آن را تمام یا لغو کنید.");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare(`SELECT id, name, owner_user_id FROM titles WHERE telegram_group_id = ? AND name = ? COLLATE NOCASE`)
    .bind(groupId, name)
    .first<{ id: number; name: string; owner_user_id: number | null }>();

  let titleId: number | null;
  if (existing) {
    titleId = existing.id;
  } else {
    const r = await db
      .prepare(`INSERT INTO titles (telegram_group_id, name, owner_user_id, status, created_at) VALUES (?, ?, NULL, 'auctioning', ?)`)
      .bind(groupId, name, now)
      .run();
    titleId = r.meta?.last_row_id ?? null;
  }

  const sellerId = existing?.owner_user_id ?? null;
  const needsSeller = sellerId != null && sellerId !== message.from.id;
  const status = needsSeller ? "pending_seller" : "open";

  const res = await db
    .prepare(`INSERT INTO title_auctions (telegram_group_id, title_id, start_amount, jump_amount, status, created_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(groupId, titleId, start, jump, status, now, now + TITLE_AUCTION_DURATION_SEC)
    .run();
  const auctionId = res.meta?.last_row_id;
  if (!auctionId) {
    await sendMessage(token, message.chat.id, "❌ خطا در شروع حراج.");
    return;
  }

  if (needsSeller) {
    const sellerPrompt =
      `🏷️ عنوان <b>${escapeHtml(name)}</b> که در اختیار شماست، در گروه حراج می‌شود.\n\n` +
      `در پایان دریافت می‌کنید:\n` +
      `20٪ از مجموع ورودی‌ها + (پیشنهاد برنده − ورودی)\n\n` +
      `تأیید می‌کنید؟`;
    const dm = await sendMessage(token, sellerId, sellerPrompt, { reply_markup: titleSellerPromptKeyboard(auctionId) });
    if (!dm.ok) {
      // The seller never /start'ed the bot → ask them in-group first.
      await sendMessage(token, groupId, `📩 مالک فعلی عنوان — لطفاً ربات را در پیوی استارت کنید تا تأیید حراج عنوان «${escapeHtml(name)}» برایتان ارسال شود.`);
    }
    await sendMessage(token, groupId, `🎯 حراج عنوان <b>${escapeHtml(name)}</b> شروع شد (ورودی ${start} MP، پرش ${jump} MP).\nمنتظر تأیید مالک فعلی…`);
    return;
  }

  await db.prepare(`UPDATE title_auctions SET status = 'open' WHERE id = ?`).bind(auctionId).run();
  await postBoard(token, db, groupId, auctionId);
}

// ---------------------------------------------------------------------------
// Callback actions
// ---------------------------------------------------------------------------

export async function handleTitleCallback(token: string, db: D1Database, env: Bindings, callback: TelegramCallbackQuery) {
  if (!callback.message || !callback.data) return;
  const chatId = callback.message.chat.id;
  const userId = callback.from.id;
  const parts = callback.data.split(":");
  const sub = parts[1];

  if (sub === "join") {
    const action = parts[2];
    if (action === "confirm") {
      await handleJoinConfirm(token, db, callback, parseInt(parts[3], 10), parseInt(parts[4], 10));
    } else if (action === "decline") {
      await handleJoinDecline(token, db, callback, parseInt(parts[3], 10), parseInt(parts[4], 10));
    } else {
      await handleJoin(token, db, callback, parseInt(parts[2], 10));
    }
    return;
  }

  if (sub === "bid") {
    await handleBid(token, db, callback, parseInt(parts[2], 10), parts[3] ?? "jump");
    return;
  }

  const auctionId = parseInt(parts[2], 10);

  if (sub === "refresh") {
    const a = await getAuction(db, auctionId);
    // Only refresh live auctions — refreshing an ended board would clobber the result text.
    if (!a || a.telegram_group_id !== chatId || a.status !== "open") {
      await answerCallback(token, callback.id, "❌ حراج فعال نیست.", true);
      return;
    }
    await renderBoard(token, db, auctionId);
    await answerCallback(token, callback.id, "🔄 به‌روزرسانی شد.");
    return;
  }

  if (sub === "end") {
    await handleEnd(token, db, env, callback, auctionId);
    return;
  }

  if (sub === "cancel") {
    if (!isOwner(env, userId)) {
      await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
      return;
    }
    const msg = await cancelAuctionById(token, db, auctionId, chatId);
    await answerCallback(token, callback.id, msg, msg.startsWith("❌"));
    return;
  }

  if (sub === "seller") {
    const action = parts[2];
    const sellerAuctionId = parseInt(parts[3], 10);
    await handleSellerAction(token, db, callback, action, sellerAuctionId);
    return;
  }

  await answerCallback(token, callback.id);
}

async function handleJoin(token: string, db: D1Database, callback: TelegramCallbackQuery, auctionId: number) {
  if (!callback.message || !callback.from) return;
  const a = await getAuction(db, auctionId);
  if (!a || a.status !== "open" || a.telegram_group_id !== callback.message.chat.id) {
    await answerCallback(token, callback.id, "❌ این حراج فعال نیست.", true);
    return;
  }
  if (a.ends_at != null && a.ends_at <= Math.floor(Date.now() / 1000)) {
    await answerCallback(token, callback.id, "❌ این حراج تمام شده است.", true);
    return;
  }
  if (await isParticipant(db, a.telegram_group_id, callback.from.id, auctionId)) {
    await answerCallback(token, callback.id, "✅ شما قبلاً در این حراج شرکت کرده‌اید.", true);
    return;
  }
  if (!(await checkBalances(db, a.telegram_group_id, callback.from.id, a.start_amount))) {
    await answerCallback(token, callback.id, `🐱 موجودی کافی نیست (نیاز: ${a.start_amount} MP).`, true);
    return;
  }
  const titleName = await getTitleName(db, a.title_id);
  await sendMessage(
    token,
    callback.message.chat.id,
    `✅ <b>${displayName(callback.from)}</b> — با پرداخت <b>${a.start_amount} MP</b> در حراج عنوان «${escapeHtml(titleName)}» شرکت می‌کنید؟`,
    { reply_markup: titleJoinConfirmKeyboard(auctionId, callback.from.id) }
  );
  await answerCallback(token, callback.id);
}

async function handleJoinConfirm(token: string, db: D1Database, callback: TelegramCallbackQuery, auctionId: number, targetUserId: number) {
  if (!callback.message || !callback.from) return;
  if (callback.from.id !== targetUserId) {
    await answerCallback(token, callback.id, "🚫 این دکمه فقط برای خودتان است.", true);
    return;
  }
  const a = await getAuction(db, auctionId);
  if (!a || a.status !== "open") {
    await answerCallback(token, callback.id, "❌ حراج فعال نیست.", true);
    return;
  }
  if (await isParticipant(db, a.telegram_group_id, callback.from.id, auctionId)) {
    await answerCallback(token, callback.id, "✅ شما قبلاً شرکت کرده‌اید.", true);
    return;
  }
  if (!(await debitBoth(db, a.telegram_group_id, callback.from.id, a.start_amount))) {
    await answerCallback(token, callback.id, `🐱 موجودی کافی نیست (نیاز: ${a.start_amount} MP).`, true);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  // The entry INSERT is guarded by the auction still being open and the user
  // not already joined, so a join racing a cancel/settle claim (or a double
  // join) fails atomically instead of inserting an entry that never gets
  // refunded by the claim path. If the guard rejects, refund the debit.
  const entry = await db
    .prepare(
      `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM title_auctions WHERE id = ? AND status = 'open' AND (ends_at IS NULL OR ends_at > ?))
         AND NOT EXISTS (SELECT 1 FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason = ?)`
    )
    .bind(callback.from.id, a.telegram_group_id, -a.start_amount, `TITLE_ENTRY_${auctionId}`, now, auctionId, now, callback.from.id, a.telegram_group_id, `TITLE_ENTRY_${auctionId}`)
    .run();
  if (entry.meta.changes === 0) {
    // The auction was claimed (cancelling/settling) or the user already
    // joined concurrently — give the money back.
    await creditBoth(db, a.telegram_group_id, callback.from.id, callback.from.username ?? null, callback.from.first_name ?? null, a.start_amount);
    await answerCallback(token, callback.id, "❌ حراج در حال پایان است. مبلغ شما بازگردانده شد.", true);
    return;
  }
  await editMessageText(
    token,
    callback.message.chat.id,
    callback.message.message_id,
    `✅ <b>${displayName(callback.from)}</b> با پرداخت ${a.start_amount} MP در حراج شرکت کرد.`
  );
  await renderBoard(token, db, auctionId);
  await answerCallback(token, callback.id, "✅ در حراج شرکت کردید!");
}

async function handleJoinDecline(token: string, db: D1Database, callback: TelegramCallbackQuery, auctionId: number, targetUserId: number) {
  if (!callback.message || !callback.from) return;
  if (callback.from.id !== targetUserId) {
    await answerCallback(token, callback.id, "🚫 این دکمه فقط برای خودتان است.", true);
    return;
  }
  await editMessageText(token, callback.message.chat.id, callback.message.message_id, "❌ شرکت در حراج لغو شد.");
  await answerCallback(token, callback.id);
}

async function handleBid(token: string, db: D1Database, callback: TelegramCallbackQuery, auctionId: number, mode: string) {
  if (!callback.message || !callback.from) return;
  const chatId = callback.message.chat.id;
  const a = await getAuction(db, auctionId);
  if (!a || a.status !== "open" || a.telegram_group_id !== chatId) {
    await answerCallback(token, callback.id, "❌ حراج فعال نیست.", true);
    return;
  }
  if (a.ends_at != null && a.ends_at <= Math.floor(Date.now() / 1000)) {
    await answerCallback(token, callback.id, "❌ این حراج تمام شده است.", true);
    return;
  }

  if (mode === "custom") {
    const floor = titleBidFloor(a);
    await sendMessage(
      token,
      chatId,
      `📝 <b>${displayName(callback.from)}</b> — reply to the auction message with your bid amount (min <b>${floor} MP</b>).`
    );
    await answerCallback(token, callback.id);
    return;
  }

  if (!(await isParticipant(db, a.telegram_group_id, callback.from.id, auctionId))) {
    await answerCallback(token, callback.id, "🐱 Join the auction first (✅ Join button).", true);
    return;
  }

  // Spec #8: the seller can't bid on their own title.
  const bidTitle = await getTitle(db, a.title_id);
  if (bidTitle?.owner_user_id != null && bidTitle.owner_user_id === callback.from.id) {
    await answerCallback(token, callback.id, "🚫 You own this title and can't bid on it.", true);
    return;
  }

  const amount = quickBidAmount(a, mode);

  if (!(await checkBalances(db, a.telegram_group_id, callback.from.id, amount))) {
    await answerCallback(token, callback.id, `🐱 Not enough balance (bid: ${amount} MP).`, true);
    return;
  }    const recorded = await recordBid(db, a.id, callback.from.id, displayName(callback.from), amount);
    if (!recorded) {
      await answerCallback(token, callback.id, "🐱 این پیشنهاد دیگر از حداقل قیمت پایین‌تر است؛ صفحه را تازه کن.", true);
      return;
    }
    await renderBoard(token, db, a.id);
    await answerCallback(token, callback.id, `✅ Bid of ${amount} MP placed.`);
}

/** Custom bid via replying to the board message with a number. Returns true when consumed. */
export async function handleTitleReplyBid(token: string, db: D1Database, env: Bindings, message: TelegramMessage): Promise<boolean> {
  const reply = message.reply_to_message;
  if (!reply || !message.from) return false;
  if (message.chat.type !== "group" && message.chat.type !== "supergroup") return false;

  const amount = safeParseAmount(message.text || "");
  if (amount === null) return false;

  const a = await db
    .prepare(`SELECT ${AUCTION_COLUMNS} FROM title_auctions WHERE telegram_group_id = ? AND status = 'open' AND board_message_id = ?`)
    .bind(message.chat.id, reply.message_id)
    .first<AuctionRow>();
  if (!a) return false;

  if (a.ends_at != null && a.ends_at <= Math.floor(Date.now() / 1000)) {
    await sendMessage(token, message.chat.id, "❌ این حراج تمام شده است.", { reply_to_message_id: message.message_id });
    return true;
  }

  if (!(await isParticipant(db, message.chat.id, message.from.id, a.id))) {
    await sendMessage(token, message.chat.id, "🐱 Join the auction first (✅ Join button).", { reply_to_message_id: message.message_id });
    return true;
  }

  // Spec #8: the seller can't bid on their own title.
  const bidTitle = await getTitle(db, a.title_id);
  if (bidTitle?.owner_user_id != null && bidTitle.owner_user_id === message.from.id) {
    await sendMessage(token, message.chat.id, "🚫 You own this title and can't bid on it.", { reply_to_message_id: message.message_id });
    return true;
  }

  const floor = titleBidFloor(a);
  if (amount < floor) {
    await sendMessage(token, message.chat.id, `🐱 Bid must be at least <b>${floor} MP</b>.`, { reply_to_message_id: message.message_id });
    return true;
  }

  if (!(await checkBalances(db, message.chat.id, message.from.id, amount))) {
    await sendMessage(token, message.chat.id, `🐱 Not enough balance (bid: ${amount} MP).`, { reply_to_message_id: message.message_id });
    return true;
  }

  const recorded = await recordBid(db, a.id, message.from.id, displayName(message.from), amount);
  if (!recorded) {
    await sendMessage(token, message.chat.id, "🐱 این پیشنهاد دیگر از حداقل قیمت پایین‌تر است؛ دوباره تلاش کن.", { reply_to_message_id: message.message_id });
    return true;
  }
  await renderBoard(token, db, a.id, true);
  await sendMessage(token, message.chat.id, `✅ Bid of <b>${amount} MP</b> placed.`, { reply_to_message_id: message.message_id });
  return true;
}

async function recordBid(db: D1Database, auctionId: number, userId: number, name: string, amount: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  // Claim the new floor and write the bid history in ONE batch: both see the
  // same snapshot, so the claim can never commit while the bid row is rejected
  // (a claim-then-insert split would leave current_bid advanced with no bid
  // row when the auction gets claimed for settling in between).
  const res = await db.batch([
    db.prepare(
      `UPDATE title_auctions
       SET current_bid = ?, current_bidder_id = ?, current_bidder_name = ?
       WHERE id = ? AND status = 'open'
         AND (ends_at IS NULL OR ends_at > ?)
         AND ((current_bid IS NULL AND ? >= start_amount + jump_amount)
           OR (current_bid IS NOT NULL AND ? >= current_bid + jump_amount))`
    ).bind(amount, userId, name, auctionId, now, amount, amount),
    db.prepare(
      `INSERT INTO title_auction_bids (auction_id, telegram_user_id, amount, created_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM title_auctions WHERE id = ? AND status = 'open')`
    ).bind(auctionId, userId, amount, now, auctionId),
  ]);
  return res[1].meta.changes > 0;
}

// ---------------------------------------------------------------------------
// End / settlement
// ---------------------------------------------------------------------------

/**
 * Settle or cancel an open auction and post the result to its board message.
 * Shared by the owner's 🏁 button and the every-minute sweep (auto-finish).
 * Returns true when the auction was open and got finished.
 */
export async function finishAuction(token: string, db: D1Database, auctionId: number): Promise<boolean> {
  // Claim the auction first so the owner button and cron sweep cannot settle
  // the same auction concurrently. ended_at doubles as the settling-start
  // stamp: it is written again by the final settlement batch / cancelAuction,
  // and recoverStuckSettlingAuctions uses it to only touch auctions that have
  // been settling for a while (created_at is the auction start — a 1-hour
  // auction would otherwise be claimable the minute it enters 'settling').
  const claim = await db.prepare(`UPDATE title_auctions SET status = 'settling', ended_at = ? WHERE id = ? AND status = 'open'`).bind(Math.floor(Date.now() / 1000), auctionId).run();
  if (claim.meta.changes === 0) return false;
  const a = await getAuction(db, auctionId);
  if (!a) return false;
  const now = Math.floor(Date.now() / 1000);
  const title = await getTitle(db, a.title_id);
  const titleName = title?.name ?? "؟";
  const chatId = a.telegram_group_id;

  if (a.current_bid == null || a.current_bidder_id == null) {
    await cancelAuction(db, a, now);
    if (a.board_message_id) {
      await editMessageText(
        token,
        chatId,
        a.board_message_id,
        `🎯 حراج عنوان <b>${escapeHtml(titleName)}</b> بدون پیشنهاد لغو شد.\n\nورودی‌ها به شرکت‌کنندگان بازگردانده شد.`
      );
    }
    return true;
  }

  const result = await settleAuction(db, a, title, now);
  if (!result) {
    await cancelAuction(db, a, now);
    if (a.board_message_id) {
      await editMessageText(
        token,
        chatId,
        a.board_message_id,
        `❌ حراج عنوان <b>${escapeHtml(titleName)}</b> — برنده معتبری یافت نشد (ظرفیت ۳ عنوان، موجودی ناکافی یا خطای داخلی). حراج لغو شد و ورودی‌ها به شرکت‌کنندگان بازگردانده شد.`
      );
    }
    return true;
  }

  const { winner, bid, sellerCut, pot } = result;
  const text =
    `🏆 <b>حراج پایان یافت!</b>\n\n` +
    `🏷️ عنوان: <b>${escapeHtml(titleName)}</b>\n` +
    `👑 برنده: <b>${escapeStoredName(winner.name)}</b> — ${bid} MP\n` +
    `💸 پرداخت برنده: ${bid - a.start_amount} MP (به‌علاوه ورودی)\n` +
    (sellerCut > 0 ? `📤 سهم مالک قبلی: <b>${sellerCut} MP</b>\n` : "") +
    `🎰 به پات لاتاری: <b>${pot} MP</b>`;

  // The board message is edited to the result (replacing the keyboard) — no
  // separate announcement, so the result isn't duplicated in the chat.
  if (a.board_message_id) {
    await editMessageText(token, chatId, a.board_message_id, text);
  } else {
    await sendMessage(token, chatId, text);
  }
  return true;
}

async function handleEnd(token: string, db: D1Database, env: Bindings, callback: TelegramCallbackQuery, auctionId: number) {
  if (!callback.message || !callback.from) return;
  if (!isOwner(env, callback.from.id)) {
    await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
    return;
  }
  const a = await getAuction(db, auctionId);
  if (!a || a.telegram_group_id !== callback.message.chat.id || a.status !== "open") {
    await answerCallback(token, callback.id, "❌ حراج فعال نیست.", true);
    return;
  }
  await finishAuction(token, db, auctionId);
  await answerCallback(token, callback.id, "🏆 حراج تمام شد!");
}

async function settleAuction(
  db: D1Database,
  a: AuctionRow,
  title: TitleRow | null,
  now: number
): Promise<{ winner: { id: number; name: string }; bid: number; sellerCut: number; pot: number } | null> {
  const bids = await db
    .prepare(`SELECT telegram_user_id, amount FROM title_auction_bids WHERE auction_id = ? ORDER BY amount DESC`)
    .bind(a.id)
    .all<{ telegram_user_id: number; amount: number }>();

  const seen = new Set<number>();
  const participantCount = await countParticipants(db, a.telegram_group_id, a.id);
  for (const b of bids.results) {
    if (seen.has(b.telegram_user_id)) continue;
    seen.add(b.telegram_user_id);

    // 3-title cap per user per group.
    const cnt = await db
      .prepare(`SELECT COUNT(*) as c FROM titles WHERE telegram_group_id = ? AND owner_user_id = ?`)
      .bind(a.telegram_group_id, b.telegram_user_id)
      .first<{ c: number }>();
    if ((cnt?.c ?? 0) >= TITLE_MAX_PER_USER) continue;

    const remainder = b.amount - a.start_amount;
    if (remainder <= 0) continue;

    if (!(await checkBalances(db, a.telegram_group_id, b.telegram_user_id, remainder))) continue;

    // Winner pays the remainder; the TITLE_DEBIT marker commits in the SAME
    // batch so the stuck-'settling' recovery can tell whether the debit was
    // applied before the atomic settlement batch below. On a partial match
    // (insufficient funds) the marker is deleted along with the refunds.
    const debit = await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(remainder, b.telegram_user_id, remainder),
      db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(remainder, a.telegram_group_id, b.telegram_user_id, remainder),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(b.telegram_user_id, a.telegram_group_id, -remainder, `TITLE_DEBIT_${a.id}`, now),
    ]);
    if (debit[0].meta.changes === 0 || debit[1].meta.changes === 0) {
      const undo: any[] = [db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason = ?`).bind(b.telegram_user_id, a.telegram_group_id, `TITLE_DEBIT_${a.id}`)];
      if (debit[0].meta.changes > 0) undo.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(remainder, b.telegram_user_id));
      if (debit[1].meta.changes > 0) undo.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(remainder, a.telegram_group_id, b.telegram_user_id));
      await db.batch(undo);
      continue;
    }

    const sellerId = title?.owner_user_id ?? null; // read BEFORE the transfer
    const settlement = computeTitleSettlement(participantCount, a.start_amount, b.amount);
    const sellerCut = sellerId != null && sellerId !== b.telegram_user_id ? settlement.sellerCut : 0;
    const pot = sellerCut > 0 ? settlement.pot : settlement.totalEntries + settlement.winnerRemainder;

    // The actual winner may differ from the current leader (leader skipped for
    // the 3-title cap or insufficient funds), so resolve their name from users.
    const winnerRow = await db
      .prepare(`SELECT username, first_name FROM users WHERE telegram_id = ?`)
      .bind(b.telegram_user_id)
      .first<{ username: string | null; first_name: string }>();
    const winnerName = winnerRow
      ? winnerRow.username
        ? `@${winnerRow.username}`
        : escapeHtml(winnerRow.first_name || `#${b.telegram_user_id}`)
      : `#${b.telegram_user_id}`;

    // Everything after the winner's debit is ONE atomic batch: title transfer,
    // auction end, winner/seller transactions, seller credit and the pot.
    // If any statement fails, D1 rolls back the whole batch and the catch
    // below refunds the winner so no money is stranded in a half-settlement.
    const sellerRow = sellerId != null && sellerId !== b.telegram_user_id
      ? await db.prepare(`SELECT username, first_name FROM users WHERE telegram_id = ?`).bind(sellerId).first<{ username: string | null; first_name: string }>()
      : null;
    const stmts: any[] = [
      db.prepare(`UPDATE titles SET owner_user_id = ?, status = 'owned', last_price = ? WHERE id = ?`).bind(b.telegram_user_id, b.amount, a.title_id),
      db.prepare(`UPDATE title_auctions SET status = 'ended', current_bid = ?, current_bidder_id = ?, current_bidder_name = ?, ended_at = ? WHERE id = ?`)
        .bind(b.amount, b.telegram_user_id, winnerName, now, a.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(b.telegram_user_id, a.telegram_group_id, -remainder, `TITLE_WIN_${a.id}`, now),
      // The title changed hands — drop any member's stale pointer to it so
      // /top doesn't show a title someone no longer owns.
      db.prepare(`UPDATE group_members SET active_title_id = NULL WHERE telegram_group_id = ? AND active_title_id = ?`)
        .bind(a.telegram_group_id, a.title_id),
    ];

    if (sellerRow) {
      stmts.push(
        db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(sellerId, a.telegram_group_id, sellerCut, `TITLE_SELLER_${a.id}`, now),
        db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(sellerCut, sellerId),
        db.prepare(
          `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL)
           ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
             username = excluded.username,
             first_name = excluded.first_name,
             meow_points = group_members.meow_points + excluded.meow_points`
        ).bind(a.telegram_group_id, sellerId, sellerRow.username ?? null, sellerRow.first_name ?? "?", sellerCut)
      );
    }

    stmts.push(
      db.prepare(`UPDATE telegram_groups SET lottery_pot = lottery_pot + ? WHERE telegram_group_id = ?`).bind(pot, a.telegram_group_id)
    );

    try {
      await db.batch(stmts);
    } catch (err) {
      // The atomic batch failed — nothing in it applied. Give the winner's
      // remainder back (the debit above is the only money that moved) and
      // drop the TITLE_DEBIT marker so the audit trail matches reality.
      console.error(`[title] settlement batch failed for auction ${a.id}`, err);
      await creditBoth(db, a.telegram_group_id, b.telegram_user_id, winnerRow?.username ?? null, winnerRow?.first_name ?? null, remainder);
      await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ? AND group_id = ? AND reason = ?`)
        .bind(b.telegram_user_id, a.telegram_group_id, `TITLE_DEBIT_${a.id}`)
        .run();
      return null;
    }

    // Show the new title by default if the winner has none active yet.
    const member = await db
      .prepare(`SELECT active_title_id FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(a.telegram_group_id, b.telegram_user_id)
      .first<{ active_title_id: number | null }>();
    if (!member || member.active_title_id == null) {
      // Use the winner's real name — a `#<id>` placeholder here would clobber
      // their group_members row and show up as "🏅 title #123…" in /top.
      await db
        .prepare(
          `INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, active_title_id)
           VALUES (?, ?, ?, ?, 0, 0, ?)
           ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
             username = excluded.username,
             first_name = excluded.first_name,
             active_title_id = excluded.active_title_id`
        )
        .bind(a.telegram_group_id, b.telegram_user_id, winnerRow?.username ?? null, winnerRow?.first_name ?? "?", a.title_id)
        .run();
    }

    return { winner: { id: b.telegram_user_id, name: winnerName }, bid: b.amount, sellerCut, pot };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Seller prompt (existing-title re-auction)
// ---------------------------------------------------------------------------

async function handleSellerAction(token: string, db: D1Database, callback: TelegramCallbackQuery, action: string, auctionId: number) {
  if (!callback.message || !callback.from) return;
  const a = await getAuction(db, auctionId);
  if (!a || a.status !== "pending_seller") {
    await answerCallback(token, callback.id, "❌ حراج فعال نیست.", true);
    return;
  }
  const title = await getTitle(db, a.title_id);
  if (!title || title.owner_user_id !== callback.from.id) {
    await answerCallback(token, callback.id, "🚫 فقط مالک عنوان می‌تواند تأیید کند.", true);
    return;
  }

  if (action === "decline") {
    await cancelAuction(db, a, Math.floor(Date.now() / 1000));
    await editMessageText(token, callback.message.chat.id, callback.message.message_id, `❌ حراج عنوان <b>${escapeHtml(title.name)}</b> رد شد.`);
    await sendMessage(token, a.telegram_group_id, `❌ حراج عنوان <b>${escapeHtml(title.name)}</b> — مالک فعلی رد کرد.`);
    await answerCallback(token, callback.id, "حراج رد شد.");
    return;
  }

  const res = await db.prepare(`UPDATE title_auctions SET status = 'open', ends_at = COALESCE(ends_at, ?) WHERE id = ? AND status = 'pending_seller'`)
    .bind(Math.floor(Date.now() / 1000) + TITLE_AUCTION_DURATION_SEC, a.id)
    .run();
  if (res.meta.changes === 0) {
    // The sweep cancelled the auction between the read above and this write.
    await answerCallback(token, callback.id, "❌ حراج منقضی شد.", true);
    return;
  }
  await editMessageText(
    token,
    callback.message.chat.id,
    callback.message.message_id,
    `✅ حراج عنوان <b>${escapeHtml(title.name)}</b> تأیید شد.\n\nدر پایان 20٪ ورودی‌ها + (پیشنهاد برنده − ورودی) به شما پرداخت می‌شود.`
  );
  await postBoard(token, db, a.telegram_group_id, a.id);
  await answerCallback(token, callback.id, "حراج شروع شد.");
}

// ---------------------------------------------------------------------------
// Sweep (seller response timeout)
// ---------------------------------------------------------------------------

export async function sweepPendingSellerAuctions(db: D1Database, token: string): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - TITLE_SELLER_TIMEOUT_SEC;
  const rows = await db
    .prepare(
      `SELECT a.id, a.telegram_group_id, a.title_id, t.name
       FROM title_auctions a
       LEFT JOIN titles t ON t.id = a.title_id
       WHERE a.status = 'pending_seller' AND a.created_at < ?`
    )
    .bind(cutoff)
    .all<{ id: number; telegram_group_id: number; title_id: number | null; name: string | null }>();

  if (!rows.results.length) return 0;

  const now = Math.floor(Date.now() / 1000);
  const stmts: any[] = [];
  for (const r of rows.results) {
    stmts.push(db.prepare(`UPDATE title_auctions SET status = 'cancelled', ended_at = ? WHERE id = ?`).bind(now, r.id));
    if (r.title_id != null) {
      stmts.push(db.prepare(`DELETE FROM titles WHERE id = ? AND owner_user_id IS NULL`).bind(r.title_id));
    }
  }
  // Free-plan D1 caps queries at 50 per invocation — chunk at 40.
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }

  for (const r of rows.results) {
    await sendMessage(token, r.telegram_group_id, `⏱️ حراج عنوان <b>${escapeHtml(r.name ?? "؟")}</b> لغو شد — مالک فعلی در ${TITLE_SELLER_TIMEOUT_SEC / 60} دقیقه پاسخ نداد.`);
  }
  return rows.results.length;
}

/**
 * Recover auctions stuck in 'settling' (crash between the winner's debit and
 * the atomic settlement batch, or between the batch and the status flip).
 * The TITLE_DEBIT marker records whether the winner actually paid; if it did,
 * the remainder is refunded. Entry fees go back via cancelAuction. Runs via
 * the every-minute cron sweep; the claim makes recovery idempotent.
 */
export async function recoverStuckSettlingAuctions(db: D1Database, token: string): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - 10 * 60;
  const rows = await db
    .prepare(`SELECT id FROM title_auctions WHERE status = 'settling' AND ended_at IS NOT NULL AND ended_at < ?`)
    .bind(cutoff)
    .all<{ id: number }>();

  let recovered = 0;
  for (const r of rows.results) {
    const claim = await db
      .prepare(`UPDATE title_auctions SET status = 'cancelling' WHERE id = ? AND status = 'settling'`)
      .bind(r.id)
      .run();
    if (claim.meta.changes === 0) continue;

    const a = await getAuction(db, r.id);
    if (!a) continue;
    const now = Math.floor(Date.now() / 1000);

    // Did the winner's remainder debit commit before the crash?
    const marker = await db
      .prepare(`SELECT telegram_user_id, amount FROM transactions WHERE group_id = ? AND reason = ? LIMIT 1`)
      .bind(a.telegram_group_id, `TITLE_DEBIT_${a.id}`)
      .first<{ telegram_user_id: number; amount: number }>();
    if (marker) {
      // Pass the winner's real name — (null, null) would clobber their
      // group_members row to "?" via creditBoth's upsert.
      const winner = await db
        .prepare(`SELECT username, first_name FROM users WHERE telegram_id = ?`)
        .bind(marker.telegram_user_id)
        .first<{ username: string | null; first_name: string }>();
      await creditBoth(db, a.telegram_group_id, marker.telegram_user_id, winner?.username ?? null, winner?.first_name ?? `#${marker.telegram_user_id}`, -marker.amount);
    }

    await cancelAuction(db, a, now);
    const titleName = await getTitleName(db, a.title_id);
    const base = `❌ حراج عنوان <b>${escapeHtml(titleName)}</b> به دلیل خطای داخلی لغو شد؛ ورودی‌ها بازگردانده شد.`;
    if (a.board_message_id) {
      await editMessageText(token, a.telegram_group_id, a.board_message_id, base);
    } else {
      await sendMessage(token, a.telegram_group_id, base);
    }
    recovered++;
  }
  return recovered;
}

/**
 * Auto-finish open auctions whose time is up (sweep, every minute). An auction
 * won't finish while a bid landed within TITLE_AUCTION_SNIPE_GRACE_SEC of now,
 * so snipers can't extend the race at the last second.
 */
export async function sweepDueTitleAuctions(db: D1Database, token: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .prepare(
      `SELECT a.id,
              (SELECT MAX(b.created_at) FROM title_auction_bids b WHERE b.auction_id = a.id) AS last_bid_at
       FROM title_auctions a
       WHERE a.status = 'open' AND a.ends_at IS NOT NULL AND a.ends_at <= ?`
    )
    .bind(now)
    .all<{ id: number; last_bid_at: number | null }>();

  let finished = 0;
  for (const r of rows.results) {
    if (r.last_bid_at != null && now - r.last_bid_at < TITLE_AUCTION_SNIPE_GRACE_SEC) continue;
    if (await finishAuction(token, db, r.id)) finished++;
  }
  return finished;
}

/**
 * Re-post open auction boards that haven't been surfaced for at least
 * TITLE_BOARD_REPOST_SEC (10 min). Runs via the every-minute cron sweep.
 */
export async function sweepRepostAuctions(db: D1Database, token: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - TITLE_BOARD_REPOST_SEC;
  const rows = await db
    .prepare(
      `SELECT id FROM title_auctions
       WHERE status = 'open' AND board_message_id IS NOT NULL
         AND (last_reposted_at IS NULL OR last_reposted_at <= ?)`
    )
    .bind(cutoff)
    .all<{ id: number }>();

  let reposted = 0;
  for (const r of rows.results) {
    await renderBoard(token, db, r.id);
    reposted++;
  }
  return reposted;
}
