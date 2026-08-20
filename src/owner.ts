import {
  sendMessage,
  answerCallback,
  editMessageText,
  telegramRequest,
} from "./telegram";
import {
  ownerPanelKeyboard,
  usersMenuKeyboard,
  userActionKeyboard,
  userSearchResultsKeyboard,
  broadcastConfirmKeyboard,
  broadcastModeKeyboard,
  broadcastProgressKeyboard,
  txnAuditKeyboard,
  groupPageKeyboard,
  groupResetConfirmKeyboard,
  groupDeleteConfirmKeyboard,
  groupLotteryKeyboard,
  repairKeyboard,
  configPageKeyboard,
  eventInlineKeyboard,
} from "./keyboards";
import {
  findUserByUsername,
  findUserById,
  searchUsers,
  isUserBanned,
  getUserTransactions,
  getUserGroupMemberships,
  getBotSetting,
  setBotSetting,
  saveBroadcastDraft,
  getBroadcastDraft,
  deleteBroadcastDraft,
} from "./database";
import {
  getDuel,
  deleteDuel,
} from "./duel";
import { cancelAuctionById } from "./titleAuction";
import {
  escapeHtml,
  safeParseAmount,
  normalizeUsername,
  isValidDuelId,
  formatTehranDate,
  formatTehranTime,
  toEnglishNumbers,
  tehranDayStart,
  formatDuration,
} from "./utils";
import {
  Bindings,
  TelegramCallbackQuery,
  TelegramMessage,
} from "./types";
import {
  BROADCAST_CHUNK_SIZE,
  BROADCAST_CHUNK_SLEEP_MS,
  DUEL_TIMEOUT_SEC,
} from "./constants";

export function isOwner(env: Bindings, userId: number | null | undefined): boolean {
  return !!userId && env.BOT_OWNER_ID === String(userId);
}

async function requireOwner(token: string, env: Bindings, message: TelegramMessage, notify = false): Promise<boolean> {
  if (isOwner(env, message.from?.id)) return true;
  if (notify) await sendMessage(token, message.chat.id, "🚫 دسترسی غیرمجاز!");
  return false;
}

const OWNER_CONFIG_SETTINGS: { key: string; label: string; type: "int" | "float"; defaultValue: string }[] = [
  { key: "meow_street_min", label: "گربه‌ی خیابونی: حداقل امتیاز", type: "int", defaultValue: "1" },
  { key: "meow_street_max", label: "گربه‌ی خیابونی: حداکثر امتیاز", type: "int", defaultValue: "200" },
  { key: "meow_street_chance", label: "گربه‌ی خیابونی: احتمال", type: "float", defaultValue: "0.33" },
  { key: "meow_lucky_min", label: "گربه‌ی لوسی: حداقل امتیاز", type: "int", defaultValue: "201" },
  { key: "meow_lucky_max", label: "گربه‌ی لوسی: حداکثر امتیاز", type: "int", defaultValue: "500" },
  { key: "meow_lucky_chance", label: "گربه‌ی لوسی: احتمال", type: "float", defaultValue: "0.55" },
  { key: "meow_rainbow_min", label: "گربه‌ی رنگین‌کمانی: حداقل امتیاز", type: "int", defaultValue: "501" },
  { key: "meow_rainbow_max", label: "گربه‌ی رنگین‌کمانی: حداکثر امتیاز", type: "int", defaultValue: "900" },
  { key: "meow_rainbow_chance", label: "گربه‌ی رنگین‌کمانی: احتمال", type: "float", defaultValue: "0.085" },
  { key: "meow_legend_min", label: "گربه‌ی افسانه‌ای: حداقل امتیاز", type: "int", defaultValue: "901" },
  { key: "meow_legend_max", label: "گربه‌ی افسانه‌ای: حداکثر امتیاز", type: "int", defaultValue: "1300" },
  { key: "meow_legend_chance", label: "گربه‌ی افسانه‌ای: احتمال", type: "float", defaultValue: "0.025" },
  { key: "meow_king_min", label: "گربه‌ی پادشاه: حداقل امتیاز", type: "int", defaultValue: "1301" },
  { key: "meow_king_max", label: "گربه‌ی پادشاه: حداکثر امتیاز", type: "int", defaultValue: "1700" },
  { key: "meow_king_chance", label: "گربه‌ی پادشاه: احتمال", type: "float", defaultValue: "0.007" },
  { key: "meow_diamond_min", label: "گربه‌ی الماسی: حداقل امتیاز", type: "int", defaultValue: "1701" },
  { key: "meow_diamond_max", label: "گربه‌ی الماسی: حداکثر امتیاز", type: "int", defaultValue: "2200" },
  { key: "meow_diamond_chance", label: "گربه‌ی الماسی: احتمال", type: "float", defaultValue: "0.0025" },
  { key: "meow_galaxy_min", label: "گربه‌ی کهکشانی: حداقل امتیاز", type: "int", defaultValue: "2201" },
  { key: "meow_galaxy_max", label: "گربه‌ی کهکشانی: حداکثر امتیاز", type: "int", defaultValue: "3000" },
  { key: "meow_galaxy_chance", label: "گربه‌ی کهکشانی: احتمال", type: "float", defaultValue: "0.0005" },
];

/** Resolve a user by numeric ID (any digit script) or @username. */
export async function resolveUserByIdOrUsername(db: D1Database, raw: string) {
  const cleaned = toEnglishNumbers(raw).trim();
  let user: Awaited<ReturnType<typeof findUserById>> = null;
  let byId = false;
  if (/^\d+$/.test(cleaned)) {
    byId = true;
    user = await findUserById(db, parseInt(cleaned, 10));
  } else {
    const found = await findUserByUsername(db, normalizeUsername(cleaned));
    if (found) user = await findUserById(db, found.telegram_id);
  }
  return { user, byId };
}

function broadcastModeKey(userId: number) {
  return `broadcast_mode:${userId}`;
}
function broadcastCursorKey(userId: number) {
  return `broadcast_cursor:${userId}`;
}
function broadcastPendingKey(userId: number) {
  return `broadcast_pending:${userId}`;
}
function ownerSearchKey(userId: number) {
  return `owner_search:${userId}`;
}

// ---------------------------------------------------------------------------
// Dashboard & panel pages
// ---------------------------------------------------------------------------

