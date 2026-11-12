/* Gotcha Shootout 3v3 — the phone game (API-3V3.md §6–§11): join step → cat → how to play (vs the Matcha Bot, new game 1 v 1 / 2 v 2, join by
   code) → room → match → result. Others are drawn ~100 ms behind, your own player is predicted, the ball is drawn ahead (§9.1). The server
   decides every goal and result; single player runs on the phone only when the server can't be reached (plan B, §8). */
"use strict";
const CONFIG = {
  telegram: "https://t.me/gotchamatchasg",                     // owner 12 Nov ~20:50 (DECISIONS)
  instagram: "https://www.instagram.com/gotchamatcha.sg/", instagramName: "@gotchamatcha.sg",
  delayMs: 100,              // others: drawn this far behind the newest snapshot (rides over 4G jitter)
  aheadMaxMs: 150,           // ball: drawn at most this far ahead of its newest snapshot (CTO G1 §9.1)
  inputMs: 33,               // finger: at most 30 messages a second
  soloConnectMs: 6000,       // single player: no server by then → the match runs on the phone (plan B)
  resultKeepMs: 30 * 60000   // a result shows again on reload while staff can still take it (codes expire after 30 min, §9.6)
};
const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search), DEBUG = Q.has("debug"), C = Sim3.C, COL = Draw.COL, NS = Net.NS, Store = Net.Store;
const SCREENS = ["home", "join", "pick", "how", "room", "match", "result", "rest"];
const SGT = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
const hhmm = ts => SGT ? SGT.format(new Date(ts)) : new Date(ts).toTimeString().slice(0, 5);   // always Singapore time
const ERRS = { "no-room": "No game with that code", "room-full": "That game is full", started: "Already started", busy: "Busy right now. Try again soon.", bad: "Something went wrong. Try again." };

let screen = "home";
function show(n){ screen = n; SCREENS.forEach(s => { $("#s-" + s).hidden = s !== n; }); if (n === "how") howState(); if (n === "match") sizePads(); pillCheck(); }
function toast(msg, ms){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms || 2600); }

const G = { cat: Store.get("s3v3:cat"), joined: !!Store.get("s3v3:joined"), want: null, phase: "idle", solo: false, local: false, everUp: false,
  room: null, M: null, last: null, need: C.CHALLENGE_GOALS || 1, multiRest: false, soloLocal: false, soloTimer: 0, roomTimer: 0 };
if (!(G.cat >= 0 && G.cat < 4)) G.cat = null;

/* ---------- the socket ---------- */
const sock = Net.Socket({
  open(){
    if (!sock.isLocal()){ G.everUp = true; G.multiRest = false; }
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
    if (!G.solo && fails >= 3 && (G.phase === "asking" || G.phase === "room")){ leaveAll(); show("rest"); }   // §9.5: 3 failed connects
  }
});
function send(o){ return sock.send(o); }
function leaveAll(){ clearTimeout(G.soloTimer); clearTimeout(G.roomTimer); G.phase = "idle"; G.want = null; G.room = null; G.M = null; sock.stop(); }

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
  if (m.m === "closed"){ leaveAll(); show("rest"); return; }
  if (G.phase === "match") return;
  const solo = G.solo; leaveAll(); show("how");
  if (solo && m.m === "busy"){ playLocal(); return; }   // the server is full: single player still plays, on the phone
  const e = $("#hErr"); e.textContent = ERRS[m.m] || ERRS.bad; e.hidden = false;
}

