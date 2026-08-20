import { Bindings, PokerGameState, PokerSeat, PublicPokerState } from "./types";
import {
  blindsFor,
  cardToString,
  cardsToString,
  cryptoRandomInt,
  evaluateBest,
  handName,
  newDeck,
  resolvePots,
  shuffle,
  splitAmount,
} from "./poker";
import {
  POKER_BOT_ACTION_DELAY_MS,
  POKER_COUNTDOWN_TICK_MS,
  POKER_HAND_LIMIT,
  POKER_LOBBY_TIMEOUT_SEC,
  POKER_MAX_BUYIN,
  POKER_MAX_PLAYERS,
  POKER_MIN_BUYIN,
  POKER_MIN_PLAYERS,
  POKER_ROUND_BREAK_MS,
  POKER_TURN_TIMEOUT_SEC,
} from "./constants";
import { editMessageText, isGroupAdmin, sendMessage } from "./telegram";
import { pokerLobbyKeyboard, pokerTableKeyboard } from "./keyboards";
import { escapeHtml } from "./utils";

const BOT_NAMES = ["Bot 1", "Bot 2", "Bot 3", "Bot 4"];

type RpcBody = Record<string, unknown>;

/**
 * Authoritative in-group Texas Hold'em game. One DO instance per game
 * (idFromName(gameId)). State is a single JSON blob under "state"; every
 * request is serialized via blockConcurrencyWhile and re-renders the single
 * table message. A self-scheduling alarm drives the turn countdown, bot
 * actions and the lobby timeout (no cron needed for sub-minute timing).
 *
 * Money model: buy-in is escrowed from group_members.meow_points on join.
 * Bots are free fill-seats; at settlement only the real pot
 * (buyIn × number of humans) is returned, split among humans proportional to
 * their final chip stacks — bots can never drain real money. All-human games
 * are winner-takes-all (the survivor holds 100% of chips).
 */
export class PokerGame {
  private state: DurableObjectState;
  private env: Bindings;
  private g: PokerGameState | null = null;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  // ---- persistence -------------------------------------------------------

