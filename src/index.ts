import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
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
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const app = new Hono<{ Bindings: Bindings }>();

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegramRequest(
  token: string,
  method: string,
  body: Record<string, unknown>
) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return response.json();
}

/* =========================================================
   MEOW DETECTION
========================================================= */

function isMeow(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // English:
  // meow
  // meooow
  // meooooow
  // meow meow
  if (/^(meo+w+\s*)+$/.test(normalized)) {
    return true;
  }

  // Persian:
  // میو
  // میوو
  // میووو
  // میو میو
  if (/^(می+و+\s*)+$/.test(normalized)) {
    return true;
  }

  return false;
}

/* =========================================================
   RANDOM MEOW POINTS
========================================================= */

function randomMeowPoints(): number {
  const roll = Math.random();

  // 1% chance
  if (roll < 0.01) {
    return 1000;
  }

  // 4% chance
  if (roll < 0.05) {
    return Math.floor(Math.random() * 400) + 100;
  }

  // 95% chance
  return Math.floor(Math.random() * 50) + 1;
}

/* =========================================================
   USER CREATION
========================================================= */

async function ensureUser(
  db: D1Database,
  user: TelegramUser
) {
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(`
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        created_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id)
      DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `)
    .bind(
      user.id,
      user.username ?? null,
      user.first_name,
      now
    )
    .run();
}

/* =========================================================
   GROUP CREATION
========================================================= */

async function ensureGroup(
  db: D1Database,
  chat: TelegramChat
) {
  if (
    chat.type !== "group" &&
    chat.type !== "supergroup"
  ) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(`
      INSERT INTO groups (
        telegram_group_id,
        title,
        created_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_group_id)
      DO UPDATE SET
        title = excluded.title
    `)
    .bind(
      chat.id,
      chat.title ?? "Unknown Group",
      now
    )
    .run();
}

/* =========================================================
   AWARD MEOW
========================================================= */

async function awardMeow(
  db: D1Database,
  user: TelegramUser,
  chat: TelegramChat
): Promise<number | null> {

  const now = Math.floor(Date.now() / 1000);

  await ensureUser(db, user);

  // Check cooldown
  const existing = await db
    .prepare(`
      SELECT last_meow_at
      FROM users
      WHERE telegram_id = ?
    `)
    .bind(user.id)
    .first<{
      last_meow_at: number | null;
    }>();

  if (
    existing?.last_meow_at &&
    now - existing.last_meow_at < 5
  ) {
    return null;
  }

  const points = randomMeowPoints();

  // Update global user balance
  await db
    .prepare(`
      UPDATE users
      SET
        meow_points = meow_points + ?,
        total_meows = total_meows + 1,
        last_meow_at = ?
      WHERE telegram_id = ?
    `)
    .bind(
      points,
      now,
      user.id
    )
    .run();

  // Save transaction
  await db
    .prepare(`
      INSERT INTO transactions (
        telegram_user_id,
        amount,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      user.id,
      points,
      "MEOW",
      now
    )
    .run();

  // Group-specific points
  if (
    chat.type === "group" ||
    chat.type === "supergroup"
  ) {
    await ensureGroup(db, chat);

    await db
      .prepare(`
        INSERT INTO group_members (
          telegram_group_id,
          telegram_user_id,
          username,
          first_name,
          meow_points,
          total_meows
        )
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(
          telegram_group_id,
          telegram_user_id
        )
        DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          meow_points =
            group_members.meow_points + ?,
          total_meows =
            group_members.total_meows + 1
      `)
      .bind(
        chat.id,
        user.id,
        user.username ?? null,
        user.first_name,
        points,
        points
      )
      .run();
  }

  return points;
}

/* =========================================================
   USER STATS
========================================================= */

async function getUserStats(
  db: D1Database,
  userId: number
) {
  return db
    .prepare(`
      SELECT
        meow_points,
        total_meows
      FROM users
      WHERE telegram_id = ?
    `)
    .bind(userId)
    .first<{
      meow_points: number;
      total_meows: number;
    }>();
}

/* =========================================================
   GLOBAL RANK
========================================================= */

async function getGlobalRank(
  db: D1Database,
  userId: number
): Promise<number> {

  const result = await db
    .prepare(`
      SELECT COUNT(*) + 1 AS rank
      FROM users
      WHERE meow_points > (
        SELECT meow_points
        FROM users
        WHERE telegram_id = ?
      )
    `)
    .bind(userId)
    .first<{
      rank: number;
    }>();

  return result?.rank ?? 0;
}

/* =========================================================
   /START
========================================================= */

async function handleStart(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (!message.from) return;

  await ensureUser(db, message.from);

  await telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: message.chat.id,

      text:
        `🐱 سلام ${message.from.first_name}!\n\n` +
        `به دنیای Meow Points خوش اومدی! 🎉\n\n` +
        `هر وقت توی گروه بنویسی:\n\n` +
        `🐱 میو\n` +
        `🐱 میووو\n` +
        `🐱 meow\n\n` +
        `ممکنه Meow Points بگیری! ✨\n\n` +
        `دستورات:\n` +
        `/me - پروفایل من\n` +
        `/top - رتبه‌بندی گروه\n` +
        `/global - رتبه‌بندی جهانی\n` +
        `/daily - جایزه روزانه`,

      reply_to_message_id:
        message.message_id,
    }
  );
}

/* =========================================================
   /ME
========================================================= */

async function handleMe(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (!message.from) return;

  await ensureUser(db, message.from);

  const stats = await getUserStats(
    db,
    message.from.id
  );

  const rank = await getGlobalRank(
    db,
    message.from.id
  );

  await telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: message.chat.id,

      text:
        `🐱 پروفایل ${message.from.first_name}\n\n` +
        `💰 Meow Points: ${stats?.meow_points ?? 0}\n` +
        `🐾 Total Meows: ${stats?.total_meows ?? 0}\n` +
        `🏆 Global Rank: #${rank}`,
    }
  );
}

