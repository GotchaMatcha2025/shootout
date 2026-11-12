/* Gotcha Shootout 3v3 — the phone game. Flow, screen ids and words = mock-up rev 4 (owner yes to rev 3 ~20:52 + "fewest words", API-3V3.md
   §7–§13): ▶ Play → join step → cat → 🤖 VS BOT or 👥 FRIENDS (code / new 1 V 1 · 2 V 2) → room → match → WIN / LOSE. Others are drawn
   ~100 ms behind, your own player is predicted, the ball is drawn ahead (§9.1). The server decides every goal and result; single player runs
   on the phone only when the server can't be reached (plan B, §8). */
"use strict";
const CONFIG = {
  telegram: "https://t.me/gotchamatchasg",                     // owner 12 Nov ~20:50 (DECISIONS)
  instagram: "https://www.instagram.com/gotchamatcha.sg/",
  delayMs: 100,              // others: drawn this far behind the newest snapshot (rides over 4G jitter)
  aheadMaxMs: 150,           // ball: drawn at most this far ahead of its newest snapshot (CTO G1 §9.1)
  inputMs: 50,               // finger: at most 20 messages a second (09:00 release, 20+ people at once; prediction keeps the player on the finger)
  soloConnectMs: 6000,       // single player: no server by then → the match runs on the phone (plan B)
  resultKeepMs: 30 * 60000   // a result shows again on reload while staff can still take it (codes expire after 30 min, §9.6)
};
const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search), DEBUG = Q.has("debug"), C = Sim3.C, COL = Draw.COL, NS = Net.NS, Store = Net.Store;
const SCREENS = ["home", "join", "mode", "multi", "code", "lobby", "match", "result", "rest"];
const SGT = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
const hhmm = ts => SGT ? SGT.format(new Date(ts)) : new Date(ts).toTimeString().slice(0, 5);   // always Singapore time
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not on iPhone */ } };   // haptics where the phone has them
const ERRS = { "no-room": "No game", "room-full": "Full", started: "Started", busy: "Busy", bad: "Try again" };   // one short line (§13)

let screen = "home";
function show(n){ const was = screen; screen = n; if (n === "rest" && was !== "rest"){ restN = 0; setTimeout(restLoop, 0); } SCREENS.forEach(s => { $("#s-" + s).hidden = s !== n; }); $("#stadium").hidden = n === "match"; if (n === "home" && tickerAt) homeTicker(); if (n === "mode") modeState(); if (n === "match") sizePads(); pillCheck(); ticketState(); }
function toast(msg, ms){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms || 2200); }

const G = { cat: 0, joined: !!Store.get("s3v3:joined"), want: null, phase: "idle", solo: false, local: false, everUp: false,
  room: null, M: null, last: null, need: C.CHALLENGE_GOALS || 1, multiRest: false, soloLocal: false, soloTimer: 0, roomTimer: 0, rematch: false,
  prize: Store.get(NS + "prize") };   // the newest prize ticket (adversarial S1): {code, label, exp, used, id}

/* ---------- the socket ---------- */
const sock = Net.Socket({
  open(){
    if (!sock.isLocal()){ G.everUp = true; G.multiRest = false; }
    if (G.solo && G.phase === "asking" && !sock.isLocal()){   // connected: the plan-B timer stops; a server that never answers the hello = resting
      clearTimeout(G.soloTimer); G.soloTimer = setTimeout(() => { if (G.phase === "asking" && G.solo && !G.local){ leaveAll(); show("rest"); } }, 10000);
    }
    if (G.phase === "asking" && G.want) sock.send(G.want);              // a fresh start: hello (solo) / create / join
    else if (G.phase === "room" && G.room){                                // the server holds a room seat 5 s; if it has gone, join again
      const code = G.room.code; clearTimeout(G.roomTimer);
      G.roomTimer = setTimeout(() => { if (G.phase === "room" && G.room && G.room.code === code && !G.room.fresh) sock.send({ t: "join", code, cat: G.cat }); }, 2500);
      G.room.fresh = false;
    }
    if (G.M) G.M.lastSnapT = performance.now();
    // in a match: say nothing. The server finds the seat by dev and re-sends start (§9.2); a hello now would be ignored anyway
  },
  msg: onMsg,
  down(wasUp, fails){
    if (finger.a){ finger.a = 0; finger.id = null; }
    if (L3.restAfterFails(G.phase, G.solo, fails, screen)){ leaveAll(); show("rest"); }   // §9.5: 3 failed connects while asking for a game
  }
});
function send(o){ return sock.send(o); }
function leaveAll(){ Sfx.bedStop(); Crowd.stop(); clearTimeout(G.soloTimer); clearTimeout(G.roomTimer); G.phase = "idle"; G.want = null; G.room = null; G.M = null; G.rematch = false; sock.stop(); }

function onMsg(m){
  if (typeof m.now === "number") Net.clock.hint(m.now);
  switch (m.t){
    case "room": onRoom(m); break;
    case "start": onStart(m); break;
    case "s": onSnap(m); break;
    case "ev": onEv(m); break;
    case "end": onEnd(m); break;
    case "err": onErr(m); break;
  }
}
function onErr(m){
  if (m.m === "closed"){ leaveAll(); show("rest"); return; }   // kill switch (§9.5); also an older tab of this phone (the newest wins)
  if (G.phase === "match") return;
  if (m.m === "busy" && screen !== "result" && (G.phase === "asking" || G.solo)){   // full: "Full · 1 sec", then the same ask again by itself
    const solo = G.solo, want = G.want, again = solo ? () => startSolo() : () => ask(want);
    leaveAll(); show(solo || !want || want.t !== "create" ? "mode" : "multi");   // the code typed in the box stays
    if (busyStart(again)) return;
  }
  // a room that closes (no rematch in 60 s) must never take the prize code off the result screen
  if (screen === "result"){ G.room = null; G.phase = "idle"; G.rematch = false; sock.stop(); return; }
  if (G.solo){ leaveAll(); show("mode"); toast(ERRS[m.m] || ERRS.bad); return; }
  leaveAll(); show("code"); const e = $("#codeErr"); e.textContent = ERRS[m.m] || ERRS.bad; e.hidden = false;   // join errors under the code box
}

/* ---------- full server: a spinner pill, the same ask again after 3 / 6 / 10 s; any tap of the player's own cancels it ---------- */
function busyStart(again){
  const n = G.busy ? G.busy.n : 0, wait = L3.busyWait(n);
  if (G.busy) clearTimeout(G.busy.timer);
  if (wait === null){ G.busy = null; $("#busy").hidden = true; return false; }
  G.busy = { n: n + 1, timer: setTimeout(again, wait) }; $("#busy").hidden = false; return true;
}
function busyStop(){ if (G.busy) clearTimeout(G.busy.timer); G.busy = null; $("#busy").hidden = true; }
document.addEventListener("click", e => { const b = e.target.closest("button, a.btn"); if (G.busy && b && b.id !== "soundBtn" && b.id !== "ticketBtn") busyStop(); }, true);

