export function mainMenuKeyboard() {
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

export function postMeowKeyboard(groupId: number) {
  return {
    inline_keyboard: [
      [
        { text: "🏆 رتبه‌بندی گروه", callback_data: `cmd:top:${groupId}` },
        { text: "⚙️ مدیریت", callback_data: `menu:group_settings` },
      ],
    ],
  };
}

export function ownerPanelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 آمار ربات", callback_data: "admin:stats" },
        { text: "📢 پیام همگانی", callback_data: "admin:broadcast" },
      ],
      [
        { text: "👥 گروه‌ها", callback_data: "admin:groups" },
        { text: "⚔️ دعواها", callback_data: "admin:duels" },
      ],
      [
        { text: "📝 تراکنش‌ها", callback_data: "admin:audit" },
        { text: "⚙️ تنظیمات", callback_data: "admin:config" },
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
      [{ text: "🔙 بستن پنل", callback_data: "menu:close" }],
    ],
  };
}

export function groupSettingsKeyboard(enabled: boolean, cooldown: number) {
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

export function duelKeyboard(duelId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ قبول می‌کنم", callback_data: `duel:accept:${duelId}` },
        { text: "❌ نه، مرسی", callback_data: `duel:decline:${duelId}` },
      ],
    ],
  };
}

export function userActionKeyboard(userId: number) {
  return {
    inline_keyboard: [
      [
        { text: "➕ +100", callback_data: `useract:add:${userId}:100` },
        { text: "➕ +500", callback_data: `useract:add:${userId}:500` },
        { text: "➕ +1000", callback_data: `useract:add:${userId}:1000` },
      ],
      [
        { text: "➖ -100", callback_data: `useract:sub:${userId}:100` },
        { text: "➖ -500", callback_data: `useract:sub:${userId}:500` },
        { text: "➖ -1000", callback_data: `useract:sub:${userId}:1000` },
      ],
      [
        { text: "🚫 بن", callback_data: `useract:ban:${userId}:0` },
        { text: "✅ آنبن", callback_data: `useract:unban:${userId}:0` },
        { text: "🔄 ریست", callback_data: `useract:reset:${userId}:0` },
      ],
      [
        { text: "📜 تراکنش‌ها", callback_data: `useract:txns:${userId}:0` },
        { text: "🔙 پنل ادمین", callback_data: "menu:admin" },
      ],
    ],
  };
}

export function broadcastConfirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ ارسال به همه", callback_data: "bc:confirm" },
        { text: "❌ لغو", callback_data: "bc:cancel" },
      ],
    ],
  };
}

export function groupManagerKeyboard(page: number) {
  return {
    inline_keyboard: [
      [
        { text: "⬅️ قبلی", callback_data: `groupmgr:page:${Math.max(0, page - 1)}` },
        { text: "➡️ بعدی", callback_data: `groupmgr:page:${page + 1}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: "menu:admin" }],
    ],
  };
}

export function configInlineKeyboard(currentDaily: string, currentMega: string, currentBig: string) {
  const daily = parseInt(currentDaily, 10) || 500;
  const mega = parseFloat(currentMega) || 0.01;
  const big = parseFloat(currentBig) || 0.05;
  return {
    inline_keyboard: [
      [
        { text: "➖", callback_data: `cfg:dec:daily:100` },
        { text: `💰 Daily: ${daily}`, callback_data: "cfg:noop" },
        { text: "➕", callback_data: `cfg:inc:daily:100` },
      ],
      [
        { text: "➖", callback_data: `cfg:dec:mega:0.01` },
        { text: `🌟 Mega: ${mega}`, callback_data: "cfg:noop" },
        { text: "➕", callback_data: `cfg:inc:mega:0.01` },
      ],
      [
        { text: "➖", callback_data: `cfg:dec:big:0.05` },
        { text: `🔥 Big: ${big}`, callback_data: "cfg:noop" },
        { text: "➕", callback_data: `cfg:inc:big:0.05` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: "menu:admin" }],
    ],
  };
}

export function txnAuditKeyboard(page: number) {
  return {
    inline_keyboard: [
      [
        { text: "⬅️ قبلی", callback_data: `audit:page:${Math.max(0, page - 1)}` },
        { text: "➡️ بعدی", callback_data: `audit:page:${page + 1}` },
      ],
      [{ text: "🔙 پنل ادمین", callback_data: "menu:admin" }],
    ],
  };
}
