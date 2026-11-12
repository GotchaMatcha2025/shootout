/* Gotcha Shootout 3v3 — a server inside the page, speaking the real messages (API-3V3.md §3, §10) with Sim3. Two jobs:
   1. ?api=fake: test and demo with no network (solo vs the Matcha Bot, rooms filled by fake friends, error codes, drops).
   2. Plan B (§8): when the real-time server can't be reached, single player runs here and only the code comes from POST /solo.
   Test codes for ?api=fake: join NONE → "no-room", FULL → "room-full", GONE → "started"; any other code joins a room (?size=2 for 2 v 2). */
"use strict";
const Fake = (() => {
  const Q = new URLSearchParams(location.search), FAKE = Net.mode === "fake";
  const LAG = FAKE ? Math.max(0, +(Q.get("lag") || 45)) : 0;          // one-way delay in ms (?lag=)
  const SKEW = FAKE ? 2345 : 0;                                        // a wrong phone clock on purpose: the countdowns must still be right
  const FRIENDS = Q.get("friends") !== "0", SOLO_SIZE = +(Q.get("solo") || 1) === 3 ? 3 : 1;
  const need = () => (globalThis.Sim3 && Sim3.C.CHALLENGE_GOALS) || 1;   // one goal beats the Matcha Bot (owner 12 Nov ~20:34, §11)
  const ABC = "ACDEFHJKMNPQRTUVWXY34679", now = () => Date.now() + SKEW, S = () => globalThis.Sim3;
  const code = n => { let c = ""; for (let i = 0; i < n; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; };
  let nIn = 0, lastIn = null;
  let sock = null, dev = null, refuse = 0, closed = false, room = null, match = null, lastEnd = null, acked = null, qT = 0;
  const results = [];

  // deliver in order, LAG ms later (+ a little jitter), like one 4G socket
  function later(fn){ const t = Math.max(qT, Date.now() + LAG + Math.random() * (LAG ? 15 : 0)); qT = t; setTimeout(fn, t - Date.now()); }
  function out(o){ const s = sock; if (!s) return; const txt = JSON.stringify(o); later(() => { if (s.readyState === 1 && s.onmessage) s.onmessage({ data: txt }); }); }
  function socket(d){
    dev = d;
    const s = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(txt){ if (s.readyState !== 1) throw new Error("closed"); later(() => { if (sock === s) recv(JSON.parse(txt)); }); },
      close(){ if (s.readyState === 3) return; s.readyState = 3; if (sock === s){ sock = null; gone(); } setTimeout(() => s.onclose && s.onclose({}), 0); } };
    setTimeout(() => {
      if (s.readyState !== 0) return;
      if (Date.now() < refuse){ s.readyState = 3; if (s.onclose) s.onclose({}); return; }   // no signal: the connect fails
      s.readyState = 1; sock = s; if (s.onopen) s.onopen({}); opened();
    }, LAG * 2 + 5);
    return s;
  }
  function opened(){
    if (match){ if (match.bot){ S().setBot(match.m, match.you.team, match.you.slot, false); match.bot = false; } match.goneAt = 0; out(startMsg()); }   // §9.2: re-send start
    else if (room) out(roomMsg());
    if (lastEnd && acked !== lastEnd.id) out(lastEnd);   // §9.2: the result the phone hasn't acknowledged
  }
  function gone(){   // the phone's socket dropped: its player stops; a bot holds the seat after 3 s
    if (!match) return; S().setInput(match.m, match.you.team, match.you.slot, { a: 0 }); match.goneAt = Date.now();
    const id = match.id; setTimeout(() => { if (match && match.id === id && match.goneAt && !sock){ S().setBot(match.m, match.you.team, match.you.slot, true); match.bot = true; } }, 3000);
  }

  /* rooms (§10): you + fake friends who sit down one by one; full → 5 s countdown */
  function newRoom(size, cat, host, c){
    const seats = [[], []]; for (let t = 0; t < 2; t++) for (let s = 0; s < size; s++) seats[t].push(null);
    room = { code: c || code(4), size, seats, you: null, k: null, rm: {}, timer: 0, used: false };
    if (host) seats[0][0] = { cat: (cat + 1) % 4, h: 1, f: 1 };
    sit(cat); out(roomMsg()); if (FRIENDS) fill(); checkFull();
  }
  function sit(cat, team, slot){
    const r = room; if (r.you) r.seats[r.you.team][r.you.slot] = null;
    if (team === undefined) [team, slot] = pickSeat();
    r.seats[team][slot] = { cat, h: 1, me: 1 }; r.you = { team, slot };
  }
  // auto-balance: the emptier team (Matcha on a tie), its first free seat
  function pickSeat(){ const n = t => room.seats[t].filter(Boolean).length, t = n(1) < n(0) ? 1 : 0; return [t, room.seats[t].indexOf(null)]; }
  function free(){ const f = []; room.seats.forEach((col, t) => col.forEach((s, i) => { if (!s) f.push([t, i]); })); return f; }
  function fill(){
    const id = room.code;
    free().forEach((ts, i) => setTimeout(() => {
      if (!room || room.code !== id || room.k || !free().length) return; const [t, s] = pickSeat();
      room.seats[t][s] = { cat: (i + 2) % 4, h: 1, f: 1 }; out(roomMsg()); checkFull();
    }, 1400 * (i + 1)));
  }
  function checkFull(){
    if (!room || room.k || free().length) return;
    room.k = now() + 5000; out(roomMsg()); const id = room.code;
    room.timer = setTimeout(() => { if (room && room.code === id && room.k) startMatch(false); }, 5000);
  }
  function roomMsg(){
    const seats = room.seats.map(col => col.map(s => s && (s.me ? { cat: s.cat, h: 1, me: 1, rm: room.rm.me ? 1 : 0 } : { cat: s.cat, h: 1, rm: room.rm.f ? 1 : 0 })));
    return { t: "room", code: room.code, size: room.size, seats, you: room.you, k: room.k, now: now() };
  }

  /* matches: solo = the challenge vs the hard bot (§7/§8); a room = versus */
  function startMatch(solo, cat){
    let size, cats, bots, you, md;
    if (solo){ size = SOLO_SIZE; you = { team: 0, slot: 0 }; md = 1;
      cats = [[cat], [3]]; bots = [[0], [1]]; for (let s = 1; s < size; s++){ cats[0].push((cat + s) % 4); cats[1].push(s % 4); bots[0].push(1); bots[1].push(1); } }
    else { size = room.size; you = room.you; md = 0; cats = room.seats.map(col => col.map(s => s.cat)); bots = room.seats.map(col => col.map(() => 0));
      room.k = null; room.rm = {}; room.used = true; }
    const seed = Math.floor(Math.random() * 2147483647);
    const m = S().createMatch({ seed, humans: [you], cats, size, mode: md ? "challenge" : "versus", goalsToWin: need() });
    // the fake friends are played by the sim's bots, but they are people on the phone (bots = 0)
    match = { id: "F" + code(7), m, you, size, md, cats, bots, seed, at: now(), ack: 0, solo, bot: false, goneAt: 0, acc: 0, lastT: Date.now(), t0: Date.now() };
    out(startMsg());
    match.tick = setInterval(tick, 1000 / 30);
  }
  function startMsg(){ const M = match; return { t: "start", id: M.id, seed: M.seed, you: M.you, cats: M.cats, bots: M.bots, at: M.at, md: M.md, need: M.md ? need() : undefined, size: M.size }; }
  function tick(){
    const M = match; if (!M) return;
    const t = Date.now(); M.acc = Math.min(M.acc + (t - M.lastT) / 1000, 4 / 60); M.lastT = t;   // real elapsed time, at most 4 steps a tick
    while (M.acc >= 1 / 60 && match === M){
      M.acc -= 1 / 60;
      for (const e of S().step(M.m, 1 / 60)){
        if (e.k === "end"){ finish(e); return; }
        if (e.k === "hit" && !(e.p >= 0.15)) continue;
        out(Object.assign({ t: "ev" }, e));
      }
    }
    out(Object.assign({ t: "s" }, S().snapshot(M.m), { ack: M.ack }));
  }
  async function finish(e){
    const M = match; clearInterval(M.tick); match = null;
    const snap = S().snapshot(M.m), w = typeof snap.w === "number" ? snap.w : -1, me = M.you.team;
    const sc = snap.sc || [w === 0 ? 1 : 0, w === 1 ? 1 : 0];
    let r = e && (me === 0 ? e.r0 : e.r1);
    if (!r) r = M.md ? (w === me ? "win" : "lose") : (w < 0 ? "draw" : w === me ? "win" : "lose");
    let c = code(6), prize = null;
    if (!FAKE){   // plan B: the code still comes from the server
      const res = await Net.post("/solo", { dev, goals: sc[me], ms: Date.now() - M.t0 });
      c = res && res.ok && res.code ? res.code : null; prize = res && res.prize || null; if (res && res.r) r = res.r;
    }
    const msg = { t: "end", id: M.id, r, w, code: c, prize, md: M.md, sc };
    if (c) results.push({ code: c, r, at: now(), prize, used: null });
    lastEnd = msg; out(msg);
  }

  function recv(m){
    if (!m || typeof m !== "object") return;
    switch (m.t){
      case "ping": out({ t: "pong", c: m.c, s: now() }); break;
      case "in": nIn++; lastIn = m; if (match && !match.bot && Number.isInteger(m.s) && m.s > match.ack){ match.ack = m.s; S().setInput(match.m, match.you.team, match.you.slot, m); } break;
      case "got": acked = m.id; break;
      case "hello":
        if (closed){ out({ t: "err", m: "closed" }); break; }
        if (match) break;                                        // §9.2: a hello during a running match is ignored
        if (m.mode === "solo"){ room = null; startMatch(true, m.cat | 0); } break;
      case "create":
        if (closed){ out({ t: "err", m: "closed" }); break; }
        if (match) break; newRoom(m.size === 2 ? 2 : 1, m.cat | 0, false); break;
      case "join": {
        if (closed){ out({ t: "err", m: "closed" }); break; }
        const c = String(m.code || "").toUpperCase();
        if (c === "FULL") out({ t: "err", m: "room-full" });
        else if (c === "GONE") out({ t: "err", m: "started" });
        else if (c.length !== 4 || c === "NONE" || [...c].some(ch => ABC.indexOf(ch) < 0)) out({ t: "err", m: "no-room" });
        else newRoom(+(Q.get("size") || 1) === 2 ? 2 : 1, m.cat | 0, true, c);
        break; }
      case "seat":
        if (room && !room.k && room.seats[m.team] && room.seats[m.team][m.slot] === null){ sit(room.seats[room.you.team][room.you.slot].cat, m.team, m.slot); out(roomMsg()); checkFull(); }
        break;
      case "rematch":
        if (!room || match) break; room.rm.me = 1; out(roomMsg());
        setTimeout(() => { if (room && !match){ room.rm.f = 1; out(roomMsg()); room.k = now() + 5000; out(roomMsg()); const id = room.code;
          room.timer = setTimeout(() => { if (room && room.code === id && room.k) startMatch(false); }, 5000); } }, 1500);
        break;
      case "leave": if (room && !match){ clearTimeout(room.timer); room = null; } break;
    }
  }

  async function post(path, body){
    await new Promise(r => setTimeout(r, LAG * 2));
    if (path === "/") return { ok: true, v: "fake", closed, solo: null, need: need(), status: 200 };
    if (path === "/result"){
      const r = body && body.code ? results.find(x => x.code === body.code) : results[results.length - 1];
      return r ? { ok: true, r: r.r, at: r.at, prize: r.prize, used: r.used, code: r.code, status: 200 } : { ok: false, e: "not-found", status: 404 };
    }
    return { ok: false, e: "not-found", status: 404 };
  }
  // test hooks (?api=fake only): drop the line for ms, staff redeem, kill switch, a peek at the state
  if (FAKE) window.S3Fake = {
    drop(ms){ refuse = Date.now() + (ms || 0); const s = sock; if (s){ sock = null; s.readyState = 3; gone(); setTimeout(() => s.onclose && s.onclose({}), 0); } },
    redeem(c){ const r = c ? results.find(x => x.code === c) : results[results.length - 1]; if (r) r.used = now(); return !!r; },
    close(on){ closed = on !== false; },
    state(){ return { room: room && { code: room.code, size: room.size, k: room.k, you: room.you }, match: match && { id: match.id, md: match.md, bot: match.bot, ack: match.ack, st: match.m.st }, results: results.slice(), acked, nIn, lastIn }; }
  };
  return { socket, post };
})();
