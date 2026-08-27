import { PublicBlackjackState, PublicPokerState } from "./types";
import { BJ_BET_STEPS, POKER_RAISE_STEPS, BOOSTER_TIERS } from "./constants";

const fmtRaiseStep = (n: number) => (n >= 1000 && n % 1000 === 0 ? `+${n / 1000}K` : `+${n}`);

const getUserSuffix = (userId?: number) => (userId ? `:user:${userId}` : "");

export function mainMenuKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "👤✨ پروفایل من", callback_data: `cmd:me${userSuffix}` },
        { text: "🏆📊 رتبه‌بندی", callback_data: `cmd:top${userSuffix}` },
      ],
      [
        { text: "🎰🎲 لاتاری / قمار", callback_data: `cmd:lottery${userSuffix}` },
        { text: "🎲🎯 تاس", callback_data: `cmd:dice${userSuffix}` },
      ],
      [
        { text: "🃏🔥 پوکر گروه", callback_data: `cmd:poker${userSuffix}` },
        { text: "🂡💎 بلک‌جک", callback_data: `cmd:blackjack${userSuffix}` },
      ],
      [
        { text: "💸📤 انتقال امتیاز", callback_data: `cmd:pay${userSuffix}` },
        { text: "📜🕰️ تاریخچه", callback_data: `cmd:history${userSuffix}` },
      ],
      [
        { text: "⚔️🥊 رتبه دعوا", callback_data: `cmd:duelrank${userSuffix}` },
        { text: "🎪🎉 رویدادها", callback_data: `cmd:events${userSuffix}` },
      ],
      [
        { text: "🚀⚡ بوستر", callback_data: `cmd:booster${userSuffix}` },
        { text: "🐱🎀 گربه‌ی من", callback_data: `cmd:cat${userSuffix}` },
      ],
      [
        { text: "📊📈 آمار گروه", callback_data: `cmd:groupstats${userSuffix}` },
        { text: "⚙️🔧 تنظیمات", callback_data: `menu:group_settings${userSuffix}` },
      ],
      [
        { text: "🆘📖 راهنمای دستورات", callback_data: `menu:help${userSuffix}` },
      ],
    ],
  };
}

export function postMeowKeyboard(groupId: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "🏆📊 رتبه‌بندی", callback_data: `cmd:top:${groupId}${userSuffix}` },
        { text: "🐱🎀 گربه‌ی من", callback_data: `cmd:cat${userSuffix}` },
      ],
      [
        { text: "🎰🎲 لاتاری", callback_data: `cmd:lottery${userSuffix}` },
        { text: "🚀⚡ بوستر", callback_data: `cmd:booster${userSuffix}` },
      ],
      [
        { text: "⚙️🔧 تنظیمات گروه", callback_data: `menu:group_settings${userSuffix}` },
      ],
    ],
  };
}

export function catAdoptKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: "🐈✨ پذیرش گربه — ۱۰۰٬۰۰۰ MP", callback_data: `cat:adopt${userSuffix}` }],
      [{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }],
    ],
  };
}

export function catMenuKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "🍖 تغذیه (میو گربه)", callback_data: `cat:feed${userSuffix}` },
        { text: "💸 انتقال XP", callback_data: `cat:transfer${userSuffix}` },
      ],
      [
        { text: "🔄 به‌روزرسانی", callback_data: `cat:refresh${userSuffix}` },
      ],
    ],
  };
}

