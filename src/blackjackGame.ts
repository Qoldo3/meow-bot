import {
  Bindings,
  BlackjackGameState,
  BlackjackHand,
  BlackjackSeat,
  PublicBlackjackState,
} from "./types";
import { cardToString, newDeck, shuffle } from "./poker";
import type { Card } from "./poker";
import {
  betExposure,
  canDouble,
  canSplit,
  dealerMustHit,
  handExposure,
  handValue,
  isNatural,
  nextPlayableHand,
  payoutFor,
  renderHand,
  resolveHandResult,
} from "./blackjack";
import {
  BJ_BET_TIMEOUT_SEC,
  BJ_COUNTDOWN_TICK_MS,
  BJ_DEALER_REVEAL_MS,
  BJ_HAND_LIMIT,
  BJ_LOBBY_TIMEOUT_SEC,
  BJ_MAX_BUYIN,
  BJ_MAX_PLAYERS,
  BJ_MIN_BET,
  BJ_MIN_BUYIN,
  BJ_ROUND_BREAK_MS,
  BJ_TURN_TIMEOUT_SEC,
} from "./constants";
import { deleteMessage, editMessageText, isGroupAdmin, sendMessage } from "./telegram";
import { blackjackLobbyKeyboard, blackjackTableKeyboard } from "./keyboards";
import { escapeHtml } from "./utils";

type RpcBody = Record<string, unknown>;

/** Persian cheat-sheet shown in the lobby message (first contact with the game). */
const BJ_RULES_TEXT_FA = `📖 <b>ارزش کارت‌ها و قوانین</b>
` +
  `🂠 آس = ۱۱ (یا ۱) · شاه/بی‌بی/سرباز = ۱۰ · ۲ تا ۱۰ = همان عدد
` +
  `🎯 به ۲۱ برس یا از دیلر بیشتر شو، بدون اینکه از ۲۱ بگذری (Bust)!
` +
  `👊 Hit = کارت بگیر · ✋ Stand = همین جمع بمان
` +
  `🎯 Double = شرطت را دو برابر کن، فقط یک کارت (فقط دو کارت اول)
` +
  `🔀 Split = دو کارت هم‌ارز را جدا کن و دو دست بازی کن (تا ۴ دست)
` +
  `🃏 بلک‌جک (آس + ده‌بازی) = ۲.۵ برابر می‌دهد · برد = ۲ برابر
` +
  `🏦 تساوی = نصف شرط برمی‌گردد · دیلر روی ۱۷ نرم می‌ایستد`;

/**
 * Authoritative in-group Blackjack game. One DO instance per game
 * (idFromName(gameId)); state is a single JSON blob under "state". A
 * self-scheduling alarm drives the lobby countdown (60s auto-start), the
 * sequential bet turns, player turn timeouts (auto-stand), the staggered
 * dealer reveal, and the between-rounds break.
 *
 * Money model — the group treasury is the house bank:
 *  - Buy-in is escrowed from group_members.meow_points on join -> chips.
 *  - Each round players bet from their chips (deducted at bet confirm).
 *  - On settlement the house pays wins / collects losses via
 *    telegram_groups.treasury_balance, one ledger row per round
 *    (reason 'blackjack:round', reference_id = game_id).
 *  - Solvency guard: worst-case payout for all active hands must stay
 *    <= treasury_balance at bet time, and again when doubling/splitting.
 *    Settlements also use a guarded UPDATE so the treasury can never go
 *    negative even under a cross-game race.
 *  - Players cash out their remaining chips between rounds (or at game
 *    end/cancel) with one DB write.
 */
export class BlackjackGame {
  private state: DurableObjectState;
  private env: Bindings;
  private g: BlackjackGameState | null = null;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  // ---- persistence -------------------------------------------------------

  private async load(): Promise<BlackjackGameState | null> {
    if (this.g) return this.g;
    const stored = await this.state.storage.get<BlackjackGameState>("state");
    if (stored) {
      // Backfill fields added after the initial deploy (state is a JSON blob).
      if (!Array.isArray(stored.discard)) stored.discard = [];
      if (stored.noticeMsgId == null) stored.noticeMsgId = null;
      if (stored.mode !== "single" && stored.mode !== "multi") stored.mode = "single";
      for (const s of stored.seats) {
        if (s.pvMsgId == null) s.pvMsgId = null;
      }
      this.g = stored;
    }
    return this.g;
  }

  private async persist(): Promise<void> {
    if (!this.g) return;
    await this.state.storage.put("state", this.g);
  }

