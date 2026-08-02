import {
  sendMessage,
  answerCallback,
  editMessageText,
  deleteMessage,
  isGroupAdmin,
  telegramRequest,
  setMyCommands,
} from "./telegram";
import {
  mainMenuKeyboard,
  postMeowKeyboard,
  groupSettingsKeyboard,
  treasuryKeyboard,
  clanKeyboard,
  lotteryKeyboard,
  duelKeyboard,
  hokmSeatKeyboard,
  hokmBoardKeyboard,
  eventInlineKeyboard,
} from "./keyboards";
import {
  ensureUser,
  ensureGroup,
  deactivateGroup,
  getGroupSettings,
  getGroupLotteryConfig,
  getUserStats,
  getGroupMemberBalance,
  getGlobalRank,
  getGroupRank,
  getGroupDailyLeaderboard,
  findUserByUsername,
  distributeGroupTax,

  setGroupLotteryTicketPrice,
  setGroupLotteryPot,
  purchaseLotteryTickets,
  drawLotteryRound,
  allocatePendingLotteryTickets,
  getLotteryParticipants,
  getRecentGroupTreasuryTransactions,
  getGroupClanByName,
  getUserClan,
  createGroupClan,
  joinClan,
  leaveClan,
  getClanMembers,
  getBotSetting,
  applyPayTransfer,
  getDuelRating,
  getDuelLeaderboard,
} from "./database";
import {
  createDuel,
  getDuel,
  deleteDuel,
  findOpenDuelAgainst,
  scheduleDuelTimeout,
  computeElo,
} from "./duel";
import {
  escapeHtml,
  formatDuration,
  safeParseAmount,
  normalizeUsername,
  isMeow,
  generateDuelId,
  isValidDuelId,
  parseEventCommand,
} from "./utils";
import {
  createHokmGame,
  getHokmGame,
  getActiveHokmGame,
  addHokmPlayer,
  removeHokmPlayer,
  refundHokmEscrow,
  getHokmPlayers,
  setHokmGameBoardMsg,
  setHokmGamePlaying,
  cancelHokmGame,
  generateHokmId,
  isValidHokmGameId,
} from "./hokmLobby";
import { handleAdmin, handleOwnerPanelAction } from "./owner";
import {
  Bindings,
  DuelState,
  RequestContext,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramChat,
  TelegramChatMemberUpdated,
  TelegramUser,
} from "./types";
import {
  DUEL_TIMEOUT_SEC,
  DICE_COOLDOWN_SEC,
  HOKM_LOBBY_TIMEOUT_SEC,
} from "./constants";

const MEOW_TIERS = [
  {
    id: 1,
    key: "normal",
    label: "گربه‌ی عادی",
    message: (points: number) => `🐱 میو!\n+${points} امتیاز`,
    defaultMinPoints: 1,
    defaultMaxPoints: 300,
    defaultChance: 0.60,
  },
  {
    id: 2,
    key: "rare",
    label: "گربه‌ی رنگین‌کمان",
    message: (points: number) => `🌈 گربه‌ی رنگین‌کمان پیدا شد!\n\n+${points} امتیاز`,
    defaultMinPoints: 301,
    defaultMaxPoints: 700,
    defaultChance: 0.355,
  },
  {
    id: 3,
    key: "epic",
    label: "گربه‌ی افسانه‌ای",
    message: (points: number) => `✨ گربه‌ی افسانه‌ای تو را دید!\n\n+${points} امتیاز`,
    defaultMinPoints: 701,
    defaultMaxPoints: 1300,
    defaultChance: 0.03,
  },
  {
    id: 4,
    key: "legendary",
    label: "گربه‌ی پادشاه",
    message: (points: number) => `👑 گربه‌ی پادشاه به تو برکت داد!\n\n+${points} امتیاز`,
    defaultMinPoints: 1301,
    defaultMaxPoints: 1600,
    defaultChance: 0.01,
  },
  {
    id: 5,
    key: "royal",
    label: "گربه‌ی الماسی",
    message: (points: number) => `💎 گربه‌ی الماسی درخشید!\n\n+${points} امتیاز`,
    defaultMinPoints: 1601,
    defaultMaxPoints: 2000,
    defaultChance: 0.005,
  },
];

const BADGES = [
  { min: 800, title: "گربه‌ی پادشاه" },
  { min: 400, title: "گربه‌ی افسانه‌ای" },
  { min: 150, title: "گربه‌ی قهرمان" },
  { min: 50, title: "گربه‌ی کنجکاو" },
  { min: 0, title: "گربه‌ی تازه‌کار" },
];

function getBadgeTitle(totalMeows: number) {
  return BADGES.find((badge) => totalMeows >= badge.min)?.title ?? "گربه‌ی تازه‌کار";
}

function getMeowTaxRateByRank(rank: number): number {
  if (rank === 1) return 0.25;
  if (rank === 2) return 0.15;
  if (rank === 3) return 0.05;
  return 0;
}

type AwardMeowResult =
  | { points: number; basePoints: number; eventBonus: number; tier: MeowTierConfig; taxAmount: number; taxRate: number; cooldown: false }
  | { cooldown: number };

type MeowTierConfig = {
  id: number;
  key: string;
  label: string;
  message: (points: number) => string;
  minPoints: number;
  maxPoints: number;
  chance: number;
};

type ActiveEvent = {
  title: string;
  description: string;
  start_at: number;
  end_at: number;
  bonus_multiplier: number;
} | null;

async function getMeowTierSettings(db: D1Database) {
  const tiers = [] as MeowTierConfig[];

  for (const tier of MEOW_TIERS) {
    const minSetting = await getBotSetting(db, `meow_${tier.key}_min`);
    const maxSetting = await getBotSetting(db, `meow_${tier.key}_max`);
    const chanceSetting = await getBotSetting(db, `meow_${tier.key}_chance`);
    const minPoints = minSetting !== null && minSetting !== "" && Number.isFinite(Number(minSetting)) ? Number(minSetting) : tier.defaultMinPoints;
    const maxPoints = maxSetting !== null && maxSetting !== "" && Number.isFinite(Number(maxSetting)) ? Number(maxSetting) : tier.defaultMaxPoints;
    const chance = chanceSetting !== null && chanceSetting !== "" && Number.isFinite(Number(chanceSetting)) ? Number(chanceSetting) : tier.defaultChance;
    const boundedMin = Math.max(0, Math.min(minPoints, maxPoints));
    const boundedMax = Math.max(boundedMin, maxPoints);
    tiers.push({
      ...tier,
      minPoints: boundedMin,
      maxPoints: boundedMax,
      chance: Math.max(0, Math.min(1, chance)),
    });
  }

  return tiers;
}

const ACTIVE_EVENT_CACHE_KEY = "active_event";

