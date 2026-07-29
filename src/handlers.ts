import {
  sendMessage,
  answerCallback,
  editMessageText,
  deleteMessage,
  isGroupAdmin,
  telegramRequest,
} from "./telegram";
import {
  mainMenuKeyboard,
  postMeowKeyboard,
  ownerPanelKeyboard,
  groupSettingsKeyboard,
  duelKeyboard,
  userActionKeyboard,
  broadcastConfirmKeyboard,
  groupManagerKeyboard,
  configInlineKeyboard,
  txnAuditKeyboard,
} from "./keyboards";
import {
  ensureUser,
  ensureGroup,
  deactivateGroup,
  getGroupSettings,
  getUserStats,
  getGlobalRank,
  isMaintenanceMode,
  findUserByUsername,
  findUserById,
  isUserBanned,
  getBotSetting,
  setBotSetting,
  getUserTransactions,
  getUserGroupMemberships,
} from "./database";
import {
  createDuel,
  getDuel,
  deleteDuel,
  findOpenDuelAgainst,
  scheduleDuelTimeout,
} from "./duel";
import {
  escapeHtml,
  formatDuration,
  safeParseAmount,
  normalizeUsername,
  isMeow,
  randomMeowPoints,
  generateDuelId,
  isValidDuelId,
} from "./utils";
import {
  Bindings,
  DuelState,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramChat,
  TelegramChatMemberUpdated,
  TelegramUser,
} from "./types";
import { BROADCAST_PAGE_SIZE, DUEL_TIMEOUT_SEC } from "./constants";

const broadcastDrafts = new Map<number, string>();