export async function handleAdmin(token: string, _db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message, true))) return;

  // The owner panel only makes sense in the owner's private chat with the bot.
  if (message.chat.type !== "private") {
    await sendMessage(token, message.chat.id, "🐱 پنل ادمین فقط در چت خصوصی با ربات در دسترس است!");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const dayStart = tehranDayStart(now);
  const [users, groups, totalGroups, circulation, treasuries, pots, today, activeEvents, openAuctions, pendingDuels, maintenance] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) as c FROM users`),
    env.DB.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE is_active = 1`),
    env.DB.prepare(`SELECT COUNT(*) as c FROM telegram_groups`),
    env.DB.prepare(`SELECT COALESCE(SUM(meow_points), 0) as c FROM users`),
    env.DB.prepare(`SELECT COALESCE(SUM(treasury_balance), 0) as c FROM telegram_groups`),
    env.DB.prepare(`SELECT COALESCE(SUM(lottery_pot), 0) as c FROM telegram_groups`),
    env.DB.prepare(`SELECT COUNT(*) as c FROM transactions WHERE reason = 'MEOW' AND created_at >= ?`).bind(dayStart),
    env.DB.prepare(`SELECT COUNT(*) as c FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ?`).bind(now, now),
    env.DB.prepare(`SELECT COUNT(*) as c FROM title_auctions WHERE status = 'open'`),
    env.DB.prepare(`SELECT COUNT(*) as c FROM active_duels WHERE status = 'pending'`),
    env.DB.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`),
  ]);

  const n = (r: any) => r?.results?.[0]?.c ?? 0;
  const s = (r: any) => r?.results?.[0]?.value ?? "";
  const maintenanceOn = s(maintenance) === "1";

  const text =
    `🛡️ <b>Owner Panel</b>\n\n` +
    `👤 کاربران: <b>${n(users)}</b>\n` +
    `👥 گروه‌های فعال: <b>${n(groups)}</b> / ${n(totalGroups)}\n` +
    `💰 در گردش: <b>${Number(n(circulation)).toLocaleString("en-US")} MP</b>\n` +
    `🏦 خزانه‌ها: <b>${Number(n(treasuries)).toLocaleString("en-US")} MP</b>\n` +
    `🎟️ پات لاتاری: <b>${Number(n(pots)).toLocaleString("en-US")} MP</b>\n` +
    `🐾 میوهای امروز: <b>${n(today)}</b>\n` +
    `🎯 رویداد فعال: <b>${n(activeEvents)}</b> | ` +
    `🏷️ حراج باز: <b>${n(openAuctions)}</b> | ` +
    `⚔️ دعوای در انتظار: <b>${n(pendingDuels)}</b>\n` +
    `🔧 تعمیرات: <b>${maintenanceOn ? "🔴 روشن" : "🟢 خاموش"}</b>\n\n` +
    `از دکمه‌ها استفاده کن:`;

  await sendMessage(token, message.chat.id, text, { reply_markup: ownerPanelKeyboard(message.from?.id) });
}

async function renderStatsPage(token: string, db: D1Database, chatId: number, messageId: number, userId: number) {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = tehranDayStart(now);
  const [users, groups, totalGroups, circulation, treasuries, pots, today, activeEvents, openAuctions, pendingDuels, maintenance] = await db.batch([
    db.prepare(`SELECT COUNT(*) as c FROM users`),
    db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE is_active = 1`),
    db.prepare(`SELECT COUNT(*) as c FROM telegram_groups`),
    db.prepare(`SELECT COALESCE(SUM(meow_points), 0) as c FROM users`),
    db.prepare(`SELECT COALESCE(SUM(treasury_balance), 0) as c FROM telegram_groups`),
    db.prepare(`SELECT COALESCE(SUM(lottery_pot), 0) as c FROM telegram_groups`),
    db.prepare(`SELECT COUNT(*) as c FROM transactions WHERE reason = 'MEOW' AND created_at >= ?`).bind(dayStart),
    db.prepare(`SELECT COUNT(*) as c FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ?`).bind(now, now),
    db.prepare(`SELECT COUNT(*) as c FROM title_auctions WHERE status = 'open'`),
    db.prepare(`SELECT COUNT(*) as c FROM active_duels WHERE status = 'pending'`),
    db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`),
  ]);

  const n = (r: any) => r?.results?.[0]?.c ?? 0;
  const s = (r: any) => r?.results?.[0]?.value ?? "";
  const maintenanceOn = s(maintenance) === "1";
  const text =
    `📊 <b>آمار ربات</b>\n\n` +
    `👤 کاربران: <b>${n(users)}</b>\n` +
    `👥 گروه‌های فعال: <b>${n(groups)}</b> / ${n(totalGroups)}\n` +
    `💰 امتیاز در گردش: <b>${Number(n(circulation)).toLocaleString("en-US")} MP</b>\n` +
    `🏦 مجموع خزانه‌ها: <b>${Number(n(treasuries)).toLocaleString("en-US")} MP</b>\n` +
    `🎟️ مجموع پات لاتاری: <b>${Number(n(pots)).toLocaleString("en-US")} MP</b>\n` +
    `🐾 میوهای امروز: <b>${n(today)}</b>\n` +
    `🎯 رویداد فعال: <b>${n(activeEvents)}</b>\n` +
    `🏷️ حراج‌های باز: <b>${n(openAuctions)}</b>\n` +
    `⚔️ دعواهای در انتظار: <b>${n(pendingDuels)}</b>\n` +
    `🔧 حالت تعمیرات: <b>${maintenanceOn ? "🔴 روشن" : "🟢 خاموش"}</b>`;

  await editMessageText(token, chatId, messageId, text, ownerPanelKeyboard(userId));
}

async function renderEconomyPage(token: string, db: D1Database, chatId: number, messageId: number, userId: number) {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = tehranDayStart(now);
  const [economy, topUsers] = await db.batch([
    db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(meow_points), 0) FROM users) as circulation,
        (SELECT COALESCE(SUM(treasury_balance), 0) FROM telegram_groups) as treasuries,
        (SELECT COALESCE(SUM(lottery_pot), 0) FROM telegram_groups) as pots,
        (SELECT COUNT(*) FROM transactions) as txns,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE created_at >= ?) as today_points,
        (SELECT COUNT(*) FROM transactions WHERE reason = 'MEOW' AND created_at >= ?) as today_meows
    `).bind(dayStart, dayStart),
    db.prepare(`SELECT telegram_id, first_name, username, meow_points FROM users ORDER BY meow_points DESC LIMIT 5`),
  ]);

  const e = (economy.results?.[0] ?? {}) as Record<string, number>;
  let text =
    `💰 <b>اقتصاد ربات</b>\n\n` +
    `💵 امتیاز در گردش: <b>${(e.circulation ?? 0).toLocaleString("en-US")} MP</b>\n` +
    `🏦 مجموع خزانه‌ها: <b>${(e.treasuries ?? 0).toLocaleString("en-US")} MP</b>\n` +
    `🎟️ مجموع پات لاتاری: <b>${(e.pots ?? 0).toLocaleString("en-US")} MP</b>\n` +
    `🧾 کل تراکنش‌ها: <b>${(e.txns ?? 0).toLocaleString("en-US")}</b>\n` +
    `⚡ امتیاز امروز: <b>${(e.today_points ?? 0).toLocaleString("en-US")} MP</b>\n` +
    `🐾 میوهای امروز: <b>${e.today_meows ?? 0}</b>\n\n` +
    `🏆 <b>۵ کاربر ثروتمند:</b>\n`;

  const topRows = (topUsers.results ?? []) as { telegram_id: number; first_name: string; username: string | null; meow_points: number }[];
  if (!topRows.length) text += "هیچ کاربری نیست.";
  topRows.forEach((u, i) => {
    text += `${i + 1}. ${escapeHtml(u.first_name)} — <b>${u.meow_points.toLocaleString("en-US")} MP</b>\n`;
  });

  const keyboard = {
    inline_keyboard: [
      ...topRows.map((u) => [{ text: `👤 ${escapeHtml(u.first_name).slice(0, 20)} (#${u.telegram_id})`, callback_data: `useract:open:${u.telegram_id}:user:${userId}` }]),
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin:user:${userId}` }],
    ],
  };
  await editMessageText(token, chatId, messageId, text, keyboard);
}

async function renderEventsPage(token: string, db: D1Database, env: Bindings, chatId: number, messageId: number, userId: number) {
  const now = Math.floor(Date.now() / 1000);
  const activeEvent = await db
    .prepare(`SELECT title, description, bonus_multiplier, end_at FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .bind(now, now)
    .first<{ title: string; description: string; bonus_multiplier: number; end_at: number }>();

  let text = `🎉 <b>مدیریت رویدادها</b>\n\n`;
  if (activeEvent) {
    const remaining = formatDuration(activeEvent.end_at > now ? activeEvent.end_at - now : 0);
    text +=
      `🎯 رویداد فعلی: <b>${escapeHtml(activeEvent.title)}</b>\n` +
      `${escapeHtml(activeEvent.description)}\n` +
      `💥 ضریب: x${activeEvent.bonus_multiplier}\n` +
      `⏳ تا پایان: <b>${remaining}</b>`;
  } else {
    text += `✨ فعلاً رویداد فعالی وجود ندارد.\n\nبرای افزودن:\n<code>/add event نام ضریب دقیقه</code>\nمثال: <code>/add event FlashSale 2 60</code>`;
  }

  await editMessageText(token, chatId, messageId, text, eventInlineKeyboard(true, !!activeEvent, userId));
}

async function renderAuctionsPage(token: string, db: D1Database, chatId: number, messageId: number, userId: number, page = 0) {
  const perPage = 5;
  const offset = page * perPage;
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.prepare(`
    SELECT a.id, a.telegram_group_id, a.current_bid, a.start_amount, a.created_at, a.ends_at, t.name
    FROM title_auctions a
    LEFT JOIN titles t ON t.id = a.title_id
    WHERE a.status = 'open'
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(perPage + 1, offset).all<{
    id: number; telegram_group_id: number; current_bid: number | null;
    start_amount: number; created_at: number; ends_at: number | null; name: string | null;
  }>();

  if (!rows.results.length) {
    await editMessageText(token, chatId, messageId, "🏷️ <b>حراج‌های عنوان</b>\n\nهیچ حراج باز وجود ندارد.", ownerPanelKeyboard(userId));
    return;
  }

  const hasMore = rows.results.length > perPage;
  const list = hasMore ? rows.results.slice(0, perPage) : rows.results;

  let text = `🏷️ <b>حراج‌های باز</b> (صفحه ${page + 1})\n\n`;
  for (const r of list) {
    const bid = r.current_bid ?? r.start_amount;
    const remaining = r.ends_at ? formatDuration(Math.max(0, r.ends_at - now)) : "نامشخص";
    text += `#${r.id} — <b>${escapeHtml(r.name ?? "؟")}</b>\n   💰 ${bid.toLocaleString("en-US")} MP | ⏳ ${remaining} | گروه: ${r.telegram_group_id}\n\n`;
  }

  const keyboardRows = list.map((r) => [{
    text: `❌ لغو: ${escapeHtml(r.name ?? "؟").slice(0, 18)} (#${r.id})`,
    callback_data: `auctionmgr:cancel:${r.id}:${page}:user:${userId}`,
  }]);
  keyboardRows.push([
    { text: "⬅️ قبلی", callback_data: `auctionmgr:page:${Math.max(0, page - 1)}:user:${userId}` },
    { text: "➡️ بعدی", callback_data: `auctionmgr:page:${hasMore ? page + 1 : page}:user:${userId}` },
  ]);
  keyboardRows.push([{ text: "🔙 پنل ادمین", callback_data: `menu:admin:user:${userId}` }]);

  await editMessageText(token, chatId, messageId, text, { inline_keyboard: keyboardRows });
}

async function renderConfigPage(token: string, db: D1Database, chatId: number, messageId: number, userId: number, page = 0) {
  const perPage = 8;
  const totalPages = Math.ceil(OWNER_CONFIG_SETTINGS.length / perPage);
  const safePage = Math.max(0, Math.min(totalPages - 1, page));

  const values = new Map<string, string>();
  const keys = OWNER_CONFIG_SETTINGS.map((s) => s.key);
  const stored = await db.prepare(`SELECT key, value FROM bot_settings WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; value: string }>();
  for (const row of stored.results ?? []) values.set(row.key, row.value);

  const entries = OWNER_CONFIG_SETTINGS.slice(safePage * perPage, safePage * perPage + perPage).map((s) => ({
    key: s.key,
    label: s.label,
    type: s.type,
    value: values.get(s.key) ?? s.defaultValue,
  }));

  const text =
    `⚙️ <b>تنظیمات Meow</b> (صفحه ${safePage + 1}/${totalPages})\n\n` +
    `برای مقدار دقیق:\n<code>/config کلید مقدار</code>\n\n` +
    entries.map((e) => `<code>${e.key}</code>: <b>${e.value}</b>`).join("\n");

  await editMessageText(token, chatId, messageId, text, configPageKeyboard(entries, safePage, totalPages, userId));
}

/** Apply a config delta from the editor, with min≤max pair validation. */
export function computeConfigValue(setting: { key: string; type: "int" | "float" }, current: string, delta: number): { value: number } | { error: string } {
  let newVal: number;
  if (setting.type === "int") {
    newVal = Math.max(0, parseInt(current, 10) + Math.round(delta));
  } else {
    newVal = Math.round((parseFloat(current) + delta) * 10000) / 10000;
    if (setting.key.endsWith("_chance")) newVal = Math.max(0, Math.min(1, newVal));
  }
  return { value: newVal };
}

/** Returns an error string when the new min/max breaks its pair, else null. */
export function validateConfigPair(key: string, newVal: number, siblingKey: string, siblingVal: number): string | null {
  if (key.endsWith("_min") && newVal > siblingVal) return `min (${newVal}) > max (${siblingVal})`;
  if (key.endsWith("_max") && newVal < siblingVal) return `max (${newVal}) < min (${siblingVal})`;
  void siblingKey;
  return null;
}

async function applyConfigDelta(token: string, db: D1Database, callback: TelegramCallbackQuery, key: string, delta: number) {
  const setting = OWNER_CONFIG_SETTINGS.find((s) => s.key === key);
  if (!setting) {
    await answerCallback(token, callback.id, "❌ کلید نامعتبر", true);
    return;
  }
  const stored = await getBotSetting(db, key);
  const current = stored !== null && stored !== "" ? stored : setting.defaultValue;

  const computed = computeConfigValue(setting, current, delta);
  if ("error" in computed) {
    await answerCallback(token, callback.id, `⚠️ ${computed.error}`, true);
    return;
  }
  const newVal = computed.value;

  const sibling = key.endsWith("_min")
    ? OWNER_CONFIG_SETTINGS.find((s) => s.key === key.replace("_min", "_max"))
    : key.endsWith("_max")
      ? OWNER_CONFIG_SETTINGS.find((s) => s.key === key.replace("_max", "_min"))
      : undefined;
  if (sibling) {
    const siblingStored = await getBotSetting(db, sibling.key);
    const siblingVal = parseFloat(siblingStored !== null && siblingStored !== "" ? siblingStored : sibling.defaultValue);
    const error = validateConfigPair(key, newVal, sibling.key, siblingVal);
    if (error) {
      await answerCallback(token, callback.id, `⚠️ ${error}!`, true);
      return;
    }
  }

  await setBotSetting(db, key, String(newVal));
  await answerCallback(token, callback.id, `✅ ${setting.label} = ${newVal}`);
}

// ---------------------------------------------------------------------------
// Broadcast (chunked + resumable: one chunk per callback press, so every
// invocation stays under the Free plan's 50 subrequests / 50 D1 queries)
// ---------------------------------------------------------------------------

type BroadcastMode = "users" | "groups";

async function broadcastTargets(db: D1Database, mode: BroadcastMode, lastId: number, limit: number) {
  if (mode === "groups") {
    return db.prepare(`SELECT telegram_group_id FROM telegram_groups WHERE telegram_group_id > ? AND is_active = 1 ORDER BY telegram_group_id LIMIT ?`)
      .bind(lastId, limit)
      .all<{ telegram_group_id: number }>();
  }
  return db.prepare(`SELECT telegram_id FROM users WHERE telegram_id > ? AND is_banned = 0 ORDER BY telegram_id LIMIT ?`)
    .bind(lastId, limit)
    .all<{ telegram_id: number }>();
}

async function broadcastCount(db: D1Database, mode: BroadcastMode): Promise<number> {
  const table = mode === "groups" ? "telegram_groups" : "users";
  const clause = mode === "groups" ? "is_active = 1" : "is_banned = 0";
  const row = await db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${clause}`).first<{ c: number }>();
  return row?.c ?? 0;
}

interface BroadcastCursor {
  lastId: number;
  sent: number;
  failed: number;
  total: number;
}

async function getBroadcastCursor(db: D1Database, ownerId: number): Promise<BroadcastCursor> {
  const raw = await getBotSetting(db, broadcastCursorKey(ownerId));
  if (!raw) return { lastId: 0, sent: 0, failed: 0, total: 0 };
  try {
    return JSON.parse(raw) as BroadcastCursor;
  } catch {
    return { lastId: 0, sent: 0, failed: 0, total: 0 };
  }
}

async function saveBroadcastCursor(db: D1Database, ownerId: number, cursor: BroadcastCursor) {
  await setBotSetting(db, broadcastCursorKey(ownerId), JSON.stringify(cursor));
}

async function clearBroadcastState(db: D1Database, ownerId: number) {
  await deleteBroadcastDraft(db, ownerId);
  await db.batch([
    db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(broadcastCursorKey(ownerId)),
    db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(broadcastModeKey(ownerId)),
    db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(broadcastPendingKey(ownerId)),
  ]);
}

/**
 * Send one chunk (≤40 targets) of the pending broadcast. Returns true when the
 * broadcast is finished (or has nothing left to send).
 */
async function runBroadcastChunk(token: string, db: D1Database, ownerId: number, mode: BroadcastMode): Promise<{ done: boolean; sent: number; failed: number; total: number }> {
  const draft = await getBroadcastDraft(db, ownerId);
  const cursor = await getBroadcastCursor(db, ownerId);
  if (!draft || cursor.total > 0 && cursor.sent + cursor.failed >= cursor.total) {
    await clearBroadcastState(db, ownerId);
    return { done: true, sent: cursor.sent, failed: cursor.failed, total: cursor.total };
  }

  const rows = await broadcastTargets(db, mode, cursor.lastId, BROADCAST_CHUNK_SIZE);
  if (!rows.results.length) {
    await clearBroadcastState(db, ownerId);
    return { done: true, sent: cursor.sent, failed: cursor.failed, total: cursor.sent + cursor.failed };
  }

  for (const r of rows.results) {
    const id = mode === "groups" ? (r as { telegram_group_id: number }).telegram_group_id : (r as { telegram_id: number }).telegram_id;
    const res = await telegramRequest(token, "sendMessage", {
      chat_id: id,
      text: `📢 <b>پیام از طرف ادمین</b>\n\n${escapeHtml(draft)}`,
      parse_mode: "HTML",
    });
    if (res.ok) cursor.sent++;
    else cursor.failed++;
    cursor.lastId = id;
  }
  await saveBroadcastCursor(db, ownerId, cursor);
  await new Promise((r) => setTimeout(r, BROADCAST_CHUNK_SLEEP_MS));
  const total = cursor.total > 0 ? cursor.total : cursor.sent + cursor.failed;
  return { done: cursor.sent + cursor.failed >= total, sent: cursor.sent, failed: cursor.failed, total };
}

export async function handleOwnerBroadcast(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const text = (message.text || "").replace(/^\/broadcast\s*/, "");
  let mode: BroadcastMode = "users";
  let payload = text;
  if (/^(groups|group|گروه)\s+/i.test(text)) {
    mode = "groups";
    payload = text.replace(/^(groups|group|گروه)\s+/i, "");
  }
  if (!payload.trim()) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده: /broadcast پیام شما\nیا برای گروه‌ها: /broadcast groups پیام شما");
    return;
  }

  await saveBroadcastDraft(db, message.from!.id, payload);
  await setBotSetting(db, broadcastModeKey(message.from!.id), mode);
  const target = mode === "groups" ? "گروه‌ها" : "کاربران";
  await sendMessage(token, message.chat.id,
    `📢 <b>پیش‌نمایش پیام همگانی (به ${target}):</b>\n\n${escapeHtml(payload)}\n\nآماده ارسال؟`,
    { reply_markup: broadcastConfirmKeyboard(message.from?.id) }
  );
}