async function getActiveEvent(db: D1Database, env: Bindings): Promise<ActiveEvent> {
  const now = Math.floor(Date.now() / 1000);
  if (env.CACHE) {
    const cached = await env.CACHE.get(ACTIVE_EVENT_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ActiveEvent;
      } catch {
        // ignore invalid cache payload
      }
    }
  }

  const row = await db
    .prepare(`SELECT title, description, start_at, end_at, bonus_multiplier FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .bind(now, now)
    .first<{ title: string; description: string; start_at: number; end_at: number; bonus_multiplier: number }>();

  const activeEvent = row ? row : null;
  if (env.CACHE) {
    await env.CACHE.put(ACTIVE_EVENT_CACHE_KEY, JSON.stringify(activeEvent), { expirationTtl: 30 });
  }
  return activeEvent;
}

async function invalidateActiveEventCache(env: Bindings) {
  if (!env.CACHE) return;
  await env.CACHE.delete(ACTIVE_EVENT_CACHE_KEY);
}

function adjustMeowTierChancesForSpecialUser(
  tiers: MeowTierConfig[],
  userId: number,
  specialUserId?: string | null
): MeowTierConfig[] {
  if (!specialUserId || String(userId) !== String(specialUserId)) return tiers;

  const boost = 0.20;
  const adjusted = tiers.map((tier) => ({ ...tier }));
  const lowTier = adjusted[0];
  let totalBoost = 0;

  for (let i = 1; i < adjusted.length; i += 1) {
    const bonus = Math.min(boost, 1 - adjusted[i].chance);
    adjusted[i].chance += bonus;
    totalBoost += bonus;
  }

  lowTier.chance = Math.max(0, lowTier.chance - totalBoost);
  return adjusted;
}

function pickMeowTier(tiers: MeowTierConfig[]) {
  const total = tiers.reduce((sum, tier) => sum + tier.chance, 0);
  if (total <= 0) return tiers[0];

  const roll = Math.random() * total;
  let cumulative = 0;

  for (const tier of tiers) {
    cumulative += tier.chance;
    if (roll < cumulative) return tier;
  }

  return tiers[tiers.length - 1];
}

function formatLotteryStatusText(settings: {
  lotteryEnabled: boolean;
  lotteryTicketPrice: number;
  lotteryPot: number;
  lotteryTicketSales: number;
  meowTaxPool: number;
  duelTaxPool: number;
}) {
  return (
    `🎟️ <b>لاتاری گروه</b>

` +
    `🟢 وضعیت: <b>${settings.lotteryEnabled ? "فعّال" : "غیرفعال"}</b>
` +
    `💵 قیمت هر بلیت: <b>${settings.lotteryTicketPrice} MP</b>
` +
    `💰 پات فعلی: <b>${settings.lotteryPot} MP</b>
` +
    `🎫 فروش بلیت: <b>${settings.lotteryTicketSales} MP</b>
` +
    `📊 مالیات میو: <b>${settings.meowTaxPool} MP</b>
` +
    `📊 مالیات دعوا: <b>${settings.duelTaxPool} MP</b>

` +
    `🔢 هر بلیت شامل 6 عدد یکتا از 1 تا 49 است.
` +
    `🎁 ساختار جوایز:
` +
    `• 3 عدد درست: <b>20%</b> از پات
` +
    `• 4 عدد درست: <b>35%</b> از پات
` +
    `• 5 عدد درست: <b>50%</b> از پات
` +
    `• 6 عدد درست: <b>100%</b> از پات
` +
    `• اگر چند نفر در یک سطح برنده شوند، جایزه بینشان به‌صورت مساوی تقسیم می‌شود.

` +
    `📈 شانس تقریبی:
` +
    `• 3 عدد: ~5%
` +
    `• 4 عدد: ~3%
` +
    `• 5 عدد: ~1%
` +
    `• 6 عدد: ~0.01%

` +
    `✨ برای خرید سریع: <b>/lottery buy 1</b> یا <b>/lottery buy 3</b>
` +
    `✨ همین کار را با <b>/gamble</b> یا <b>قمار</b> هم می‌توانی انجام دهی.
` +
    `🧾 بعد از خرید، شماره بلیت‌های شما نمایش داده می‌شود و در زمان قرعه‌کشی برندگان مشخص می‌شوند.`
  );
}

export async function getLotteryStatusText(db: D1Database, groupId: number, userId: number) {
  const settings = await getGroupLotteryConfig(db, groupId);
  await allocatePendingLotteryTickets(db, groupId);

  const round = await db
    .prepare(`SELECT id, round_number, ticket_price FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<{ id: number; round_number: number; ticket_price: number }>();

  if (!round) {
    return `🎫 <b>هیچ دور بازی فعالی وجود ندارد.</b>\n\nوقتی دور جدید شروع شود، می‌توانی بلیت بخری و شماره‌های خود را ببینی.`;
  }

  const participants = await getLotteryParticipants(db, groupId);
  const totalTickets = participants.reduce((sum, participant) => sum + participant.ticket_count, 0);

  const participantLines = participants.slice(0, 8).map((participant) => {
    const displayName = escapeHtml(participant.username || participant.first_name || `کاربر ${participant.telegram_user_id}`);
    return `• ${displayName}: <b>${participant.ticket_count}</b> بلیت`;
  });

  const userPending = await db
    .prepare(`SELECT lottery_bonus_tickets FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(groupId, userId)
    .first<{ lottery_bonus_tickets: number }>();

  const pendingText = userPending && userPending.lottery_bonus_tickets > 0
    ? `\n🎁 بلیت‌های رایگان در انتظار شما: <b>${userPending.lottery_bonus_tickets}</b>`
    : "";

  return (
    `🎟️ <b>وضعیت لاتاری</b>\n\n` +
    `🔢 دور فعال: <b>${round.round_number}</b>\n` +
    `💵 قیمت هر بلیت: <b>${round.ticket_price} MP</b>\n` +
    `💰 پات جاری: <b>${settings.lotteryPot} MP</b>\n` +
    `🎫 تعداد بلیت‌های این دور: <b>${totalTickets}</b>\n` +
    `👥 شرکت‌کنندگان: <b>${participants.length}</b>\n` +
    `${pendingText}\n\n` +
    (participantLines.length > 0
      ? `📌 <b>برترین شرکت‌کنندگان</b>:\n${participantLines.join("\n")}${participants.length > 8 ? `\n… و ${participants.length - 8} شرکت‌کننده دیگر` : ""}`
      : `📌 هنوز هیچ بلیتی خریداری نشده است.\n`) +
    `\n🎯 برای دیدن بلیت‌های خود، از دکمه 'بلیت‌های من' استفاده کن.`
  );
}

export async function awardMeow(
  db: D1Database,
  user: TelegramUser,
  chat: TelegramChat,
  vipUserId?: string | null
): Promise<AwardMeowResult> {
  const now = Math.floor(Date.now() / 1000);
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  await ensureUser(db, user);

  let tiers = await getMeowTierSettings(db);
  tiers = adjustMeowTierChancesForSpecialUser(tiers, user.id, vipUserId);
  const tier = pickMeowTier(tiers);

  const activeEvent = await db
    .prepare(`SELECT bonus_multiplier FROM events WHERE is_active = 1 AND start_at <= ? AND end_at >= ? ORDER BY created_at DESC LIMIT 1`)
    .bind(now, now)
    .first<{ bonus_multiplier: number }>();
  const eventBonus = activeEvent?.bonus_multiplier && activeEvent.bonus_multiplier > 1 ? activeEvent.bonus_multiplier : 1;
  const rawPoints = tier.minPoints === tier.maxPoints
    ? tier.minPoints
    : Math.floor(Math.random() * (tier.maxPoints - tier.minPoints + 1)) + tier.minPoints;
  const basePoints = rawPoints;
  const effectivePoints = Math.max(0, Math.round(basePoints * eventBonus));

  if (isGroup) {
    const settings = await getGroupSettings(db, chat.id);
    if (!settings.enabled) return { cooldown: 0 };
    await ensureGroup(db, chat);

    const groupRank = await getGroupRank(db, chat.id, user.id);
    const taxRate = getMeowTaxRateByRank(groupRank);
    const taxAmount = Math.floor(effectivePoints * taxRate);
    const netPoints = Math.max(0, effectivePoints - taxAmount);

    const result = await db.prepare(`
      INSERT INTO group_members (
        telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at, lottery_bonus_tickets, lottery_meow_credit
      ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 1)
      ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        meow_points = group_members.meow_points + excluded.meow_points,
        total_meows = group_members.total_meows + 1,
        last_meow_at = excluded.last_meow_at,
        lottery_bonus_tickets = group_members.lottery_bonus_tickets + CAST((group_members.lottery_meow_credit + 1) / 6 AS INTEGER),
        lottery_meow_credit = (group_members.lottery_meow_credit + 1) % 6
      WHERE group_members.last_meow_at IS NULL OR group_members.last_meow_at < ?
    `).bind(chat.id, user.id, user.username ?? null, user.first_name, netPoints, now, now - settings.cooldown).run();

    if (result.meta.changes === 0) {
      const row = await db.prepare(`SELECT last_meow_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
        .bind(chat.id, user.id).first<{ last_meow_at: number }>();
      const remaining = row ? Math.max(0, settings.cooldown - (now - row.last_meow_at)) : settings.cooldown;
      return { cooldown: remaining };
    }

    const operations = [
      db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(netPoints, user.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(user.id, chat.id, netPoints, "MEOW", now),
    ];

    if (taxAmount > 0) {
      operations.push(
        db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(user.id, chat.id, -taxAmount, "MEOW_TAX", now)
      );
      await distributeGroupTax(db, chat.id, "meow", taxAmount);
    }

    await db.batch(operations);

    return { points: netPoints, basePoints, eventBonus, tier, taxAmount, taxRate, cooldown: false };
  }

  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ?, total_meows = total_meows + 1 WHERE telegram_id = ?`).bind(effectivePoints, user.id),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(user.id, null, effectivePoints, "MEOW", now),
  ]);

  return { points: effectivePoints, basePoints, eventBonus, tier, taxAmount: 0, taxRate: 0, cooldown: false };
}

export async function handleStart(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const activeEvent = await getActiveEvent(db, env);

  await setMyCommands(token, [
    { command: "start", description: "شروع کار با ربات" },
    { command: "me", description: "پروفایل من" },
    { command: "top", description: "رتبه‌بندی گروه" },
    { command: "global", description: "رتبه جهانی" },
    { command: "daily", description: "جایزه روزانه" },
    { command: "pay", description: "انتقال امتیاز" },
    { command: "lottery", description: "لاتاری / قمار گروه" },
    { command: "gamble", description: "قمار در گروه" },
    { command: "settings", description: "تنظیمات گروه" },
  ]);

  const isPm = message.chat.type === "private";
  let text = isPm
    ? `🐱 سلام <b>${escapeHtml(message.from.first_name)}</b>!\n\nبه دنیای Meow Points خوش اومدی! 🎉\n\nهر وقت توی گروه بنویسی <b>میو</b> یا <b>meow</b>، می‌تونی امتیاز جمع کنی و با بقیه رقابت کنی. ✨\n\n⚡ سریع‌ترین راه‌ها:\n• در گروه <b>میو</b> بگو\n• از دکمه‌های تعاملی استفاده کن\n• با /pay یا /gamble امتیازها رو بین دوستان منتقل کن\n\nبرای قمار، از <b>/lottery</b> یا <b>قمار</b> استفاده کن.\nبرای شروع، یکی از دکمه‌ها رو انتخاب کن:`
    : `🐱 سلام گروه!\n\nمنوهای من با دکمه‌های شیشه‌ای کار می‌کنن و هر لحظه بهت کمک می‌کنن امتیازها رو مدیریت کنی. برای قمار یا لاتاری، از دکمه <b>🎰 لاتاری / قمار</b> استفاده کن.\nبرای دیدن امکانات بیشتر، روی یکی از دکمه‌های زیر کلیک کن.`;

  if (activeEvent) {
    const remainingTime = activeEvent.end_at > Math.floor(Date.now() / 1000) ? formatDuration(activeEvent.end_at - Math.floor(Date.now() / 1000)) : "لحظاتی";
    text += `\n\n🎯 رویداد فعال: <b>${escapeHtml(activeEvent.title)}</b>\n` +
      `${escapeHtml(activeEvent.description)}\n` +
      `💥 ضریب: x${activeEvent.bonus_multiplier}\n` +
      `⏳ تا پایان: <b>${remainingTime}</b>`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard(message.from?.id) });
}

export async function handleMe(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const stats = await getUserStats(db, message.from.id);
  const activeEvent = await getActiveEvent(db, env);
  const rank = await getGlobalRank(db, message.from.id);
  const duelRating = await getDuelRating(db, message.from.id);

  let text =
    `🐱 پروفایل <b>${escapeHtml(message.from.first_name)}</b>\n\n` +
    `💰 امتیاز فعلی: <b>${stats?.meow_points ?? 0} MP</b>\n` +
    `🐾 کل میوها: <b>${stats?.total_meows ?? 0}</b>\n` +
    `⚔️ ریتینگ دعوا: <b>${duelRating}</b>\n` +
    `🏆 رتبه جهانی: <b>#${rank}</b>\n`;

  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    const groupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
    const groupRank = await getGroupRank(db, message.chat.id, message.from.id);
    const badgeTitle = getBadgeTitle(stats?.total_meows ?? 0);
    text += `\n💳 موجودی این گروه: <b>${groupBalance} MP</b>\n`;
    text += `🏅 رتبه گروه: <b>#${groupRank}</b>\n`;
    text += `🎖️ نشان: <b>${badgeTitle}</b>\n`;
  }

  text += `\n✨ برای رشد بیشتر، توی گروه‌ها میو بگو و از /daily هم جایزه بگیر.`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard(message.from?.id) });
}

