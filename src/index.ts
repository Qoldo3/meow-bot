import { Hono } from "hono";

/* =========================================================
   TYPES & ENVIRONMENT
========================================================= */

type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_OWNER_ID: string;
  WEBHOOK_SECRET: string;
};

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: {
    from?: TelegramUser;
    text?: string;
  };
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: {
    message_id: number;
    chat: TelegramChat;
  };
  data?: string;
};

type TelegramChatMemberUpdated = {
  chat: TelegramChat;
  from: TelegramUser;
  new_chat_member: {
    status: string;
    user: TelegramUser;
  };
  old_chat_member: {
    status: string;
    user: TelegramUser;
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
};

type DuelState = {
  id: string;
  challengerId: number;
  challengerName: string;
  targetId: number;
  targetName: string;
  amount: number;
  groupId: number;
  messageId: number;
  createdAt: number;
};

const activeDuels = new Map<string, DuelState>();
const duelTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const app = new Hono<{ Bindings: Bindings }>();

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegramRequest(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!json.ok) {
    console.error(`[TG ${method}] failed:`, JSON.stringify(json).slice(0, 500));
  }
  return json;
}

function sendMessage(
  token: string,
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function answerCallback(
  token: string,
  callbackId: string,
  text?: string,
  showAlert?: boolean
) {
  await telegramRequest(token, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
    show_alert: showAlert,
  });
}

async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any
) {
  await telegramRequest(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

async function deleteMessage(token: string, chatId: number, messageId: number) {
  await telegramRequest(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

async function isGroupAdmin(
  token: string,
  chatId: number,
  userId: number
): Promise<boolean> {
  const res = await telegramRequest(token, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
  if (!res.ok) return false;
  const status = res.result?.status;
  return status === "administrator" || status === "creator";
}

/* =========================================================
   INLINE KEYBOARDS
========================================================= */

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👤 پروفایل من", callback_data: "cmd:me" },
        { text: "🎁 جایزه روزانه", callback_data: "cmd:daily" },
      ],
      [
        { text: "🏆 رتبه گروه", callback_data: "cmd:top" },
        { text: "🌍 رتبه جهانی", callback_data: "cmd:global" },
      ],
      [{ text: "⚙️ تنظیمات گروه", callback_data: "menu:group_settings" }],
    ],
  };
}

function postMeowKeyboard(groupId: number) {
  return {
    inline_keyboard: [
      [
        { text: "🏆 رتبه‌بندی گروه", callback_data: `cmd:top:${groupId}` },
        { text: "⚙️ مدیریت", callback_data: `menu:group_settings` },
      ],
    ],
  };
}

function ownerPanelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 آمار ربات", callback_data: "admin:stats" },
        { text: "📢 پیام همگانی", callback_data: "admin:broadcast" },
      ],
      [
        { text: "➕ افزودن امتیاز", callback_data: "admin:addpoints" },
        { text: "➖ کسر امتیاز", callback_data: "admin:removepoints" },
      ],
      [
        { text: "🔄 ریست کاربر", callback_data: "admin:resetuser" },
        { text: "🔧 تعمیرات", callback_data: "admin:maintenance" },
      ],
      [
        { text: "👤 اطلاعات کاربر", callback_data: "admin:userinfo" },
        { text: "🚫 بن/آنبن", callback_data: "admin:banmenu" },
      ],
      [
        { text: "🔍 بررسی دیتابیس", callback_data: "admin:repair" },
        { text: "⚙️ تنظیمات", callback_data: "admin:config" },
      ],
      [{ text: "🔙 بستن پنل", callback_data: "menu:close" }],
    ],
  };
}

function groupSettingsKeyboard(enabled: boolean, cooldown: number) {
  return {
    inline_keyboard: [
      [
        {
          text: `🤖 ربات: ${enabled ? "✅ روشن" : "❌ خاموش"}`,
          callback_data: "group:toggle_bot",
        },
      ],
      [{ text: `⏱️ کول‌داون: ${cooldown}s`, callback_data: "group:set_cooldown" }],
      [{ text: "🔄 ریست لیدربورد", callback_data: "group:reset_lb" }],
      [{ text: "🔙 بازگشت", callback_data: "menu:main" }],
    ],
  };
}

function duelKeyboard(duelId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ قبول می‌کنم", callback_data: `duel:accept:${duelId}` },
        { text: "❌ نه، مرسی", callback_data: `duel:decline:${duelId}` },
      ],
    ],
  };
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function ensureUser(db: D1Database, user: TelegramUser) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO users (telegram_id, username, first_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `)
    .bind(user.id, user.username ?? null, user.first_name, now)
    .run();
}

async function ensureGroup(db: D1Database, chat: TelegramChat) {
  if (chat.type !== "group" && chat.type !== "supergroup") return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO telegram_groups (telegram_group_id, title, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(telegram_group_id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        is_active = 1
    `)
    .bind(chat.id, chat.title ?? "Unknown Group", now, now)
    .run();
}

