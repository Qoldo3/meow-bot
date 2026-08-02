import { Bindings, HokmGameState, HokmSeatInfo, PublicHokmState } from "./types";
import {
  Card,
  Suit,
  SUITS,
  dealHands,
  firstAceSeat,
  highestCard,
  isLegal,
  lowestLegalCard,
  resolveTrick,
  scoreHand,
  shuffle,
  newDeck,
  sortCards,
  suitOf,
} from "./hokm";
import { cancelHokmGame, getHokmGame, getHokmPlayers, settleHokmMatch } from "./hokmLobby";
import {
  HOKM_AFK_STRIKES,
  HOKM_JOIN_TIMEOUT_SEC,
  HOKM_TRUMP_TIMEOUT_SEC,
  HOKM_TURN_TIMEOUT_SEC,
} from "./constants";
import { editMessageText } from "./telegram";
import { hokmBoardKeyboard } from "./keyboards";

interface WsMeta {
  userId: number;
  name: string;
  seat?: number;
  observer?: boolean;
}

export class HokmGame {
  private state: DurableObjectState;
  private env: Bindings;
  private g: HokmGameState | null = null;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  // ---- persistence -------------------------------------------------------

  private async load(): Promise<void> {
    if (this.g) return;
    const stored = await this.state.storage.get<HokmGameState>("state");
    if (stored) {
      this.g = stored;
      return;
    }
    await this.init();
  }

  private async persist(): Promise<void> {
    if (!this.g) return;
    await this.state.storage.put("state", this.g);
  }

  private async setAlarm(when: number, kind: NonNullable<HokmGameState["alarmKind"]>): Promise<void> {
    if (!this.g) return;
    this.g.alarmKind = kind;
    await this.state.storage.setAlarm(when);
  }

  private turnTimeout(): number {
    return this.env.HOKM_TURN_TIMEOUT_SEC ?? HOKM_TURN_TIMEOUT_SEC;
  }

  private trumpTimeout(): number {
    return this.env.HOKM_TRUMP_TIMEOUT_SEC ?? HOKM_TRUMP_TIMEOUT_SEC;
  }

  private joinTimeout(): number {
    return this.env.HOKM_JOIN_TIMEOUT_SEC ?? HOKM_JOIN_TIMEOUT_SEC;
  }

  private afkStrikes(): number {
    return this.env.HOKM_AFK_STRIKES ?? HOKM_AFK_STRIKES;
  }

  private async init(): Promise<void> {
    if (this.g) return;
    const gameId = this.state.id.name;
    if (!gameId) return;
    const game = await getHokmGame(this.env.DB, gameId);
    if (!game || game.status !== "playing") return;

    const players = await getHokmPlayers(this.env.DB, gameId);
    const seats: (HokmSeatInfo | null)[] = [null, null, null, null];
    for (const p of players) {
      seats[p.seat] = { userId: p.telegram_user_id, name: p.first_name, seat: p.seat };
    }

    this.g = {
      v: 1,
      gameId,
      groupId: game.group_id,
      bet: game.bet,
      perPlayer: game.per_player,
      boardMsgId: game.board_msg_id ?? null,
      appUrl: game.app_url ?? "",
      phase: "waiting_join",
      seats,
      hands: {},
      firstFive: [],
      trumpSuit: null,
      hakemSeat: null,
      leaderSeat: null,
      currentSeat: null,
      trickPlays: [],
      trickWinnerSeat: null,
      tricksWon: [0, 0, 0, 0],
      handScores: [0, 0],
      matchScores: [0, 0],
      handWinnerTeam: null,
      handPoints: null,
      handNumber: 0,
      strikes: [0, 0, 0, 0],
      turnDeadline: null,
      alarmKind: "join",
      drawOrder: [],
      drawIndex: 0,
      result: null,
      winnerTeam: null,
    };
    await this.persist();
    await this.setAlarm(Date.now() + this.joinTimeout() * 1000, "join");
  }