/* ---------- home, join step, cat, mode ---------- */
$("#goJoin").addEventListener("click", () => { if (G.joined) afterJoinStep(); else show("join"); });
// QR deep link (§14): ?join=K7M4 pre-fills the code; after the join step and the cat it joins at once
G.deep = (() => { try { const c = L3.cleanCode(Q.get("join")); return c.length === 4 ? c : null; } catch (e) { return null; } })();
function afterJoinStep(){ if (L3.deepJoin(G.deep, G.multiRest)){ const c = G.deep; pickThen(() => joinCode(c)); } else show("mode"); }
function joinCode(code){
  if (G.deep === code){ G.deep = null; try { const u = new URL(location.href); u.searchParams.delete("join"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) { /* old browser */ } }
  ask({ t: "join", code, cat: G.cat });
}
// no cat pick any more (owner ~05:45): a choice goes straight on
function pickThen(f){ f(); }
let tickerAt = 0;   // the ticker's counts are asked again when home shows (at most every 30 s)
function homeTicker(){ if (Date.now() - tickerAt < 30000) return; tickerAt = Date.now(); Net.health().then(h => { if (h && h.ok) ticker(h); }); }
[["#tgJoin", CONFIG.telegram], ["#igJoin", CONFIG.instagram], ["#restTg", CONFIG.telegram], ["#restIg", CONFIG.instagram]].forEach(([s, u]) => { $(s).href = u; });
// a page can't check a follow or a channel join: Play works once either link was tapped (owner 12 Nov ~20:20), remembered on this phone
function joinedNow(){ G.joined = true; Store.set("s3v3:joined", 1); $("#tgErr").hidden = true; }
$("#tgJoin").addEventListener("click", joinedNow); $("#igJoin").addEventListener("click", joinedNow);
$("#goPick").addEventListener("click", () => { if (!G.joined){ $("#tgErr").hidden = false; return; } afterJoinStep(); });
function modeState(){
  $("#mSoloSub").textContent = L3.goals(G.need) + " wins";
  $("#mMulti").disabled = G.multiRest; $("#mMultiSub").textContent = G.multiRest ? "😴" : "2–4 players";   // §8: multiplayer resting
  $("#codeIn").disabled = $("#joinGo").disabled = G.multiRest;   // plan B: no joining by code either
  const e = $("#codeErr"); if (G.multiRest){ e.textContent = "😴 Friends resting"; e.hidden = false; } else if (e.textContent === "😴 Friends resting") e.hidden = true;
}
$("#mSolo").addEventListener("click", () => { pickThen(startSolo); });
$("#mMulti").addEventListener("click", () => { $("#codeErr").hidden = true; pickThen(() => show("multi")); });

/* ---------- friends: join by code or start a game (§10, §12) ---------- */
$("#codeIn").addEventListener("input", e => { const v = L3.cleanCode(e.target.value); if (v !== e.target.value) e.target.value = v; $("#codeErr").hidden = true; });
function ask(msg){
  $("#codeErr").hidden = true; G.solo = false; G.local = false; G.want = msg; G.phase = "asking"; G.rematch = false;
  if (sock.isLocal()) sock.stop();
  sock.start(false); if (sock.up()) sock.send(msg);
}
$("#joinForm").addEventListener("submit", e => {
  e.preventDefault(); if (G.multiRest) return; const code = L3.cleanCode($("#codeIn").value);
  if (code.length !== 4){ const er = $("#codeErr"); er.textContent = "Wrong code"; er.hidden = false; return; }
  $("#codeIn").blur(); joinCode(code);   // straight into the room (no cat pick)
});
// FRIENDS (§16): create a game (a room of up to 4; teams by join order) or join one with a code
$("#fCreate").addEventListener("click", () => { ask({ t: "create", cat: G.cat }); });   // §16: no size (a 4-seat room)
$("#fJoin").addEventListener("click", () => { $("#codeErr").hidden = true; show("code"); });
$("#codeBack").addEventListener("click", () => { $("#codeErr").hidden = true; show("multi"); });
$("#multiBack").addEventListener("click", () => { leaveAll(); show("mode"); });

/* ---------- single player: vs the Matcha Bot (§7, §8, §11) ---------- */
function soloHud(){ const A = $("#hudA"), B = $("#hudB"); A.textContent = "YOU"; B.textContent = "MATCHA BOT"; A.className = "tchip m"; B.className = "tchip yz"; $("#hudScore").hidden = true; }
function startSolo(){
  leaveAll(); $("#offBadge").hidden = true; G.solo = true; G.want = { t: "hello", mode: "solo", cat: G.cat }; G.phase = "asking";
  show("match"); soloHud(); banner("🤖 " + L3.goals(G.need) + " wins"); $("#hint").hidden = false;
  if (G.soloLocal){ playLocal(); return; }
  sock.start(false);
  // plan B (§8): 6 s without a connection → L3.planB decides: still connecting with the socket up = wait; 2+ failed connects = play on the
  // phone (and Friends rests: truly offline); otherwise the game is resting
  G.soloTimer = setTimeout(() => {
    if (G.phase !== "asking" || !G.solo || G.local) return;
    const d = L3.planB(sock.up(), sock.fails(), G.soloLocal);
    if (d === "local"){ G.multiRest = true; playLocal(); } else if (d === "rest"){ leaveAll(); show("rest"); }
  }, CONFIG.soloConnectMs);
}
function playLocal(){
  clearTimeout(G.soloTimer); sock.stop(); G.solo = true; G.local = true; G.phase = "asking"; G.want = { t: "hello", mode: "solo", cat: G.cat };
  if (screen !== "match"){ show("match"); soloHud(); }
  $("#offBadge").hidden = false;   // a match on the phone never gives a prize (§12.3)
  sock.start(true);
}

/* ---------- room ---------- */
function onRoom(m){
  busyStop();
  if (G.phase === "match") return;
  if (m.booth && G.phase === "idle") return;   // a booth room is single-use: after its match it is never a rematch room
  G.room = m; G.room.fresh = true; clearTimeout(G.roomTimer);
  if (G.phase === "asking"){ G.phase = "room"; G.want = null; }
  if (screen === "result" && !G.rematch) return;   // after a match the room waits; Rematch takes you back into it
  if (screen !== "lobby") show("lobby");
  renderRoom();
}
const mineSeat = r => { for (let t = 0; t < 2; t++) for (const s of r.seats[t] || []) if (s && s.me) return s; return null; };
// owner ~05:36 (§16): up to 4, teams by join order (Matcha, Yuzu, Matcha, Yuzu); 2 → 1 v 1, 4 → 2 v 2, 3 → 2 v 2 + a Matcha Bot
// in the empty seat (owner answer); the maker's Start lights up from 2 players; no swapping
function renderRoom(){
  const r = G.room; if (!r) return;
  const me = mineSeat(r) || {}, after = !!(r.after || G.rematch), n = typeof r.n === "number" ? r.n : (r.seats[0] || []).concat(r.seats[1] || []).filter(Boolean).length, min = r.min || 2;
  let h = "", missing = 0;
  for (let t = 0; t < 2; t++){
    h += '<div><h4 style="color:' + COL[t].f + '">TEAM ' + COL[t].name + "</h4>";
    (r.seats[t] || []).forEach((s, i) => {
      if (!s){ missing++; h += n === 3 && !r.booth ? '<div class="slot bot" aria-label="Matcha Bot">🤖</div>' : '<div class="slot empty" aria-label="Free seat"></div>'; return; }   // a plain free seat
      const mark = s.off ? "💤" : after && s.rm ? "✓" : "";
      h += '<div class="slot' + (s.me ? " me" : "") + '" id="sl' + t + i + '"><canvas width="60" height="60"></canvas><span class="who">' +
        (s.me ? "YOU" : "") + '</span><span class="mark">' + mark + "</span></div>";
    });
    h += "</div>";
  }
  $("#slots").innerHTML = h;
  for (let t = 0; t < 2; t++) (r.seats[t] || []).forEach((s, i) => { if (!s) return; const cv = document.querySelector("#sl" + t + i + " canvas"); if (cv) cv.getContext("2d").drawImage(Draw.discCanvas(t, 60), 0, 0, 60, 60); });   // a team-colour disc
  r.missing = missing; r.maker = !!me.mk; r.n = n;
  $("#roomKind").textContent = r.booth ? "1 V 1" : n <= 1 ? "1 / 4" : n === 2 ? "1 V 1" : n === 3 ? "2 V 2 · 🤖" : "2 V 2";
  // the game maker's Start: there from the first player, lit from 2 players; everyone else waits for it
  $("#startGo").hidden = !(r.maker && !r.k && !r.booth); $("#startGo").disabled = n < min; $("#startGo").textContent = n < min ? "Need " + (min - n) + " more" : "▶ Start";
  $("#vsBot").hidden = !(r.booth && r.lonely && missing && !r.k);   // alone at the booth game for a minute: one tap to play the bot
  roomTick();
}
$("#startGo").addEventListener("click", () => { $("#startGo").hidden = true; send({ t: "start" }); });
$("#leaveGo").addEventListener("click", () => { send({ t: "leave" }); leaveAll(); show("mode"); });
$("#vsBot").addEventListener("click", () => { send({ t: "leave" }); startSolo(); });   // startSolo leaves the room first
let lastCount = -1;
function roomTick(){
  const r = G.room; if (!r || screen !== "lobby") return;
  let big, hint, foot;
  if (r.k){ const n = Math.max(0, Math.ceil((r.k - Net.now()) / 1000)); big = String(n); hint = ""; foot = ""; if (n !== lastCount && n > 0){ lastCount = n; Sfx.play("tick"); } }
  else { big = r.code; hint = r.booth ? "📺 Booth game" : r.maker ? "Share this code" : "You're in"; foot = r.maker && !r.booth ? "" : r.booth && r.missing ? "" : "Waiting to start…"; lastCount = -1; }
  [["#lCount", big], ["#roomHint", hint], ["#roomFoot", foot]].forEach(([s, v]) => { const el = $(s); if (el.textContent !== v) el.textContent = v; });
}

/* ---------- the match ---------- */
const pitchCv = $("#pitch");
const finger = { x: C.W / 2, y: C.H * 0.8, a: 0, id: null };
let lastSent = null, seq = 0, V = null, shake = 0, freeze = 0, padTop = 54, padBot = 12;
function onStart(m){
  clearTimeout(G.soloTimer); busyStop();
  if (G.M && G.M.id === m.id){ G.M.you = m.you; G.M.lastSnapT = performance.now(); if (screen !== "match") show("match"); return; }   // re-sent after a reconnect: carry on
  const size = m.size || (m.cats && m.cats[0] ? m.cats[0].length : 3);
  G.M = { id: m.id, you: m.you, md: m.md ? 1 : 0, need: m.need || (m.md ? G.need : 1), secs: m.secs || C.MATCH_S, at: m.at, size, cats: m.cats || [[], []], bots: m.bots || [[], []],
    snaps: [], newest: null, sc: [0, 0], cdShown: -1, own: { x: 0, y: 0, vx: 0, vy: 0, on: false, ex: 0, ey: 0, hist: [] },
    ball: { dx: null, dy: null, ox: 0, oy: 0, snap: null, mode: null }, trail: [], lastSnapT: performance.now(), hud: "",
    win: [], base: null, delay: CONFIG.delayMs };   // lag: the snapshot clock (base) and the adaptive draw delay for others
  if (m.need && m.md) G.need = m.need;   // the VS BOT card's number; a multiplayer start (first to 3) never changes it
  G.M.sub = L3.subLine(G.M.md, G.M.need);
  G.phase = "match"; G.want = null; G.rematch = false; finger.a = 0; finger.id = null; lastSent = null;
  Store.set(NS + "pend", { id: m.id, at: Date.now() });
  Crowd.stop(); Fx.clear(); show("match"); banner("3", G.M.sub); $("#hint").hidden = false; hudSet(true);
}
function onSnap(m){
  const M = G.M; if (!M || !Array.isArray(m.p) || !Array.isArray(m.b)) return;
  const t = performance.now(), prev = M.snaps.length ? M.snaps[M.snaps.length - 1].ts : null;
  Lag.snap(t);
  m.arr = t;
  if (typeof m.n === "number"){   // time a snapshot by its step counter: a burst after a stalled line keeps its true spacing
    const w = L3.lagWindow(M.win, t, m.n);
    M.base = M.base === null ? w.base : M.base + (w.base - M.base) * 0.1;   // the baseline moves smoothly, never in a jump
    M.delay += (w.delay - M.delay) * 0.05;
    for (const q of M.snaps) q.ts = q.n * L3.STEP_MS + M.base; m.ts = m.n * L3.STEP_MS + M.base;
  } else m.ts = L3.stamp(prev, t);   // an old server without n: by arrival
  m.ideal = m.ts;   // when it would have landed on the line's best day: the age used for the ball and our own player
  M.snaps.push(m); M.newest = m; M.lastSnapT = t;
  while (M.snaps.length > 2 && M.snaps[0].ts < t - 1500) M.snaps.shift();
  if (Array.isArray(m.sc)) M.sc = m.sc; if (m.md !== undefined) M.md = m.md ? 1 : 0;
  // own player: compare the server's position with where we predicted it one (best) round trip before that snapshot was made
  const own = M.own;
  if (m.st === C.ST_PLAY && own.on){
    const sp = m.p[myIdx(M, m)], h = L3.histAt(own.hist, m.ideal - Net.clock.rttMin() - 16);
    if (sp && h){ const ex = sp[0] - h.x, ey = sp[1] - h.y;
      if (Math.hypot(ex, ey) > 25){ own.x = sp[0]; own.y = sp[1]; own.ex = own.ey = 0; own.hist = []; } else { own.ex = ex; own.ey = ey; } }   // > 25 = a teleport (kick-off)
  }
}
const myIdx = (M, s) => M.you.team * (s.p.length / 2) + M.you.slot;
function onEv(m){
  const M = G.M; if (!M) return; const me = M.you.team;
  switch (m.k){
    case "go": banner("GO!", "", 700); Sfx.play("whistle"); Sfx.bed(0.8); if (Crowd.mode === null) Crowd.start(); else Crowd.run(); break;   // murmur + the Viking row (from the top) while the ball is live
    case "kickoff": banner(""); M.cdShown = -1; break;                     // a challenge goes on after the bot's goal
    case "grow": banner("↔ BIGGER GOALS", "", 1400); break;
    case "goal": {
      if (Array.isArray(m.sc)) M.sc = m.sc; else M.sc[m.w] = (M.sc[m.w] || 0) + 1;
      const mine = m.w === me;
      const botGoal = M.md && !mine;
      if (mine && M.newest) M.goalTl = M.newest.tl;   // for the personal best
      // multiplayer: the score under GOAL! (Matcha – Yuzu, like the HUD); then the lights for every goal
      banner(botGoal ? "🤖 GOAL!" : "GOAL!", M.md ? "" : L3.scoreText(M.sc, 0, 1), botGoal ? 1400 : 0); hudSet(true);
      lights(m.w, !botGoal, botGoal ? 1 - me : -1);
      Crowd.pause(); Sfx.play("whistle"); Sfx.play("horn"); Sfx.play("net"); Crowd.wooo(); Sfx.bed(1.6); setTimeout(() => Sfx.bed(0.8), 2500);   // every goal: "Wooo!" + roar; the row starts again at the kick-off
      if (mine) Sfx.play("fanfare");
      buzz(botGoal ? [40, 30, 40] : [60, 40, 90]); break; }
    case "draw": case "timeup": banner(m.k === "timeup" || M.md ? "TIME UP" : "DRAW"); Sfx.play("whistle"); Sfx.bedStop(); Crowd.stop(); break;   // timeup = vs the bot, time ran out
    case "hit": { const mine = m.team === me && m.slot === M.you.slot; if (mine || m.p > 0.5) Sfx.play("kick", m.p); if (mine) buzz(Math.round(8 + 22 * (m.p || 0)));
      if (m.p > 0.7 && !Draw.REDUCED) freeze = Math.max(freeze, 0.06); break; }   // hit-stop on a big hit
    case "wall": Sfx.play("wall"); break;
    case "post": {   // a fast ball off the post = a near miss: "ooh", 😱, the crowd jumps, a beat of hit-stop (the server keeps playing)
      Sfx.play("clang"); const b = M.newest && M.newest.b;
      // the sim's own near flag when it sends one, else a fast ball off the post
      if (b && M.newest.st === C.ST_PLAY && (m.near !== undefined ? !!m.near : Math.hypot(b[2], b[3]) > 22)){ Crowd.oooh(); banner("😱", "", 700); Draw.st.hype = 1.2; Draw.st.hypeTeam = -1; if (!Draw.REDUCED) freeze = Math.max(freeze, 0.1); }
      break; }
  }
}
// every goal (rev 8, owner ~21:48): the net ripples, the crowd jumps with a phone-flash storm, one white flash then two sweeping beams;
// a goal by people adds hit-stop, a shake and confetti. The slow motion is the server's own (the sim's quarter-speed celebration).
// Reduced motion: none of the movement (a still crowd, no flash, beams, shake, hit-stop or confetti).
function lights(w, people, hypeTeam){
  Draw.st.rip = { j: w === 0 ? 0 : 1, a: 1, t: 0 };   // Matcha scores in the top net (y 0), Yuzu in the bottom one
  Draw.st.hype = people ? 3.2 : 2.4; Draw.st.hypeTeam = hypeTeam; Draw.st.storm = 1.2;
  if (Draw.REDUCED) return;
  Fx.goalFlash(); if (people){ freeze = 0.12; shake = 8; Fx.confetti([COL[w].f, "#fffbe6", "#ffd23f"]); }
}
let bannerT = 0;
function banner(txt, sub, ms){
  const b = $("#banner"); b.innerHTML = ""; if (txt){ b.textContent = txt; if (sub){ const s = document.createElement("small"); s.textContent = sub; b.appendChild(s); } }
  b.style.opacity = txt ? 1 : 0; clearTimeout(bannerT); if (ms) bannerT = setTimeout(() => { b.style.opacity = 0; }, ms);
}
function hudSet(force){
  const M = G.M; if (!M) return; const me = M.you.team, S = $("#hudScore");
  if (M.md){ if (force){ soloHud(); S.hidden = true; } return; }
  // multiplayer: MATCHA [2 – 1] YUZU, your team's chip outlined (owner ~22:54: first to 3, the score big)
  const sc = L3.scoreText(M.sc, 0, 1), key = sc + "|" + me; if (!force && key === M.hud) return; M.hud = key;
  const A = $("#hudA"), B = $("#hudB"); A.textContent = "MATCHA"; B.textContent = "YUZU";
  A.className = "tchip m" + (me === 0 ? " me" : ""); B.className = "tchip yz" + (me === 1 ? " me" : ""); S.textContent = sc; S.hidden = false;
}
function sizePads(){
  const hud = document.querySelector(".hud").getBoundingClientRect(), app = $("#app").getBoundingClientRect(), rib = $("#ribbon");
  padTop = Math.max(54, hud.bottom - app.top + 8); padBot = 12 + (rib.hidden ? 0 : rib.offsetHeight) + safeBottom();
}
function safeBottom(){ const p = document.createElement("div"); p.style.cssText = "position:absolute;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)"; document.body.appendChild(p); const v = parseFloat(getComputedStyle(p).paddingBottom) || 0; p.remove(); return v; }
window.addEventListener("resize", () => setTimeout(sizePads, 50)); window.addEventListener("orientationchange", () => setTimeout(sizePads, 300));

// your finger is your player: no offset, first finger only
function fingerAt(e){ if (!V) return; const r = pitchCv.getBoundingClientRect(), w = V.toWorld(e.clientX - r.left, e.clientY - r.top); finger.x = w.x; finger.y = w.y; }
pitchCv.addEventListener("pointerdown", e => { if (finger.id !== null && finger.id !== e.pointerId) return; e.preventDefault(); finger.id = e.pointerId;
  try { pitchCv.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } finger.a = 1; fingerAt(e); $("#hint").hidden = true; });
pitchCv.addEventListener("pointermove", e => { if (e.pointerId === finger.id) fingerAt(e); });
["pointerup", "pointercancel", "lostpointercapture"].forEach(n => pitchCv.addEventListener(n, e => { if (e.pointerId === finger.id){ finger.a = 0; finger.id = null; } }));
pitchCv.addEventListener("touchmove", e => e.preventDefault(), { passive: false });   // no scroll, pull-to-refresh or pinch on the pitch
document.addEventListener("gesturestart", e => e.preventDefault());
function sendInput(force){
  if (G.phase !== "match" || !G.M || !sock.up()) return;
  const t = performance.now(), cur = { x: Math.round(finger.x * 100) / 100, y: Math.round(finger.y * 100) / 100, a: finger.a };
  if (!force && !L3.shouldSend(lastSent, cur, t, CONFIG.inputMs)) return;
  if (sock.send({ t: "in", s: ++seq, x: cur.x, y: cur.y, a: cur.a })){ cur.t = t; lastSent = cur; }
}

function ballTarget(M, N, I, now){
  // the ball is drawn where it will be when our finger reaches the server: newest snapshot + one round trip + its age, at most 150 ms;
  // in the goal / time-up stop the same, at the sim's quarter speed (code review M4: switching to the 100 ms-behind view snapped it back)
  const ahead = L3.ballAhead(N.st, Math.min(CONFIG.aheadMaxMs, Math.max(0, now - (N.ideal || N.arr) + Net.clock.rttMin())) / 1000);   // jitter-free age
  if (ahead === null) return { x: I.b[0], y: I.b[1] };
  const b = { x: N.b[0], y: N.b[1], vx: N.b[2], vy: N.b[3] };
  if (typeof Sim3.stepBall === "function"){ if (ahead > 0) Sim3.stepBall(b, ahead, N.gw); }   // the server's own walls, posts and drag
  else { b.x = Math.max(C.RB, Math.min(C.W - C.RB, b.x + b.vx * ahead)); b.y = b.y + b.vy * ahead; }
  return b;
}
function drawMatch(dt, now){
  const M = G.M;
  V = Draw.view(pitchCv, !!(M && M.you.team === 1), padTop, padBot, true);   // the view leaves room for the stands
  Draw.st.hype = Math.max(0, Draw.st.hype - dt); Draw.st.storm = Math.max(0, Draw.st.storm - dt);
  if (!M || !M.newest){ Draw.render(pitchCv, { gw: C.GW0, ball: null, players: [], crowd: true }, V, T, null, dt, 0); return; }
  if (freeze > 0 && !Draw.REDUCED){ freeze -= dt; return; }   // hit-stop: the picture holds for a beat on a big hit or a goal
  const N = M.newest, n = N.p.length, size = n / 2, me = myIdx(M, N), I = L3.interp(M.snaps, now - M.delay), own = M.own;   // others: adaptive delay
  if (N.st === C.ST_PLAY){   // own player: predicted with the server's own follow rule, so it moves under the finger at once
    if (!own.on){ const p = N.p[me]; Object.assign(own, { x: p[0], y: p[1], vx: 0, vy: 0, ex: 0, ey: 0, hist: [], on: true }); }
    const fx0 = own.fx, fy0 = own.fy; own.fx = finger.x; own.fy = finger.y;
    const moving = finger.a && fx0 !== undefined && Math.hypot(finger.x - fx0, finger.y - fy0) > 0.02;
    Sim3.followTarget(own, finger, dt);
    // the prediction leads: a moving finger is never pulled back under 8 units; see L3.ownRate
    const rate = L3.ownRate(Math.hypot(own.ex, own.ey), moving), k = rate ? 1 - Math.exp(-dt * rate) : 0, cx = own.ex * k, cy = own.ey * k;
    own.x += cx; own.y += cy; own.ex -= cx; own.ey -= cy;
    own.hist.forEach(h => { h.x += cx; h.y += cy; }); own.hist.push({ t: now, x: own.x, y: own.y });
    while (own.hist.length && own.hist[0].t < now - 1000) own.hist.shift();
  } else own.on = false;
  // ball: a new snapshot moves the target; the jump is eased away over ~80 ms instead of drawn
  const bt = ballTarget(M, N, I, now), B = M.ball, mode = N.st === C.ST_PLAY;
  // only a kick-off (countdown / reset: everyone back on their spot) jumps; every other change is eased
  if (B.snap !== N || B.mode !== mode){ if (B.dx !== null){ B.ox = B.dx - bt.x; B.oy = B.dy - bt.y; if (N.st === C.ST_COUNT || N.st === 5 || Math.hypot(B.ox, B.oy) > 30) B.ox = B.oy = 0; } B.snap = N; B.mode = mode; }
  const kk = Math.exp(-dt / 0.027); B.ox *= kk; B.oy *= kk; B.dx = bt.x + B.ox; B.dy = bt.y + B.oy;
  if (!Draw.st.lite){ M.trail.push([B.dx, B.dy]); if (M.trail.length > 12) M.trail.shift(); }
  const players = [];
  for (let i = 0; i < n; i++){
    const team = i < size ? 0 : 1, slot = i % size, mine = i === me, p = mine && own.on ? [own.x, own.y] : I.p[i];
    const cat = (M.cats[team] || [])[slot], bot = (M.bots[team] || [])[slot];
    players.push({ x: p[0], y: p[1], team, me: mine, cat: cat >= 0 ? cat : (i % 4), label: !mine && L3.isBot(N.bt, i, bot) ? "BOT" : "" });
  }
  if (Draw.st.rip){ Draw.st.rip.t += dt; Draw.st.rip.a = Math.max(0, Draw.st.rip.a - dt * 0.8); if (!Draw.st.rip.a) Draw.st.rip = null; }
  const fast = mode && Math.hypot(N.b[2], N.b[3]) > 8;
  Draw.render(pitchCv, { gw: I.gw, ball: { x: B.dx, y: B.dy, fast }, trail: Draw.st.lite ? null : M.trail, players, crowd: true }, V, T, null, dt, shake); shake *= 0.9;
  if (G.rec && G.rec.length < 4000) G.rec.push({ t: now, st: N.st, own: players[me] ? [players[me].x, players[me].y] : null, fin: [finger.x, finger.y, finger.a], ball: [B.dx, B.dy],
    others: players.filter((q, i) => i !== me).map(q => [q.x, q.y]), err: Math.hypot(own.ex || 0, own.ey || 0) });   // tests only (G.rec = [])
  const clk = L3.clockText(typeof N.tl === "number" ? N.tl : M.secs * 1000); const ce = $("#clock"); if (ce.textContent !== clk) ce.textContent = clk;   // counts down from the server's secs (2:00)
  if (N.st === C.ST_COUNT){   // 3 · 2 · 1 from the server's countdown
    const cd = typeof N.cd === "number" ? N.cd - (now - N.arr) : (M.at + C.COUNT_S * 1000 - Net.now()), c = Math.ceil(cd / 1000);
    if (c !== M.cdShown && c > 0){ M.cdShown = c; banner(String(c), M.sub); Sfx.play("beep", 4 - Math.min(3, c)); }   // rising beeps
  }
  hudSet(false);
  if (sock.up() && now - M.lastSnapT > 12000) lostMatch();   // the server forgot the match (it never goes silent this long)
}
async function lostMatch(){
  const M = G.M; if (!M) return; G.M = null; G.phase = "idle";
  const r = await Net.post("/result", { dev: Net.dev });
  if (L3.sameMatch(r, M.id)){ onEnd({ id: M.id, r: r.r, code: r.code, prize: r.prize, used: r.used, exp: r.exp, why: r.why, md: M.md, sc: M.sc, team: M.you.team, now: r.now, prizes: r.prizes }); return; }   // now: the countdown on server time
  leaveAll(); show("mode"); toast("Match lost");
}

/* ---------- result: WIN / LOSE, the score, and only when there is a prize: its name, the code, "Redeem at the counter" (§13) ---------- */
function onEnd(m){
  send({ t: "got", id: m.id });                                   // §9.2: the server stops re-sending this result
  if (G.last && G.last.id === m.id && screen === "result") return;
  const M = G.M, team = M ? M.you.team : (typeof m.team === "number" ? m.team : 0);
  const res = { id: m.id, r: m.r, w: m.w, code: m.code || null, prize: L3.normPrize(m.prize), off: typeof m.now === "number" ? m.now - Date.now() : Net.clock.offset, md: m.md !== undefined ? (m.md ? 1 : 0) : (M ? M.md : 0),
    sc: Array.isArray(m.sc) ? m.sc : M ? M.sc : null, team, at: Date.now(), used: m.used || null, solo: G.solo, exp: m.exp || null, why: m.why || null,
    booth: !!(G.room && G.room.booth),   // a booth room is single-use: the server opens a new one at kick-off
    secs: M && M.md && typeof M.goalTl === "number" ? Math.round(((M.secs || C.MATCH_S) * 1000 - M.goalTl) / 100) / 10 : null };   // personal best: single player only   // seconds to the winning goal
  G.last = res; Store.set(NS + "last", res); Store.del(NS + "pend"); res.fresh = true;
  if (Array.isArray(m.prizes)) G.prizeList = L3.prizeList(m.prizes);
  const kept = L3.keepPrize(G.prize, res); if (kept !== G.prize){ G.prize = kept; Store.set(NS + "prize", G.prize); }   // a later no-prize result never replaces it
  G.M = null; clearTimeout(G.soloTimer);
  if (res.booth) G.room = null;
  if (G.solo || res.booth){ G.phase = "idle"; setTimeout(() => { if (G.phase === "idle") sock.stop(); }, 1200); } else G.phase = G.room ? "room" : "idle";
  Sfx.bedStop(); Crowd.stop(); Fx.clear(); showResult(res);
  if (res.r === "win"){ Crowd.hurrah(); Sfx.play("fanfare"); Sfx.play("coin"); Fx.fireworks(6); Fx.confetti(["#6fbf4a", "#ffd23f", "#fffbe6"], 0); buzz([60, 40, 120]); }   // fireworks: not with reduced motion / lite
  else if (res.r === "lose") Sfx.play("sad"); else Sfx.play("whistle");
}
function showResult(res){
  const ch = res.md === 1, win = res.r === "win", me = res.team, sc = res.sc || [0, 0]; if (!win) Fx.clear();
  $("#rTitle").textContent = win ? "WIN!" : res.r === "draw" ? "DRAW" : "LOSE";
  $("#trophy").hidden = !win;   // the trophy for a win; no cat on a loss (owner ~05:45)
  // personal best on this phone: the fastest winning goal ("⚡ 12.4s · 🏅 BEST")
  const pb = $("#pb"); pb.hidden = !(win && res.md === 1 && res.secs > 0);
  if (!pb.hidden){ const best = Store.get(NS + "best"), isBest = !(best > 0) || res.secs < best; if (isBest && !res.shown) Store.set(NS + "best", res.secs);
    pb.textContent = "⚡ " + res.secs.toFixed(1) + "s" + (isBest || res.best ? " · 🏅 BEST" : ""); if (isBest) res.best = 1; res.shown = 1; }
  $("#rEyebrow").textContent = ch ? "🤖 " + (sc[1 - me] || 0) + " – " + (sc[me] || 0) + " YOU" : (sc[me] || 0) + " – " + (sc[1 - me] || 0);
  prizeCard(res);
  const why = L3.whyLine(res); $("#noPrize").textContent = why; $("#noPrize").hidden = !why;
  $("#again").textContent = res.solo || res.booth ? "↻ Again" : "↻ Rematch"; $("#again").disabled = false; G.rematch = false;
  show("result");
}
// the card shows only when there is something to redeem: a prize name from the server and a code; a lost single-player game never has one
const hasPrize = L3.hasPrize;
// the voucher card (assets/voucher.js; owner ~05:56 "build all", API §15): a reveal the first time, a live countdown on the server's clock,
// HOLD AT COUNTER → POST /use, USED / EXPIRED stamps. The 🎟 sheet shows the same card.
const vOf = p => ({ code: p.code, title: (p.prize && p.prize.t) || p.label || (p.prize && p.prize.label) || "", sub: (p.prize && p.prize.s) || p.sub || "",
  exp: p.exp || (p.at + 15 * 60000), used: p.used || null, off: typeof p.off === "number" ? p.off : null, roll: G.prizeList && G.prizeList.length ? G.prizeList : null });
const offOf = r => r && typeof r.now === "number" ? r.now - Date.now() : null;   // server clock − phone clock from a reply
async function useVoucher(v){
  const r = await Net.post("/use", { dev: Net.dev, code: v.code }, 6000);   // the server marks it used (§15); no answer in 6 s = no signal
  const off = offOf(r); if (off !== null) v.off = off;
  const used = r && r.ok ? r.used : r && r.e === "already" ? r.used : null;
  if (used){ [G.last, G.prize].forEach(x => { if (x && x.code === v.code){ x.used = used; if (off !== null) x.off = off; } }); if (G.last) Store.set(NS + "last", G.last); if (G.prize) Store.set(NS + "prize", G.prize); }
  return r;
}
function prizeCard(res, opt){
  const has = hasPrize(res);
  $("#prize").hidden = !has; if (!has) return;
  Voucher.render($("#prize"), vOf(res), Object.assign({ reveal: !!res.fresh, onUse: useVoucher }, opt || {})); res.fresh = false;
}
/* the ticket: 🎟 on every screen but the pitch while the newest prize is unused and not expired; it opens the same card */
function ticketState(){
  const live = L3.prizeLive(G.prize, Date.now()), sheet = $("#ticket");
  const on = live && screen !== "match" && sheet.hidden && !(screen === "result" && G.last && G.last.code === G.prize.code);
  if ($("#ticketBtn").hidden === on) $("#ticketBtn").hidden = !on;
  if (!sheet.hidden && !G.prize) sheet.hidden = true;
}
$("#ticketBtn").addEventListener("click", () => { $("#ticket").hidden = false; Voucher.render($("#tCard"), vOf(G.prize), { onUse: useVoucher }); ticketState(); recheckPrize(); });
$("#ticketClose").addEventListener("click", () => { $("#ticket").hidden = true; ticketState(); });
// staff redeem on their page: when this page comes back (or loads), it asks the server about the ticket, so it shows "✓ Used"
async function recheckPrize(){
  const p = G.prize; if (!p || !p.code || p.used) return;
  const r = await Net.post("/result", { dev: Net.dev, code: p.code });
  if (!r || !r.ok || G.prize !== p) return;
  if (r.used) p.used = r.used; if (r.exp) p.exp = r.exp; const off = offOf(r); if (off !== null) p.off = off; Store.set(NS + "prize", p);
  if (G.last && G.last.code === p.code){ G.last.used = p.used; G.last.exp = p.exp; Store.set(NS + "last", G.last); if (screen === "result") prizeCard(G.last); }
  const tc = $("#tCard");   // the open 🎟 sheet shows the answer (a staff redeem → USED); never mid-hold or mid-"Checking…"
  if (!$("#ticket").hidden && !tc.dataset.busy && !tc.querySelector(".vhold.down")) Voucher.render(tc, vOf(p), { onUse: useVoucher });
  ticketState();
}
// the result on screen: asked again when the page comes back (prize, use); the ticket has its own check
async function recheck(){
  const res = G.last; if (!res || !res.code || res.used){ recheckPrize(); return; }
  const r = await Net.post("/result", { dev: Net.dev, code: res.code });
  if (r && r.ok && G.last === res){
    if (r.used) res.used = r.used; if (r.prize !== undefined) res.prize = L3.normPrize(r.prize); if (r.exp) res.exp = r.exp; const off = offOf(r); if (off !== null) res.off = off;
    Store.set(NS + "last", res);
    const kept = L3.keepPrize(G.prize, res); if (kept !== G.prize){ G.prize = kept; Store.set(NS + "prize", kept); }
    if (screen === "result") prizeCard(res);
  }
  recheckPrize();
}
$("#again").addEventListener("click", () => {
  if (G.last && G.last.solo){ startSolo(); return; }
  if (!G.room){ leaveAll(); show("mode"); return; }               // a booth game, or the room closed meanwhile: back to the choice
  G.rematch = true; $("#again").disabled = true; send({ t: "rematch" }); show("lobby"); renderRoom();
});
$("#back").addEventListener("click", () => { if (G.room) send({ t: "leave" }); leaveAll(); show("mode"); });
async function restCheck(){ const h = await Net.health(); if (screen !== "rest") return; if (h && h.ok && !h.closed){ applyHealth(h); show(G.joined ? "mode" : "home"); return true; } return false; }
$("#restRetry").addEventListener("click", () => { restCheck(); });
let restN = 0, restT = 0;   // resting: ask the server again after 3, 6, 10 s, then every 10 s; back to the choice screen (code kept) when it is open
function restLoop(){ clearTimeout(restT); if (screen !== "rest") return; restT = setTimeout(async () => { if (screen !== "rest") return; restN++; if (!(await restCheck())) restLoop(); }, L3.busyWait(restN) || 10000); }

/* ---------- sound, reconnect pill, debug, lite ---------- */
function soundBtn(){ const b = $("#soundBtn"); b.textContent = Sfx.on ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(Sfx.on)); b.setAttribute("aria-label", Sfx.on ? "Sound on" : "Sound off"); }
Sfx.init(); soundBtn();
$("#soundBtn").addEventListener("click", () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); soundBtn(); Sfx.play("tap");
  if (!Sfx.on) Crowd.halt(); else if (G.M && G.M.newest && G.M.newest.st === C.ST_PLAY) Crowd.run(); });   // mute stops the crowd too