/** Continue/start the broadcast pipeline from a callback press. */
export async function handleBroadcastContinue(token: string, db: D1Database, env: Bindings, callback: TelegramCallbackQuery, finish = false) {
  if (!callback.from || !callback.message) return;
  if (!isOwner(env, callback.from.id)) {
    await answerCallback(token, callback.id, "🚫 فقط ادمین!", true);
    return;
  }

  const ownerId = callback.from.id;
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const mode = ((await getBotSetting(db, broadcastModeKey(ownerId))) ?? "users") as BroadcastMode;
  const draft = await getBroadcastDraft(db, ownerId);
  if (!draft) {
    await answerCallback(token, callback.id, "❌ پیام همگانی منقضی شده!", true);
    return;
  }

  if (finish) {
    await clearBroadcastState(db, ownerId);
    await editMessageText(token, chatId, messageId, "❌ ارسال متوقف شد.", ownerPanelKeyboard(ownerId));
    await answerCallback(token, callback.id, "توقف شد.");
    return;
  }

  const cursor = await getBroadcastCursor(db, ownerId);
  const total = cursor.total > 0 ? cursor.total : await broadcastCount(db, mode);
  if (cursor.total === 0) {
    cursor.total = total;
    await saveBroadcastCursor(db, ownerId, cursor);
  }

  const result = await runBroadcastChunk(token, db, ownerId, mode);

  if (result.done) {
    await editMessageText(token, chatId, messageId,
      `📢 <b>ارسال کامل شد!</b>\n\n✅ موفق: ${result.sent}\n❌ ناموفق: ${result.failed}\n👥 کل: ${result.total}`,
      broadcastProgressKeyboard(ownerId, true)
    );
  } else {
    await editMessageText(token, chatId, messageId,
      `📢 <b>در حال ارسال…</b>\n\n✅ موفق: ${result.sent}\n❌ ناموفق: ${result.failed}\n👥 ارسال شد: ${result.sent + result.failed} از ${result.total}\n\nبرای ادامه، دکمه ▶️ را بزن.`,
      broadcastProgressKeyboard(ownerId)
    );
  }
  await answerCallback(token, callback.id, result.done ? "✅ کامل شد!" : "📨 ادامه بده…");
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export async function handleOwnerAddPoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /addpoints @username 100\nیا\n/addpoints 123456789 100");
    return;
  }

  const amount = safeParseAmount(parts[2]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "مقدار نامعتبر!");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);
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
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 3) {
    await sendMessage(token, message.chat.id, "🐱 /removepoints @username 100\nیا\n/removepoints 123456789 100");
    return;
  }

  const amount = safeParseAmount(parts[2]);
  if (amount === null) {
    await sendMessage(token, message.chat.id, "مقدار نامعتبر!");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);
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
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /resetuser @username\nیا\n/resetuser 123456789");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET meow_points = 0, total_meows = 0 WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await db.prepare(`DELETE FROM group_members WHERE telegram_user_id = ?`).bind(user.telegram_id).run();
  await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ?`).bind(user.telegram_id).run();

  await sendMessage(token, message.chat.id, `🔄 کاربر ${escapeHtml(user.first_name)} کاملاً ریست شد!`);
}

export async function handleOwnerUserInfo(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /userinfo @username\nیا\n/userinfo 123456789\nیا\n/userinfo نام");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);

  // Not an exact match → fuzzy search, show top matches as buttons.
  if (!user) {
    const results = await searchUsers(db, parts[1]);
    if (!results.results.length) {
      await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
      return;
    }
    let text = `🔍 <b>نتایج جستجو</b> (${results.results.length}):\n\n`;
    text += results.results.map((r) => `• ${escapeHtml(r.first_name)}${r.username ? ` @${r.username}` : ""} — #${r.telegram_id}`).join("\n");
    await sendMessage(token, message.chat.id, text, { reply_markup: userSearchResultsKeyboard(results.results, message.from?.id) });
    return;
  }

  const userId = user.telegram_id;
  const txns = await getUserTransactions(db, userId, 5);
  const groups = await getUserGroupMemberships(db, userId);
  const banned = await isUserBanned(db, userId);

  const createdDate = formatTehranDate(user.created_at || 0);

  let text = `👤 <b>اطلاعات کاربر</b>\n\n`;
  text += `🆔 ID: <code>${user.telegram_id}</code>\n`;
  text += `👤 نام: ${escapeHtml(user.first_name)}\n`;
  text += `🔗 یوزرنیم: ${user.username ? "@" + escapeHtml(user.username) : "ندارد"}\n`;
  text += `💰 امتیاز: <b>${user.meow_points} MP</b>\n`;
  text += `🐾 کل میوها: <b>${user.total_meows}</b>\n`;
  text += `📅 عضویت: <b>${createdDate}</b>\n`;
  text += `🚫 وضعیت: <b>${banned ? "❌ بن شده" : "✅ فعال"}</b>\n\n`;

  if (txns.results.length) {
    text += `📝 آخرین تراکنش‌ها:\n`;
    for (const t of txns.results) {
      const sign = t.amount >= 0 ? "+" : "";
      text += `  ${sign}${t.amount} — ${t.reason} (${formatTehranDate(t.created_at)})\n`;
    }
    text += `\n`;
  }

  if (groups.results.length) {
    text += `👥 عضو ${groups.results.length} گروه:\n`;
    for (const g of groups.results.slice(0, 5)) {
      text += `  • ${escapeHtml(g.title)} — ${g.meow_points} MP\n`;
    }
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: userActionKeyboard(userId, message.from?.id) });
}