/* =========================================================
   /TOP
========================================================= */

async function handleTop(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (
    message.chat.type !== "group" &&
    message.chat.type !== "supergroup"
  ) {
    await telegramRequest(
      token,
      "sendMessage",
      {
        chat_id: message.chat.id,
        text:
          "🐱 دستور /top فقط داخل گروه کار می‌کنه!",
      }
    );

    return;
  }

  const results = await db
    .prepare(`
      SELECT
        first_name,
        username,
        meow_points
      FROM group_members
      WHERE telegram_group_id = ?
      ORDER BY meow_points DESC
      LIMIT 10
    `)
    .bind(message.chat.id)
    .all<{
      first_name: string;
      username: string | null;
      meow_points: number;
    }>();

  if (!results.results.length) {
    await telegramRequest(
      token,
      "sendMessage",
      {
        chat_id: message.chat.id,
        text:
          "🐱 هنوز کسی Meow نکرده!",
      }
    );

    return;
  }

  const medals = [
    "🥇",
    "🥈",
    "🥉",
  ];

  const lines = results.results.map(
    (user, index) => {

      const medal =
        medals[index] ??
        `${index + 1}.`;

      return (
        `${medal} ${user.first_name}` +
        ` — ${user.meow_points} MP`
      );
    }
  );

  await telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: message.chat.id,

      text:
        `🏆 Meow Leaderboard\n\n` +
        lines.join("\n"),
    }
  );
}

/* =========================================================
   /GLOBAL
========================================================= */

async function handleGlobal(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  const results = await db
    .prepare(`
      SELECT
        first_name,
        username,
        meow_points
      FROM users
      ORDER BY meow_points DESC
      LIMIT 10
    `)
    .all<{
      first_name: string;
      username: string | null;
      meow_points: number;
    }>();

  if (!results.results.length) {
    await telegramRequest(
      token,
      "sendMessage",
      {
        chat_id: message.chat.id,
        text:
          "🐱 هنوز کسی Meow نکرده!",
      }
    );

    return;
  }

  const medals = [
    "🥇",
    "🥈",
    "🥉",
  ];

  const lines = results.results.map(
    (user, index) => {

      const medal =
        medals[index] ??
        `${index + 1}.`;

      return (
        `${medal} ${user.first_name}` +
        ` — ${user.meow_points} MP`
      );
    }
  );

  await telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: message.chat.id,

      text:
        `🌍 Global Meow Leaderboard\n\n` +
        lines.join("\n"),
    }
  );
}

