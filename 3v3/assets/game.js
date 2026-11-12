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
  inputMs: 33,               // finger: at most 30 messages a second
  soloConnectMs: 6000,       // single player: no server by then → the match runs on the phone (plan B)
  resultKeepMs: 30 * 60000   // a result shows again on reload while staff can still take it (codes expire after 30 min, §9.6)
};
const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search), DEBUG = Q.has("debug"), C = Sim3.C, COL = Draw.COL, NS = Net.NS, Store = Net.Store;
const SCREENS = ["home", "join", "pick", "mode", "multi", "lobby", "match", "result", "rest"];
const SGT = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
const hhmm = ts => SGT ? SGT.format(new Date(ts)) : new Date(ts).toTimeString().slice(0, 5);   // always Singapore time
const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not on iPhone */ } };   // haptics where the phone has them
const ERRS = { "no-room": "No game", "room-full": "Full", started: "Started", busy: "Busy", bad: "Try again" };   // one short line (§13)

let screen = "home";
function show(n){ screen = n; SCREENS.forEach(s => { $("#s-" + s).hidden = s !== n; }); $("#stadium").hidden = n === "match"; if (n === "home" && tickerAt) homeTicker(); if (n === "mode") modeState(); if (n === "match") sizePads(); pillCheck(); ticketState(); }
function toast(msg, ms){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms || 2200); }

const G = { cat: Store.get("s3v3:cat"), joined: !!Store.get("s3v3:joined"), want: null, phase: "idle", solo: false, local: false, everUp: false,
  room: null, M: null, last: null, need: C.CHALLENGE_GOALS || 1, multiRest: false, soloLocal: false, soloTimer: 0, roomTimer: 0, rematch: false,
  prize: Store.get(NS + "prize") };   // the newest prize ticket (adversarial S1): {code, label, exp, used, id}
if (!(G.cat >= 0 && G.cat < 4)) G.cat = 0;

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
function leaveAll(){ Sfx.bedStop(); clearTimeout(G.soloTimer); clearTimeout(G.roomTimer); G.phase = "idle"; G.want = null; G.room = null; G.M = null; G.rematch = false; sock.stop(); }

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
  // a room that closes (no rematch in 60 s) must never take the prize code off the result screen
  if (screen === "result"){ G.room = null; G.phase = "idle"; G.rematch = false; sock.stop(); return; }
  if (G.solo){ leaveAll(); show("mode"); toast(ERRS[m.m] || ERRS.bad); return; }
  leaveAll(); show("multi"); const e = $("#codeErr"); e.textContent = ERRS[m.m] || ERRS.bad; e.hidden = false;
}

/* ---------- home, join step, cat, mode ---------- */
$("#goJoin").addEventListener("click", () => { show(G.joined ? "pick" : "join"); });
let tickerAt = 0;   // the ticker's counts are asked again when home shows (at most every 30 s)
function homeTicker(){ if (Date.now() - tickerAt < 30000) return; tickerAt = Date.now(); Net.health().then(h => { if (h && h.ok) ticker(h); }); }
[["#tgJoin", CONFIG.telegram], ["#igJoin", CONFIG.instagram], ["#restTg", CONFIG.telegram], ["#restIg", CONFIG.instagram]].forEach(([s, u]) => { $(s).href = u; });
// a page can't check a follow or a channel join: Play works once either link was tapped (owner 12 Nov ~20:20), remembered on this phone
function joinedNow(){ G.joined = true; Store.set("s3v3:joined", 1); $("#tgErr").hidden = true; }
$("#tgJoin").addEventListener("click", joinedNow); $("#igJoin").addEventListener("click", joinedNow);
$("#goPick").addEventListener("click", () => { if (!G.joined){ $("#tgErr").hidden = false; return; } show("pick"); });
const cardsEl = $("#cards");
Draw.CATS.forEach((c, i) => {
  const b = document.createElement("button"); b.className = "card"; b.setAttribute("aria-pressed", String(G.cat === i));
  b.innerHTML = '<span class="num">' + [7, 10, 9, 1][i] + '</span><img alt="" src="' + c.src + '"><span>' + c.name + "</span>";   // rev 8 trading cards
  b.addEventListener("click", () => { G.cat = i; Store.set("s3v3:cat", i); [...cardsEl.children].forEach((x, j) => x.setAttribute("aria-pressed", String(j === i))); setTimeout(() => show("mode"), 250); });
  cardsEl.appendChild(b);
});
function modeState(){
  $("#mSoloSub").textContent = L3.goals(G.need) + " wins";
  $("#mMulti").disabled = G.multiRest; $("#mMultiSub").textContent = G.multiRest ? "😴" : "1 v 1 · 2 v 2";   // §8: multiplayer resting
}
$("#mSolo").addEventListener("click", () => { startSolo(); });
$("#mMulti").addEventListener("click", () => { $("#codeErr").hidden = true; show("multi"); });