async function deactivateGroup(db: D1Database, groupId: number) {
  await db
    .prepare(`UPDATE telegram_groups SET is_active = 0, updated_at = ? WHERE telegram_group_id = ?`)
    .bind(Math.floor(Date.now() / 1000), groupId)
    .run();
}

async function getGroupSettings(db: D1Database, groupId: number) {
  const row = await db
    .prepare(`SELECT bot_enabled, cooldown_seconds FROM telegram_groups WHERE telegram_group_id = ?`)
    .bind(groupId)
    .first<{ bot_enabled: number; cooldown_seconds: number }>();
  return {
    enabled: row ? row.bot_enabled === 1 : true,
    cooldown: row ? row.cooldown_seconds : 300,
  };
}

async function getUserStats(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT meow_points, total_meows FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ meow_points: number; total_meows: number }>();
}

async function getGlobalRank(db: D1Database, userId: number): Promise<number> {
  const result = await db
    .prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users
      WHERE meow_points > (SELECT meow_points FROM users WHERE telegram_id = ?)
    `)
    .bind(userId)
    .first<{ rank: number }>();
  return result?.rank ?? 0;
}

async function isMaintenanceMode(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
  return row?.value === "1";
}

async function findUserByUsername(db: D1Database, rawUsername: string) {
  return db
    .prepare(`SELECT telegram_id, first_name FROM users WHERE LOWER(username) = LOWER(?)`)
    .bind(rawUsername)
    .first<{ telegram_id: number; first_name: string }>();
}

async function findUserById(db: D1Database, userId: number) {
  return db
    .prepare(`SELECT telegram_id, username, first_name, meow_points, total_meows, daily_streak, last_daily_at, created_at FROM users WHERE telegram_id = ?`)
    .bind(userId)
    .first<{ telegram_id: number; username: string | null; first_name: string; meow_points: number; total_meows: number; daily_streak: number; last_daily_at: number | null; created_at: number }>();
}

async function isUserBanned(db: D1Database, userId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT is_banned FROM users WHERE telegram_id = ?`).bind(userId).first<{ is_banned: number }>();
  return row ? row.is_banned === 1 : false;
}

