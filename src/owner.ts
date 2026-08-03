import {
  sendMessage,
  answerCallback,
  editMessageText,
  telegramRequest,
  isGroupAdmin,
} from "./telegram";
import {
  ownerPanelKeyboard,
  userActionKeyboard,
  broadcastConfirmKeyboard,
  txnAuditKeyboard,
} from "./keyboards";
import {
  findUserByUsername,
  findUserById,
  isUserBanned,
  getUserTransactions,
  getUserGroupMemberships,
  getGlobalRank,
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
import { getActiveHokmGame, cancelHokmGame } from "./hokmLobby";
import {
  escapeHtml,
  safeParseAmount,
  normalizeUsername,
  isValidDuelId,
} from "./utils";
import {
  Bindings,
  TelegramCallbackQuery,
  TelegramMessage,
} from "./types";
import { BROADCAST_PAGE_SIZE } from "./constants";

export function isOwner(env: Bindings, userId: number | null | undefined): boolean {
  return !!userId && env.BOT_OWNER_ID === String(userId);
}

async function requireOwner(token: string, env: Bindings, message: TelegramMessage, notify = false): Promise<boolean> {
  if (isOwner(env, message.from?.id)) return true;
  if (notify) await sendMessage(token, message.chat.id, "🚫 دسترسی غیرمجاز!");
  return false;
}

const OWNER_CONFIG_SETTINGS = [
  { key: "meow_normal_min", label: "گربه‌ی عادی: حداقل امتیاز", type: "int", defaultValue: "1" },
  { key: "meow_normal_max", label: "گربه‌ی عادی: حداکثر امتیاز", type: "int", defaultValue: "300" },
  { key: "meow_normal_chance", label: "گربه‌ی عادی: احتمال", type: "float", defaultValue: "0.60" },
  { key: "meow_rare_min", label: "گربه‌ی رنگین‌کمان: حداقل امتیاز", type: "int", defaultValue: "301" },
  { key: "meow_rare_max", label: "گربه‌ی رنگین‌کمان: حداکثر امتیاز", type: "int", defaultValue: "700" },
  { key: "meow_rare_chance", label: "گربه‌ی رنگین‌کمان: احتمال", type: "float", defaultValue: "0.355" },
  { key: "meow_epic_min", label: "گربه‌ی افسانه‌ای: حداقل امتیاز", type: "int", defaultValue: "701" },
  { key: "meow_epic_max", label: "گربه‌ی افسانه‌ای: حداکثر امتیاز", type: "int", defaultValue: "1300" },
  { key: "meow_epic_chance", label: "گربه‌ی افسانه‌ای: احتمال", type: "float", defaultValue: "0.03" },
  { key: "meow_legendary_min", label: "گربه‌ی پادشاه: حداقل امتیاز", type: "int", defaultValue: "1301" },
  { key: "meow_legendary_max", label: "گربه‌ی پادشاه: حداکثر امتیاز", type: "int", defaultValue: "1600" },
  { key: "meow_legendary_chance", label: "گربه‌ی پادشاه: احتمال", type: "float", defaultValue: "0.01" },
  { key: "meow_royal_min", label: "گربه‌ی الماسی: حداقل امتیاز", type: "int", defaultValue: "1601" },
  { key: "meow_royal_max", label: "گربه‌ی الماسی: حداکثر امتیاز", type: "int", defaultValue: "2000" },
  { key: "meow_royal_chance", label: "گربه‌ی الماسی: احتمال", type: "float", defaultValue: "0.005" },
];

export async function handleAdmin(token: string, _db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message, true))) return;

  const stats = await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{ count: number }>();
  const groups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups WHERE is_active = 1`).first<{ count: number }>();
  const totalGroups = await env.DB.prepare(`SELECT COUNT(*) as count FROM telegram_groups`).first<{ count: number }>();

  const text =
    `🛡️ <b>Owner Panel</b>\n\n` +
    `👤 کاربران: <b>${stats?.count ?? 0}</b>\n` +
    `👥 گروه‌های فعال: <b>${groups?.count ?? 0}</b>\n` +
    `👥 کل گروه‌ها: <b>${totalGroups?.count ?? 0}</b>\n\n` +
    `از دکمه‌ها استفاده کن:`;

  await sendMessage(token, message.chat.id, text, { reply_markup: ownerPanelKeyboard(message.from?.id) });
}

export async function handleOwnerBroadcast(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
  const text = (message.text || "").replace(/^\/broadcast\s*/, "");
  if (!text) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده: /broadcast پیام شما");
    return;
  }

  await saveBroadcastDraft(db, message.from!.id, text);
  await sendMessage(token, message.chat.id,
    `📢 <b>پیش‌نمایش پیام همگانی:</b>\n\n${escapeHtml(text)}\n\nآماده ارسال به همه کاربران؟`,
    { reply_markup: broadcastConfirmKeyboard(message.from?.id) }
  );
}

export async function handleBroadcastConfirm(token: string, db: D1Database, env: Bindings, callback: TelegramCallbackQuery) {
  if (!callback.from || !isOwner(env, callback.from.id)) {
    await answerCallback(token, callback.id, "🚫 فقط ادمین!", true);
    return;
  }

  const draft = await getBroadcastDraft(db, callback.from.id);
  if (!draft) {
    await answerCallback(token, callback.id, "❌ پیش‌نمایش منقضی شده!", true);
    return;
  }

  await deleteBroadcastDraft(db, callback.from.id);
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
      ownerPanelKeyboard(callback.from?.id)
    );
  }
}

export async function handleOwnerAddPoints(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
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
  if (!(await requireOwner(token, env, message))) return;
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
  if (!(await requireOwner(token, env, message))) return;
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
  if (!(await requireOwner(token, env, message))) return;
  const parts = (message.text || "").split(" ").filter(Boolean);
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
  text += `💰 امتیاز: <b>${user.meow_points} MP</b>\n`;
  text += `🐾 کل میوها: <b>${user.total_meows}</b>\n`;
  text += `🏆 رتبه جهانی: <b>#${rank}</b>\n`;
  text += `⚔️ ریتینگ دعوا: <b>${user.duel_rating ?? 1000}</b>\n`;
  text += `🔥 استریک: <b>${user.daily_streak} روز</b>\n`;
  text += `📅 عضویت: <b>${createdDate}</b>\n`;
  text += `🚫 وضعیت: <b>${banned ? "❌ بن شده" : "✅ فعال"}</b>\n\n`;

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

  await sendMessage(token, message.chat.id, text, { reply_markup: userActionKeyboard(user.telegram_id, message.from?.id) });
}