// every other button and link-button clicks (sound + a tiny buzz on phones that have one)
document.addEventListener("click", e => { const b = e.target.closest("button, a.btn"); if (b && b.id !== "soundBtn" && !b.disabled){ Sfx.play("tap"); buzz(8); } }, true);
// the browser lets sound start only inside a tap; iOS counts touchend / click, Android pointerdown
["pointerdown", "touchend", "click"].forEach(n => document.addEventListener(n, () => Sfx.unlock(), { capture: true, passive: true }));
let downSince = 0;
function pillCheck(){
  const need = (G.phase === "asking" || G.phase === "room" || G.phase === "match") && sock.wanted() && !sock.up() && !sock.isLocal();
  const t = performance.now(); if (!need) downSince = 0; else if (!downSince) downSince = t;
  const p = $("#pill"), on = need && t - downSince > 600;
  if (on){ const txt = G.everUp ? "Reconnecting…" : "Connecting…"; if (p.textContent !== txt) p.textContent = txt; }
  if (p.hidden === on) p.hidden = !on;
}
const ribbon = { staging: "TEST SERVER", local: "LOCAL SERVER", fake: "OFFLINE DEMO · nothing is saved" }[Net.mode];
if (ribbon){ $("#ribbon").textContent = ribbon; $("#ribbon").hidden = false; document.body.classList.add("ribbon-on"); }
if (Q.has("lite") || (navigator.hardwareConcurrency || 8) <= 2){ Draw.st.lite = true; document.body.classList.add("lite"); }
let perfN = 0, perfSum = 0;
function perfWatch(dt){   // slow phone: under ~36 fps for 2 s of a match → lite drawing (no trail, no floodlight pools)
  if (Draw.st.lite || screen !== "match" || !(dt > 0)) return; perfN++; perfSum += dt;
  if (perfN >= 120){ if (perfSum / perfN > 0.028){ Draw.st.lite = true; document.body.classList.add("lite"); Crowd.slow(); if (DEBUG) toast("Lite mode"); } perfN = 0; perfSum = 0; }
}
// lag readout for the owner's phone (?debug): round trip, frames a second, gaps between snapshots, how far behind others are drawn
const Lag = { fps: 0, n: 0, t0: 0, gapLast: 0, gapMax: 0, gaps: [], lastArr: 0,
  frame(now){ this.n++; if (!this.t0) this.t0 = now; if (now - this.t0 >= 1000){ this.fps = Math.round(this.n * 1000 / (now - this.t0)); this.n = 0; this.t0 = now; } },
  snap(t){ if (this.lastArr){ const g = t - this.lastArr; this.gapLast = g; this.gaps.push([t, g]); } this.lastArr = t;
    while (this.gaps.length && this.gaps[0][0] < t - 2000) this.gaps.shift(); this.gapMax = this.gaps.reduce((a, x) => Math.max(a, x[1]), 0); } };
