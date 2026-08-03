(function () {
  "use strict";

  const SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const SUIT_NAMES = { S: "پیک", H: "دل", D: "خشت", C: "گشنیز" };
  const RED_SUITS = ["H", "D"];

  const $ = (id) => document.getElementById(id);

  const state = {
    gameId: null,
    ws: null,
    role: "observer",
    seat: null,
    st: null, // public state
    hand: [],
    firstFive: [],
    selected: null,
    lastDraw: null,
  };

  // ---- helpers -----------------------------------------------------------

  function cardEl(card, opts) {
    opts = opts || {};
    const suit = card.slice(-1);
    const rank = card.slice(0, -1);
    const el = document.createElement("div");
    el.className = "card" + (RED_SUITS.includes(suit) ? " red" : "");
    if (opts.back) el.classList.add("back");
    if (opts.winner) el.classList.add("winner");
    if (opts.small) el.style.transform = "scale(0.7)";
    el.dataset.card = card;
    const r = document.createElement("div");
    r.className = "rank";
    r.textContent = rank;
    const s = document.createElement("div");
    s.className = "suit";
    s.textContent = SUITS[suit];
    el.appendChild(r);
    el.appendChild(s);
    return el;
  }

  function seatName(seat) {
    if (!state.st) return "";
    const info = state.st.seats[seat];
    return info ? info.name : "؟";
  }

  function teamColor(seat) {
    return seat % 2 === 0 ? "team-a" : "team-b";
  }

  function isMyTurn() {
    return (
      state.st &&
      state.st.phase === "playing" &&
      state.role === "player" &&
      state.st.currentSeat === state.seat
    );
  }

  function ledSuit() {
    if (!state.st || !state.st.trickPlays.length) return null;
    const c = state.st.trickPlays[0].card;
    return c.slice(-1);
  }

  function legalCards() {
    if (!isMyTurn()) return [];
    const led = ledSuit();
    if (!led) return state.hand.slice();
    const hasLed = state.hand.some((c) => c.slice(-1) === led);
    if (hasLed) return state.hand.filter((c) => c.slice(-1) === led);
    return state.hand.slice();
  }

  function countdown() {
    if (!state.st || !state.st.turnDeadline) return "";
    const left = Math.max(0, Math.ceil((state.st.turnDeadline - Date.now()) / 1000));
    return left > 0 ? `⏱️ ${left}s` : "";
  }

  // ---- rendering ---------------------------------------------------------

  function render() {
    renderTopbar();
    renderOpponents();
    renderTrick();
    renderReveal();
    renderHand();
    renderControls();
    renderStatus();
    renderModal();
  }

  function renderTopbar() {
    const st = state.st;
    if (!st) return;
    const teamA = st.seats.filter((s) => s && s.seat % 2 === 0).map((s) => s.name).join(" & ");
    const teamB = st.seats.filter((s) => s && s.seat % 2 === 1).map((s) => s.name).join(" & ");
    $("teamAName").textContent = teamA || "تیم ۱";
    $("teamBName").textContent = teamB || "تیم ۲";
    $("teamAScore").textContent = st.matchScores[0];
    $("teamBScore").textContent = st.matchScores[1];
    $("trump").textContent = st.trumpSuit ? SUITS[st.trumpSuit] : "—";
    $("handLabel").textContent = st.handNumber ? `دست ${st.handNumber}` : "در حال آماده‌سازی";
    $("pot").textContent = `💰 ${st.bet} MP`;
  }

  function renderOpponents() {
    const st = state.st;
    if (!st) return;
    const container = $("opponents");
    container.innerHTML = "";
    for (let seat = 0; seat < 4; seat++) {
      if (seat === state.seat && state.role === "player") continue;
      const info = st.seats[seat];
      const chip = document.createElement("div");
      chip.className = "player-chip " + teamColor(seat);
      const online = st.connected.includes(seat);
      chip.classList.add(online ? "online" : "offline");
      if (st.currentSeat === seat && st.phase === "playing") chip.classList.add("turn");
      const dot = document.createElement("span");
      dot.className = "dot";
      chip.appendChild(dot);
      const label = document.createElement("span");
      const hakem = st.hakemSeat === seat ? "♠️" : "";
      const turn = st.currentSeat === seat && st.phase === "playing" ? " ▶" : "";
      label.textContent = (info ? info.name : "؟") + " " + hakem + turn;
      chip.appendChild(label);
      container.appendChild(chip);
    }
  }

  function renderTrick() {
    const st = state.st;
    if (!st) return;
    const slots = ["slot0", "slot1", "slot2", "slot3"];
    slots.forEach((id) => ($(id).innerHTML = ""));
    for (const play of st.trickPlays) {
      const el = cardEl(play.card, { winner: st.trickWinnerSeat === play.seat });
      $(slots[play.seat]).appendChild(el);
    }
  }

  function renderReveal() {
    const st = state.st;
    const area = $("revealArea");
    if (st && st.phase === "drawing_hakem") {
      area.classList.remove("hidden");
      if (!state.lastDraw) {
        area.innerHTML = `<div style="font-size:16px">قرعه‌کشی برای انتخاب حاکم...</div>`;
      }
    } else {
      area.classList.add("hidden");
    }
  }

  function renderHand() {
    const st = state.st;
    const handEl = $("hand");
    handEl.innerHTML = "";

    if (!st) return;
    const isTrumpCallHakem =
      st.phase === "trump_call" && state.role === "player" && state.seat === st.hakemSeat;

    let cards = state.hand;
    if (isTrumpCallHakem && state.firstFive.length) cards = state.firstFive;

    if (st.phase === "waiting_join") {
      handEl.innerHTML = `<div class="notice">منتظر ورود بازیکن‌ها...</div>`;
      return;
    }
    if (st.phase === "drawing_hakem") {
      handEl.innerHTML = `<div class="notice">در حال قرعه‌کشی حاکم...</div>`;
      return;
    }
    if (st.phase === "match_over" || st.phase === "cancelled") {
      handEl.innerHTML = "";
      return;
    }

    const legal = legalCards();
    for (const card of cards) {
      const el = cardEl(card);
      el.addEventListener("click", () => {
        if (isTrumpCallHakem) return;
        if (!legal.includes(card)) return;
        state.selected = state.selected === card ? null : card;
        renderHand();
      });
      if (st.phase === "playing" && state.role === "player") {
        if (!legal.includes(card)) el.classList.add("disabled");
        if (state.selected === card) el.classList.add("selected");
      } else {
        el.classList.add("disabled");
      }
      handEl.appendChild(el);
    }
  }

  function renderControls() {
    const canPlay = isMyTurn() && state.selected && legalCards().includes(state.selected);
    const btn = $("playBtn");
    if (canPlay) {
      btn.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
    }
  }

  function renderStatus() {
    const st = state.st;
    const line = $("statusLine");
    if (!st) {
      line.textContent = "";
      return;
    }
    if (st.phase === "waiting_join") {
      line.textContent = `✅ ${st.connected.length}/4 وارد شدند`;
    } else if (st.phase === "drawing_hakem") {
      line.textContent = "قرعه‌کشی حاکم...";
    } else if (st.phase === "trump_call") {
      line.textContent =
        state.role === "player" && state.seat === st.hakemSeat
          ? "🎴 خال رو انتخاب کن!"
          : `⏳ حاکم (${seatName(st.hakemSeat)}) خال انتخاب می‌کند...`;
    } else if (st.phase === "playing") {
      line.textContent =
        state.role === "observer"
          ? `نوبت: ${seatName(st.currentSeat)}`
          : isMyTurn()
            ? "🎴 نوبت توست!" + " " + countdown()
            : `نوبت: ${seatName(st.currentSeat)}` + " " + countdown();
    } else if (st.phase === "hand_over") {
      const winnerTeam = st.handWinnerTeam != null ? st.handWinnerTeam + 1 : "";
      line.textContent = `🏁 دست تمام شد! برنده: تیم ${winnerTeam} (+${st.handPoints})`;
    } else if (st.phase === "match_over") {
      line.textContent = "🎉 بازی تمام شد!";
    } else if (st.phase === "cancelled") {
      line.textContent = "❌ بازی لغو شد";
    }
  }

  function renderModal() {
    const st = state.st;
    const modal = $("modal");
    const title = $("modalTitle");
    const body = $("modalBody");

    const isTrumpCallHakem =
      st && st.phase === "trump_call" && state.role === "player" && state.seat === st.hakemSeat;

    if (isTrumpCallHakem) {
      modal.classList.remove("hidden");
      title.textContent = "🎴 خال را انتخاب کن";
      const wrap = document.createElement("div");
      const cards = document.createElement("div");
      cards.className = "modal-cards";
      for (const card of state.firstFive.length ? state.firstFive : state.hand) {
        cards.appendChild(cardEl(card));
      }
      wrap.appendChild(cards);
      const btns = document.createElement("div");
      btns.className = "suit-btns";
      for (const [suit, sym] of Object.entries(SUITS)) {
        const b = document.createElement("button");
        b.className = "suit-btn" + (RED_SUITS.includes(suit) ? " red" : "");
        b.textContent = sym + " " + SUIT_NAMES[suit];
        b.addEventListener("click", () => send({ type: "trump", suit }));
        btns.appendChild(b);
      }
      wrap.appendChild(btns);
      body.innerHTML = "";
      body.appendChild(wrap);
      return;
    }

    if (st && st.phase === "match_over") {
      modal.classList.remove("hidden");
      title.textContent = "🏆 پایان بازی";
      const box = document.createElement("div");
      box.className = "result-box";
      const big = document.createElement("div");
      big.className = "big";
      if (st.result === "cancelled" || st.phase === "cancelled") {
        big.textContent = "❌ بازی لغو شد";
      } else {
        const winners = st.seats
          .filter((s) => s && s.seat % 2 === st.winnerTeam)
          .map((s) => s.name)
          .join(" & ");
        big.textContent = "🎉 " + winners;
        const sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = `برنده هر نفر: ${st.perPlayer * 2} MP`;
        box.appendChild(sub);
      }
      const rematch = document.createElement("div");
      rematch.className = "sub";
      rematch.textContent = "برای بازی دوباره در گروه بنویس: /hokm";
      box.appendChild(rematch);
      body.innerHTML = "";
      body.appendChild(big);
      body.appendChild(box);
      return;
    }

    if (st && st.phase === "cancelled") {
      modal.classList.remove("hidden");
      title.textContent = "❌ بازی لغو شد";
      const box = document.createElement("div");
      box.className = "result-box";
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = "همه بازیکن‌ها وارد نشدند؛ مبلغ‌ها برگشت خورد.";
      box.appendChild(sub);
      body.innerHTML = "";
      body.appendChild(box);
      return;
    }

    modal.classList.add("hidden");
  }

  function showNotice(text, warn) {
    const msg = $("message");
    msg.textContent = text;
    msg.classList.remove("hidden");
    if (warn) msg.classList.add("warn");
    else msg.classList.remove("warn");
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => msg.classList.add("hidden"), 4000);
  }

  function showNoticePersistent(text) {
    const msg = $("message");
    msg.textContent = text;
    msg.classList.remove("hidden");
    msg.classList.add("warn");
    clearTimeout(showNotice._t);
  }

  // ---- websocket ---------------------------------------------------------

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData : "";
    return `${proto}${location.host}/api/hokm/${state.gameId}/ws?initData=${encodeURIComponent(tg)}`;
  }

  function connect() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(wsUrl());
    state.ws = ws;

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handle(msg);
    };

    ws.onerror = () => {
      if (!state.st) {
        showNoticePersistent("⚠️ اتصال به بازی برقرار نشد. مطمئن شو بازی رو از دکمه «بازی را باز کن» داخل تلگرام باز کردی.");
      }
    };

    ws.onclose = () => {
      state.ws = null;
      if (!state.st) {
        showNoticePersistent("⚠️ اتصال به بازی برقرار نشد (تأیید هویت ناموفق). بازی باید از دکمه «بازی را باز کن» داخل تلگرام باز بشه — لینک ساده بدون دکمه کار نمی‌کنه.");
        return;
      }
      if (state.st.phase === "match_over" || state.st.phase === "cancelled") return;
      setTimeout(connect, 2000);
    };
  }

  function send(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  // ---- events ------------------------------------------------------------

  function handle(msg) {
    switch (msg.type) {
      case "welcome":
        state.role = msg.role;
        state.seat = msg.seat;
        state.st = msg.state;
        state.hand = msg.hand || [];
        state.firstFive = msg.firstFive || [];
        break;
      case "state":
        state.st = msg.state;
        state.lastDraw = null;
        break;
      case "connected":
        if (state.st) state.st.connected = msg.connected;
        break;
      case "hand":
        if (msg.partial) {
          state.firstFive = msg.hand || [];
          state.hand = [];
        } else {
          state.hand = msg.hand || [];
          state.firstFive = [];
        }
        state.selected = null;
        break;
      case "draw":
        state.lastDraw = { card: msg.card, seat: msg.seat, ace: msg.ace };
        if (state.st) {
          state.st.drawIndex = (msg.seat + 1) % 4;
          if (msg.hakemSeat != null) state.st.hakemSeat = msg.hakemSeat;
        }
        break;
      case "notice":
        showNotice(msg.text, true);
        break;
      case "error":
        showNotice(msg.text, true);
        break;
    }
    render();
  }

  // ---- init --------------------------------------------------------------

  function init() {
    const params = new URLSearchParams(location.search);
    state.gameId = params.get("game");

    if (window.Telegram && window.Telegram.WebApp) {
      try {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      } catch (e) {
        // ignore
      }
    }

    if (!state.gameId) {
      showNotice("لینک بازی نامعتبر است.", true);
      return;
    }

    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp.initData : "";
    if (!tg) {
      showNoticePersistent("⚠️ این بازی باید از داخل تلگرام و با دکمه «بازی را باز کن» باز بشه (دکمه Mini App). لینک ساده بدون دکمه کار نمی‌کنه.");
      return;
    }

    connect();
  }

  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest("#playBtn")) {
      if (isMyTurn() && state.selected && legalCards().includes(state.selected)) {
        const card = state.selected;
        send({ type: "play", card });
        state.hand = state.hand.filter((c) => c !== card);
        state.selected = null;
        render();
      }
    }
  });

  setInterval(() => {
    if (state.st && state.st.phase === "playing") renderStatus();
  }, 1000);
})();