export async function handleOwnerBanUser(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!(await requireOwner(token, env, message))) return;
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
  if (!(await requireOwner(token, env, message))) return;
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
  if (!(await requireOwner(token, env, message))) return;

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

  if (issues.length === 0) {
    await sendMessage(token, message.chat.id, "✅ دیتابیس سالمه! هیچ مشکلی پیدا نشد.");
  } else {
    await sendMessage(token, message.chat.id, `🔍 <b>نتایج بررسی:</b>\n\n${issues.join("\n\n")}`);
  }
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
      `⚙️ <b>تنظیمات Meow</b>\n\n${OWNER_CONFIG_SETTINGS.map((setting) => `${setting.label}: <code>${configValues[setting.key]}</code>\n<code>${setting.key}</code>`).join("\n\n")}\n\nبرای تغییر مقدار، از دستور زیر استفاده کن:\n<code>/config meow_normal_min 1</code>\n<code>/config meow_royal_chance 0.005</code>\n\nبرای دیدن مقدار فعلی یک کلید، از دستور زیر استفاده کن:\n<code>/config meow_normal_min</code>`,
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
    const parsed = parseInt(newVal, 10);
    newVal = String(Math.max(0, Number.isFinite(parsed) ? parsed : 0));
  } else {
    const parsed = parseFloat(newVal.replace(",", "."));
    let chance = Number.isFinite(parsed) ? parsed : 0;
    if (chance > 1 && chance <= 100) chance = chance / 100;
    chance = Math.max(0, Math.min(1, chance));
    newVal = String(chance);
  }

  await setBotSetting(db, key, newVal);
  await sendMessage(token, message.chat.id, `✅ ${setting.label} = ${newVal} تنظیم شد.`);
}