export function ownerPanelKeyboard(userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: "📊 آمار ربات", callback_data: `admin:stats${u}` }],
      [
        { text: "👤 کاربران", callback_data: `admin:users${u}` },
        { text: "👥 گروه‌ها", callback_data: `admin:groups${u}` },
        { text: "⚔️ دعواها", callback_data: `admin:duels${u}` },
      ],
      [
        { text: "🎉 رویدادها", callback_data: `admin:events${u}` },
        { text: "🏷️ حراج‌های عنوان", callback_data: `admin:auctions${u}` },
        { text: "💰 اقتصاد", callback_data: `admin:economy${u}` },
      ],
      [
        { text: "📝 تراکنش‌ها", callback_data: `admin:audit${u}` },
        { text: "⚙️ تنظیمات", callback_data: `admin:config${u}` },
        { text: "🔍 تعمیرات", callback_data: `admin:repair${u}` },
      ],
      [
        { text: "📢 پیام همگانی", callback_data: `admin:broadcast${u}` },
        { text: "🔋 حالت تعمیرات", callback_data: `admin:maintenance${u}` },
      ],
      [{ text: "🔙 بستن پنل", callback_data: `menu:close${u}` }],
    ],
  };
}

export function usersMenuKeyboard(userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: "🔍 جستجوی کاربر", callback_data: `admin:search${u}` }],
      [
        { text: "➕ افزودن امتیاز", callback_data: `admin:addpoints${u}` },
        { text: "➖ کسر امتیاز", callback_data: `admin:removepoints${u}` },
      ],
      [
        { text: "🚫 بن / آنبن", callback_data: `admin:banmenu${u}` },
        { text: "🔄 ریست کاربر", callback_data: `admin:resetuser${u}` },
      ],
      [{ text: "📜 تراکنش‌های کاربر", callback_data: `admin:useraudit${u}` }],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function groupSettingsKeyboard(enabled: boolean, cooldown: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        {
          text: `${enabled ? "🟢" : "🔴"} ربات: ${enabled ? "✅ روشن" : "❌ خاموش"}`,
          callback_data: `group:toggle_bot${userSuffix}`,
        },
      ],
      [{ text: `⏱️🔄 کول‌داون: ${cooldown}s`, callback_data: `group:set_cooldown${userSuffix}` }],
      [{ text: "🗑️🔄 ریست لیدربورد", callback_data: `group:reset_lb${userSuffix}` }],
      [{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }],
    ],
  };
}

export function treasuryKeyboard(treasuryBalance: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: `💰 خزانه گروه: ${treasuryBalance} MP` }],
      [{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }],
    ],
  };
}

export function lotteryKeyboard(isOwner: boolean, userId?: number, canDraw: boolean = isOwner) {
  const userSuffix = getUserSuffix(userId);
  const buttons = [
    [
      { text: "🎫 ۱ بلیت", callback_data: `lottery:buy:1${userSuffix}` },
      { text: "🎫 ۳ بلیت", callback_data: `lottery:buy:3${userSuffix}` },
      { text: "🎫 ۴ بلیت", callback_data: `lottery:buy:4${userSuffix}` },
    ],
    [
      { text: "🎫 ۸ بلیت", callback_data: `lottery:buy:8${userSuffix}` },
      { text: "🎫 ۹ بلیت", callback_data: `lottery:buy:9${userSuffix}` },
      { text: "🎫 🔟 بلیت", callback_data: `lottery:buy:10${userSuffix}` },
    ],
    [
      { text: "📊🔍 وضعیت لاتاری", callback_data: `lottery:status${userSuffix}` },
      { text: "🧾🎟️ بلیت‌های من", callback_data: `lottery:my_tickets${userSuffix}` },
    ],
    [
      { text: "❓📖 راهنما", callback_data: `lottery:help${userSuffix}` },
    ],
  ];

  // The draw is available to the bot owner AND group admins (server-side
  // check in the lottery:draw branch); price/pot adjustments stay owner-only.
  if (canDraw) {
    buttons.push([{ text: "🎯✨ قرعه‌کشی", callback_data: `lottery:draw${userSuffix}` }]);
  }

  if (isOwner) {
    buttons.push([
      { text: "🟢 قیمت بلیت +۵۰", callback_data: `lottery:adjust_price:+50${userSuffix}` },
      { text: "🔴 قیمت بلیت −۵۰", callback_data: `lottery:adjust_price:-50${userSuffix}` },
    ]);
    buttons.push([
      { text: "🟢 پات +۱۰۰", callback_data: `lottery:adjust_pot:+100${userSuffix}` },
      { text: "🔴 پات −۱۰۰", callback_data: `lottery:adjust_pot:-100${userSuffix}` },
    ]);
  }

  buttons.push([{ text: "🔙 بازگشت به منو", callback_data: `menu:main${userSuffix}` }]);

  return { inline_keyboard: buttons };
}