async function getBotSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM bot_settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setBotSetting(db: D1Database, key: string, value: string) {
  await db.prepare(`INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

async function adjustGroupPoints(
  db: D1Database,
  groupId: number,
  user: { id: number; username?: string; first_name: string },
  delta: number
) {
  await db
    .prepare(`
      INSERT INTO group_members (
        telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        meow_points = MAX(0, group_members.meow_points + ?)
    `)
    .bind(groupId, user.id, user.username ?? null, user.first_name, delta, delta)
    .run();
}

async function getUserTransactions(db: D1Database, userId: number, limit: number = 20) {
  return db
    .prepare(`
      SELECT amount, reason, group_id, created_at
      FROM transactions
      WHERE telegram_user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all<{ amount: number; reason: string; group_id: number | null; created_at: number }>();
}

async function getUserGroupMemberships(db: D1Database, userId: number) {
  return db
    .prepare(`
      SELECT g.title, gm.meow_points, gm.total_meows
      FROM group_members gm
      JOIN telegram_groups g ON g.telegram_group_id = gm.telegram_group_id
      WHERE gm.telegram_user_id = ? AND g.is_active = 1
      ORDER BY gm.meow_points DESC
    `)
    .bind(userId)
    .all<{ title: string; meow_points: number; total_meows: number }>();
}

/* =========================================================
   ADMIN CHECKS
========================================================= */

function isOwner(env: Bindings, userId: number): boolean {
  return env.BOT_OWNER_ID === String(userId);
}

/* =========================================================
   MEOW DETECTION
========================================================= */

function isMeow(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  if (normalized.startsWith("دعوا")) return false;

  if (/^(meo+w+\s*)+$/.test(normalized)) return true;

  if (/^(می+و+\s*)+$/.test(normalized)) return true;

  return false;
}

/* =========================================================
   RANDOM POINTS
========================================================= */

function randomMeowPoints(): number {
  const roll = Math.random();
  if (roll < 0.01) return 1000;
  if (roll < 0.05) return Math.floor(Math.random() * 400) + 100;
  return Math.floor(Math.random() * 50) + 1;
}

/* =========================================================
   AWARD MEOW (with per-group cooldown)
========================================================= */

async function awardMeow(
  db: D1Database,
  user: TelegramUser,
  chat: TelegramChat
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  await ensureUser(db, user);

  let cooldownSeconds = 300;
  if (isGroup) {
    cooldownSeconds = (await getGroupSettings(db, chat.id)).cooldown;

    const existing = await db
      .prepare(`SELECT last_meow_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(chat.id, user.id)
      .first<{ last_meow_at: number | null }>();

    if (existing?.last_meow_at && now - existing.last_meow_at < cooldownSeconds) {
      return -(cooldownSeconds - (now - existing.last_meow_at));
    }
  }

  const points = randomMeowPoints();

  await db
    .prepare(`
      UPDATE users SET
        meow_points = meow_points + ?,
        total_meows = total_meows + 1
      WHERE telegram_id = ?
    `)
    .bind(points, user.id)
    .run();

  await db
    .prepare(`
      INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(user.id, isGroup ? chat.id : null, points, "MEOW", now)
    .run();

  if (isGroup) {
    await ensureGroup(db, chat);
    await db
      .prepare(`
        INSERT INTO group_members (
          telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          meow_points = group_members.meow_points + ?,
          total_meows = group_members.total_meows + 1,
          last_meow_at = excluded.last_meow_at
      `)
      .bind(chat.id, user.id, user.username ?? null, user.first_name, points, now, points)
      .run();
  }

  return points;
}

/* =========================================================
   COMMAND HANDLERS
========================================================= */

async function handleStart(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const isPm = message.chat.type === "private";
  const text = isPm
    ? `🐱 سلام <b>${escapeHtml(message.from.first_name)}</b>!

به دنیای Meow Points خوش اومدی! 🎉

هر وقت توی گروه بنویسی <b>میو</b> یا <b>meow</b>، ممکنه امتیاز بگیری! ✨

از منوی زیر استفاده کن:`
    : `🐱 سلام گروه!

منوهای من با دکمه‌های شیشه‌ای کار می‌کنن. برای دیدن منو، روی دکمه‌ها کلیک کنید یا دستورات رو بفرستید.`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard() });
}

async function handleMe(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const stats = await getUserStats(db, message.from.id);
  const rank = await getGlobalRank(db, message.from.id);

  const text =
    `🐱 پروفایل <b>${escapeHtml(message.from.first_name)}</b>

` +
    `💰 Meow Points: <b>${stats?.meow_points ?? 0}</b>
` +
    `🐾 Total Meows: <b>${stats?.total_meows ?? 0}</b>
` +
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

async function handleTop(token: string, db: D1Database, message: TelegramMessage) {
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

  await sendMessage(token, message.chat.id, `🏆 <b>Meow Leaderboard</b>

${formatLeaderboard(results.results)}`);
}

async function handleGlobal(token: string, db: D1Database, message: TelegramMessage) {
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

  await sendMessage(token, message.chat.id, `🌍 <b>Global Meow Leaderboard</b>

${formatLeaderboard(results.results)}`);
}

async function handleDaily(token: string, db: D1Database, message: TelegramMessage) {
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
    await sendMessage(token, message.chat.id, `🎁 جایزه امروزت رو قبلاً گرفتی!

⏰ حدود ${hours} ساعت دیگه دوباره امتحان کن.`);
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

  await sendMessage(token, message.chat.id, `🎁 <b>جایزه روزانه!</b>

💰 +${reward} Meow Points
🔥 Streak: ${streak} روز`);
}

async function handlePay(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 انتقال امتیاز فقط داخل گروه انجام می‌شه!");
    return;
  }

  const text = message.text || "";
  const parts = text.split(/\s+/);
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده:\n/pay @username 100", { reply_to_message_id: message.message_id });
    return;
  }

  const targetUsername = normalizeUsername(parts[1]);
  const amount = parseInt(toEnglishNumbers(parts[2]), 10);

  if (!Number.isFinite(amount) || amount <= 0) {
    await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
    return;
  }

  const sender = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number }>();

  if (!sender || sender.meow_points < amount) {
    await sendMessage(token, message.chat.id, "🐱 امتیاز کافی نداری!", { reply_to_message_id: message.message_id });
    return;
  }

  const receiver = await findUserByUsername(db, targetUsername);

  if (!receiver) {
    await sendMessage(token, message.chat.id, "🐱 کاربری با این یوزرنیم پیدا نشد!", { reply_to_message_id: message.message_id });
    return;
  }

  if (receiver.telegram_id === message.from.id) {
    await sendMessage(token, message.chat.id, "🐱 نمی‌تونی به خودت انتقال بدی!", { reply_to_message_id: message.message_id });
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  await db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ?`).bind(amount, message.from.id).run();
  await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, receiver.telegram_id).run();

  await adjustGroupPoints(db, message.chat.id, { id: message.from.id, first_name: message.from.first_name, username: message.from.username }, -amount);
  await adjustGroupPoints(db, message.chat.id, { id: receiver.telegram_id, first_name: receiver.first_name }, amount);

  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(message.from.id, message.chat.id, -amount, `PAY_TO_${receiver.telegram_id}`, now).run();
  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(receiver.telegram_id, message.chat.id, amount, `PAY_FROM_${message.from.id}`, now).run();

  await sendMessage(
    token,
    message.chat.id,
    `💸 <b>انتقال موفق!</b>

🐱 ${escapeHtml(message.from.first_name)}
➡️ ${amount} MP
🐱 ${escapeHtml(receiver.first_name)}`
  );
}

/* =========================================================
   DUEL SYSTEM
========================================================= */

const DUEL_TIMEOUT_MS = 60_000;

function generateDuelId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function clearDuel(duelId: string) {
  activeDuels.delete(duelId);
  const timeout = duelTimeouts.get(duelId);
  if (timeout) {
    clearTimeout(timeout);
    duelTimeouts.delete(duelId);
  }
}

function findOpenDuelAgainst(groupId: number, targetId: number): string | undefined {
  for (const [id, duel] of activeDuels) {
    if (duel.groupId === groupId && duel.targetId === targetId) return id;
  }
  return undefined;
}

async function handleDuelRequest(token: string, db: D1Database, message: TelegramMessage) {
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
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await sendMessage(
      token,
      message.chat.id,
      `🐱 نحوه استفاده:
ریپلای کن و بنویس <code>دعوا 500</code>`,
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const amount = parseInt(toEnglishNumbers(parts[1]), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
    return;
  }

  await ensureUser(db, message.from);
  const challenger = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number }>();

  if (!challenger || challenger.meow_points < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی نداری!
💰 موجودی: ${challenger?.meow_points ?? 0} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureUser(db, target);
  const targetUser = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(target.id)
    .first<{ meow_points: number }>();

  if (!targetUser || targetUser.meow_points < amount) {
    await sendMessage(token, message.chat.id, `🐱 ${escapeHtml(target.first_name)} امتیاز کافی نداره!`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const existingId = findOpenDuelAgainst(message.chat.id, target.id);
  if (existingId) clearDuel(existingId);

  const duelId = generateDuelId();
  const duel: DuelState = {
    id: duelId,
    challengerId: message.from.id,
    challengerName: message.from.first_name,
    targetId: target.id,
    targetName: target.first_name,
    amount,
    groupId: message.chat.id,
    messageId: 0,
    createdAt: Date.now(),
  };

  const res = await telegramRequest(token, "sendMessage", {
    chat_id: message.chat.id,
    text:
      `⚔️ <b>دعوای Meow!</b>

` +
      `🐱 ${escapeHtml(message.from.first_name)}
` +
      `🆚
` +
      `🐱 ${escapeHtml(target.first_name)}

` +
      `💰 شرط: <b>${amount} MP</b>
` +
      `🏆 برنده: <b>${amount * 2} MP</b>

` +
      `⏱️ 60 ثانیه فرصت داری قبول کنی!`,
    parse_mode: "HTML",
    reply_markup: duelKeyboard(duelId),
  });

  if (!res.ok || !res.result?.message_id) return;

  duel.messageId = res.result.message_id;
  activeDuels.set(duelId, duel);

  const timeout = setTimeout(async () => {
    if (!activeDuels.has(duelId)) return;
    clearDuel(duelId);
    await telegramRequest(token, "editMessageText", {
      chat_id: duel.groupId,
      message_id: duel.messageId,
      text:
        `⏱️ <b>دعوا منقضی شد!</b>

` +
        `🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}
` +
        `💰 ${duel.amount} MP

` +
        `❌ ${escapeHtml(duel.targetName)} جواب نداد.`,
      parse_mode: "HTML",
    });
  }, DUEL_TIMEOUT_MS);

  duelTimeouts.set(duelId, timeout);
}

async function handleDuelAccept(
  token: string,
  db: D1Database,
  callback: TelegramCallbackQuery,
  duelId: string
) {
  if (!callback.message) return;

  const duel = activeDuels.get(duelId);

  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 فقط حریف می‌تونه قبول کنه!", true);
    return;
  }

  clearDuel(duelId);

  const challenger = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(duel.challengerId)
    .first<{ meow_points: number }>();

  const target = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(duel.targetId)
    .first<{ meow_points: number }>();

  if (!challenger || challenger.meow_points < duel.amount || !target || target.meow_points < duel.amount) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>

یکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const challengerRoll = Math.floor(Math.random() * 100) + 1;
  const targetRoll = Math.floor(Math.random() * 100) + 1;

  if (challengerRoll === targetRoll) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `🎲 <b>دعوای Meow!</b>

` +
        `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}