/** Search flow entry used by the panel's 🔍 button + pending-text hook. */
export async function handleOwnerSearch(token: string, db: D1Database, env: Bindings, message: TelegramMessage, text: string) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = text.trim().split(" ").filter(Boolean);
  if (!parts.length) {
    await sendMessage(token, message.chat.id, "نام، یوزرنیم یا آیدی کاربر را بفرست.");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[0]);
  if (user) {
    const infoMessage = { ...message, text: `/userinfo ${user.telegram_id}` } as TelegramMessage;
    await handleOwnerUserInfo(token, db, env, infoMessage);
    return;
  }

  const results = await searchUsers(db, text.trim());
  if (!results.results.length) {
    await sendMessage(token, message.chat.id, "کاربری پیدا نشد!");
    return;
  }
  let out = `🔍 <b>نتایج جستجو</b> (${results.results.length}):\n\n`;
  out += results.results.map((r) => `• ${escapeHtml(r.first_name)}${r.username ? ` @${r.username}` : ""} — #${r.telegram_id}`).join("\n");
  await sendMessage(token, message.chat.id, out, { reply_markup: userSearchResultsKeyboard(results.results, message.from?.id) });
}

export async function handleOwnerBanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /banuser @username\nیا\n/banuser 123456789");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET is_banned = 1 WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await sendMessage(token, message.chat.id, `🚫 کاربر ${escapeHtml(user.first_name)} بن شد!`);
}

export async function handleOwnerUnbanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 /unbanuser @username\nیا\n/unbanuser 123456789");
    return;
  }

  const { user } = await resolveUserByIdOrUsername(db, parts[1]);
  if (!user) {
    await sendMessage(token, message.chat.id, "کاربر پیدا نشد!");
    return;
  }

  await db.prepare(`UPDATE users SET is_banned = 0 WHERE telegram_id = ?`).bind(user.telegram_id).run();
  await sendMessage(token, message.chat.id, `✅ کاربر ${escapeHtml(user.first_name)} آنبن شد!`);
}

// ---------------------------------------------------------------------------
// Database repair & health
// ---------------------------------------------------------------------------

/** Run the consistency checks; returns the human-readable report lines. */
export async function runRepairChecks(db: D1Database): Promise<string[]> {
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

  const balanceMismatches = await db.prepare(`
    SELECT u.telegram_id, u.first_name, u.meow_points, COALESCE(SUM(t.amount), 0) as expected
    FROM users u
    LEFT JOIN transactions t ON u.telegram_id = t.telegram_user_id
    GROUP BY u.telegram_id
    HAVING u.meow_points != COALESCE(SUM(t.amount), 0)
  `).all<{ telegram_id: number; first_name: string; meow_points: number; expected: number }>();

  if (balanceMismatches.results.length > 0) {
    const lines = balanceMismatches.results.slice(0, 20).map((row) => {
      const diff = row.meow_points - row.expected;
      return `• ${escapeHtml(row.first_name)} (#${row.telegram_id}): have ${row.meow_points}, expected ${row.expected}, diff ${diff}`;
    });
    const extra = balanceMismatches.results.length > 20 ? `\n... و ${balanceMismatches.results.length - 20} مورد بیشتر` : "";
    issues.push(`⚠️ ${balanceMismatches.results.length} کاربر اختلاف امتیاز/تراکنش دارن:\n${lines.join("\n")}${extra}`);
  }

  const totalMeowMismatches = await db.prepare(`
    SELECT u.telegram_id, u.first_name, u.total_meows, COALESCE(COUNT(t.amount), 0) as expected
    FROM users u
    LEFT JOIN transactions t ON u.telegram_id = t.telegram_user_id AND t.reason = 'MEOW'
    GROUP BY u.telegram_id
    HAVING u.total_meows != COALESCE(COUNT(t.amount), 0)
  `).all<{ telegram_id: number; first_name: string; total_meows: number; expected: number }>();

  if (totalMeowMismatches.results.length > 0) {
    const lines = totalMeowMismatches.results.slice(0, 20).map((row) => {
      const diff = row.total_meows - row.expected;
      return `• ${escapeHtml(row.first_name)} (#${row.telegram_id}): total_meows ${row.total_meows}, expected ${row.expected}, diff ${diff}`;
    });
    const extra = totalMeowMismatches.results.length > 20 ? `\n... و ${totalMeowMismatches.results.length - 20} مورد بیشتر` : "";
    issues.push(`⚠️ ${totalMeowMismatches.results.length} کاربر اختلاف total_meows دارن:\n${lines.join("\n")}${extra}`);
  }

  const groupMeowMismatches = await db.prepare(`
    SELECT gm.telegram_group_id, gm.telegram_user_id, gm.first_name, gm.total_meows, COALESCE(COUNT(t.amount), 0) as expected
    FROM group_members gm
    LEFT JOIN transactions t ON gm.telegram_user_id = t.telegram_user_id AND gm.telegram_group_id = t.group_id AND t.reason = 'MEOW'
    GROUP BY gm.telegram_group_id, gm.telegram_user_id
    HAVING gm.total_meows != COALESCE(COUNT(t.amount), 0)
  `).all<{ telegram_group_id: number; telegram_user_id: number; first_name: string; total_meows: number; expected: number }>();

  if (groupMeowMismatches.results.length > 0) {
    const lines = groupMeowMismatches.results.slice(0, 20).map((row) => {
      const diff = row.total_meows - row.expected;
      return `• گروه ${row.telegram_group_id} / ${escapeHtml(row.first_name)} (#${row.telegram_user_id}): total_meows ${row.total_meows}, expected ${row.expected}, diff ${diff}`;
    });
    const extra = groupMeowMismatches.results.length > 20 ? `\n... و ${groupMeowMismatches.results.length - 20} مورد بیشتر` : "";
    issues.push(`⚠️ ${groupMeowMismatches.results.length} ردیف گروهی اختلاف total_meows دارن:\n${lines.join("\n")}${extra}`);
  }

  const clobberedCount = await repairClobberedNames(db);
  if (clobberedCount > 0) {
    issues.push(`🏷️ ${clobberedCount} نام کاربری خراب (#id) در گروه‌ها ترمیم شد`);
  }

  return issues;
}

export async function handleOwnerRepair(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;

  const issues = await runRepairChecks(db);
  const text = issues.length === 0
    ? "✅ دیتابیس سالمه! هیچ مشکلی پیدا نشد."
    : `🔍 <b>نتایج بررسی:</b>\n\n${issues.join("\n\n")}`;

  await sendMessage(token, message.chat.id, text, { reply_markup: repairKeyboard(message.from?.id) });
}