/* ---------- home, join step, cat ---------- */
$("#goPlay").addEventListener("click", () => { Sfx.play("tap"); show(!G.joined ? "join" : G.cat === null ? "pick" : "how"); });
[["#jTg", CONFIG.telegram], ["#jIg", CONFIG.instagram], ["#restTg", CONFIG.telegram], ["#restIg", CONFIG.instagram], ["#xIg", CONFIG.instagram]].forEach(([s, u]) => { $(s).href = u; });
$("#jIg").textContent = "Follow " + CONFIG.instagramName;
// a page can't check a follow or a channel join: Play unlocks once either link is tapped (owner 12 Nov ~20:20), remembered on this phone
function joinedNow(){ G.joined = true; Store.set("s3v3:joined", 1); $("#jNext").disabled = false; $("#jState").innerHTML = '<span class="done">✓ Thanks! Come back and tap Play.</span>'; }
$("#jTg").addEventListener("click", joinedNow); $("#jIg").addEventListener("click", joinedNow);
$("#jNext").addEventListener("click", () => { if (!G.joined) return; Sfx.play("tap"); show(G.cat === null ? "pick" : "how"); });
const cardsEl = $("#cards");
Draw.CATS.forEach((c, i) => {
  const b = document.createElement("button"); b.className = "card"; b.setAttribute("aria-pressed", String(G.cat === i));
  b.innerHTML = '<img alt="" src="' + c.src + '"><span>' + c.name + "</span>";
  b.addEventListener("click", () => { Sfx.play("tap"); G.cat = i; Store.set("s3v3:cat", i); [...cardsEl.children].forEach((x, j) => x.setAttribute("aria-pressed", String(j === i))); $("#pNext").disabled = false; });
  cardsEl.appendChild(b);
});
$("#pNext").disabled = G.cat === null; $("#jNext").disabled = !G.joined;
$("#pNext").addEventListener("click", () => { if (G.cat === null) return; Sfx.play("tap"); show("how"); });

/* ---------- how to play ---------- */
function howState(){
  $("#hSoloSub").textContent = "Score " + L3.goals(G.need) + " against the Matcha Bot to win";
  $("#hMulti").hidden = G.multiRest; $("#hRest").hidden = !G.multiRest;
}
$("#hCat").addEventListener("click", () => show("pick"));
$("#hCode").addEventListener("input", e => { const v = L3.cleanCode(e.target.value); if (v !== e.target.value) e.target.value = v; $("#hErr").hidden = true; });
function ask(msg){
  $("#hErr").hidden = true; G.solo = false; G.local = false; G.want = msg; G.phase = "asking";
  if (sock.isLocal()) sock.stop();
  sock.start(false); if (sock.up()) sock.send(msg);
}
$("#hNew1").addEventListener("click", () => { Sfx.play("tap"); ask({ t: "create", size: 1, cat: G.cat }); });
$("#hNew2").addEventListener("click", () => { Sfx.play("tap"); ask({ t: "create", size: 2, cat: G.cat }); });
$("#hJoinForm").addEventListener("submit", e => {
  e.preventDefault(); const code = L3.cleanCode($("#hCode").value);
  if (code.length !== 4){ const er = $("#hErr"); er.textContent = "Type the 4-letter code"; er.hidden = false; return; }
  Sfx.play("tap"); $("#hCode").blur(); ask({ t: "join", code, cat: G.cat });
});
$("#hSolo").addEventListener("click", () => { Sfx.play("tap"); startSolo(); });
function startSolo(){
  leaveAll(); G.solo = true; G.want = { t: "hello", mode: "solo", cat: G.cat }; G.phase = "asking";
  show("match"); banner("Get ready…"); $("#hint").hidden = false;
  if (G.soloLocal){ playLocal(); return; }
  sock.start(false);
  // plan B (§8): no real-time server within ~6 s → this one match runs on the phone; only its code comes from the server
  G.soloTimer = setTimeout(() => { if (G.phase === "asking" && G.solo){ G.multiRest = true; playLocal(); } }, CONFIG.soloConnectMs);
}
function playLocal(){
  clearTimeout(G.soloTimer); sock.stop(); G.solo = true; G.local = true; G.phase = "asking"; G.want = { t: "hello", mode: "solo", cat: G.cat };
  if (screen !== "match"){ show("match"); banner("Get ready…"); }
  sock.start(true);
}

