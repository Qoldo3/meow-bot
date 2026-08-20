import { Bindings, PublicBlackjackState, TelegramCallbackQuery, TelegramMessage } from "./types";
import { answerCallback, isGroupAdmin, sendMessage } from "./telegram";
import { ensureGroup, ensureUser, getGroupMemberBalance, getActiveTitle } from "./database";
import { BJ_BUYIN_PRESETS, BJ_MAX_BUYIN, BJ_MAX_GAMES_PER_GROUP, BJ_MIN_BUYIN } from "./constants";
import { toFaDigits } from "./poker";
import { escapeHtml, safeParseAmount } from "./utils";
import { titleEmoji } from "./titleAuction";

const SETTINGS_LIMITS: Record<string, { min: number; max: number; label: string }> = {
  minbet: { min: 100, max: 500000, label: "حداقل شرط" },
  break: { min: 10, max: 300, label: "زمان بین دورها (ثانیه)" },
  turn: { min: 10, max: 120, label: "مهلت نوبت (ثانیه)" },
};

async function sendBlackjackLeaderboard(token: string, db: D1Database, groupId: number, userId?: number) {
  const rows = await db
    .prepare(
      `SELECT first_name, username, hands_played, blackjacks, net_winnings, biggest_win
       FROM blackjack_player_stats WHERE telegram_group_id = ? ORDER BY net_winnings DESC LIMIT 10`
    )
    .bind(groupId)
    .all<{ first_name: string | null; username: string | null; hands_played: number; blackjacks: number; net_winnings: number; biggest_win: number }>();

  const medals = ["🥇", "🥈", "🥉"];
  let text = `🏆 <b>لیدربورد بلک‌جک گروه</b>\n\n`;
  if (!rows.results.length) {
    text += "🐱 هنوز کسی بلک‌جک بازی نکرده!";
  } else {
    text += rows.results
      .map((u, i) => {
        const medal = medals[i] || `${i + 1}.`;
        const name = escapeHtml(u.first_name || u.username || "Unknown");
        const sign = u.net_winnings >= 0 ? "+" : "";
        return `${medal} ${name} — <b>${sign}${u.net_winnings} MP</b> (${u.hands_played} دست، ${u.blackjacks} بلک‌جک)`;
      })
      .join("\n");
  }

  if (userId) {
    const mine = await db
      .prepare(
        `SELECT net_winnings FROM blackjack_player_stats WHERE telegram_group_id = ? AND telegram_user_id = ?`
      )
      .bind(groupId, userId)
      .first<{ net_winnings: number }>();
    if (mine) {
      const above = await db
        .prepare(
          `SELECT COUNT(*) as c FROM blackjack_player_stats WHERE telegram_group_id = ? AND net_winnings > ?`
        )
        .bind(groupId, mine.net_winnings)
        .first<{ c: number }>();
      const rank = (above?.c ?? 0) + 1;
      text += `\n\n📌 رتبه شما: <b>#${rank}</b> (${mine.net_winnings >= 0 ? "+" : ""}${mine.net_winnings} MP)`;
    }
  }

  await sendMessage(token, groupId, text);
}