export async function awardMeow(db: D1Database, user: TelegramUser, chat: TelegramChat): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  await ensureUser(db, user);
  // Read configurable chances from bot settings (fall back to defaults)
  const megaSetting = await getBotSetting(db, "mega_chance");
  const bigSetting = await getBotSetting(db, "big_chance");
  const megaChance = megaSetting ? parseFloat(megaSetting) : 0.01;
  const bigChance = bigSetting ? parseFloat(bigSetting) : 0.05;
  const points = randomMeowPoints(megaChance, bigChance);

  if (isGroup) {
    const settings = await getGroupSettings(db, chat.id);
    if (!settings.enabled) return 0;
    await ensureGroup(db, chat);

    const result = await db.prepare(`
      INSERT INTO group_members (
        telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        meow_points = group_members.meow_points + excluded.meow_points,
        total_meows = group_members.total_meows + 1,
        last_meow_at = excluded.last_meow_at
      WHERE group_members.last_meow_at IS NULL OR group_members.last_meow_at < ?
    `).bind(chat.id, user.id, user.username ?? null, user.first_name, points, now, now - settings.cooldown).run();

    if (result.meta.changes === 0) {
      const row = await db.prepare(`SELECT last_meow_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
        .bind(chat.id, user.id).first<{ last_meow_at: number }>();
      const remaining = row ? Math.max(0, settings.cooldown - (now - row.last_meow_at)) : settings.cooldown;
      return -remaining;
    }

    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(points, user.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(user.id, chat.id, points, "MEOW", now),
    ]);

    return points;
  }

  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(points, user.id),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(user.id, null, points, "MEOW", now),
  ]);

  return points;
}

export async function handleStart(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const isPm = message.chat.type === "private";
  const text = isPm
    ? `🐱 سلام <b>${escapeHtml(message.from.first_name)}</b>!\n\nبه دنیای Meow Points خوش اومدی! 🎉\n\nهر وقت توی گروه بنویسی <b>میو</b> یا <b>meow</b>، ممکنه امتیاز بگیری! ✨\n\nاز منوی زیر استفاده کن:`
    : `🐱 سلام گروه!\n\nمنوهای من با دکمه‌های شیشه‌ای کار می‌کنن. برای دیدن منو، روی دکمه‌ها کلیک کنید یا دستورات رو بفرستید.`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard() });
}

export async function handleMe(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const stats = await getUserStats(db, message.from.id);
  const rank = await getGlobalRank(db, message.from.id);

  const text =
    `🐱 پروفایل <b>${escapeHtml(message.from.first_name)}</b>\n\n` +
    `💰 Meow Points: <b>${stats?.meow_points ?? 0}</b>\n` +
    `🐾 Total Meows: <b>${stats?.total_meows ?? 0}</b>\n` +
    `🏆 رتبه جهانی: <b>#${rank}</b>`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard() });
}

function formatLeaderboard(rows: { first_name: string; username: string | null; meow_points: number }[]) {
  const medals = ["🥇", "🥈", "🥉"];
  return rows
    .map((u, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const name = escapeHtml(u.first_name || u.username || "Unknown Cat");
      return `${medal} ${name} — ${u.meow_points} MP`;
    })
    .join("\n");
}

export async function handleTop(token: string, db: D1Database, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 دستور /top فقط داخل گروه کار می‌کنه!");
    return;
  }

  const results = await db
    .prepare(`
      SELECT first_name, username, meow_points
      FROM group_members
      WHERE telegram_group_id = ?
      ORDER BY meow_points DESC
      LIMIT 10
    `)
    .bind(message.chat.id)
    .all<{ first_name: string; username: string | null; meow_points: number }>();

  if (!results.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هنوز کسی Meow نکرده!");
    return;
  }

  await sendMessage(token, message.chat.id, `🏆 <b>Meow Leaderboard</b>\n\n${formatLeaderboard(results.results)}`);
}

export async function handleGlobal(token: string, db: D1Database, message: TelegramMessage) {
  const results = await db
    .prepare(`
      SELECT first_name, username, meow_points
      FROM users
      ORDER BY meow_points DESC
      LIMIT 10
    `)
    .all<{ first_name: string; username: string | null; meow_points: number }>();

  if (!results.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هنوز کسی Meow نکرده!");
    return;
  }

  await sendMessage(token, message.chat.id, `🌍 <b>Global Meow Leaderboard</b>\n\n${formatLeaderboard(results.results)}`);
}

export async function handleDaily(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const now = Math.floor(Date.now() / 1000);
  const user = await db
    .prepare(`SELECT meow_points, last_daily_at, daily_streak FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number; last_daily_at: number | null; daily_streak: number }>();

  if (user?.last_daily_at && now - user.last_daily_at < 86400) {
    const remaining = 86400 - (now - user.last_daily_at);
    const hours = Math.ceil(remaining / 3600);
    await sendMessage(token, message.chat.id, `🎁 جایزه امروزت رو قبلاً گرفتی!\n\n⏰ حدود ${hours} ساعت دیگه دوباره امتحان کن.`);
    return;
  }

  const streak =
    user?.last_daily_at && now - user.last_daily_at > 172800
      ? 1
      : (user?.daily_streak ?? 0) + 1;

  const reward = 500;

  await db
    .prepare(`UPDATE users SET meow_points = meow_points + ?, daily_streak = ?, last_daily_at = ? WHERE telegram_id = ?`)
    .bind(reward, streak, now, message.from.id)
    .run();

  await db
    .prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
    .bind(message.from.id, reward, "DAILY_REWARD", now)
    .run();

  await sendMessage(token, message.chat.id, `🎁 <b>جایزه روزانه!</b>\n\n💰 +${reward} Meow Points\n🔥 Streak: ${streak} روز`);
}

export async function handlePay(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 انتقال امتیاز فقط داخل گروه انجام می‌شه!", { reply_to_message_id: message.message_id });
    return;
  }

  const text = message.text || "";
  const parts = text.split(" ").filter(Boolean);

  let targetUser: { telegram_id: number; first_name: string } | null = null;
  let amount: number | null = null;

  if (message.reply_to_message?.from && parts.length === 2) {
    const replied = message.reply_to_message.from;
    if (replied.is_bot) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به ربات انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
    if (replied.id === message.from.id) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به خودت انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
    amount = safeParseAmount(parts[1]);
    if (amount === null) {
      await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
      return;
    }
    await ensureUser(db, replied);
    targetUser = { telegram_id: replied.id, first_name: replied.first_name };
  } else if (parts.length >= 3) {
    amount = safeParseAmount(parts[2]);
    if (amount === null) {
      await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
      return;
    }
    targetUser = await findUserByUsername(db, normalizeUsername(parts[1]));
    if (!targetUser) {
      await sendMessage(token, message.chat.id, "🐱 کاربری با این یوزرنیم پیدا نشد!", { reply_to_message_id: message.message_id });
      return;
    }
    if (targetUser.telegram_id === message.from.id) {
      await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به خودت انتقال بدی!", { reply_to_message_id: message.message_id });
      return;
    }
  } else {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده:\n/pay @username 100\nیا ریپلای کن و بنویس /pay 100", { reply_to_message_id: message.message_id });
    return;
  }

  if (!targetUser) {
    await sendMessage(token, message.chat.id, "🐱 کاربر پیدا نشد!", { reply_to_message_id: message.message_id });
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  const batchResults = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(amount, message.from.id, amount),
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, targetUser.telegram_id),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(message.from.id, message.chat.id, -amount, `PAY_TO_${targetUser.telegram_id}`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(targetUser.telegram_id, message.chat.id, amount, `PAY_FROM_${message.from.id}`, now),
  ]);

  if (batchResults[0].meta.changes === 0) {
    await sendMessage(token, message.chat.id, "🐱 امتیاز کافی نداری!", { reply_to_message_id: message.message_id });
    return;
  }

  await sendMessage(
    token,
    message.chat.id,
    `💸 <b>انتقال موفق!</b>\n\n🐱 ${escapeHtml(message.from.first_name)}\n➡️ ${amount} MP\n🐱 ${escapeHtml(targetUser.first_name)}`
  );
}

export async function handleDuelRequest(
  token: string,
  db: D1Database,
  message: TelegramMessage,
  c: any
) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 دعوا فقط داخل گروه انجام می‌شه!");
    return;
  }

  if (!message.reply_to_message || !message.reply_to_message.from) {
    await sendMessage(
      token,
      message.chat.id,
      "🐱 برای دعوا، روی پیام حریفت ریپلای کن و بنویس:\n<code>دعوا 500</code>",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const target = message.reply_to_message.from;
  if (target.is_bot) {
    await sendMessage(token, message.chat.id, "🐱 نمی‌تونی با ربات دعوا کنی!", { reply_to_message_id: message.message_id });
    return;
  }

  if (target.id === message.from.id) {
    await sendMessage(token, message.chat.id, "🐱 نمی‌تونی با خودت دعوا کنی!", { reply_to_message_id: message.message_id });
    return;
  }

  const text = message.text || "";
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 نحوه استفاده:\nریپلای کن و بنویس <code>دعوا 500</code>`,
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const amount = safeParseAmount(parts[1]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
    return;
  }

  await ensureUser(db, message.from);
  const challenger = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number }>();

  if (!challenger || challenger.meow_points < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی نداری!\n💰 موجودی: ${challenger?.meow_points ?? 0} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureUser(db, target);
  const existingId = await findOpenDuelAgainst(db, message.chat.id, target.id);
  if (existingId) await deleteDuel(db, existingId);

  const duelId = generateDuelId();
  const nowSec = Math.floor(Date.now() / 1000);

  const res = await telegramRequest(token, "sendMessage", {
    chat_id: message.chat.id,
    text:
      `⚔️ <b>دعوای Meow!</b>\n\n` +
      `🐱 ${escapeHtml(message.from.first_name)}\n` +
      `🆚\n` +
      `🐱 ${escapeHtml(target.first_name)}\n\n` +
      `💰 شرط: <b>${amount} MP</b>\n` +
      `🏆 برنده: <b>${amount * 2} MP</b>\n\n` +
      `⏱️ ${DUEL_TIMEOUT_SEC} ثانیه فرصت داری قبول کنی!`,
    parse_mode: "HTML",
    reply_markup: duelKeyboard(duelId),
  });

  if (!res.ok || !res.result?.message_id) return;

  const duel: DuelState = {
    id: duelId,
    challengerId: message.from.id,
    challengerName: message.from.first_name,
    targetId: target.id,
    targetName: target.first_name,
    amount,
    groupId: message.chat.id,
    messageId: res.result.message_id,
    createdAt: nowSec,
  };

  await createDuel(db, duel);
  await scheduleDuelTimeout(c, token, db, duelId);
}

export async function handleDuelAccept(
  token: string,
  db: D1Database,
  callback: TelegramCallbackQuery,
  duelId: string
) {
  if (!callback.message) return;

  if (!isValidDuelId(duelId)) {
    await answerCallback(token, callback.id, "🐱 دعوای نامعتبر!", true);
    return;
  }

  const duel = await getDuel(db, duelId);
  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 فقط حریف می‌تونه قبول کنه!", true);
    return;
  }

  await deleteDuel(db, duelId);
  const now = Math.floor(Date.now() / 1000);

  // Double-check both players actually have enough points before proceeding.
  const challengerRow = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(duel.challengerId).first<{ meow_points: number }>();
  const targetRow = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(duel.targetId).first<{ meow_points: number }>();

  if (!challengerRow || !targetRow || challengerRow.meow_points < duel.amount || targetRow.meow_points < duel.amount) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>\n\nیکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const batchResults = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.challengerId, duel.amount),
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.targetId, duel.amount),
  ]);

  // defensive check in case concurrent change happened between select and update
  if (batchResults[0].meta.changes === 0 || batchResults[1].meta.changes === 0) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>\n\nیکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const challengerRoll = Math.floor(Math.random() * 100) + 1;
  const targetRoll = Math.floor(Math.random() * 100) + 1;

  if (challengerRoll === targetRoll) {
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.challengerId),
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.targetId),
    ]);

    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `🎲 <b>دعوای Meow!</b>\n\n` +
      `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}\n` +
      `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}\n\n` +
      `🤝 <b>مساوی!</b>\nهیچ‌کس امتیازی نمی‌بره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const winnerId = challengerRoll > targetRoll ? duel.challengerId : duel.targetId;
  const winnerName = challengerRoll > targetRoll ? duel.challengerName : duel.targetName;
  const pot = duel.amount * 2;

  await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(pot, winnerId).run();

  await db.batch([
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.challengerId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.targetId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(winnerId, duel.groupId, pot, `DUEL_WIN`, now),
    db.prepare(`
      INSERT INTO group_members (telegram_group_id, telegram_user_id, meow_points, total_meows, last_meow_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        meow_points = MAX(0, group_members.meow_points + ?)
    `).bind(duel.groupId, duel.challengerId, -duel.amount, now, -duel.amount),
    db.prepare(`
      INSERT INTO group_members (telegram_group_id, telegram_user_id, meow_points, total_meows, last_meow_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        meow_points = MAX(0, group_members.meow_points + ?)
    `).bind(duel.groupId, duel.targetId, -duel.amount, now, -duel.amount),
    db.prepare(`
      INSERT INTO group_members (telegram_group_id, telegram_user_id, meow_points, total_meows, last_meow_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        meow_points = group_members.meow_points + ?
    `).bind(duel.groupId, winnerId, pot, now, pot),
  ]);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `🎲 <b>دعوای Meow!</b>\n\n` +
    `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}\n` +
    `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}\n\n` +
    `🏆 <b>${escapeHtml(winnerName)} برنده شد!</b>\n` +
    `💰 +${pot} MP`
  );

  await answerCallback(token, callback.id, "🎲 دعوا انجام شد!");
}

export async function handleDuelDecline(token: string, db: D1Database, callback: TelegramCallbackQuery, duelId: string) {
  if (!callback.message) return;

  if (!isValidDuelId(duelId)) {
    await answerCallback(token, callback.id, "🐱 دعوای نامعتبر!", true);
    return;
  }

  const duel = await getDuel(db, duelId);
  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id && duel.challengerId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 این دعوا مال تو نیست!", true);
    return;
  }

  await deleteDuel(db, duelId);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `❌ <b>دعوا لغو شد!</b>\n\n` +
    `🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}\n` +
    `💰 ${duel.amount} MP`
  );

  await answerCallback(token, callback.id, "✅ دعوا لغو شد.");
}

export async function handleAdmin(token: string, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 دسترسی غیرمجاز!");
    return;
  }

  const stats = await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{ count: number }>();
  const groups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups WHERE is_active = 1`).first<{ count: number }>();
  const totalGroups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups`).first<{ count: number }>();

  const text =
    `🛡️ <b>Owner Panel</b>\n\n` +
    `👤 کاربران: <b>${stats?.count ?? 0}</b>\n` +
    `👥 گروه‌های فعال: <b>${groups?.count ?? 0}</b>\n` +
    `👥 کل گروه‌ها: <b>${totalGroups?.count ?? 0}</b>\n\n` +
    `از دکمه‌ها استفاده کن:`;

  await sendMessage(token, message.chat.id, text, { reply_markup: ownerPanelKeyboard() });
}

export async function handleGroupSettings(token: string, db: D1Database, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 این دستور فقط داخل گروه کار می‌کنه!");
    return;
  }

  if (!message.from) return;

  const isAdmin = await isGroupAdmin(token, message.chat.id, message.from.id);
  if (!isAdmin) {
    await sendMessage(token, message.chat.id, "🚫 فقط ادمین‌های گروه می‌تونن تنظیمات رو تغییر بدن!", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureGroup(db, message.chat);
  const settings = await getGroupSettings(db, message.chat.id);

  const text =
    `⚙️ <b>تنظیمات گروه</b>\n\n` +
    `🤖 وضعیت ربات: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}\n` +
    `⏱️ کول‌داون: ${settings.cooldown} ثانیه`;

  await sendMessage(token, message.chat.id, text, { reply_markup: groupSettingsKeyboard(settings.enabled, settings.cooldown) });
}

export async function handleCallbackQuery(
  token: string,
  db: D1Database,
  env: Bindings,
  callback: TelegramCallbackQuery
) {
  if (!callback.message || !callback.data) return;

  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const userId = callback.from.id;
  const data = callback.data;

  const segments = data.split(":");
  if (segments.length < 2) {
    await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
    return;
  }

  const [action, ...params] = segments;

  if (action === "admin" && env.BOT_OWNER_ID !== String(userId)) {
    await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
    return;
  }

  if (action === "group") {
    const isAdmin = await isGroupAdmin(token, chatId, userId);
    if (!isAdmin) {
      await answerCallback(token, callback.id, "🚫 فقط ادمین گروه!", true);
      return;
    }
  }

  try {
    if (action === "cmd") {
      const fakeMessage: TelegramMessage = {
        message_id: messageId,
        from: callback.from,
        chat: callback.message.chat,
        text: `/${params[0]}`,
      };

      if (params[0] === "me") await handleMe(token, db, fakeMessage);
      else if (params[0] === "top") await handleTop(token, db, fakeMessage);
      else if (params[0] === "global") await handleGlobal(token, db, fakeMessage);
      else if (params[0] === "daily") await handleDaily(token, db, fakeMessage);

      await answerCallback(token, callback.id);
      return;
    }

    if (action === "menu") {
      if (params[0] === "main") {
        await editMessageText(token, chatId, messageId, "🐱 <b>منوی اصلی</b>\n\nیک گزینه انتخاب کن:", mainMenuKeyboard());
      } else if (params[0] === "group_settings") {
        if (callback.message.chat.type === "private") {
          await answerCallback(token, callback.id, "این منو فقط داخل گروه کار می‌کند!", true);
          return;
        }
        const isAdmin = await isGroupAdmin(token, chatId, userId);
        if (!isAdmin) {
          await answerCallback(token, callback.id, "🚫 فقط ادمین گروه!", true);
          return;
        }
        const settings = await getGroupSettings(db, chatId);
        await editMessageText(
          token,
          chatId,
          messageId,
          `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${settings.cooldown}s`,
          groupSettingsKeyboard(settings.enabled, settings.cooldown)
        );
      } else if (params[0] === "close") {
        await deleteMessage(token, chatId, messageId);
      } else if (params[0] === "admin") {
        const fakeMessage: TelegramMessage = {
          message_id: messageId,
          from: callback.from,
          chat: callback.message.chat,
          text: "/admin",
        };
        await handleAdmin(token, env, fakeMessage);
      }
      await answerCallback(token, callback.id);
      return;
    }

    if (action === "group") {
      const settings = await getGroupSettings(db, chatId);

      if (params[0] === "toggle_bot") {
        const newState = settings.enabled ? 0 : 1;
        await db.prepare(`UPDATE telegram_groups SET bot_enabled = ? WHERE telegram_group_id = ?`).bind(newState, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown));
      } else if (params[0] === "set_cooldown") {
        const options = [5, 10, 30, 60, 300];
        const currentIndex = options.indexOf(settings.cooldown);
        const nextCooldown = options[(currentIndex + 1) % options.length];
        await db.prepare(`UPDATE telegram_groups SET cooldown_seconds = ? WHERE telegram_group_id = ?`).bind(nextCooldown, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown));
      } else if (params[0] === "reset_lb") {
        await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(chatId).run();
        await editMessageText(token, chatId, messageId, "🔄 <b>لیدربورد گروه ریست شد!</b>", {
          inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu:group_settings" }]],
        });
      }

      await answerCallback(token, callback.id, "✅ انجام شد!");
      return;
    }

    if (action === "duel") {
      if (params[0] === "accept") {
        await handleDuelAccept(token, db, callback, params[1]);
      } else if (params[0] === "decline") {
        await handleDuelDecline(token, db, callback, params[1]);
      }
      return;
    }

    if (action === "admin") {
      if (params[0] === "stats") {
        const users = await db.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
        const groups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE is_active = 1`).first<{ c: number }>();
        const totalGroups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups`).first<{ c: number }>();
        const meows = await db.prepare(`SELECT SUM(total_meows) as c FROM users`).first<{ c: number }>();
        const text = `📊 <b>آمار ربات</b>\n\n👤 کاربران: ${users?.c ?? 0}\n👥 گروه‌های فعال: ${groups?.c ?? 0}\n👥 کل گروه‌ها: ${totalGroups?.c ?? 0}\n🐾 کل میوها: ${meows?.c ?? 0}`;
        await editMessageText(token, chatId, messageId, text, ownerPanelKeyboard());
      } else if (params[0] === "maintenance") {
        const current = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
        const newMode = current?.value === "1" ? "0" : "1";
        await db.prepare(`INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(newMode).run();
        const status = newMode === "1" ? "🔴 روشن" : "🟢 خاموش";
        await editMessageText(token, chatId, messageId, `🔧 <b>حالت تعمیرات: ${status}</b>\n\nربات ${newMode === "1" ? "فقط برای ادمین‌ها کار می‌کنه" : "برای همه فعاله"}`, ownerPanelKeyboard());
      } else if (params[0] === "broadcast") {
        await editMessageText(token, chatId, messageId, `📢 <b>پیام همگانی</b>\n\nبرای ارسال پیام به همه کاربران، از دستور زیر استفاده کن:\n\n<code>/broadcast پیام شما</code>`, ownerPanelKeyboard());
      } else if (params[0] === "addpoints" || params[0] === "removepoints") {
        await editMessageText(token, chatId, messageId, `💰 <b>${params[0] === "addpoints" ? "افزودن" : "کسر"} امتیاز</b>\n\nاستفاده:\n<code>/${params[0]} @username 100</code>`, ownerPanelKeyboard());
      } else if (params[0] === "resetuser") {
        await editMessageText(token, chatId, messageId, `🔄 <b>ریست کاربر</b>\n\nاستفاده:\n<code>/resetuser @username</code>`, ownerPanelKeyboard());
      } else if (params[0] === "userinfo") {
        await editMessageText(token, chatId, messageId, `👤 <b>اطلاعات کاربر</b>\n\nاستفاده:\n<code>/userinfo @username</code>\nیا\n<code>/userinfo 123456789</code>`, ownerPanelKeyboard());
      } else if (params[0] === "banmenu") {
        await editMessageText(token, chatId, messageId, `🚫 <b>بن/آنبن کاربر</b>\n\nاستفاده:\n<code>/banuser @username</code>\n<code>/unbanuser @username</code>`, ownerPanelKeyboard());
      } else if (params[0] === "repair") {
        await editMessageText(token, chatId, messageId, `🔍 <b>بررسی دیتابیس</b>\n\nاستفاده:\n<code>/repair</code>`, ownerPanelKeyboard());
      } else if (params[0] === "config") {
        const currentDaily = await getBotSetting(db, "daily_reward") ?? "500";
        const currentMega = await getBotSetting(db, "mega_chance") ?? "0.01";
        const currentBig = await getBotSetting(db, "big_chance") ?? "0.05";
        await editMessageText(token, chatId, messageId, "⚙️ <b>تنظیمات ربات</b>\n\nاز دکمه‌ها استفاده کن:", configInlineKeyboard(currentDaily, currentMega, currentBig));
      } else if (params[0] === "groups") {
        const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/groups" };
        await handleGroups(token, db, env, fakeMessage, 0);
      } else if (params[0] === "duels") {
        const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/duels" };
        await handleDuels(token, db, env, fakeMessage);
      } else if (params[0] === "audit") {
        const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/audit" };
        await handleAudit(token, db, env, fakeMessage, 0);
      }
      await answerCallback(token, callback.id);
      return;
    }

    if (action === "useract") {
      const targetUserId = parseInt(params[2], 10);
      const amount = parseInt(params[3], 10) || 0;
      const now = Math.floor(Date.now() / 1000);

      if (params[1] === "add") {
        await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, targetUserId).run();
        await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
          .bind(targetUserId, amount, "OWNER_INLINE_ADD", now).run();
        await answerCallback(token, callback.id, `✅ +${amount} MP`, true);
      } else if (params[1] === "sub") {
        await db.prepare(`UPDATE users SET meow_points = MAX(0, meow_points - ?) WHERE telegram_id = ?`).bind(amount, targetUserId).run();
        await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
          .bind(targetUserId, -amount, "OWNER_INLINE_SUB", now).run();
        await answerCallback(token, callback.id, `✅ -${amount} MP`, true);
      } else if (params[1] === "ban") {
        await db.prepare(`UPDATE users SET is_banned = 1 WHERE telegram_id = ?`).bind(targetUserId).run();
        await answerCallback(token, callback.id, "🚫 کاربر بن شد!", true);
      } else if (params[1] === "unban") {
        await db.prepare(`UPDATE users SET is_banned = 0 WHERE telegram_id = ?`).bind(targetUserId).run();
        await answerCallback(token, callback.id, "✅ کاربر آنبن شد!", true);
      } else if (params[1] === "reset") {
        await db.prepare(`UPDATE users SET meow_points = 0, total_meows = 0, daily_streak = 0, last_daily_at = NULL WHERE telegram_id = ?`).bind(targetUserId).run();
        await db.prepare(`DELETE FROM group_members WHERE telegram_user_id = ?`).bind(targetUserId).run();
        await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ?`).bind(targetUserId).run();
        await answerCallback(token, callback.id, "🔄 کاربر ریست شد!", true);
      } else if (params[1] === "txns") {
        const txns = await getUserTransactions(db, targetUserId, 10);
        let text = `📜 <b>تراکنش‌های کاربر</b>\n\n`;
        for (const t of txns.results) {
          const sign = t.amount >= 0 ? "+" : "";
          text += `${sign}${t.amount} — ${t.reason} (${new Date(t.created_at * 1000).toLocaleDateString("fa-IR")})\n`;
        }
        await sendMessage(token, chatId, text || "تراکنشی یافت نشد.");
        await answerCallback(token, callback.id);
        return;
      }

      const user = await findUserById(db, targetUserId);
      if (user) {
        const rank = await getGlobalRank(db, user.telegram_id);
        const text =
          `👤 <b>${escapeHtml(user.first_name)}</b>\n\n` +
          `🆔 <code>${user.telegram_id}</code>\n` +
          `💰 ${user.meow_points} MP | 🏆 #${rank}\n` +
          `🐾 ${user.total_meows} | 🔥 ${user.daily_streak} روز`;
        await editMessageText(token, chatId, messageId, text, userActionKeyboard(targetUserId));
      }
      return;
    }

    if (action === "bc") {
      if (params[0] === "confirm") {
        await handleBroadcastConfirm(token, db, env, callback);
      } else if (params[0] === "cancel") {
        broadcastDrafts.delete(callback.from.id);
        await editMessageText(token, chatId, messageId, "❌ ارسال لغو شد.", ownerPanelKeyboard());
        await answerCallback(token, callback.id, "لغو شد.");
      }
      return;
    }

    if (action === "groupmgr") {
      const targetGroupId = parseInt(params[1], 10);
      const currentPage = parseInt(params[2], 10) || 0;
      const now = Math.floor(Date.now() / 1000);

      if (params[0] === "page") {
        const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/groups" };
        await handleGroups(token, db, env, fakeMessage, targetGroupId);
        await answerCallback(token, callback.id);
        return;
      }

      if (params[0] === "toggle") {
        const g = await db.prepare(`SELECT is_active, title FROM telegram_groups WHERE telegram_group_id = ?`).bind(targetGroupId).first<{ is_active: number; title: string }>();
        const newState = g?.is_active ? 0 : 1;
        await db.prepare(`UPDATE telegram_groups SET is_active = ?, updated_at = ? WHERE telegram_group_id = ?`).bind(newState, now, targetGroupId).run();
        await answerCallback(token, callback.id, newState ? "✅ گروه فعال شد" : "🚫 گروه غیرفعال شد", true);
      } else if (params[0] === "reset") {
        await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(targetGroupId).run();
        await answerCallback(token, callback.id, "🔄 لیدربورد ریست شد!", true);
      } else if (params[0] === "stats") {
        const stats = await db.prepare(`SELECT COUNT(*) as c, SUM(meow_points) as p FROM group_members WHERE telegram_group_id = ?`).bind(targetGroupId).first<{ c: number; p: number }>();
        await sendMessage(token, chatId, `📊 آمار گروه ${targetGroupId}:\n👥 ${stats?.c ?? 0} عضو\n💰 ${stats?.p ?? 0} MP کل`);
        await answerCallback(token, callback.id);
        return;
      }

      const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/groups" };
      await handleGroups(token, db, env, fakeMessage, currentPage);
      return;
    }

    if (action === "cfg") {
      if (params[0] === "noop") {
        await answerCallback(token, callback.id);
        return;
      }
      const keyMap: Record<string, string> = { daily: "daily_reward", mega: "mega_chance", big: "big_chance" };
      const key = keyMap[params[1]];
      if (!key) { await answerCallback(token, callback.id); return; }

      const current = await getBotSetting(db, key) ?? (key === "daily_reward" ? "500" : key === "mega_chance" ? "0.01" : "0.05");
      const delta = parseFloat(params[2]);
      let newVal: string;

      if (key === "daily_reward") {
        newVal = String(Math.max(0, parseInt(current, 10) + (params[0] === "inc" ? delta : -delta)));
      } else {
        newVal = String(Math.max(0, Math.min(1, parseFloat(current) + (params[0] === "inc" ? delta : -delta))));
      }

      await setBotSetting(db, key, newVal);
      const updatedDaily = await getBotSetting(db, "daily_reward") ?? "500";
      const updatedMega = await getBotSetting(db, "mega_chance") ?? "0.01";
      const updatedBig = await getBotSetting(db, "big_chance") ?? "0.05";

      await editMessageText(token, chatId, messageId, "⚙️ <b>تنظیمات ربات</b>\n\nاز دکمه‌ها استفاده کن:", configInlineKeyboard(updatedDaily, updatedMega, updatedBig));
      await answerCallback(token, callback.id, `✅ ${key} = ${newVal}`);
      return;
    }

    if (action === "duelmon") {
      if (params[0] === "cancel" && isValidDuelId(params[1])) {
        const duel = await getDuel(db, params[1]);
        if (duel) {
          await deleteDuel(db, params[1]);
          await telegramRequest(token, "editMessageText", {
            chat_id: duel.groupId,
            message_id: duel.messageId,
            text: `❌ <b>دعوا توسط ادمین لغو شد!</b>\n\n🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}`,
            parse_mode: "HTML",
          });
        }
        await answerCallback(token, callback.id, "✅ دعوا لغو شد.", true);
        const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/duels" };
        await handleDuels(token, db, env, fakeMessage);
      }
      return;
    }

    if (action === "audit") {
      const targetPage = parseInt(params[1], 10) || 0;
      const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/audit" };
      await handleAudit(token, db, env, fakeMessage, targetPage);
      await answerCallback(token, callback.id);
      return;
    }

    await answerCallback(token, callback.id);
  } catch (err) {
    console.error("Callback error:", err);
    await answerCallback(token, callback.id, "❌ خطا رخ داد!", true);
  }
}