export function duelKeyboard(duelId: string, targetId?: number, challengerId?: number) {
  const targetSuffix = getUserSuffix(targetId);
  const buttons = [
    [
      { text: "🟢⚔️ قبول می‌کنم!", callback_data: `duel:accept:${duelId}${targetSuffix}` },
      { text: "🔴😅 نه، مرسی", callback_data: `duel:decline:${duelId}${targetSuffix}` },
    ],
  ];
  if (challengerId) {
    buttons.push([
      // Scoped to the challenger so only they can withdraw their own challenge.
      { text: "🚫❌ لغو دعوا", callback_data: `duel:cancel:${duelId}${getUserSuffix(challengerId)}` },
    ]);
  }
  return { inline_keyboard: buttons };
}

export function userActionKeyboard(userId: number, ownerId?: number, confirmingReset = false) {
  const u = getUserSuffix(ownerId);
  if (confirmingReset) {
    return {
      inline_keyboard: [
        [{ text: "⚠️ مطمئنی؟ امتیاز، عضویت و همه تراکنش‌ها پاک می‌شود!" }],
        [
          { text: "✅ بله، ریست کن", callback_data: `useract:reset:yes:${userId}${u}` },
          { text: "❌ انصراف", callback_data: `useract:reset:no:${userId}${u}` },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "➕ +100", callback_data: `useract:add:${userId}:100${u}` },
        { text: "➕ +500", callback_data: `useract:add:${userId}:500${u}` },
        { text: "➕ +1000", callback_data: `useract:add:${userId}:1000${u}` },
      ],
      [
        { text: "➖ -100", callback_data: `useract:sub:${userId}:100${u}` },
        { text: "➖ -500", callback_data: `useract:sub:${userId}:500${u}` },
        { text: "➖ -1000", callback_data: `useract:sub:${userId}:1000${u}` },
      ],
      [
        { text: "🚫 بن", callback_data: `useract:ban:${userId}${u}` },
        { text: "✅ آنبن", callback_data: `useract:unban:${userId}${u}` },
        { text: "🔄 ریست", callback_data: `useract:reset:${userId}${u}` },
      ],
      [
        { text: "📜 تراکنش‌ها", callback_data: `useract:txns:${userId}${u}` },
        { text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` },
      ],
    ],
  };
}

export function userSearchResultsKeyboard(results: { telegram_id: number; first_name: string; username: string | null }[], ownerId?: number) {
  const u = getUserSuffix(ownerId);
  return {
    inline_keyboard: [
      ...results.map((r) => [
        { text: `👤 ${r.first_name}${r.username ? ` @${r.username}` : ""} (#${r.telegram_id})`, callback_data: `useract:open:${r.telegram_id}${u}` },
      ]),
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function broadcastModeKeyboard(userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "👤 ارسال به کاربران", callback_data: `admin:broadcast:users${u}` },
        { text: "👥 ارسال به گروه‌ها", callback_data: `admin:broadcast:groups${u}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function broadcastConfirmKeyboard(userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "✅ ارسال", callback_data: `bc:confirm${u}` },
        { text: "❌ لغو", callback_data: `bc:cancel${u}` },
      ],
    ],
  };
}

export function broadcastProgressKeyboard(userId?: number, done = false) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: done
      ? [[{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }]]
      : [
          [
            { text: "▶️ ادامه", callback_data: `bc:continue${u}` },
            { text: "❌ توقف", callback_data: `bc:stop${u}` },
          ],
        ],
  };
}

export function eventInlineKeyboard(isOwner: boolean, hasActiveEvent: boolean, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  if (!isOwner) {
    return { inline_keyboard: [] };
  }

  const buttons = [
    [{ text: "🟢➕ افزودن رویداد", callback_data: `event:add${userSuffix}` }],
  ];

  if (hasActiveEvent) {
    buttons.push([
      { text: "🟡✏️ ویرایش رویداد", callback_data: `event:edit${userSuffix}` },
      { text: "🔴⏹️ پایان رویداد", callback_data: `event:end${userSuffix}` },
    ]);
  }

  buttons.push([{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }]);

  return { inline_keyboard: buttons };
}

export function txnAuditKeyboard(page: number, userId?: number, filter = "") {
  const u = getUserSuffix(userId);
  const f = filter ? `:${filter}` : "";
  return {
    inline_keyboard: [
      [
        { text: "⬅️ قبلی", callback_data: `audit:page:${Math.max(0, page - 1)}${f}${u}` },
        { text: "➡️ بعدی", callback_data: `audit:page:${page + 1}${f}${u}` },
      ],
      ...(filter ? [[{ text: "🔍 پاک کردن فیلتر", callback_data: `audit:page:0${u}` }]] : []),
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function groupPageKeyboard(groupId: number, page: number, isActive: boolean, userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: `🤖 ${isActive ? "✅ فعال" : "❌ غیرفعال"}`, callback_data: `groupmgr:toggle:${groupId}:${page}${u}` },
        { text: "⏱️ کول‌داون", callback_data: `groupmgr:cooldown:${groupId}:${page}${u}` },
      ],
      [
        { text: "🎟️ لاتاری", callback_data: `groupmgr:lottery:${groupId}:${page}${u}` },
        { text: "🔄 رفرش لیدربورد", callback_data: `groupmgr:refresh:${groupId}:${page}${u}` },
      ],
      [
        { text: "🗑️ ریست لیدربورد", callback_data: `groupmgr:reset:${groupId}:${page}${u}` },
        { text: "🗑️ حذف گروه", callback_data: `groupmgr:delete:${groupId}:${page}${u}` },
      ],
      [
        { text: "⬅️ بازگشت به گروه‌ها", callback_data: `groupmgr:page:${page}${u}` },
        { text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` },
      ],
    ],
  };
}