function dbg(){
  if (!DEBUG) return; const d = $("#dbg"); d.hidden = false; const M = G.M;
  d.textContent = "RTT " + Math.round(Net.clock.rtt) + " ms · " + Lag.fps + " fps\ngap " + Math.round(Lag.gapLast) + " / max " + Math.round(Lag.gapMax) + " ms" +
    (M ? "\ndelay " + Math.round(M.delay || CONFIG.delayMs) + " ms · err " + (Math.hypot(M.own.ex || 0, M.own.ey || 0)).toFixed(1) : "") +
    "\n" + Net.mode + (sock.isLocal() ? " · LOCAL" : "") + (Draw.st.lite ? " · lite" : "");
}

/* ---------- the stadium behind the screens: a camera flash pops now and then (≤ 2 on screen at once; never with reduced motion / lite) ---------- */
setInterval(() => {
  const st = $("#stadium"); if (Draw.REDUCED || Draw.st.lite || st.hidden || document.hidden) return;
  const f = document.createElement("i"); f.className = "flash"; f.style.left = (4 + Math.random() * 92) + "%"; f.style.top = (3 + Math.random() * 24) + "%";
  st.appendChild(f); setTimeout(() => f.remove(), 550);
}, 380);
// the LED ticker under PLAY: real counts from the server only (a figure it doesn't send is left out; none at all = no ticker)
function ticker(h){
  const parts = [];
  if (h && Number.isInteger(h.goals)) parts.push("⚽ " + h.goals + " GOALS TODAY");
  if (h && Number.isInteger(h.beaten)) parts.push("🤖 BOT BEATEN " + h.beaten + "×");
  $("#ticker").hidden = !parts.length; if (!parts.length) return;
  parts.push("📍 OCBC ARENA 13–15 NOV"); const one = parts.join(" \u00a0·\u00a0 ") + " \u00a0·\u00a0 ";
  $("#tickerTxt").textContent = one + one + one + one;   // the scroll moves half its width, so the text repeats
}

