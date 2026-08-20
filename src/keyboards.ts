import { PublicBlackjackState, PublicPokerState } from "./types";
import { BJ_BET_STEPS, POKER_RAISE_STEPS, BOOSTER_TIERS } from "./constants";

const fmtRaiseStep = (n: number) => (n >= 1000 && n % 1000 === 0 ? `+${n / 1000}K` : `+${n}`);

const getUserSuffix = (userId?: number) => (userId ? `:user:${userId}` : "");export function mainMenuKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "👤 پروفایل من", callback_data: `cmd:me${userSuffix}` },
        { text: "🏆 رتبه گروه", callback_data: `cmd:top${userSuffix}` },
      ],
      [
        { text: "🎰 لاتاری / قمار", callback_data: `cmd:lottery${userSuffix}` },
        { text: "تاس", callback_data: `cmd:dice${userSuffix}` },
      ],
      [
        { text: "🃏 پوکر گروه", callback_data: `cmd:poker${userSuffix}` },
        { text: "♠️ بلک‌جک", callback_data: `cmd:blackjack${userSuffix}` },
      ],
      [
        { text: "💸 انتقال امتیاز", callback_data: `cmd:pay${userSuffix}` },
        { text: "📜 تاریخچه من", callback_data: `cmd:history${userSuffix}` },
      ],
      [
        { text: "⚔️ رتبه دعوا", callback_data: `cmd:duelrank${userSuffix}` },
        { text: "🎉 رویدادهای گروه", callback_data: `cmd:events${userSuffix}` },
      ],
      [
        { text: "🚀 بوستر", callback_data: `cmd:booster${userSuffix}` },
        { text: "📊 آمار گروه", callback_data: `cmd:groupstats${userSuffix}` },
      ],
      [
        { text: "⚙️ تنظیمات گروه", callback_data: `menu:group_settings${userSuffix}` },
        { text: "🆘 راهنمای دستورات", callback_data: `menu:help${userSuffix}` },
      ],
    ],
  };
}

export function postMeowKeyboard(groupId: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "🏆 رتبه‌بندی گروه", callback_data: `cmd:top:${groupId}${userSuffix}` },
        { text: "⚙️ مدیریت", callback_data: `menu:group_settings${userSuffix}` },
      ],
    ],
  };
}

export function ownerPanelKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "📊 آمار ربات", callback_data: `admin:stats${userSuffix}` },
        { text: "📢 پیام همگانی", callback_data: `admin:broadcast${userSuffix}` },
      ],
      [
        { text: "👥 گروه‌ها", callback_data: `admin:groups${userSuffix}` },
        { text: "⚔️ دعواها", callback_data: `admin:duels${userSuffix}` },
      ],
      [
        { text: "📝 تراکنش‌ها", callback_data: `admin:audit${userSuffix}` },
        { text: "⚙️ تنظیمات", callback_data: `admin:config${userSuffix}` },
      ],
      [
        { text: "➕ افزودن امتیاز", callback_data: `admin:addpoints${userSuffix}` },
        { text: "➖ کسر امتیاز", callback_data: `admin:removepoints${userSuffix}` },
      ],
      [
        { text: "🔄 ریست کاربر", callback_data: `admin:resetuser${userSuffix}` },
        { text: "🔧 تعمیرات", callback_data: `admin:maintenance${userSuffix}` },
      ],
      [
        { text: "👤 اطلاعات کاربر", callback_data: `admin:userinfo${userSuffix}` },
        { text: "🚫 بن/آنبن", callback_data: `admin:banmenu${userSuffix}` },
      ],
      [{ text: "🔙 بستن پنل", callback_data: `menu:close${userSuffix}` }],
    ],
  };
}

