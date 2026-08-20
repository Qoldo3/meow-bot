/** Minimal shape of the Hono context used by request handlers. */
export type RequestContext = {
  req: { url: string };
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
};

export type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_OWNER_ID: string;
  WEBHOOK_SECRET: string;
  CACHE?: KVNamespace;
  MEOW_VIP_USER_ID?: string;
  POKER_GAME: DurableObjectNamespace;
  BLACKJACK_GAME: DurableObjectNamespace;
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
    message_id?: number;
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

import type { Card } from "./poker";

export type PokerStage = "lobby" | "preflop" | "flop" | "turn" | "river" | "showdown" | "ended";

export type PokerSeat = {
  index: number;
  userId: number;
  name: string;
  chips: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  totalBetThisHand: number;
  committedThisStreet: number;
  lastAction: string;
  isBot: boolean;
  pendingDeal: boolean;
  /** Set when the player cashed out between rounds; they no longer play. */
  left: boolean;
};

export type PokerGameState = {
  v: number;
  gameId: string;
  groupId: number;
  messageId: number;
  hostId: number;
  buyIn: number;
  /** Real escrowed money still at stake (bots add no real chips). */
  realPot: number;
  seats: PokerSeat[];
  deck: Card[];
  board: Card[];
  pot: number;
  stage: PokerStage;
  currentTurn: number | null;
  actionDeadline: number | null;
  currentBet: number;
  lastRaiseSize: number;
  /** Raise-to amount being drafted in the confirm panel (null = no draft). */
  draft: number | null;
  dealerIndex: number;
  handNumber: number;
  lobbyDeadline: number;
  /** Deadline for the between-rounds break (next hand starts at this time). */
  breakDeadline: number | null;
  alarmKind: "lobby" | "turn" | "break" | null;
  /** Monotonic counter for bot user ids so leaving players never collide with new bots. */
  nextBotId: number;
  cancelled: boolean;
  lastActionText: string;
  resultText: string | null;
  winnerIds: number[] | null;
  endedAt: number | null;
};

// ---------------------------------------------------------------------------
// Blackjack (بلکجک) — the group treasury is the house bank.
// ---------------------------------------------------------------------------

export type BlackjackStage = "lobby" | "betting" | "playing" | "dealer" | "settled" | "ended";

/**
 * single: everyone's cards are face-up on the shared group table (classic
 *         mini-baccarat style blackjack — each player vs the dealer).
 * multi: each player's hand is hidden and shown only in their private chat
 *        with the bot (PV); the group table shows only the dealer's cards.
 */
export type BlackjackMode = "single" | "multi";

export type BlackjackHandResult =
  | "pending" // still being played
  | "stand" // player finished drawing; awaits settlement
  | "natural" // natural blackjack on the first two cards
  | "bust"
  | "win"
  | "loss"
  | "push";

export type BlackjackHand = {
  cards: Card[];
  /** Current bet on this hand (doubled hands carry the doubled amount). */
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  result: BlackjackHandResult;
};

export type BlackjackSeat = {
  index: number;
  userId: number;
  name: string;
  chips: number;
  /** Draft bet being adjusted in the bet panel (null = no draft). */
  draft: number | null;
  /** null = hasn't acted this round; 0 = skipped; >0 = bet placed. */
  pendingBet: number | null;
  hands: BlackjackHand[];
  lastAction: string;
  /** Cashed out between rounds; no longer plays. */
  left: boolean;
  /** Ran out of chips; eliminated (can rebuy between rounds). */
  busted: boolean;
  /** Message id of the player's private hand message (multi mode only). */
  pvMsgId: number | null;
};

export type BlackjackGameState = {
  v: number;
  gameId: string;
  groupId: number;
  messageId: number;
  /** The handler's "game created" confirmation message; deleted when play starts. */
  noticeMsgId: number | null;
  hostId: number;
  buyIn: number;
  seats: BlackjackSeat[];
  /** single (all cards face-up in the group) | multi (hidden hands via PV). */
  mode: BlackjackMode;
  deck: Card[];
  /** Cards already drawn this round; reshuffled into the deck when it runs low. */
  discard: Card[];
  dealerCards: Card[];
  dealerHoleRevealed: boolean;
  stage: BlackjackStage;
  roundNumber: number;
  currentSeat: number | null;
  currentHand: number | null;
  actionDeadline: number | null;
  betDeadline: number | null;
  lobbyDeadline: number;
  breakDeadline: number | null;
  alarmKind: "lobby" | "bet" | "turn" | "dealer" | "break" | null;
  cancelled: boolean;
  lastActionText: string;
  resultText: string | null;
  endedAt: number | null;
};

export type PublicBlackjackState = {
  gameId: string;
  groupId: number;
  messageId: number;
  stage: BlackjackStage;
  mode: BlackjackMode;
  buyIn: number;
  roundNumber: number;
  dealerCards: Card[];
  dealerHoleRevealed: boolean;
  currentSeat: number | null;
  currentHand: number | null;
  actionDeadline: number | null;
  betDeadline: number | null;
  lobbyDeadline: number;
  breakDeadline: number | null;
  hostId: number;
  cancelled: boolean;
  seats: Array<{
    index: number;
    userId: number;
    name: string;
    chips: number;
    draft: number | null;
    pendingBet: number | null;
    hands: BlackjackHand[];
    lastAction: string;
    left: boolean;
    busted: boolean;
  }>;
  lastActionText: string;
  resultText: string | null;
  endedAt: number | null;
};

export type PublicPokerState = {
  gameId: string;
  groupId: number;
  messageId: number;
  stage: PokerStage;
  buyIn: number;
  pot: number;
  board: Card[];
  currentBet: number;
  lastRaiseSize: number;
  /** Raise-to amount being drafted in the confirm panel (null = no draft). */
  draft: number | null;
  currentTurn: number | null;
  actionDeadline: number | null;
  handNumber: number;
  hostId: number;
  cancelled: boolean;
  seats: Array<{
    index: number;
    userId: number;
    name: string;
    chips: number;
    holeCardCount: number;
    folded: boolean;
    allIn: boolean;
    hasActed: boolean;
    committedThisStreet: number;
    lastAction: string;
    isBot: boolean;
    pendingDeal: boolean;
    left: boolean;
  }>;
  lastActionText: string;
  resultText: string | null;
  winnerIds: number[] | null;
};