async function handleBlackjackSettings(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 تنظیمات بلک‌جک فقط داخل گروه قابل تغییر است!");
    return;
  }
  const isAdmin = await isGroupAdmin(token, message.chat.id, message.from.id);
  if (!isAdmin) {
    await sendMessage(token, message.chat.id, "🚫 فقط ادمین گروه می‌تواند تنظیمات بلک‌جک را تغییر دهد.");
    return;
  }

  const parts = (message.text || "").split(" ").filter(Boolean);
  const key = (parts[2] || "").toLowerCase();
  const limit = SETTINGS_LIMITS[key];
  if (!limit) {
    const row = await db
      .prepare(`SELECT blackjack_min_bet, blackjack_break_sec, blackjack_turn_sec FROM telegram_groups WHERE telegram_group_id = ?`)
      .bind(message.chat.id)
      .first<{ blackjack_min_bet: number | null; blackjack_break_sec: number | null; blackjack_turn_sec: number | null }>();
    await sendMessage(
      token,
      message.chat.id,
      `⚙️ <b>تنظیمات بلک‌جک گروه</b>\n\n` +
        `🎰 حداقل شرط: <b>${row?.blackjack_min_bet ?? 1000} MP</b>\n` +
        `⏸️ زمان بین دورها: <b>${row?.blackjack_break_sec ?? 60}s</b>\n` +
        `⏱️ مهلت نوبت: <b>${row?.blackjack_turn_sec ?? 45}s</b>\n\n` +
        `برای تغییر:\n<code>/blackjack settings minbet 5000</code>\n<code>/blackjack settings break 30</code>\n<code>/blackjack settings turn 60</code>`
    );
    return;
  }

  const value = safeParseAmount(parts[3] || "");
  if (value === null || value < limit.min || value > limit.max) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 مقدار نامعتبر است. ${limit.label}: از <b>${limit.min}</b> تا <b>${limit.max}</b>.`
    );
    return;
  }

  const column = key === "minbet" ? "blackjack_min_bet" : key === "break" ? "blackjack_break_sec" : "blackjack_turn_sec";
  await db.prepare(`UPDATE telegram_groups SET ${column} = ? WHERE telegram_group_id = ?`).bind(value, message.chat.id).run();
  await sendMessage(token, message.chat.id, `✅ ${limit.label} به <b>${value}</b> تغییر کرد.`);
}

type BlackjackRpcResult = {
  ok: boolean;
  error?: string;
  state?: PublicBlackjackState | null;
};

function blackjackGameId(groupId: number): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return `b${Math.abs(groupId)}_${rand}`;
}

function getBlackjackStub(env: Bindings, gameId: string) {
  return env.BLACKJACK_GAME.get(env.BLACKJACK_GAME.idFromName(gameId));
}

async function callBlackjack(
  env: Bindings,
  gameId: string,
  path: string,
  body: Record<string, unknown>
): Promise<BlackjackRpcResult> {
  try {
    const res = await getBlackjackStub(env, gameId).fetch(`https://blackjack.local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as BlackjackRpcResult;
  } catch (err) {
    console.error("Blackjack RPC error:", err);
    return { ok: false, error: "rpc_failed" };
  }
}

function blackjackErrorText(error?: string): string {
  switch (error) {
    case "not_found":
      return "❌ بازی پیدا نشد. شاید منقضی شده است.";
    case "started":
      return "❌ بازی قبلاً شروع شده است.";
    case "already_in":
      return "🐱 تو قبلاً در این بازی هستی.";
    case "full":
      return "❌ صندلی‌های بازی پر است.";
    case "insufficient":
      return "🐱 امتیاز کافی در این گروه نداری.";
    case "host_only":
      return "🚫 فقط میزبان می‌تواند این کار را انجام دهد.";
    case "host_or_admin":
      return "🚫 فقط میزبان یا ادمین گروه می‌تواند بازی را لغو کند.";
    case "mode_denied":
      return "🚫 فقط میزبان یا صاحب ربات می‌تواند حالت بازی را تغییر دهد.";
    case "not_in":
      return "🐱 تو در این بازی نیستی.";
    case "not_your_turn":
      return "⏳ نوبت تو نیست.";
    case "not_betting":
      return "❌ مرحله شرط‌بندی تمام شده است.";
    case "not_busted":
      return "🐱 فقط بازیکنی که باخته می‌تواند دوباره بخرد.";
    case "not_playing":
      return "❌ بازی هنوز شروع نشده است.";
    case "already_bet":
      return "🐱 تو قبلاً شرط گذاشته‌ای.";
    case "treasury":
      return "🏦 خزانه گروه برای پوشش این شرط کافی نیست! شرط کوچک‌تری بگذار.";
    case "not_between_rounds":
      return "❌ فقط بین دو دور (بعد از اتمام دست) می‌توانی از بازی خارج شوی.";
    case "invalid":
      return "❌ درخواست نامعتبر.";
    case "ended":
      return "❌ بازی تمام شده است.";
    case "rpc_failed":
      return "❌ ارتباط با سرور بازی برقرار نشد. دوباره تلاش کن.";
    default:
      return "❌ خطا در عملیات.";
  }
}

