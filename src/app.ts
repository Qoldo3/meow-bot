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
  handleGroupSettings,
  handleMe,
  handleMyChatMember,
  handlePay,
  handleLottery,
  handleDice,
  handleTreasury,
  handleTreasuryCommand,
  handlePotCommand,
  handleStart,
  handleTop,
  handleDuelRank,
  handleBooster,
  handleGroupStats,
  handleNotifications,
  handleCallbackQuery,
  handleCat,
  handleMeowCat,
  handleCatTransfer,
  tierMessage,
  randomCooldownLine,
  meowMilestoneLine,
  randomCatFact,
} from "./handlers";
import { handlePokerCommand, handlePokerReplyCancel } from "./pokerHandlers";
import { handleBlackjackCommand, handleBlackjackReplyCancel } from "./blackjackHandlers";
import { handleTitle, handleTitleReplyBid, titleBadge } from "./titleAuction";
import { OWNER_COMMANDS, handleOwnerUserInfo, handleOwnerPendingText, isOwner } from "./owner";
import { isUserBanned, isMaintenanceMode, getGroupSettings, getGroupMemberBalance, getActiveTitle } from "./database";
import { telegramRequest, sendMessage } from "./telegram";
import { escapeHtml, isMeow, isMeowCat, formatDuration, parseReplyAction, tehranHour } from "./utils";
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

    // Owner-only private-chat flows: pending user search / broadcast draft.
    if (await handleOwnerPendingText(token, db, c.env, message, text)) {
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
    if (command === "/poker" || command === "/پوکر" || command === "poker" || command === "پوکر") {
      await handlePokerCommand(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/blackjack" || command === "/بلک‌جک" || command === "blackjack" || command === "بلک‌جک") {
      await handleBlackjackCommand(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "/treasury") {
      await handleTreasury(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "خزانه") {
      await handleTreasuryCommand(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (command === "پات") {
      await handlePotCommand(token, db, c.env, message);
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
    if (command === "/duelrank") {
      await handleDuelRank(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/booster" || command === "booster") {
      await handleBooster(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/groupstats" || command === "groupstats") {
      await handleGroupStats(token, db, message);
      return c.json({ ok: true });
    }
    if (command === "/notifications") {
      await handleNotifications(token, db, message);
      return c.json({ ok: true });
    }
    // "انتقال گربه {amount}" is the cat-transfer command, not /pay.
    if ((command === "/pay" || command === "pay" || command === "/انتقال" || command === "انتقال") && !/^انتقال گربه/i.test(text)) {
      await handlePay(token, db, message);
      return c.json({ ok: true });
    }
    if (
      text === "تایتل" ||
      text.startsWith("<تایتل") ||
      text.startsWith("تایتل ") ||
      text.startsWith("/تایتل")
    ) {
      await handleTitle(token, db, c.env, message);
      return c.json({ ok: true });
    }
    if (/^دعوا(?=[\s\u200C]|$)/.test(text)) {
      await handleDuelRequest(token, db, message);
      return c.json({ ok: true });
    }

    if (/^(cancel|لغو)$/i.test(text) && message.reply_to_message) {
      const handledPoker = await handlePokerReplyCancel(token, db, c.env, message);
      if (handledPoker) return c.json({ ok: true });
      const handledBlackjack = await handleBlackjackReplyCancel(token, db, c.env, message);
      if (handledBlackjack) return c.json({ ok: true });
    }

    if (message.reply_to_message) {
      const handledTitleBid = await handleTitleReplyBid(token, db, c.env, message);
      if (handledTitleBid) return c.json({ ok: true });
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

    if (isMeowCat(text)) {
      await handleMeowCat(token, db, c.env, message);
      return c.json({ ok: true });
    }

    if (/^(انتقال گربه|cat transfer)/i.test(text)) {
      await handleCatTransfer(token, db, c.env, message);
      return c.json({ ok: true });
    }

    if (text === "گربه" || text === "cat" || text === "/cat" || text.startsWith("گربه اسم") || text.startsWith("گربه‌اسم") || text.startsWith("cat name") || text.startsWith("catname") || text.startsWith("/catname")) {
      await handleCat(token, db, c.env, message);
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

      const result = await awardMeow(db, user, message.chat, c.env.MEOW_VIP_USER_ID);

      if ("cooldown" in result && result.cooldown) {
        await sendMessage(token, message.chat.id, randomCooldownLine().replace("{duration}", formatDuration(result.cooldown)), {
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
        ? `\n\n🎯 رویداد فعلی: <b>${escapeHtml(activeEvent.title)}</b>\n${escapeHtml(activeEvent.description)}\n💥 ضریب: x${activeEvent.bonus_multiplier}`
        : "";
      // Clarify exactly where boosted points come from (same pattern as the
      // event bonus line) whenever a multiplier is in play.
      const bonusLines: string[] = [];
      if (result.eventBonus > 1) bonusLines.push(`🔹 ضریب رویداد: <b>x${result.eventBonus}</b>`);
      if (result.boosterMult > 1) bonusLines.push(`🔹 ضریب بوستر: <b>x${result.boosterMult}</b>`);
      if ("catMult" in result && result.catMult > 1) bonusLines.push(`🔹 ضریب گربه: <b>x${result.catMult}</b>`);
      if ("milestoneMult" in result && result.milestoneMult > 1) bonusLines.push(`🎉 ضریب میو دهم: <b>x${result.milestoneMult}</b>`);
      const bonusBreakdown = bonusLines.length
        ? `\n\n🔹 امتیاز پایه: <b>${result.basePoints} MP</b>\n${bonusLines.join("\n")}\n🔹 امتیاز نهایی: <b>${points} MP</b>`
        : "";
      const taxText = "taxAmount" in result && result.taxAmount > 0 ? `\n\n📉 مالیات: ${result.taxAmount} MP (${Math.round(result.taxRate * 100)}%)` : "";

      const story = tierMessage(tier, points, tehranHour());

      let response = `${story}\n\n💳 موجودی این گروه: <b>${balance} MP</b>${bonusBreakdown}${taxText}`;
      if (activeEvent) response += eventLine;

      if (points >= 1000) {
        response = `🌟 <b>MEGA MEOW!!!</b> 🌟\n\n${story}\n💳 موجودی گروه: <b>${balance} MP</b>${bonusBreakdown}${taxText}`;
        if (activeEvent) response += eventLine;
      } else if (points >= 100) {
        response = `🔥 <b>BIG MEOW!</b> 🔥\n\n${story}\n💳 موجودی گروه: <b>${balance} MP</b>${bonusBreakdown}${taxText}`;
        if (activeEvent) response += eventLine;
      }

      if (result.lotteryTicketEarned) {
        response += `\n\n🎁 <b>+۱ بلیت رایگان لاتاری!</b> 🎟️`;
      }

      const milestone = meowMilestoneLine(result.firstMeow, result.milestone);
      if (milestone) response += `\n\n${milestone}`;

      // ~1 in 5 meows ends with a cat fact, so even normal meows occasionally spark chat.
      if (Math.random() < 0.2) {
        response += `\n\n${randomCatFact()}`;
      }

      const meowTitle = await getActiveTitle(db, message.chat.id, user.id);
      if (meowTitle) {
        response = `${titleBadge(meowTitle.name, meowTitle.last_price, meowTitle.emoji)}\n${response}`;
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

export default app;