` +
        `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}

` +
        `🤝 <b>مساوی!</b>
هیچ‌کس امتیازی نمی‌بره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const winnerId = challengerRoll > targetRoll ? duel.challengerId : duel.targetId;
  const winnerName = challengerRoll > targetRoll ? duel.challengerName : duel.targetName;

  const now = Math.floor(Date.now() / 1000);
  const pot = duel.amount * 2;

  await db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ?`).bind(duel.amount, duel.challengerId).run();
  await db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ?`).bind(duel.amount, duel.targetId).run();
  await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(pot, winnerId).run();

  await adjustGroupPoints(db, duel.groupId, { id: duel.challengerId, first_name: duel.challengerName }, -duel.amount);
  await adjustGroupPoints(db, duel.groupId, { id: duel.targetId, first_name: duel.targetName }, -duel.amount);
  await adjustGroupPoints(db, duel.groupId, { id: winnerId, first_name: winnerName }, pot);

  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(duel.challengerId, duel.groupId, -duel.amount, `DUEL_BET`, now).run();
  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(duel.targetId, duel.groupId, -duel.amount, `DUEL_BET`, now).run();
  await db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`).bind(winnerId, duel.groupId, pot, `DUEL_WIN`, now).run();

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `🎲 <b>دعوای Meow!</b>