/** Sync balances with the transaction ledger (repair:fix). */
async function fixBalanceMismatches(db: D1Database): Promise<number> {
  const before = await db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT u.telegram_id
      FROM users u
      LEFT JOIN transactions t ON u.telegram_id = t.telegram_user_id
      GROUP BY u.telegram_id
      HAVING u.meow_points != COALESCE(SUM(t.amount), 0)
    )
  `).first<{ c: number }>();

  await db.prepare(`
    UPDATE users SET meow_points = COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.telegram_user_id = users.telegram_id), 0)
  `).run();
  await db.prepare(`
    UPDATE group_members SET meow_points = COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.telegram_user_id = group_members.telegram_user_id AND t.group_id = group_members.telegram_group_id), 0)
  `).run();

  return before?.c ?? 0;
}

/**
 * Title-auction bug: the settlement/refund upserts once wrote `#<id>` into
 * group_members.first_name, which then shows up in /top as "🏅 title #123…".
 * Restore the real name from users (exact match — `#<user_id>`, no false
 * positives). Optionally scoped to a single group. Returns rows fixed.
 */
async function repairClobberedNames(db: D1Database, groupId?: number): Promise<number> {
  const where = groupId != null ? `AND gm.telegram_group_id = ?` : "";
  const args = groupId != null ? [groupId] : [];
  const clobberedNames = await db
    .prepare(`
      SELECT gm.telegram_group_id, gm.telegram_user_id, u.username, u.first_name
      FROM group_members gm
      LEFT JOIN users u ON u.telegram_id = gm.telegram_user_id
      WHERE gm.first_name = '#' || CAST(gm.telegram_user_id AS TEXT)
        AND u.telegram_id IS NOT NULL
        ${where}
    `)
    .bind(...args)
    .all<{ telegram_group_id: number; telegram_user_id: number; username: string | null; first_name: string | null }>();
  if (!clobberedNames.results.length) return 0;
  // D1 batch() caps at 100 statements, and the Free plan caps D1 at 50 queries
  // per invocation (each statement counts) — chunk at 40 to satisfy both.
  for (let i = 0; i < clobberedNames.results.length; i += 40) {
    const stmts = clobberedNames.results.slice(i, i + 40).map((row) =>
      db.prepare(`UPDATE group_members SET username = ?, first_name = ? WHERE telegram_group_id = ? AND telegram_user_id = ?`)
        .bind(row.username ?? null, row.first_name ?? "?", row.telegram_group_id, row.telegram_user_id)
    );
    await db.batch(stmts);
  }
  return clobberedNames.results.length;
}

/**
 * Owner-only: refresh a group's leaderboard — fix any `#<id>` clobbered names
 * and re-post the /top board in the group. Works as `/refreshlb` inside the
 * group, or via the 🔄 button in the owner panel groups list.
 */
export async function handleOwnerRefreshLeaderboard(token: string, db: D1Database, env: Bindings, message: TelegramMessage, targetGroupId?: number) {
  if (!(await requireOwner(token, env, message))) return;
  const groupId = targetGroupId ?? message.chat.id;
  if (targetGroupId == null && message.chat.type !== "group" && message.chat.type !== "supergroup") {
    await sendMessage(token, message.chat.id, "🐱 این دستور را داخل گروه بفرست: <code>/refreshlb</code>");
    return;
  }

  const fixed = await repairClobberedNames(db, groupId);
  const { handleTop } = await import("./handlers");
  await handleTop(token, db, {
    message_id: 0,
    from: message.from,
    chat: { id: groupId, type: "supergroup" },
    text: "/top",
  } as TelegramMessage);

  const note = fixed > 0 ? ` (${fixed} نام ترمیم شد)` : "";
  await sendMessage(token, message.chat.id, `✅ لیدربورد گروه رفرش شد${note}.`);
}

