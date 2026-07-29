export type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_OWNER_ID: string;
  WEBHOOK_SECRET: string;
};

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: {
    from?: TelegramUser;
    text?: string;
  };
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: {
    message_id: number;
    chat: TelegramChat;
  };
  data?: string;
};

export type TelegramChatMemberUpdated = {
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

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
};

export type DuelState = {
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