export async function handleHistory(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;

  const rows = await db
    .prepare(`
      SELECT amount, reason, group_id, created_at
      FROM transactions
      WHERE telegram_user_id = ?
      ORDER BY created_at DESC
      LIMIT 8
    `)
    .bind(message.from.id)
    .all<{ amount: number; reason: string; group_id: number | null; created_at: number }>();

  if (!rows.results.length) {
    await sendMessage(token, message.chat.id, "📜 هنوز فعالیتی ثبت نشده.");
    return;
  }

  const lines = rows.results.map((row) => {
    const label = row.reason === "MEOW" ? "میو" : row.reason === "DAILY_REWARD" ? "جایزه روزانه" : row.reason;
    const scope = row.group_id ? ` | گروه ${row.group_id}` : " | جهانی";
    return `• ${label}: ${row.amount > 0 ? `+${row.amount}` : row.amount} MP${scope}`;
  });

  await sendMessage(token, message.chat.id, `📜 <b>تاریخچه اخیر</b>\n\n${lines.join("\n")}\n\n✨ برای دیدن خلاصه‌ی سریع‌تر، از منوی اصلی هم استفاده کن.`);
}

export async function handleAddEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد اضافه کند.");
    return;
  }

  const parsed = parseEventCommand(message.text || "");
  if (!parsed) {
    await sendMessage(
      token,
      message.chat.id,
      `📝 <b>Usage:</b> \n<code>/add event {name} {multiplier} {minutes}</code>\n\nExample:\n<code>/add event FlashSale 2 60</code>`
    );
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`
      INSERT INTO events (title, description, start_at, end_at, is_active, bonus_multiplier, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `)
    .bind(parsed.title, parsed.description, parsed.startAt, parsed.endAt, parsed.bonusMultiplier, now)
    .run();

  await sendMessage(token, message.chat.id, `✅ رویداد جدید ذخیره شد.\n\n🎯 ${escapeHtml(parsed.title)}\n${escapeHtml(parsed.description)}\n💥 ضریب: x${parsed.bonusMultiplier}`);
  await invalidateActiveEventCache(env);
}

export async function handleEditEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد را ویرایش کند.");
    return;
  }

  const parsed = parseEventCommand(message.text || "");
  if (!parsed) {
    await sendMessage(
      token,
      message.chat.id,
      `📝 <b>استفاده:</b> \n<code>/editevent {name} {multiplier} {minutes}</code>\n\nمثال:\n<code>/editevent FlashSale 2 60</code>`
    );
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(`SELECT id FROM events WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`).first<{ id: number }>();
  if (!existing) {
    await sendMessage(token, message.chat.id, "❌ رویداد فعالی برای ویرایش وجود ندارد.");
    return;
  }

  await db
    .prepare(`UPDATE events SET title = ?, description = ?, start_at = ?, end_at = ?, bonus_multiplier = ?, created_at = ? WHERE id = ?`)
    .bind(parsed.title, parsed.description, parsed.startAt, parsed.endAt, parsed.bonusMultiplier, now, existing.id)
    .run();

  await sendMessage(token, message.chat.id, `✅ رویداد فعلی به‌روزرسانی شد.\n\n🎯 ${escapeHtml(parsed.title)}\n${escapeHtml(parsed.description)}\n💥 ضریب: x${parsed.bonusMultiplier}`);
  await invalidateActiveEventCache(env);
}

export async function handleDeleteEvent(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (!message.from) return;

  if (env.BOT_OWNER_ID !== String(message.from.id)) {
    await sendMessage(token, message.chat.id, "🚫 فقط صاحب ربات می‌تواند رویداد را حذف کند.");
    return;
  }

  await db.prepare(`UPDATE events SET is_active = 0 WHERE is_active = 1`).run();
  await invalidateActiveEventCache(env);
  await sendMessage(token, message.chat.id, "✅ رویداد فعلی غیرفعال شد.");
}

export async function handleEvents(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - 86400;
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  const groupId = isGroup ? message.chat.id : null;
  const isOwner = message.from?.id !== undefined && env.BOT_OWNER_ID === String(message.from.id);

  const rows = await db
    .prepare(`
      SELECT COUNT(*) as total_meows, SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END) as today_points
      FROM transactions
      WHERE reason = 'MEOW' AND (${groupId === null ? "group_id IS NULL" : "group_id = ?"})
    `)
    .bind(dayStart, ...(groupId === null ? [] : [groupId]))
    .first<{ total_meows: number; today_points: number }>();

  const activeEvent = await getActiveEvent(db, env);

  const scopeLabel = isGroup ? "این گروه" : "سراسر ربات";
  const eventText =
    `🎉 <b>رویدادهای ${scopeLabel}</b>\n\n` +
    `⚡ امتیازهای امروز: <b>${rows?.today_points ?? 0} MP</b>\n` +
    `🐾 میوهای امروز: <b>${rows?.total_meows ?? 0}</b>\n`;

  const keyboard = eventInlineKeyboard(isOwner, !!activeEvent, message.from?.id);
  if (activeEvent) {
    const remainingTime = activeEvent.end_at > now ? formatDuration(activeEvent.end_at - now) : "لحظاتی";
    const eventLine =
      `🎯 رویداد فعلی: <b>${escapeHtml(activeEvent.title)}</b>\n` +
      `${escapeHtml(activeEvent.description)}\n` +
      `💥 ضریب: x${activeEvent.bonus_multiplier}\n` +
      `⏳ تا پایان: <b>${remainingTime}</b>`;
    await sendMessage(token, message.chat.id, `${eventText}${eventLine}`, { reply_markup: keyboard });
    return;
  }

  await sendMessage(token, message.chat.id, `${eventText}✨ فعلاً رویداد فعالی وجود ندارد.`, { reply_markup: keyboard });
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

  const ownRank = await getGroupRank(db, message.chat.id, message.from?.id ?? 0);
  const ownLine = message.from ? `\n\n🏅 رتبه شما در گروه: <b>#${ownRank}</b>` : "";

  let text = `🏆 <b>Meow Leaderboard</b>\n\n${formatLeaderboard(results.results)}${ownLine}`;

  const daily = await getGroupDailyLeaderboard(db, message.chat.id, 5);
  if (daily.results.length) {
    text += `\n\n📅 <b>Daily Group Leaderboard</b>\n` + daily.results.map((row, index) => `• ${index + 1}. ${escapeHtml(row.first_name)} — ${row.today_points} MP`).join("\n");
  }

  await sendMessage(token, message.chat.id, text);
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

export async function handleDuelRank(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  await ensureUser(db, message.from);

  const leaderboard = await getDuelLeaderboard(db, 10);
  const medals = ["🥇", "🥈", "🥉"];

  let text = `⚔️ <b>رتبه‌بندی دعوا</b>\n\n`;
  if (leaderboard.results.length) {
    text += leaderboard.results
      .map((u, i) => {
        const medal = medals[i] || `${i + 1}.`;
        const name = escapeHtml(u.first_name || u.username || "Unknown Cat");
        return `${medal} ${name} — <b>${u.duel_rating}</b>`;
      })
      .join("\n");
  } else {
    text += "🐱 هنوز کسی دعوا نکرده!";
  }

  const myRating = await getDuelRating(db, message.from.id);
  text += `\n\n⚔️ ریتینگ شما: <b>${myRating}</b>\n\n✨ برای افزایش ریتینگ، توی گروه ریپلای کن و بنویس:\n<code>دعوا 500</code>`;

  await sendMessage(token, message.chat.id, text, { reply_markup: mainMenuKeyboard(message.from?.id) });
}

export async function handleTreasury(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 خزانه گروه فقط داخل گروه قابل دسترس است!");
    return;
  }

  await ensureGroup(db, message.chat);
  const settings = await getGroupSettings(db, message.chat.id);
  const txns = await getRecentGroupTreasuryTransactions(db, message.chat.id, 5);

  let text = `🏦 <b>خزانه گروه</b>\n\n`;
  text += `💰 موجودی خزانه: <b>${settings.treasuryBalance} MP</b>\n\n`;
  if (txns.results.length) {
    text += `📝 آخرین تراکنش‌ها:\n` + txns.results.map((txn) => {
      const sign = txn.amount >= 0 ? "+" : "";
      const userLabel = txn.telegram_user_id ? ` user ${txn.telegram_user_id}` : "";
      return `• ${sign}${txn.amount} MP — ${escapeHtml(txn.reason)}${userLabel}`;
    }).join("\n");
  } else {
    text += `✨ هنوز تراکنشی برای خزانه ثبت نشده.`;
  }

  await sendMessage(token, message.chat.id, text, { reply_markup: treasuryKeyboard(settings.treasuryBalance, message.from?.id) });
}