` +
      `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}
` +
      `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}

` +
      `🏆 <b>${escapeHtml(winnerName)} برنده شد!</b>
` +
      `💰 +${pot} MP`
  );

  await answerCallback(token, callback.id, "🎲 دعوا انجام شد!");
}

async function handleDuelDecline(token: string, callback: TelegramCallbackQuery, duelId: string) {
  if (!callback.message) return;

  const duel = activeDuels.get(duelId);

  if (!duel || duel.messageId !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این دعوا منقضی شده!", true);
    return;
  }

  if (duel.targetId !== callback.from.id && duel.challengerId !== callback.from.id) {
    await answerCallback(token, callback.id, "🐱 این دعوا مال تو نیست!", true);
    return;
  }

  clearDuel(duelId);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `❌ <b>دعوا لغو شد!</b>

` +
      `🐱 ${escapeHtml(duel.challengerName)} 🆚 ${escapeHtml(duel.targetName)}
` +
      `💰 ${duel.amount} MP`
  );

  await answerCallback(token, callback.id, "✅ دعوا لغو شد.");
}

/* =========================================================
   OWNER ADMIN PANEL (/admin)
========================================================= */

async function handleAdmin(token: string, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 دسترسی غیرمجاز!");
    return;
  }

  const stats = await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{ count: number }>();
  const groups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups WHERE is_active = 1`).first<{ count: number }>();
  const totalGroups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups`).first<{ count: number }>();

  const text =
    `🛡️ <b>Owner Panel</b>

` +
    `👤 کاربران: <b>${stats?.count ?? 0}</b>
` +
    `👥 گروه‌های فعال: <b>${groups?.count ?? 0}</b>
` +
    `👥 کل گروه‌ها: <b>${totalGroups?.count ?? 0}</b>

` +
    `از دکمه‌ها استفاده کن:`;

  await sendMessage(token, message.chat.id, text, { reply_markup: ownerPanelKeyboard() });
}

/* =========================================================
   GROUP SETTINGS (/settings)
========================================================= */

async function handleGroupSettings(token: string, db: D1Database, message: TelegramMessage) {
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
    `⚙️ <b>تنظیمات گروه</b>

` +
    `🤖 وضعیت ربات: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}
` +
    `⏱️ کول‌داون: ${settings.cooldown} ثانیه`;

  await sendMessage(token, message.chat.id, text, { reply_markup: groupSettingsKeyboard(settings.enabled, settings.cooldown) });
}

/* =========================================================
   CALLBACK QUERY HANDLER
========================================================= */

async function handleCallbackQuery(
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

  if (data.startsWith("admin:") && !isOwner(env, userId)) {
    await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
    return;
  }

  if (data.startsWith("group:")) {
    const isAdmin = await isGroupAdmin(token, chatId, userId);
    if (!isAdmin) {
      await answerCallback(token, callback.id, "🚫 فقط ادمین گروه!", true);
      return;
    }
  }

  const [action, ...params] = data.split(":");

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
          await answerCallback(token, callback.id, "این منو فقط داخل گروه کار می‌کنه!", true);
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
          `⚙️ <b>تنظیمات گروه</b>