/* ---------- friends: join by code or start a game (§10, §12) ---------- */
$("#codeIn").addEventListener("input", e => { const v = L3.cleanCode(e.target.value); if (v !== e.target.value) e.target.value = v; $("#codeErr").hidden = true; });
function ask(msg){
  $("#codeErr").hidden = true; G.solo = false; G.local = false; G.want = msg; G.phase = "asking"; G.rematch = false;
  if (sock.isLocal()) sock.stop();
  sock.start(false); if (sock.up()) sock.send(msg);
}
$("#joinForm").addEventListener("submit", e => {
  e.preventDefault(); const code = L3.cleanCode($("#codeIn").value);
  if (code.length !== 4){ const er = $("#codeErr"); er.textContent = "Wrong code"; er.hidden = false; return; }
  $("#codeIn").blur(); ask({ t: "join", code, cat: G.cat });
});
$("#n1").addEventListener("click", () => { ask({ t: "create", size: 1, cat: G.cat }); });
$("#n2").addEventListener("click", () => { ask({ t: "create", size: 2, cat: G.cat }); });
$("#multiBack").addEventListener("click", () => { leaveAll(); show("mode"); });

/* ---------- single player: vs the Matcha Bot (§7, §8, §11) ---------- */
function soloHud(){ const A = $("#hudA"), B = $("#hudB"); A.textContent = "YOU"; B.textContent = "MATCHA BOT"; A.className = "tchip m"; B.className = "tchip yz"; }
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
  if (G.phase === "match") return;
  G.room = m; G.room.fresh = true; clearTimeout(G.roomTimer);
  if (G.phase === "asking"){ G.phase = "room"; G.want = null; }
  if (screen === "result" && !G.rematch) return;   // after a match the room waits; Rematch takes you back into it
  if (screen !== "lobby") show("lobby");
  renderRoom();
}
const mineSeat = r => { for (let t = 0; t < 2; t++) for (const s of r.seats[t] || []) if (s && s.me) return s; return null; };
function renderRoom(){
  const r = G.room; if (!r) return;
  const me = mineSeat(r) || {}, after = !!(r.after || G.rematch);
  let h = "", missing = 0;
  for (let t = 0; t < 2; t++){
    h += '<div><h4 style="color:' + COL[t].f + '">TEAM ' + COL[t].name + "</h4>";
    (r.seats[t] || []).forEach((s, i) => {
      // any seat is a button: a free one moves you, a taken one swaps you both (§12.2)
      const dis = r.k || (s && s.me) ? " disabled" : "";
      if (!s){ missing++; h += '<button class="slot empty" data-t="' + t + '" data-s="' + i + '" aria-label="Sit here"' + dis + ">＋</button>"; return; }
      const mark = s.off ? "💤" : after && s.rm ? "✓" : "";
      h += '<button class="slot' + (s.me ? " me" : "") + '" id="sl' + t + i + '" data-t="' + t + '" data-s="' + i + '"' + dis + '><canvas width="60" height="60"></canvas><span class="who">' +
        (s.me ? "YOU" : "") + '</span><span class="mark">' + mark + "</span></button>";
    });
    h += "</div>";
  }
  $("#slots").innerHTML = h;
  for (let t = 0; t < 2; t++) (r.seats[t] || []).forEach((s, i) => { if (!s) return; const cv = document.querySelector("#sl" + t + i + " canvas"), fc = Draw.faceCanvas(s.cat, t, 60); if (fc && cv) cv.getContext("2d").drawImage(fc, 0, 0, 60, 60); });
  r.missing = missing; r.maker = !!me.mk;
  $("#roomKind").textContent = r.size + " V " + r.size;
  // the game maker taps Start on a full room (§12.2); everyone else sees a short line
  $("#startGo").hidden = !(r.maker && !missing && !r.k);
  roomTick();
}
$("#slots").addEventListener("click", e => { const b = e.target.closest("button.slot"); if (!b || b.disabled) return; send({ t: "seat", team: +b.dataset.t, slot: +b.dataset.s }); });
$("#startGo").addEventListener("click", () => { $("#startGo").hidden = true; send({ t: "start" }); });
$("#leaveGo").addEventListener("click", () => { send({ t: "leave" }); leaveAll(); show("multi"); });
let lastCount = -1;
function roomTick(){
  const r = G.room; if (!r || screen !== "lobby") return;
  let big, hint, foot;
  if (r.k){ const n = Math.max(0, Math.ceil((r.k - Net.now()) / 1000)); big = String(n); hint = ""; foot = ""; if (n !== lastCount && n > 0){ lastCount = n; Sfx.play("tick"); } }
  else { big = r.code; hint = r.maker ? "Share this code" : "You're in"; foot = r.missing ? "Tap to swap" : r.maker ? "" : "Starting soon…"; lastCount = -1; }
  [["#lCount", big], ["#roomHint", hint], ["#roomFoot", foot]].forEach(([s, v]) => { const el = $(s); if (el.textContent !== v) el.textContent = v; });
}