export async function handleClan(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 قبیله فقط در گروه قابل استفاده است!");
    return;
  }

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length >= 3 && parts[1].toLowerCase() === "create") {
    const clanName = parts.slice(2).join(" ").trim();
    if (!clanName) {
      await sendMessage(token, message.chat.id, "🐱 نام قبیله معتبر نیست.");
      return;
    }
    const clanId = await createGroupClan(db, message.chat.id, clanName, message.from.id);
    if (!clanId) {
      await sendMessage(token, message.chat.id, "🐱 قبلاً قبیله‌ای با این نام وجود دارد یا شما در قبیله دیگری هستید.");
      return;
    }
    await joinClan(db, clanId, message.from.id);
    await sendMessage(token, message.chat.id, `✅ قبیله <b>${escapeHtml(clanName)}</b> ایجاد شد و شما مالک آن هستید!`, { reply_markup: clanKeyboard(true, message.from?.id) });
    return;
  }

  if (parts.length >= 3 && parts[1].toLowerCase() === "join") {
    const clanName = parts.slice(2).join(" ").trim();
    if (!clanName) {
      await sendMessage(token, message.chat.id, "🐱 نام قبیله معتبر نیست.");
      return;
    }
    const clan = await getGroupClanByName(db, message.chat.id, clanName);
    if (!clan) {
      await sendMessage(token, message.chat.id, "🐱 قبیله‌ای با این نام پیدا نشد.");
      return;
    }
    const joined = await joinClan(db, clan.clan_id, message.from.id);
    if (!joined) {
      await sendMessage(token, message.chat.id, "🐱 شما قبلاً در این قبیله هستید یا عضو قبیله دیگری هستید.");
      return;
    }
    await sendMessage(token, message.chat.id, `✅ شما به قبیله <b>${escapeHtml(clan.name)}</b> پیوستید!`, { reply_markup: clanKeyboard(true, message.from?.id) });
    return;
  }

  const userClan = await getUserClan(db, message.chat.id, message.from.id);
  if (!userClan) {
    await sendMessage(token, message.chat.id, `👥 شما هنوز قبیله‌ای ندارید.

برای ایجاد قبیله از:
<code>/clan create نام_قبیله</code>

برای پیوستن به قبیله از:
<code>/clan join نام_قبیله</code>`, { reply_markup: clanKeyboard(false, message.from?.id) });
    return;
  }

  const members = await getClanMembers(db, userClan.clan_id);
  let text = `👥 <b>قبیله ${escapeHtml(userClan.name)}</b>\n`;
  text += `مالک: <b>${userClan.owner_user_id}</b>\n`;
  text += `خزانه قبیله: <b>${userClan.treasury_balance} MP</b>\n`;
  text += `اعضا: <b>${members.results.length}</b>\n\n`;
  text += members.results.map((member, index) => `${index + 1}. ${member.telegram_user_id} (${escapeHtml(member.role)})`).join("\n");

  await sendMessage(token, message.chat.id, text, { reply_markup: clanKeyboard(true, message.from?.id) });
}