/* ---------- room (friends play by code, §10) ---------- */
function onRoom(m){
  if (G.phase === "match") return;
  G.room = m; G.room.fresh = true; clearTimeout(G.roomTimer);
  if (G.phase === "asking"){ G.phase = "room"; G.want = null; }
  if (screen === "result" && !G.rematch) return;   // after a match the room waits; Rematch takes you back into it
  if (screen !== "room") show("room");
  renderRoom();
}
function renderRoom(){
  const r = G.room; if (!r) return;
  $("#rCode").textContent = r.code; $("#rSize").textContent = r.size + " V " + r.size;
  let h = "", missing = 0, notReady = 0;
  for (let t = 0; t < 2; t++){
    h += '<div><h4 style="color:' + COL[t].f + '">TEAM ' + COL[t].name + "</h4>";
    (r.seats[t] || []).forEach((s, i) => {
      if (!s){ missing++; h += '<button class="slot empty" data-t="' + t + '" data-s="' + i + '"' + (r.k ? " disabled" : "") + ">Tap to sit here</button>"; return; }
      if (G.rematch && !s.rm) notReady++;
      h += '<div class="slot' + (s.me ? " me" : "") + '" id="rs' + t + i + '"><canvas width="60" height="60"></canvas><span class="who">' + (s.me ? "YOU" : "Player") +
        "<i>" + (Draw.CATS[s.cat] || Draw.CATS[0]).name + (G.rematch && s.rm ? " · ✓ ready" : "") + "</i></span></div>";
    });
    h += "</div>";
  }
  $("#rSeats").innerHTML = h;
  for (let t = 0; t < 2; t++) (r.seats[t] || []).forEach((s, i) => { if (!s) return; const cv = document.querySelector("#rs" + t + i + " canvas"), fc = Draw.faceCanvas(s.cat, t, 60); if (fc && cv) cv.getContext("2d").drawImage(fc, 0, 0, 60, 60); });
  r.missing = missing; r.notReady = notReady; roomTick();
}
$("#rSeats").addEventListener("click", e => { const b = e.target.closest("button.slot"); if (!b || b.disabled) return; Sfx.play("tap"); send({ t: "seat", team: +b.dataset.t, slot: +b.dataset.s }); });
$("#rLeave").addEventListener("click", () => { send({ t: "leave" }); G.rematch = false; leaveAll(); show("how"); });
let lastCount = -1;
function roomTick(){
  const r = G.room; if (!r) return; const el = $("#rState");
  let txt;
  if (r.k){ const n = Math.max(0, Math.ceil((r.k - Net.now()) / 1000)); txt = "Kick-off in " + n + "…"; if (n !== lastCount && n > 0){ lastCount = n; Sfx.play("tick"); } }
  else if (r.missing) txt = "Waiting for " + r.missing + " more player" + (r.missing > 1 ? "s" : "");
  else if (G.rematch && r.notReady) txt = "Waiting for the others to tap Rematch";
  else txt = "";
  if (el.textContent !== txt) el.textContent = txt; el.hidden = !txt;
}

