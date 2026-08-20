import { Bindings, PublicPokerState, TelegramCallbackQuery, TelegramMessage } from "./types";
import { answerCallback, sendMessage } from "./telegram";
import { ensureGroup, ensureUser, getGroupMemberBalance, getActiveTitle } from "./database";
import {
  POKER_BUYIN_PRESETS,
  POKER_MAX_BUYIN,
  POKER_MAX_GAMES_PER_GROUP,
  POKER_MIN_BUYIN,
  POKER_MIN_PLAYERS,
} from "./constants";
import { toFaDigits } from "./poker";
import { safeParseAmount } from "./utils";
import { titleEmoji } from "./titleAuction";

type PokerRpcResult = {
  ok: boolean;
  error?: string;
  state?: PublicPokerState | null;
};

function pokerGameId(groupId: number): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return `p${Math.abs(groupId)}_${rand}`;
}

function getPokerStub(env: Bindings, gameId: string) {
  return env.POKER_GAME.get(env.POKER_GAME.idFromName(gameId));
}

async function callPoker(
  env: Bindings,
  gameId: string,
  path: string,
  body: Record<string, unknown>
): Promise<PokerRpcResult> {
  try {
    const res = await getPokerStub(env, gameId).fetch(`https://poker.local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as PokerRpcResult;
  } catch (err) {
    console.error("Poker RPC error:", err);
    return { ok: false, error: "rpc_failed" };
  }
}

function pokerErrorText(error?: string): string {
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
    case "need_players":
      return `🐱 حداقل ${toFaDigits(POKER_MIN_PLAYERS)} بازیکن لازم است.`;
    case "not_in":
      return "🐱 تو در این بازی نیستی.";
    case "not_your_turn":
      return "⏳ نوبت تو نیست.";
    case "invalid_raise":
      return "❌ شرط نامعتبر است.";
    case "invalid":
      return "❌ درخواست نامعتبر.";
    case "ended":
      return "❌ بازی تمام شده است.";
    case "hand_over":
      return "❌ این دست تمام شده است.";
    case "not_playing":
      return "❌ بازی هنوز شروع نشده است.";
    case "players_joined":
      return "❌ بعد از پیوستن بازیکنان نمی‌توان ورودی را تغییر داد.";
    case "not_between_rounds":
      return "❌ فقط بین دو دور (بعد از اتمام دست) می‌توانی از بازی خارج شوی.";
    case "rpc_failed":
      return "❌ ارتباط با سرور بازی برقرار نشد. دوباره تلاش کن.";
    default:
      return "❌ خطا در عملیات.";
  }
}

/**
 * Cancel a poker game by replying "cancel" to its game message. Allowed for
 * the game host or any group admin. Returns false when the replied message is
 * not a poker game message, so the caller can fall through to other handling.
 */
export async function handlePokerReplyCancel(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage
): Promise<boolean> {
  if (!message.from || message.chat.type === "private" || !message.reply_to_message) return false;
  const repliedMessageId = message.reply_to_message.message_id;
  if (!repliedMessageId) return false;

  const game = await db
    .prepare(`SELECT game_id FROM poker_games WHERE telegram_group_id = ? AND message_id = ?`)
    .bind(message.chat.id, repliedMessageId)
    .first<{ game_id: string }>();
  if (!game) return false;

  const res = await callPoker(env, game.game_id, "/cancel", { userId: message.from.id });
  await sendMessage(
    token,
    message.chat.id,
    res.ok ? "❌ بازی لغو شد." : pokerErrorText(res.error),
    { reply_to_message_id: message.message_id }
  );
  return true;
}

export async function handlePokerCommand(
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
      "🐱 پوکر فقط داخل گروه قابل بازی است. ربات را به گروهت اضافه کن و دوباره تلاش کن!"
    );
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const parts = (message.text || "").split(" ").filter(Boolean);
  let buyIn = POKER_BUYIN_PRESETS[0];
  if (parts[1]) {
    const parsed = safeParseAmount(parts[1]);
    if (parsed === null || parsed < POKER_MIN_BUYIN || parsed > POKER_MAX_BUYIN) {
      await sendMessage(
        token,
        message.chat.id,
        `🐱 ورودی نامعتبر است.\nحداقل: <b>${toFaDigits(POKER_MIN_BUYIN)} MP</b>\nحداکثر: <b>${toFaDigits(POKER_MAX_BUYIN)} MP</b>\n\nپیشنهاد: <code>/پوکر 10000</code>`
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
    .prepare(`SELECT COUNT(*) as c FROM poker_games WHERE telegram_group_id = ? AND status IN ('lobby', 'playing')`)
    .bind(message.chat.id)
    .first<{ c: number }>();
  if ((active?.c ?? 0) >= POKER_MAX_GAMES_PER_GROUP) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 در حال حاضر ${toFaDigits(POKER_MAX_GAMES_PER_GROUP)} بازی فعال در این گروه وجود دارد. اول بازی‌های قبلی را تمام کن.`
    );
    return;
  }

  const gameId = pokerGameId(message.chat.id);
  const hostTitle = await getActiveTitle(db, message.chat.id, message.from.id);
  const res = await callPoker(env, gameId, "/create", {
    groupId: message.chat.id,
    hostId: message.from.id,
    hostName: hostTitle ? `${titleEmoji(hostTitle.last_price, hostTitle.emoji)} ${hostTitle.name}` : message.from.first_name,
    buyIn,
  });

  if (!res.ok) {
    await sendMessage(token, message.chat.id, pokerErrorText(res.error));
    return;
  }

  await sendMessage(
    token,
    message.chat.id,
    `🃏 <b>بازی پوکر ساخته شد!</b>\n\n💰 ورودی: <b>${toFaDigits(buyIn)} MP</b>\n\n` +
      `اعضای گروه با دکمه «✅ شرکت» می‌توانند وارد شوند (حداقل ${toFaDigits(POKER_MIN_PLAYERS)} نفر).\n` +
      `برای بازی با ربات‌ها هم دکمه «🤖 افزودن ربات» را بزن.`
  );
}