export async function handleDaily(token: string, db: D1Database, message: TelegramMessage) {
  if (!message.from) return;
  if (message.chat.type !== "private") {
    await sendMessage(token, message.chat.id, "🐱 /daily فقط در چت خصوصی ربات قابل استفاده است. لطفاً در چت خصوصی با ربات بنویس.");
    return;
  }

  await ensureUser(db, message.from);

  const now = Math.floor(Date.now() / 1000);
  const user = await db
    .prepare(`SELECT meow_points, last_daily_at, daily_streak FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number; last_daily_at: number | null; daily_streak: number }>();

  const hasDaily = user?.last_daily_at && now - user.last_daily_at < 86400;
  if (hasDaily) {
    const remaining = 86400 - (now - user!.last_daily_at!);
    const hours = Math.ceil(remaining / 3600);
    let text = `🎁 جایزه امروزت رو قبلاً گرفتی!\n\n⏰ حدود ${hours} ساعت دیگه دوباره امتحان کن.`;

    await sendMessage(token, message.chat.id, text);
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

  const text = `🎁 <b>جایزه روزانه!</b>\n\n💰 +${reward} امتیاز\n🔥 استریک: ${streak} روز\n\n✨ برای دیدن وضعیتت، از /me استفاده کن.`;

  await sendMessage(token, message.chat.id, text);
}

export async function handleLottery(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 لاتاری فقط داخل گروه کار می‌کند. لطفاً ربات را به گروه اضافه کن و از /lottery یا /gamble استفاده کن.");
    return;
  }

  await ensureGroup(db, message.chat);
  const settings = await getGroupLotteryConfig(db, message.chat.id);
  const isOwner = message.from?.id !== undefined && env.BOT_OWNER_ID === String(message.from.id);

  const parts = (message.text || "").split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const sub = parts[1].toLowerCase();
    if (sub === "buy") {
      if (!message.from) return;
      if (!settings.lotteryEnabled) {
        await sendMessage(token, message.chat.id, "🎟️ لاتاری فعلا غیرفعال است.");
        return;
      }
      const count = Math.min(10, Math.max(1, Number.parseInt(parts[2] || "1", 10) || 1));
      const res = await purchaseLotteryTickets(db, message.chat.id, message.from.id, count);
      if (!res.success) {
        if (res.reason === "insufficient_funds") {
          await sendMessage(token, message.chat.id, "🐱 امتیاز کافی برای خرید این تعداد بلیت نداری.");
          return;
        }
        await sendMessage(token, message.chat.id, "❌ خطا در خرید بلیت لاتاری.");
        return;
      }
      const numbersText = res.numbers?.map((nums, index) => `🎫 بلیت ${index + 1}: ${nums.split(",").join(", ")}`).join("\n") ?? "-";
      await sendMessage(token, message.chat.id,
        `🎫 <b>خرید بلیت موفق</b>

تعداد بلیت: <b>${count}</b>
شماره دور: <b>${res.roundId}</b>

${numbersText}

📈 شانس تقریبی: 3 عدد ~5%، 4 عدد ~3%، 5 عدد ~1%، 6 عدد ~0.01%\n` +
        `💡 برای خرید سریع‌تر: /lottery buy 3 یا /gamble buy 3`
        , { parse_mode: "HTML" }
      );
      return;
    }

    if (sub === "status") {
      await sendMessage(token, message.chat.id, formatLotteryStatusText(settings), {
        reply_markup: lotteryKeyboard(isOwner, message.from?.id),
        parse_mode: "HTML",
      });
      return;
    }

      if (sub === "tickets" || sub === "mytickets" || sub === "my_tickets") {
        const text = await getLotteryTicketSummary(db, message.chat.id, message.from?.id ?? 0);
        await sendMessage(token, message.chat.id, text, {
          reply_markup: lotteryKeyboard(isOwner, message.from?.id),
          parse_mode: "HTML",
        });
        return;
      }

    if (sub === "settings") {
      if (!message.from) return;
      const isAdmin = message.from && await isGroupAdmin(token, message.chat.id, message.from.id);
      if (!isOwner && !isAdmin) {
        await sendMessage(token, message.chat.id, '❌ فقط مالک یا ادمین می‌تواند تنظیمات لاتاری را تغییر دهد.');
        return;
      }
      const arg = parts[2]?.toLowerCase();
      if (arg === 'price' && parts[3]) {
        const newPrice = parseInt(parts[3], 10);
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
          await sendMessage(token, message.chat.id, '❌ قیمت صحیح نیست.');
          return;
        }
        await setGroupLotteryTicketPrice(db, message.chat.id, newPrice);
        await sendMessage(token, message.chat.id, `✅ قیمت بلیت لاتاری به ${newPrice} MP تنظیم شد.`);
        return;
      }
      if (arg === 'enable') {
        await db.prepare(`UPDATE telegram_groups SET lottery_enabled = 1 WHERE telegram_group_id = ?`).bind(message.chat.id).run();
        await sendMessage(token, message.chat.id, '✅ لاتاری فعال شد.');
        return;
      }
      if (arg === 'disable') {
        await db.prepare(`UPDATE telegram_groups SET lottery_enabled = 0 WHERE telegram_group_id = ?`).bind(message.chat.id).run();
        await sendMessage(token, message.chat.id, '✅ لاتاری غیرفعال شد.');
        return;
      }
    }
  }

  await sendMessage(token, message.chat.id, formatLotteryStatusText(settings), {
    reply_markup: lotteryKeyboard(isOwner, message.from?.id),
    parse_mode: "HTML",
  });
}



export async function handleDice(token: string, db: D1Database, env: Bindings, message: TelegramMessage) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "تاس فقط داخل گروه کار می‌کند. لطفاً ربات را به گروه اضافه کن.");
    return;
  }

  if (!message.from) return;
  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);

  const now = Math.floor(Date.now() / 1000);

  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  const reward = die1 === die2 ? Math.floor(Math.random() * 501) + 1500 : 0;

  const batch = [
    db.prepare(`INSERT INTO group_members (
      telegram_group_id, telegram_user_id, username, first_name, meow_points, total_meows, last_meow_at, last_dice_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
    ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      meow_points = group_members.meow_points + excluded.meow_points,
      last_dice_at = excluded.last_dice_at
    WHERE group_members.last_dice_at IS NULL OR group_members.last_dice_at < ?`)
      .bind(message.chat.id, message.from.id, message.from.username ?? null, message.from.first_name, reward, now, now - DICE_COOLDOWN_SEC),
  ];

  if (reward > 0) {
    batch.push(
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(reward, message.from.id),
      db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(message.from.id, message.chat.id, reward, 'DICE_REWARD', now)
    );
  }

  const diceResult = await db.batch(batch);
  if (!diceResult[0].meta.changes) {
    const cooldownRow = await db
      .prepare(`SELECT last_dice_at FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(message.chat.id, message.from.id)
      .first<{ last_dice_at: number | null }>();
    const remaining = cooldownRow?.last_dice_at ? DICE_COOLDOWN_SEC - (now - cooldownRow.last_dice_at) : DICE_COOLDOWN_SEC;
    await sendMessage(token, message.chat.id, `⏱️ باید ${formatDuration(Math.max(0, remaining))} صبر کنی تا دوباره تاس بندازی.`);
    return;
  }

  const text =
    `تاس انداختی:\n\n` +
    `• عدد اول: <b>${die1}</b>\n` +
    `• عدد دوم: <b>${die2}</b>\n\n` +
    (reward > 0
      ? `🎉 معجزه‌ی تاس! دو عدد برابر آوردی و به‌صورت شانسی <b>${reward} MP</b> برنده شدی. پولت را چک کن و ببین چه معجزه‌ای از مسیرت عبور کرد!`
      : `😿 این بار دو عدد برابر نشدند. فقط وقتی هر دو تاس یک عدد بیاورند، جایزهٔ کافی دریافت می‌کنی. دفعه‌ی بعد بهتر می‌شه!`);

  await sendMessage(token, message.chat.id, text);
}

export async function getLotteryTicketSummary(db: D1Database, groupId: number, userId: number) {
  await allocatePendingLotteryTickets(db, groupId);

  const round = await db
    .prepare(`SELECT id, round_number, ticket_price FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<{ id: number; round_number: number; ticket_price: number }>();

  if (!round) {
    return `🎫 <b>هیچ دور بازی فعالی وجود ندارد.</b>\n\nوقتی دور جدید شروع شود، می‌توانی بلیت بخری و شماره‌های خود را ببینی.`;
  }

  const tickets = await db
    .prepare(`SELECT numbers FROM lottery_tickets WHERE lottery_round_id = ? AND telegram_user_id = ? ORDER BY purchased_at ASC`)
    .bind(round.id, userId)
    .all<{ numbers: string }>();

  if (!tickets.results.length) {
    const pendingRow = await db
      .prepare(`SELECT lottery_bonus_tickets FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
      .bind(groupId, userId)
      .first<{ lottery_bonus_tickets: number }>();
    const pendingTickets = pendingRow?.lottery_bonus_tickets || 0;
    const pendingText = pendingTickets > 0 ? `\n\n🎁 بلیت رایگان در انتظار شما: <b>${pendingTickets}</b>` : "";

    return `🎫 <b>بلیتی برای دور ${round.round_number} نخریده‌ای.</b>\n\nبرای خرید بلیت از /lottery buy 1 یا دکمه‌های لاتاری استفاده کن.${pendingText}`;
  }

  const ticketLines = tickets.results.map((ticket, index) => `• بلیت ${index + 1}: <code>${escapeHtml(ticket.numbers)}</code>`).join("\n");
  return (
    `🎫 <b>بلیت‌های شما</b>\n\n` +
    `شماره دور: <b>${round.round_number}</b>\n` +
    `قیمت هر بلیت: <b>${round.ticket_price} MP</b>\n` +
    `تعداد بلیت: <b>${tickets.results.length}</b>\n\n` +
    `${ticketLines}`
  );
}

function formatLotteryHelpText(settings: {
  lotteryEnabled: boolean;
  lotteryTicketPrice: number;
  lotteryPot: number;
  lotteryTicketSales: number;
  meowTaxPool: number;
  duelTaxPool: number;
}) {
  return (
    `🎲 <b>راهنمای لاتاری و قمار</b>\n\n` +
    `• هر بلیت شامل 6 عدد یکتا از 1 تا 49 است.\n` +
    `• قیمت هر بلیت: <b>${settings.lotteryTicketPrice} MP</b>\n` +
    `• پات جاری: <b>${settings.lotteryPot} MP</b>\n\n` +
    `🎁 هر 6 میو دریافتی در گروه، یک بلیت رایگان برای دور بعد به شما می‌دهد.\n` +
    `📈 شانس تقریبی:\n` +
    `• 3 عدد: ~5%\n` +
    `• 4 عدد: ~3%\n` +
    `• 5 عدد: ~1%\n` +
    `• 6 عدد: ~0.01%\n\n` +
    `💡 برای خرید سریع از دکمه‌ها استفاده کن یا دستورهای زیر را بفرست:\n` +
    `  /lottery buy 1\n` +
    `  /lottery buy 3\n` +
    `  /lottery buy 4\n` +
    `  /lottery buy 8\n` +
    `  /lottery buy 9\n` +
    `  /lottery buy 10\n\n` +
    `✨ همچنین می‌توانی از <b>/gamble</b> یا <b>قمار</b> استفاده کنی.\n` +
    `✨ مالک گروه یا ادمین می‌تواند با دکمه قرعه‌کشی، برنده‌ها را انتخاب کند.\n` +
    `🧾 شماره بلیت‌ها بلافاصله بعد از خرید نمایش داده می‌شوند.`
  );
}

export async function handleLotterySetPrice(token: string, db: D1Database, groupId: number, delta: number) {
  const settings = await getGroupLotteryConfig(db, groupId);
  const price = Math.max(1, settings.lotteryTicketPrice + delta);
  await setGroupLotteryTicketPrice(db, groupId, price);
  return price;
}

export async function handleLotterySetPot(token: string, db: D1Database, groupId: number, delta: number) {
  const settings = await getGroupLotteryConfig(db, groupId);
  const pot = Math.max(0, settings.lotteryPot + delta);
  await setGroupLotteryPot(db, groupId, pot);
  return pot;
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

  const groupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
  if (groupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی در این گروه نداری!\n💳 موجودی گروه: ${groupBalance} MP`, { reply_to_message_id: message.message_id });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const success = await applyPayTransfer(db, message.from.id, targetUser.telegram_id, amount, message.chat.id, now);

  if (!success) {
    await sendMessage(token, message.chat.id, "🐱 انتقال امکان‌پذیر نیست. یا موجودی گروه کافی نیست یا دریافت‌کننده عضو گروه نیست!", { reply_to_message_id: message.message_id });
    return;
  }

  await sendMessage(
    token,
    message.chat.id,
    `💸 <b>انتقال موفق!</b>\n\n🐱 ${escapeHtml(message.from.first_name)}\n➡️ ${amount} MP\n🐱 ${escapeHtml(targetUser.first_name)}\n\n✨ هم‌اکنون لیدربورد گروه هم به‌روز شده.`
  );
}

export async function handleDuelRequest(
  token: string,
  db: D1Database,
  message: TelegramMessage,
  c: RequestContext
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

  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);
  const challenger = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(message.from.id)
    .first<{ meow_points: number }>();
  const challengerGroupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);

  if (!challenger || challenger.meow_points < amount || challengerGroupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 امتیاز کافی نداری!\n💳 موجودی گروه: ${challengerGroupBalance} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  await ensureUser(db, target);
  const targetGlobal = await db
    .prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`)
    .bind(target.id)
    .first<{ meow_points: number }>();
  const targetGroupBalance = await getGroupMemberBalance(db, message.chat.id, target.id);

  if (!targetGlobal || targetGlobal.meow_points < amount || targetGroupBalance < amount) {
    await sendMessage(token, message.chat.id, `🐱 حریف امتیاز کافی در این گروه نداره!\n💳 موجودی گروه حریف: ${targetGroupBalance} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const existingId = await findOpenDuelAgainst(db, message.chat.id, target.id);
  if (existingId) await deleteDuel(db, existingId);

  const duelId = generateDuelId();
  const nowSec = Math.floor(Date.now() / 1000);
  const challengerRating = await getDuelRating(db, message.from.id);
  const targetRating = await getDuelRating(db, target.id);

  const res = await telegramRequest(token, "sendMessage", {
    chat_id: message.chat.id,
    text:
      `⚔️ <b>دعوای Meow!</b>\n\n` +
      `🐱 ${escapeHtml(message.from.first_name)} <b>(${challengerRating})</b>\n` +
      `🆚\n` +
      `🐱 ${escapeHtml(target.first_name)} <b>(${targetRating})</b>\n\n` +
      `💰 شرط: <b>${amount} MP</b>\n` +
      `🏆 برنده: <b>${amount * 2} MP</b>\n\n` +
      `⏱️ ${DUEL_TIMEOUT_SEC} ثانیه فرصت داری قبول کنی!`,
    parse_mode: "HTML",
    reply_markup: duelKeyboard(duelId, target.id),
  });

  const duel: DuelState = {
    id: duelId,
    challengerId: message.from.id,
    challengerName: message.from.first_name,
    targetId: target.id,
    targetName: target.first_name,
    amount,
    groupId: message.chat.id,
    messageId: res.result?.message_id ?? 0,
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
  const challengerGroupRow = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(duel.groupId, duel.challengerId)
    .first<{ meow_points: number }>();
  const targetGroupRow = await db
    .prepare(`SELECT meow_points FROM group_members WHERE telegram_group_id = ? AND telegram_user_id = ?`)
    .bind(duel.groupId, duel.targetId)
    .first<{ meow_points: number }>();

  if (
    !challengerRow || !targetRow ||
    challengerRow.meow_points < duel.amount ||
    targetRow.meow_points < duel.amount ||
    !challengerGroupRow || challengerGroupRow.meow_points < duel.amount ||
    !targetGroupRow || targetGroupRow.meow_points < duel.amount
  ) {
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
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.groupId, duel.challengerId, duel.amount),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`)
      .bind(duel.amount, duel.groupId, duel.targetId, duel.amount),
  ]);

  // defensive check in case concurrent change happened between select and update
  if (
    batchResults[0].meta.changes === 0 ||
    batchResults[1].meta.changes === 0 ||
    batchResults[2].meta.changes === 0 ||
    batchResults[3].meta.changes === 0
  ) {
    await editMessageText(
      token,
      duel.groupId,
      duel.messageId,
      `❌ <b>دعوا لغو شد!</b>\n\nیکی از بازیکن‌ها امتیاز کافی نداره.`
    );
    await answerCallback(token, callback.id);
    return;
  }

  const challengerRoll = Math.floor(Math.random() * 49) + 1;
  const targetRoll = Math.floor(Math.random() * 49) + 1;

  if (challengerRoll === targetRoll) {
    await db.batch([
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.challengerId),
      db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(duel.amount, duel.targetId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(duel.amount, duel.groupId, duel.challengerId),
      db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(duel.amount, duel.groupId, duel.targetId),
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
  const winnerReward = duel.amount * 2;
  const winnerNetGain = duel.amount;

  const challengerRating = await getDuelRating(db, duel.challengerId);
  const targetRating = await getDuelRating(db, duel.targetId);
  const [newChallengerRating, newTargetRating] = computeElo(
    challengerRating,
    targetRating,
    challengerRoll > targetRoll ? 1 : 0
  );

  await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(winnerReward, winnerId),
    db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(winnerReward, duel.groupId, winnerId),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.challengerId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(duel.targetId, duel.groupId, -duel.amount, `DUEL_BET`, now),
    db.prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(winnerId, duel.groupId, winnerReward, `DUEL_WIN`, now),
    db.prepare(`UPDATE users SET duel_rating = ? WHERE telegram_id = ?`).bind(newChallengerRating, duel.challengerId),
    db.prepare(`UPDATE users SET duel_rating = ? WHERE telegram_id = ?`).bind(newTargetRating, duel.targetId),
  ]);

  await editMessageText(
    token,
    duel.groupId,
    duel.messageId,
    `🎲 <b>دعوای Meow!</b>\n\n` +
    `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRoll}\n` +
    `🐱 ${escapeHtml(duel.targetName)}: ${targetRoll}\n\n` +
    `🏆 <b>${escapeHtml(winnerName)} برنده شد!</b>\n` +
    `💰 کل پاداش: ${winnerReward} MP\n` +
    `➕ افزایش خالص: +${winnerNetGain} MP\n\n` +
    `⚔️ <b>ریتینگ دعوا:</b>\n` +
    `🐱 ${escapeHtml(duel.challengerName)}: ${challengerRating} → <b>${newChallengerRating}</b>\n` +
    `🐱 ${escapeHtml(duel.targetName)}: ${targetRating} → <b>${newTargetRating}</b>`
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

export async function handleHokmRequest(
  token: string,
  db: D1Database,
  env: Bindings,
  message: TelegramMessage,
  c: any
) {
  if (message.chat.type === "private") {
    await sendMessage(token, message.chat.id, "🐱 حکم فقط داخل گروه بازی می‌شه!");
    return;
  }
  if (!message.from) return;

  const text = message.text || "";
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) {
    await sendMessage(token, message.chat.id, "🐱 نحوه استفاده:\n<code>/hokm 4000</code>\nمبلغ پات رو بنویس (هر ۴ نفر سهم مساوی می‌پردازن).", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const bet = safeParseAmount(parts[1]);
  if (bet === null) {
    await sendMessage(token, message.chat.id, "🐱 مقدار امتیاز نامعتبره!", { reply_to_message_id: message.message_id });
    return;
  }
  if (bet % 4 !== 0) {
    await sendMessage(token, message.chat.id, "🐱 مبلغ باید مضرب ۴ باشه (تا ۴ نفر سهم مساوی بدن).", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const perPlayer = bet / 4;
  await ensureGroup(db, message.chat);
  await ensureUser(db, message.from);
  const global = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(message.from.id).first<{ meow_points: number }>();
  const groupBalance = await getGroupMemberBalance(db, message.chat.id, message.from.id);
  if (!global || global.meow_points < perPlayer || groupBalance < perPlayer) {
    await sendMessage(token, message.chat.id, `🐱 سهم شما (${perPlayer} MP) در این گروه کافی نیست!\n💳 موجودی گروه: ${groupBalance} MP`, {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const activeGame = await getActiveHokmGame(db, message.chat.id);
  if (activeGame) {
    await sendMessage(token, message.chat.id, "🐱 الان یک بازی حکم در همین گروه در جریانه! صبر کن تموم شه.", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const gameId = generateHokmId();
  const nowSec = Math.floor(Date.now() / 1000);
  const appUrl = env.HOKM_APP_URL || (c?.req?.url ? new URL(c.req.url).origin : "");
  const lobbyTimeout = env.HOKM_LOBBY_TIMEOUT_SEC ?? HOKM_LOBBY_TIMEOUT_SEC;

  const res = await sendMessage(
    token,
    message.chat.id,
    `♠️ <b>بازی حکم!</b>\n\n` +
      `🐱 ${escapeHtml(message.from.first_name)} صندلی ۱ (تیم ۱)\n\n` +
      `💰 پات: <b>${bet} MP</b>\n` +
      `💸 سهم هر نفر: <b>${perPlayer} MP</b>\n` +
      `👥 تیم‌ها: صندلی‌های روبه‌رو هم‌تیم هستند\n\n` +
      `⏱️ ${lobbyTimeout} ثانیه فرصت داری ۳ نفر دیگه جذب کنی!`,
    { reply_markup: hokmSeatKeyboard(gameId) }
  );
  const msgId = res.result?.message_id ?? 0;
  if (!msgId) {
    await sendMessage(token, message.chat.id, "❌ ارسال پیام بازی ناموفق بود. دوباره تلاش کن!");
    return;
  }

  const created = await createHokmGame(db, {
    gameId,
    groupId: message.chat.id,
    creatorId: message.from.id,
    bet,
    perPlayer,
    boardMsgId: msgId,
    appUrl,
    createdAt: nowSec,
  });
  if (!created) {
    await deleteMessage(token, message.chat.id, msgId);
    await sendMessage(token, message.chat.id, "🐱 الان یک بازی حکم در همین گروه در جریانه! صبر کن تموم شه.", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const escrow = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(perPlayer, message.from.id, perPlayer),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(perPlayer, message.chat.id, message.from.id, perPlayer),
  ]);
  const usersDeducted = escrow[0].meta.changes > 0;
  const groupDeducted = escrow[1].meta.changes > 0;
  if (!usersDeducted || !groupDeducted) {
    // Reverse whatever part of the escrow succeeded so balances stay consistent.
    const undo: D1PreparedStatement[] = [];
    if (usersDeducted) {
      undo.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(perPlayer, message.from.id));
    }
    if (groupDeducted) {
      undo.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(perPlayer, message.chat.id, message.from.id));
    }
    if (undo.length) await db.batch(undo);
    await cancelHokmGame(db, gameId);
    await deleteMessage(token, message.chat.id, msgId);
    await sendMessage(token, message.chat.id, "🐱 امتیاز کافی برای شروع بازی نداشتی!");
    return;
  }

  const added = await addHokmPlayer(db, gameId, {
    userId: message.from.id,
    username: message.from.username ?? null,
    firstName: message.from.first_name,
    seat: 0,
    acceptedAt: nowSec,
  });
  if (!added) {
    await refundHokmEscrow(db, message.chat.id, message.from.id, perPlayer);
    await cancelHokmGame(db, gameId);
    await deleteMessage(token, message.chat.id, msgId);
    return;
  }

  await db
    .prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(message.from.id, message.chat.id, -perPlayer, `HOKM_BET`, nowSec)
    .run();

  await scheduleHokmLobbyTimeout(c, token, db, gameId, lobbyTimeout);
}

async function scheduleHokmLobbyTimeout(c: RequestContext, token: string, db: D1Database, gameId: string, timeoutSec: number) {
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(async () => {
      try {
        const game = await getHokmGame(db, gameId);
        if (!game || game.status !== "lobby") {
          resolve();
          return;
        }
        await cancelHokmGame(db, gameId);
        if (game.board_msg_id) {
          await editMessageText(token, game.group_id, game.board_msg_id, `⏱️ <b>بازی حکم منقضی شد!</b>\n\nهیچ‌کس دیگه‌ای نیومد. مبلغ‌ها برگشت.`);
        }
      } catch (e) {
        console.error("Hokm lobby timeout error:", e);
      }
      resolve();
    }, timeoutSec * 1000);
  });

  if (c?.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(timeoutPromise);
  }
}

export async function handleHokmAccept(
  token: string,
  db: D1Database,
  env: Bindings,
  callback: TelegramCallbackQuery,
  gameId: string,
  seat: number
) {
  if (!callback.message) return;

  if (!isValidHokmGameId(gameId)) {
    await answerCallback(token, callback.id, "🐱 بازی نامعتبر!", true);
    return;
  }
  if (seat < 1 || seat > 3) {
    await answerCallback(token, callback.id, "🐱 صندلی نامعتبر!", true);
    return;
  }

  const game = await getHokmGame(db, gameId);
  if (!game || game.status !== "lobby" || game.board_msg_id !== callback.message.message_id) {
    await answerCallback(token, callback.id, "🐱 این بازی دیگه قابل قبول نیست!", true);
    return;
  }

  if (game.creator_id === callback.from.id) {
    await answerCallback(token, callback.id, "🐱 تو سازنده بازی هستی!", true);
    return;
  }

  const players = await getHokmPlayers(db, gameId);
  if (players.some((p) => p.telegram_user_id === callback.from.id)) {
    await answerCallback(token, callback.id, "🐱 قبلاً وارد بازی شدی!", true);
    return;
  }
  if (players.some((p) => p.seat === seat)) {
    await answerCallback(token, callback.id, "🐱 این صندلی گرفته شده!", true);
    return;
  }

  await ensureUser(db, callback.from);
  const global = await db.prepare(`SELECT meow_points FROM users WHERE telegram_id = ?`).bind(callback.from.id).first<{ meow_points: number }>();
  const groupBalance = await getGroupMemberBalance(db, game.group_id, callback.from.id);
  if (!global || global.meow_points < game.per_player || groupBalance < game.per_player) {
    await answerCallback(token, callback.id, `🐱 سهم شما (${game.per_player} MP) در این گروه کافی نیست!`, true);
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const escrow = await db.batch([
    db.prepare(`UPDATE users SET meow_points = meow_points - ? WHERE telegram_id = ? AND meow_points >= ?`).bind(game.per_player, callback.from.id, game.per_player),
    db.prepare(`UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`).bind(game.per_player, game.group_id, callback.from.id, game.per_player),
  ]);
  const usersDeducted = escrow[0].meta.changes > 0;
  const groupDeducted = escrow[1].meta.changes > 0;
  if (!usersDeducted || !groupDeducted) {
    // Reverse whatever part of the escrow succeeded so balances stay consistent.
    const undo: D1PreparedStatement[] = [];
    if (usersDeducted) {
      undo.push(db.prepare(`UPDATE users SET meow_points = meow_points + ? WHERE telegram_id = ?`).bind(game.per_player, callback.from.id));
    }
    if (groupDeducted) {
      undo.push(db.prepare(`UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`).bind(game.per_player, game.group_id, callback.from.id));
    }
    if (undo.length) await db.batch(undo);
    await answerCallback(token, callback.id, "🐱 امتیاز کافی نداری!", true);
    return;
  }

  // Reserve the seat atomically — concurrent taps cannot both win the same seat.
  const added = await addHokmPlayer(db, gameId, {
    userId: callback.from.id,
    username: callback.from.username ?? null,
    firstName: callback.from.first_name,
    seat,
    acceptedAt: nowSec,
  });
  if (!added) {
    await refundHokmEscrow(db, game.group_id, callback.from.id, game.per_player);
    await answerCallback(token, callback.id, "🐱 این صندلی گرفته شده یا بازی شروع شده!", true);
    return;
  }

  await db
    .prepare(`INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(callback.from.id, game.group_id, -game.per_player, `HOKM_BET`, nowSec)
    .run();

  const allPlayers = await getHokmPlayers(db, gameId);
  const newCount = allPlayers.length;
  const lines = allPlayers.map((p) => `🪑 صندلی ${p.seat + 1}: ${escapeHtml(p.first_name)}`).join("\n");

  if (newCount < 4) {
    await editMessageText(
      token,
      game.group_id,
      game.board_msg_id!,
      `♠️ <b>بازی حکم!</b>\n\n${lines}\n\n` +
        `💰 پات: <b>${game.bet} MP</b> (هر نفر ${game.per_player})\n` +
        `👥 تیم‌ها: صندلی‌های روبه‌رو هم‌تیم هستند\n\n` +
        `⏳ ${4 - newCount} نفر دیگه لازمه!`
    );
    await answerCallback(token, callback.id, "✅ وارد بازی شدی!");
    return;
  }

  // Flip the game to 'playing' atomically — a concurrent 4th joiner may have
  // already done so; only the winner of the race runs the start flow.
  const started = await setHokmGamePlaying(db, gameId, nowSec);
  if (!started) {
    // Defensive: another concurrent joiner already started the match. Undo our
    // own escrow and seat reservation so no money or player row is leaked.
    await removeHokmPlayer(db, gameId, callback.from.id);
    await refundHokmEscrow(db, game.group_id, callback.from.id, game.per_player);
    if (game.board_msg_id) {
      await deleteMessage(token, game.group_id, game.board_msg_id);
    }
    await answerCallback(token, callback.id, "🎉 بازی شروع شد!");
    return;
  }

  const baseUrl = game.app_url || env.HOKM_APP_URL || "";
  const boardMarkup = baseUrl ? { reply_markup: hokmBoardKeyboard(gameId, baseUrl) } : {};
  const boardRes = await sendMessage(
    token,
    game.group_id,
    `🎴 <b>بازی حکم شروع شد!</b>\n\n${lines}\n\n` +
      `💰 پات: <b>${game.bet} MP</b>\n` +
      `🏆 برنده تیم: ${game.bet} MP\n\n` +
      `⬇️ دکمه بازی رو بزن تا وارد بشی!`,
    boardMarkup
  );
  const boardMsgId = boardRes.result?.message_id ?? 0;
  if (!boardMsgId) {
    await cancelHokmGame(db, gameId);
    if (game.board_msg_id) {
      await deleteMessage(token, game.group_id, game.board_msg_id);
    }
    await answerCallback(token, callback.id, "❌ ارسال پیام شروع ناموفق بود؛ مبلغ‌ها برگشت.", true);
    return;
  }

  await setHokmGameBoardMsg(db, gameId, boardMsgId);
  if (game.board_msg_id) {
    await deleteMessage(token, game.group_id, game.board_msg_id);
  }

  try {
    const stub = env.HOKM_GAME.get(env.HOKM_GAME.idFromName(gameId));
    await stub.fetch(`http://hokm/init`, {
      method: "POST",
      headers: { "X-Hokm-App-Url": baseUrl },
    });
  } catch (e) {
    console.error("HokmGame init error:", e);
  }

  await answerCallback(token, callback.id, "🎉 بازی کامل شد!");
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

  await sendMessage(token, message.chat.id, text, { reply_markup: groupSettingsKeyboard(settings.enabled, settings.cooldown, message.from?.id) });
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

  const [action, ...rawParams] = segments;

  const parseUserScopedParams = (params: string[]) => {
    const userIndex = params.indexOf("user");
    if (userIndex >= 0 && userIndex + 1 < params.length) {
      const parsed = parseInt(params[userIndex + 1], 10);
      if (Number.isFinite(parsed)) {
        return {
          userId: parsed,
          params: params.slice(0, userIndex),
        };
      }
    }
    return { userId: null as number | null, params };
  };

  const { userId: scopedUserId, params } = parseUserScopedParams(rawParams);
  if (scopedUserId && scopedUserId !== userId) {
    await answerCallback(token, callback.id, "🚫 این دکمه فقط برای کسی است که پیام را باز کرده است.", true);
    return;
  }

  if (action === "admin" || action === "useract" || action === "bc" || action === "groupmgr" || action === "duelmon" || action === "audit") {
    await handleOwnerPanelAction(token, db, env, callback, action, params);
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

      if (params[0] === "me") await handleMe(token, db, env, fakeMessage);
      else if (params[0] === "top") await handleTop(token, db, fakeMessage);
      else if (params[0] === "global") await handleGlobal(token, db, fakeMessage);
      else if (params[0] === "daily") await handleDaily(token, db, fakeMessage);
      else if (params[0] === "history") await handleHistory(token, db, fakeMessage);
      else if (params[0] === "events") await handleEvents(token, db, env, fakeMessage);
      else if (params[0] === "pay") await handlePay(token, db, fakeMessage);
      else if (params[0] === "treasury") await handleTreasury(token, db, fakeMessage);
      else if (params[0] === "clan") await handleClan(token, db, fakeMessage);
      else if (params[0] === "dice") await handleDice(token, db, env, fakeMessage);
      else if (params[0] === "lottery" || params[0] === "gamble") await handleLottery(token, db, env, fakeMessage);
      else if (params[0] === "duelrank") await handleDuelRank(token, db, fakeMessage);

      await answerCallback(token, callback.id);
      return;
    }

    if (action === "daily") {
      await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
      return;
    }

    if (action === "menu") {
      if (params[0] === "main") {
        await editMessageText(token, chatId, messageId, "🐱 <b>منوی اصلی</b>\n\nاز اینجا سریع به همه امکانات دسترسی داری:", mainMenuKeyboard(userId));
      } else if (params[0] === "help") {
        await editMessageText(
          token,
          chatId,
          messageId,
          `🆘 <b>راهنمای سریع</b>\n\n• برای امتیاز گرفتن، در گروه <b>میو</b> بگو\n• برای دیدن وضعیت خود، /me را بفرست\n• برای جایزه روزانه، /daily را بفرست\n• برای انتقال امتیاز، /pay @username 100\n• برای دیدن رتبه‌بندی، /top را بفرست`, 
          mainMenuKeyboard(userId)
        );
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
          groupSettingsKeyboard(settings.enabled, settings.cooldown, userId)
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
        await handleAdmin(token, db, env, fakeMessage);
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
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown, userId));
      } else if (params[0] === "set_cooldown") {
        const options = [5, 10, 30, 60, 300];
        const currentIndex = options.indexOf(settings.cooldown);
        const nextCooldown = options[(currentIndex + 1) % options.length];
        await db.prepare(`UPDATE telegram_groups SET cooldown_seconds = ? WHERE telegram_group_id = ?`).bind(nextCooldown, chatId).run();
        const updated = await getGroupSettings(db, chatId);
        await editMessageText(token, chatId, messageId, `⚙️ <b>تنظیمات گروه</b>\n\n🤖 وضعیت: ${updated.enabled ? "✅ روشن" : "❌ خاموش"}\n⏱️ کول‌داون: ${updated.cooldown}s`, groupSettingsKeyboard(updated.enabled, updated.cooldown, userId));
      } else if (params[0] === "reset_lb") {
        await db.prepare(`DELETE FROM group_members WHERE telegram_group_id = ?`).bind(chatId).run();
        await editMessageText(token, chatId, messageId, "🔄 <b>لیدربورد گروه ریست شد!</b>", groupSettingsKeyboard(settings.enabled, settings.cooldown, userId));
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

    if (action === "hokm" && params[0] === "seat" && params[1] && params[2]) {
      await handleHokmAccept(token, db, env, callback, params[1], parseInt(params[2], 10));
      return;
    }

    if (action === "event") {
      if (env.BOT_OWNER_ID !== String(userId)) {
        await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
        return;
      }

      if (params[0] === "add") {
        await answerCallback(token, callback.id, "✅ استفاده از /add event برای افزودن رویداد", true);
        await sendMessage(token, chatId, `برای افزودن رویداد از دستور زیر استفاده کن:\n<code>/add event FlashSale 2 60</code>`);
        return;
      }

      if (params[0] === "edit") {
        await answerCallback(token, callback.id, "✅ استفاده از /editevent برای ویرایش رویداد", true);
        await sendMessage(token, chatId, `برای ویرایش رویداد فعلی از دستور زیر استفاده کن:\n<code>/editevent FlashSale 2 60</code>`);
        return;
      }

      if (params[0] === "end") {
        await db.prepare(`UPDATE events SET is_active = 0 WHERE is_active = 1`).run();
        await editMessageText(token, chatId, messageId, "✅ رویداد فعلی پایان پیدا کرد.");
        await answerCallback(token, callback.id, "رویداد پایان یافت.", true);
        return;
      }
    }

    if (action === "lottery") {
      const { userId: scopedUserId, params: lotteryParams } = parseUserScopedParams(params);
      if (scopedUserId && scopedUserId !== userId) {
        await answerCallback(token, callback.id, "🚫 این دکمه فقط برای کسی است که پیام را باز کرده است.", true);
        return;
      }

      if (lotteryParams[0] === "status") {
        const text = await getLotteryStatusText(db, chatId, userId);
        await editMessageText(token, chatId, messageId, text, lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "my_tickets") {
        const text = await getLotteryTicketSummary(db, chatId, userId);
        await editMessageText(token, chatId, messageId, text, lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "help") {
        const settings = await getGroupLotteryConfig(db, chatId);
        const isOwner = env.BOT_OWNER_ID === String(userId);
        await editMessageText(token, chatId, messageId, formatLotteryHelpText(settings), lotteryKeyboard(isOwner, userId));
        await answerCallback(token, callback.id);
        return;
      }

      if (lotteryParams[0] === "buy") {
        if (!callback.from || !callback.message) {
          await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
          return;
        }
        const config = await getGroupLotteryConfig(db, chatId);
        if (!config.lotteryEnabled) {
          await answerCallback(token, callback.id, "🎟️ لاتاری فعلا غیرفعال است.", true);
          return;
        }
        const count = lotteryParams.length >= 2 ? parseInt(lotteryParams[1], 10) : 1;
        if (!Number.isFinite(count) || count <= 0 || count > 10) {
          await answerCallback(token, callback.id, "🐱 تعداد بلیت نامعتبر است. حداکثر 10 بلیت مجاز است.", true);
          return;
        }
        const purchase = await purchaseLotteryTickets(db, chatId, callback.from.id, count);
        if (!purchase.success) {
          if (purchase.reason === 'insufficient_funds') {
            await answerCallback(token, callback.id, "🐱 امتیاز گروهی کافی نداری!", true);
            return;
          }
          await answerCallback(token, callback.id, "❌ خطا در خرید بلیت لاتاری.", true);
          return;
        }
        const numbersText = purchase.numbers?.map((nums, index) => `🎫 بلیت ${index + 1}: ${nums.split(',').join(', ')}`).join('\n') ?? "-";
        await editMessageText(token, chatId, messageId,
          `🎫 <b>بلیت خریداری شد</b>\n\n` +
          `تعداد بلیت: <b>${count}</b>\n` +
          `شماره دور: <b>${purchase.roundId}</b>\n\n` +
          `📌 شماره‌های بلیت‌های شما:\n${numbersText}\n\n` +
          `🎯 اگر حداقل 3 عدد با اعداد برنده یکی باشد، در این دور برنده می‌شوید.\n` +
          `💡 ساختار جوایز: 3 عدد = 20% پات، 4 عدد = 35%، 5 عدد = 50%، 6 عدد = 100%`,
          lotteryKeyboard(env.BOT_OWNER_ID === String(userId), callback.from.id)
        );

        await answerCallback(token, callback.id);
        return;
      }

      if (params[0] === "draw") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          const isAdmin = await isGroupAdmin(token, chatId, userId);
          if (!isAdmin) {
            await answerCallback(token, callback.id, "🚫 فقط صاحب ربات یا ادمین می‌تواند لاتاری را قرعه‌کشی کند.", true);
            return;
          }
        }

        const round = await db.prepare(`SELECT id FROM lottery_rounds WHERE telegram_group_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).bind(chatId).first<{ id: number }>();
        if (!round) {
          await answerCallback(token, callback.id, "🎟️ راند بازی باز وجود ندارد.", true);
          return;
        }

        const drawRes = await drawLotteryRound(db, round.id, chatId, callback.from?.id ?? null);
        if (!drawRes.success) {
          await answerCallback(token, callback.id, `❌ خطا در قرعه‌کشی: ${String(drawRes.reason)}`, true);
          return;
        }

        const winners = drawRes.winners || [];
        const winnerLines = winners.length
          ? winners.slice(0, 8).map((w) => `• <b>${escapeHtml(String(w.displayName || `کاربر ${w.userId}`))}</b> — ${w.matchCount} عدد درست — <b>${w.payout} MP</b>`)
          : [];
        const winnerSection = winners.length
          ? `\n\n🏆 <b>برندگان این دور</b>:\n${winnerLines.join("\n")}${winners.length > 8 ? `\n… و ${winners.length - 8} برنده دیگر` : ""}`
          : `\n\n🎯 هیچ بلیتی با حداقل 3 عدد درست برنده نشد. پات این دور به دور بعد منتقل می‌شود.`;

        await editMessageText(token, chatId, messageId,
          `🎉 <b>قرعه‌کشی انجام شد</b>\n\n` +
          `🔢 اعداد برنده: <b>${drawRes.winningNumbers}</b>\n` +
          `💸 مجموع پرداختی: <b>${drawRes.totalPaid} MP</b>\n` +
          `👥 تعداد برندگان: <b>${drawRes.payoutsCount}</b>\n` +
          `✨ نتایج در پیام جدید ارسال شد.`,
          lotteryKeyboard(env.BOT_OWNER_ID === String(userId), userId)
        );

        await sendMessage(token, chatId,
          `🎉 <b>نتایج لاتاری</b>\n\n` +
          `🔢 اعداد برنده: <b>${drawRes.winningNumbers}</b>\n` +
          `💸 مجموع پرداختی: <b>${drawRes.totalPaid} MP</b>\n` +
          `👥 تعداد برندگان: <b>${drawRes.payoutsCount}</b>${winnerSection}`,
          { parse_mode: "HTML" }
        );

        await answerCallback(token, callback.id, "✅ قرعه‌کشی انجام شد.");
        return;
      }

      if (params[0] === "adjust_price") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
          return;
        }

        const delta = parseInt(params[1], 10) || 0;
        const newPrice = await handleLotterySetPrice(token, db, chatId, delta);
        const settings = await getGroupLotteryConfig(db, chatId);
        await editMessageText(token, chatId, messageId, `🎟️ قیمت بلیت جدید: <b>${newPrice} MP</b>\n\n${formatLotteryStatusText(settings)}`, lotteryKeyboard(true, userId));
        await answerCallback(token, callback.id, `✅ قیمت بلیت به ${newPrice} تغییر یافت.`);
        return;
      }

      if (params[0] === "adjust_pot") {
        if (env.BOT_OWNER_ID !== String(userId)) {
          await answerCallback(token, callback.id, "🚫 فقط صاحب ربات!", true);
          return;
        }

        const delta = parseInt(params[1], 10) || 0;
        const newPot = await handleLotterySetPot(token, db, chatId, delta);
        const settings = await getGroupLotteryConfig(db, chatId);
        await editMessageText(token, chatId, messageId, `💰 پات لاتاری جدید: <b>${newPot} MP</b>\n\n${formatLotteryStatusText(settings)}`, lotteryKeyboard(true, userId));
        await answerCallback(token, callback.id, `✅ پات لاتاری به ${newPot} تغییر یافت.`);
        return;
      }

    await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
    return;
  }

    if (action === "clan") {
      if (!callback.from || !callback.message) {
        await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
        return;
      }
      const sub = params[0];

      if (sub === "status") {
        const clan = await getUserClan(db, chatId, userId);
        const text = clan
          ? `👥 <b>قبیله ${escapeHtml(clan.name)}</b>\n👑 مالک: <code>${clan.owner_user_id}</code>\n💰 خزانه: <b>${clan.treasury_balance} MP</b>`
          : "👥 شما هنوز قبیله‌ای ندارید.";
        await editMessageText(token, chatId, messageId, text, clanKeyboard(!!clan, userId));
      } else if (sub === "create") {
        await sendMessage(token, chatId, `برای ایجاد قبیله از دستور زیر استفاده کن:\n<code>/clan create نام_قبیله</code>`);
      } else if (sub === "join") {
        await sendMessage(token, chatId, `برای پیوستن به قبیله از دستور زیر استفاده کن:\n<code>/clan join نام_قبیله</code>`);
      } else if (sub === "leave") {
        const clan = await getUserClan(db, chatId, userId);
        if (!clan) {
          await answerCallback(token, callback.id, "👥 شما قبیله‌ای ندارید!", true);
          return;
        }
        const left = await leaveClan(db, clan.clan_id, userId);
        await editMessageText(
          token,
          chatId,
          messageId,
          left ? "🚪 شما از قبیله خارج شدید." : "❌ خارج شدن از قبیله ممکن نشد.",
          clanKeyboard(false, userId)
        );
      } else {
        await answerCallback(token, callback.id, "❌ درخواست نامعتبر", true);
        return;
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

export async function handleMyChatMember(token: string, db: D1Database, update: TelegramChatMemberUpdated) {
  const { chat, new_chat_member } = update;

  if (new_chat_member.status === "member" || new_chat_member.status === "administrator") {
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