/**
 * Cancel a blackjack game by replying "لغو" (or "cancel") to its game
 * message. Allowed for the game host or any group admin. Returns false when
 * the replied message is not a blackjack game message, so the caller can fall
 * through to other handling (e.g. poker's reply-cancel).
 */
export async function handleBlackjackReplyCancel(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage
): Promise<boolean> {
  if (!message.from || message.chat.type === "private" || !message.reply_to_message) return false;
  const repliedMessageId = message.reply_to_message.message_id;
  if (!repliedMessageId) return false;

  const game = await db
    .prepare(`SELECT game_id FROM blackjack_games WHERE telegram_group_id = ? AND message_id = ?`)
    .bind(message.chat.id, repliedMessageId)
    .first<{ game_id: string }>();
  if (!game) return false;

  const res = await callBlackjack(env, game.game_id, "/cancel", { userId: message.from.id });
  await sendMessage(
    token,
    message.chat.id,
    res.ok ? "❌ بازی بلک‌جک لغو شد." : blackjackErrorText(res.error),
    { reply_to_message_id: message.message_id }
  );
  return true;
}

export async function handleBlackjackCommand(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(
      token,
      message.chat.id,
      "🐱 بلک‌جک فقط داخل گروه قابل بازی است. ربات را به گروهت اضافه کن و دوباره تلاش کن!"
    );
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const parts = (message.text || "").split(" ").filter(Boolean);
  const sub = parts[1]?.toLowerCase();
  if (sub === "settings") {
    await handleBlackjackSettings(token, db, message);
    return;
  }
  if (sub === "top" || sub === "leaderboard") {
    await sendBlackjackLeaderboard(token, db, message.chat.id, message.from.id);
    return;
  }

  let buyIn = BJ_BUYIN_PRESETS[0];
  if (parts[1]) {
    const parsed = safeParseAmount(parts[1]);
    if (parsed === null || parsed < BJ_MIN_BUYIN || parsed > BJ_MAX_BUYIN) {
      await sendMessage(
        token,
        message.chat.id,
        `🐱 ورودی نامعتبر است.\nحداقل: <b>${toFaDigits(BJ_MIN_BUYIN)} MP</b>\nحداکثر: <b>${toFaDigits(BJ_MAX_BUYIN)} MP</b>\n\nپیشنهاد: <code>/بلک‌جک 10000</code>`
      );
      return;
    }
    buyIn = parsed;
  }

  const balance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
  if (balance < buyIn) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 امتیاز کافی در این گروه نداری!\n💳 موجودی گروه: <b>${toFaDigits(balance)} MP</b>\n🎰 ورودی: <b>${toFaDigits(buyIn)} MP</b>`
    );
    return;
  }

  const active = await db
    .prepare(`SELECT COUNT(*) as c FROM blackjack_games WHERE telegram_group_id = ? AND status IN ('lobby', 'playing')`)
    .bind(message.chat.id)
    .first<{ c: number }>();
  if ((active?.c ?? 0) >= BJ_MAX_GAMES_PER_GROUP) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 در حال حاضر ${toFaDigits(BJ_MAX_GAMES_PER_GROUP)} بازی فعال در این گروه وجود دارد. اول بازی‌های قبلی را تمام کن.`
    );
    return;
  }

  const gameId = blackjackGameId(message.chat.id);
  const hostTitle = await getActiveTitle(db, message.chat.id, message.from.id);
  const res = await callBlackjack(env, gameId, "/create", {
    groupId: message.chat.id,
    hostId: message.from.id,
    hostName: hostTitle ? `${titleEmoji(hostTitle.last_price, hostTitle.emoji)} ${hostTitle.name}` : message.from.first_name,
    buyIn,
  });

  if (!res.ok) {
    await sendMessage(token, message.chat.id, blackjackErrorText(res.error));
    return;
  }

  const notice = await sendMessage(
    token,
    message.chat.id,
    `🃏 <b>بازی بلک‌جک ساخته شد!</b>\n\n` +
      `💰 ورودی: <b>${toFaDigits(buyIn)} MP</b>\n` +
      `⏱️ اعضای گروه ۶۰ ثانیه فرصت دارند با دکمه «✅ شرکت» وارد شوند — بازی خودکار شروع می‌شود.\n` +
      `🏦 خزانه گروه به‌عنوان بانک بازی عمل می‌کند. برای لغو، روی پیام بازی «لغو» را ریپلای کن.`
  );
  // Register the confirmation message with the game so it can be deleted
  // once play starts (leaving only the game board message).
  if (notice?.ok && notice.result?.message_id) {
    await callBlackjack(env, gameId, "/notice", { messageId: notice.result.message_id });
  }
}