/* ---------- the match ---------- */
const pitchCv = $("#pitch"), conf = new Draw.Confetti();
const finger = { x: C.W / 2, y: C.H * 0.8, a: 0, id: null };
let lastSent = null, seq = 0, V = null, shake = 0, padTop = 54, padBot = 12;
function onStart(m){
  clearTimeout(G.soloTimer);
  if (G.M && G.M.id === m.id){ G.M.you = m.you; G.M.lastSnapT = performance.now(); if (screen !== "match") show("match"); return; }   // re-sent after a reconnect: carry on
  const size = m.size || (m.cats && m.cats[0] ? m.cats[0].length : 3);
  G.M = { id: m.id, you: m.you, md: m.md ? 1 : 0, need: m.need || G.need, at: m.at, size, cats: m.cats || [[], []], bots: m.bots || [[], []],
    snaps: [], newest: null, sc: [0, 0], cdShown: -1, own: { x: 0, y: 0, vx: 0, vy: 0, on: false, ex: 0, ey: 0, hist: [] },
    ball: { dx: null, dy: null, ox: 0, oy: 0, snap: null, mode: null }, trail: [], lastSnapT: performance.now(), hud: "" };
  if (m.need) G.need = m.need;
  G.phase = "match"; G.want = null; G.rematch = false; finger.a = 0; finger.id = null; lastSent = null;
  Store.set(NS + "pend", { id: m.id, at: Date.now() });
  show("match"); banner(""); $("#hint").hidden = false; hudSet(true);
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
    case "go": banner("GO!", "", 700); Sfx.play("whistle"); break;
    case "kickoff": banner("KICK-OFF", M.md ? "You " + M.sc[me] + " – " + M.sc[1 - me] + " Bot" : "", 900); break;
    case "grow": banner("GOALS GROW!", "15 seconds left", 1400); break;
    case "goal": {
      if (Array.isArray(m.sc)) M.sc = m.sc; else M.sc[m.w] = (M.sc[m.w] || 0) + 1;
      const mine = m.w === me;
      if (M.md){ const won = mine && M.sc[me] >= M.need;
        if (mine) banner("GOAL!", won ? "You beat the Matcha Bot!" : M.sc[me] + " of " + M.need + " · keep going");
        else banner("BOT SCORES", "You " + M.sc[me] + " – " + M.sc[1 - me] + " Bot"); }
      else banner("GOAL!", mine ? "Your team scores!" : "Team " + COL[m.w].t + " scores");
      lights(m.w); Sfx.play("roar"); Sfx.play(mine ? "fanfare" : "groan"); hudSet(true); break; }
    case "draw": if (M.md) banner("TIME UP", "The Matcha Bot wins"); else banner("FULL TIME", "No goal · it's a draw"); Sfx.play("whistle"); break;
    case "hit": if ((m.team === me && m.slot === M.you.slot) || m.p > 0.5) Sfx.play("kick", m.p); break;
    case "wall": Sfx.play("wall"); break;
    case "post": Sfx.play("clang"); break;
  }
}
function lights(w){   // goal: confetti in the scorer's colours, a shake and one soft flash; reduced motion = none of them
  if (Draw.REDUCED) return;
  const r = pitchCv.getBoundingClientRect(); conf.burst(r.width, r.height, [COL[w].f, "#fffbe6", "#ffd23f"]); shake = 8;
  const f = $("#flash"); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
}
let bannerT = 0;
function banner(txt, sub, ms){
  const b = $("#banner"); b.innerHTML = ""; if (txt){ b.textContent = txt; if (sub){ const s = document.createElement("small"); s.textContent = sub; b.appendChild(s); } }
  b.style.opacity = txt ? 1 : 0; clearTimeout(bannerT); if (ms) bannerT = setTimeout(() => { b.style.opacity = 0; }, ms);
}
function hudSet(force){
  const M = G.M; if (!M) return; const me = M.you.team;
  let a, b;
  if (M.md){ a = "YOU"; b = "VS MATCHA BOT · " + (M.need > 1 ? M.sc[me] + "/" + M.need : "score " + M.need + " to win"); }
  else { a = me === 0 ? "MATCHA · YOU" : "MATCHA"; b = me === 1 ? "YUZU · YOU" : "YUZU"; }
  const key = a + "|" + b + "|" + me; if (!force && key === M.hud) return; M.hud = key;
  const A = $("#hudA"), B = $("#hudB"); A.textContent = a; B.textContent = b; A.hidden = !!M.md;   // a challenge: the pitch already rings YOU
  A.className = "tchip " + (M.md ? (me === 0 ? "m" : "yz") : "m"); B.className = "tchip " + (M.md ? "ch" : "yz");
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
  if (N.st !== C.ST_PLAY) return { x: I.b[0], y: I.b[1] };
  // the ball is drawn where it will be when our finger reaches the server: newest snapshot + one round trip + its age, at most 150 ms
  const ahead = Math.min(CONFIG.aheadMaxMs, Math.max(0, now - N.arr + Net.clock.rtt)) / 1000;
  const b = { x: N.b[0], y: N.b[1], vx: N.b[2], vy: N.b[3] };
  if (typeof Sim3.stepBall === "function"){ if (ahead > 0) Sim3.stepBall(b, ahead, N.gw); }   // the server's own walls, posts and drag
  else { b.x = Math.max(C.RB, Math.min(C.W - C.RB, b.x + b.vx * ahead)); b.y = b.y + b.vy * ahead; }
  return b;
}
function drawMatch(dt, now){
  const M = G.M;
  V = Draw.view(pitchCv, !!(M && M.you.team === 1), padTop, padBot);
  if (!M || !M.newest){ Draw.render(pitchCv, { gw: C.GW0, ball: null, players: [] }, V, T, conf, dt, 0); return; }
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
  if (B.snap !== N || B.mode !== mode){ if (B.dx !== null){ B.ox = B.dx - bt.x; B.oy = B.dy - bt.y; if (Math.hypot(B.ox, B.oy) > 8) B.ox = B.oy = 0; } B.snap = N; B.mode = mode; }
  const kk = Math.exp(-dt / 0.027); B.ox *= kk; B.oy *= kk; B.dx = bt.x + B.ox; B.dy = bt.y + B.oy;
  if (!Draw.st.lite){ M.trail.push([B.dx, B.dy]); if (M.trail.length > 12) M.trail.shift(); }
  const players = [];
  for (let i = 0; i < n; i++){
    const team = i < size ? 0 : 1, slot = i % size, mine = i === me, p = mine && own.on ? [own.x, own.y] : I.p[i];
    const cat = (M.cats[team] || [])[slot], bot = (M.bots[team] || [])[slot];
    players.push({ x: p[0], y: p[1], team, me: mine, cat: cat >= 0 ? cat : (i % 4), label: bot === 0 ? "" : "BOT" });
  }
  Draw.render(pitchCv, { gw: I.gw, ball: { x: B.dx, y: B.dy }, trail: Draw.st.lite ? null : M.trail, players }, V, T, conf, dt, shake); shake *= 0.9;
  const clk = N.st === C.ST_COUNT ? "60" : String(Math.max(0, Math.ceil(N.tl / 1000))); const ce = $("#clock"); if (ce.textContent !== clk) ce.textContent = clk;
  if (N.st === C.ST_COUNT){   // 3 · 2 · 1 from the server's countdown
    const cd = typeof N.cd === "number" ? N.cd - (now - N.arr) : (M.at + C.COUNT_S * 1000 - Net.now()), c = Math.ceil(cd / 1000);
    if (c !== M.cdShown && c > 0){ M.cdShown = c; banner(String(c)); Sfx.play("tick"); }
  }
  hudSet(false);
  if (sock.up() && now - M.lastSnapT > 12000) lostMatch();   // the server forgot the match (it never goes silent this long)
}
async function lostMatch(){
  const M = G.M; if (!M) return; G.M = null; G.phase = "idle";
  const r = await Net.post("/result", { dev: Net.dev });
  if (r && r.ok && r.code && r.at >= M.at - 5000){ onEnd({ id: M.id, r: r.r, code: r.code, prize: r.prize, used: r.used, md: M.md, sc: M.sc, team: M.you.team }); return; }
  leaveAll(); show("how"); toast("That match was lost. Sorry! Play again?", 4000);
}