🤖 وضعیت: ${settings.enabled ? "✅ روشن" : "❌ خاموش"}
⏱️ کول‌داون: ${settings.cooldown}s`,
          groupSettingsKeyboard(settings.enabled, settings.cooldown)
        );
      } else if (params[0] === "close") {
        await deleteMessage(token, chatId, messageId);
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
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>

🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}
⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown));
      } else if (params[0] === "set_cooldown") {
        const options = [5, 10, 30, 60, 300];
        const currentIndex = options.indexOf(settings.cooldown);
        const nextCooldown = options[(currentIndex + 1) % options.length];
        await db.prepare(`UPDATE telegram_groups SET cooldown_seconds = ? WHERE telegram_group_id = ?`).bind(nextCooldown, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>

🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}
⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown));
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
        await handleDuelDecline(token, callback, params[1]);
      }
      return;
    }

    if (action === "admin") {
      if (params[0] === "stats") {
        const users = await db.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
        const groups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE is_active = 1`).first<{ c: number }>();
        const totalGroups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups`).first<{ c: number }>();
        const meows = await db.prepare(`SELECT SUM(total_meows) as c FROM users`).first<{ c: number }>();
        const text = `📊 <b>آمار ربات</b>

👤 کاربران: ${users?.c ?? 0}
👥 گروه‌های فعال: ${groups?.c ?? 0}
👥 کل گروه‌ها: ${totalGroups?.c ?? 0}
🐾 کل میوها: ${meows?.c ?? 0}`;
        await editMessageText(token, chatId, messageId, text, ownerPanelKeyboard());
      } else if (params[0] === "maintenance") {
        const current = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
        const newMode = current?.value === "1" ? "0" : "1";
        await db.prepare(`INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(newMode).run();
        const status = newMode === "1" ? "🔴 روشن" : "🟢 خاموش";
        await editMessageText(token, chatId, messageId, `🔧 <b>حالت تعمیرات: ${status}</b>

ربات ${newMode === "1" ? "فقط برای ادمین‌ها کار می‌کنه" : "برای همه فعاله"}`, ownerPanelKeyboard());
      } else if (params[0] === "broadcast") {
        await editMessageText(token, chatId, messageId, `📢 <b>پیام همگانی</b>

برای ارسال پیام به همه کاربران، از دستور زیر استفاده کن:

<code>/broadcast پیام شما</code>`, ownerPanelKeyboard());
      } else if (params[0] === "addpoints" || params[0] === "removepoints") {
        await editMessageText(token, chatId, messageId, `💰 <b>${params[0] === "addpoints" ? "افزودن" : "کسر"} امتیاز</b>

استفاده:
<code>/${params[0]} @username 100</code>`, ownerPanelKeyboard());
      } else if (params[0] === "resetuser") {
        await editMessageText(token, chatId, messageId, `🔄 <b>ریست کاربر</b>

استفاده:
<code>/resetuser @username</code>`, ownerPanelKeyboard());
      } else if (params[0] === "userinfo") {
        await editMessageText(token, chatId, messageId, `👤 <b>اطلاعات کاربر</b>

استفاده:
<code>/userinfo @username</code>
یا
<code>/userinfo 123456789</code>`, ownerPanelKeyboard());
      } else if (params[0] === "banmenu") {
        await editMessageText(token, chatId, messageId, `🚫 <b>بن/آنبن کاربر</b>

استفاده:
<code>/banuser @username</code>
<code>/unbanuser @username</code>`, ownerPanelKeyboard());
      } else if (params[0] === "repair") {
        await editMessageText(token, chatId, messageId, `🔍 <b>بررسی دیتابیس</b>

استفاده:
<code>/repair</code>`, ownerPanelKeyboard());
      } else if (params[0] === "config") {
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات ربات</b>

استفاده:
<code>/config daily_reward 500</code>
<code>/config mega_chance 0.01</code>
<code>/config big_chance 0.05</code>`, ownerPanelKeyboard());
      }
      await answerCallback(token, callback.id);
      return;
    }

    await answerCallback(token, callback.id);
  } catch (err) {
    console.error("Callback error:", err);
    await answerCallback(token, callback.id, "❌ خطا رخ داد!", true);
  }
}

/* =========================================================
   OWNER COMMANDS (text-based for precision)
========================================================= */

async function handleOwnerBroadcast(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const text = (message.text || "").replace(/^\/broadcast\s*/, "");
  if (!text) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده: /broadcast پیام");
    return;
  }

  const users = await db.prepare(`SELECT telegram_id FROM users`).all<{ telegram_id: number }>();
  let sent = 0;
  let failed = 0;

  for (const u of users.results || []) {
    const res = await telegramRequest(token, "sendMessage", {
      chat_id: u.telegram_id,
      text: `📢 <b>پیام از طرف ادمین</b>

${escapeHtml(text)}`,
      parse_mode: "HTML",
    });
    if (res.ok) sent++;
    else failed++;
    // Rate limiting: max 25 messages/second (Telegram ~30 limit)
    if (sent % 25 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await sendMessage(token, message.chat.id, `📢 ارسال شد!

✅ موفق: ${sent}
❌ ناموفق: ${failed}`);
}

async function handleOwnerAddPoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /addpoints @username 100");
    return;
  }

  const amount = parseInt(toEnglishNumbers(parts[2]), 10);
  if (!Number.isFinite(amount)) return;

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

async function handleOwnerRemovePoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /removepoints @username 100");
    return;
  }

  const amount = parseInt(toEnglishNumbers(parts[2]), 10);
  if (!Number.isFinite(amount)) return;

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

async function handleOwnerResetUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
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

/* =========================================================
   NEW OWNER COMMANDS: userinfo, ban, unban, repair, config
========================================================= */

async function handleOwnerUserInfo(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
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

  let text = `👤 <b>اطلاعات کاربر</b>

`;
  text += `🆔 ID: <code>${user.telegram_id}</code>
`;
  text += `👤 نام: ${escapeHtml(user.first_name)}
`;
  text += `🔗 یوزرنیم: ${user.username ? "@" + user.username : "ندارد"}
`;
  text += `💰 امتیاز: ${user.meow_points}
`;
  text += `🐾 کل میوها: ${user.total_meows}
`;
  text += `🏆 رتبه جهانی: #${rank}
`;
  text += `🔥 استریک: ${user.daily_streak} روز
`;
  text += `📅 عضویت: ${createdDate}
`;
  text += `🚫 وضعیت: ${banned ? "❌ بن شده" : "✅ فعال"}

`;

  if (txns.results.length) {
    text += `📝 آخرین تراکنش‌ها:
`;
    for (const t of txns.results) {
      const sign = t.amount >= 0 ? "+" : "";
      text += `  ${sign}${t.amount} — ${t.reason} (${new Date(t.created_at * 1000).toLocaleDateString("fa-IR")})
`;
    }
    text += `
`;
  }

  if (groups.results.length) {
    text += `👥 عضو ${groups.results.length} گروه:
`;
    for (const g of groups.results.slice(0, 5)) {
      text += `  • ${escapeHtml(g.title)} — ${g.meow_points} MP
`;
    }
  }

  await sendMessage(token, message.chat.id, text);
}

async function handleOwnerBanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
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

async function handleOwnerUnbanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
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

async function handleOwnerRepair(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;

  const issues: string[] = [];

  // Check for negative points
  const negativeUsers = await db.prepare(`SELECT telegram_id, first_name, meow_points FROM users WHERE meow_points < 0`).all<{ telegram_id: number; first_name: string; meow_points: number }>();
  if (negativeUsers.results.length) {
    for (const u of negativeUsers.results) {
      await db.prepare(`UPDATE users SET meow_points = 0 WHERE telegram_id = ?`).bind(u.telegram_id).run();
    }
    issues.push(`❌ ${negativeUsers.results.length} کاربر امتیاز منفی داشتن → 0 شد`);
  }

  // Check for orphaned group_members (groups that don't exist in telegram_groups)
  const orphaned = await db.prepare(`
    SELECT gm.telegram_group_id FROM group_members gm
    LEFT JOIN telegram_groups g ON g.telegram_group_id = gm.telegram_group_id
    WHERE g.telegram_group_id IS NULL
  `).all<{ telegram_group_id: number }>();
  if (orphaned.results.length) {
    const groupIds = [...new Set(orphaned.results.map(r => r.telegram_group_id))];
    for (const gid of groupIds) {
      await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(gid).run();
    }
    issues.push(`🗑️ ${groupIds.length} گروه یتیمانه پاک شدن`);
  }

  // Check for users with mismatched totals (sum(transactions) vs meow_points)
  const allUsers = await db.prepare(`SELECT telegram_id, meow_points FROM users`).all<{ telegram_id: number; meow_points: number }>();
  let mismatched = 0;
  for (const u of allUsers.results || []) {
    const sumResult = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE telegram_user_id = ?`).bind(u.telegram_id).first<{ total: number }>();
    const expected = sumResult?.total ?? 0;
    if (expected !== u.meow_points) {
      mismatched++;
    }
  }
  if (mismatched > 0) {
    issues.push(`⚠️ ${mismatched} کاربر تفاوت امتیاز/تراکنش دارن`);
  }

  if (issues.length === 0) {
    await sendMessage(token, message.chat.id, "✅ دیتابیس سالمه! هیچ مشکلی پیدا نشد.");
  } else {
    await sendMessage(token, message.chat.id, `🔍 <b>نتایج بررسی:</b>

${issues.join("\n")}`);
  }
}