export async function handlePokerCallback(
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
  if (action !== "poker") return;
  const userId = callback.from.id;

  if (kind === "lobby") {
    const sub = rest[0];
    let res: PokerRpcResult;
    switch (sub) {
      case "join": {
        const seatTitle = await getActiveTitle(db, callback.message.chat.id, userId);
        res = await callPoker(env, gameId, "/join", { userId, name: seatTitle ? `${titleEmoji(seatTitle.last_price, seatTitle.emoji)} ${seatTitle.name}` : callback.from.first_name });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "✅ در بازی شرکت کردی!");
        return;
      }
      case "leave":
        res = await callPoker(env, gameId, "/leave", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🚪 از بازی خارج شدی.");
        return;
      case "bot":
        res = await callPoker(env, gameId, "/addbot", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🤖 یک ربات اضافه شد!");
        return;
      case "buyin": {
        const stateRes = await callPoker(env, gameId, "/state", {});
        if (!stateRes.ok || !stateRes.state) {
          await answerCallback(token, callback.id, pokerErrorText(stateRes.error), true);
          return;
        }
        const current = stateRes.state!.buyIn;
        let idx = POKER_BUYIN_PRESETS.findIndex((p) => p === current);
        let next: number;
        if (idx === -1) {
          // Custom buy-in (not a preset): jump to the smallest preset at or
          // above it (or the largest preset if the custom amount exceeds all).
          idx = POKER_BUYIN_PRESETS.findIndex((p) => p >= current);
          next = POKER_BUYIN_PRESETS[idx === -1 ? POKER_BUYIN_PRESETS.length - 1 : idx];
        } else {
          next = POKER_BUYIN_PRESETS[(idx + 1) % POKER_BUYIN_PRESETS.length] ?? POKER_BUYIN_PRESETS[0];
        }
        res = await callPoker(env, gameId, "/setbuyin", { userId, amount: next });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, `🎚 ورودی: ${toFaDigits(next)} MP`);
        return;
      }
      case "start":
        res = await callPoker(env, gameId, "/start", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "🎴 بازی شروع شد!");
        return;
      case "cancel":
        res = await callPoker(env, gameId, "/cancel", { userId });
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
          return;
        }
        await answerCallback(token, callback.id, "❌ بازی لغو شد.");
        return;
      case "refresh":
        res = await callPoker(env, gameId, "/refresh", {});
        if (!res.ok) {
          await answerCallback(token, callback.id, pokerErrorText(res.error), true);
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
    const res = await callPoker(env, gameId, "/leavegame", { userId });
    if (!res.ok) {
      await answerCallback(token, callback.id, pokerErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "🚪 سهمت پرداخت شد و از بازی خارج شدی.");
    return;
  }

  if (kind === "act") {
    const actName = rest[0];
    const body: Record<string, unknown> = { userId };

    switch (actName) {
      case "call":
      case "fold":
      case "allin":
        body.act = actName;
        break;
      case "raise": {
        // +1K / +5K / +10K: open the confirm panel with the draft set to
        // current bet + increment (clamping happens server-side).
        const inc = parseInt(rest[1], 10);
        if (!Number.isFinite(inc) || inc <= 0) {
          await answerCallback(token, callback.id, "❌ مقدار نامعتبر.", true);
          return;
        }
        body.act = "draft";
        body.inc = inc;
        break;
      }
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

    const res = await callPoker(env, gameId, "/action", body);
    if (!res.ok) {
      await answerCallback(token, callback.id, pokerErrorText(res.error), true);
      return;
    }
    await answerCallback(token, callback.id, "✅ انجام شد.");
    return;
  }

  await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
}
