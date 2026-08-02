export type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_OWNER_ID: string;
  WEBHOOK_SECRET: string;
  CACHE?: KVNamespace;
  HOKM_GAME: DurableObjectNamespace;
  HOKM_APP_URL?: string;
  MEOW_VIP_USER_ID?: string;
  HOKM_JOIN_TIMEOUT_SEC?: number;
  HOKM_TURN_TIMEOUT_SEC?: number;
  HOKM_TRUMP_TIMEOUT_SEC?: number;
  HOKM_RECONNECT_GRACE_SEC?: number;
  HOKM_AFK_STRIKES?: number;
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

export type HokmSuit = "S" | "H" | "D" | "C";

export type HokmPhase =
  | "waiting_join"
  | "drawing_hakem"
  | "trump_call"
  | "playing"
  | "hand_over"
  | "match_over"
  | "cancelled";

export interface HokmSeatInfo {
  userId: number;
  name: string;
  seat: number;
}

export interface HokmGameState {
  v: 1;
  gameId: string;
  groupId: number;
  bet: number;
  perPlayer: number;
  boardMsgId: number | null;
  appUrl: string;
  phase: HokmPhase;
  seats: (HokmSeatInfo | null)[];
  hands: Record<number, string[]>;
  firstFive: string[];
  trumpSuit: HokmSuit | null;
  hakemSeat: number | null;
  leaderSeat: number | null;
  currentSeat: number | null;
  trickPlays: Array<{ seat: number; card: string }>;
  trickWinnerSeat: number | null;
  tricksWon: number[];
  handScores: [number, number];
  matchScores: [number, number];
  handWinnerTeam: number | null;
  handPoints: number | null;
  handNumber: number;
  strikes: number[];
  turnDeadline: number | null;
  alarmKind: "join" | "draw" | "deal" | "trump" | "turn" | null;
  drawOrder: string[];
  drawIndex: number;
  result: string | null;
  winnerTeam: number | null;
}

export interface PublicHokmState {
  phase: HokmPhase;
  seats: (HokmSeatInfo | null)[];
  connected: number[];
  trumpSuit: HokmSuit | null;
  hakemSeat: number | null;
  leaderSeat: number | null;
  currentSeat: number | null;
  trickPlays: Array<{ seat: number; card: string }>;
  trickWinnerSeat: number | null;
  tricksWon: number[];
  handScores: [number, number];
  matchScores: [number, number];
  handWinnerTeam: number | null;
  handPoints: number | null;
  handNumber: number;
  strikes: number[];
  turnDeadline: number | null;
  bet: number;
  perPlayer: number;
  result: string | null;
  winnerTeam: number | null;
  drawIndex: number;
}