/* =========================================================
   /DAILY
========================================================= */

async function handleDaily(
  token: string,
  db: D1Database,
  message: TelegramMessage
) {
  if (!message.from) return;

  await ensureUser(db, message.from);

  const now = Math.floor(Date.now() / 1000);

  const user = await db
    .prepare(`
      SELECT
        meow_points,
        last_daily_at,
        daily_streak
      FROM users
      WHERE telegram_id = ?
    `)
    .bind(message.from.id)
    .first<{
      meow_points: number;
      last_daily_at: number | null;
      daily_streak: number;
    }>();

  if (
    user?.last_daily_at &&
    now - user.last_daily_at < 86400
  ) {
    const remaining =
      86400 -
      (now - user.last_daily_at);

    const hours =
      Math.ceil(remaining / 3600);

    await telegramRequest(
      token,
      "sendMessage",
      {
        chat_id: message.chat.id,

        text:
          `🎁 جایزه امروزت رو قبلاً گرفتی!\n\n` +
          `⏰ حدود ${hours} ساعت دیگه دوباره امتحان کن.`,
      }
    );

    return;
  }

  const reward = 500;

  const streak =
    (user?.daily_streak ?? 0) + 1;

  await db
    .prepare(`
      UPDATE users
      SET
        meow_points = meow_points + ?,
        daily_streak = ?,
        last_daily_at = ?
      WHERE telegram_id = ?
    `)
    .bind(
      reward,
      streak,
      now,
      message.from.id
    )
    .run();

  await db
    .prepare(`
      INSERT INTO transactions (
        telegram_user_id,
        amount,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      message.from.id,
      reward,
      "DAILY_REWARD",
      now
    )
    .run();

  await telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: message.chat.id,

      text:
        `🎁 جایزه روزانه!\n\n` +
        `💰 +${reward} Meow Points\n` +
        `🔥 Streak: ${streak} روز`,
    }
  );
}

/* =========================================================
   WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (c) => {

    const update =
      await c.req.json<TelegramUpdate>();

    const message =
      update.message;

    if (!message) {
      return c.json({
        ok: true,
      });
    }

    const user =
      message.from;

    if (
      !user ||
      user.is_bot
    ) {
      return c.json({
        ok: true,
      });
    }

    const text =
      message.text?.trim();

    if (!text) {
      return c.json({
        ok: true,
      });
    }

    const command =
      text.split(/\s+/)[0]
        .toLowerCase();

    /* COMMANDS */

    if (command === "/start") {
      await handleStart(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.DB,
        message
      );

      return c.json({
        ok: true,
      });
    }

    if (command === "/me") {
      await handleMe(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.DB,
        message
      );

      return c.json({
        ok: true,
      });
    }

    if (command === "/top") {
      await handleTop(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.DB,
        message
      );

      return c.json({
        ok: true,
      });
    }

    if (command === "/global") {
      await handleGlobal(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.DB,
        message
      );

      return c.json({
        ok: true,
      });
    }

    if (command === "/daily") {
      await handleDaily(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.DB,
        message
      );

      return c.json({
        ok: true,
      });
    }

    /* MEOW */

    if (isMeow(text)) {

      const points =
        await awardMeow(
          c.env.DB,
          user,
          message.chat
        );

      // Cooldown
      if (points === null) {
        return c.json({
          ok: true,
        });
      }

      let response =
        `🐱 میووو!\n\n` +
        `✨ +${points} Meow Points`;

      if (points >= 1000) {
        response =
          `🌟 MEGA MEOW!!! 🌟\n\n` +
          `💰 +${points} Meow Points!`;
      } else if (points >= 100) {
        response =
          `🔥 BIG MEOW! 🔥\n\n` +
          `💰 +${points} Meow Points!`;
      }

      await telegramRequest(
        c.env.TELEGRAM_BOT_TOKEN,
        "sendMessage",
        {
          chat_id:
            message.chat.id,

          text: response,

          reply_to_message_id:
            message.message_id,
        }
      );
    }

    return c.json({
      ok: true,
    });
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/",
  (c) => {
    return c.json({
      ok: true,
      bot: "Meow Points",
      status: "online",
    });
  }
);

export default app;