export function groupResetConfirmKeyboard(groupId: number, page: number, userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: "⚠️ مطمئنی؟ کل لیدربورد گروه پاک می‌شود!" }],
      [
        { text: "✅ بله، ریست کن", callback_data: `groupmgr:reset:yes:${groupId}:${page}${u}` },
        { text: "❌ انصراف", callback_data: `groupmgr:reset:no:${groupId}:${page}${u}` },
      ],
    ],
  };
}

export function groupDeleteConfirmKeyboard(groupId: number, page: number, userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [{ text: "⚠️ مطمئنی؟ گروه و همه داده‌هایش حذف می‌شود!" }],
      [
        { text: "✅ بله، حذف کن", callback_data: `groupmgr:delete:yes:${groupId}:${page}${u}` },
        { text: "❌ انصراف", callback_data: `groupmgr:delete:no:${groupId}:${page}${u}` },
      ],
    ],
  };
}

export function groupLotteryKeyboard(groupId: number, page: number, userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "🎟️ قیمت +50", callback_data: `groupmgr:lprice:${groupId}:${page}:50${u}` },
        { text: "🎟️ قیمت -50", callback_data: `groupmgr:lprice:${groupId}:${page}:-50${u}` },
      ],
      [
        { text: "💰 پات +100", callback_data: `groupmgr:lpot:${groupId}:${page}:100${u}` },
        { text: "💰 پات -100", callback_data: `groupmgr:lpot:${groupId}:${page}:-100${u}` },
      ],
      [
        { text: "⬅️ بازگشت", callback_data: `groupmgr:view:${groupId}:${page}${u}` },
        { text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` },
      ],
    ],
  };
}

export function repairKeyboard(userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "🔧 رفع اختلاف امتیازها", callback_data: `repair:fix${u}` },
        { text: "🏷️ بازسازی بج", callback_data: `repair:refreshbadge${u}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function auctionListKeyboard(rows: { id: number; name: string }[], page: number, hasMore: boolean, userId?: number) {
  const u = getUserSuffix(userId);
  return {
    inline_keyboard: [
      ...rows.map((r) => [
        { text: `❌ لغو: ${r.name} (#${r.id})`, callback_data: `auctionmgr:cancel:${r.id}:${page}${u}` },
      ]),
      [
        { text: "⬅️ قبلی", callback_data: `auctionmgr:page:${Math.max(0, page - 1)}${u}` },
        { text: "➡️ بعدی", callback_data: `auctionmgr:page:${hasMore ? page + 1 : page}${u}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function configPageKeyboard(entries: { key: string; label: string; value: string; type: "int" | "float" }[], page: number, totalPages: number, userId?: number) {
  const u = getUserSuffix(userId);
  const steps = (type: "int" | "float") => (type === "int" ? [1, 10] : [0.01, 0.05]);
  return {
    inline_keyboard: [
      ...entries.map((e) => {
        const [s1, s2] = steps(e.type);
        return [
          { text: `${e.label.slice(0, 22)}: ${e.value}`, callback_data: `cfg:none${u}` },
          { text: `−${s1}`, callback_data: `cfg:adj:${e.key}:${-s1}${u}` },
          { text: `+${s1}`, callback_data: `cfg:adj:${e.key}:${s1}${u}` },
          { text: `−${s2}`, callback_data: `cfg:adj:${e.key}:${-s2}${u}` },
          { text: `+${s2}`, callback_data: `cfg:adj:${e.key}:${s2}${u}` },
        ];
      }),
      [
        { text: "⬅️ قبلی", callback_data: `cfg:page:${Math.max(0, page - 1)}${u}` },
        { text: `${page + 1}/${totalPages}`, callback_data: `cfg:none${u}` },
        { text: "➡️ بعدی", callback_data: `cfg:page:${Math.min(totalPages - 1, page + 1)}${u}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${u}` }],
    ],
  };
}

export function blackjackLobbyKeyboard(gameId: string, mode: "single" | "multi" = "single") {
  return {
    inline_keyboard: [
      [
        { text: "✅ Join", callback_data: `bj:lobby:${gameId}:join` },
        { text: "🚪 Leave", callback_data: `bj:lobby:${gameId}:leave` },
      ],
      [
        { text: "▶️ Start now", callback_data: `bj:lobby:${gameId}:start` },
        { text: "❌ Cancel", callback_data: `bj:lobby:${gameId}:cancel` },
      ],
      [
        { text: mode === "multi" ? "🎮 Mode: Multi 👥" : "🎮 Mode: Single 🂠", callback_data: `bj:lobby:${gameId}:mode` },
        { text: "🏆 Leaderboard", callback_data: `bj:top:${gameId}` },
      ],
      [{ text: "🔄 Refresh", callback_data: `bj:lobby:${gameId}:refresh` }],
    ],
  };
}

/**
 * One shared keyboard, rebuilt per stage:
 *  - betting: the current bettor's panel (Bet / Skip, or draft adjusters)
 *  - playing: the current player's Hit/Stand/Double/Split buttons
 *  - settled (break): join / cash-out buttons for everyone
 */
export function blackjackTableKeyboard(gameId: string, state: PublicBlackjackState) {
  // Between rounds anyone can join, cash out, or (if busted) rebuy.
  if (state.stage === "settled") {
    return {
      inline_keyboard: [
        [
          { text: "✅ Join", callback_data: `bj:lobby:${gameId}:join` },
          { text: "🚪 Leave (cash out)", callback_data: `bj:leavegame:${gameId}` },
        ],
        [
          { text: "🔄 Rebuy", callback_data: `bj:rebuy:${gameId}` },
          { text: "🏆 Leaderboard", callback_data: `bj:top:${gameId}` },
        ],
        [{ text: "🔄 Refresh", callback_data: `bj:lobby:${gameId}:refresh` }],
      ],
    };
  }

  if (state.stage === "betting") {
    const seat = state.currentSeat != null ? state.seats.find((s) => s.index === state.currentSeat) : null;
    if (!seat || seat.pendingBet !== null) return { inline_keyboard: [] };
    const suffix = `:user:${seat.userId}`;
    if (seat.draft != null) {
      return {
        inline_keyboard: [
          BJ_BET_STEPS.slice()
            .reverse()
            .map((step) => ({
              text: `➖ ${fmtRaiseStep(step).slice(1)}`,
              callback_data: `bj:bet:${gameId}:adj:-${step}${suffix}`,
            })),
          BJ_BET_STEPS.map((step) => ({
            text: `➕ ${fmtRaiseStep(step).slice(1)}`,
            callback_data: `bj:bet:${gameId}:adj:${step}${suffix}`,
          })),
          [
            { text: `✅ Confirm: ${seat.draft}`, callback_data: `bj:bet:${gameId}:confirm${suffix}` },
            { text: "↩️ Back", callback_data: `bj:bet:${gameId}:back${suffix}` },
          ],
        ],
      };
    }
    return {
      inline_keyboard: [
        [
          { text: "🎯 Bet", callback_data: `bj:bet:${gameId}:draft${suffix}` },
          { text: "⏭️ Skip", callback_data: `bj:bet:${gameId}:skip${suffix}` },
        ],
      ],
    };
  }

  if (state.stage === "playing") {
    const seat = state.currentSeat != null ? state.seats.find((s) => s.index === state.currentSeat) : null;
    if (!seat || state.currentHand == null) return { inline_keyboard: [] };
    const hand = seat.hands[state.currentHand];
    if (!hand || hand.result !== "pending") return { inline_keyboard: [] };
    const suffix = `:user:${seat.userId}`;
    return {
      inline_keyboard: [
        [
          { text: "👊 Hit", callback_data: `bj:act:${gameId}:hit${suffix}` },
          { text: "✋ Stand", callback_data: `bj:act:${gameId}:stand${suffix}` },
        ],
        [
          { text: "🎯 Double", callback_data: `bj:act:${gameId}:double${suffix}` },
          { text: "🔀 Split", callback_data: `bj:act:${gameId}:split${suffix}` },
        ],
      ],
    };
  }

  return { inline_keyboard: [] };
}

export function titleBoardKeyboard(auctionId: number) {
  return {
    inline_keyboard: [
      [
        { text: "🟢✅ Join", callback_data: `title:join:${auctionId}` },
        { text: "🟡⬆️ +1k", callback_data: `title:bid:${auctionId}:1k` },
        { text: "🟠⬆️ +5k", callback_data: `title:bid:${auctionId}:5k` },
      ],
      [
        { text: "🔢 Custom bid", callback_data: `title:bid:${auctionId}:custom` },
        { text: "🔄 Refresh", callback_data: `title:refresh:${auctionId}` },
      ],
      // Owner-only actions: server-side validation rejects everyone else.
      [
        { text: "🏁 End", callback_data: `title:end:${auctionId}` },
        { text: "❌ Cancel", callback_data: `title:cancel:${auctionId}` },
      ],
    ],
  };
}

export function titleSellerPromptKeyboard(auctionId: number) {
  return {
    inline_keyboard: [
      [
        { text: "✅ تأیید حراج", callback_data: `title:seller:accept:${auctionId}` },
        { text: "❌ رد حراج", callback_data: `title:seller:decline:${auctionId}` },
      ],
    ],
  };
}

export function titleJoinConfirmKeyboard(auctionId: number, userId: number) {
  return {
    inline_keyboard: [
      [
        { text: "✅ تأیید", callback_data: `title:join:confirm:${auctionId}:${userId}` },
        { text: "❌ لغو", callback_data: `title:join:decline:${auctionId}:${userId}` },
      ],
    ],
  };
}

export function pokerLobbyKeyboard(gameId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Join", callback_data: `poker:lobby:${gameId}:join` },
        { text: "🚪 Leave", callback_data: `poker:lobby:${gameId}:leave` },
      ],
      [
        { text: "🤖 Add bot", callback_data: `poker:lobby:${gameId}:bot` },
        { text: "🎚 Buy-in", callback_data: `poker:lobby:${gameId}:buyin` },
      ],
      [
        { text: "▶️ Start", callback_data: `poker:lobby:${gameId}:start` },
        { text: "❌ Cancel", callback_data: `poker:lobby:${gameId}:cancel` },
      ],
      [{ text: "🔄 Refresh", callback_data: `poker:lobby:${gameId}:refresh` }],
    ],
  };
}

export function pokerTableKeyboard(gameId: string, state: PublicPokerState) {
  // Between rounds the table is paused: the only action is cashing out.
  if (state.stage === "showdown") {
    return {
      inline_keyboard: [[{ text: "🚪 Leave (cash out)", callback_data: `poker:leavegame:${gameId}` }]],
    };
  }
  const seat = state.currentTurn != null ? state.seats.find((s) => s.index === state.currentTurn) : null;
  if (!seat) return { inline_keyboard: [] };
  const suffix = `:user:${seat.userId}`;

  // A raise is being drafted: show the confirm panel instead of the normal
  // actions. Nothing is committed until ✅ Confirm is pressed.
  if (state.draft != null) {
    return {
      inline_keyboard: [
        POKER_RAISE_STEPS.slice()
          .reverse()
          .map((step) => ({
            text: `➖ ${fmtRaiseStep(step).slice(1)}`,
            callback_data: `poker:act:${gameId}:adj:-${step}${suffix}`,
          })),
        POKER_RAISE_STEPS.map((step) => ({
          text: `➕ ${fmtRaiseStep(step).slice(1)}`,
          callback_data: `poker:act:${gameId}:adj:${step}${suffix}`,
        })),
        [
          { text: `✅ Confirm: ${state.draft}`, callback_data: `poker:act:${gameId}:confirm${suffix}` },
          { text: "↩️ Back", callback_data: `poker:act:${gameId}:back${suffix}` },
        ],
      ],
    };
  }

  const toCall = Math.max(0, state.currentBet - seat.committedThisStreet);
  const callText = toCall <= 0 ? "✅ Check" : `💰 Call (${toCall})`;
  return {
    inline_keyboard: [
      [
        { text: callText, callback_data: `poker:act:${gameId}:call${suffix}` },
        { text: "✋ Fold", callback_data: `poker:act:${gameId}:fold${suffix}` },
      ],
      POKER_RAISE_STEPS.map((step) => ({
        text: fmtRaiseStep(step),
        callback_data: `poker:act:${gameId}:raise:${step}${suffix}`,
      })),
      [{ text: "🤚 All-in", callback_data: `poker:act:${gameId}:allin${suffix}` }],
    ],
  };
}

export function boosterKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  const tierIcons = ["🟢", "🟡", "🔴", "💎"];
  return {
    inline_keyboard: BOOSTER_TIERS.map((tier, i) => [
      {
        text: `${tierIcons[i] ?? "⚡"} ${tier.emoji} ${tier.label} — ${tier.cost.toLocaleString("en-US")} MP ⏱️${tier.durationSec / 60}m`,
        callback_data: `booster:buy:${tier.id}${userSuffix}`,
      },
    ]).concat([[{ text: "🔙 بازگشت به منو", callback_data: `menu:main${userSuffix}` }]]),
  };
}
