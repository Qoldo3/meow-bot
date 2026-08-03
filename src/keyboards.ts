const getUserSuffix = (userId?: number) => (userId ? `:user:${userId}` : "");

export function mainMenuKeyboard(userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "👤 پروفایل من", callback_data: `cmd:me${userSuffix}` },
        { text: "🎁 جایزه روزانه", callback_data: `cmd:daily${userSuffix}` },
      ],
      [
        { text: "🏆 رتبه گروه", callback_data: `cmd:top${userSuffix}` },
        { text: "🌍 رتبه جهانی", callback_data: `cmd:global${userSuffix}` },
      ],
      [
        { text: "🎰 لاتاری / قمار", callback_data: `cmd:lottery${userSuffix}` },
        { text: "تاس", callback_data: `cmd:dice${userSuffix}` },
      ],
      [
        { text: "💸 انتقال امتیاز", callback_data: `cmd:pay${userSuffix}` },
        { text: "🏦 خزانه گروه", callback_data: `cmd:treasury${userSuffix}` },
      ],
      [
        { text: "🏹 قبیله", callback_data: `cmd:clan${userSuffix}` },
        { text: "📜 تاریخچه من", callback_data: `cmd:history${userSuffix}` },
      ],
      [
        { text: "⚔️ رتبه دعوا", callback_data: `cmd:duelrank${userSuffix}` },
        { text: "🎉 رویدادهای گروه", callback_data: `cmd:events${userSuffix}` },
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
      [{ text: `💰 خزانه گروه: ${treasuryBalance} MP`, callback_data: `treasury:status${userSuffix}` }],
      [{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }],
    ],
  };
}

export function clanKeyboard(hasClan: boolean, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  const buttons: any[] = [];
  buttons.push([{ text: "👥 وضعیت قبیله", callback_data: `clan:status${userSuffix}` }]);
  if (hasClan) {
    buttons.push([{ text: "🚪 خروج از قبیله", callback_data: `clan:leave${userSuffix}` }]);
  } else {
    buttons.push([{ text: "➕ ایجاد قبیله", callback_data: `clan:create${userSuffix}` }]);
    buttons.push([{ text: "🔰 عضویت در قبیله", callback_data: `clan:join${userSuffix}` }]);
  }
  buttons.push([{ text: "🔙 بازگشت", callback_data: `menu:main${userSuffix}` }]);
  return { inline_keyboard: buttons };
}

export function lotteryKeyboard(isOwner: boolean, userId?: number) {
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

  if (isOwner) {
    buttons.push([{ text: "🎯 قرعه‌کشی", callback_data: `lottery:draw${userSuffix}` }]);
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

export function duelKeyboard(duelId: string, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "✅ قبول می‌کنم", callback_data: `duel:accept:${duelId}${userSuffix}` },
        { text: "❌ نه، مرسی", callback_data: `duel:decline:${duelId}${userSuffix}` },
      ],
    ],
  };
}

export function hokmSeatKeyboard(gameId: string) {
  return {
    inline_keyboard: [
      [
        { text: "🪑 صندلی ۱", callback_data: `hokm:seat:${gameId}:1` },
        { text: "🪑 صندلی ۲", callback_data: `hokm:seat:${gameId}:2` },
        { text: "🪑 صندلی ۳", callback_data: `hokm:seat:${gameId}:3` },
      ],
    ],
  };
}

export function hokmBoardKeyboard(gameId: string, appUrl: string) {
  return {
    inline_keyboard: [
      [
        { text: "♠️ بازی را باز کن", web_app: { url: `${appUrl}/hokm.html?game=${gameId}` } },
      ],
      [
        { text: "❌ لغو بازی", callback_data: `hokm:cancel:${gameId}` },
      ],
    ],
  };
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

export function groupManagerKeyboard(page: number, userId?: number) {
  const userSuffix = getUserSuffix(userId);
  return {
    inline_keyboard: [
      [
        { text: "⬅️ قبلی", callback_data: `groupmgr:page:${Math.max(0, page - 1)}${userSuffix}` },
        { text: "➡️ بعدی", callback_data: `groupmgr:page:${page + 1}${userSuffix}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: `menu:admin${userSuffix}` }],
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
