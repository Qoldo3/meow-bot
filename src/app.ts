import { Hono } from "hono";
import { Bindings, TelegramUpdate } from "./types";
import {
  awardMeow,
  handleAddEvent,
  handleDeleteEvent,
  handleEditEvent,
  handleEvents,
  handleHistory,
  handleDuelRequest,
  handleGlobal,
  handleGroupSettings,
  handleMe,
  handleMyChatMember,
  handlePay,
  handleDaily,
  handleLottery,
  handleDice,
  handleTreasury,
  handleClan,
  handleStart,
  handleTop,
  handleDuelRank,
  handleCallbackQuery,
  handleHokmRequest,
} from "./handlers";
import { OWNER_COMMANDS, handleOwnerUserInfo, isOwner } from "./owner";
import { isUserBanned, isMaintenanceMode, getGroupSettings, getGroupMemberBalance } from "./database";
import { telegramRequest, sendMessage } from "./telegram";
import { escapeHtml, isMeow, formatDuration, parseReplyAction } from "./utils";
import { postMeowKeyboard } from "./keyboards";
import { validateInitData } from "./hokmAuth";
import { isValidHokmGameId } from "./hokmLobby";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/telegram/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const update = await c.req.json<TelegramUpdate>();
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const db = c.env.DB;

  try {
    if (update.my_chat_member) {
      await handleMyChatMember(token, db, update.my_chat_member);
      return c.json({ ok: true });
    }

    if (update.callback_query) {
      await handleCallbackQuery(token, db, c.env, update.callback_query);
      return c.json({ ok: true });
    }

    const message = update.message;
    if (!message) return c.json({ ok: true });

    const user = message.from;
    if (!user || user.is_bot) return c.json({ ok: true });

    if (await isUserBanned(db, user.id)) {
      return c.json({ ok: true });
    }

    if (await isMaintenanceMode(db) && !isOwner(c.env, user.id)) {
      return c.json({ ok: true });
    }

    const text = message.text?.trim();
    if (!text) return c.json({ ok: true });

    const command = text.split(" ").filter(Boolean)[0].toLowerCase();

    if (OWNER_COMMANDS[command]) {
      await OWNER_COMMANDS[command](token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/settings") {
      await handleGroupSettings(token, db, message);
      return c.json({ ok: true });
    }
    if (
      command === "/lottery" ||
      command === "/gamble" ||
      command === "/قمار" ||
      command === "lottery" ||
      command === "gamble" ||
      command === "قمار"
    ) {
      await handleLottery(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/dice" || command === "/تاس" || command === "dice" || command === "تاس") {
      await handleDice(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/treasury") {
      await handleTreasury(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/clan" || command === "/clans") {
      await handleClan(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/start") {
      await handleStart(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/me") {
      await handleMe(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/history") {
      await handleHistory(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/events") {
      await handleEvents(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/add" && text.toLowerCase().startsWith("/add event")) {
      await handleAddEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/edit" && text.toLowerCase().startsWith("/edit event")) {
      await handleEditEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/delete" && text.toLowerCase().startsWith("/delete event")) {
      await handleDeleteEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/addevent") {
      await handleAddEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/editevent") {
      await handleEditEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/deleteevent") {
      await handleDeleteEvent(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/top") {
      await handleTop(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/global") {
      await handleGlobal(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/duelrank") {
      await handleDuelRank(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/daily") {
      await handleDaily(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/pay") {
      await handlePay(token, db, message);
      return c.json({ ok: true });
    }
    if (text.startsWith("دعوا")) {
      await handleDuelRequest(token, db, message, c);
      return c.json({ ok: true });
    }

    if (command === "/hokm") {
      await handleHokmRequest(token, db, c.env, message, c);
      return c.json({ ok: true });
    }

    const replyAction = parseReplyAction(text);
    if (replyAction && message.reply_to_message?.from && message.from && isOwner(c.env, message.from.id)) {
      const targetUser = message.reply_to_message.from;
      if (targetUser.is_bot) {
        await sendMessage(token, message.chat.id, "🐱 نمی‌توانی روی ربات این عمل را انجام بدهی!", { reply_to_message_id: message.message_id });
        return c.json({ ok: true });
      }

      const now = Math.floor(Date.now() / 1000);
      const groupId = message.chat.type === "private" ? null : message.chat.id;

      if (replyAction.kind === "userinfo") {
        const infoMessage = { ...message, text: `/userinfo ${targetUser.id}` } as typeof message;
        await handleOwnerUserInfo(token, db, c.env, infoMessage);
        return c.json({ ok: true });
      }

      if (replyAction.kind === "add") {
        const amount = replyAction.amount ?? 0;
        await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, targetUser.id).run();
        if (groupId) {
          await db.prepare(`
            INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
              username = excluded.username,
              first_name = excluded.first_name,
              meow_points = group_members.meow_points + excluded.meow_points,
              last_meow_at = excluded.last_meow_at
          `).bind(groupId, targetUser.id, targetUser.username ?? null, targetUser.first_name, amount, now).run();
        }
        await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(targetUser.id, groupId, amount, "OWNER_REPLY_ADD", now).run();
        await sendMessage(token, message.chat.id, `✅ +${amount} MP به ${escapeHtml(targetUser.first_name)} اضافه شد.`, { reply_to_message_id: message.message_id });
        return c.json({ ok: true });
      }

      if (replyAction.kind === "remove") {
        const amount = replyAction.amount ?? 0;
        await db.prepare(`UPDATE users SET meow_points = MAX(0, meow_points - ?) WHERE telegram_id = ?`).bind(amount, targetUser.id).run();
        if (groupId) {
          await db.prepare(`
            INSERT INTO group_members (telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
              username = excluded.username,
              first_name = excluded.first_name,
              meow_points = MAX(0, group_members.meow_points + excluded.meow_points),
              last_meow_at = excluded.last_meow_at
          `).bind(groupId, targetUser.id, targetUser.username ?? null, targetUser.first_name, -amount, now).run();
        }
        await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(targetUser.id, groupId, -amount, "OWNER_REPLY_REMOVE", now).run();
        await sendMessage(token, message.chat.id, `✅ ${amount} MP از ${escapeHtml(targetUser.first_name)} کم شد.`, { reply_to_message_id: message.message_id });
        return c.json({ ok: true });
      }
    }

    if (isMeow(text)) {
      if (message.chat.type === "private") {
        const botInfo = await telegramRequest(token, "getMe", {});
        const botUsername = botInfo.result?.username || "YourBot";
        await sendMessage(
          token,
          message.chat.id,
          "🐱 میو کردن فقط داخل گروه امتیاز داره! منو رو به گروهت اضافه کن و اونجا میو بگو! 😸",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "➕ افزودن به گروه", url: `https://t.me/${botUsername}?startgroup=true` }]],
            },
          }
        );
        return c.json({ ok: true });
      }

      const settings = await getGroupSettings(db, message.chat.id);
      if (!settings.enabled) {
        return c.json({ ok: true });
      }

      const result = await awardMeow(db, user, message.chat, c.env.MEOW_VIP_USER_ID);

      if ("cooldown" in result && result.cooldown) {
        await sendMessage(token, message.chat.id, `⏱️ صبر کن!\n\n${formatDuration(result.cooldown)} دیگه می‌تونی میو بدی! 😸`, {
          reply_to_message_id: message.message_id,
        });
        return c.json({ ok: true });
      }

      if (!("points" in result)) {
        return c.json({ ok: true });
      }

      const points = result.points;
      const tier = result.tier;
      const balance = await getGroupMemberBalance(db, message.chat.id, user.id);
      const activeEvent = await db
        .prepare(`SELECT title, description, bonus_multiplier, end_at FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
        .bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
        .first<{ title: string; description: string; bonus_multiplier: number; end_at: number }>();

      const eventLine = activeEvent
        ? `\n\n🎯 رویداد فعلی: <b>${activeEvent.title}</b>\n${activeEvent.description}\n💥 ضریب: x${activeEvent.bonus_multiplier}`
        : "";
      const eventBonusText = activeEvent && result.eventBonus > 1
        ? `\n\n🔹 امتیاز پایه: <b>${result.basePoints} MP</b>\n🔹 ضریب رویداد: <b>x${result.eventBonus}</b>\n🔹 امتیاز نهایی: <b>${points} MP</b>`
        : "";
      const taxText = "taxAmount" in result && result.taxAmount > 0 ? `\n\n📉 مالیات: ${result.taxAmount} MP (${Math.round(result.taxRate * 100)}%)` : "";

      let response = `${tier.message(points)}\n\n💳 موجودی این گروه: <b>${balance} MP</b>${eventBonusText}${taxText}`;
      if (activeEvent) response += eventLine;

      if (points >= 1000) {
        response = `🌟 <b>MEGA MEOW!!!</b> 🌟\n\n${tier.message(points)}\n💳 موجودی گروه: <b>${balance} MP</b>${eventBonusText}${taxText}`;
        if (activeEvent) response += eventLine;
      } else if (points >= 100) {
        response = `🔥 <b>BIG MEOW!</b> 🔥\n\n${tier.message(points)}\n💳 موجودی گروه: <b>${balance} MP</b>${eventBonusText}${taxText}`;
        if (activeEvent) response += eventLine;
      }

      await sendMessage(token, message.chat.id, response, {
        reply_to_message_id: message.message_id,
        reply_markup: postMeowKeyboard(message.chat.id, message.from?.id),
      });
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return c.json({ ok: true });
  }
});

app.get("/", (c) => c.json({ ok: true, bot: "Meow Points", status: "online" }));

app.get("/api/hokm/:id/ws", async (c) => {
  const upgrade = c.req.header("Upgrade");
  if (upgrade !== "websocket") {
    return c.json({ ok: false, error: "Expected WebSocket" }, 426);
  }

  const gameId = c.req.param("id");
  if (!isValidHokmGameId(gameId)) {
    return c.json({ ok: false, error: "Bad game id" }, 400);
  }

  const initData = c.req.query("initData") ?? "";
  const auth = await validateInitData(c.env.TELEGRAM_BOT_TOKEN, initData);
  if (!auth) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Hokm-User-Id", String(auth.userId));
  headers.set("X-Hokm-Name", auth.firstName);
  headers.set("X-Hokm-App-Url", c.env.HOKM_APP_URL ?? new URL(c.req.url).origin);

  const forwarded = new Request(c.req.raw.url, { headers, method: "POST" });
  const stub = c.env.HOKM_GAME.get(c.env.HOKM_GAME.idFromName(gameId));
  return stub.fetch(forwarded);
});

export default app;