/* ---------- home background: the bots-only demo on the tilted pitch (hidden with reduced motion), as in the mock-up ---------- */
const bgCv = $("#bgpitch"); let demo = null;
function drawDemo(dt){
  if (Draw.REDUCED) return;
  if (!demo || demo.st === C.ST_END) demo = Sim3.createMatch({ seed: Math.floor(Math.random() * 1e9), humans: [], cats: [[0, 1, 2], [3, 0, 1]], size: 2 });
  Sim3.step(demo, dt);
  const v = Draw.view(bgCv, false, 10, 34);
  Draw.render(bgCv, { gw: demo.gw, ball: demo.b, trail: null, players: demo.p.map(q => ({ x: q.x, y: q.y, team: q.team, cat: q.cat, label: "" })) }, v, T, null, dt, 0);
}

/* ---------- the loop: paused while the page is hidden ---------- */
let rafId = 0, lastT = 0, T = 0, tick = 0;
function frame(now){
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now; T += dt;
  if (screen === "home") drawDemo(dt);
  else if (screen === "match") drawMatch(dt, now);
  else if (screen === "lobby") roomTick();
  if ((tick = (tick + 1) % 30) === 0) ticketState();   // expiry, about twice a second
  Fx.frame(dt); Lag.frame(now); perfWatch(dt); sendInput(false); pillCheck(); dbg();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ if (finger.a){ finger.a = 0; finger.id = null; sendInput(true); } cancelAnimationFrame(rafId); rafId = 0; Sfx.bedStop(); Crowd.halt(); return; }
  if (G.M && G.M.newest && G.M.newest.st === C.ST_PLAY && Crowd.mode){ Sfx.bed(0.8); Crowd.run(); }   // back on the page mid-match: the crowd again
  lastT = performance.now(); if (!rafId) rafId = requestAnimationFrame(frame);
  sock.nudge(); recheck();
});
window.addEventListener("pageshow", e => { if (e.persisted){ sock.nudge(); recheck(); } });

