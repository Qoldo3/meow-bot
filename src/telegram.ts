import { TelegramCallbackQuery, TelegramChat, TelegramMessage, TelegramUser } from "./types";

export async function telegramRequest(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<any> {
  try {
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
  } catch (err) {
    console.error(`[TG ${method}] network error:`, err);
    return { ok: false };
  }
}

export function sendMessage(
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

export async function answerCallback(
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

export async function setMyCommands(token: string, commands: { command: string; description: string }[]) {
  await telegramRequest(token, "setMyCommands", { commands });
}

export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any
) {
  return telegramRequest(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

export async function deleteMessage(token: string, chatId: number, messageId: number) {
  await telegramRequest(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

export async function isGroupAdmin(
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