export async function handleBlackjackCallback(
  token: string,
  db: D1Database,
  env: Bindings,
  callback: TelegramCallbackQuery
) {
  if (!callback.message || !callback.data) return;
  const segments = callback.data.split(":");
  if (segments.length < 2) {
    await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
    return;
  }

  const [action, kind, gameId, ...rest] = segments;
  if (action !== "bj") return;
  const userId = callback.from.id;

  if (kind === "lobby") {
    const sub = rest[0];
    let res: BlackjackRpcResult;
    switch (sub) {
      case "join": {
        const seatTitle = await getActiveTitle(db, callback.message.chat.id, userId);
        res = await callBlackjack(env, gameId, "/join", { userId, name: seatTitle ? `${titleEmoji(seatTitle.last_price, seatTitle.emoji)} ${seatTitle.name}` : callback.from.first_name });
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "✅ در بازی شرکت کردی!");
        return;
      }
      case "leave":
        res = await callBlackjack(env, gameId, "/leave", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🚪 از بازی خارج شدی.");
        return;
      case "start":
        res = await callBlackjack(env, gameId, "/start", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🎴 بازی شروع شد!");
        return;
      case "mode": {
        res = await callBlackjack(env, gameId, "/mode", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        const mode = res.state?.mode === "multi" ? "چندنفره (دست‌های مخفی)" : "تک‌نفره (کارت‌های باز)";
        await answerCallback(token, callback.id, `🎮 حالت بازی: ${mode}`);
        return;
      }
      case "cancel":
        res = await callBlackjack(env, gameId, "/cancel", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "❌ بازی لغو شد.");
        return;
      case "refresh":
        res = await callBlackjack(env, gameId, "/refresh", {});
        if (!res.ok) {
          await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🔄 به‌روزرسانی شد.");
        return;
      default:
        await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
        return;
    }
  }

  if (kind === "leavegame") {
    const res = await callBlackjack(env, gameId, "/leavegame", { userId });
    if (!res.ok) {
      await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "🚪 سهمت پرداخت شد و از بازی خارج شدی.");
    return;
  }

  if (kind === "rebuy") {
    const res = await callBlackjack(env, gameId, "/rebuy", { userId });
    if (!res.ok) {
      await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "🔄 دوباره وارد بازی شدی!");
    return;
  }

  if (kind === "top") {
    if (!callback.message) return;
    await sendBlackjackLeaderboard(token, db, callback.message.chat.id, userId);
    await answerCallback(token, callback.id);
    return;
  }

  if (kind === "bet") {
    const sub = rest[0];
    const body: Record<string, unknown> = { userId };
    switch (sub) {
      case "draft":
        body.act = "draft";
        break;
      case "skip":
        body.act = "skip";
        break;
      case "adj": {
        const delta = parseInt(rest[1], 10);
        if (!Number.isFinite(delta) || delta === 0) {
          await answerCallback(token, callback.id, "❌ مقدار نامعتبر.", true);
          return;
        }
        body.act = "adj";
        body.delta = delta;
        break;
      }
      case "confirm":
        body.act = "confirm";
        break;
      case "back":
        body.act = "back";
        break;
      default:
        await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
        return;
    }
    const res = await callBlackjack(env, gameId, "/bet", body);
    if (!res.ok) {
      await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "✅ انجام شد.");
    return;
  }

  if (kind === "act") {
    const sub = rest[0];
    if (sub !== "hit" && sub !== "stand" && sub !== "double" && sub !== "split") {
      await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
      return;
    }
    const res = await callBlackjack(env, gameId, "/act", { userId, act: sub });
    if (!res.ok) {
      await answerCallback(token, callback.id, blackjackErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "✅ انجام شد.");
    return;
  }

  await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
}