export function groupSettingsKeyboard(enabled: boolean, cooldown: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        {
          text: `🤖 ربات: ${enabled ? "✅ روشن" : "❌ خاموش"}`,
          callback_data: `group:toggle_bot${userSuffix}`,
        },
      ],
      [{ text: `⏱️ کول‌داون: ${cooldown}s`, callback_data: `group:set_cooldown${userSuffix}` }],
      [{ text: "🔄 ریست لیدربورد", callback_data: `group:reset_lb${userSuffix}` }],
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
      { text: "🎫 1 بلیت", callback_data: `lottery:buy:1${userSuffix}` },
      { text: "🎫 3 بلیت", callback_data: `lottery:buy:3${userSuffix}` },
      { text: "🎫 4 بلیت", callback_data: `lottery:buy:4${userSuffix}` },
    ],
    [
      { text: "🎫 8 بلیت", callback_data: `lottery:buy:8${userSuffix}` },
      { text: "🎫 9 بلیت", callback_data: `lottery:buy:9${userSuffix}` },
      { text: "🎫 10 بلیت", callback_data: `lottery:buy:10${userSuffix}` },
    ],
    [
      { text: "📊 وضعیت لاتاری", callback_data: `lottery:status${userSuffix}` },
      { text: "🧾 بلیت‌های من", callback_data: `lottery:my_tickets${userSuffix}` },
    ],
    [
      { text: "❓ راهنما", callback_data: `lottery:help${userSuffix}` },
    ],
  ];

  // The draw is available to the bot owner AND group admins (server-side
  // check in the lottery:draw branch); price/pot adjustments stay owner-only.
  if (canDraw) {
    buttons.push([{ text: "🎯 قرعه‌کشی", callback_data: `lottery:draw${userSuffix}` }]);
  }

  if (isOwner) {
    buttons.push([
      { text: "➕ قیمت بلیت +50", callback_data: `lottery:adjust_price:+50${userSuffix}` },
      { text: "➖ قیمت بلیت -50", callback_data: `lottery:adjust_price:-50${userSuffix}` },
    ]);
    buttons.push([
      { text: "➕ پات +100", callback_data: `lottery:adjust_pot:+100${userSuffix}` },
      { text: "➖ پات -100", callback_data: `lottery:adjust_pot:-100${userSuffix}` },
    ]);
  }

  buttons.push([{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }]);

  return { inline_keyboard: buttons };
}

export function duelKeyboard(duelId: string, targetId?: number, challengerId?: number) {
  const targetSuffix = getUserSuffix(targetId);
  const buttons = [
    [
      { text: "✅ قبول می‌کنم", callback_data: `duel:accept:${duelId}${targetSuffix}` },
      { text: "❌ نه، مرسی", callback_data: `duel:decline:${duelId}${targetSuffix}` },
    ],
  ];
  if (challengerId) {
    buttons.push([
      // Scoped to the challenger so only they can withdraw their own challenge.
      { text: "🚫 لغو دعوا", callback_data: `duel:cancel:${duelId}${getUserSuffix(challengerId)}` },
    ]);
  }
  return { inline_keyboard: buttons };
}

export function userActionKeyboard(userId: number, ownerId?: number) {
  const userSuffix = getUserSuffix(ownerId);
  return {
    inline_keyboard: [
      [
        { text: "➕ +100", callback_data: `useract:add:${userId}:100${userSuffix}` },
        { text: "➕ +500", callback_data: `useract:add:${userId}:500${userSuffix}` },
        { text: "➕ +1000", callback_data: `useract:add:${userId}:1000${userSuffix}` },
      ],
      [
        { text: "➖ -100", callback_data: `useract:sub:${userId}:100${userSuffix}` },
        { text: "➖ -500", callback_data: `useract:sub:${userId}:500${userSuffix}` },
        { text: "➖ -1000", callback_data: `useract:sub:${userId}:1000${userSuffix}` },
      ],
      [
        { text: "🚫 بن", callback_data: `useract:ban:${userId}:0${userSuffix}` },
        { text: "✅ آنبن", callback_data: `useract:unban:${userId}:0${userSuffix}` },
        { text: "🔄 ریست", callback_data: `useract:reset:${userId}:0${userSuffix}` },
      ],
      [
        { text: "📜 تراکنش‌ها", callback_data: `useract:txns:${userId}:0${userSuffix}` },
        { text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` },
      ],
    ],
  };
}

export function broadcastConfirmKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "✅ ارسال به همه", callback_data: `bc:confirm${userSuffix}` },
        { text: "❌ لغو", callback_data: `bc:cancel${userSuffix}` },
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
    [{ text: "➕ افزودن رویداد", callback_data: `event:add${userSuffix}` }],
  ];

  if (hasActiveEvent) {
    buttons.push([
      { text: "✏️ ویرایش رویداد", callback_data: `event:edit${userSuffix}` },
      { text: "⏹️ پایان رویداد", callback_data: `event:end${userSuffix}` },
    ]);
  }

  buttons.push([{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }]);

  return { inline_keyboard: buttons };
}

export function txnAuditKeyboard(page: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "⬅️ قبلی", callback_data: `audit:page:${Math.max(0, page - 1)}${userSuffix}` },
        { text: "➡️ بعدی", callback_data: `audit:page:${page + 1}${userSuffix}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` }],
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
        { text: "✅ Join", callback_data: `title:join:${auctionId}` },
        { text: "⬆️ +1k", callback_data: `title:bid:${auctionId}:1k` },
        { text: "⬆️ +5k", callback_data: `title:bid:${auctionId}:5k` },
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
  return {
    inline_keyboard: BOOSTER_TIERS.map((tier) => [
      {
        text: `${tier.emoji} ${tier.label} — ${tier.cost.toLocaleString("en-US")} MP (${tier.durationSec / 60} min)`,
        callback_data: `booster:buy:${tier.id}${userSuffix}`,
      },
    ]).concat([[{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }]]),
  };
}