async function handleOwnerConfig(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from || !isOwner(env, message.from.id)) return;
  const parts = (message.text || "").split(/\s+/);
  if (parts.length < 2) {
    const currentDaily = await getBotSetting(db, "daily_reward") ?? "500";
    const currentMega = await getBotSetting(db, "mega_chance") ?? "0.01";
    const currentBig = await getBotSetting(db, "big_chance") ?? "0.05";
    await sendMessage(token, message.chat.id, `⚙️ <b>تنظیمات فعلی:</b>

💰 daily_reward: ${currentDaily}
🌟 mega_chance: ${currentMega}
🔥 big_chance: ${currentBig}

استفاده:
<code>/config daily_reward 500</code>
<code>/config mega_chance 0.01</code>`);
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

/* =========================================================
   HTML ESCAPE & USERNAME NORMALIZATION & NUMBER CONVERSION
========================================================= */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").toLowerCase();
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let text = "";
  if (minutes > 0) text += `${minutes} دقیقه `;
  if (seconds > 0) text += `${seconds} ثانیه`;
  return text.trim();
}

function toEnglishNumbers(str: string): string {
  const persian = /[۰-۹]/g;
  const arabic = /[٠-٩]/g;

  return str
    .replace(persian, (w) => String.fromCharCode(w.charCodeAt(0) - 1728))
    .replace(arabic, (w) => String.fromCharCode(w.charCodeAt(0) - 1584));
}