export async function handleGroups(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0) {
  if (!(await requireOwner(token, env, message))) return;
  const perPage = 5;
  const offset = page * perPage;
  const userSuffix = `:user:${message.from!.id}`;

  const groups = await db.prepare(`
    SELECT telegram_group_id, title, is_active,
      (SELECT COUNT(*) FROM group_members WHERE telegram_group_id = g.telegram_group_id) as member_count
    FROM telegram_groups g
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(perPage + 1, offset).all<{ telegram_group_id: number; title: string; is_active: number; member_count: number }>();

  if (!groups.results.length) {
    await sendMessage(token, message.chat.id, "🐱 هیچ گروهی پیدا نشد!", { reply_markup: ownerPanelKeyboard(message.from?.id) });
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
      { text: `📊 ${escapeHtml(g.title || "Group").slice(0, 15)}`, callback_data: `groupmgr:stats:${g.telegram_group_id}:${page}${userSuffix}` },
      { text: g.is_active ? "🚫" : "✅", callback_data: `groupmgr:toggle:${g.telegram_group_id}:${page}${userSuffix}` },
      { text: "🔄", callback_data: `groupmgr:reset:${g.telegram_group_id}:${page}${userSuffix}` },
    ]);
  }
  keyboard.push([
    { text: "⬅️ قبلی", callback_data: `groupmgr:page:${Math.max(0, page - 1)}${userSuffix}` },
    { text: "➡️ بعدی", callback_data: `groupmgr:page:${hasMore ? page + 1 : page}${userSuffix}` },
  ]);
  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

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
  `).bind(now - 60).all<{
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
    const remaining = Math.max(0, 60 - (now - d.created_at));
    text += `🐱 ${escapeHtml(d.challenger_name)} 🆚 ${escapeHtml(d.target_name)}\n`;
    text += `   💰 ${d.amount} MP | ⏱️ ${remaining}s | Group: ${d.group_id}\n\n`;
    keyboard.push([{ text: `❌ لغو: ${escapeHtml(d.challenger_name).slice(0, 10)} vs ${escapeHtml(d.target_name).slice(0, 10)}`, callback_data: `duelmon:cancel:${d.duel_id}${userSuffix}` }]);
  }

  keyboard.push([{ text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` }]);

  await sendMessage(token, message.chat.id, text, { reply_markup: { inline_keyboard: keyboard } });
}

/**
 * Cancels the active Hokm game in a group — refunds paid players via D1,
 * tells the game engine to stop (clients get the cancelled state), and edits
 * the board. Callable by the bot owner, a group admin, or the game creator.
 */
export async function cancelActiveHokmGame(
  token: string,
  db: D1Database,
  env: Bindings,
  chatId: number,
  actorId: number
): Promise<{ ok: boolean; message: string }> {
  const active = await getActiveHokmGame(db, chatId);
  if (!active) {
    return { ok: false, message: "🐱 هیچ بازی حکم فعالی در این گروه نیست." };
  }

  const admin = await isGroupAdmin(token, chatId, actorId);
  const creator = active.creator_id === actorId;
  if (!isOwner(env, actorId) && !admin && !creator) {
    return { ok: false, message: "🚫 فقط صاحب ربات، ادمین گروه یا سازندهٔ بازی می‌تونه بازی رو لغو کنه." };
  }

  // Refund every paid player via the DB (idempotent), then tell the game
  // engine to stop so clients get the cancelled state.
  await cancelHokmGame(db, active.game_id);
  try {
    const stub = env.HOKM_GAME.get(env.HOKM_GAME.idFromName(active.game_id));
    await stub.fetch("http://hokm/cancel", {
      method: "POST",
      headers: { "X-Hokm-Game-Id": active.game_id },
    });
  } catch (e) {
    console.error("HokmGame cancel error:", e);
  }

  if (active.board_msg_id) {
    await editMessageText(
      token,
      chatId,
      active.board_msg_id,
      `❌ <b>بازی حکم لغو شد</b>

🚫 مبلغ‌ها به بازیکن‌ها برگشت.`
    );
  }
  return { ok: true, message: "❌ بازی حکم لغو شد و مبلغ‌ها برگشت." };
}

export async function handleHokmCancel(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 این دستور فقط داخل گروه کار می‌کنه!");
    return;
  }
  const actorId = message.from?.id;
  if (!actorId) return;
  const res = await cancelActiveHokmGame(token, db, env, message.chat.id, actorId);
  await sendMessage(token, message.chat.id, res.message);
}

export async function handleAudit(token: string, db: D1Database, env: Bindings, message: TelegramMessage, page = 0) {
  if (!(await requireOwner(token, env, message))) return;
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
    await sendMessage(token, message.chat.id, "🐱 هیچ تراکنشی ثبت نشده!", { reply_markup: ownerPanelKeyboard(message.from?.id) });
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

  await sendMessage(token, message.chat.id, text, { reply_markup: txnAuditKeyboard(hasMore ? page : page - 1, message.from?.id) });
}

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

  if (action === "admin") {
    if (params[0] === "stats") {
      const users = await db.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>();
      const groups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE is_active = 1`).first<{ c: number }>();
      const totalGroups = await db.prepare(`SELECT COUNT(*) as c FROM telegram_groups`).first<{ c: number }>();
      const meows = await db.prepare(`SELECT SUM(total_meows) as c FROM users`).first<{ c: number }>();
      const text = `📊 <b>آمار ربات</b>\n\n👤 کاربران: ${users?.c ?? 0}\n👥 گروه‌های فعال: ${groups?.c ?? 0}\n👥 کل گروه‌ها: ${totalGroups?.c ?? 0}\n🐾 کل میوها: ${meows?.c ?? 0}`;
      await editMessageText(token, chatId, messageId, text, ownerPanelKeyboard(userId));
    } else if (params[0] === "maintenance") {
      const current = await db.prepare(`SELECT value FROM bot_settings WHERE key = 'maintenance'`).first<{ value: string }>();
      const newMode = current?.value === "1" ? "0" : "1";
      await db.prepare(`INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(newMode).run();
      const status = newMode === "1" ? "🔴 روشن" : "🟢 خاموش";
      await editMessageText(token, chatId, messageId, `🔧 <b>حالت تعمیرات: ${status}</b>\n\nربات ${newMode === "1" ? "فقط برای ادمین‌ها کار می‌کنه" : "برای همه فعاله"}`, ownerPanelKeyboard(userId));
    } else if (params[0] === "broadcast") {
      await editMessageText(token, chatId, messageId, `📢 <b>پیام همگانی</b>\n\nبرای ارسال پیام به همه کاربران، از دستور زیر استفاده کن:\n\n<code>/broadcast پیام شما</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "addpoints" || params[0] === "removepoints") {
      await editMessageText(token, chatId, messageId, `💰 <b>${params[0] === "addpoints" ? "افزودن" : "کسر"} امتیاز</b>\n\nاستفاده:\n<code>/${params[0]} @username 100</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "resetuser") {
      await editMessageText(token, chatId, messageId, `🔄 <b>ریست کاربر</b>\n\nاستفاده:\n<code>/resetuser @username</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "userinfo") {
      await editMessageText(token, chatId, messageId, `👤 <b>اطلاعات کاربر</b>\n\nاستفاده:\n<code>/userinfo @username</code>\nیا\n<code>/userinfo 123456789</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "banmenu") {
      await editMessageText(token, chatId, messageId, `🚫 <b>بن/آنبن کاربر</b>\n\nاستفاده:\n<code>/banuser @username</code>\n<code>/unbanuser @username</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "repair") {
      await editMessageText(token, chatId, messageId, `🔍 <b>بررسی دیتابیس</b>\n\nاستفاده:\n<code>/repair</code>`, ownerPanelKeyboard(userId));
    } else if (params[0] === "config") {
      const fakeMessage: TelegramMessage = { message_id: messageId, from: callback.from, chat: callback.message.chat, text: "/config" };
      await handleOwnerConfig(token, db, env, fakeMessage);
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
    const subAction = params[0];
    const targetUserId = parseInt(params[1], 10);
    const amount = parseInt(params[2], 10) || 0;
    const now = Math.floor(Date.now() / 1000);

    if (subAction === "add") {
      await db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(amount, targetUserId).run();
      await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
        .bind(targetUserId, amount, "OWNER_INLINE_ADD", now).run();
      await answerCallback(token, callback.id, `✅ +${amount} MP`, true);
    } else if (subAction === "sub") {
      await db.prepare(`UPDATE users SET meow_points = MAX(0, meow_points - ?) WHERE telegram_id = ?`).bind(amount, targetUserId).run();
      await db.prepare(`INSERT INTO transactions (telegram_user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)`)
        .bind(targetUserId, -amount, "OWNER_INLINE_SUB", now).run();
      await answerCallback(token, callback.id, `✅ -${amount} MP`, true);
    } else if (subAction === "ban") {
      await db.prepare(`UPDATE users SET is_banned = 1 WHERE telegram_id = ?`).bind(targetUserId).run();
      await answerCallback(token, callback.id, "🚫 کاربر بن شد!", true);
    } else if (subAction === "unban") {
      await db.prepare(`UPDATE users SET is_banned = 0 WHERE telegram_id = ?`).bind(targetUserId).run();
      await answerCallback(token, callback.id, "✅ کاربر آنبن شد!", true);
    } else if (subAction === "reset") {
      await db.prepare(`UPDATE users SET meow_points = 0, total_meows = 0, daily_streak = 0, last_daily_at = NULL WHERE telegram_id = ?`).bind(targetUserId).run();
      await db.prepare(`DELETE FROM group_members WHERE telegram_user_id = ?`).bind(targetUserId).run();
      await db.prepare(`DELETE FROM transactions WHERE telegram_user_id = ?`).bind(targetUserId).run();
      await answerCallback(token, callback.id, "🔄 کاربر ریست شد!", true);
    } else if (subAction === "txns") {
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
        `⚔️ ${user.duel_rating ?? 1000} | 🐾 ${user.total_meows} | 🔥 ${user.daily_streak} روز`;
      await editMessageText(token, chatId, messageId, text, userActionKeyboard(targetUserId, userId));
    }
    return;
  }

  if (action === "bc") {
    if (params[0] === "confirm") {
      await handleBroadcastConfirm(token, db, env, callback);
    } else if (params[0] === "cancel") {
      await deleteBroadcastDraft(db, callback.from.id);
      await editMessageText(token, chatId, messageId, "❌ ارسال لغو شد.", ownerPanelKeyboard(userId));
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
  "/refreshbadge": handleOwnerRefreshBadge,
  "/config": handleOwnerConfig,
  "/groups": handleGroups,
  "/duels": handleDuels,
  "/audit": handleAudit,
  "/hokmcancel": handleHokmCancel,
};