/* ---------- result ---------- */
function onEnd(m){
  send({ t: "got", id: m.id });                                   // §9.2: the server stops re-sending this result
  if (G.last && G.last.id === m.id && screen === "result") return;
  const M = G.M, team = M ? M.you.team : (typeof m.team === "number" ? m.team : 0);
  const res = { id: m.id, r: m.r, w: m.w, code: m.code || null, prize: m.prize || null, md: m.md !== undefined ? (m.md ? 1 : 0) : (M ? M.md : 0),
    sc: Array.isArray(m.sc) ? m.sc : M ? M.sc : null, team, at: Date.now(), used: m.used || null, solo: G.solo, bots: M ? M.size : 1 };
  G.last = res; Store.set(NS + "last", res); Store.del(NS + "pend");
  G.M = null; clearTimeout(G.soloTimer);
  if (G.solo){ G.phase = "idle"; setTimeout(() => { if (G.phase === "idle") sock.stop(); }, 1200); } else G.phase = G.room ? "room" : "idle";
  showResult(res); Sfx.play(res.r === "win" ? "fanfare" : res.r === "lose" ? "sad" : "whistle");
}
function showResult(res){
  const ch = res.md === 1, win = res.r === "win", draw = res.r === "draw", me = res.team, sc = res.sc || [0, 0], bot = res.bots > 1 ? "BOTS" : "BOT";
  $("#xEyebrow").textContent = ch ? "VS THE MATCHA " + bot : draw ? "FULL TIME · NO GOAL" : "FIRST GOAL WINS";
  const title = ch ? (win ? "YOU BEAT THE MATCHA " + bot + "!" : "THE MATCHA " + bot + (res.bots > 1 ? " WIN" : " WINS")) : draw ? "DRAW!" : win ? "YOU WIN!" : "SO CLOSE!";
  const t = $("#xTitle"); t.textContent = title; t.classList.toggle("long", title.length > 12);
  $("#xLede").textContent = ch ? "You " + (sc[me] || 0) + " – " + (sc[1 - me] || 0) + " Bot" : draw ? "Nobody scored." : "Team " + COL[res.w === 1 ? 1 : 0].t + " scored first.";
  $("#pK").textContent = win ? "Winner's prize" : draw ? "Draw prize" : "Thanks for playing";
  $("#pV").textContent = res.prize && res.prize.label ? res.prize.label : "Show this at the booth";
  $("#pCode").textContent = res.code || "No code";
  $("#pS").textContent = res.code ? "Show staff at the booth" : "No signal for the code. Show this screen at the booth.";
  usedState(res);
  $("#xAgain").textContent = res.solo ? "Play again" : "Rematch"; $("#xAgain").disabled = false; G.rematch = false;
  show("result");
}
function usedState(res){ const u = $("#pUsed"); u.hidden = !res.used; $("#pS").hidden = !!res.used; if (res.used) u.textContent = "Used at " + hhmm(res.used); $("#prize").classList.toggle("is-used", !!res.used); }
// staff redeem on their page; when this page comes back, it asks again so the person sees "Used at …"
async function recheck(){
  const res = G.last; if (!res || !res.code || res.used) return;
  const r = await Net.post("/result", { dev: Net.dev, code: res.code });
  if (!r || !r.ok || G.last !== res) return;
  if (r.used) res.used = r.used; if (r.prize !== undefined) res.prize = r.prize; Store.set(NS + "last", res);
  $("#pV").textContent = res.prize && res.prize.label ? res.prize.label : "Show this at the booth"; usedState(res);
}
$("#xAgain").addEventListener("click", () => {
  Sfx.play("tap");
  if (G.last && G.last.solo){ startSolo(); return; }
  if (!G.room){ show("how"); return; }
  G.rematch = true; $("#xAgain").disabled = true; send({ t: "rematch" }); show("room"); renderRoom();
});
$("#xBack").addEventListener("click", () => { Sfx.play("tap"); if (G.room) send({ t: "leave" }); G.rematch = false; leaveAll(); show("how"); });
$("#restRetry").addEventListener("click", async () => { const h = await Net.health(); applyHealth(h); if (!(h && h.closed)) show("home"); });