  private json(obj: unknown): Response {
    return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });
  }

  // ---- RPC entry ---------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body: RpcBody = (request.method === "POST" ? await request.json().catch(() => ({})) : {}) as RpcBody;
    return this.state.blockConcurrencyWhile(async () => {
      try {
        switch (url.pathname) {
          case "/create":
            return await this.rpcCreate(body);
          case "/join":
            return await this.rpcJoin(body);
          case "/leave":
            return await this.rpcLeave(body);
          case "/start":
            return await this.rpcStart(body);
          case "/cancel":
            return await this.rpcCancel(body);
          case "/leavegame":
            return await this.rpcLeaveGame(body);
          case "/mode":
            return await this.rpcMode(body);
          case "/bet":
            return await this.rpcBet(body);
          case "/notice":
            return await this.rpcNotice(body);
          case "/rebuy":
            return await this.rpcRebuy(body);
          case "/act":
            return await this.rpcAct(body);
          case "/refresh": {
            const g = await this.load();
            if (!g) return this.json({ ok: false, error: "not_found" });
            if (g.stage === "lobby") await this.renderLobby();
            else await this.renderTable();
            return this.json({ ok: true, state: this.publicState() });
          }
          case "/state": {
            const g = await this.load();
            return this.json({ ok: !!g, state: g ? this.publicState() : null });
          }
          default:
            return this.json({ ok: false, error: "unknown" });
        }
      } catch (err) {
        console.error("Blackjack DO error:", err);
        return this.json({ ok: false, error: "internal" });
      }
    });
  }

  async alarm(): Promise<void> {
    // Best-effort: on a D1/storage failure log and settle, never let the
    // runtime retry the alarm against already-mutated in-memory state (a
    // retry would e.g. draw a second dealer card).
    try {
      await this.state.blockConcurrencyWhile(async () => {
        const g = await this.load();
        if (!g) return;
        const kind = g.alarmKind;
        const now = Date.now();
        if (kind === "lobby" && g.stage === "lobby") {
          if (now >= g.lobbyDeadline) {
            await this.beginRound();
          } else {
            await this.renderLobby();
            await this.scheduleLobbyTimer();
          }
        } else if (kind === "bet" && g.stage === "betting" && g.betDeadline != null) {
          if (now >= g.betDeadline) {
            await this.timeoutBetting();
          } else {
            await this.renderTable();
            await this.scheduleBetTimer();
          }
        } else if (kind === "turn" && g.stage === "playing" && g.actionDeadline != null) {
          if (now >= g.actionDeadline) {
            await this.timeoutAct();
          } else {
            await this.renderTable();
            await this.scheduleTurnTimer();
          }
        } else if (kind === "dealer" && g.stage === "dealer") {
          await this.dealerTick();
        } else if (kind === "break" && g.stage === "settled" && g.breakDeadline != null) {
          if (now >= g.breakDeadline) {
            await this.beginNextRound();
          } else {
            await this.renderTable();
            await this.scheduleBreakTimer();
          }
        }
      });
    } catch (err) {
      console.error("[blackjack] alarm failed", err);
    }
  }

  // ---- lobby RPC ---------------------------------------------------------

  private async rpcCreate(body: RpcBody): Promise<Response> {
    if (await this.load()) return this.json({ ok: false, error: "exists" });
    const groupId = Number(body.groupId);
    const hostId = Number(body.hostId);
    const buyIn = Number(body.buyIn);
    const hostName = String(body.hostName ?? "User").slice(0, 32);
    const gameId = this.state.id.name ?? "";
    if (!gameId || !groupId || !hostId || !Number.isFinite(buyIn) || buyIn < BJ_MIN_BUYIN || buyIn > BJ_MAX_BUYIN) {
      return this.json({ ok: false, error: "invalid" });
    }

    const escrow = await this.env.DB.prepare(
      `UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
    )
      .bind(buyIn, groupId, hostId, buyIn)
      .run();
    if (!escrow || escrow.meta.changes === 0) {
      return this.json({ ok: false, error: "insufficient" });
    }

    const now = Math.floor(Date.now() / 1000);
    this.g = {
      v: 1,
      gameId,
      groupId,
      messageId: 0,
      hostId,
      buyIn,
      noticeMsgId: null,
      mode: "single",
      seats: [this.makeSeat(0, hostId, hostName, buyIn)],
      deck: [],
      discard: [],
      dealerCards: [],
      dealerHoleRevealed: false,
      stage: "lobby",
      roundNumber: 0,
      currentSeat: null,
      currentHand: null,
      actionDeadline: null,
      betDeadline: null,
      lobbyDeadline: Date.now() + BJ_LOBBY_TIMEOUT_SEC * 1000,
      breakDeadline: null,
      alarmKind: "lobby",
      cancelled: false,
      lastActionText: "",
      resultText: null,
      endedAt: null,
    };
    await this.persist();

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO blackjack_games (game_id, telegram_group_id, status, buy_in, host_user_id, message_id, created_at) VALUES (?, ?, 'lobby', ?, ?, 0, ?)`
      ).bind(gameId, groupId, buyIn, hostId, now),
      this.env.DB.prepare(
        `INSERT INTO blackjack_game_players (game_id, seat, telegram_user_id, buy_in, joined_at) VALUES (?, 0, ?, ?, ?)`
      ).bind(gameId, hostId, buyIn, now),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_BUYIN', ?)`
      ).bind(hostId, groupId, -buyIn, now),
    ]);

    // Set the lobby alarm BEFORE rendering: if the Telegram render throws, the
    // alarm still fires and the game proceeds/cancels with a refund path.
    // Otherwise a failed render would leave the game stuck with escrowed money
    // and no alarm.
    await this.state.storage.setAlarm(this.g.lobbyDeadline);

    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private makeSeat(index: number, userId: number, name: string, buyIn: number): BlackjackSeat {
    return {
      index,
      userId,
      name,
      chips: buyIn,
      draft: null,
      pendingBet: null,
      hands: [],
      lastAction: "",
      left: false,
      busted: false,
      pvMsgId: null,
    };
  }

  /** Join during the lobby OR between rounds (break). */
  private async rpcJoin(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby" && g.stage !== "settled") {
      return this.json({ ok: false, error: "started" });
    }
    const userId = Number(body.userId);
    if (!userId) return this.json({ ok: false, error: "invalid" });
    if (g.seats.some((s) => s.userId === userId)) return this.json({ ok: false, error: "already_in" });
    if (g.seats.filter((s) => !s.left).length >= BJ_MAX_PLAYERS) return this.json({ ok: false, error: "full" });

    const escrow = await this.env.DB.prepare(
      `UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
    )
      .bind(g.buyIn, g.groupId, userId, g.buyIn)
      .run();
    if (!escrow || escrow.meta.changes === 0) {
      return this.json({ ok: false, error: "insufficient" });
    }

    const seat = this.makeSeat(g.seats.length, userId, String(body.name ?? "User").slice(0, 32), g.buyIn);
    g.seats.push(seat);

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO blackjack_game_players (game_id, seat, telegram_user_id, buy_in, joined_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(g.gameId, seat.index, userId, g.buyIn, now),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_BUYIN', ?)`
      ).bind(userId, g.groupId, -g.buyIn, now),
    ]);
    await this.persist();
    if (g.stage === "lobby") await this.renderLobby();
    else await this.renderTable();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcLeave(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat) return this.json({ ok: false, error: "not_in" });
    if (seat.index === 0) {
      await this.cancelGame();
      return this.json({ ok: true, state: this.publicState() });
    }

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
      ).bind(g.buyIn, g.groupId, userId),
      this.env.DB.prepare(`DELETE FROM blackjack_game_players WHERE game_id = ? AND seat = ?`).bind(g.gameId, seat.index),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_CANCEL_REFUND', ?)`
      ).bind(userId, g.groupId, g.buyIn, now),
    ]);

    g.seats = g.seats
      .filter((s) => s.userId !== userId)
      .map((s, i) => ({ ...s, index: i }));
    await this.persist();
    await this.reindexDbPlayers();
    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcStart(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    if (Number(body.userId) !== g.hostId) return this.json({ ok: false, error: "host_only" });
    await this.beginRound();
    return this.json({ ok: true, state: this.publicState() });
  }

  /**
   * Toggle single-player (open cards on the table) vs multi-player (hidden
   * hands shown only in each player's private chat). Host or bot owner only,
   * and only while the game is still in the lobby.
   */
  private async rpcMode(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    const userId = Number(body.userId);
    if (userId !== g.hostId && String(userId) !== String(this.env.BOT_OWNER_ID)) {
      return this.json({ ok: false, error: "mode_denied" });
    }
    g.mode = g.mode === "single" ? "multi" : "single";
    await this.persist();
    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  /** The handler registers its "game created" confirmation message here so the
   *  DO can delete it once play actually starts (round 1). If the game already
   *  started (host hit ▶️ before this RPC arrived), delete it right away. */
  private async rpcNotice(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    const msgId = Number(body.messageId);
    if (!Number.isFinite(msgId) || msgId <= 0) return this.json({ ok: false, error: "invalid" });
    if (g.roundNumber >= 1) {
      await deleteMessage(this.env.TELEGRAM_BOT_TOKEN, g.groupId, msgId);
      return this.json({ ok: true, state: this.publicState() });
    }
    g.noticeMsgId = msgId;
    await this.persist();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcCancel(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage === "ended") return this.json({ ok: false, error: "ended" });
    const userId = Number(body.userId);
    if (userId !== g.hostId) {
      const admin = await isGroupAdmin(this.env.TELEGRAM_BOT_TOKEN, g.groupId, userId);
      if (!admin) return this.json({ ok: false, error: "host_or_admin" });
    }
    await this.cancelGame();
    return this.json({ ok: true, state: this.publicState() });
  }

  /** Cash out between rounds: refund remaining chips and remove the seat. */
  private async rpcLeaveGame(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat) return this.json({ ok: false, error: "not_in" });
    if (g.stage !== "settled") return this.json({ ok: false, error: "not_between_rounds" });
    if (seat.left) return this.json({ ok: false, error: "not_in" });

    await this.payOutSeat(seat, "BLACKJACK_CASHOUT");
    seat.left = true;
    seat.chips = 0;
    seat.busted = true;
    seat.hands = [];
    await this.persist();

    const humansRemain = g.seats.some((s) => !s.left && s.chips > 0);
    if (!humansRemain) {
      await this.endGame();
    } else {
      await this.renderTable();
    }
    return this.json({ ok: true, state: this.publicState() });
  }

  /** Between rounds, a busted player can escrow a fresh buy-in and rejoin play. */
  private async rpcRebuy(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "settled") return this.json({ ok: false, error: "not_between_rounds" });
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat) return this.json({ ok: false, error: "not_in" });
    if (seat.left) return this.json({ ok: false, error: "not_in" });
    if (!seat.busted || seat.chips > 0) return this.json({ ok: false, error: "not_busted" });

    const escrow = await this.env.DB.prepare(
      `UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
    )
      .bind(g.buyIn, g.groupId, userId, g.buyIn)
      .run();
    if (!escrow || escrow.meta.changes === 0) {
      return this.json({ ok: false, error: "insufficient" });
    }

    seat.chips = g.buyIn;
    seat.busted = false;
    seat.pendingBet = null;
    seat.hands = [];
    seat.lastAction = "Rebuy";
    g.lastActionText = `${escapeHtml(seat.name)}: rebought for ${g.buyIn}`;

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_BUYIN', ?)`
      ).bind(userId, g.groupId, -g.buyIn, now),
      this.env.DB.prepare(`UPDATE blackjack_game_players SET buy_in = ? WHERE game_id = ? AND seat = ?`)
        .bind(g.buyIn, g.gameId, seat.index),
    ]);
    await this.persist();
    await this.renderTable();
    return this.json({ ok: true, state: this.publicState() });
  }

  // ---- round RPC ---------------------------------------------------------

  private async rpcBet(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "betting") return this.json({ ok: false, error: "not_betting" });
    // Reject bets that land after the deadline but before the alarm fires —
    // they would otherwise be honored even though betting already closed.
    if (g.betDeadline != null && Date.now() > g.betDeadline) {
      return this.json({ ok: false, error: "expired" });
    }
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat || seat.left || seat.busted || seat.chips <= 0) return this.json({ ok: false, error: "not_in" });
    if (seat.pendingBet !== null) return this.json({ ok: false, error: "already_bet" });
    if (g.currentSeat == null || g.currentSeat !== seat.index) return this.json({ ok: false, error: "not_your_turn" });

    const settings = await this.groupSettings();
    const minBet = Math.min(settings.minBet, seat.chips);
    const act = String(body.act ?? "");
    switch (act) {
      case "draft": {
        seat.draft = minBet;
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "adj": {
        if (seat.draft == null) return this.json({ ok: false, error: "invalid" });
        const delta = Number(body.delta);
        if (!Number.isFinite(delta) || delta === 0) return this.json({ ok: false, error: "invalid" });
        seat.draft = Math.max(minBet, Math.min(seat.chips, seat.draft + delta));
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "confirm": {
        if (seat.draft == null) return this.json({ ok: false, error: "invalid" });
        const bet = Math.max(minBet, Math.min(seat.chips, seat.draft));
        const ok = await this.checkBetSolvency(bet);
        if (!ok) return this.json({ ok: false, error: "treasury" });
        seat.chips -= bet;
        seat.pendingBet = bet;
        seat.draft = null;
        seat.lastAction = `Bet ${bet}`;
        g.lastActionText = `${escapeHtml(seat.name)}: bet ${bet}`;
        await this.persist();
        await this.advanceBetTurn();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "back": {
        if (seat.draft == null) return this.json({ ok: false, error: "invalid" });
        seat.draft = null;
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "skip": {
        seat.pendingBet = 0;
        seat.lastAction = "Skip";
        g.lastActionText = `${escapeHtml(seat.name)}: skipped`;
        await this.persist();
        await this.advanceBetTurn();
        return this.json({ ok: true, state: this.publicState() });
      }
      default:
        return this.json({ ok: false, error: "invalid" });
    }
  }

  private async rpcAct(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "playing") return this.json({ ok: false, error: "not_playing" });
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat || seat.left || seat.busted) return this.json({ ok: false, error: "not_in" });
    if (g.currentSeat == null || g.currentSeat !== seat.index || g.currentHand == null) {
      return this.json({ ok: false, error: "not_your_turn" });
    }
    const hand = seat.hands[g.currentHand];
    if (!hand || hand.result !== "pending") return this.json({ ok: false, error: "not_your_turn" });

    const act = String(body.act ?? "");
    switch (act) {
      case "hit": {
        hand.cards.push(this.drawCard());
        if (handValue(hand.cards).total > 21) {
          hand.result = "bust";
          seat.lastAction = "Bust";
          g.lastActionText = `${escapeHtml(seat.name)}: bust`;
          await this.persist();
          await this.advancePlayTurn();
        } else {
          seat.lastAction = "Hit";
          g.lastActionText = `${escapeHtml(seat.name)}: hit (${handValue(hand.cards).total})`;
          await this.persist();
          await this.resetTurnDeadline();
          if (g.mode === "multi") await this.sendPrivateHand(seat);
          await this.renderTable();
        }
        return this.json({ ok: true, state: this.publicState() });
      }
      case "stand": {
        hand.result = "stand";
        seat.lastAction = "Stand";
        g.lastActionText = `${escapeHtml(seat.name)}: stand`;
        await this.persist();
        await this.advancePlayTurn();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "double": {
        if (!canDouble(hand, seat)) return this.json({ ok: false, error: "invalid" });
        const ok = await this.checkPlaySolvency(seat, [{ ...hand, bet: hand.bet * 2, doubled: true }]);
        if (!ok) return this.json({ ok: false, error: "treasury" });
        seat.chips -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(this.drawCard());
        if (handValue(hand.cards).total > 21) {
          hand.result = "bust";
        } else {
          hand.result = "stand"; // doubled hands draw exactly one card
        }
        seat.lastAction = "Double";
        g.lastActionText = `${escapeHtml(seat.name)}: double`;
        await this.persist();
        await this.advancePlayTurn();
        return this.json({ ok: true, state: this.publicState() });
      }
      case "split": {
        if (!canSplit(hand, seat)) return this.json({ ok: false, error: "invalid" });
        // A split produces TWO hands each with the original bet. Split hands
        // can never be naturals (only the dealt hand is), so each pays at most
        // BJ_WIN_PAYOUT (2x) — worst case 4x the bet, not the 2.5x a single
        // pending hand would cover. Check both post-split hands.
        const ok = await this.checkPlaySolvency(seat, [
          { ...hand, fromSplit: true, bet: hand.bet },
          { ...hand, fromSplit: true, bet: hand.bet },
        ]);
        if (!ok) return this.json({ ok: false, error: "treasury" });
        seat.chips -= hand.bet;
        const newHand: BlackjackHand = {
          cards: [hand.cards[1], this.drawCard()],
          bet: hand.bet,
          doubled: false,
          fromSplit: true,
          result: "pending",
        };
        hand.cards = [hand.cards[0], this.drawCard()];
        if (hand.cards[0].rank === 14) {
          // Split aces: one card each, no more draws, no doubling.
          hand.result = "stand";
          newHand.result = "stand";
          seat.lastAction = "Split aces";
          g.lastActionText = `${escapeHtml(seat.name)}: split aces`;
          await this.persist();
          await this.advancePlayTurn();
        } else {
          // Non-ace split: the original hand stays pending — play it first,
          // then the new hand (nextPlayableHand advances within the seat).
          seat.lastAction = "Split";
          g.lastActionText = `${escapeHtml(seat.name)}: split`;
          await this.persist();
          await this.resetTurnDeadline();
          if (g.mode === "multi") await this.sendPrivateHand(seat);
          await this.renderTable();
        }
        return this.json({ ok: true, state: this.publicState() });
      }
      default:
        return this.json({ ok: false, error: "invalid" });
    }
  }

  // ---- flow --------------------------------------------------------------

  private eligibleSeats(): BlackjackSeat[] {
    return this.g!.seats.filter((s) => !s.left && !s.busted && s.chips > 0);
  }

  /**
   * Draw the top card; when the deck runs low the discards are reshuffled
   * back in (single-deck cut-card behaviour) so a heavy round of splits can
   * never exhaust the deck mid-round.
   */
  private drawCard(): Card {
    const g = this.g!;
    if (!g.deck.length) {
      g.deck = shuffle(g.discard.splice(0));
    }
    const card = g.deck.pop()!;
    g.discard.push(card);
    return card;
  }

  private async beginRound(): Promise<void> {
    const g = this.g!;
    const eligible = this.eligibleSeats();
    if (!eligible.length) {
      await this.endGame();
      return;
    }
    g.roundNumber++;
    g.stage = "betting";
    g.currentHand = null;
    g.actionDeadline = null;
    g.breakDeadline = null;
    g.resultText = null;
    for (const s of g.seats) {
      s.pendingBet = null;
      s.draft = null;
      s.hands = [];
      s.lastAction = "";
    }
    g.currentSeat = eligible[0].index;
    g.betDeadline = Date.now() + BJ_BET_TIMEOUT_SEC * 1000;
    g.lastActionText = `Round ${g.roundNumber} — betting`;
    if (g.roundNumber === 1) {
      await this.env.DB.prepare(`UPDATE blackjack_games SET status = 'playing' WHERE game_id = ?`).bind(g.gameId).run();
      // Play has started: the handler's "game created" confirmation is now
      // redundant — clean it up so only the game board message remains.
      if (g.noticeMsgId) {
        await deleteMessage(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.noticeMsgId);
        g.noticeMsgId = null;
      }
    }
    await this.persist();
    await this.scheduleBetTimer();
    await this.renderTable();
  }

  private async beginNextRound(): Promise<void> {
    const g = this.g!;
    if (g.roundNumber >= BJ_HAND_LIMIT || !this.eligibleSeats().length) {
      await this.endGame();
      return;
    }
    await this.beginRound();
  }

  private async timeoutBetting(): Promise<void> {
    const g = this.g!;
    for (const s of g.seats) {
      if (s.pendingBet === null && !s.left && !s.busted && s.chips > 0) {
        s.pendingBet = 0;
        s.lastAction = "No bet";
      }
    }
    g.betDeadline = null;
    g.currentSeat = null;
    g.lastActionText = "Betting closed";
    await this.persist();
    await this.beginDeal();
  }

  private async advanceBetTurn(): Promise<void> {
    const g = this.g!;
    const next = g.seats.find((s) => !s.left && !s.busted && s.chips > 0 && s.pendingBet === null);
    if (next) {
      g.currentSeat = next.index;
      // Each bettor gets their own full window — the single global deadline
      // set in beginRound would otherwise give later players the leftovers.
      g.betDeadline = Date.now() + BJ_BET_TIMEOUT_SEC * 1000;
      await this.persist();
      await this.scheduleBetTimer();
      await this.renderTable();
      return;
    }
    g.currentSeat = null;
    g.betDeadline = null;
    await this.persist();
    await this.beginDeal();
  }

  private async beginDeal(): Promise<void> {
    const g = this.g!;
    g.deck = shuffle(newDeck());
    g.discard = [];
    g.dealerCards = [this.drawCard(), this.drawCard()];
    g.dealerHoleRevealed = false;

    for (const s of g.seats) {
      if (!s.pendingBet) continue;
      s.hands = [
        {
          cards: [this.drawCard(), this.drawCard()],
          bet: s.pendingBet,
          doubled: false,
          fromSplit: false,
          result: "pending",
        },
      ];
      if (isNatural(s.hands[0].cards)) s.hands[0].result = "natural";
    }

    // Nobody placed a bet: skip straight to the break, no dealer theatrics.
    if (!g.seats.some((s) => s.hands.length)) {
      g.stage = "settled";
      g.currentSeat = null;
      g.currentHand = null;
      g.actionDeadline = null;
      g.resultText = "⏭️ No bets were placed this round.";
      g.lastActionText = "";
      await this.persist();
      g.breakDeadline = Date.now() + BJ_ROUND_BREAK_MS;
      g.alarmKind = "break";
      await this.scheduleBreakTimer();
      await this.renderTable();
      return;
    }

    if (isNatural(g.dealerCards)) {
      // Dealer peeks: natural settles the round immediately.
      g.dealerHoleRevealed = true;
      g.currentSeat = null;
      g.currentHand = null;
      g.actionDeadline = null;
      g.lastActionText = "Dealer has blackjack!";
      await this.persist();
      // Multi-mode players still deserve their PM hand reveal for the round,
      // even though the dealer's natural ends it without any play.
      if (g.mode === "multi") await this.sendAllPrivateHands();
      await this.settleRound();
      return;
    }

    if (g.mode === "multi") await this.sendAllPrivateHands();

    g.stage = "playing";
    const first = nextPlayableHand(g.seats, 0, -1);
    if (first == null) {
      await this.startDealerPhase();
      return;
    }
    g.currentSeat = first.seatIndex;
    g.currentHand = first.handIndex;
    await this.persist();
    await this.resetTurnDeadline();
    if (g.mode === "multi") {
      const seat = g.seats[g.currentSeat];
      if (seat) await this.sendPrivateHand(seat); // show the first actor their cards
    }
    await this.renderTable();
  }

  private async advancePlayTurn(): Promise<void> {
    const g = this.g!;
    const next = nextPlayableHand(g.seats, g.currentSeat ?? 0, g.currentHand ?? -1);
    if (!next) {
      g.currentSeat = null;
      g.currentHand = null;
      g.actionDeadline = null;
      await this.persist();
      await this.startDealerPhase();
      return;
    }
    g.currentSeat = next.seatIndex;
    g.currentHand = next.handIndex;
    await this.persist();
    await this.resetTurnDeadline();
    if (g.mode === "multi") {
      const seat = g.seats[g.currentSeat];
      if (seat) await this.sendPrivateHand(seat); // show the new actor their cards
    }
    await this.renderTable();
  }

  private async resetTurnDeadline(): Promise<void> {
    const g = this.g!;
    const settings = await this.groupSettings();
    const seat = g.currentSeat != null ? g.seats[g.currentSeat] : null;
    g.actionDeadline = Date.now() + (seat ? settings.turnSec * 1000 : 0);
    await this.persist();
    await this.scheduleTurnTimer();
  }

  private async timeoutAct(): Promise<void> {
    const g = this.g!;
    if (g.currentSeat == null) return;
    const seat = g.seats[g.currentSeat];
    if (g.currentHand == null) return;
    const hand = seat.hands[g.currentHand];
    if (!hand || hand.result !== "pending") return;
    hand.result = "stand";
    seat.lastAction = "Stand (timeout)";
    g.lastActionText = `⏱️ ${escapeHtml(seat.name)}: time's up — stand`;
    await this.persist();
    await this.advancePlayTurn();
  }

  private async startDealerPhase(): Promise<void> {
    const g = this.g!;
    g.stage = "dealer";
    g.currentSeat = null;
    g.currentHand = null;
    g.actionDeadline = null;
    g.dealerHoleRevealed = true;
    g.lastActionText = "Dealer plays…";
    await this.persist();
    await this.renderTable();
    if (!dealerMustHit(handValue(g.dealerCards).total)) {
      await this.settleRound();
    } else {
      g.alarmKind = "dealer";
      await this.state.storage.setAlarm(Date.now() + BJ_DEALER_REVEAL_MS);
    }
  }

  private async dealerTick(): Promise<void> {
    const g = this.g!;
    g.dealerCards.push(this.drawCard());
    g.lastActionText = `Dealer draws <b>${cardToString(g.dealerCards[g.dealerCards.length - 1])}</b>`;
    await this.persist();
    await this.renderTable();
    if (!dealerMustHit(handValue(g.dealerCards).total)) {
      await this.settleRound();
    } else {
      g.alarmKind = "dealer";
      await this.state.storage.setAlarm(Date.now() + BJ_DEALER_REVEAL_MS);
    }
  }

  private async settleRound(): Promise<void> {
    const g = this.g!;
    const settings = await this.groupSettings();
    const dealerTotal = handValue(g.dealerCards).total;
    const dealerBust = dealerTotal > 21;
    const dealerNatural = isNatural(g.dealerCards);

    let houseNet = 0;
    const chipsBeforeSettlement = new Map(g.seats.map((s) => [s.index, s.chips]));
    const lines: string[] = [];
    const bigWins: Array<{ name: string; amount: number }> = [];
    const stats: Array<{
      seat: BlackjackSeat;
      handsPlayed: number;
      blackjacks: number;
      net: number;
      biggestWin: number;
    }> = [];

    for (const s of g.seats) {
      if (!s.hands.length) continue;
      const handLines: string[] = [];
      let net = 0;
      let biggestWin = 0;
      let blackjacks = 0;

      for (const h of s.hands) {
        h.result = resolveHandResult(h, dealerTotal, dealerBust, dealerNatural);
        const payout = payoutFor(h.result, h.bet);
        s.chips += payout;
        houseNet += h.bet - payout;
        net += payout - h.bet;
        if (h.result === "natural") blackjacks++;
        if (payout > biggestWin) biggestWin = payout;
        const emoji =
          h.result === "win" || h.result === "natural"
            ? "✅"
            : h.result === "push"
              ? "➖"
              : h.result === "bust"
                ? "💥"
                : "❌";
        handLines.push(`${emoji} ${renderHand(h)}`);
      }

      lines.push(`🃏 ${escapeHtml(s.name)} (🍀 ${s.chips}): ${handLines.join(" | ")}`);
      if (biggestWin >= g.buyIn) {
        bigWins.push({ name: s.name, amount: biggestWin });
      }
      stats.push({ seat: s, handsPlayed: s.hands.length, blackjacks, net, biggestWin });

      s.lastAction = "";
      s.draft = null;
      s.pendingBet = null;
    }

    // Treasury ledger: house net for the round (positive = dealer won).
    // Commit the guarded treasury change before recording the player result.
    // If another game consumed the house balance meanwhile, cancel this round
    // instead of paying players from money the house does not have.
    const treasuryCommitted = await this.writeTreasuryRound(houseNet);
    if (!treasuryCommitted) {
      for (const s of g.seats) s.chips = chipsBeforeSettlement.get(s.index) ?? s.chips;
      g.lastActionText = "⚠️ خزانه برای تسویه این دور کافی نبود؛ شرط‌های باز به خزانه منتقل شد.";
      await this.cancelGame();
      return;
    }
    await this.recordStats(stats);

    const dealerLine =
      `🎴 Dealer: ${g.dealerCards.map((c) => `<b>${cardToString(c)}</b>`).join(" ")}` +
      (dealerBust ? " — <b>Bust!</b>" : dealerNatural ? " — <b>Blackjack!</b>" : ` (${dealerTotal})`);
    g.resultText = `${dealerLine}\n\n${lines.join("\n")}`;
    g.lastActionText = "";

    // Multi mode: final reveal in each player's private message.
    if (g.mode === "multi") await this.sendAllPrivateHands();

    // Eliminate busted stacks.
    for (const s of g.seats) {
      if (!s.left && s.chips <= 0) s.busted = true;
    }

    g.stage = "settled";
    g.currentSeat = null;
    g.currentHand = null;
    g.actionDeadline = null;
    await this.persist();

    // Big-win announcement (a single hand paid out at least the buy-in).
    if (bigWins.length) {
      const names = bigWins.slice(0, 3).map((w) => `<b>${escapeHtml(w.name)}</b> (+${w.amount} MP)`).join(", ");
      await sendMessage(
        this.env.TELEGRAM_BOT_TOKEN,
        g.groupId,
        `🎉 <b>BIG WIN!</b> ${names}${bigWins.length > 3 ? ` +${bigWins.length - 3} more` : ""} — the house pays!`,
        { parse_mode: "HTML" }
      );
    }

    if (!this.eligibleSeats().length || g.roundNumber >= BJ_HAND_LIMIT) {
      await this.endGame();
      return;
    }
    g.breakDeadline = Date.now() + settings.breakMs;
    g.alarmKind = "break";
    await this.scheduleBreakTimer();
    await this.renderTable();
  }

  /** Per-player lifetime stats (leaderboard) upserted after each round. */
  private async recordStats(
    rows: Array<{ seat: BlackjackSeat; handsPlayed: number; blackjacks: number; net: number; biggestWin: number }>
  ): Promise<void> {
    const g = this.g!;
    if (!rows.length) return;
    const now = Math.floor(Date.now() / 1000);
    const stmts = rows.map((r) =>
      this.env.DB.prepare(
        `INSERT INTO blackjack_player_stats (telegram_group_id, telegram_user_id, first_name, username, hands_played, blackjacks, net_winnings, biggest_win, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(telegram_group_id, telegram_user_id) DO UPDATE SET
           first_name = excluded.first_name,
           username = excluded.username,
           hands_played = blackjack_player_stats.hands_played + excluded.hands_played,
           blackjacks = blackjack_player_stats.blackjacks + excluded.blackjacks,
           net_winnings = blackjack_player_stats.net_winnings + excluded.net_winnings,
           biggest_win = MAX(blackjack_player_stats.biggest_win, excluded.biggest_win),
           updated_at = excluded.updated_at`
      ).bind(
        g.groupId,
        r.seat.userId,
        r.seat.name,
        null,
        r.handsPlayed,
        r.blackjacks,
        r.net,
        r.biggestWin,
        now
      )
    );
    if (stmts.length) await this.env.DB.batch(stmts);
  }

  // ---- money -------------------------------------------------------------

  private async treasuryBalance(): Promise<number> {
    const row = await this.env.DB.prepare(
      `SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`
    )
      .bind(this.g!.groupId)
      .first<{ treasury_balance: number | null }>();
    return row?.treasury_balance ?? 0;
  }

  /** Per-group table settings (admins tune via /blackjack settings). */
  private async groupSettings(): Promise<{ minBet: number; breakMs: number; turnSec: number }> {
    const row = await this.env.DB.prepare(
      `SELECT blackjack_min_bet, blackjack_break_sec, blackjack_turn_sec FROM telegram_groups WHERE telegram_group_id = ?`
    )
      .bind(this.g!.groupId)
      .first<{ blackjack_min_bet: number | null; blackjack_break_sec: number | null; blackjack_turn_sec: number | null }>();
    return {
      minBet: row?.blackjack_min_bet ?? BJ_MIN_BET,
      breakMs: (row?.blackjack_break_sec ?? Math.round(BJ_ROUND_BREAK_MS / 1000)) * 1000,
      turnSec: row?.blackjack_turn_sec ?? BJ_TURN_TIMEOUT_SEC,
    };
  }

  /** Worst-case payout for the round's placed bets (initial hands, 2.5x). */
  private async checkBetSolvency(bet: number): Promise<boolean> {
    const g = this.g!;
    let exposure = betExposure(bet);
    for (const s of g.seats) {
      if (s === g.seats[g.currentSeat!]) continue;
      if (typeof s.pendingBet === "number" && s.pendingBet > 0) exposure += betExposure(s.pendingBet);
    }
    const treasury = await this.treasuryBalance();
    return exposure <= treasury;
  }

  /**
   * Worst-case payout for ALL active hands after doubling or splitting.
   * `postHands` are the changed seat's hands AFTER the action (a doubled hand
   * with its doubled bet, or both post-split hands) — every other hand keeps
   * its current exposure. Split hands can never be naturals, so two split
   * hands need 4x the bet even though a single pending hand only needs 2.5x.
   */
  private async checkPlaySolvency(changedSeat: BlackjackSeat, postHands: BlackjackHand[]): Promise<boolean> {
    const g = this.g!;
    let main = 0;
    for (const s of g.seats) {
      for (const h of s.hands) {
        if (s === changedSeat) continue;
        main += handExposure(h);
      }
    }
    for (const h of postHands) main += handExposure(h);
    const treasury = await this.treasuryBalance();
    return main <= treasury;
  }

  private async writeTreasuryRound(net: number): Promise<boolean> {
    const g = this.g!;
    if (net === 0) return true;
    const now = Math.floor(Date.now() / 1000);
    const beforeRow = await this.env.DB.prepare(
      `SELECT treasury_balance FROM telegram_groups WHERE telegram_group_id = ?`
    )
      .bind(g.groupId)
      .first<{ treasury_balance: number | null }>();
    const before = beforeRow?.treasury_balance ?? 0;
    const after = before + net;

    // Perform the guarded update separately so a zero-row result can be
    // observed. D1 treats zero changes as a successful SQL statement.
    const update = net > 0
      ? await this.env.DB.prepare(
          `UPDATE telegram_groups SET treasury_balance = COALESCE(treasury_balance, 0) + ? WHERE telegram_group_id = ?`
        ).bind(net, g.groupId).run()
      : await this.env.DB.prepare(
          `UPDATE telegram_groups SET treasury_balance = COALESCE(treasury_balance, 0) + ? WHERE telegram_group_id = ? AND treasury_balance >= ?`
        ).bind(net, g.groupId, -net).run();
    if (update.meta.changes === 0) return false;

    await this.env.DB.prepare(
      `INSERT INTO group_treasury_transactions (telegram_group_id, telegram_user_id, amount, balance_before, balance_after, reason, reference_type, reference_id, created_at) VALUES (?, NULL, ?, ?, ?, 'blackjack:round', 'blackjack', ?, ?)`
    ).bind(g.groupId, net, before, after, g.gameId, now).run();
    return true;
  }

  /** Total wagers currently removed from chips but not yet settled. */
  private outstandingBetTotal(): number {
    const g = this.g!;
    return g.seats.reduce((total, s) => {
      if (s.hands.length) return total + s.hands.reduce((sum, h) => sum + h.bet, 0);
      return total + (typeof s.pendingBet === "number" ? s.pendingBet : 0);
    }, 0);
  }

  /** Refund a seat's remaining chips to their group balance (leave/end/cancel). */
  private async payOutSeat(seat: BlackjackSeat, reason: string): Promise<void> {
    const g = this.g!;
    if (seat.chips <= 0) return;
    const now = Math.floor(Date.now() / 1000);
    const stmts: Array<ReturnType<D1Database["prepare"]>> = [
      this.env.DB.prepare(
        `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
      ).bind(seat.chips, g.groupId, seat.userId),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(seat.userId, g.groupId, seat.chips, reason, now),
    ];
    await this.env.DB.batch(stmts);
  }

  // ---- end / cancel ------------------------------------------------------

  private async endGame(): Promise<void> {
    const g = this.g!;
    g.stage = "ended";
    g.cancelled = false;
    g.currentSeat = null;
    g.currentHand = null;
    g.actionDeadline = null;
    g.betDeadline = null;
    g.alarmKind = null;
    await this.state.storage.deleteAlarm();

    const stmts: Array<ReturnType<D1Database["prepare"]>> = [];
    for (const s of g.seats) {
      if (!s.left && s.chips > 0) {
        const now = Math.floor(Date.now() / 1000);
        stmts.push(
          this.env.DB.prepare(
            `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
          ).bind(s.chips, g.groupId, s.userId),
          this.env.DB.prepare(
            `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_CASHOUT', ?)`
          ).bind(s.userId, g.groupId, s.chips, now)
        );
      }
    }
    if (stmts.length) await this.env.DB.batch(stmts);

    g.resultText = (g.resultText ? `${g.resultText}\n\n` : "") + "🏁 <b>Game over</b> — remaining chips returned.";
    g.endedAt = Date.now();
    await this.env.DB.prepare(`UPDATE blackjack_games SET status = 'ended', ended_at = ? WHERE game_id = ?`)
      .bind(Math.floor(Date.now() / 1000), g.gameId)
      .run();
    await this.persist();
    await this.renderTable();
  }

  private async cancelGame(): Promise<void> {
    const g = this.g!;
    if (g.stage === "ended") return;
    const wasActiveRound = g.stage === "betting" || g.stage === "playing" || g.stage === "dealer";
    const outstandingBets = wasActiveRound ? this.outstandingBetTotal() : 0;
    // A lobby-phase cancel leaves the "game created" confirmation behind —
    // clean it up so only the cancelled board message remains.
    if (g.noticeMsgId) {
      await deleteMessage(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.noticeMsgId);
      g.noticeMsgId = null;
    }
    const wasLobby = g.stage === "lobby";
    g.cancelled = true;
    g.stage = "ended";
    g.currentSeat = null;
    g.currentHand = null;
    g.actionDeadline = null;
    g.alarmKind = null;
    await this.state.storage.deleteAlarm();

    // Any wager already removed from chips becomes house income when an
    // active round is cancelled. Record it before returning remaining chips.
    if (outstandingBets > 0 && !(await this.writeTreasuryRound(outstandingBets))) {
      console.error("[blackjack] failed to record cancellation wagers", g.gameId);
    }

    const stmts: Array<ReturnType<D1Database["prepare"]>> = [];
    const now = Math.floor(Date.now() / 1000);
    for (const s of g.seats) {
      if (s.left || s.chips <= 0) continue;
      stmts.push(
        this.env.DB.prepare(
          `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
        ).bind(s.chips, g.groupId, s.userId),
        this.env.DB.prepare(
          `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'BLACKJACK_CANCEL_REFUND', ?)`
        ).bind(s.userId, g.groupId, s.chips, now)
      );
    }
    if (stmts.length) await this.env.DB.batch(stmts);

    g.resultText = wasLobby
      ? "❌ Game cancelled — buy-ins returned."
      : "❌ Game cancelled — remaining chips returned.";
    g.endedAt = Date.now();
    await this.env.DB.prepare(`UPDATE blackjack_games SET status = 'cancelled', ended_at = ? WHERE game_id = ?`)
      .bind(Math.floor(Date.now() / 1000), g.gameId)
      .run();
    await this.persist();
    await this.renderTable();
  }

  // ---- timers ------------------------------------------------------------

  private async scheduleLobbyTimer(): Promise<void> {
    const g = this.g!;
    g.alarmKind = "lobby";
    await this.state.storage.setAlarm(Math.min(g.lobbyDeadline, Date.now() + BJ_COUNTDOWN_TICK_MS));
  }

  private async scheduleBetTimer(): Promise<void> {
    const g = this.g!;
    if (g.betDeadline == null) return;
    g.alarmKind = "bet";
    await this.state.storage.setAlarm(Math.min(g.betDeadline, Date.now() + BJ_COUNTDOWN_TICK_MS));
  }

  private async scheduleTurnTimer(): Promise<void> {
    const g = this.g!;
    if (g.actionDeadline == null) return;
    g.alarmKind = "turn";
    await this.state.storage.setAlarm(Math.min(g.actionDeadline, Date.now() + BJ_COUNTDOWN_TICK_MS));
  }

  private async scheduleBreakTimer(): Promise<void> {
    const g = this.g!;
    if (g.breakDeadline == null) return;
    g.alarmKind = "break";
    await this.state.storage.setAlarm(Math.min(g.breakDeadline, Date.now() + BJ_COUNTDOWN_TICK_MS));
  }

  // ---- multi-mode private hands ------------------------------------------

  /**
   * Multi mode: send (or edit) the player's private hand message in their
   * chat with the bot. Shows their cards + the dealer's upcard.
   */
  private async sendPrivateHand(seat: BlackjackSeat): Promise<void> {
    const g = this.g!;
    if (g.mode !== "multi" || !seat.hands.length) return;
    const dealerUp = g.dealerCards.length ? cardToString(g.dealerCards[0]) : "—";
    const handLines = seat.hands.map((h, i) => `${i + 1}. ${renderHand(h)}`).join("\n");
    let text =
      `🃏 <b>Blackjack</b> — دست خصوصی شما\n\n` +
      `🎴 دیلر: <b>${dealerUp}</b>\n\n` +
      `🂠 دست شما:\n${handLines}\n` +
      `🍀 چیپس: <b>${seat.chips}</b>`;
    if (seat.pvMsgId) {
      const res = await editMessageText(this.env.TELEGRAM_BOT_TOKEN, seat.userId, seat.pvMsgId, text);
      if (!res?.ok) seat.pvMsgId = null; // message gone -> resend below
    }
    if (!seat.pvMsgId) {
      const res = await sendMessage(this.env.TELEGRAM_BOT_TOKEN, seat.userId, text);
      if (res?.ok && res.result?.message_id) {
        seat.pvMsgId = res.result.message_id;
      } else if (g.stage === "playing" && g.currentSeat === seat.index) {
        // The bot can't PM this player (they never started it). They would be
        // playing blind — nudge them in the group so they can start the bot.
        g.lastActionText = `⚠️ <b>${escapeHtml(seat.name)}</b>: برای دیدن دستت، ربات را در پیوی استارت کن (پیام خصوصی).`;
      }
    }
    await this.persist();
  }

  /** Multi mode: push each active player's private hand message. */
  private async sendAllPrivateHands(): Promise<void> {
    for (const s of this.g!.seats) {
      if (!s.left && s.hands.length) await this.sendPrivateHand(s);
    }
  }

  // ---- rendering ---------------------------------------------------------

  private async renderLobby(): Promise<void> {
    const g = this.g!;
    const kb = blackjackLobbyKeyboard(g.gameId, g.mode);
    if (g.messageId) {
      await editMessageText(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.messageId, await this.lobbyText(), kb);
    } else {
      const res = await sendMessage(this.env.TELEGRAM_BOT_TOKEN, g.groupId, await this.lobbyText(), {
        reply_markup: kb,
      });
      if (res?.ok && res.result?.message_id) {
        g.messageId = res.result.message_id;
        await this.persist();
        await this.env.DB.prepare(`UPDATE blackjack_games SET message_id = ? WHERE game_id = ?`)
          .bind(g.messageId, g.gameId)
          .run();
      }
    }
  }

  private async lobbyText(): Promise<string> {
    const g = this.g!;
    const treasury = await this.treasuryBalance();
    const secs = Math.max(0, Math.ceil((g.lobbyDeadline - Date.now()) / 1000));
    const settings = await this.groupSettings();
    const modeLabel = g.mode === "multi" ? "👥 Multi (hidden hands)" : "🂠 Single (open cards)";
    let text =
      `🃏 <b>Blackjack</b> — Lobby\n\n` +
      `💰 Buy-in: <b>${g.buyIn} MP</b>\n` +
      `🏦 Treasury (house): <b>${treasury} MP</b>\n` +
      `⚙️ Min bet ${settings.minBet} | Break ${settings.breakMs / 1000}s | Turn ${settings.turnSec}s\n` +
      `🎮 Mode: ${modeLabel}\n` +
      `👥 Players (${g.seats.length}/${BJ_MAX_PLAYERS}):\n`;
    for (const s of g.seats) {
      text += `• ${s.index === 0 ? "👑 " : ""}${escapeHtml(s.name)} — 🍀 ${s.chips} MP\n`;
    }
    text += `\n⏱️ Auto-start in <b>${secs}s</b> — or press ▶️ Start now.\n\n${BJ_RULES_TEXT_FA}`;
    return text;
  }

  private async tableText(): Promise<string> {
    const g = this.g!;
    const treasury = await this.treasuryBalance();
    let text = `🃏 <b>Blackjack</b> 🃏\n`;
    text += `Round #${g.roundNumber} | Buy-in ${g.buyIn} MP\n`;

    const dealerCards = g.dealerCards.length
      ? g.dealerCards
          .map((c, i) => (i === 1 && !g.dealerHoleRevealed ? "🂠" : `<b>${cardToString(c)}</b>`))
          .join(" ")
      : "—";
    text += `\n🎴 <b>Dealer:</b> ${dealerCards}\n`;
    text += `🏦 Treasury (house): <b>${treasury} MP</b>\n`;

    if (g.lastActionText) text += `🕒 ${g.lastActionText}\n`;

    if (g.stage === "betting") {
      const secs = g.betDeadline ? Math.max(0, Math.ceil((g.betDeadline - Date.now()) / 1000)) : 0;
      const cur = g.currentSeat != null ? g.seats[g.currentSeat] : null;
      text += `\n💰 <b>Betting</b> — ${cur ? escapeHtml(cur.name) : "…"} to bet — <b>${secs}s</b> left\n`;
      if (treasury <= 0) text += `⚠️ The treasury is empty — no bets can be placed. Meow/duel taxes fund it.\n`;
    } else if (g.stage === "playing") {
      const secs = g.actionDeadline ? Math.max(0, Math.ceil((g.actionDeadline - Date.now()) / 1000)) : 0;
      const cur = g.currentSeat != null ? g.seats[g.currentSeat] : null;
      text += `\n🎯 Turn: <b>${cur ? escapeHtml(cur.name) : "…"}</b> — <b>${secs}s</b> left\n`;
      if (g.mode === "multi" && cur) {
        text += `🂠 Cards sent to <b>${escapeHtml(cur.name)}</b>'s private chat.\n`;
      }
    } else if (g.stage === "dealer") {
      text += `\n🃏 Dealer plays…\n`;
    } else if (g.stage === "settled") {
      const secs = g.breakDeadline ? Math.max(0, Math.ceil((g.breakDeadline - Date.now()) / 1000)) : 0;
      text += `\n⏸️ Break — next round in <b>${secs}s</b>. Join or cash out!\n`;
    }

    if (g.resultText) text += `\n${g.resultText}\n`;

    text += `\n👥 <b>Players:</b>\n`;
    for (const s of g.seats) {
      let badge = "🟢";
      if (s.left) badge = "🚪";
      else if (s.busted) badge = "🚫";
      else if (g.stage === "playing" && g.currentSeat === s.index) badge = "👉";
      else if (g.stage === "betting") {
        if (s.pendingBet === 0) badge = "⏭️";
        else if (s.pendingBet != null) badge = "✅";
        else if (g.currentSeat === s.index) badge = "👉";
      }
      const hideHands = g.mode === "multi" && g.stage !== "settled" && g.stage !== "ended";
      const handText = s.hands.length
        ? hideHands
          ? ` | 🂠${s.hands.length > 1 ? `×${s.hands.length}` : ""}`
          : ` | ${s.hands.map(renderHand).join(" | ")}`
        : "";
      const act = s.lastAction ? ` — ${s.lastAction}` : "";
      text += `${s.index + 1}️⃣ ${escapeHtml(s.name)} 🍀 ${s.chips} ${badge}${handText}${act}\n`;
    }
    if (g.stage === "ended") {
      text += `\n${g.cancelled ? "❌ Game cancelled — money returned." : "🏁 Game over!"}`;
    }
    return text;
  }

  private async renderTable(): Promise<void> {
    const g = this.g!;
    if (!g.messageId) return;
    const kb = g.stage === "ended" ? null : blackjackTableKeyboard(g.gameId, this.publicState());
    await editMessageText(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.messageId, await this.tableText(), kb ?? undefined);
  }

  private async reindexDbPlayers(): Promise<void> {
    const g = this.g!;
    const now = Math.floor(Date.now() / 1000);
    const stmts = [
      this.env.DB.prepare(`DELETE FROM blackjack_game_players WHERE game_id = ?`).bind(g.gameId),
      ...g.seats.map((s, i) =>
        this.env.DB.prepare(
          `INSERT INTO blackjack_game_players (game_id, seat, telegram_user_id, buy_in, joined_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(g.gameId, i, s.userId, s.chips, now)
      ),
    ];
    if (stmts.length) await this.env.DB.batch(stmts);
  }

  private publicState(): PublicBlackjackState {
    const g = this.g!;
    return {
      gameId: g.gameId,
      groupId: g.groupId,
      messageId: g.messageId,
      stage: g.stage,
      mode: g.mode,
      buyIn: g.buyIn,
      roundNumber: g.roundNumber,
      dealerCards: g.dealerCards,
      dealerHoleRevealed: g.dealerHoleRevealed,
      currentSeat: g.currentSeat,
      currentHand: g.currentHand,
      actionDeadline: g.actionDeadline,
      betDeadline: g.betDeadline,
      lobbyDeadline: g.lobbyDeadline,
      breakDeadline: g.breakDeadline,
      hostId: g.hostId,
      cancelled: g.cancelled,
      seats: g.seats.map((s) => ({
        index: s.index,
        userId: s.userId,
        name: s.name,
        chips: s.chips,
        draft: s.draft,
        pendingBet: s.pendingBet,
        hands: s.hands,
        lastAction: s.lastAction,
        left: s.left,
        busted: s.busted,
      })),
      lastActionText: g.lastActionText,
      resultText: g.resultText,
      endedAt: g.endedAt,
    };
  }
}