export async function handleOwnerBroadcast(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const text = (message.text || "").replace(/^\/broadcast\s*/, "");
  if (!text) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده: /broadcast پیام شما");
    return;
  }

  broadcastDrafts.set(message.from.id, text);
  await sendMessage(token, message.chat.id,
    `📢 <b>پیش‌نمایش پیام همگانی:</b>\n\n${escapeHtml(text)}\n\nآماده ارسال به همه کاربران؟`,
    { reply_markup: broadcastConfirmKeyboard() }
  );
}

export async function handleBroadcastConfirm(token: string, db: D1Database, env: Bindings, callback: TelegramCallbackQuery) {
  if (!callback.from || env.BOT_OWNER_ID !== String(callback.from.id)) {
    await answerCallback(token, callback.id, "🚫 فقط ادمین!", true);
    return;
  }

  const draft = broadcastDrafts.get(callback.from.id);
  if (!draft) {
    await answerCallback(token, callback.id, "❌ پیش‌نمایش منقضی شده!", true);
    return;
  }

  broadcastDrafts.delete(callback.from.id);
  await answerCallback(token, callback.id, "📢 در حال ارسال...");

  let sent = 0;
  let failed = 0;
  let lastId = 0;

  while (true) {
    const users = await db.prepare(`SELECT telegram_id FROM users WHERE telegram_id > ? ORDER BY telegram_id LIMIT ?`)
      .bind(lastId, BROADCAST_PAGE_SIZE)
      .all<{ telegram_id: number }>();

    if (!users.results.length) break;

    for (const u of users.results) {
      const res = await telegramRequest(token, "sendMessage", {
        chat_id: u.telegram_id,
        text: `📢 <b>پیام از طرف ادمین</b>\n\n${escapeHtml(draft)}`,
        parse_mode: "HTML",
      });
      if (res.ok) sent++;
      else failed++;
      lastId = u.telegram_id;
    }

    await new Promise((r) => setTimeout(r, Math.ceil(users.results.length / 25) * 1000));
  }

  if (callback.message) {
    await editMessageText(token, callback.message.chat.id, callback.message.message_id,
      `📢 <b>ارسال تکمیل شد!</b>\n\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
      ownerPanelKeyboard()
    );
  }
}

export async function handleOwnerAddPoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /addpoints @username 100");
    return;
  }

  const amount = safeParseAmount(parts[2]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "مقدار نامعتبر!");
    return;
  }

  const user = await findUserByUsername(db, normalizeUsername(parts[1]));
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, user.telegram_id).run();
  await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
    .bind(user.telegram_id, amount, "OWNER_ADD", Math.floor(Date.now() / 1000)).run();

  await sendMessage(token, message.chat.id, `✅ ${amount} MP به ${escapeHtml(user.first_name)} اضافه شد!`);
}

export async function handleOwnerRemovePoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /removepoints @username 100");
    return;
  }

  const amount = safeParseAmount(parts[2]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "مقدار نامعتبر!");
    return;
  }

  const user = await findUserByUsername(db, normalizeUsername(parts[1]));
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET meow_points = MAX(0, meow_points - ?) WHERE telegram_id = ?`).bind(amount, user.telegram_id).run();
  await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
    .bind(user.telegram_id, -amount, "OWNER_REMOVE", Math.floor(Date.now() / 1000)).run();

  await sendMessage(token, message.chat.id, `✅ ${amount} MP از ${escapeHtml(user.first_name)} کم شد!`);
}

export async function handleOwnerResetUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /resetuser @username");
    return;
  }

  const user = await findUserByUsername(db, normalizeUsername(parts[1]));
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET meow_points = 0, total_meows = 0, daily_streak = 0, last_daily_at = NULL WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await db.prepare(`DELETE FROM group_members WHERE telegram_user_id = ?`).bind(user.telegram_id).run();
  await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ?`).bind(user.telegram_id).run();

  await sendMessage(token, message.chat.id, `🔄 کاربر ${escapeHtml(user.first_name)} کاملاً ریست شد!`);
}

export async function handleOwnerUserInfo(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /userinfo @username\nیا\n/userinfo 123456789");
    return;
  }

  const raw = parts[1];
  let userId: number | null = null;
  let user: any = null;

  if (/^\d+$/.test(raw)) {
    userId = parseInt(raw, 10);
    user = await findUserById(db, userId);
  } else {
    const found = await findUserByUsername(db, normalizeUsername(raw));
    if (found) {
      userId = found.telegram_id;
      user = await findUserById(db, userId);
    }
  }

  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  const rank = await getGlobalRank(db, user.telegram_id);
  const txns = await getUserTransactions(db, user.telegram_id, 5);
  const groups = await getUserGroupMemberships(db, user.telegram_id);
  const banned = await isUserBanned(db, user.telegram_id);

  const createdDate = new Date((user.created_at || 0) * 1000).toLocaleDateString("fa-IR");

  let text = `👤 <b>اطلاعات کاربر</b>\n\n`;
  text += `🆔 ID: <code>${user.telegram_id}</code>\n`;
  text += `👤 نام: ${escapeHtml(user.first_name)}\n`;
  text += `🔗 یوزرنیم: ${user.username ? "@" + user.username : "ندارد"}\n`;
  text += `💰 امتیاز: ${user.meow_points}\n`;
  text += `🐾 کل میوها: ${user.total_meows}\n`;
  text += `🏆 رتبه جهانی: #${rank}\n`;
  text += `🔥 استریک: ${user.daily_streak} روز\n`;
  text += `📅 عضویت: ${createdDate}\n`;
  text += `🚫 وضعیت: ${banned ? "❌ بن شده" : "✅ فعال"}\n\n`;

  if (txns.results.length) {
    text += `📝 آخرین تراکنش‌ها:\n`;
    for (const t of txns.results) {
      const sign = t.amount >= 0 ? "+" : "";
      text += `  ${sign}${t.amount} — ${t.reason} (${new Date(t.created_at * 1000).toLocaleDateString("fa-IR")})\n`;
    }
    text += `\n`;
  }

  if (groups.results.length) {
    text += `👥 عضو ${groups.results.length} گروه:\n`;
    for (const g of groups.results.slice(0, 5)) {
      text += `  • ${escapeHtml(g.title)} — ${g.meow_points} MP\n`;
    }
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: userActionKeyboard(user.telegram_id) });
}