/* ---------- sound, reconnect pill, debug, lite ---------- */
function soundBtn(){ const b = $("#soundBtn"); b.textContent = Sfx.on ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(Sfx.on)); b.setAttribute("aria-label", Sfx.on ? "Sound on" : "Sound off"); }
Sfx.init(); soundBtn();
$("#soundBtn").addEventListener("click", () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); soundBtn(); Sfx.play("tap"); });
document.addEventListener("pointerdown", () => Sfx.unlock(), { capture: true, passive: true });   // the browser lets sound start only inside a tap
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
if (Q.has("lite") || (navigator.hardwareConcurrency || 8) <= 2) Draw.st.lite = true;
let perfN = 0, perfSum = 0;
function perfWatch(dt){   // slow phone: under ~36 fps for 2 s of a match → lite drawing (no trail, no floodlight pools)
  if (Draw.st.lite || screen !== "match" || !(dt > 0)) return; perfN++; perfSum += dt;
  if (perfN >= 120){ if (perfSum / perfN > 0.028){ Draw.st.lite = true; if (DEBUG) toast("Lite mode"); } perfN = 0; perfSum = 0; }
}
function dbg(){
  if (!DEBUG) return; const d = $("#dbg"); d.hidden = false;
  d.textContent = "RTT " + Math.round(Net.clock.rtt) + " ms · off " + Math.round(Net.clock.offset) + " ms\n" + Net.mode + (sock.isLocal() ? " · LOCAL" : "") + (Draw.st.lite ? " · lite" : "") + " · seq " + seq;
}

