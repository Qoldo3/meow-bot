import { Hono } from "hono";
import { Bindings, TelegramUpdate } from "./types";
import {
  awardMeow,
  handleAdmin,
  handleAudit,
  handleBroadcastConfirm,
  handleDuelAccept,
  handleDuelDecline,
  handleDuelRequest,
  handleDuels,
  handleGlobal,
  handleGroups,
  handleGroupSettings,
  handleMe,
  handleMyChatMember,
  handleOwnerAddPoints,
  handleOwnerBanUser,
  handleOwnerBroadcast,
  handleOwnerConfig,
  handleOwnerRepair,
  handleOwnerRemovePoints,
  handleOwnerResetUser,
  handleOwnerUnbanUser,
  handleOwnerUserInfo,
  handlePay,
  handleDaily,
  handleStart,
  handleTop,
  handleCallbackQuery,
} from "./handlers";
import { isUserBanned, isMaintenanceMode, getGroupSettings } from "./database";
import { telegramRequest, sendMessage } from "./telegram";
import { isMeow, formatDuration } from "./utils";
import { postMeowKeyboard } from "./keyboards";

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

    if (await isMaintenanceMode(db) && c.env.BOT_OWNER_ID !== String(user.id)) {
      return c.json({ ok: true });
    }

    const text = message.text?.trim();
    if (!text) return c.json({ ok: true });

    const command = text.split(" ").filter(Boolean)[0].toLowerCase();

    if (command === "/admin") {
      await handleAdmin(token, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/broadcast") {
      await handleOwnerBroadcast(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/addpoints") {
      await handleOwnerAddPoints(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/removepoints") {
      await handleOwnerRemovePoints(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/resetuser") {
      await handleOwnerResetUser(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/userinfo") {
      await handleOwnerUserInfo(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/banuser") {
      await handleOwnerBanUser(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/unbanuser") {
      await handleOwnerUnbanUser(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/repair") {
      await handleOwnerRepair(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/config") {
      await handleOwnerConfig(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/settings") {
      await handleGroupSettings(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/start") {
      await handleStart(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/me") {
      await handleMe(token, db, message);
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
    if (command === "/daily") {
      await handleDaily(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/pay") {
      await handlePay(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/groups") {
      await handleGroups(token, db, c.env, message, 0);
      return c.json({ ok: true });
    }
    if (command === "/duels") {
      await handleDuels(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/audit") {
      await handleAudit(token, db, c.env, message, 0);
      return c.json({ ok: true });
    }
    if (text.startsWith("دعوا")) {
      await handleDuelRequest(token, db, message, c);
      return c.json({ ok: true });
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

      const result = await awardMeow(db, user, message.chat);

      if (result < 0) {
        await sendMessage(token, message.chat.id, `⏱️ صبر کن!\n\n${formatDuration(-result)} دیگه می‌تونی میو بدی! 😸`, {
          reply_to_message_id: message.message_id,
        });
        return c.json({ ok: true });
      }

      if (result === 0) {
        return c.json({ ok: true });
      }

      const points = result;
      // fetch user's updated balance and show it
      const userRow = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(user.id).first<{ meow_points: number }>();
      const balance = userRow?.meow_points ?? 0;

      let response = `🐱 میووو!\n\n✨ +${points} Meow Points\n💳 موجودی شما: <b>${balance} MP</b>`;
      if (points >= 1000) response = `🌟 <b>MEGA MEOW!!!</b> 🌟\n\n💰 +${points} Meow Points\n💳 موجودی شما: <b>${balance} MP</b>`;
      else if (points >= 100) response = `🔥 <b>BIG MEOW!</b> 🔥\n\n💰 +${points} Meow Points!\n💳 موجودی شما: <b>${balance} MP</b>`;

      await sendMessage(token, message.chat.id, response, {
        reply_to_message_id: message.message_id,
        reply_markup: postMeowKeyboard(message.chat.id),
      });
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return c.json({ ok: true });
  }
});

app.get("/", (c) => c.json({ ok: true, bot: "Meow Points", status: "online" }));

export default app;