  private async load(): Promise<PokerGameState | null> {
    if (this.g) return this.g;
    const stored = await this.state.storage.get<PokerGameState>("state");
    if (stored) {
      // Backfill fields added after the initial deploy (state is a JSON blob).
      if (typeof stored.nextBotId !== "number") stored.nextBotId = 1;
      if (typeof stored.realPot !== "number") stored.realPot = stored.buyIn;
      if (typeof stored.breakDeadline !== "number") stored.breakDeadline = null;
      if (typeof stored.draft !== "number" && stored.draft !== null) stored.draft = null;
      for (const s of stored.seats) if (s.left !== true) s.left = false;
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
          case "/addbot":
            return await this.rpcAddBot(body);
          case "/setbuyin":
            return await this.rpcSetBuyIn(body);
          case "/start":
            return await this.rpcStart(body);
          case "/cancel":
            return await this.rpcCancel(body);
          case "/leavegame":
            return await this.rpcLeaveGame(body);
          case "/action":
            return await this.rpcAction(body);
          case "/retrydeal":
            return await this.rpcRetryDeal(body);
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
        console.error("Poker DO error:", err);
        return this.json({ ok: false, error: "internal" });
      }
    });
  }

  async alarm(): Promise<void> {
    // Everything in the alarm is best-effort: on a D1/storage failure we log
    // and let the in-memory state settle, rather than letting the runtime
    // retry the alarm against state that may already have been mutated
    // (e.g. a card pushed before persist() threw) — a retry would double-fire.
    try {
      await this.state.blockConcurrencyWhile(async () => {
        const g = await this.load();
        if (!g) return;
        const kind = g.alarmKind;
        if (kind === "lobby" && g.stage === "lobby" && Date.now() >= g.lobbyDeadline) {
          await this.cancelGame();
        } else if (kind === "turn" && g.currentTurn != null && g.actionDeadline != null) {
          if (Date.now() >= g.actionDeadline) {
            await this.timeoutAct();
          } else {
            await this.renderTable();
            await this.scheduleTurnTimer();
          }
        } else if (kind === "break" && g.stage === "showdown") {
          if (g.breakDeadline && Date.now() < g.breakDeadline) {
            await this.renderTable();
            await this.state.storage.setAlarm(Date.now() + POKER_COUNTDOWN_TICK_MS);
          } else {
            await this.beginNextHand();
          }
        }
      });
    } catch (err) {
      console.error("[poker] alarm failed", err);
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
    if (!gameId || !groupId || !hostId || !Number.isFinite(buyIn) || buyIn < POKER_MIN_BUYIN || buyIn > POKER_MAX_BUYIN) {
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
      realPot: buyIn,
      seats: [
        {
          index: 0,
          userId: hostId,
          name: hostName,
          chips: buyIn,
          holeCards: [],
          folded: false,
          allIn: false,
          hasActed: false,
          totalBetThisHand: 0,
          committedThisStreet: 0,
          lastAction: "",
          isBot: false,
          pendingDeal: false,
          left: false,
        },
      ],
      deck: [],
      board: [],
      pot: 0,
      stage: "lobby",
      currentTurn: null,
      actionDeadline: null,
      currentBet: 0,
      lastRaiseSize: 0,
      draft: null,
      dealerIndex: 0,
      handNumber: 0,
      lobbyDeadline: Date.now() + POKER_LOBBY_TIMEOUT_SEC * 1000,
      breakDeadline: null,
      alarmKind: "lobby",
      nextBotId: 1,
      cancelled: false,
      lastActionText: "",
      resultText: null,
      winnerIds: null,
      endedAt: null,
    };
    await this.persist();

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO poker_games (game_id, telegram_group_id, status, buy_in, host_user_id, message_id, created_at) VALUES (?, ?, 'lobby', ?, ?, 0, ?)`
      ).bind(gameId, groupId, buyIn, hostId, now),
      this.env.DB.prepare(
        `INSERT INTO poker_game_players (game_id, seat, telegram_user_id, is_bot, buy_in, joined_at) VALUES (?, 0, ?, 0, ?, ?)`
      ).bind(gameId, hostId, buyIn, now),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_BUYIN', ?)`
      ).bind(hostId, groupId, -buyIn, now),
    ]);

    // Set the lobby alarm BEFORE rendering: if the Telegram render throws, the
    // alarm still fires and cancelGame() refunds the escrowed buy-in. Otherwise
    // a failed render would leave the game stuck with money and no refund path.
    await this.state.storage.setAlarm(this.g.lobbyDeadline);

    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcJoin(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    const userId = Number(body.userId);
    if (!userId) return this.json({ ok: false, error: "invalid" });
    if (g.seats.some((s) => s.userId === userId)) return this.json({ ok: false, error: "already_in" });
    if (g.seats.length >= POKER_MAX_PLAYERS) return this.json({ ok: false, error: "full" });

    const escrow = await this.env.DB.prepare(
      `UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
    )
      .bind(g.buyIn, g.groupId, userId, g.buyIn)
      .run();
    if (!escrow || escrow.meta.changes === 0) {
      return this.json({ ok: false, error: "insufficient" });
    }

    const seat: PokerSeat = {
      index: g.seats.length,
      userId,
      name: String(body.name ?? "User").slice(0, 32),
      chips: g.buyIn,
      holeCards: [],
      folded: false,
      allIn: false,
      hasActed: false,
      totalBetThisHand: 0,
      committedThisStreet: 0,
      lastAction: "",
      isBot: false,
      pendingDeal: false,
      left: false,
    };
    g.seats.push(seat);
    g.realPot += g.buyIn;
    await this.persist();

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO poker_game_players (game_id, seat, telegram_user_id, is_bot, buy_in, joined_at) VALUES (?, ?, ?, 0, ?, ?)`
      ).bind(g.gameId, seat.index, userId, g.buyIn, now),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_BUYIN', ?)`
      ).bind(userId, g.groupId, -g.buyIn, now),
    ]);

    await this.renderLobby();
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
      this.env.DB.prepare(`DELETE FROM poker_game_players WHERE game_id = ? AND seat = ?`).bind(g.gameId, seat.index),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_CANCEL_REFUND', ?)`
      ).bind(userId, g.groupId, g.buyIn, now),
    ]);

    g.seats = g.seats
      .filter((s) => s.userId !== userId)
      .map((s, i) => ({ ...s, index: i }));
    g.realPot -= g.buyIn;
    await this.persist();
    await this.reindexDbPlayers();
    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcAddBot(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    if (Number(body.userId) !== g.hostId) return this.json({ ok: false, error: "host_only" });
    if (g.seats.length >= POKER_MAX_PLAYERS) return this.json({ ok: false, error: "full" });

    const botCount = g.seats.filter((s) => s.isBot).length;
    // Monotonic counter (not derived from seat count) so that leaving players
    // never cause a fresh bot to reuse an existing bot's user id.
    const botUserId = -(1000 + g.nextBotId++);
    const seat: PokerSeat = {
      index: g.seats.length,
      userId: botUserId,
      name: BOT_NAMES[botCount] ?? `Bot ${botCount + 1}`,
      chips: g.buyIn,
      holeCards: [],
      folded: false,
      allIn: false,
      hasActed: false,
      totalBetThisHand: 0,
      committedThisStreet: 0,
      lastAction: "",
      isBot: true,
      pendingDeal: false,
      left: false,
    };
    g.seats.push(seat);
    await this.persist();

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.prepare(
      `INSERT INTO poker_game_players (game_id, seat, telegram_user_id, is_bot, buy_in, joined_at) VALUES (?, ?, ?, 1, ?, ?)`
    )
      .bind(g.gameId, seat.index, botUserId, g.buyIn, now)
      .run();

    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcSetBuyIn(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    if (Number(body.userId) !== g.hostId) return this.json({ ok: false, error: "host_only" });
    if (g.seats.length > 1) return this.json({ ok: false, error: "players_joined" });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < POKER_MIN_BUYIN || amount > POKER_MAX_BUYIN) {
      return this.json({ ok: false, error: "invalid" });
    }

    const delta = amount - g.buyIn;
    if (delta > 0) {
      const escrow = await this.env.DB.prepare(
        `UPDATE group_members SET meow_points = meow_points - ? WHERE telegram_group_id = ? AND telegram_user_id = ? AND meow_points >= ?`
      )
        .bind(delta, g.groupId, g.hostId, delta)
        .run();
      if (!escrow || escrow.meta.changes === 0) {
        return this.json({ ok: false, error: "insufficient" });
      }
    } else if (delta < 0) {
      await this.env.DB.prepare(
        `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
      )
        .bind(-delta, g.groupId, g.hostId)
        .run();
    }

    g.buyIn = amount;
    // The host's escrow changed by `delta`; keep the real-money pot in sync
    // or settlement would underpay increases and overpay decreases.
    g.realPot += delta;
    g.seats[0].chips = amount;
    await this.persist();

    const now = Math.floor(Date.now() / 1000);
    await this.env.DB.batch([
      this.env.DB.prepare(`UPDATE poker_games SET buy_in = ? WHERE game_id = ?`).bind(amount, g.gameId),
      this.env.DB.prepare(`UPDATE poker_game_players SET buy_in = ? WHERE game_id = ? AND seat = 0`).bind(amount, g.gameId),
      this.env.DB.prepare(
        `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_BUYIN_ADJUST', ?)`
      ).bind(g.hostId, g.groupId, delta, now),
    ]);

    await this.renderLobby();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcStart(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage !== "lobby") return this.json({ ok: false, error: "started" });
    if (Number(body.userId) !== g.hostId) return this.json({ ok: false, error: "host_only" });
    if (g.seats.length < POKER_MIN_PLAYERS) return this.json({ ok: false, error: "need_players" });

    g.handNumber = 1;
    g.stage = "preflop";
    g.lobbyDeadline = 0;
    await this.env.DB.prepare(`UPDATE poker_games SET status = 'playing' WHERE game_id = ?`).bind(g.gameId).run();
    await this.persist();
    await this.beginHand();
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

  /**
   * Cash out between rounds: the player is paid their proportional share of
   * the real pot right now and removed from play. Only allowed while the table
   * is paused between hands (stage "showdown").
   */
  private async rpcLeaveGame(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat) return this.json({ ok: false, error: "not_in" });
    if (g.stage !== "showdown") return this.json({ ok: false, error: "not_between_rounds" });
    // The hand is over, so anyone still holding chips may cash out — even
    // players who folded or were all-in in the just-finished hand.
    if (seat.left || seat.chips <= 0) return this.json({ ok: false, error: "not_in" });

    const humans = g.seats.filter((s) => !s.isBot && !s.left);
    const humanChips = humans.reduce((sum, s) => sum + s.chips, 0);
    const payout = humanChips > 0 ? Math.floor((g.realPot * seat.chips) / humanChips) : 0;

    seat.left = true;
    seat.folded = true;
    seat.allIn = true;
    seat.chips = 0;
    g.realPot -= payout;

    const now = Math.floor(Date.now() / 1000);
    const stmts: Array<ReturnType<D1Database["prepare"]>> = [];
    if (payout > 0) {
      stmts.push(
        this.env.DB.prepare(
          `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
        ).bind(payout, g.groupId, userId)
      );
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_LEAVE_REFUND', ?)`
        ).bind(userId, g.groupId, payout, now)
      );
    }
    if (stmts.length) await this.env.DB.batch(stmts);
    await this.persist();

    const humansRemain = g.seats.some((s) => !s.isBot && !s.left);
    if (!humansRemain) {
      await this.endGame();
    } else {
      await this.renderTable();
    }
    return this.json({ ok: true, state: this.publicState() });
  }

  // ---- game RPC ----------------------------------------------------------

  private async rpcAction(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    if (g.stage === "lobby") return this.json({ ok: false, error: "not_playing" });
    if (g.stage === "ended") return this.json({ ok: false, error: "ended" });
    if (g.stage === "showdown") return this.json({ ok: false, error: "hand_over" });

    const userId = Number(body.userId);
    const seat = g.seats.find((s) => s.userId === userId);
    if (!seat || seat.folded || seat.allIn) return this.json({ ok: false, error: "not_your_turn" });
    if (g.currentTurn == null || g.currentTurn !== seat.index) return this.json({ ok: false, error: "not_your_turn" });

    const act = String(body.act ?? "");
    const toCall = Math.max(0, g.currentBet - seat.committedThisStreet);

    switch (act) {
      case "check": {
        if (toCall > 0) return this.json({ ok: false, error: "invalid" });
        await this.applyCall(seat, 0);
        break;
      }
      case "call": {
        await this.applyCall(seat, Math.min(toCall, seat.chips));
        break;
      }
      case "fold": {
        await this.applyFold(seat);
        break;
      }
      case "allin": {
        await this.applyAllIn(seat);
        break;
      }
      // Enter the raise-confirm panel: draft = current bet + the tapped
      // increment, clamped to the legal minimum and the player's stack.
      case "draft": {
        const inc = Number(body.inc);
        if (!Number.isFinite(inc) || inc <= 0) return this.json({ ok: false, error: "invalid" });
        const minRaiseTo = g.currentBet + g.lastRaiseSize;
        const maxRaiseTo = seat.committedThisStreet + seat.chips;
        // A short stack that can't cover the minimum raise has no legal raise;
        // only call / all-in (the panel would otherwise be un-confirmable).
        if (minRaiseTo > maxRaiseTo) return this.json({ ok: false, error: "invalid_raise" });
        g.draft = Math.max(minRaiseTo, Math.min(maxRaiseTo, g.currentBet + inc));
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      // Nudge the drafted raise-to amount up/down within legal bounds.
      case "adj": {
        if (g.draft == null) return this.json({ ok: false, error: "invalid" });
        const delta = Number(body.delta);
        if (!Number.isFinite(delta) || delta === 0) return this.json({ ok: false, error: "invalid" });
        const minRaiseTo = g.currentBet + g.lastRaiseSize;
        const maxRaiseTo = seat.committedThisStreet + seat.chips;
        g.draft = Math.max(minRaiseTo, Math.min(maxRaiseTo, g.draft + delta));
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      // Execute the raise at exactly the drafted amount.
      case "confirm": {
        if (g.draft == null) return this.json({ ok: false, error: "invalid" });
        const amount = g.draft;
        const minRaiseTo = g.currentBet + g.lastRaiseSize;
        const maxRaiseTo = seat.committedThisStreet + seat.chips;
        if (amount < minRaiseTo || amount > maxRaiseTo) {
          return this.json({ ok: false, error: "invalid_raise" });
        }
        g.draft = null;
        await this.applyRaise(seat, amount);
        await this.finishTurn();
        return this.json({ ok: true, state: this.publicState() });
      }
      // Abandon the draft and restore the normal action keyboard.
      case "back": {
        if (g.draft == null) return this.json({ ok: false, error: "invalid" });
        g.draft = null;
        await this.persist();
        await this.renderTable();
        return this.json({ ok: true, state: this.publicState() });
      }
      default:
        return this.json({ ok: false, error: "invalid" });
    }

    await this.finishTurn();
    return this.json({ ok: true, state: this.publicState() });
  }

  private async rpcRetryDeal(body: RpcBody): Promise<Response> {
    const g = await this.load();
    if (!g) return this.json({ ok: false, error: "not_found" });
    const seat = g.seats.find((s) => s.userId === Number(body.userId));
    if (!seat) return this.json({ ok: false, error: "not_in" });
    if (seat.pendingDeal && g.stage !== "lobby" && g.stage !== "ended") {
      await this.trySendDeal(seat);
    }
    return this.json({ ok: true, state: this.publicState() });
  }

  // ---- hand flow ---------------------------------------------------------

  private async beginHand(): Promise<void> {
    const g = this.g!;
    const aliveIdx = g.seats.map((s, i) => i).filter((i) => g.seats[i].chips > 0);
    if (aliveIdx.length < 2) {
      await this.endGame();
      return;
    }

    let dPos: number;
    if (g.handNumber === 1) dPos = cryptoRandomInt(aliveIdx.length);
    else dPos = (aliveIdx.indexOf(g.dealerIndex) + 1) % aliveIdx.length;
    g.dealerIndex = aliveIdx[dPos];

    const blinds = blindsFor(g.handNumber, g.buyIn);
    const d = aliveIdx.indexOf(g.dealerIndex);
    const sb = aliveIdx.length === 2 ? aliveIdx[d] : aliveIdx[(d + 1) % aliveIdx.length];
    const bb = aliveIdx.length === 2 ? aliveIdx[(d + 1) % 2] : aliveIdx[(d + 2) % aliveIdx.length];

    g.deck = shuffle(newDeck());
    g.board = [];
    g.pot = 0;
    g.currentBet = 0;
    g.lastRaiseSize = blinds.big;
    g.draft = null;
    g.currentTurn = null;
    g.actionDeadline = null;
    g.resultText = null;

    for (const s of g.seats) {
      s.holeCards = [g.deck.pop()!, g.deck.pop()!];
      const busted = s.chips <= 0;
      s.folded = busted;
      s.allIn = busted;
      s.hasActed = false;
      s.totalBetThisHand = 0;
      s.committedThisStreet = 0;
      s.lastAction = "";
      s.pendingDeal = false;
    }

    this.postBlind(sb, blinds.small);
    this.postBlind(bb, blinds.big);
    g.currentBet = g.seats[bb].committedThisStreet;
    g.lastRaiseSize = blinds.big;
    g.currentTurn = this.firstActorAfter(bb);
    g.lastActionText = `Hand #${g.handNumber} started — blinds ${blinds.small}/${blinds.big}`;

    const pendingNames: string[] = [];
    for (const s of g.seats) {
      if (s.isBot || s.left) continue;
      await this.trySendDeal(s);
      if (s.pendingDeal) pendingNames.push(s.name);
    }
    if (pendingNames.length) {
      await sendMessage(
        this.env.TELEGRAM_BOT_TOKEN,
        g.groupId,
        `🕑 ${pendingNames.map(escapeHtml).join(", ")}: start the bot in PM to see your cards.`,
        { parse_mode: "HTML" }
      );
    }

    if (g.currentTurn == null) {
      await this.runoutToShowdown();
      return;
    }
    await this.persist();
    await this.startTurn();
  }

  private async beginNextHand(): Promise<void> {
    const g = this.g!;
    g.stage = "preflop";
    g.handNumber++;
    g.board = [];
    g.deck = [];
    g.breakDeadline = null;
    await this.beginHand();
  }

  private postBlind(index: number, amount: number): void {
    const g = this.g!;
    const s = g.seats[index];
    const amt = Math.min(amount, s.chips);
    s.chips -= amt;
    s.committedThisStreet = amt;
    s.totalBetThisHand = amt;
    g.pot += amt;
    s.lastAction = `Blind ${amt}`;
    if (s.chips <= 0) s.allIn = true;
  }

  private firstActorAfter(fromIndex: number): number | null {
    const g = this.g!;
    let i = fromIndex;
    for (let k = 0; k < g.seats.length; k++) {
      i = (i + 1) % g.seats.length;
      const s = g.seats[i];
      if (!s.folded && !s.allIn && s.chips > 0) return i;
    }
    return null;
  }

  private async startTurn(): Promise<void> {
    const g = this.g!;
    if (g.currentTurn == null) {
      await this.runoutToShowdown();
      return;
    }
    const s = g.seats[g.currentTurn];
    if (s.pendingDeal) await this.trySendDeal(s);
    g.draft = null;
    g.actionDeadline = Date.now() + (s.isBot ? POKER_BOT_ACTION_DELAY_MS : POKER_TURN_TIMEOUT_SEC * 1000);
    await this.persist();
    await this.scheduleTurnTimer();
    await this.renderTable();
  }

  private async scheduleTurnTimer(): Promise<void> {
    const g = this.g!;
    if (g.currentTurn == null || g.actionDeadline == null) return;
    g.alarmKind = "turn";
    const next = Math.min(g.actionDeadline, Date.now() + POKER_COUNTDOWN_TICK_MS);
    await this.state.storage.setAlarm(next);
  }

  private async finishTurn(): Promise<void> {
    const g = this.g!;
    const nonFolded = g.seats.filter((s) => !s.folded);
    const actors = nonFolded.filter((s) => !s.allIn && s.chips > 0);

    if (nonFolded.length === 1) {
      const winner = nonFolded[0];
      const won = g.pot;
      winner.chips += g.pot;
      g.pot = 0;
      g.lastActionText = "";
      await this.persist();
      await this.endHand(`🏆 <b>${escapeHtml(winner.name)}</b> folded everyone out — ${won} MP won!`);
      return;
    }

    // NOTE: no `actors.length <= 1` early runout here — the last remaining
    // actor (e.g. the BB facing a short all-in) still deserves the chance to
    // call or fold. advanceToNextTurn + the hasActed/committed check below
    // run out only when they've already decided and matched the bet.
    const advanced = this.advanceToNextTurn();
    if (!advanced) {
      await this.runoutToShowdown();
      return;
    }

    const ns = g.seats[g.currentTurn!];
    if (ns.hasActed && ns.committedThisStreet === g.currentBet) {
      await this.nextStreet();
      return;
    }

    await this.persist();
    await this.startTurn();
  }

  private advanceToNextTurn(): boolean {
    const g = this.g!;
    const from = g.currentTurn ?? -1;
    let i = from;
    for (let k = 0; k < g.seats.length; k++) {
      i = (i + 1) % g.seats.length;
      const s = g.seats[i];
      if (!s.folded && !s.allIn && s.chips > 0) {
        g.currentTurn = i;
        return true;
      }
    }
    return false;
  }

  private async nextStreet(): Promise<void> {
    const g = this.g!;
    if (g.stage === "preflop") {
      g.stage = "flop";
      g.board.push(g.deck.pop()!, g.deck.pop()!, g.deck.pop()!);
      g.lastActionText = `🂠 Flop: ${cardsToString(g.board)}`;
    } else if (g.stage === "flop") {
      g.stage = "turn";
      g.board.push(g.deck.pop()!);
      g.lastActionText = `🂠 Turn: ${cardsToString(g.board)}`;
    } else if (g.stage === "turn") {
      g.stage = "river";
      g.board.push(g.deck.pop()!);
      g.lastActionText = `🂠 River: ${cardsToString(g.board)}`;
    } else {
      await this.runoutToShowdown();
      return;
    }

    for (const s of g.seats) {
      s.committedThisStreet = 0;
      s.hasActed = false;
    }
    const blinds = blindsFor(g.handNumber, g.buyIn);
    g.currentBet = 0;
    g.lastRaiseSize = blinds.big;
    g.currentTurn = this.firstActorAfter(g.dealerIndex);
    if (g.currentTurn == null) {
      await this.runoutToShowdown();
      return;
    }
    await this.persist();
    await this.startTurn();
  }

  private async runoutToShowdown(): Promise<void> {
    const g = this.g!;
    while (g.board.length < 5 && g.deck.length) {
      if (g.board.length === 0) {
        g.board.push(g.deck.pop()!, g.deck.pop()!, g.deck.pop()!);
      } else {
        g.board.push(g.deck.pop()!);
      }
    }
    g.stage = "river";
    g.currentTurn = null;
    g.actionDeadline = null;
    await this.persist();
    await this.showdown();
  }

  private async showdown(): Promise<void> {
    const g = this.g!;
    const results = resolvePots(
      g.board,
      g.seats.map((s) => ({ index: s.index, totalBetThisHand: s.totalBetThisHand, folded: s.folded, holeCards: s.holeCards }))
    );

    let distributed = 0;
    for (const r of results) {
      const split = splitAmount(r.amount, r.winners);
      for (const [seatIdx, amt] of split) {
        g.seats[seatIdx].chips += amt;
        distributed += amt;
      }
    }
    g.pot = Math.max(0, g.pot - distributed);

    const lines: string[] = [];
    for (const s of g.seats) {
      if (s.folded) continue;
      const score = evaluateBest([...g.board, ...s.holeCards]);
      lines.push(`🃏 ${escapeHtml(s.name)}: <b>${cardsToString(s.holeCards)}</b> — ${handName(score)}`);
    }
    for (const r of results) {
      const names = r.winners.map((idx) => escapeHtml(g.seats[idx].name)).join(", ");
      lines.push(`💰 Pot ${r.amount}: <b>${names}</b>`);
    }
    g.winnerIds = [...new Set(results.flatMap((r) => r.winners))];
    await this.endHand(lines.join("\n"));
  }

  private async endHand(resultText: string): Promise<void> {
    const g = this.g!;
    g.stage = "showdown";
    g.resultText = resultText;
    g.currentTurn = null;
    g.actionDeadline = null;
    g.draft = null;
    await this.persist();
    await this.renderTable();

    const alive = g.seats.filter((s) => s.chips > 0);
    const humansAlive = g.seats.some((s) => !s.isBot && s.chips > 0);
    if (alive.length < 2 || !humansAlive || g.handNumber >= POKER_HAND_LIMIT) {
      await this.endGame();
      return;
    }
    // One-minute break between rounds so players can cash out with the
    // "Leave" button; the self-scheduling alarm ticks the countdown and then
    // starts the next hand.
    g.breakDeadline = Date.now() + POKER_ROUND_BREAK_MS;
    g.alarmKind = "break";
    await this.state.storage.setAlarm(Date.now() + POKER_COUNTDOWN_TICK_MS);
    await this.persist();
  }

  private async endGame(): Promise<void> {
    const g = this.g!;
    g.stage = "ended";
    g.cancelled = false;
    g.currentTurn = null;
    g.actionDeadline = null;
    g.alarmKind = null;
    await this.state.storage.deleteAlarm();

    await this.settlePayouts();

    const winners = g.seats.filter((s) => !s.isBot && s.chips > 0);
    g.winnerIds = winners.map((s) => s.userId);
    const winnerLine =
      winners.length === 1
        ? `🏆 <b>${escapeHtml(winners[0].name)}</b> won! 🎉`
        : winners.length > 1
          ? `🏆 Winners: ${winners.map((w) => escapeHtml(w.name)).join(", ")}`
          : "🏁 Game over.";
    g.resultText = g.resultText ? `${g.resultText}\n\n${winnerLine}` : winnerLine;
    g.endedAt = Date.now();
    await this.env.DB.prepare(`UPDATE poker_games SET status = 'ended', ended_at = ? WHERE game_id = ?`)
      .bind(Math.floor(Date.now() / 1000), g.gameId)
      .run();
    await this.persist();
    await this.renderTable();
  }

  private async cancelGame(): Promise<void> {
    const g = this.g!;
    if (g.stage === "ended") return;
    const wasLobby = g.stage === "lobby";
    g.cancelled = true;
    g.stage = "ended";
    g.currentTurn = null;
    g.actionDeadline = null;
    g.alarmKind = null;
    await this.state.storage.deleteAlarm();

    // Settle by chip equity: a cancelling host/admin can't rescue a losing
    // player — everyone keeps exactly their remaining chips' share of the pot.
    await this.settlePayouts();
    g.winnerIds = null;
    g.resultText = wasLobby
      ? "❌ Game cancelled — buy-ins returned to participants."
      : "❌ Game cancelled — each player kept their remaining chips.";
    g.endedAt = Date.now();
    await this.env.DB.prepare(`UPDATE poker_games SET status = 'cancelled', ended_at = ? WHERE game_id = ?`)
      .bind(Math.floor(Date.now() / 1000), g.gameId)
      .run();
    await this.persist();
    await this.renderTable();
  }

  /**
   * Real pot = buyIn × number of humans (bots are free). Paid back to humans
   * proportional to their final chip stacks, so the game is zero-sum among
   * humans and bots can never drain real money.
   */
  private async settlePayouts(): Promise<void> {
    const g = this.g!;
    // Players who cashed out between rounds were already paid; only the
    // remaining active humans share the leftover real pot.
    const humans = g.seats.filter((s) => !s.isBot && !s.left);
    if (!humans.length) return;
    const realPot = g.realPot;
    if (realPot <= 0) return;
    const humanChips = humans.reduce((sum, s) => sum + s.chips, 0);

    const payouts: Array<{ userId: number; amount: number }> = [];
    if (humanChips <= 0) {
      const per = Math.floor(realPot / humans.length);
      const rem = realPot - per * humans.length;
      humans.forEach((s, i) => payouts.push({ userId: s.userId, amount: per + (i === 0 ? rem : 0) }));
    } else {
      const recipients = humans.filter((s) => s.chips > 0);
      let assigned = 0;
      for (const s of recipients) {
        const amt = Math.floor((realPot * s.chips) / humanChips);
        if (amt <= 0) continue;
        payouts.push({ userId: s.userId, amount: amt });
        assigned += amt;
      }
      const rem = realPot - assigned;
      if (rem > 0 && payouts.length) payouts[0].amount += rem;
    }

    const now = Math.floor(Date.now() / 1000);
    const stmts: Array<ReturnType<D1Database["prepare"]>> = [];
    for (const p of payouts) {
      if (p.amount <= 0) continue;
      stmts.push(
        this.env.DB.prepare(
          `UPDATE group_members SET meow_points = meow_points + ? WHERE telegram_group_id = ? AND telegram_user_id = ?`
        ).bind(p.amount, g.groupId, p.userId)
      );
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO transactions (telegram_user_id, group_id, amount, reason, created_at) VALUES (?, ?, ?, 'POKER_WIN', ?)`
        ).bind(p.userId, g.groupId, p.amount, now)
      );
    }
    if (stmts.length) await this.env.DB.batch(stmts);
  }

  // ---- actions -----------------------------------------------------------

  private async applyCall(seat: PokerSeat, amt: number): Promise<void> {
    const g = this.g!;
    seat.chips -= amt;
    seat.committedThisStreet += amt;
    seat.totalBetThisHand += amt;
    g.pot += amt;
    seat.hasActed = true;
    if (seat.chips <= 0) seat.allIn = true;
    seat.lastAction = amt > 0 ? `Call ${amt}` : "Check";
    g.lastActionText = `${escapeHtml(seat.name)}: ${seat.lastAction}`;
    await this.persist();
  }

  private async applyFold(seat: PokerSeat): Promise<void> {
    const g = this.g!;
    seat.folded = true;
    seat.hasActed = true;
    seat.lastAction = "Fold";
    g.lastActionText = `${escapeHtml(seat.name)}: Fold`;
    await this.persist();
  }

  private async applyAllIn(seat: PokerSeat): Promise<void> {
    const g = this.g!;
    const raiseTo = seat.committedThisStreet + seat.chips;
    const add = seat.chips;
    seat.committedThisStreet = raiseTo;
    seat.totalBetThisHand += add;
    g.pot += add;
    seat.chips = 0;
    seat.allIn = true;
    seat.hasActed = true;
    if (raiseTo > g.currentBet) {
      if (raiseTo >= g.currentBet + g.lastRaiseSize) {
        g.lastRaiseSize = raiseTo - g.currentBet;
      }
      g.currentBet = raiseTo;
    }
    seat.lastAction = `All-in ${raiseTo}`;
    g.lastActionText = `${escapeHtml(seat.name)}: All-in ${raiseTo}`;
    await this.persist();
  }

  private async applyRaise(seat: PokerSeat, amount: number): Promise<void> {
    const g = this.g!;
    const prevBet = g.currentBet;
    const raiseTo = Math.min(amount, seat.committedThisStreet + seat.chips);
    const add = raiseTo - seat.committedThisStreet;
    seat.chips -= add;
    seat.committedThisStreet = raiseTo;
    seat.totalBetThisHand += add;
    g.pot += add;
    seat.hasActed = true;
    g.currentBet = raiseTo;
    g.lastRaiseSize = raiseTo - prevBet;
    if (seat.chips <= 0) seat.allIn = true;
    seat.lastAction = `Raise ${raiseTo}`;
    g.lastActionText = `${escapeHtml(seat.name)}: Raise to ${raiseTo}`;
    await this.persist();
  }

  private async timeoutAct(): Promise<void> {
    const g = this.g!;
    if (g.currentTurn == null) return;
    const seat = g.seats[g.currentTurn];
    if (seat.isBot) {
      await this.botAct(seat);
    } else {
      g.lastActionText = `⏱️ ${escapeHtml(seat.name)}: time's up — fold`;
      seat.folded = true;
      seat.hasActed = true;
      seat.lastAction = "Fold (timeout)";
      g.draft = null;
      await this.persist();
      await this.finishTurn();
    }
  }

  /** Simple practice AI: bets loosely on strong starts, calls often, bluffs a little. */
  private async botAct(seat: PokerSeat): Promise<void> {
    const g = this.g!;
    const toCall = Math.max(0, g.currentBet - seat.committedThisStreet);
    const [a, b] = seat.holeCards;
    const pair = a.rank === b.rank;
    const strong = pair || (a.rank >= 11 && b.rank >= 11) || (a.rank >= 10 && b.rank >= 10 && a.suit === b.suit);
    const roll = Math.random();
    const stack = seat.committedThisStreet + seat.chips;

    if (toCall <= 0) {
      if (strong && roll < 0.45) {
        const raiseTo = Math.min(stack, g.currentBet + g.lastRaiseSize * (1 + Math.floor(Math.random() * 2)));
        await this.applyRaise(seat, raiseTo);
      } else {
        await this.applyCall(seat, 0);
      }
    } else if (toCall >= seat.chips) {
      if (strong && roll < 0.6) await this.applyAllIn(seat);
      else await this.applyFold(seat);
    } else {
      if (strong && roll < 0.35) {
        const raiseTo = Math.min(stack, g.currentBet + g.lastRaiseSize * (1 + Math.floor(Math.random() * 2)));
        await this.applyRaise(seat, raiseTo);
      } else if (roll < 0.85) {
        await this.applyCall(seat, toCall);
      } else {
        await this.applyFold(seat);
      }
    }
    await this.finishTurn();
  }

  // ---- private deals -----------------------------------------------------

  private async trySendDeal(seat: PokerSeat): Promise<void> {
    const g = this.g!;
    const res = await sendMessage(
      this.env.TELEGRAM_BOT_TOKEN,
      seat.userId,
      `🎴 <b>Texas Hold'em</b> — Your cards\n\n` +
        `🂠 ${cardsToString(seat.holeCards)}\n\n` +
        `💰 Pot: <b>${g.pot} MP</b>\n` +
        `📣 Call: <b>${Math.max(0, g.currentBet - seat.committedThisStreet)} MP</b>\n\n` +
        `Play your moves in the group.`,
      { parse_mode: "HTML" }
    );
    const pending = !res?.ok;
    if (seat.pendingDeal !== pending) {
      seat.pendingDeal = pending;
      await this.persist();
    }
  }

  // ---- rendering ---------------------------------------------------------

  private lobbyText(): string {
    const g = this.g!;
    let text =
      `🃏 <b>Texas Hold'em</b> — Lobby\n\n` +
      `💰 Buy-in: <b>${g.buyIn} MP</b>\n` +
      `👥 Players (${g.seats.length}/${POKER_MAX_PLAYERS}):\n`;
    for (const s of g.seats) {
      const hostMark = s.index === 0 ? " 👑" : "";
      const botMark = s.isBot ? "🤖 " : "";
      text += `• ${botMark}${escapeHtml(s.name)}${hostMark} — 🍀 ${s.chips} MP\n`;
    }
    text += `\n⏱️ Lobby stays open for ${POKER_LOBBY_TIMEOUT_SEC / 60} minutes.`;
    return text;
  }

  private tableText(): string {
    const g = this.g!;
    const blinds = blindsFor(g.handNumber, g.buyIn);
    let text = `🎴 <b>Texas Hold'em</b> 🎴\n`;
    if (g.stage !== "lobby") {
      text += `Hand #${g.handNumber} | Blinds ${blinds.small}/${blinds.big}\n`;
    }

    const shown = g.board.length;
    const slots: string[] = [];
    for (let i = 0; i < 5; i++) {
      slots.push(i < shown ? `<b>${cardToString(g.board[i])}</b>` : `[?]`);
    }
    const stageLabel =
      g.stage === "preflop"
        ? "🃏 Pre-flop"
        : g.stage === "flop"
          ? "🂠 Flop"
          : g.stage === "turn"
            ? "🂠 Turn"
            : g.stage === "river"
              ? "🂠 River"
              : "";
    text += `\n${stageLabel} ${slots.join(" ")}\n\n`;

    text += `💰 Pot: <b>${g.pot} MP</b>\n`;
    const toCall = g.currentTurn != null ? Math.max(0, g.currentBet - g.seats[g.currentTurn].committedThisStreet) : 0;
    text += `📣 Call: <b>${toCall} MP</b> | ⬆️ Raise: <b>${g.currentBet + g.lastRaiseSize} MP</b>\n`;
    if (g.draft != null && g.currentTurn != null) {
      const s = g.seats[g.currentTurn];
      const maxRaiseTo = s.committedThisStreet + s.chips;
      text += `🎚 Your raise: <b>${g.draft} MP</b> (max ${maxRaiseTo}) — press ✅ to confirm\n`;
    }
    if (g.lastActionText) text += `🕒 ${g.lastActionText}\n`;

    if (g.stage === "showdown" || g.stage === "ended") {
      if (g.resultText) text += `\n${g.resultText}\n`;
      if (g.stage === "showdown" && g.breakDeadline) {
        const secs = Math.max(0, Math.ceil((g.breakDeadline - Date.now()) / 1000));
        text += `⏸️ Break — next hand in <b>${secs}s</b> — press "Leave" to cash out.\n`;
      }
    } else if (g.currentTurn != null) {
      const s = g.seats[g.currentTurn];
      const secs = g.actionDeadline ? Math.max(0, Math.ceil((g.actionDeadline - Date.now()) / 1000)) : 0;
      text += `⏱️ Turn: <b>${escapeHtml(s.name)}</b> — <b>${secs}s</b> left\n`;
    }

    text += `\n👥 <b>Players:</b>\n`;
    for (const s of g.seats) {
      const bot = s.isBot ? "🤖 " : "";
      const chips = s.chips;
      let badge = "🟢";
      if (s.left) badge = "🚪";
      else if (g.currentTurn === s.index && (g.stage === "preflop" || g.stage === "flop" || g.stage === "turn" || g.stage === "river")) {
        badge = "👉";
      }
      else if (s.folded) badge = "✋";
      else if (s.allIn) badge = "🤚";
      else if (s.pendingDeal && !s.folded) badge = "🕑";
      const act = s.lastAction ? ` — ${s.lastAction}` : "";
      text += `${s.index + 1}️⃣ ${bot}${escapeHtml(s.name)} 🍀 ${chips} ${badge}${act}\n`;
    }
    if (g.stage === "ended") {
      text += `\n${g.cancelled ? "❌ Game cancelled — money returned." : "🏁 Game over!"}`;
    }
    return text;
  }

  private async renderLobby(): Promise<void> {
    const g = this.g!;
    const kb = pokerLobbyKeyboard(g.gameId);
    if (g.messageId) {
      await editMessageText(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.messageId, this.lobbyText(), kb);
    } else {
      const res = await sendMessage(this.env.TELEGRAM_BOT_TOKEN, g.groupId, this.lobbyText(), { reply_markup: kb });
      if (res?.ok && res.result?.message_id) {
        g.messageId = res.result.message_id;
        await this.persist();
        await this.env.DB.prepare(`UPDATE poker_games SET message_id = ? WHERE game_id = ?`)
          .bind(g.messageId, g.gameId)
          .run();
      }
    }
  }

  private async renderTable(): Promise<void> {
    const g = this.g!;
    if (!g.messageId) return;
    const kb = g.stage === "ended" ? null : pokerTableKeyboard(g.gameId, this.publicState());
    await editMessageText(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.messageId, this.tableText(), kb ?? undefined);
  }

  private async reindexDbPlayers(): Promise<void> {
    const g = this.g!;
    const now = Math.floor(Date.now() / 1000);
    const stmts = [
      this.env.DB.prepare(`DELETE FROM poker_game_players WHERE game_id = ?`).bind(g.gameId),
      ...g.seats.map((s, i) =>
        this.env.DB.prepare(
          `INSERT INTO poker_game_players (game_id, seat, telegram_user_id, is_bot, buy_in, joined_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(g.gameId, i, s.userId, s.isBot ? 1 : 0, s.chips, now)
      ),
    ];
    if (stmts.length) await this.env.DB.batch(stmts);
  }

  private publicState(): PublicPokerState {
    const g = this.g!;
    return {
      gameId: g.gameId,
      groupId: g.groupId,
      messageId: g.messageId,
      stage: g.stage,
      buyIn: g.buyIn,
      pot: g.pot,
      board: g.board,
      currentBet: g.currentBet,
      lastRaiseSize: g.lastRaiseSize,
      draft: g.draft,
      currentTurn: g.currentTurn,
      actionDeadline: g.actionDeadline,
      handNumber: g.handNumber,
      hostId: g.hostId,
      cancelled: g.cancelled,
      seats: g.seats.map((s) => ({
        index: s.index,
        userId: s.userId,
        name: s.name,
        chips: s.chips,
        holeCardCount: s.holeCards.length,
        folded: s.folded,
        allIn: s.allIn,
        hasActed: s.hasActed,
        committedThisStreet: s.committedThisStreet,
        lastAction: s.lastAction,
        isBot: s.isBot,
        pendingDeal: s.pendingDeal,
        left: s.left,
      })),
      lastActionText: g.lastActionText,
      resultText: g.resultText,
      winnerIds: g.winnerIds,
    };
  }
}