/* =========================================================
   WELCOME MESSAGE WHEN BOT IS ADDED TO GROUP
========================================================= */

async function handleMyChatMember(token: string, db: D1Database, update: TelegramChatMemberUpdated) {
  const { chat, new_chat_member, old_chat_member } = update;

  // Bot was added to group
  if (new_chat_member.user.is_bot && new_chat_member.status === "member") {
    if (chat.type === "group" || chat.type === "supergroup") {
      await ensureGroup(db, chat);

      await sendMessage(
        token,
        chat.id,
        `🐱 <b>سلام گروه!</b>

` +
          `من Meow Points Bot هستم! 🎉

` +
          `هر وقت کسی توی این گروه بنویسه:
` +
          `🐱 <b>meow</b>
` +
          `🐱 <b>میو</b>
` +
          `🐱 <b>میووو</b>

` +
          `ممکنه Meow Points بگیره! ✨

` +
          `📌 <b>دستورات:</b>
` +
          `/me — پروفایل من
` +
          `/top — رتبه‌بندی گروه
` +
          `/global — رتبه‌بندی جهانی
` +
          `/daily — جایزه روزانه
` +
          `/pay — انتقال امتیاز
` +
          `/settings — تنظیمات گروه (ادمین)

` +
          `⏱️ کول‌داون: <b>5 دقیقه</b>
` +
          `😸 بفرستید و امتیاز بگیرید!`
      );
    }
  }

  // Bot was removed from group
  if (new_chat_member.user.is_bot && (new_chat_member.status === "left" || new_chat_member.status === "kicked")) {
    if (chat.type === "group" || chat.type === "supergroup") {
      await deactivateGroup(db, chat.id);
    }
  }
}

/* =========================================================
   WEBHOOK ROUTE
========================================================= */

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

    // Check if user is globally banned
    if (await isUserBanned(db, user.id)) {
      return c.json({ ok: true });
    }

    const text = message.text?.trim();
    if (!text) return c.json({ ok: true });

    const command = text.split(/\s+/)[0].toLowerCase();

    if (await isMaintenanceMode(db)) {
      if (!isOwner(c.env, user.id)) {
        return c.json({ ok: true });
      }
    }

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
    if (command === "دعوا") {
      await handleDuelRequest(token, db, message);
      return c.json({ ok: true });
    }

    // MEOW DETECTION
    if (isMeow(text)) {
      if (message.chat.type === "private") {
        const botInfo = await telegramRequest(token, "getMe", {});
        const botUsername = botInfo.result?.username || "YourBot";
        await sendMessage(token, message.chat.id, "🐱 میو کردن فقط داخل گروه امتیاز داره! منو رو به گروهت اضافه کن و اونجا میو بگو! 😸", {
          reply_markup: {
            inline_keyboard: [[{ text: "➕ افزودن به گروه", url: `https://t.me/${botUsername}?startgroup=true` }]],
          },
        });
        return c.json({ ok: true });
      }

      const settings = await getGroupSettings(db, message.chat.id);
      if (!settings.enabled) {
        return c.json({ ok: true });
      }

      const result = await awardMeow(db, user, message.chat);

      if (result < 0) {
        await sendMessage(token, message.chat.id, `⏱️ صبر کن!

${formatDuration(-result)} دیگه می‌تونی میو بدی! 😸`, {
          reply_to_message_id: message.message_id,
        });
        return c.json({ ok: true });
      }

      const points = result;

      let response = `🐱 میووو!

✨ +${points} Meow Points`;
      if (points >= 1000) response = `🌟 <b>MEGA MEOW!!!</b> 🌟

💰 +${points} Meow Points!`;
      else if (points >= 100) response = `🔥 <b>BIG MEOW!</b> 🔥

💰 +${points} Meow Points!`;

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

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (c) => {
  return c.json({
    ok: true,
    bot: "Meow Points",
    version: "2.4",
    status: "online",
  });
});

export default app;