export async function handleOwnerBanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /banuser @username");
    return;
  }

  const user = await findUserByUsername(db, normalizeUsername(parts[1]));
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET is_banned = 1 WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await sendMessage(token, message.chat.id, `🚫 کاربر ${escapeHtml(user.first_name)} بن شد!`);
}

export async function handleOwnerUnbanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /unbanuser @username");
    return;
  }

  const user = await findUserByUsername(db, normalizeUsername(parts[1]));
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET is_banned = 0 WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await sendMessage(token, message.chat.id, `✅ کاربر ${escapeHtml(user.first_name)} آنبن شد!`);
}

export async function handleOwnerRepair(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;

  const issues: string[] = [];

  const negativeUsers = await db.prepare(`SELECT telegram_id, first_name, meow_points FROM users WHERE meow_points < 0`).all<{ telegram_id: number; first_name: string; meow_points: number }>();
  if (negativeUsers.results.length) {
    for (const u of negativeUsers.results) {
      await db.prepare(`UPDATE users SET meow_points = 0 WHERE telegram_id = ?`).bind(u.telegram_id).run();
    }
    issues.push(`❌ ${negativeUsers.results.length} کاربر امتیاز منفی داشتن → 0 شد`);
  }

  const orphaned = await db.prepare(`
    SELECT gm.telegram_group_id FROM group_members gm
    LEFT JOIN telegram_groups g ON g.telegram_group_id = gm.telegram_group_id
    WHERE g.telegram_group_id IS NULL
  `).all<{ telegram_group_id: number }>();
  if (orphaned.results.length) {
    const groupIds = [...new Set(orphaned.results.map((r) => r.telegram_group_id))];
    for (const gid of groupIds) {
      await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(gid).run();
    }
    issues.push(`🗑️ ${groupIds.length} گروه یتیمانه پاک شدن`);
  }

  const mismatched = await db.prepare(`
    SELECT u.telegram_id, u.first_name, u.meow_points, COALESCE(SUM(t.amount), 0) as expected
    FROM users u
    LEFT JOIN transactions t ON u.telegram_id = t.telegram_user_id
    GROUP BY u.telegram_id
    HAVING u.meow_points != COALESCE(SUM(t.amount), 0)
  `).all<{ telegram_id: number; first_name: string; meow_points: number; expected: number }>();

  if (mismatched.results.length > 0) {
    issues.push(`⚠️ ${mismatched.results.length} کاربر تفاوت امتیاز/تراکنش دارن`);
  }

  if (issues.length === 0) {
    await sendMessage(token, message.chat.id, "✅ دیتابیس سالمه! هیچ مشکلی پیدا نشد.");
  } else {
    await sendMessage(token, message.chat.id, `🔍 <b>نتایج بررسی:</b>\n\n${issues.join("\n")}`);
  }
}