export async function handleOwnerRefreshBadge(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;

  await db.prepare(`
    UPDATE users
    SET total_meows = (
      SELECT COUNT(*)
      FROM transactions t
      WHERE t.telegram_user_id = users.telegram_id
        AND t.reason = 'MEOW'
    )
  `).run();

  await db.prepare(`
    UPDATE group_members
    SET total_meows = (
      SELECT COUNT(*)
      FROM transactions t
      WHERE t.telegram_user_id = group_members.telegram_user_id
        AND t.group_id = group_members.telegram_group_id
        AND t.reason = 'MEOW'
    )
  `).run();

  await sendMessage(token, message.chat.id, "✅ مقادیر badge با موفقیت به‌روزرسانی شد. total_meows همه کاربران و اعضای گروه بازسازی شد.");
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function handleOwnerConfig(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);

  const configValues: Record<string, string> = {};
  for (const setting of OWNER_CONFIG_SETTINGS) {
    const stored = await getBotSetting(db, setting.key);
    configValues[setting.key] = stored !== null && stored !== "" ? stored : setting.defaultValue ?? (setting.type === "int" ? "0" : "0.00");
  }

  if (parts.length < 2) {
    await sendMessage(
      token,
      message.chat.id,
      `⚙️ <b>تنظیمات Meow</b>\n\n${OWNER_CONFIG_SETTINGS.map((setting) => `${setting.label}: <code>${configValues[setting.key]}</code>\n<code>${setting.key}</code>`).join("\n\n")}\n\nبرای تغییر مقدار، از دستور زیر استفاده کن:\n<code>/config meow_street_min 1</code>\n<code>/config meow_galaxy_chance 0.005</code>\n\nبرای دیدن مقدار فعلی یک کلید، از دستور زیر استفاده کن:\n<code>/config meow_street_min</code>`,
    );
    return;
  }

  const key = parts[1];
  const value = parts[2];
  const setting = OWNER_CONFIG_SETTINGS.find((item) => item.key === key);

  if (!setting) {
    await sendMessage(token, message.chat.id, `⚠️ کلید نامعتبر. از یکی از موارد زیر استفاده کن:\n${OWNER_CONFIG_SETTINGS.map((item) => `<code>${item.key}</code>`).join("\n")}`);
    return;
  }

  if (!value) {
    const current = await getBotSetting(db, key);
    await sendMessage(token, message.chat.id, `⚙️ ${setting.label}: ${current ?? "تنظیم نشده"}`);
    return;
  }

  let newVal = value.trim();
  if (setting.type === "int") {
    const parsed = parseInt(toEnglishNumbers(newVal), 10);
    newVal = String(Math.max(0, Number.isFinite(parsed) ? parsed : 0));
  } else {
    const parsed = parseFloat(toEnglishNumbers(newVal).replace(",", "."));
    let chance = Number.isFinite(parsed) ? parsed : 0;
    if (chance > 1 && chance <= 100) chance = chance / 100;
    chance = Math.max(0, Math.min(1, chance));
    newVal = String(chance);
  }

  // min ≤ max pair validation (mirrors the panel editor).
  const sibling = key.endsWith("_min")
    ? OWNER_CONFIG_SETTINGS.find((s) => s.key === key.replace("_min", "_max"))
    : key.endsWith("_max")
      ? OWNER_CONFIG_SETTINGS.find((s) => s.key === key.replace("_max", "_min"))
      : undefined;
  if (sibling) {
    const siblingStored = await getBotSetting(db, sibling.key);
    const siblingVal = parseFloat(siblingStored !== null && siblingStored !== "" ? siblingStored : sibling.defaultValue);
    if (key.endsWith("_min") && parseFloat(newVal) > siblingVal) {
      await sendMessage(token, message.chat.id, `⚠️ حداقل نمی‌تواند از حداکثر (${siblingVal}) بیشتر باشد!`);
      return;
    }
    if (key.endsWith("_max") && parseFloat(newVal) < siblingVal) {
      await sendMessage(token, message.chat.id, `⚠️ حداکثر نمی‌تواند از حداقل (${siblingVal}) کمتر باشد!`);
      return;
    }
  }

  await setBotSetting(db, key, newVal);
  await sendMessage(token, message.chat.id, `✅ ${setting.label} = ${newVal} تنظیم شد.`);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function handleGroups(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0) {
  if (!(await requireOwner(token, env, message))) return;
  const perPage = 5;
  const offset = page * perPage;
  const u = message.from!.id;

  const groups = await db.prepare(`
    SELECT telegram_group_id, title, is_active,
      (SELECT COUNT(*) FROM group_members WHERE telegram_group_id = g.telegram_group_id) as member_count
    FROM telegram_groups g
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(perPage + 1, offset).all<{ telegram_group_id: number; title: string; is_active: number; member_count: number }>();

  if (!groups.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هیچ گروهی پیدا نشد!", { reply_markup: ownerPanelKeyboard(u) });
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
      { text: `📊 ${escapeHtml(g.title || "Group").slice(0, 15)}`, callback_data: `groupmgr:view:${g.telegram_group_id}:${page}:user:${u}` },
      { text: g.is_active ? "🚫 غیرفعال" : "✅ فعال", callback_data: `groupmgr:toggle:${g.telegram_group_id}:${page}:user:${u}` },
      { text: "🔄 رفرش", callback_data: `groupmgr:refresh:${g.telegram_group_id}:${page}:user:${u}` },
    ]);
  }
  keyboard.push([
    { text: "⬅️ قبلی", callback_data: `groupmgr:page:${Math.max(0, page - 1)}:user:${u}` },
    { text: "➡️ بعدی", callback_data: `groupmgr:page:${hasMore ? page + 1 : page}:user:${u}` },
  ]);
  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: `menu:admin:user:${u}` }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

/** Render the per-group detail page in the owner's chat. */
async function renderGroupPage(token: string, db: D1Database, chatId: number, messageId: number, groupId: number, page: number, userId: number) {
  const g = await db.prepare(`
    SELECT title, is_active, cooldown_seconds, treasury_balance, lottery_pot, lottery_ticket_price,
      (SELECT COUNT(*) FROM group_members WHERE telegram_group_id = ?) as member_count,
      (SELECT COALESCE(SUM(meow_points), 0) FROM group_members WHERE telegram_group_id = ?) as total_mp
  `).bind(groupId, groupId).first<{
    title: string; is_active: number; cooldown_seconds: number;
    treasury_balance: number; lottery_pot: number; lottery_ticket_price: number;
    member_count: number; total_mp: number;
  }>();

  if (!g) {
    await editMessageText(token, chatId, messageId, "❌ گروه پیدا نشد.", ownerPanelKeyboard(userId));
    return;
  }

  const text =
    `📋 <b>${escapeHtml(g.title || "Group")}</b>\n\n` +
    `🆔 <code>${groupId}</code>\n` +
    `🤖 وضعیت: ${g.is_active ? "✅ فعال" : "🚫 غیرفعال"}\n` +
    `⏱️ کول‌داون: ${g.cooldown_seconds}s\n` +
    `👥 اعضا: <b>${g.member_count}</b>\n` +
    `💰 مجموع امتیاز گروه: <b>${g.total_mp.toLocaleString("en-US")} MP</b>\n` +
    `🏦 خزانه: <b>${g.treasury_balance.toLocaleString("en-US")} MP</b>\n` +
    `🎟️ پات لاتاری: <b>${g.lottery_pot.toLocaleString("en-US")} MP</b> (قیمت بلیت: ${g.lottery_ticket_price} MP)`;

  await editMessageText(token, chatId, messageId, text, groupPageKeyboard(groupId, page, g.is_active === 1, userId));
}

/** Render the lottery adjust page for a group in the owner's chat. */
async function renderGroupLotteryPage(token: string, db: D1Database, chatId: number, messageId: number, groupId: number, page: number, userId: number) {
  const g = await db.prepare(`SELECT lottery_pot, lottery_ticket_price, lottery_enabled FROM telegram_groups WHERE telegram_group_id = ?`).bind(groupId).first<{
    lottery_pot: number; lottery_ticket_price: number; lottery_enabled: number;
  }>();

  const text =
    `🎟️ <b>لاتاری گروه</b> <code>${groupId}</code>\n\n` +
    `وضعیت: ${g?.lottery_enabled ? "✅ روشن" : "❌ خاموش"}\n` +
    `💰 پات: <b>${(g?.lottery_pot ?? 0).toLocaleString("en-US")} MP</b>\n` +
    `🎫 قیمت بلیت: <b>${g?.lottery_ticket_price ?? 0} MP</b>\n\n` +
    `برای تغییر مالیات یا روشن/خاموش کردن، داخل گروه از /lottery استفاده کن.`;

  await editMessageText(token, chatId, messageId, text, groupLotteryKeyboard(groupId, page, userId));
}

// ---------------------------------------------------------------------------
// Duels & audit
// ---------------------------------------------------------------------------

export async function handleDuels(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const now = Math.floor(Date.now() / 1000);
  const userSuffix = `:user:${message.from!.id}`;

  const duels = await db.prepare(`
    SELECT duel_id, challenger_name, target_name, amount, group_id, created_at
    FROM active_duels
    WHERE status = 'pending' AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(now - DUEL_TIMEOUT_SEC).all<{
    duel_id: string; challenger_name: string; target_name: string;
    amount: number; group_id: number; created_at: number;
  }>();

  if (!duels.results.length) {
    await sendMessage(token, message.chat.id, "✅ هیچ دعوای فعالی نیست!", { reply_markup: ownerPanelKeyboard(message.from?.id) });
    return;
  }

  let text = `⚔️ <b>دعواهای فعال</b> (${duels.results.length})\n\n`;
  const keyboard: any[] = [];

  for (const d of duels.results) {
    const remaining = Math.max(0, DUEL_TIMEOUT_SEC - (now - d.created_at));
    text += `🐱 ${escapeHtml(d.challenger_name)} 🆚 ${escapeHtml(d.target_name)}\n`;
    text += `   💰 ${d.amount} MP | ⏱️ ${remaining}s | Group: ${d.group_id}\n\n`;
    keyboard.push([{ text: `❌ لغو: ${escapeHtml(d.challenger_name).slice(0, 10)} vs ${escapeHtml(d.target_name).slice(0, 10)}`, callback_data: `duelmon:cancel:${d.duel_id}${userSuffix}` }]);
  }

  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

export async function handleAudit(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0, filter = "") {
  if (!(await requireOwner(token, env, message))) return;

  // Parse an optional filter argument: /audit [reason|@username|user-id]
  if (!filter) {
    const parts = (message.text || "").split(" ").filter(Boolean);
    const arg = parts[1];
    if (arg) {
      const cleaned = toEnglishNumbers(arg);
      if (/^\d+$/.test(cleaned)) {
        filter = `u:${parseInt(cleaned, 10)}`;
      } else if (arg.startsWith("@")) {
        filter = `un:${normalizeUsername(arg)}`;
      } else {
        filter = `r:${arg.toUpperCase()}`;
      }
    }
  }

  const perPage = 10;
  const offset = page * perPage;

  let where = "";
  const binds: unknown[] = [];
  if (filter.startsWith("u:")) {
    where = `WHERE t.telegram_user_id = ?`;
    binds.push(parseInt(filter.slice(2), 10));
  } else if (filter.startsWith("un:")) {
    where = `WHERE LOWER(u.username) = LOWER(?)`;
    binds.push(filter.slice(3));
  } else if (filter.startsWith("r:")) {
    where = `WHERE t.reason = ?`;
    binds.push(filter.slice(2));
  }

  const txns = await db.prepare(`
    SELECT t.amount, t.reason, t.created_at, t.group_id, u.first_name, u.telegram_id
    FROM transactions t
    JOIN users u ON u.telegram_id = t.telegram_user_id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...binds, perPage + 1, offset).all<{
    amount: number; reason: string; created_at: number; group_id: number | null;
    first_name: string; telegram_id: number;
  }>();

  if (!txns.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هیچ تراکنشی ثبت نشده!", { reply_markup: ownerPanelKeyboard(message.from?.id) });
    return;
  }

  const hasMore = txns.results.length > perPage;
  const rows = hasMore ? txns.results.slice(0, perPage) : txns.results;

  let text = `📝 <b>آخرین تراکنش‌ها</b> (صفحه ${page + 1})`;
  if (filter) {
    const label = filter.startsWith("u:") ? `کاربر #${filter.slice(2)}` : filter.startsWith("un:") ? `@${filter.slice(3)}` : `ریدان ${filter.slice(2)}`;
    text += ` — فیلتر: <b>${label}</b>`;
  }
  text += `\n\n`;
  for (const t of rows) {
    const sign = t.amount >= 0 ? "+" : "";
    const time = formatTehranTime(t.created_at);
    const groupTag = t.group_id ? ` [گروه ${t.group_id}]` : "";
    text += `${sign}${t.amount} <code>${t.reason}</code> — ${escapeHtml(t.first_name)}${groupTag} (${time})\n`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: txnAuditKeyboard(hasMore ? page : page - 1, message.from?.id, filter) });
}

// ---------------------------------------------------------------------------
// Owner panel callback router
// ---------------------------------------------------------------------------

export async function handleOwnerPanelAction(
  token: string,
  db: D1Database,
  env: Bindings,
  callback: TelegramCallbackQuery,
  action: string,
  params: string[]
) {
  if (!callback.message || !callback.data) return;

  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const userId = callback.from.id;

  if (!isOwner(env, userId)) {
    await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
    return;
  }

  const edit = (text: string, kb?: any) => editMessageText(token, chatId, messageId, text, kb ?? ownerPanelKeyboard(userId));
  const panel = () => ownerPanelKeyboard(userId);
  const chat = callback.message.chat;
  const fake = (text: string): TelegramMessage => ({ message_id: messageId, from: callback.from, chat, text });

  if (action === "admin") {
    const sub = params[0];
    switch (sub) {
      case "stats":
        await renderStatsPage(token, db, chatId, messageId, userId);
        break;
      case "users":
        await edit("👤 <b>مدیریت کاربران</b>\n\nاز منوی زیر انتخاب کن:", usersMenuKeyboard(userId));
        break;
      case "search":
        await setBotSetting(db, ownerSearchKey(userId), "1");
        await edit("🔍 <b>جستجوی کاربر</b>\n\nنام، یوزرنیم یا آیدی کاربر را بفرست:", panel());
        break;
      case "broadcast": {
        const mode = params[1];
        if (mode === "users" || mode === "groups") {
          await setBotSetting(db, broadcastPendingKey(userId), mode);
          await edit(
            mode === "groups"
              ? "👥 <b>پیام همگانی به گروه‌ها</b>\n\nپیامت را بفرست:"
              : "👤 <b>پیام همگانی به کاربران</b>\n\nپیامت را بفرست:",
            panel()
          );
        } else {
          await edit(
            "📢 <b>پیام همگانی</b>\n\nگروه هدف را انتخاب کن:\n\nیا مستقیم:\n<code>/broadcast پیام</code> (کاربران)\n<code>/broadcast groups پیام</code> (گروه‌ها)",
            broadcastModeKeyboard(userId)
          );
        }
        break;
      }
      case "groups":
        await handleGroups(token, db, env, fake("/groups"), 0);
        break;
      case "duels":
        await handleDuels(token, db, env, fake("/duels"));
        break;
      case "events":
        await renderEventsPage(token, db, env, chatId, messageId, userId);
        break;
      case "auctions":
        await renderAuctionsPage(token, db, chatId, messageId, userId, 0);
        break;
      case "economy":
        await renderEconomyPage(token, db, chatId, messageId, userId);
        break;
      case "audit":
        await handleAudit(token, db, env, fake("/audit"), 0);
        break;
      case "config":
        await renderConfigPage(token, db, chatId, messageId, userId, 0);
        break;
      case "repair": {
        const issues = await runRepairChecks(db);
        const text = issues.length === 0
          ? "✅ دیتابیس سالمه! هیچ مشکلی پیدا نشد."
          : `🔍 <b>نتایج بررسی:</b>\n\n${issues.join("\n\n")}`;
        await edit(text, repairKeyboard(userId));
        break;
      }
      case "maintenance": {
        const current = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
        const newMode = current?.value === "1" ? "0" : "1";
        await db.prepare(`INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(newMode).run();
        const status = newMode === "1" ? "🔴 روشن" : "🟢 خاموش";
        await edit(`🔧 <b>حالت تعمیرات: ${status}</b>\n\nربات ${newMode === "1" ? "فقط برای ادمین‌ها کار می‌کنه" : "برای همه فعاله"}`, panel());
        break;
      }
      case "addpoints":
        await edit("💰 <b>افزودن امتیاز</b>\n\nاستفاده:\n<code>/addpoints @username 100</code>\n<code>/addpoints 123456789 100</code>", panel());
        break;
      case "removepoints":
        await edit("💰 <b>کسر امتیاز</b>\n\nاستفاده:\n<code>/removepoints @username 100</code>\n<code>/removepoints 123456789 100</code>", panel());
        break;
      case "resetuser":
        await edit("🔄 <b>ریست کاربر</b>\n\nاستفاده:\n<code>/resetuser @username</code>\n<code>/resetuser 123456789</code>", panel());
        break;
      case "banmenu":
        await edit("🚫 <b>بن/آنبن کاربر</b>\n\nاستفاده:\n<code>/banuser @username</code>\n<code>/unbanuser @username</code>\n<code>/banuser 123456789</code>", panel());
        break;
      case "useraudit":
        await edit("📜 <b>تراکنش‌های یک کاربر</b>\n\nاستفاده:\n<code>/audit @username</code>\n<code>/audit 123456789</code>\n<code>/audit MEOW</code>", panel());
        break;
      default:
        await edit("🐱 <b>Owner Panel</b>\n\nاز دکمه‌ها استفاده کن:", panel());
    }
    await answerCallback(token, callback.id);
    return;
  }

  if (action === "useract") {
    const sub = params[0];
    // Reset confirm flows use `useract:reset:yes:<id>`; other actions use
    // `useract:<sub>:<id>[:<amount>]`.
    const stepLike = sub === "reset" && /^(yes|no)$/.test(params[1] ?? "");
    const targetUserId = stepLike ? parseInt(params[2], 10) : parseInt(params[1], 10);
    const now = Math.floor(Date.now() / 1000);

    if (sub === "open") {
      const user = await findUserById(db, targetUserId);
      if (!user) {
        await answerCallback(token, callback.id, "❌ کاربر پیدا نشد!", true);
        return;
      }
      const txns = await getUserTransactions(db, targetUserId, 5);
      const banned = await isUserBanned(db, targetUserId);
      let text = `👤 <b>${escapeHtml(user.first_name)}</b>\n\n`;
      text += `🆔 <code>${user.telegram_id}</code>\n`;
      text += `💰 <b>${user.meow_points} MP</b>\n`;
      text += `🐾 ${user.total_meows}\n`;
      text += `🚫 ${banned ? "❌ بن شده" : "✅ فعال"}\n\n`;
      if (txns.results.length) {
        text += `📝 آخرین تراکنش‌ها:\n`;
        for (const t of txns.results.slice(0, 3)) {
          const sign = t.amount >= 0 ? "+" : "";
          text += `  ${sign}${t.amount} — ${t.reason}\n`;
        }
      }
      await editMessageText(token, chatId, messageId, text, userActionKeyboard(targetUserId, userId));
      await answerCallback(token, callback.id);
      return;
    }

    if (sub === "add" || sub === "sub") {
      const amount = parseInt(params[2], 10) || 0;
      if (amount <= 0) {
        await answerCallback(token, callback.id, "❌ مقدار نامعتبر", true);
        return;
      }
      if (sub === "add") {
        await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, targetUserId).run();
        await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
          .bind(targetUserId, amount, "OWNER_INLINE_ADD", now).run();
        await answerCallback(token, callback.id, `✅ +${amount} MP`, true);
      } else {
        await db.prepare(`UPDATE users SET meow_points = MAX(0, meow_points - ?) WHERE telegram_id = ?`).bind(amount, targetUserId).run();
        await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
          .bind(targetUserId, -amount, "OWNER_INLINE_SUB", now).run();
        await answerCallback(token, callback.id, `✅ -${amount} MP`, true);
      }
      const user = await findUserById(db, targetUserId);
      if (user) {
        await editMessageText(token, chatId, messageId,
          `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 ${user.meow_points} MP\n🐾 ${user.total_meows}`,
          userActionKeyboard(targetUserId, userId));
      }
      return;
    }

    if (sub === "ban") {
      await db.prepare(`UPDATE users SET is_banned = 1 WHERE telegram_id = ?`).bind(targetUserId).run();
      await answerCallback(token, callback.id, "🚫 کاربر بن شد!", true);
      const user = await findUserById(db, targetUserId);
      if (user) {
        await editMessageText(token, chatId, messageId,
          `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 ${user.meow_points} MP\n🚫 ❌ بن شده`,
          userActionKeyboard(targetUserId, userId));
      }
      return;
    }

    if (sub === "unban") {
      await db.prepare(`UPDATE users SET is_banned = 0 WHERE telegram_id = ?`).bind(targetUserId).run();
      await answerCallback(token, callback.id, "✅ کاربر آنبن شد!", true);
      const user = await findUserById(db, targetUserId);
      if (user) {
        await editMessageText(token, chatId, messageId,
          `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 ${user.meow_points} MP\n🚫 ✅ فعال`,
          userActionKeyboard(targetUserId, userId));
      }
      return;
    }

    if (sub === "reset") {
      const step = stepLike ? params[1] : (params[2] ?? "");
      if (step === "yes") {
        await db.prepare(`UPDATE users SET meow_points = 0, total_meows = 0 WHERE telegram_id = ?`).bind(targetUserId).run();
        await db.prepare(`DELETE FROM group_members WHERE telegram_user_id = ?`).bind(targetUserId).run();
        await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ?`).bind(targetUserId).run();
        await answerCallback(token, callback.id, "🔄 کاربر ریست شد!", true);
        const user = await findUserById(db, targetUserId);
        await editMessageText(token, chatId, messageId,
          user
            ? `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 0 MP\n🐾 0\n\n🔄 کاملاً ریست شد.`
            : "🔄 کاربر ریست شد!",
          user ? userActionKeyboard(targetUserId, userId) : panel());
        return;
      }
      if (step === "no") {
        const user = await findUserById(db, targetUserId);
        await answerCallback(token, callback.id, "انصراف");
        if (user) {
          await editMessageText(token, chatId, messageId,
            `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 ${user.meow_points} MP\n🐾 ${user.total_meows}`,
            userActionKeyboard(targetUserId, userId));
        }
        return;
      }
      // First tap → ask for confirmation.
      const user = await findUserById(db, targetUserId);
      await answerCallback(token, callback.id, "⚠️ این عمل قابل بازگشت نیست!", true);
      if (user) {
        await editMessageText(token, chatId, messageId,
          `👤 <b>${escapeHtml(user.first_name)}</b>\n\n🆔 <code>${user.telegram_id}</code>\n💰 ${user.meow_points} MP\n🐾 ${user.total_meows}`,
          userActionKeyboard(targetUserId, userId, true));
      }
      return;
    }

    if (sub === "txns") {
      const txns = await getUserTransactions(db, targetUserId, 10);
      let text = `📜 <b>تراکنش‌های کاربر</b>\n\n`;
      for (const t of txns.results) {
        const sign = t.amount >= 0 ? "+" : "";
        text += `${sign}${t.amount} — ${t.reason} (${formatTehranDate(t.created_at)})\n`;
      }
      await sendMessage(token, chatId, text || "تراکنشی یافت نشد.");
      await answerCallback(token, callback.id);
      return;
    }

    await answerCallback(token, callback.id);
    return;
  }

  if (action === "bc") {
    const sub = params[0];
    if (sub === "confirm") {
      const draft = await getBroadcastDraft(db, userId);
      if (!draft) {
        await answerCallback(token, callback.id, "❌ پیش‌نمایش منقضی شده!", true);
        return;
      }
      const mode = ((await getBotSetting(db, broadcastModeKey(userId))) ?? "users") as BroadcastMode;
      const total = await broadcastCount(db, mode);
      await saveBroadcastCursor(db, userId, { lastId: 0, sent: 0, failed: 0, total });
      await handleBroadcastContinue(token, db, env, callback);
    } else if (sub === "continue") {
      await handleBroadcastContinue(token, db, env, callback);
    } else if (sub === "stop") {
      await handleBroadcastContinue(token, db, env, callback, true);
    } else if (sub === "cancel") {
      await clearBroadcastState(db, userId);
      await edit("❌ ارسال لغو شد.", panel());
      await answerCallback(token, callback.id, "لغو شد.");
    }
    return;
  }

  if (action === "groupmgr") {
    // Reset/delete confirm flows use `groupmgr:<sub>:yes:<gid>:<page>`;
    // everything else uses `groupmgr:<sub>:<gid>:<page>`.
    const stepLike = /^(yes|no)$/.test(params[1] ?? "");
    const targetGroupId = stepLike ? parseInt(params[2], 10) : parseInt(params[1], 10);
    const currentPage = stepLike ? parseInt(params[3], 10) || 0 : parseInt(params[2], 10) || 0;
    const step = stepLike ? params[1] : "";

    if (params[0] === "page") {
      await handleGroups(token, db, env, fake("/groups"), targetGroupId);
      await answerCallback(token, callback.id);
      return;
    }

    if (params[0] === "view") {
      await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      await answerCallback(token, callback.id);
      return;
    }

    if (params[0] === "toggle") {
      const g = await db.prepare(`SELECT is_active FROM telegram_groups WHERE telegram_group_id = ?`).bind(targetGroupId).first<{ is_active: number }>();
      const newState = g?.is_active ? 0 : 1;
      await db.prepare(`UPDATE telegram_groups SET is_active = ?, updated_at = ? WHERE telegram_group_id = ?`).bind(newState, Math.floor(Date.now() / 1000), targetGroupId).run();
      await answerCallback(token, callback.id, newState ? "✅ گروه فعال شد" : "🚫 گروه غیرفعال شد", true);
      await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      return;
    }

    if (params[0] === "cooldown") {
      const options = [5, 10, 30, 60, 300];
      const g = await db.prepare(`SELECT cooldown_seconds FROM telegram_groups WHERE telegram_group_id = ?`).bind(targetGroupId).first<{ cooldown_seconds: number }>();
      const currentIndex = Math.max(0, options.indexOf(g?.cooldown_seconds ?? 30));
      const next = options[(currentIndex + 1) % options.length];
      await db.prepare(`UPDATE telegram_groups SET cooldown_seconds = ? WHERE telegram_group_id = ?`).bind(next, targetGroupId).run();
      await answerCallback(token, callback.id, `⏱️ کول‌داون: ${next}s`, true);
      await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      return;
    }

    if (params[0] === "lottery") {
      await renderGroupLotteryPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      await answerCallback(token, callback.id);
      return;
    }

    if (params[0] === "lprice" || params[0] === "lpot") {
      const delta = parseInt(params[3], 10) || 0;
      const { handleLotterySetPrice, handleLotterySetPot } = await import("./handlers");
      if (params[0] === "lprice") {
        await handleLotterySetPrice(token, db, targetGroupId, delta);
        await answerCallback(token, callback.id, `🎫 قیمت: +${delta}`, true);
      } else {
        await handleLotterySetPot(token, db, targetGroupId, delta);
        await answerCallback(token, callback.id, `💰 پات: +${delta}`, true);
      }
      await renderGroupLotteryPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      return;
    }

    if (params[0] === "refresh") {
      await handleOwnerRefreshLeaderboard(token, db, env, fake("/refreshlb"), targetGroupId);
      await answerCallback(token, callback.id, "🔄 لیدربورد رفرش شد!");
      await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
      return;
    }

    if (params[0] === "reset") {
      if (step === "yes") {
        await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(targetGroupId).run();
        await answerCallback(token, callback.id, "🔄 لیدربورد ریست شد!", true);
        await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
        return;
      }
      if (step === "no") {
        await answerCallback(token, callback.id, "انصراف");
        await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
        return;
      }
      await answerCallback(token, callback.id, "⚠️ مطمئنی؟", true);
      await editMessageText(token, chatId, messageId, `🗑️ <b>ریست لیدربورد گروه</b> <code>${targetGroupId}</code>`, groupResetConfirmKeyboard(targetGroupId, currentPage, userId));
      return;
    }

    if (params[0] === "delete") {
      if (step === "yes") {
        await db.batch([
          db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(targetGroupId),
          db.prepare(`DELETE FROM telegram_groups WHERE telegram_group_id = ?`).bind(targetGroupId),
        ]);
        await answerCallback(token, callback.id, "🗑️ گروه حذف شد!", true);
        await handleGroups(token, db, env, fake("/groups"), currentPage);
        return;
      }
      if (step === "no") {
        await answerCallback(token, callback.id, "انصراف");
        await renderGroupPage(token, db, chatId, messageId, targetGroupId, currentPage, userId);
        return;
      }
      await answerCallback(token, callback.id, "⚠️ مطمئنی؟", true);
      await editMessageText(token, chatId, messageId, `🗑️ <b>حذف گروه</b> <code>${targetGroupId}</code>`, groupDeleteConfirmKeyboard(targetGroupId, currentPage, userId));
      return;
    }

    await answerCallback(token, callback.id);
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
      await handleDuels(token, db, env, fake("/duels"));
    }
    return;
  }

  if (action === "audit") {
    const targetPage = parseInt(params[1], 10) || 0;
    const filter = params.slice(2).join(":");
    await handleAudit(token, db, env, fake("/audit"), targetPage, filter);
    await answerCallback(token, callback.id);
    return;
  }

  if (action === "repair") {
    const sub = params[0];
    if (sub === "fix") {
      await answerCallback(token, callback.id, "🔧 در حال رفع…");
      const fixed = await fixBalanceMismatches(db);
      const issues = await runRepairChecks(db);
      const text =
        `🔧 <b>رفع اختلافات</b>\n\n` +
        `✅ امتیازهای ${fixed} کاربر با تراکنش‌ها هم‌سو شد.\n\n` +
        (issues.length === 0 ? "🔍 بررسی بعدی: دیتابیس سالمه!" : `🔍 <b>باقی‌مانده:</b>\n\n${issues.join("\n\n")}`);
      await edit(text, repairKeyboard(userId));
    } else if (sub === "refreshbadge") {
      await answerCallback(token, callback.id, "🏷️ در حال بازسازی…");
      await db.prepare(`
        UPDATE users
        SET total_meows = (
          SELECT COUNT(*) FROM transactions t
          WHERE t.telegram_user_id = users.telegram_id AND t.reason = 'MEOW'
        )
      `).run();
      await db.prepare(`
        UPDATE group_members
        SET total_meows = (
          SELECT COUNT(*) FROM transactions t
          WHERE t.telegram_user_id = group_members.telegram_user_id
            AND t.group_id = group_members.telegram_group_id
            AND t.reason = 'MEOW'
        )
      `).run();
      const issues = await runRepairChecks(db);
      await edit(
        `🏷️ <b>بازسازی بج</b>\n\n✅ total_meows همه کاربران بازسازی شد.\n\n` +
        (issues.length === 0 ? "🔍 بررسی: دیتابیس سالمه!" : `🔍 <b>باقی‌مانده:</b>\n\n${issues.join("\n\n")}`),
        repairKeyboard(userId)
      );
    }
    return;
  }

  if (action === "auctionmgr") {
    const sub = params[0];
    if (sub === "page") {
      await renderAuctionsPage(token, db, chatId, messageId, userId, parseInt(params[1], 10) || 0);
      await answerCallback(token, callback.id);
      return;
    }
    if (sub === "cancel") {
      const auctionId = parseInt(params[1], 10);
      const page = parseInt(params[2], 10) || 0;
      const a = await db.prepare(`SELECT telegram_group_id FROM title_auctions WHERE id = ?`).bind(auctionId).first<{ telegram_group_id: number }>();
      if (!a) {
        await answerCallback(token, callback.id, "❌ حراج پیدا نشد.", true);
        return;
      }
      const msg = await cancelAuctionById(token, db, auctionId, a.telegram_group_id);
      await answerCallback(token, callback.id, msg, msg.startsWith("❌"));
      await renderAuctionsPage(token, db, chatId, messageId, userId, page);
      return;
    }
    return;
  }

  if (action === "cfg") {
    const sub = params[0];
    if (sub === "page") {
      await renderConfigPage(token, db, chatId, messageId, userId, parseInt(params[1], 10) || 0);
      await answerCallback(token, callback.id);
      return;
    }
    if (sub === "adj") {
      const key = params[1];
      const delta = parseFloat(toEnglishNumbers(params[2] ?? "0"));
      if (!key || !Number.isFinite(delta) || delta === 0) {
        await answerCallback(token, callback.id, "❌ مقدار نامعتبر", true);
        return;
      }
      await applyConfigDelta(token, db, callback, key, delta);
      return;
    }
    await answerCallback(token, callback.id);
    return;
  }

  await answerCallback(token, callback.id);
}

/**
 * Owner-only private-chat text hooks: a pending search query, or a broadcast
 * draft waiting for its text. Returns true when the text was consumed.
 */
export async function handleOwnerPendingText(token: string, db: D1Database, env: Bindings, message: TelegramMessage, text: string): Promise<boolean> {
  if (!message.from || !isOwner(env, message.from.id) || message.chat.type !== "private") return false;
  const ownerId = message.from.id;

  const searchFlag = await getBotSetting(db, ownerSearchKey(ownerId));
  if (searchFlag) {
    await db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(ownerSearchKey(ownerId)).run();
    await handleOwnerSearch(token, db, env, message, text);
    return true;
  }

  const pendingMode = await getBotSetting(db, broadcastPendingKey(ownerId));
  if (pendingMode === "users" || pendingMode === "groups") {
    await db.prepare(`DELETE FROM bot_settings WHERE key = ?`).bind(broadcastPendingKey(ownerId)).run();
    await saveBroadcastDraft(db, ownerId, text);
    await setBotSetting(db, broadcastModeKey(ownerId), pendingMode);
    const target = pendingMode === "groups" ? "گروه‌ها" : "کاربران";
    await sendMessage(token, message.chat.id,
      `📢 <b>پیش‌نمایش پیام همگانی (به ${target}):</b>\n\n${escapeHtml(text)}\n\nآماده ارسال؟`,
      { reply_markup: broadcastConfirmKeyboard(ownerId) }
    );
    return true;
  }

  return false;
}

export const OWNER_COMMANDS: Record<string, (token: string, db: D1Database, env: Bindings, message: TelegramMessage) => Promise<void>> = {
  "/admin": handleAdmin,
  "/broadcast": handleOwnerBroadcast,
  "/addpoints": handleOwnerAddPoints,
  "/removepoints": handleOwnerRemovePoints,
  "/resetuser": handleOwnerResetUser,
  "/userinfo": handleOwnerUserInfo,
  "/banuser": handleOwnerBanUser,
  "/unbanuser": handleOwnerUnbanUser,
  "/repair": handleOwnerRepair,
  "/refreshlb": handleOwnerRefreshLeaderboard,
  "/refreshbadge": handleOwnerRefreshBadge,
  "/config": handleOwnerConfig,
  "/groups": handleGroups,
  "/duels": handleDuels,
  "/audit": handleAudit,
};