/* ---------- the match ---------- */
const pitchCv = $("#pitch");
const finger = { x: C.W / 2, y: C.H * 0.8, a: 0, id: null };
let lastSent = null, seq = 0, V = null, shake = 0, freeze = 0, padTop = 54, padBot = 12;
function onStart(m){
  clearTimeout(G.soloTimer);
  if (G.M && G.M.id === m.id){ G.M.you = m.you; G.M.lastSnapT = performance.now(); if (screen !== "match") show("match"); return; }   // re-sent after a reconnect: carry on
  const size = m.size || (m.cats && m.cats[0] ? m.cats[0].length : 3);
  G.M = { id: m.id, you: m.you, md: m.md ? 1 : 0, need: m.need || G.need, at: m.at, size, cats: m.cats || [[], []], bots: m.bots || [[], []],
    snaps: [], newest: null, sc: [0, 0], cdShown: -1, own: { x: 0, y: 0, vx: 0, vy: 0, on: false, ex: 0, ey: 0, hist: [] },
    ball: { dx: null, dy: null, ox: 0, oy: 0, snap: null, mode: null }, trail: [], lastSnapT: performance.now(), hud: "" };
  if (m.need) G.need = m.need;
  G.M.sub = G.M.md ? "🤖 " + L3.goals(G.M.need) + " wins" : "1st goal wins";
  G.phase = "match"; G.want = null; G.rematch = false; finger.a = 0; finger.id = null; lastSent = null;
  Store.set(NS + "pend", { id: m.id, at: Date.now() });
  Fx.clear(); show("match"); banner("3", G.M.sub); $("#hint").hidden = false; hudSet(true);
}
function onSnap(m){
  const M = G.M; if (!M || !Array.isArray(m.p) || !Array.isArray(m.b)) return;
  const t = performance.now(), prev = M.snaps.length ? M.snaps[M.snaps.length - 1].ts : null;
  m.arr = t; m.ts = L3.stamp(prev, t); M.snaps.push(m); M.newest = m; M.lastSnapT = t;
  while (M.snaps.length > 2 && M.snaps[0].ts < t - 1500) M.snaps.shift();
  if (Array.isArray(m.sc)) M.sc = m.sc; if (m.md !== undefined) M.md = m.md ? 1 : 0;
  // own player: compare the server's position with where we predicted it one round trip ago; ease the difference away
  const own = M.own;
  if (m.st === C.ST_PLAY && own.on){
    const sp = m.p[myIdx(M, m)], h = L3.histAt(own.hist, t - Net.clock.rtt - 16);
    if (sp && h){ const ex = sp[0] - h.x, ey = sp[1] - h.y;
      if (Math.hypot(ex, ey) > 10){ own.x = sp[0]; own.y = sp[1]; own.ex = own.ey = 0; own.hist = []; } else { own.ex = ex; own.ey = ey; } }
  }
}
const myIdx = (M, s) => M.you.team * (s.p.length / 2) + M.you.slot;
function onEv(m){
  const M = G.M; if (!M) return; const me = M.you.team;
  switch (m.k){
    case "go": banner("GO!", "", 700); Sfx.play("whistle"); Sfx.bed(0.8); break;   // the crowd bed runs while the ball is live
    case "kickoff": banner(""); M.cdShown = -1; break;                     // a challenge goes on after the bot's goal
    case "grow": banner("↔ BIGGER GOALS", "", 1400); break;
    case "goal": {
      if (Array.isArray(m.sc)) M.sc = m.sc; else M.sc[m.w] = (M.sc[m.w] || 0) + 1;
      const mine = m.w === me;
      const botGoal = M.md && !mine;
      if (mine && M.newest) M.goalTl = M.newest.tl;   // for the personal best
      banner(botGoal ? "🤖 GOAL!" : "GOAL!", "", botGoal ? 1400 : 0); lights(m.w, !botGoal, botGoal ? 1 - me : -1);
      Sfx.play("whistle"); Sfx.play("horn"); Sfx.play("roar"); Sfx.play("net"); Sfx.bed(1.6); setTimeout(() => Sfx.bed(0.8), 2500);   // every goal
      if (mine) Sfx.play("fanfare");
      buzz(botGoal ? [40, 30, 40] : [60, 40, 90]); break; }
    case "draw": case "timeup": banner(m.k === "timeup" || M.md ? "TIME UP" : "DRAW"); Sfx.play("whistle"); Sfx.bedStop(); break;   // timeup = vs the bot, time ran out
    case "hit": { const mine = m.team === me && m.slot === M.you.slot; if (mine || m.p > 0.5) Sfx.play("kick", m.p); if (mine) buzz(Math.round(8 + 22 * (m.p || 0)));
      if (m.p > 0.7 && !Draw.REDUCED) freeze = Math.max(freeze, 0.06); break; }   // hit-stop on a big hit
    case "wall": Sfx.play("wall"); break;
    case "post": {   // a fast ball off the post = a near miss: "ooh", 😱, the crowd jumps, a beat of hit-stop (the server keeps playing)
      Sfx.play("clang"); const b = M.newest && M.newest.b;
      if (b && M.newest.st === C.ST_PLAY && Math.hypot(b[2], b[3]) > 22){ Sfx.play("ooh"); banner("😱", "", 700); Draw.st.hype = 1.2; Draw.st.hypeTeam = -1; if (!Draw.REDUCED) freeze = Math.max(freeze, 0.1); }
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
  const M = G.M; if (!M) return; const me = M.you.team;
  if (M.md){ if (force) soloHud(); return; }
  const a = me === 0 ? "MATCHA · YOU" : "MATCHA", b = me === 1 ? "YUZU · YOU" : "YUZU", key = a + "|" + b;
  if (!force && key === M.hud) return; M.hud = key;
  const A = $("#hudA"), B = $("#hudB"); A.textContent = a; B.textContent = b; A.className = "tchip m"; B.className = "tchip yz";
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
  const ahead = L3.ballAhead(N.st, Math.min(CONFIG.aheadMaxMs, Math.max(0, now - N.arr + Net.clock.rtt)) / 1000);
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
  const N = M.newest, n = N.p.length, size = n / 2, me = myIdx(M, N), I = L3.interp(M.snaps, now - CONFIG.delayMs), own = M.own;
  if (N.st === C.ST_PLAY){   // own player: predicted with the server's own follow rule, so it moves under the finger at once
    if (!own.on){ const p = N.p[me]; Object.assign(own, { x: p[0], y: p[1], vx: 0, vy: 0, ex: 0, ey: 0, hist: [], on: true }); }
    Sim3.followTarget(own, finger, dt);
    const k = 1 - Math.exp(-dt * 8), cx = own.ex * k, cy = own.ey * k; own.x += cx; own.y += cy; own.ex -= cx; own.ey -= cy;
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
  const clk = N.st === C.ST_COUNT ? String(Math.ceil((N.tl || 60000) / 1000)) : String(Math.max(0, Math.ceil(N.tl / 1000))); const ce = $("#clock"); if (ce.textContent !== clk) ce.textContent = clk;
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
  if (L3.sameMatch(r, M.id)){ onEnd({ id: M.id, r: r.r, code: r.code, prize: r.prize, used: r.used, exp: r.exp, why: r.why, md: M.md, sc: M.sc, team: M.you.team }); return; }
  leaveAll(); show("mode"); toast("Match lost");
}

/* ---------- result: WIN / LOSE, the score, and only when there is a prize: its name, the code, "Redeem at the counter" (§13) ---------- */
function onEnd(m){
  send({ t: "got", id: m.id });                                   // §9.2: the server stops re-sending this result
  if (G.last && G.last.id === m.id && screen === "result") return;
  const M = G.M, team = M ? M.you.team : (typeof m.team === "number" ? m.team : 0);
  const res = { id: m.id, r: m.r, w: m.w, code: m.code || null, prize: m.prize || null, md: m.md !== undefined ? (m.md ? 1 : 0) : (M ? M.md : 0),
    sc: Array.isArray(m.sc) ? m.sc : M ? M.sc : null, team, at: Date.now(), used: m.used || null, solo: G.solo, exp: m.exp || null, why: m.why || null,
    secs: M && typeof M.goalTl === "number" ? Math.round((C.MATCH_S * 1000 - M.goalTl) / 100) / 10 : null };   // seconds to the winning goal
  G.last = res; Store.set(NS + "last", res); Store.del(NS + "pend");
  const kept = L3.keepPrize(G.prize, res); if (kept !== G.prize){ G.prize = kept; Store.set(NS + "prize", kept); }   // a later no-prize result never replaces it
  G.M = null; clearTimeout(G.soloTimer);
  if (G.solo){ G.phase = "idle"; setTimeout(() => { if (G.phase === "idle") sock.stop(); }, 1200); } else G.phase = G.room ? "room" : "idle";
  Sfx.bedStop(); Fx.clear(); showResult(res);
  if (res.r === "win"){ Sfx.play("fanfare"); Sfx.play("coin"); Fx.fireworks(6); Fx.confetti(["#6fbf4a", "#ffd23f", "#fffbe6"], 0); buzz([60, 40, 120]); }   // fireworks: not with reduced motion / lite
  else if (res.r === "lose") Sfx.play("sad"); else Sfx.play("whistle");
}
function showResult(res){
  const ch = res.md === 1, win = res.r === "win", me = res.team, sc = res.sc || [0, 0]; if (!win) Fx.clear();
  $("#rTitle").textContent = win ? "WIN!" : res.r === "draw" ? "DRAW" : "LOSE";
  $("#trophy").hidden = !win; $("#sadcat").hidden = win;   // rev 8: the trophy with rays, or the sad cat
  // personal best on this phone: the fastest winning goal ("⚡ 12.4s · 🏅 BEST")
  const pb = $("#pb"); pb.hidden = !(win && res.secs > 0);
  if (!pb.hidden){ const best = Store.get(NS + "best"), isBest = !(best > 0) || res.secs < best; if (isBest && !res.shown) Store.set(NS + "best", res.secs);
    pb.textContent = "⚡ " + res.secs.toFixed(1) + "s" + (isBest || res.best ? " · 🏅 BEST" : ""); if (isBest) res.best = 1; res.shown = 1; }
  $("#rEyebrow").textContent = ch ? "🤖 " + (sc[1 - me] || 0) + " – " + (sc[me] || 0) + " YOU" : (sc[me] || 0) + " – " + (sc[1 - me] || 0);
  prizeCard(res);
  const why = L3.whyLine(res); $("#noPrize").textContent = why; $("#noPrize").hidden = !why;
  $("#again").textContent = res.solo ? "↻ Again" : "↻ Rematch"; $("#again").disabled = false; G.rematch = false;
  show("result");
}
// the card shows only when there is something to redeem: a prize name from the server and a code; a lost single-player game never has one
const hasPrize = L3.hasPrize;
function prizeCard(res){
  const has = hasPrize(res);
  $("#prize").hidden = !has; if (!has) return;
  $("#pV").textContent = res.prize.label; $("#pCode").textContent = res.code; $("#pBy").textContent = res.exp && !res.used ? "by " + hhmm(res.exp) : "";
  $("#pS").textContent = res.used ? "✓ Used " + hhmm(res.used) : "Redeem at the counter"; $("#prize").classList.toggle("is-used", !!res.used);
}
/* the ticket: 🎟 on every screen but the pitch while the newest prize is unused and not expired; it opens the same card */
function ticketState(){
  const live = L3.prizeLive(G.prize, Date.now()), sheet = $("#ticket");
  const on = live && screen !== "match" && sheet.hidden && !(screen === "result" && G.last && G.last.code === G.prize.code);
  if ($("#ticketBtn").hidden === on) $("#ticketBtn").hidden = !on;
  if (!sheet.hidden){ const p = G.prize; if (!p){ sheet.hidden = true; return; }
    $("#tV").textContent = p.label; $("#tCode").textContent = p.code; $("#tBy").textContent = p.exp && !p.used ? "by " + hhmm(p.exp) : "";
    $("#tS").textContent = p.used ? "✓ Used " + hhmm(p.used) : p.exp && Date.now() >= p.exp ? "Expired" : "Redeem at the counter"; }
}
$("#ticketBtn").addEventListener("click", () => { $("#ticket").hidden = false; ticketState(); recheckPrize(); });
$("#ticketClose").addEventListener("click", () => { $("#ticket").hidden = true; ticketState(); });
// staff redeem on their page: when this page comes back (or loads), it asks the server about the ticket, so it shows "✓ Used"
async function recheckPrize(){
  const p = G.prize; if (!p || !p.code || p.used) return;
  const r = await Net.post("/result", { dev: Net.dev, code: p.code });
  if (!r || !r.ok || G.prize !== p) return;
  if (r.used) p.used = r.used; if (r.exp) p.exp = r.exp; Store.set(NS + "prize", p);
  if (G.last && G.last.code === p.code){ G.last.used = p.used; G.last.exp = p.exp; Store.set(NS + "last", G.last); if (screen === "result") prizeCard(G.last); }
  ticketState();
}
// the result on screen: asked again when the page comes back (prize, use); the ticket has its own check
async function recheck(){
  const res = G.last; if (!res || !res.code || res.used){ recheckPrize(); return; }
  const r = await Net.post("/result", { dev: Net.dev, code: res.code });
  if (r && r.ok && G.last === res){
    if (r.used) res.used = r.used; if (r.prize !== undefined) res.prize = r.prize; if (r.exp) res.exp = r.exp; Store.set(NS + "last", res);
    const kept = L3.keepPrize(G.prize, res); if (kept !== G.prize){ G.prize = kept; Store.set(NS + "prize", kept); }
    if (screen === "result") prizeCard(res);
  }
  recheckPrize();
}
$("#again").addEventListener("click", () => {
  if (G.last && G.last.solo){ startSolo(); return; }
  if (!G.room){ leaveAll(); show("multi"); return; }              // the room closed meanwhile
  G.rematch = true; $("#again").disabled = true; send({ t: "rematch" }); show("lobby"); renderRoom();
});
$("#back").addEventListener("click", () => { if (G.room) send({ t: "leave" }); leaveAll(); show("mode"); });
$("#restRetry").addEventListener("click", async () => { const h = await Net.health(); applyHealth(h); if (!(h && h.closed)) show("home"); });

/* ---------- sound, reconnect pill, debug, lite ---------- */
function soundBtn(){ const b = $("#soundBtn"); b.textContent = Sfx.on ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(Sfx.on)); b.setAttribute("aria-label", Sfx.on ? "Sound on" : "Sound off"); }
Sfx.init(); soundBtn();
$("#soundBtn").addEventListener("click", () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); soundBtn(); Sfx.play("tap"); });
// every other button and link-button clicks (sound + a tiny buzz on phones that have one)
document.addEventListener("click", e => { const b = e.target.closest("button, a.btn, .card"); if (b && b.id !== "soundBtn" && !b.disabled){ Sfx.play("tap"); buzz(8); } }, true);
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
  if (perfN >= 120){ if (perfSum / perfN > 0.028){ Draw.st.lite = true; document.body.classList.add("lite"); if (DEBUG) toast("Lite mode"); } perfN = 0; perfSum = 0; }
}
function dbg(){
  if (!DEBUG) return; const d = $("#dbg"); d.hidden = false;
  d.textContent = "RTT " + Math.round(Net.clock.rtt) + " ms · off " + Math.round(Net.clock.offset) + " ms\n" + Net.mode + (sock.isLocal() ? " · LOCAL" : "") + (Draw.st.lite ? " · lite" : "") + " · seq " + seq;
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
  Fx.frame(dt); perfWatch(dt); sendInput(false); pillCheck(); dbg();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ if (finger.a){ finger.a = 0; finger.id = null; sendInput(true); } cancelAnimationFrame(rafId); rafId = 0; Sfx.bedStop(); return; }
  lastT = performance.now(); if (!rafId) rafId = requestAnimationFrame(frame);
  sock.nudge(); recheck();
});
window.addEventListener("pageshow", e => { if (e.persisted){ sock.nudge(); recheck(); } });