export async function handleOwnerConfig(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const parts = (message.text || "").split(" ");
  if (parts.length < 2) {
    const currentDaily = await getBotSetting(db, "daily_reward") ?? "500";
    const currentMega = await getBotSetting(db, "mega_chance") ?? "0.01";
    const currentBig = await getBotSetting(db, "big_chance") ?? "0.05";
    await sendMessage(token, message.chat.id, `⚙️ <b>تنظیمات فعلی:</b>\n\n💰 daily_reward: ${currentDaily}\n🌟 mega_chance: ${currentMega}\n🔥 big_chance: ${currentBig}\n\nاستفاده:\n<code>/config daily_reward 500</code>\n<code>/config mega_chance 0.01</code>`);
    return;
  }

  const key = parts[1];
  const value = parts[2];

  if (!value) {
    const current = await getBotSetting(db, key);
    await sendMessage(token, message.chat.id, `⚙️ ${key}: ${current ?? "تنظیم نشده"}`);
    return;
  }

  await setBotSetting(db, key, value);
  await sendMessage(token, message.chat.id, `✅ ${key} = ${value} تنظیم شد.`);
}

export async function handleGroups(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const perPage = 5;
  const offset = page * perPage;

  const groups = await db.prepare(`
    SELECT telegram_group_id, title, is_active,
      (SELECT COUNT(*) FROM group_members WHERE telegram_group_id = g.telegram_group_id) as member_count
    FROM telegram_groups g
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(perPage + 1, offset).all<{ telegram_group_id: number; title: string; is_active: number; member_count: number }>();

  if (!groups.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هیچ گروهی پیدا نشد!", { reply_markup: ownerPanelKeyboard() });
    return;
  }

  const hasMore = groups.results.length > perPage;
  const rows = hasMore ? groups.results.slice(0, perPage) : groups.results;

  let text = `📋 <b>گروه‌ها</b> (صفحه ${page + 1})\n\n`;
  for (const g of rows) {
    const status = g.is_active ? "✅" : "🚫";
    text += `${status} <b>${escapeHtml(g.title || "Group")}</b>\n`;
    text += `   👥 ${g.member_count} عضو | ID: <code>${g.telegram_group_id}</code>\n\n`;
  }

  const keyboard: any[] = [];
  for (const g of rows) {
    keyboard.push([
      { text: `📊 ${escapeHtml(g.title || "Group").slice(0, 15)}`, callback_data: `groupmgr:stats:${g.telegram_group_id}:${page}` },
      { text: g.is_active ? "🚫" : "✅", callback_data: `groupmgr:toggle:${g.telegram_group_id}:${page}` },
      { text: "🔄", callback_data: `groupmgr:reset:${g.telegram_group_id}:${page}` },
    ]);
  }
  keyboard.push([
    { text: "⬅️ قبلی", callback_data: `groupmgr:page:${Math.max(0, page - 1)}` },
    { text: "➡️ بعدی", callback_data: `groupmgr:page:${hasMore ? page + 1 : page}` },
  ]);
  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: "menu:admin" }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

export async function handleDuels(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const now = Math.floor(Date.now() / 1000);

  const duels = await db.prepare(`
    SELECT duel_id, challenger_name, target_name, amount, group_id, created_at
    FROM active_duels
    WHERE status = 'pending' AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(now - 60).all<{
    duel_id: string; challenger_name: string; target_name: string;
    amount: number; group_id: number; created_at: number;
  }>();

  if (!duels.results.length) {
    await sendMessage(token, message.chat.id, "✅ هیچ دعوای فعالی نیست!", { reply_markup: ownerPanelKeyboard() });
    return;
  }

  let text = `⚔️ <b>دعواهای فعال</b> (${duels.results.length})\n\n`;
  const keyboard: any[] = [];

  for (const d of duels.results) {
    const remaining = Math.max(0, 60 - (now - d.created_at));
    text += `🐱 ${escapeHtml(d.challenger_name)} 🆚 ${escapeHtml(d.target_name)}\n`;
    text += `   💰 ${d.amount} MP | ⏱️ ${remaining}s | Group: ${d.group_id}\n\n`;
    keyboard.push([{ text: `❌ لغو: ${escapeHtml(d.challenger_name).slice(0, 10)} vs ${escapeHtml(d.target_name).slice(0, 10)}`, callback_data: `duelmon:cancel:${d.duel_id}` }]);
  }

  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: "menu:admin" }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

export async function handleAudit(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0) {
  if (!message.from || env.BOT_OWNER_ID !== String(message.from.id)) return;
  const perPage = 10;
  const offset = page * perPage;

  const txns = await db.prepare(`
    SELECT t.amount, t.reason, t.created_at, u.first_name, u.telegram_id
    FROM transactions t
    JOIN users u ON u.telegram_id = t.telegram_user_id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(perPage + 1, offset).all<{
    amount: number; reason: string; created_at: number;
    first_name: string; telegram_id: number;
  }>();

  if (!txns.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هیچ تراکنشی ثبت نشده!", { reply_markup: ownerPanelKeyboard() });
    return;
  }

  const hasMore = txns.results.length > perPage;
  const rows = hasMore ? txns.results.slice(0, perPage) : txns.results;

  let text = `📝 <b>آخرین تراکنش‌ها</b> (صفحه ${page + 1})\n\n`;
  for (const t of rows) {
    const sign = t.amount >= 0 ? "+" : "";
    const time = new Date(t.created_at * 1000).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
    text += `${sign}${t.amount} <code>${t.reason}</code> — ${escapeHtml(t.first_name)} (${time})\n`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: txnAuditKeyboard(hasMore ? page : page - 1) });
}

export async function handleMyChatMember(token: string, db: D1Database, update: TelegramChatMemberUpdated) {
  const { chat, new_chat_member } = update;

  if (new_chat_member.status === "member") {
    if (chat.type === "group" || chat.type === "supergroup") {
      await ensureGroup(db, chat);
      await sendMessage(
        token,
        chat.id,
        `🐱 <b>سلام گروه!</b>\n\nمن Meow Points Bot هستم! 🎉\n\n` +
          `هر وقت کسی توی این گروه بنویسه:\n` +
          `🐱 <b>meow</b>\n` +
          `🐱 <b>میو</b>\n` +
          `🐱 <b>میووو</b>\n\n` +
          `ممکنه Meow Points بگیره! ✨\n\n` +
          `📌 <b>دستورات:</b>\n` +
          `/me — پروفایل من\n` +
          `/top — رتبه‌بندی گروه\n` +
          `/global — رتبه‌بندی جهانی\n` +
          `/daily — جایزه روزانه\n` +
          `/pay — انتقال امتیاز\n` +
          `/settings — تنظیمات گروه (ادمین)\n\n` +
          `⏱️ کول‌داون: <b>5 دقیقه</b>\n` +
          `😸 بفرستید و امتیاز بگیرید!`
      );
    }
  }

  if (new_chat_member.status === "left" || new_chat_member.status === "kicked") {
    if (chat.type === "group" || chat.type === "supergroup") {
      await deactivateGroup(db, chat.id);
    }
  }
}
