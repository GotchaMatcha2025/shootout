/* Gotcha Shootout 3v3 — a server inside the page, speaking the real messages (API-3V3.md §3, §10) with Sim3. Two jobs:
   1. ?api=fake: test and demo with no network (solo vs the Matcha Bot, rooms filled by fake friends, error codes, drops).
   2. Plan B (§8): when the real-time server can't be reached, single player runs here and only the code comes from POST /solo.
   Test codes for ?api=fake: join NNNN → "no-room", FFFF → "room-full", XXXX → "started"; 7777 = the booth game (1 v 1, starts by itself;
   ?lonely=1: nobody comes → lonely:1); any other code joins a friend's room (?size=2 for 2 v 2). */
"use strict";
const Fake = (() => {
  const Q = new URLSearchParams(location.search), FAKE = Net.mode === "fake";
  const LAG = FAKE ? Math.max(0, +(Q.get("lag") || 45)) : 0;          // one-way delay in ms (?lag=)
  const SKEW = FAKE ? 2345 : 0;                                        // a wrong phone clock on purpose: the countdowns must still be right
  const FRIENDS = Q.get("friends") !== "0", SOLO_SIZE = +(Q.get("solo") || 1) === 3 ? 3 : 1;
  const PRIZE = Q.get("prize") === "1" ? { win: "TEST FREE MATCHA", lose: "TEST $1 OFF", draw: "TEST $1 OFF" } : null;   // ?prize=1: labels as staging TEST
  const WHY = Q.get("why");
  let busyLeft = +(Q.get("busy") || 0);   // ?busy=N: the first N asks (solo / create / join) answer "busy"   // ?why=used|hours|offline|cap|none: no prize, for this reason
  const need = () => (globalThis.Sim3 && Sim3.C.CHALLENGE_GOALS) || 1;   // one goal beats the Matcha Bot (owner 12 Nov ~20:34, §11)
  const ABC = "ACDEFHJKMNPQRTUVWXY34679", now = () => Date.now() + SKEW, S = () => globalThis.Sim3;
  const code = n => { let c = ""; for (let i = 0; i < n; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; };
  let nIn = 0, lastIn = null;
  let sock = null, dev = null, refuse = 0, closed = false, room = null, match = null, lastEnd = null, acked = null, qT = 0;
  const results = [], stats = { goals: 0, beaten: 0 };   // this fake's own counts (the LED ticker shows only real counts)

  // a 4G-like line, in order per direction: ?rtt= (ms, both ways together; default 2×LAG), ?jitter= (ms, one way), ?gaps=1 (now and then
  // the line stalls 500 ms, then everything arrives at once). Down = server → phone, up = phone → server.
  const RTT = +(Q.get("rtt") || 2 * LAG), JIT = +(Q.get("jitter") || (LAG ? 15 : 0)), GAPS = Q.get("gaps") === "1";
  const qq = { down: 0, up: 0 }; let gapUntil = 0, nextGap = Date.now() + 2500;
  function later(fn, dir){
    const n = Date.now(); dir = dir || "down";
    if (GAPS && n > nextGap){ gapUntil = n + 500; nextGap = n + 2500 + Math.random() * 3000; }
    const t = Math.max(qq[dir], n + RTT / 2 + Math.random() * JIT, gapUntil); qq[dir] = t; setTimeout(fn, t - n);
  }
  function out(o){ const s = sock; if (!s) return; const txt = JSON.stringify(o); later(() => { if (s.readyState === 1 && s.onmessage) s.onmessage({ data: txt }); }, "down"); }
  function socket(d){
    dev = d;
    const s = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(txt){ if (s.readyState !== 1) throw new Error("closed"); later(() => { if (sock === s) recv(JSON.parse(txt)); }, "up"); },
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
    room = { code: c || code(4), size, seats, you: null, k: null, rm: {}, timer: 0, used: false, makerMe: !host };
    if (host) seats[0][0] = { cat: (cat + 1) % 4, h: 1, f: 1, mk: 1 };
    sit(cat); out(roomMsg()); if (FRIENDS) fill(); checkFull();
  }
  function sit(cat, team, slot){
    const r = room; if (r.you) r.seats[r.you.team][r.you.slot] = null;
    if (team === undefined) [team, slot] = pickSeat();
    const other = r.seats[team][slot]; if (other && r.you) r.seats[r.you.team][r.you.slot] = other;   // a taken seat swaps you both (§12.2)
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
  // full room: the game maker taps Start (§12.2); a fake host who made the room taps it 1.5 s later
  function checkFull(){ if (room && room.booth && !room.k && !free().length){ go(3000); return; }   // the booth game starts by itself in 3 s (§14)
    if (room && !room.k && !free().length && !room.makerMe){ const id = room.code; setTimeout(() => { if (room && room.code === id) go(); }, 1500); } }
  function go(ms){
    if (!room || room.k || free().length) return; ms = ms || 5000;
    room.k = now() + ms; out(roomMsg()); const id = room.code;
    room.timer = setTimeout(() => { if (room && room.code === id && room.k) startMatch(false); }, ms);
  }
  const BOOTH = "7777";
  function boothRoom(cat){   // the open booth room: you on Matcha, the other seat waits for someone at the booth
    room = { code: BOOTH, size: 1, seats: [[{ cat, h: 1, me: 1 }], [null]], you: { team: 0, slot: 0 }, k: null, rm: {}, timer: 0, used: false, makerMe: false, booth: true, lonely: 0 };
    out(roomMsg());
    setTimeout(() => { if (!room || !room.booth || room.k || !free().length) return;
      if (Q.get("lonely") === "1"){ room.lonely = 1; out(roomMsg()); }   // (the real server says so after 60 s alone)
      else if (FRIENDS){ room.seats[1][0] = { cat: (cat + 2) % 4, h: 1, f: 1 }; out(roomMsg()); checkFull(); } }, 1500);
  }
  function roomMsg(){
    const seats = room.seats.map(col => col.map(s => {
      if (!s) return null; const o = { cat: s.cat, h: 1 };
      if (s.me){ o.me = 1; if (room.makerMe) o.mk = 1; if (room.after && room.rm.me) o.rm = 1; } else { if (s.mk) o.mk = 1; if (room.after && room.rm.f) o.rm = 1; }
      return o; }));
    const o = { t: "room", code: room.code, size: room.size, seats, you: room.you, k: room.k, now: now(), after: room.after ? 1 : 0 };
    if (room.booth) o.booth = true; if (room.lonely) o.lonely = 1; return o;
  }

  /* matches: solo = the challenge vs the hard bot (§7/§8); a room = versus */
  function startMatch(solo, cat){
    let size, cats, bots, you, md;
    if (solo){ size = SOLO_SIZE; you = { team: 0, slot: 0 }; md = 1;
      cats = [[cat], [3]]; bots = [[0], [1]]; for (let s = 1; s < size; s++){ cats[0].push((cat + s) % 4); cats[1].push(s % 4); bots[0].push(1); bots[1].push(1); } }
    else { size = room.size; you = room.you; md = 0; cats = room.seats.map(col => col.map(s => s.cat)); bots = room.seats.map(col => col.map(() => 0));
      room.k = null; room.rm = {}; room.used = true; room.after = 0; }
    const seed = Math.floor(Math.random() * 2147483647);
    // multiplayer: first to VS_GOALS in VS_SECS (owner ~22:54; ?vsgoals= / ?vssecs= for quick tests), as the server passes them
    const vsNeed = +(Q.get("vsgoals") || 3), vsSecs = +(Q.get("vssecs") || 120);
    const m = S().createMatch(md ? { seed, humans: [you], cats, size, mode: "challenge", goalsToWin: need() } : { seed, humans: [you], cats, size, mode: "versus", goalsToWin: vsNeed, matchSecs: vsSecs });
    // the fake friends are played by the sim's bots, but they are people on the phone (bots = 0)
    match = { id: "F" + code(7), m, you, size, md, cats, bots, seed, at: now(), need: md ? need() : vsNeed, secs: md ? S().C.MATCH_S : vsSecs, ack: 0, solo, bot: false, goneAt: 0, acc: 0, lastT: Date.now(), t0: Date.now() };
    out(startMsg());
    match.tick = setInterval(tick, 1000 / 30);
  }
  function startMsg(){ const M = match; return { t: "start", id: M.id, seed: M.seed, you: M.you, cats: M.cats, bots: M.bots, at: M.at, md: M.md, need: M.need, secs: M.secs, size: M.size }; }
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
    // bt: seats a bot holds right now (the bot side, and this phone's seat while it is away); the fake friends count as people
    let bt = 0; for (let t = 0; t < 2; t++) for (let i = 0; i < M.size; i++) if ((M.bots[t] || [])[i] === 1 || (M.bot && t === M.you.team && i === M.you.slot)) bt |= 1 << (t * M.size + i);
    out(Object.assign({ t: "s" }, S().snapshot(M.m), { ack: M.ack, bt }));
  }
  async function finish(e){
    const M = match; clearInterval(M.tick); match = null;
    const snap = S().snapshot(M.m), w = typeof snap.w === "number" ? snap.w : -1, me = M.you.team;
    const sc = snap.sc || [w === 0 ? 1 : 0, w === 1 ? 1 : 0];
    let r = e && (me === 0 ? e.r0 : e.r1);
    if (!r) r = M.md ? (w === me ? "win" : "lose") : (w < 0 ? "draw" : w === me ? "win" : "lose");
    let c = code(6), prize = PRIZE && !WHY && !(M.md && r !== "win") ? { label: PRIZE[r] } : null, why = prize ? null : WHY || "none";
    if (!FAKE){   // plan B: the code still comes from the server
      const res = await Net.post("/solo", { dev, goals: sc[me], ms: Date.now() - M.t0 });
      c = res && res.ok && res.code ? res.code : null; prize = null; why = "offline"; if (res && res.r) r = res.r;   // played on the phone: never a prize (§12.3)
    }
    stats.goals += (sc[0] || 0) + (sc[1] || 0); if (M.solo && r === "win") stats.beaten++;
    const at = now(), msg = { t: "end", id: M.id, r, w, code: c, prize, md: M.md, sc, exp: at + 30 * 60000, why };
    if (c) results.push({ id: M.id, code: c, r, at, prize, used: null, exp: msg.exp, why, md: M.md });
    lastEnd = msg; out(msg);
    if (room && !M.solo){ room.after = 1; out(roomMsg()); }   // the room stays for a rematch
  }

  function recv(m){
    if (!m || typeof m !== "object") return;
    if ((m.t === "hello" || m.t === "create" || m.t === "join") && busyLeft > 0 && !match){ busyLeft--; out({ t: "err", m: "busy" }); return; }
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
        if (c === BOOTH){ boothRoom(m.cat | 0); break; }
        if (c === "FFFF") out({ t: "err", m: "room-full" });
        else if (c === "XXXX") out({ t: "err", m: "started" });
        else if (c.length !== 4 || c === "NNNN" || [...c].some(ch => ABC.indexOf(ch) < 0)) out({ t: "err", m: "no-room" });
        else newRoom(+(Q.get("size") || 1) === 2 ? 2 : 1, m.cat | 0, true, c);
        break; }
      case "seat":
        if (room && !room.k && room.seats[m.team] && room.seats[m.team][m.slot] !== undefined && !(m.team === room.you.team && m.slot === room.you.slot)){
          sit(room.seats[room.you.team][room.you.slot].cat, m.team, m.slot); out(roomMsg()); checkFull(); }
        break;
      case "start": if (room && room.makerMe && !match) go(); break;
      case "rematch":                                            // everyone taps Rematch, then the countdown
        if (!room || match) break; room.rm.me = 1; out(roomMsg());
        setTimeout(() => { if (room && !match){ room.rm.f = 1; out(roomMsg()); go(); } }, 1500);
        break;
      case "leave": if (room && !match){ clearTimeout(room.timer); room = null; } break;
    }
  }

  async function post(path, body){
    await new Promise(r => setTimeout(r, LAG * 2));
    if (path === "/") return { ok: true, v: "fake", closed, solo: Q.get("sololocal") === "1" ? "local" : null, need: need(), goals: stats.goals, beaten: stats.beaten, status: 200 };
    if (path === "/result"){
      const r = body && body.code ? results.find(x => x.code === body.code) : results[results.length - 1];
      return r ? { ok: true, id: r.id, r: r.r, at: r.at, prize: r.prize, used: r.used, code: r.code, exp: r.exp, why: r.why, md: r.md, status: 200 } : { ok: false, e: "not-found", status: 404 };
    }
    return { ok: false, e: "not-found", status: 404 };
  }
  // test hooks (?api=fake only): drop the line for ms, staff redeem, kill switch, a peek at the state
  if (FAKE) window.S3Fake = {
    drop(ms){ refuse = Date.now() + (ms || 0); const s = sock; if (s){ sock = null; s.readyState = 3; gone(); setTimeout(() => s.onclose && s.onclose({}), 0); } },
    redeem(c){ const r = c ? results.find(x => x.code === c) : results[results.length - 1]; if (r) r.used = now(); return !!r; },
    close(on){ closed = on !== false; },
    goal(team, far){ if (!match) return false; const C = S().C, d = far ? 14 : 1.5;   // put the ball in (or, far: 14 out, flying into) a goal mouth
      match.m.b = { x: C.W / 2, y: team === 0 ? d : C.H - d, vx: 0, vy: team === 0 ? -40 : 40 }; return true; },
    state(){ return { room: room && { code: room.code, size: room.size, k: room.k, you: room.you }, match: match && { id: match.id, md: match.md, bot: match.bot, ack: match.ack, st: match.m.st }, results: results.slice(), acked, nIn, lastIn }; }
  };
  return { socket, post };
})();