  // ---- websocket plumbing ------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    await this.state.blockConcurrencyWhile(() => this.load());

    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      const url = new URL(request.url);
      if (url.pathname === "/init") {
        const appUrl = request.headers.get("X-Hokm-App-Url") ?? this.env.HOKM_APP_URL ?? "";
        if (this.g) this.g.appUrl = appUrl;
        await this.persist();
        return new Response("ok");
      }
      return new Response("hokm do", { status: 200 });
    }

    if (!this.g) {
      return new Response("game not found", { status: 404 });
    }

    const headerAppUrl = request.headers.get("X-Hokm-App-Url");
    if (headerAppUrl) this.g.appUrl = headerAppUrl;

    const userIdStr = request.headers.get("X-Hokm-User-Id");
    const name = request.headers.get("X-Hokm-Name") ?? "";
    const userId = userIdStr ? parseInt(userIdStr, 10) : NaN;

    const pair = new WebSocketPair();
    const server = pair[1];
    const client = pair[0];

    const seat = this.findSeat(userId);
    const meta: WsMeta = seat != null ? { userId, name, seat } : { userId, name, observer: true };
    server.serializeAttachment(meta);

    this.state.acceptWebSocket(server);
    this.sendWelcome(server, meta);
    this.broadcast({ type: "connected", connected: this.connectedSeats() });

    if (this.g.phase === "waiting_join") {
      // Serialize the all-joined check: two concurrent connections could both
      // start the match and re-shuffle the draw otherwise.
      await this.state.blockConcurrencyWhile(async () => {
        await this.load();
        if (this.g) await this.checkAllJoined();
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      await this.load();
      const g = this.g;
      if (!g || g.phase === "match_over" || g.phase === "cancelled") return;
      const meta = (ws.deserializeAttachment() as WsMeta) ?? null;
      if (!meta) return;

      let msg: { type: string; suit?: string; card?: string };
      try {
        msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      } catch {
        return;
      }

      switch (msg.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        case "trump":
          if (typeof msg.suit === "string") await this.handleTrump(meta, msg.suit);
          break;
        case "play":
          if (typeof msg.card === "string") await this.handlePlay(meta, msg.card);
          break;
        case "leave":
          if (meta.seat != null) await this.forfeit(meta.seat);
          break;
        case "join":
          if (g.phase === "waiting_join") await this.checkAllJoined();
          break;
      }
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      await this.load();
      const meta = (ws.deserializeAttachment() as WsMeta) ?? null;
      if (!this.g || this.g.phase === "match_over" || this.g.phase === "cancelled") return;
      if (meta && meta.seat != null) {
        this.broadcast({ type: "notice", text: `🔌 ${meta.name} از بازی قطع شد` });
        this.broadcast({ type: "connected", connected: this.connectedSeats() });
      }
    });
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      await this.load();
      const g = this.g;
      if (!g || g.phase === "match_over" || g.phase === "cancelled") return;
      const kind = g.alarmKind;

      if (kind === "join" && g.phase === "waiting_join") {
        await this.handleJoinTimeout();
      } else if (kind === "draw" && g.phase === "drawing_hakem") {
        await this.revealNext();
      } else if (kind === "deal" && g.phase === "hand_over") {
        await this.beginDeal();
      } else if (kind === "trump" && g.phase === "trump_call") {
        await this.autoTrump();
      } else if (
        kind === "turn" &&
        g.phase === "playing" &&
        g.currentSeat != null &&
        g.turnDeadline != null &&
        Date.now() >= g.turnDeadline
      ) {
        await this.autoPlay(g.currentSeat);
      }
    });
  }

  // ---- helpers -----------------------------------------------------------

  private findSeat(userId: number): number | null {
    const g = this.g!;
    for (const s of g.seats) {
      if (s && s.userId === userId) return s.seat;
    }
    return null;
  }

  private seatMeta(ws: WebSocket): WsMeta | null {
    return (ws.deserializeAttachment() as WsMeta) ?? null;
  }

  private connectedSeats(): number[] {
    const set = new Set<number>();
    for (const ws of this.state.getWebSockets()) {
      const meta = this.seatMeta(ws);
      if (meta && meta.seat != null) set.add(meta.seat);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  private sendWelcome(ws: WebSocket, meta: WsMeta): void {
    const g = this.g!;
    ws.send(
      JSON.stringify({
        type: "welcome",
        role: meta.observer ? "observer" : "player",
        seat: meta.seat ?? null,
        state: this.publicState(),
        hand: meta.seat != null ? g.hands[meta.seat] ?? [] : null,
        firstFive: meta.seat != null && g.phase === "trump_call" && meta.seat === g.hakemSeat ? g.firstFive : null,
      })
    );
  }

  private sendToSeat(seat: number, payload: Record<string, unknown>): void {
    const json = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      const meta = this.seatMeta(ws);
      if (meta && meta.seat === seat) {
        try {
          ws.send(json);
        } catch {
          // ignore
        }
      }
    }
  }

  private broadcast(payload: Record<string, unknown>): void {
    const json = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        // ignore
      }
    }
  }

  private publicState(): PublicHokmState {
    const g = this.g!;
    return {
      phase: g.phase,
      seats: g.seats,
      connected: this.connectedSeats(),
      trumpSuit: g.trumpSuit,
      hakemSeat: g.hakemSeat,
      leaderSeat: g.leaderSeat,
      currentSeat: g.currentSeat,
      trickPlays: g.trickPlays,
      trickWinnerSeat: g.trickWinnerSeat,
      tricksWon: g.tricksWon,
      handScores: g.handScores,
      matchScores: g.matchScores,
      handWinnerTeam: g.handWinnerTeam,
      handPoints: g.handPoints,
      handNumber: g.handNumber,
      strikes: g.strikes,
      turnDeadline: g.turnDeadline,
      bet: g.bet,
      perPlayer: g.perPlayer,
      result: g.result,
      winnerTeam: g.winnerTeam,
      drawIndex: g.drawIndex,
    };
  }

  // ---- match flow --------------------------------------------------------

  private async checkAllJoined(): Promise<void> {
    const g = this.g!;
    if (g.phase !== "waiting_join") return;
    if (this.connectedSeats().length === 4) {
      await this.startMatch();
    }
  }

  private async startMatch(): Promise<void> {
    const g = this.g!;
    g.phase = "drawing_hakem";
    g.handNumber = 1;
    g.drawOrder = shuffle(newDeck());
    g.drawIndex = 0;
    await this.persist();
    this.broadcast({ type: "state", state: this.publicState() });
    await this.revealNext();
  }

  private async revealNext(): Promise<void> {
    const g = this.g!;
    const { seat: hakemSeat, index: aceIndex } = firstAceSeat(g.drawOrder);
    if (g.drawIndex < aceIndex) {
      const card = g.drawOrder[g.drawIndex];
      const revealedTo = g.drawIndex % 4;
      g.drawIndex++;
      await this.persist();
      this.broadcast({ type: "draw", card, seat: revealedTo });
      await this.setAlarm(Date.now() + 900, "draw");
      return;
    }
    if (g.drawIndex === aceIndex) {
      const card = g.drawOrder[aceIndex];
      g.drawIndex++;
      g.hakemSeat = hakemSeat;
      await this.persist();
      this.broadcast({ type: "draw", card, seat: hakemSeat, ace: true, hakemSeat });
      await this.beginDeal();
      return;
    }
  }

  private async beginDeal(): Promise<void> {
    const g = this.g!;
    const hakem = g.hakemSeat!;
    const { hands, firstFive } = dealHands(hakem);
    g.hands = {};
    for (let seat = 0; seat < 4; seat++) {
      g.hands[seat] = sortCards(hands[seat]);
    }
    g.firstFive = firstFive;
    g.phase = "trump_call";
    g.turnDeadline = Date.now() + this.trumpTimeout() * 1000;
    g.trickPlays = [];
    g.trickWinnerSeat = null;
    g.tricksWon = [0, 0, 0, 0];
    g.handScores = [0, 0];
    await this.persist();

    for (const ws of this.state.getWebSockets()) {
      const meta = this.seatMeta(ws);
      if (!meta || meta.seat == null) continue;
      const isHakem = meta.seat === hakem;
      ws.send(
        JSON.stringify({
          type: "hand",
          hand: isHakem ? firstFive : g.hands[meta.seat],
          partial: isHakem,
        })
      );
    }

    this.broadcast({ type: "state", state: this.publicState() });
    await this.setAlarm(g.turnDeadline, "trump");
  }

  private async handleTrump(meta: WsMeta, suitRaw: string): Promise<void> {
    const g = this.g!;
    if (g.phase !== "trump_call" || g.hakemSeat == null) return;
    if (meta.seat !== g.hakemSeat) return;
    if (!(SUITS as readonly string[]).includes(suitRaw)) return;
    await this.applyTrump(suitRaw as Suit);
  }

  private async autoTrump(): Promise<void> {
    const g = this.g!;
    if (g.phase !== "trump_call" || g.hakemSeat == null) return;
    if (!g.firstFive.length) return;
    const suit = suitOf(highestCard(g.firstFive));
    this.broadcast({ type: "notice", text: `⏱️ حاکم فرصت انتخاب خال را نداشت — خال ${SUIT_SYMBOL_NAME(suit)} انتخاب شد.` });
    await this.applyTrump(suit);
  }

  private async applyTrump(suit: Suit): Promise<void> {
    const g = this.g!;
    const hakem = g.hakemSeat!;
    g.trumpSuit = suit;
    g.phase = "playing";
    g.leaderSeat = hakem;
    g.currentSeat = hakem;
    g.trickPlays = [];
    g.trickWinnerSeat = null;
    g.turnDeadline = Date.now() + this.turnTimeout() * 1000;
    await this.persist();

    this.sendToSeat(hakem, { type: "hand", hand: g.hands[hakem], partial: false });
    this.broadcast({ type: "state", state: this.publicState() });
    await this.setAlarm(g.turnDeadline, "turn");
  }

  private async handlePlay(meta: WsMeta, card: string): Promise<void> {
    const g = this.g!;
    if (g.phase !== "playing" || g.currentSeat == null) return;
    if (meta.seat !== g.currentSeat) return;
    const hand = g.hands[meta.seat] ?? [];
    if (!hand.includes(card)) return;
    const ledSuit = g.trickPlays.length > 0 ? suitOf(g.trickPlays[0].card) : null;
    if (!isLegal(hand, card, ledSuit)) return;
    await this.applyPlay(meta.seat, card);
  }

  private async applyPlay(seat: number, card: string): Promise<void> {
    const g = this.g!;
    g.hands[seat] = (g.hands[seat] ?? []).filter((c) => c !== card);
    g.trickPlays.push({ seat, card });
    g.turnDeadline = null;
    await this.persist();

    if (g.trickPlays.length === 4) {
      const winner = resolveTrick(g.trickPlays, g.trumpSuit!);
      g.tricksWon[winner] = (g.tricksWon[winner] ?? 0) + 1;
      g.trickWinnerSeat = winner;
      await this.persist();
      this.broadcast({ type: "state", state: this.publicState() });

      if (g.tricksWon[winner] >= 7) {
        await this.endHand();
        return;
      }

      g.leaderSeat = winner;
      g.currentSeat = winner;
      g.trickPlays = [];
      g.trickWinnerSeat = null;
      g.turnDeadline = Date.now() + this.turnTimeout() * 1000;
      await this.persist();
      this.broadcast({ type: "state", state: this.publicState() });
      await this.setAlarm(g.turnDeadline, "turn");
      return;
    }

    g.currentSeat = (seat + 1) % 4;
    g.turnDeadline = Date.now() + this.turnTimeout() * 1000;
    await this.persist();
    this.broadcast({ type: "state", state: this.publicState() });
    await this.setAlarm(g.turnDeadline, "turn");
  }

  private async endHand(): Promise<void> {
    const g = this.g!;
    const tricksByTeam: [number, number] = [0, 0];
    for (let seat = 0; seat < 4; seat++) {
      tricksByTeam[seat % 2] += g.tricksWon[seat] ?? 0;
    }
    const hakem = g.hakemSeat!;
    const { winnerTeam, points } = scoreHand(hakem, tricksByTeam);
    g.handScores = tricksByTeam;
    g.matchScores[winnerTeam] += points;
    g.handWinnerTeam = winnerTeam;
    g.handPoints = points;
    g.phase = "hand_over";
    g.turnDeadline = null;
    await this.persist();
    this.broadcast({ type: "state", state: this.publicState() });
    await this.editBoard();

    if (g.matchScores[winnerTeam] >= 7) {
      await this.endMatch(winnerTeam, null);
      return;
    }

    if (winnerTeam !== hakem % 2) {
      g.hakemSeat = (hakem + 1) % 4;
    }
    g.handNumber++;
    g.tricksWon = [0, 0, 0, 0];
    g.handScores = [0, 0];
    g.trickPlays = [];
    g.trickWinnerSeat = null;
    g.leaderSeat = null;
    g.currentSeat = null;
    g.firstFive = [];
    g.trumpSuit = null;
    g.handWinnerTeam = null;
    g.handPoints = null;
    g.phase = "hand_over";
    await this.persist();
    await this.setAlarm(Date.now() + 1500, "deal");
  }

  private async autoPlay(seat: number): Promise<void> {
    const g = this.g!;
    const hand = g.hands[seat] ?? [];
    const ledSuit = g.trickPlays.length > 0 ? suitOf(g.trickPlays[0].card) : null;
    const card = lowestLegalCard(hand, ledSuit);
    if (!card) return;

    g.strikes[seat] = (g.strikes[seat] ?? 0) + 1;
    this.broadcast({ type: "notice", text: `⏱️ ${g.seats[seat]?.name ?? "بازیکن"} وقتش تمام شد و به‌صورت خودکار بازی کرد!` });
    await this.persist();

    if (g.strikes[seat] >= this.afkStrikes()) {
      await this.forfeit(seat);
      return;
    }
    await this.applyPlay(seat, card);
  }

  private async forfeit(seat: number): Promise<void> {
    const g = this.g!;
    const winnerTeam = seat % 2 === 0 ? 1 : 0;
    const loserName = g.seats[seat]?.name ?? "";
    this.broadcast({ type: "notice", text: `🚪 ${loserName} بازی را ترک کرد — تیم مقابل برنده شد!` });
    await this.endMatch(winnerTeam, `forfeit:${g.seats[seat]?.userId ?? seat}`);
  }

  private async endMatch(winnerTeam: number, result: string | null): Promise<void> {
    const g = this.g!;
    g.phase = "match_over";
    g.winnerTeam = winnerTeam;
    g.result = result ?? "match";
    g.turnDeadline = null;
    await this.state.storage.deleteAlarm();
    await this.persist();

    await settleHokmMatch(this.env.DB, g.gameId, winnerTeam, g.result);
    this.broadcast({ type: "state", state: this.publicState() });
    await this.editBoard();
  }

  private async handleJoinTimeout(): Promise<void> {
    const g = this.g!;
    if (g.phase !== "waiting_join") return;
    g.phase = "cancelled";
    g.result = "cancelled";
    g.winnerTeam = null;
    await this.persist();
    await cancelHokmGame(this.env.DB, g.gameId);
    this.broadcast({
      type: "state",
      state: this.publicState(),
    });
    this.broadcast({ type: "notice", text: "⏱️ همه بازیکن‌ها وارد نشدند — بازی لغو شد و مبلغ‌ها برگشت." });
  }

  private boardText(): string {
    const g = this.g!;
    const team0 = g.seats.filter((s) => s && s.seat % 2 === 0).map((s) => s!.name).join(" & ") || "?";
    const team1 = g.seats.filter((s) => s && s.seat % 2 === 1).map((s) => s!.name).join(" & ") || "?";
    const trump = g.trumpSuit ? SUIT_SYMBOL_NAME(g.trumpSuit) : "—";
    let text =
      `♠️ <b>بازی حکم</b> ♠️\n\n` +
      `👥 تیم ۱: ${escapeName(team0)}\n` +
      `👥 تیم ۲: ${escapeName(team1)}\n\n` +
      `💰 پات: <b>${g.bet} MP</b> (هر نفر ${g.perPlayer})\n` +
      `🏆 امتیاز: ${g.matchScores[0]} - ${g.matchScores[1]}\n` +
      `🔢 دست: ${g.handNumber}`;

    if (g.phase === "playing" || g.phase === "trump_call") {
      text += `\n🎴 خال: <b>${trump}</b>`;
    }
    if (g.phase === "hand_over") {
      text += `\n🎴 خال: <b>${trump}</b>\n💥 برنده دست: ${g.handWinnerTeam != null ? `تیم ${g.handWinnerTeam + 1}` : "—"} (${g.handPoints ?? 0} امتیاز)`;
    }
    if (g.phase === "match_over") {
      const winnerNames = g.seats.filter((s) => s && s.seat % 2 === g.winnerTeam).map((s) => s!.name).join(" & ");
      text += `\n🏁 <b>پایان بازی</b>\n🎉 برنده: ${escapeName(winnerNames)}\n💰 ${g.bet} MP`;
    }
    if (g.phase === "cancelled") {
      text += `\n❌ بازی لغو شد و مبلغ‌ها برگشت.`;
    }
    return text;
  }

  private async editBoard(): Promise<void> {
    const g = this.g!;
    if (g.boardMsgId == null) return;
    await editMessageText(this.env.TELEGRAM_BOT_TOKEN, g.groupId, g.boardMsgId, this.boardText(), hokmBoardKeyboard(g.gameId, g.appUrl));
  }
}

function SUIT_SYMBOL_NAME(s: Suit): string {
  switch (s) {
    case "S":
      return "پیک ♠";
    case "H":
      return "دل ♥";
    case "D":
      return "خشت ♦";
    case "C":
      return "گشنیز ♣";
  }
}

function escapeName(name: string): string {
  return name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