/* ---------- home background: the bots-only demo, as in the mock-up ---------- */
const bgCv = $("#bgpitch"); let demo = null;
function drawDemo(dt){
  if (!demo || demo.st === C.ST_END) demo = Sim3.createMatch({ seed: Math.floor(Math.random() * 1e9), humans: [], cats: [[0, 1, 2], [3, 0, 1]] });
  Sim3.step(demo, dt);
  const v = Draw.view(bgCv, false, 10, 34);
  Draw.render(bgCv, { gw: demo.gw, ball: demo.b, trail: null, players: demo.p.map(q => ({ x: q.x, y: q.y, team: q.team, cat: q.cat, label: "" })) }, v, T, null, dt, 0);
}

/* ---------- the loop: paused while the page is hidden ---------- */
let rafId = 0, lastT = 0, T = 0;
function frame(now){
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now; T += dt;
  if (screen === "home") drawDemo(dt);
  else if (screen === "match") drawMatch(dt, now);
  else if (screen === "room") roomTick();
  perfWatch(dt); sendInput(false); pillCheck(); dbg();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden){ if (finger.a){ finger.a = 0; finger.id = null; sendInput(true); } cancelAnimationFrame(rafId); rafId = 0; return; }
  lastT = performance.now(); if (!rafId) rafId = requestAnimationFrame(frame);
  sock.nudge(); if (screen === "result") recheck();
});
window.addEventListener("pageshow", e => { if (e.persisted){ sock.nudge(); if (screen === "result") recheck(); } });

/* ---------- start ---------- */
function applyHealth(h){
  if (!h || !h.ok) return;
  if (typeof h.need === "number" && h.need > 0) G.need = h.need;
  G.soloLocal = h.solo === "local"; if (G.soloLocal) G.multiRest = true;   // §8: the server asks phones to play single player on the phone
  if (h.closed){ leaveAll(); show("rest"); }
}
(async function init(){
  sizePads(); lastT = performance.now(); rafId = requestAnimationFrame(frame);
  const last = Store.get(NS + "last"), pend = Store.get(NS + "pend");
  if (last && last.code && Date.now() - last.at < CONFIG.resultKeepMs){ G.last = last; showResult(last); recheck(); }
  else show("home");
  const h = await Net.health(); applyHealth(h);
  // §9.2: a match this phone started but never got the end of (it slept, or the page was closed): ask the server for it
  if (pend && Date.now() - pend.at < 10 * 60000 && screen !== "rest"){
    const r = await Net.post("/result", { dev: Net.dev });
    if (r && r.ok && r.code && (!G.last || G.last.code !== r.code) && (!r.at || r.at >= pend.at - 60000)){
      G.solo = false; onEnd({ id: pend.id, r: r.r, code: r.code, prize: r.prize, used: r.used, md: r.md, sc: r.sc, team: r.team });
    }
    Store.del(NS + "pend");
  }
})();