/* ---------- start ---------- */
function applyHealth(h){
  if (!h || !h.ok) return;
  ticker(h);
  if (typeof h.need === "number" && h.need > 0) G.need = h.need;
  G.soloLocal = h.solo === "local"; if (G.soloLocal) G.multiRest = true;   // §8: the server asks phones to play single player on the phone
  if (h.closed){ leaveAll(); show("rest"); } else if (screen === "mode") modeState();
}
(async function init(){
  sizePads(); lastT = performance.now(); rafId = requestAnimationFrame(frame);
  const last = Store.get(NS + "last"), pend = Store.get(NS + "pend");
  // a reload shows the last result again only while there is a prize to redeem (staff take codes for 30 min)
  if (hasPrize(last) && Date.now() - last.at < CONFIG.resultKeepMs){ G.last = last; showResult(last); }
  else show("home");
  if (!G.prize && hasPrize(last)){ G.prize = L3.keepPrize(null, last); Store.set(NS + "prize", G.prize); }   // a result saved before the ticket key
  recheck();   // shows "✓ Used" if staff already took the ticket
  const h = await Net.health(); tickerAt = Date.now(); applyHealth(h);
  // §9.2: a match this phone started but never got the end of (it slept, or the page was closed): ask the server for it
  if (pend && Date.now() - pend.at < 10 * 60000 && screen !== "rest"){
    const r = await Net.post("/result", { dev: Net.dev });
    if (L3.sameMatch(r, pend.id) && (!G.last || G.last.code !== r.code)){
      G.solo = false; onEnd({ id: pend.id, r: r.r, code: r.code, prize: r.prize, used: r.used, exp: r.exp, why: r.why, md: r.md, sc: r.sc, team: r.team });
    }
    Store.del(NS + "pend");
  }
})();