/* ---------- start ---------- */
function applyHealth(h){
  if (!h || !h.ok) return;
  if (Array.isArray(h.prizes)) G.prizeList = L3.prizeList(h.prizes);   // the names the reveal rolls through (only what the server sends)
  ticker(h);
  if (typeof h.need === "number" && h.need > 0) G.need = h.need;
  G.soloLocal = h.solo === "local"; if (G.soloLocal) G.multiRest = true;   // §8: the server asks phones to play single player on the phone
  if (h.closed){ leaveAll(); show("rest"); } else if (screen === "mode") modeState();
}
function mockState(){   // ?api=fake&mock=reveal|ready|holding|used|expired|ticket|nosignal|already: the voucher states for tests and demos
  const m = Net.mode === "fake" && Q.get("mock"); if (!m) return false;
  const n = Math.max(1, Math.min(4, +(Q.get("prize") || 4))), P = Voucher.PRIZES[n - 1], now = Date.now();
  const res = { id: "mock", r: "win", w: 0, md: 1, sc: [1, 0], team: 0, at: now - 1000, solo: true, code: "K7M2QX", secs: 12.4, best: 1, shown: 1,
    prize: { t: P.t, s: P.s, label: P.t + " · " + P.s }, exp: now + 15 * 60000 - 1000, used: m === "used" ? now - 3 * 60000 : null, off: 0 };
  G.prizeList = Voucher.PRIZES.map(x => ({ t: x.t, s: x.s }));
  if (m === "expired"){ res.exp = now - 60000; res.at = now - 16 * 60000; }
  G.last = res; G.prize = { code: res.code, label: P.t, sub: P.s, exp: res.exp, used: res.used, off: 0 };
  showResult(res);
  if (m === "reveal") prizeCard(res, { reveal: 0.35 });
  if (m === "holding") prizeCard(res, { hold: 0.5 });
  if (m === "nosignal" || m === "already") window.__mockUse = m;   // the fake server answers the hold this way (?mock=nosignal / already)
  if (m === "ticket"){ show("mode"); $("#ticketBtn").click(); }
  return true;
}
(async function init(){
  if (mockState()) return;
  sizePads(); lastT = performance.now(); rafId = requestAnimationFrame(frame);
  const last = Store.get(NS + "last"), pend = Store.get(NS + "pend");
  // a reload shows the last result again only while there is a prize to redeem (staff take codes for 30 min)
  if (G.deep) $("#codeIn").value = G.deep;
  if (!G.deep && hasPrize(last) && Date.now() - last.at < CONFIG.resultKeepMs){ G.last = last; showResult(last); }
  else show("home");
  if (!G.prize && hasPrize(last)){ G.prize = L3.keepPrize(null, last); Store.set(NS + "prize", G.prize); }   // a result saved before the ticket key
  recheck();   // shows "✓ Used" if staff already took the ticket
  const h = await Net.health(); tickerAt = Date.now(); applyHealth(h);
  // §9.2: a match this phone started but never got the end of (it slept, or the page was closed): ask the server for it
  if (pend && Date.now() - pend.at < 10 * 60000 && screen !== "rest"){
    const r = await Net.post("/result", { dev: Net.dev });
    if (L3.sameMatch(r, pend.id) && (!G.last || G.last.code !== r.code)){
      G.solo = false; onEnd({ id: pend.id, r: r.r, code: r.code, prize: r.prize, used: r.used, exp: r.exp, why: r.why, md: r.md, sc: r.sc, team: r.team, now: r.now, prizes: r.prizes });
    }
    Store.del(NS + "pend");
  }
})();
