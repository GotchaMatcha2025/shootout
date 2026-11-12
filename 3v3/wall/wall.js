/* Gotcha Shootout: the big screen at the booth (1920×1080 on the projector / Android TV browser, so plain ES2018, no `inset`).
   It draws the server's featured match ~100 ms behind (interpolated); when nothing runs it plays a bots-only demo with sim.js.
   Offline or closed it keeps the demo going: only the small dot turns grey ("Back soon" when closed). It never shows an error.
   Contract: scratchpad/3v3/API-3V3.md §3 (wall messages), §7/§8/§10 (modes), §9 (closed switch). The server decides every goal. */
"use strict";
var WallCore = (function () {
  var TEAM = ["MATCHA", "YUZU"];
  var BASES = { live: "https://gotcha-shootout-3v3.long-fog-ae60.workers.dev", staging: "https://gotcha-shootout-3v3-staging.long-fog-ae60.workers.dev",
    local: "http://localhost:8787", fake: "http://fake.invalid" };
  // ?api= wins and is remembered for the tab; the Mac (localhost / file) defaults to staging, everything else to live
  function pickMode(asked, saved, host, proto) {
    if (BASES[asked]) return asked;
    if (BASES[saved]) return saved;
    return proto === "file:" || /^(localhost|127\.0\.0\.1)$/.test(host) ? "staging" : "live";
  }
  // the socket address; a wall key (server secret WALL_KEY) rides along as &k= only when there is one
  function wsUrl(base, key) { return base.replace(/^http/, "ws") + "/ws?role=wall" + (key ? "&k=" + encodeURIComponent(key) : ""); }
  // the wall key: ?k= in this page's address wins (and is kept on the TV), else the kept one; junk is ignored
  var KEY_RE = /^[A-Za-z0-9._~-]{1,200}$/;
  function pickKey(fromUrl, kept) { return fromUrl && KEY_RE.test(fromUrl) ? fromUrl : kept && KEY_RE.test(kept) ? kept : null; }
  function urlKey(search) { var m = /[?&]k=([^&#]*)/.exec(search || ""); if (!m) return null; try { return decodeURIComponent(m[1]); } catch (e) { return null; } }
  // the address without k=, so the key never shows in the TV's address bar
  function stripKey(search) { var s = (search || "").replace(/^\?/, "").split("&").filter(function (x) { return x && !/^k=/.test(x); }).join("&"); return s ? "?" + s : ""; }
  // reconnect forever: 0.5 s, 1 s, 2 s … capped at 10 s, ±25% so a room of walls doesn't knock at once
  function backoff(n, r) { return Math.round(Math.min(10000, 500 * Math.pow(2, Math.min(n, 5))) * (0.75 + 0.5 * r)); }
  function isSolo(md) { return md === 1 || md === "challenge" || md === "solo"; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  // position at time t from snapshots stamped on arrival; a jump of more than 12 units (a kick-off reset) is not slid across
  function sample(buf, t) {
    if (!buf.length) return null;
    var i = buf.length - 1;
    while (i > 0 && buf[i].t > t) i--;
    var a = buf[i], b = buf[i + 1];
    if (!b || t <= a.t) return a.s;
    var k = (t - a.t) / Math.max(1, b.t - a.t), A = a.s, B = b.s;
    function pt(p, q) { return Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) > 12 ? [q[0], q[1]] : [lerp(p[0], q[0], k), lerp(p[1], q[1], k)]; }
    var p = [];
    for (var j = 0; j < B.p.length; j++) p.push(A.p[j] ? pt(A.p[j], B.p[j]) : B.p[j]);
    return { st: A.st, tl: lerp(A.tl, B.tl, k), gw: lerp(A.gw, B.gw, k), md: B.md, sc: A.sc, bt: B.bt, b: pt(A.b, B.b), p: p };
  }
  // what the wall shouts when the drawn score changes or time runs out. Versus: first goal wins. Single player: the human team wins at the
  // server's `need` (or when the server ends the match on that goal, st 2); the bot's goals only restart play
  // Multiplayer (owner 12 Nov ~22:54): first to the server's `need` (3), a new kick-off after each goal; the deciding goal (or the server
  // ending the match on it, st 2) = "MATCHA WINS" over the score, winner's goals first
  function score(sc, w) { return sc ? sc[w] + "–" + sc[1 - w] : ""; }
  function goalText(md, w, sc, humanTeam, need, ended) {
    if (!isSolo(md)) {
      if (ended || (need && sc && sc[w] >= need)) return { text: TEAM[w] + " WINS", sub: score(sc, w), party: true, end: true };
      return { text: "GOAL! TEAM " + TEAM[w], party: true, end: false };
    }
    if (w !== humanTeam) return { text: "MATCHA BOT SCORES", party: false, end: false };
    if (ended || (need && sc && sc[w] >= need)) return { text: "GOAL! BOT BEATEN", party: true, end: true };
    return { text: "GOAL!", party: true, end: false };
  }
  // time up: single player = the bot wins; multiplayer = the team ahead wins, level = a draw (2-minute cap)
  function timeUpText(md, sc) {
    if (isSolo(md)) return { text: "MATCHA BOT WINS", party: false, end: true };
    if (sc && sc[0] !== sc[1]) { var w = sc[0] > sc[1] ? 0 : 1; return { text: TEAM[w] + " WINS", sub: score(sc, w), party: true, end: true, w: w }; }
    return { text: "DRAW", sub: sc ? score(sc, 0) : "", party: false, end: true };
  }
  // the match clock: plain seconds for a 60 s match (as approved), m:ss for a longer one (the server's `secs`)
  function clockText(tlMs, secs) {
    var s = Math.max(0, Math.ceil(tlMs / 1000));
    return secs > 60 ? Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60) : String(s);
  }
  // BOT label: the snapshot's `bt` bitmask wins (bit team*size+slot; it also marks a bot holding a dropped player's seat), else start's bots
  function isBot(i, size, bt, bots) {
    if (typeof bt === "number") return (bt & (1 << i)) !== 0;
    var team = i < size ? 0 : 1, slot = i % size;
    return !!(bots && bots[team] && bots[team][slot]);
  }
  // what a snapshot means for the featured match: "add" to it, "new" = another match, "skip" = a leftover frame of a finished one.
  // The server holds the featured match until it ends (review #7), so after `end` only a clearly fresh match (a full clock or another
  // team size) replaces it; the finish (cheer + 3 s hold) is never cut short by the last frame of the match that just ended.
  function snapKind(F, last, m) {
    var n = m && m.p ? m.p.length : 0;
    if (!F) return "new";
    var other = !!(last && last.p.length !== n), fresh = !!(last ? m.tl > last.tl + 1500 : false) || (m.st === 0 && m.tl >= 59000);
    if (F.endAt) return other || fresh ? "new" : "skip";
    return other || (last && m.tl > last.tl + 1500) ? "new" : "add";   // we missed its end: the clock went back up
  }
  // a `start` for the match already on screen (re-sent after a reconnect) keeps it: same buffer, no flash of the demo, no stale cheer
  function sameMatch(F, m) { return !!(F && m && m.id != null && F.id === m.id && !F.endAt); }
  // the team whose score went up between two drawn frames (-1 = none)
  function scorer(prev, cur) {
    if (!prev || !cur) return -1;
    if ((cur[0] || 0) > (prev[0] || 0)) return 0;
    if ((cur[1] || 0) > (prev[1] || 0)) return 1;
    return -1;
  }
  // at most one big flash every 1.6 s (no strobing)
  function gapOk(now, last, ms) { return !(last > 0) || now - last >= ms; }
  function flashOk(now, last) { return gapOk(now, last, 1600); }
  // slow motion on a goal: the drawing clock runs at 0.3× while the next buffered frame holds a goal, then catches up at 2.5×
  // (the match is paused after a goal, so the catch-up is never seen); far behind or the first frame = jump to the target
  function playClock(pt, target, dt, goalT) {
    if (pt == null || !(pt > target - 1500) || pt > target) return target;
    if (goalT != null && pt < goalT && target - pt < 700) return Math.min(goalT, target, pt + dt * 0.3);
    return Math.min(target, pt + dt * 2.5);
  }
  // arrival time of the first buffered frame after `pt` (within 400 ms) whose score is higher than the one on screen
  function goalAhead(buf, pt, sc) {
    if (!sc || pt == null) return null;
    var drawn = (sc[0] || 0) + (sc[1] || 0);
    for (var i = 0; i < buf.length; i++) {
      var e = buf[i]; if (e.t <= pt) continue; if (e.t - pt > 400) return null;
      if (e.s.sc && (e.s.sc[0] || 0) + (e.s.sc[1] || 0) > drawn) return e.t;
    }
    return null;
  }
  // the LED board (§16): "SCAN TO PLAY", "WIN A MATCH", and "WIN A FREE DRINK" only while the heartbeat's prizes list is non-empty;
  // paused → "GOTCHA MATCHA ⚽ BACK SOON". [words, colour (g gold / w white / m green), hand-drawn font]
  function ledPhrases(closed, prizes) {
    if (closed) return [["GOTCHA MATCHA", "m", 1], ["BACK SOON", "g"]];
    var p = [["SCAN TO PLAY", "g"], ["WIN A MATCH", "w"]];
    if (prizes && prizes.length) p.push(["WIN A FREE DRINK", "g"]);
    return p;
  }
  function ledPage(t, n) { return n > 0 ? Math.floor(t / 3) % n : 0; }   // reduced motion: a new phrase every 3 s
  var GAME_URL = "https://gotchamatcha2025.github.io/shootout/";   // the SCAN TO PLAY QR = the printed banner's address
  /* crowd sounds (owner yes 13 Nov ~04:50; ~05:10 "replace the clap, use the full viking row in game"; ~05:15 "only use this" = the full
     row only, no last-15-s speed-up, no steady drum; preview v8): the timings, s from 0.
     A stroke = two deep hits (drum + the crowd's low "HU!") a pair apart, then the long "HOOOH" as they pull. */
  var ROW_FULL = [7.0, 6.6, 5.1, 3.6, 2.6, 1.75, 1.65, 1.6, 1.5, 1.55, 1.4, 1.2, 1.0, 1.05, 0.7];   // gaps measured on the owner's clip; the last = to the roar
  function rowPair(g) { return Math.min(0.41, Math.max(0.28, 0.28 + (g - 1) * 0.18)); }   // the two hits tighten as the row speeds up
  function stroke(at, i, g) { var pair = rowPair(g); return { at: Math.round(at * 1000) / 1000, k: "stroke", v: Math.min(1, 0.7 + i * 0.025), pair: pair, voice: Math.min(1.3, g - pair - 0.35) }; }
  // a whole row from the first stroke to the roar; len = when the roar comes
  function rowPlan(gaps) {
    var ev = [], t = 0;
    for (var i = 0; i < gaps.length; i++) { ev.push(stroke(t, i, gaps[i])); t += gaps[i]; }
    ev.push({ at: Math.round(t * 1000) / 1000, k: "roar", v: 1 });
    return { ev: ev, len: Math.round(t * 1000) / 1000 };
  }
  // in a match the row loops: the next one starts ~2 s after the roar
  function nextRowAt(start, len) { return start + len + 2; }
  // the "HOOOH" is made once in a few lengths: the longest that fits the time a stroke leaves (0 = none)
  var HOOH = [0.3, 0.5, 0.8, 1.05, 1.3];
  function hoohPick(d) { var best = 0; for (var i = 0; i < HOOH.length; i++) if (HOOH[i] <= d + 1e-9) best = HOOH[i]; return d > 0.25 ? best : 0; }
  // the idle Viking row: first ~8 s after Sound on, then once every 3 minutes (from the last start)
  function idleDue(now, last, soundAt) { return last > 0 ? now - last >= 180000 : now - soundAt >= 8000; }
  // the match background (the Viking row) runs in the countdown and in play; a goal, the end or time up pauses it
  function bgWanted(live, st) { return !!live && (st === 0 || st === 1); }
  // old TVs: never more than `cap` sound sources at once (ends = when each running source stops, audio clock)
  function voicesFit(ends, now, n, cap) { var a = 0; for (var i = 0; i < ends.length; i++) if (ends[i] > now) a++; return a + n <= cap; }
  // "GOAL! TEAM MATCHA" → the hand-drawn "GOAL!" + the line under it
  function splitCheer(t) { var i = t.indexOf("! "); return i > 0 ? { big: t.slice(0, i + 1), sub: t.slice(i + 2) } : { big: t, sub: "" }; }
  return { TEAM: TEAM, BASES: BASES, flashOk: flashOk, gapOk: gapOk, ledPhrases: ledPhrases, ledPage: ledPage, GAME_URL: GAME_URL, playClock: playClock, goalAhead: goalAhead, splitCheer: splitCheer, clockText: clockText, ROW_FULL: ROW_FULL, rowPair: rowPair, rowPlan: rowPlan, nextRowAt: nextRowAt, HOOH: HOOH, hoohPick: hoohPick, idleDue: idleDue, bgWanted: bgWanted, voicesFit: voicesFit, pickMode: pickMode, wsUrl: wsUrl, pickKey: pickKey, urlKey: urlKey, stripKey: stripKey, backoff: backoff, isSolo: isSolo,
    sample: sample, goalText: goalText, isBot: isBot, sameMatch: sameMatch, snapKind: snapKind, timeUpText: timeUpText, scorer: scorer };
})();
if (typeof module === "object" && module.exports) module.exports = WallCore;

if (typeof window !== "undefined" && window.document) (function () {
  var WC = WallCore, $ = function (s) { return document.querySelector(s); };
  var DELAY = 100, HOLD = 3200, CW = 1920, CH = 1080;
  var REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var COL = [{ f: "#6fbf4a", d: "#3d7a26" }, { f: "#ffd23f", d: "#b88a00" }];
  var DEMO_SIZE = 2;   // the bot demo: 2 v 2, plain discs

  var mode, base, qs = "";
  try { qs = location.search; } catch (e) { qs = ""; }
  var asked = (qs.match(/[?&]api=([a-z]+)/) || [])[1], saved = null;
  try { saved = sessionStorage.getItem("s3v3:api"); } catch (e) { saved = null; }
  mode = WC.pickMode(asked, saved, location.hostname, location.protocol);
  try { if (asked && WC.BASES[asked]) sessionStorage.setItem("s3v3:api", asked); } catch (e) { /* no session storage */ }
  base = WC.BASES[mode];
  if (mode === "fake") { var fs = document.createElement("script"); fs.src = "fake.js?v=6"; document.head.appendChild(fs); }
  // wall key: kept per server on this TV, so a reload without ?k= still connects; taken out of the address bar at once
  var KEYK = "s3v3:" + (mode === "live" ? "" : mode === "staging" ? "stg:" : mode + ":") + "wallkey", kept = null, fromUrl = WC.urlKey(qs), wallKey;
  try { kept = localStorage.getItem(KEYK); } catch (e) { kept = null; }
  wallKey = WC.pickKey(fromUrl, kept);
  if (fromUrl && wallKey === fromUrl) { try { localStorage.setItem(KEYK, wallKey); } catch (e) { /* memory only */ } }
  if (fromUrl != null) { try { history.replaceState(null, "", location.pathname + WC.stripKey(qs) + location.hash); } catch (e) { /* old browser: the key stays in the address */ } }

  /* ---------- state ---------- */
  var S = { online: false, closed: false, F: null, demo: null, demoAcc: 0, prevSc: null, prevSt: -1, cel: null, trail: [], soundOn: false,
    prizes: [], ooohAt: 0, huhs: [], aud: null, lite: false, pt: null, hypeUntil: 0, hypeTeam: -1, goalFlash: 0, white: false, storm: 0, soft: 0, flashAt: 0 };
  if (mode === "fake") window.__wall = S;   // tests read the state on the fake feed only
  function newFeatured(m) {
    return { id: m && m.id || null, md: m && m.md != null ? m.md : null, need: m && typeof m.need === "number" ? m.need : null, secs: m && typeof m.secs === "number" ? m.secs : null, bots: m && m.bots || null,
      human: humanTeam(m), buf: [], lastAt: 0, endAt: 0, done: false };
  }
  // the team with people on it (single player is always Team Matcha; the bots array says it when the server sends it)
  function humanTeam(m) {
    if (!m || !m.bots) return 0;
    for (var t = 0; t < 2; t++) for (var s = 0; s < m.bots[t].length; s++) if (!m.bots[t][s]) return t;
    return 0;
  }

  /* ---------- the socket: reconnect forever, silent ---------- */
  var ws = null, tries = 0, lastMsg = 0, timer = 0;
  function connect() {
    clearTimeout(timer);
    var Sock = mode === "fake" ? window.FakeSocket : window.WebSocket;
    if (!Sock) { if (mode === "fake") timer = setTimeout(connect, 300); return; }   // fake.js still loading; no WebSocket at all = demo only
    try { ws = new Sock(WC.wsUrl(base, wallKey)); } catch (e) { ws = null; retry(); return; }
    var me = ws;
    ws.onopen = function () { if (me !== ws) return; lastMsg = Date.now(); };
    ws.onmessage = function (e) {
      if (me !== ws) return;
      lastMsg = Date.now(); tries = 0; S.online = true;
      var m = null; try { m = JSON.parse(e.data); } catch (x) { return; }
      try { onMsg(m); } catch (x) { /* one odd message must never stop the wall */ }
    };
    ws.onclose = ws.onerror = function () { if (me !== ws) return; ws = null; S.online = false; retry(); };
  }
  function retry() { clearTimeout(timer); timer = setTimeout(connect, WC.backoff(tries++, Math.random())); }
  // a socket that went quiet (the server talks every 2 s) is dead even if the TV browser didn't notice
  setInterval(function () {
    if (ws && Date.now() - lastMsg > 8000) { var w = ws; ws = null; S.online = false; try { w.close(); } catch (e) { /* gone */ } retry(); }
  }, 2000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !ws) { tries = 0; connect(); } });

  function onMsg(m) {
    var now = performance.now();
    // the heartbeat: paused or not, and `prizes` only while a win can really give a voucher (§15); GET / is the closed switch's main source
    if (m.t === "wall") { if (m.closed != null) S.closed = !!m.closed; S.prizes = Array.isArray(m.prizes) ? m.prizes : []; return; }
    if (m.t === "start") {
      // the server holds the featured match until it ends (review #7); the same match again only refreshes its seats
      if (WC.sameMatch(S.F, m)) { if (m.bots) S.F.bots = m.bots; if (m.md != null) S.F.md = m.md; if (typeof m.need === "number") S.F.need = m.need; if (typeof m.secs === "number") S.F.secs = m.secs; return; }
      S.F = newFeatured(m); S.F.lastAt = now; S.prevSc = null; S.prevSt = -1; S.cel = null; S.trail = []; return;
    }
    if (m.t === "s") {
      var F = S.F, last = F && F.buf.length ? F.buf[F.buf.length - 1].s : null, kind = WC.snapKind(F, last, m);
      if (kind === "skip") return;
      if (kind === "new") { S.F = F = newFeatured({ md: m.md }); S.prevSc = null; S.prevSt = -1; S.cel = null; S.trail = []; }
      if (F.md == null && m.md != null) F.md = m.md;
      F.buf.push({ t: now, s: m }); F.lastAt = now;
      while (F.buf.length > 40) F.buf.shift();
      return;
    }
    if (m.t === "ev") { setTimeout(function () { sound(m); }, DELAY); return; }   // heard when the drawn ball gets there
    if (m.t === "end" && S.F) { S.F.endAt = now; S.F.endW = m.w; return; }       // the wall never reads or shows a code
  }

  /* ---------- closed switch (§9.5): GET / every 30 s; failures change nothing ---------- */
  function health() {
    if (mode === "fake") { S.closed = /[?&]fake=closed/.test(qs); return; }
    if (!window.fetch) return;   // an old TV browser without fetch keeps the demo (review #12)
    var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
    fetch(base + "/?v=1", { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); }).then(function (j) { if (j && typeof j === "object") S.closed = j.closed === true; })
      .catch(function () { /* no answer: keep what we knew */ }).then(function () { clearTimeout(t); });
  }

  /* ---------- sound: the penalty build's recipes (made in the browser, no files), off until staff press Sound on ---------- */
  var A = { ctx: null, master: null, nb: null, bedN: null };
  function audioStart() {   // inside the Sound on tap (browser rule)
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!A.ctx) {
      try { A.ctx = new AC(); } catch (e) { A.ctx = null; return; }
      var c = A.ctx, comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
      A.master = c.createGain(); A.master.gain.value = 0.9; A.master.connect(comp); comp.connect(c.destination);
      var len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.nb = buf;
    }
    if (A.ctx.state === "suspended" && A.ctx.resume) A.ctx.resume();
  }
  function env(gn, t, a, peak, hold, rel) {
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    gn.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  function tone(f, t, dur, o) {
    o = o || {}; var c = A.ctx, osc = c.createOscillator(), gn = c.createGain(), a = o.a || 0.005, hold = o.hold || 0, node = osc;
    osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    if (o.lp) { var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.lp; osc.connect(lp); node = lp; }
    env(gn, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold)); node.connect(gn); gn.connect(A.master); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(t, dur, o) {
    o = o || {}; var c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    s.buffer = A.nb; s.loop = true; f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    f.Q.value = o.q || 1; env(gn, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    s.connect(f); f.connect(gn); gn.connect(A.master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return gn;
  }
  var SFX = {
    whistle: function (t) { [[0, 0.16], [0.24, 0.46]].forEach(function (b) { tone(2950, t + b[0], b[1], { gain: 0.13, a: 0.012 }); noise(t + b[0], b[1], { type: "highpass", f: 3500, gain: 0.03 }); }); },
    kick: function (t, p) { p = Math.max(0.25, Math.min(1, p || 0.5)); tone(150, t, 0.22, { f2: 42, gain: 0.95 * p }); noise(t, 0.05, { type: "highpass", f: 1800, gain: 0.3 * p }); },
    horn: function (t) { [233, 294, 349].forEach(function (f) { tone(f, t, 0.95, { type: "sawtooth", lp: 1900, a: 0.03, hold: 0.62, gain: 0.11, f2: f * 0.94, bend: 0.95 }); }); },
    roar: function (t, big) {
      var len = big ? 3.6 : 2.6, lvl = big ? 0.62 : 0.5;
      [[420, 0.7], [900, 0.95], [1700, 0.6], [3000, 0.32]].forEach(function (b, i) {
        var gn = noise(t, len, { type: "bandpass", f: b[0] * 0.8, f2: b[0] * 1.15, bend: 0.7, q: 0.9, a: 0.16, hold: len * 0.38, gain: lvl * b[1] * 0.55 });
        var lfo = A.ctx.createOscillator(), lg = A.ctx.createGain(); lfo.frequency.value = 4 + i * 2.3 + Math.random() * 3; lg.gain.value = lvl * b[1] * 0.16;
        lfo.connect(lg); lg.connect(gn.gain); lfo.start(t); lfo.stop(t + len + 0.1);
      });
    },
    fanfare: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { var d = i === 3 ? 0.9 : 0.16; tone(f, t + i * 0.12, d, { type: "triangle", gain: 0.13, hold: i === 3 ? 0.5 : 0 }); }); },
    clang: function (t) { [[523, 1.1, 0.34], [1308, 0.8, 0.24], [2192, 0.55, 0.17]].forEach(function (b) { tone(b[0], t, b[1], { a: 0.002, gain: b[2] }); }); },
    knock: function (t) { tone(320, t, 0.06, { type: "square", gain: 0.05 }); },
    pop: function (t) { noise(t, 0.28, { type: "highpass", f: 1100, gain: 0.32 }); },
    groan: function (t) { noise(t, 1.2, { f: 560, f2: 290, q: 3, a: 0.1, hold: 0.25, gain: 0.4 }); }
  };
  var SFXV = { whistle: [4, 0.75], kick: [2, 0.25], horn: [3, 1], roar: [8, 3.6], fanfare: [8, 1.4], clang: [3, 1.1], knock: [1, 0.1], pop: [1, 0.3], groan: [1, 1.2] };   // sources, seconds
  function play(name, arg) {
    if (!S.soundOn || !A.ctx || A.ctx.state !== "running") return;
    var n = SFXV[name] || [1, 1]; if (CR.cm && !room(n[0], A.ctx.currentTime + n[1])) return;   // over the 16-source budget: skip it
    try { SFX[name](A.ctx.currentTime + 0.01, arg); } catch (e) { /* a sound never breaks the wall */ }
  }
  // the stadium murmur under everything while Sound is on: one looping source (old-TV budget)
  function bed(on) {
    try {
      if (!on || !A.ctx) { if (A.bedN) { var n = A.bedN; A.bedN = null; n.g.gain.setTargetAtTime(0.0001, A.ctx.currentTime, 0.3); setTimeout(function () { try { n.s.stop(); } catch (e) { /* stopped */ } }, 1500); } return; }
      if (A.bedN) return;
      var c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = A.nb; s.loop = true; f.type = "lowpass"; f.frequency.value = 650; g.gain.value = 0.0001; g.gain.setTargetAtTime(0.06, c.currentTime, 0.6);
      s.connect(f); f.connect(g); g.connect(A.cm || A.master); s.start(); A.bedN = { s: s, g: g };
    } catch (e) { /* no murmur on this browser */ }
  }
  function sound(m) {
    if (m.k === "hit") play("kick", m.p);
    else if (m.k === "post") {   // a real near miss: "Ooooh", at most once per 15 s here (bots hit the post a lot: 9 in one match)
      play("clang");
      if (m.near && S.aud && S.aud.st === 1 && A.ctx && WC.gapOk(performance.now(), S.ooohAt, 15000) && pb("oooh", A.ctx.currentTime, 1, CR.fg)) S.ooohAt = performance.now();
    }
    else if (m.k === "wall") play("knock");
    else if (m.k === "go" || m.k === "kickoff") play("whistle");
  }

  /* ---------- crowd sounds (owner yes 13 Nov ~04:50; ~05:10 the Viking row replaces the claps; preview v8): the preview's recipes,
     made ONCE after Sound on with an OfflineAudioContext and then each played as a single source (a drum hit, a 9-voice "HU!" or a
     20-voice "HOOOH" = 1 voice), through the owner's reverb (2.6 s), slapback echo (0.19 s) and deep drum echo (0.3 s).
     Old TVs: at most 16 sources at once (12 in lite), no reverb in lite. ---------- */
  var CR = { bank: {}, ready: false, making: false, verb: null, echoIn: null, drumEcho: null, cm: null, fg: null, ends: [], n: {}, skip: 0, peak: 0 };
  if (mode === "fake") window.__crowd = CR;   // tests read the crowd sounds on the fake feed only
  var ROUTE = { drum: "dwr", hu: "dwe", hooh: "dw", hurrah: "dw", wooo: "dw", oooh: "dw", roar: "dw" };   // d dry, w reverb, e slapback, r drum echo
  var VOWEL = { u: [350, 900, 2400], o: [480, 820, 2500], a: [760, 1180, 2550] };
  function mkNoise(c, d) { var n = Math.max(1, Math.round(c.sampleRate * d)), b = c.createBuffer(1, n, c.sampleRate), a = b.getChannelData(0); for (var i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; var s = c.createBufferSource(); s.buffer = b; return s; }
  function ramp(g, t, peak, at, end) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + end); }
  var RECIPE = {
    drum: function (c, o, t) {   // the row's deep drum (owner ~05:09 "much lower in tune, deep drum with echo"): 62 → 38 Hz ringing 1.2 s
      var x = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(); x.type = "sine"; x.frequency.setValueAtTime(62, t); x.frequency.exponentialRampToValueAtTime(38, t + 0.6);
      lp.type = "lowpass"; lp.frequency.value = 200; ramp(g, t, 1, 0.012, 1.2); x.connect(lp); lp.connect(g); g.connect(o); x.start(t); x.stop(t + 1.25);
      var x2 = c.createOscillator(), g2 = c.createGain(); x2.type = "sine"; x2.frequency.setValueAtTime(124, t); x2.frequency.exponentialRampToValueAtTime(76, t + 0.25);   // a short higher partial for small speakers
      ramp(g2, t, 0.3, 0.008, 0.28); x2.connect(g2); g2.connect(o); x2.start(t); x2.stop(t + 0.3);
      var n = mkNoise(c, 0.09), nf = c.createBiquadFilter(), ng = c.createGain(); nf.type = "lowpass"; nf.frequency.value = 320; ng.gain.setValueAtTime(0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(nf); nf.connect(ng); ng.connect(o); n.start(t);   // the soft beater on a big skin
    },
    hu: function (c, o, t) {   // the crowd's low "HU!" (~100 Hz) through two vowel filters
      var bus = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain(); ramp(bus, t, 0.34, 0.02, 0.3);
      f1.type = "bandpass"; f1.frequency.value = 350; f1.Q.value = 3; f2.type = "bandpass"; f2.frequency.value = 900; f2.Q.value = 4;
      bus.connect(f1); f1.connect(mix); bus.connect(f2); f2.connect(mix); mix.connect(o);
      for (var k = 0; k < 9; k++) { var s0 = t + Math.random() * 0.03, x = c.createOscillator(), p = 90 + Math.random() * 35; x.type = "sawtooth";
        x.frequency.setValueAtTime(p * 1.05, s0); x.frequency.exponentialRampToValueAtTime(p * 0.9, s0 + 0.28); x.connect(bus); x.start(s0); x.stop(s0 + 0.32); }
    },
    roar: function (c, o, t) { var n = mkNoise(c, 3), f = c.createBiquadFilter(), g = c.createGain(); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.5; ramp(g, t, 0.5, 0.4, 3); n.connect(f); f.connect(g); g.connect(o); n.start(t); }
  };
  // ~24 men and women: buzzing voices with their own pitch, wobble and start, through gliding vowel filters (hu → RAH)
  function voices(plan, v, count) {
    return function (c, o, t0) {
      var bus = c.createGain(); bus.gain.value = v;
      var f = [0, 1, 2].map(function (i) { var b = c.createBiquadFilter(); b.type = "bandpass"; b.Q.value = [6, 9, 12][i]; var g = c.createGain(); g.gain.value = [1, 0.7, 0.35][i]; b.connect(g); g.connect(o); return b; });
      plan.forEach(function (st) { var F = VOWEL[st.vowel]; f.forEach(function (b, i) { b.frequency.setTargetAtTime(F[i], t0 + st.at, 0.03); }); });
      var last = plan[plan.length - 1], end = t0 + last.at + last.dur;
      for (var k = 0; k < count; k++) {
        var p = k % 3 === 0 ? 200 + Math.random() * 90 : 105 + Math.random() * 60, jit = Math.random() * 0.09, x = c.createOscillator(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
        x.type = "sawtooth"; x.frequency.setValueAtTime(p * 0.92, t0 + jit);
        plan.forEach(function (st) { if (st.pitch) x.frequency.linearRampToValueAtTime(p * st.pitch, t0 + st.at + jit + st.dur * 0.5); });
        vib.frequency.value = 4 + Math.random() * 3; vg.gain.value = p * 0.025; vib.connect(vg); vg.connect(x.frequency);
        g.gain.setValueAtTime(0.0001, t0 + jit); g.gain.exponentialRampToValueAtTime(0.06, t0 + jit + 0.06); g.gain.setValueAtTime(0.06, end - 0.15 + jit * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.25 + jit);
        x.connect(g); f.forEach(function (b) { g.connect(b); }); x.start(t0 + jit); vib.start(t0 + jit); x.stop(end + 0.3 + jit); vib.stop(end + 0.3 + jit);
      }
      var n = mkNoise(c, end - t0 + 0.3), ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.18 * v, t0 + 0.08); ng.gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
      n.connect(ng); f.forEach(function (b) { ng.connect(b); }); n.start(t0);
    };
  }
  RECIPE.hurrah = voices([{ at: 0, vowel: "u", dur: 0.18, pitch: 1 }, { at: 0.2, vowel: "a", dur: 0.75, pitch: 1.25 }], 1, 24);
  RECIPE.wooo = voices([{ at: 0, vowel: "u", dur: 0.3, pitch: 1.1 }, { at: 0.3, vowel: "o", dur: 1.5, pitch: 1.45 }], 1, 28);
  RECIPE.oooh = voices([{ at: 0, vowel: "o", dur: 0.4, pitch: 1.15 }, { at: 0.4, vowel: "u", dur: 0.7, pitch: 0.8 }], 0.9, 22);
  // the rowers' long "HOOOH" (20 voices, o → u), one per length in WC.HOOH; played at 0.8 × the stroke's strength
  function hooh(d) { return voices([{ at: 0, vowel: "o", dur: d * 0.45, pitch: 1.25 }, { at: d * 0.45, vowel: "u", dur: d * 0.55, pitch: 1.4 }], 1, 20); }
  var BANK = [["drum", RECIPE.drum, 1.3], ["hu0", RECIPE.hu, 0.4], ["hu1", RECIPE.hu, 0.4], ["roar", RECIPE.roar, 3.1], ["wooo", RECIPE.wooo, 2.3], ["hurrah", RECIPE.hurrah, 1.4], ["oooh", RECIPE.oooh, 1.6]];
  WC.HOOH.forEach(function (d) { BANK.push(["hooh" + Math.round(d * 100), hooh(d), d + 0.7]); });
  function bake(sec, recipe) {   // (not "render": that name draws the frame)
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC || !A.ctx) return Promise.resolve(null);
    var oc; try { oc = new OAC(1, Math.ceil(sec * A.ctx.sampleRate), A.ctx.sampleRate); recipe(oc, oc.destination, 0.005); } catch (e) { return Promise.resolve(null); }
    return new Promise(function (ok) {
      oc.oncomplete = function (e) { ok(e.renderedBuffer); };
      try { var p = oc.startRendering(); if (p && p.then) p.then(ok, function () { ok(null); }); } catch (e) { ok(null); }
    });
  }
  function makeBank() {   // one sound at a time, so the TV never stalls
    if (CR.making || CR.ready) return; CR.making = true;
    var i = 0;
    (function next() {
      if (i >= BANK.length) { CR.making = false; CR.ready = true; return; }
      var b = BANK[i++];
      bake(b[2], b[1]).then(function (buf) { if (buf) CR.bank[b[0]] = buf; setTimeout(next, 30); });
    })();
  }
  function crowdBuses(c) {   // the owner's reverb and slapback echo (preview v6); the crowd master sits under the wall's master
    CR.cm = c.createGain(); CR.cm.gain.value = 0.7; CR.cm.connect(A.master); A.cm = CR.cm;
    if (!S.lite) {
      var len = Math.round(c.sampleRate * 2.6), ir = c.createBuffer(1, len, c.sampleRate), d = ir.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      CR.verb = c.createConvolver(); CR.verb.buffer = ir; var vg = c.createGain(); vg.gain.value = 0.42; CR.verb.connect(vg); vg.connect(CR.cm);
    }
    CR.echoIn = c.createGain(); var dl = c.createDelay(1), fb = c.createGain(), lp = c.createBiquadFilter(), eg = c.createGain();
    dl.delayTime.value = 0.19; fb.gain.value = 0.38; lp.type = "lowpass"; lp.frequency.value = 1400; eg.gain.value = 0.55;
    CR.echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eg); eg.connect(CR.cm);
    // the deep drum echo (owner ~05:09): the drum rolls back from the far stands 0.3 s later, dark, 3–4 times, fading
    CR.drumEcho = c.createGain(); var dd = c.createDelay(1), dfb = c.createGain(), dlp = c.createBiquadFilter(), dg = c.createGain();
    dd.delayTime.value = 0.3; dfb.gain.value = 0.45; dlp.type = "lowpass"; dlp.frequency.value = 380; dg.gain.value = 0.75;
    CR.drumEcho.connect(dd); dd.connect(dlp); dlp.connect(dfb); dfb.connect(dd); dlp.connect(dg); dg.connect(CR.cm); if (CR.verb) dg.connect(CR.verb);
    CR.fg = mkBus(1);
  }
  // a bus = dry + reverb send + echo send at one level, so a fade silences its tails too
  function mkBus(level) {
    var c = A.ctx, b = { dry: c.createGain(), wet: CR.verb ? c.createGain() : null, echo: c.createGain(), decho: c.createGain() };
    b.dry.gain.value = level; b.dry.connect(CR.cm); if (b.wet) { b.wet.gain.value = level; b.wet.connect(CR.verb); }
    b.echo.gain.value = level; b.echo.connect(CR.echoIn); b.decho.gain.value = level; b.decho.connect(CR.drumEcho);
    return b;
  }
  function fadeBus(b, sec) {
    if (!b || !A.ctx) return; var t = A.ctx.currentTime;
    [b.dry, b.wet, b.echo, b.decho].forEach(function (g) { if (g) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + sec); } });
    setTimeout(function () { [b.dry, b.wet, b.echo, b.decho].forEach(function (g) { try { if (g) g.disconnect(); } catch (e) { /* gone */ } }); }, sec * 1000 + 3000);
  }
  function room(n, end) {   // the 16-source budget (the murmur counts as one)
    var now = A.ctx.currentTime; CR.ends = CR.ends.filter(function (e) { return e > now; });
    if (!WC.voicesFit(CR.ends, now, n + (A.bedN ? 1 : 0), S.lite ? 12 : 16)) { CR.skip++; return false; }
    for (var i = 0; i < n; i++) CR.ends.push(end);
    CR.peak = Math.max(CR.peak, CR.ends.length + (A.bedN ? 1 : 0)); return true;
  }
  function pb(name, t, v, bus) {   // one pre-made sound = one source
    var buf = CR.bank[name]; if (!buf || !bus || !S.soundOn || !A.ctx) return false;
    t = Math.max(t, A.ctx.currentTime);
    if (!room(1, t + buf.duration)) return false;
    try {
      var kind = name.replace(/\d+$/, ""), s = A.ctx.createBufferSource(), g = A.ctx.createGain(), r = ROUTE[kind];
      s.buffer = buf; g.gain.value = v; s.connect(g); g.connect(bus.dry); if (bus.wet && r.indexOf("w") >= 0) g.connect(bus.wet);
      if (r.indexOf("e") >= 0) g.connect(bus.echo); if (r.indexOf("r") >= 0) g.connect(bus.decho);
      s.start(t); CR.n[kind] = (CR.n[kind] || 0) + 1; return true;
    } catch (e) { return false; }
  }
  // one stroke = drum + "HU!", the pair again (a touch stronger), then the "HOOOH" as they pull (preview v8 rowStroke)
  function fire(e, t, bus, visual) {
    if (e.k === "stroke") {
      var v2 = Math.min(1, e.v * 1.1), d = WC.hoohPick(e.voice);
      pb("drum", t, e.v, bus); pb("hu" + ((Math.random() * 2) | 0), t, e.v, bus);
      pb("drum", t + e.pair, v2, bus); pb("hu" + ((Math.random() * 2) | 0), t + e.pair, v2, bus);
      if (d) pb("hooh" + Math.round(d * 100), t + e.pair + 0.13, 0.8 * e.v, bus);
      if (visual) S.huhs.push(performance.now() + (t - A.ctx.currentTime) * 1000);   // the big HUH! on screen with each stroke
    } else if (e.k === "roar") pb("roar", t, e.v, bus);
    else if (e.k === "wooo") { pb("wooo", t, 1, bus); pb("roar", t, 1, bus); }
    else if (e.k === "hurrah") pb("hurrah", t, 1, bus);
  }
  function flush(q, bus, until, now, visual) { while (q.length && q[0].t < until) { var e = q.shift(); if (e.t >= now - 0.05) fire(e, Math.max(e.t, now), bus, visual); } }
  // the live match: the full Viking row from each kick-off, ~2 s after its roar the row again; a goal stops it and the next kick-off
  // starts it from the top. Each stroke's sound is made only as it comes up (0.3 s ahead).
  var BG = null, IDLE = { bus: null, q: [], last: 0, soundAt: 0 };
  function bgStart() { BG = { bus: mkBus(0.55), q: [], rowAt: A.ctx.currentTime + 0.1 }; }
  function bgStop() { if (!BG) return; fadeBus(BG.bus, 0.15); BG = null; }
  function idleStop() { if (!IDLE.bus) return; fadeBus(IDLE.bus, 0.4); IDLE.bus = null; IDLE.q = []; }
  function crowdTick() {
    if (!S.soundOn || !A.ctx || A.ctx.state !== "running" || !CR.cm) return;
    var now = A.ctx.currentTime, until = now + 0.3, au = S.aud || {};
    if (WC.bgWanted(au.live, au.st)) { if (!BG && CR.ready) bgStart(); } else bgStop();
    if (BG) {
      if (!BG.q.length && now >= BG.rowAt - 0.4) {   // the next full row
        var row = WC.rowPlan(WC.ROW_FULL), at = Math.max(BG.rowAt, now + 0.1);
        row.ev.forEach(function (e) { e.t = at + e.at; BG.q.push(e); }); BG.rowAt = WC.nextRowAt(at, row.len);
      }
      flush(BG.q, BG.bus, until, now, false);
    }
    if (au.live) { idleStop(); return; }
    var pn = performance.now();   // idle: the full Viking row now and then, to pull people in; it ends in the roar + "Hurrah!"
    if (!IDLE.bus && CR.ready && WC.idleDue(pn, IDLE.last, IDLE.soundAt)) {
      var plan = WC.rowPlan(WC.ROW_FULL), t0 = now + 0.1;
      IDLE.last = pn; IDLE.bus = mkBus(1);
      IDLE.q = plan.ev.filter(function (e) { return e.k === "stroke"; }).map(function (e) { e.t = t0 + e.at; return e; });
      IDLE.q.push({ t: t0 + plan.len, k: "wooo", v: 1 }, { t: t0 + plan.len + 1.6, k: "hurrah", v: 1 });
    }
    if (IDLE.bus) { flush(IDLE.q, IDLE.bus, until, now, true); if (!IDLE.q.length) { var done = IDLE.bus; IDLE.bus = null; setTimeout(function () { fadeBus(done, 1); }, 4000); } }
  }
  function crowdOn(on) {
    if (!on) { bgStop(); idleStop(); S.huhs = []; return; }
    if (!CR.cm && A.ctx) { try { crowdBuses(A.ctx); } catch (e) { return; } }
    IDLE.soundAt = performance.now(); makeBank();
    if (!CR.tick) CR.tick = setInterval(function () { try { crowdTick(); } catch (e) { /* a sound never breaks the wall */ } }, 100);
  }

  /* ---------- screen-space effects (logical 1920×1080): confetti, fireworks ---------- */
  var conf = [], rockets = [], sparks = [];
  function burst(cols, n) {
    if (REDUCED) return;
    if (S.lite) n = Math.round(n / 2);
    for (var i = 0; i < n; i++) conf.push({ x: OX + (Math.random() - 0.5) * CW * 0.3, y: OY - CH * 0.08, vx: (Math.random() - 0.5) * 1800, vy: -Math.random() * 1500 - 300,
      r: Math.random() * 14 + 8, c: cols[i % cols.length], a: Math.random() * 6, l: 1 });
  }
  function fireworks(n) {
    if (REDUCED || S.lite) return;
    var cols = ["#F5F0E5", "#8EE07A", "#F2B15C", "#ffd23f", "#ffffff"];
    for (var i = 0; i < n; i++) rockets.push({ x: OX + (Math.random() - 0.5) * SW * 0.8, y: CH * 0.2, ty: CH * (0.14 + Math.random() * 0.26), delay: i * 0.35 + Math.random() * 0.2, col: cols[i % 5] });
  }
  function drawFx(g2, dt) {
    var i;
    for (i = conf.length - 1; i >= 0; i--) {
      var q = conf[i]; q.vy += 2200 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.a += dt * 8; q.l -= dt * 0.45;
      if (q.l <= 0 || q.y > CH + 40) { conf.splice(i, 1); continue; }
      g2.save(); g2.globalAlpha = Math.max(0, q.l); g2.translate(q.x, q.y); g2.rotate(q.a); g2.fillStyle = q.c; g2.fillRect(-q.r / 2, -q.r / 4, q.r, q.r / 2); g2.restore();
    }
    for (i = rockets.length - 1; i >= 0; i--) {
      var r = rockets[i];
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.y -= dt * CH * 0.9;
      if (r.y <= r.ty) {
        rockets.splice(i, 1); play("pop");
        for (var j = 0; j < 46; j++) { var an = j / 46 * 6.283, sp = (0.6 + Math.random() * 0.5) * CW * 0.16; sparks.push({ x: r.x, y: r.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 1.3 + Math.random() * 0.5, col: r.col }); }
        continue;
      }
      g2.globalAlpha = 1; g2.fillStyle = "#fff6dc"; g2.fillRect(r.x - 3, r.y, 6, 22);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i]; s.vy += 160 * dt; s.vx *= (1 - dt * 1.4); s.vy *= (1 - dt * 1.4); s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      g2.globalAlpha = Math.max(0, Math.min(1, s.life)); g2.fillStyle = s.col; g2.beginPath(); g2.arc(s.x, s.y, 5, 0, 6.283); g2.fill();
    }
    g2.globalAlpha = 1;
  }

  /* ---------- drawing: the rev 8 stadium (owner yes 12 Nov ~21:38) in a fixed 1920×1080 frame ---------- */
  var cv, g, k = 1, L = { key: "", back: null, front: null, box: null };
  var W = 60, H = 96, RP = 3.3, RB = 1.9, CREASE = 9, U = CH / 360;   // U: the mock-up's 360 px-high preview → this frame
  var LEDH = CH * 0.062;   // the rolling LED board across the top (owner 13 Nov ~05:15); everything else sits under it
  // projector rev 4 (owner yes ~05:56): the stadium fills the right, the score above it; the left column is one tall SCAN TO PLAY box
  var TOP = LEDH + CH * 0.125, BOT = CH * 0.025, SC = (CH - TOP - BOT) / (W + 24), SW = (H + 26) * SC, OX = CW - CH * 0.025 - SW / 2, OY = TOP + (CH - TOP - BOT) / 2;
  function fit() {
    var vw = window.innerWidth || CW, vh = window.innerHeight || CH, s = Math.min(vw / CW, vh / CH), w = Math.round(CW * s), h = Math.round(CH * s);
    cv.style.width = w + "px"; cv.style.height = h + "px"; cv.style.left = Math.round((vw - w) / 2) + "px"; cv.style.top = Math.round((vh - h) / 2) + "px";
    var bw = Math.min(CW, Math.round(w * (window.devicePixelRatio || 1)));   // never more pixels than 1920 wide: old TV chips
    if (cv.width !== bw) { cv.width = bw; cv.height = Math.round(bw * CH / CW); L.key = ""; }
    k = cv.width / CW;
    // the small status dot just under the LED board, and Sound on / Full screen under the QR, both placed from the picture's box
    var cl = Math.round((vw - w) / 2), ct = Math.round((vh - h) / 2), st = $("#status"), ctl = $("#ctl"), box = scanBox();
    if (st) { st.style.top = (ct + Math.round(LEDH * s) + 8) + "px"; st.style.right = (vw - cl - w + 12) + "px"; }
    if (ctl) { ctl.style.left = (cl + Math.round(box.cx * s)) + "px"; ctl.style.top = (ct + Math.round((box.qy + box.q + 6) * s)) + "px"; ctl.style.bottom = "auto"; }
  }
  function world(gg) { gg.setTransform(k * SC, 0, 0, k * SC, k * OX, k * OY); gg.rotate(Math.PI / 2); gg.translate(-W / 2, -H / 2); }   // Matcha (y=H) on the left
  // the fans round the pitch (world units, as the mock-up): bob, jump on goals, arms up; built once
  var FANS = [];
  (function () {
    var n = 0, x, y, col, row;
    var GREENS = ["#2e7d3a", "#3f9a4a", "#6fbf4a", "#9be27a", "#bdf29e"];   // rev 3 (owner yes ~05:56): every fan green (2 dark, 3 light)
    function add(fx, fy, team) { n++; var c = GREENS[(n * 7 + (Math.random() * 5 | 0)) % GREENS.length];
      FANS.push({ x: fx, y: fy, c: c, ph: Math.random() * 6.28, f: 3 + Math.random() * 3, r: 0.85 + Math.random() * 0.35, team: team }); }
    for (col = 0; col < 3; col++) for (y = -7; y <= H + 7; y += 2.5) { add(-2.6 - col * 2.4, y + (col % 2) * 1.2, 0); add(W + 2.6 + col * 2.4, y + (col % 2) * 1.2, 1); }
    for (row = 0; row < 2; row++) for (x = -6; x <= W + 6; x += 2.5) { add(x + (row % 2) * 1.2, -7.2 - row * 2.4, 1); add(x + (row % 2) * 1.2, H + 7.2 + row * 2.4, 0); }
  })();
  function canvasLike() { var c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; return c; }
  // what never moves, drawn once: back = sky, tower lamps; front = the stands and the pitch (+ goals: redrawn as they grow)
  function layers(gw) {
    var lite = S.lite || REDUCED, key = cv.width + ":" + Math.round(gw * 2) + ":" + (lite ? 1 : 0);
    if (key === L.key) return L;
    L.key = key; L.back = L.back && L.back.width === cv.width ? L.back : canvasLike(); L.front = L.front && L.front.width === cv.width ? L.front : canvasLike();
    var c = L.back.getContext("2d"), x, y, i, j;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    var bg = c.createLinearGradient(0, 0, 0, cv.height); bg.addColorStop(0, "#0b1d12"); bg.addColorStop(1, "#050b07"); c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    [CH * 0.06, CW - CH * 0.06].forEach(function (tx) {   // floodlight towers
      c.fillStyle = "#fffbe6"; c.shadowColor = "#fffbe6"; c.shadowBlur = 14 * U * k;
      for (i = 0; i < 3; i++) for (j = 0; j < 2; j++) c.fillRect(tx - 8 * U + i * 6 * U, CH * 0.03 + LEDH + j * 6 * U, 3 * U, 3 * U);
      c.shadowBlur = 0;
    });
    var f = L.front.getContext("2d");
    f.setTransform(1, 0, 0, 1, 0, 0); f.clearRect(0, 0, cv.width, cv.height);
    world(f);
    f.fillStyle = "#0d1a12"; f.fillRect(-12, -13, W + 24, H + 26);   // the stands: dark concrete steps behind the fans
    f.fillStyle = "#13261a"; for (i = 0; i < 4; i++) { f.fillRect(-11 + i * 2.4, -12, 1.2, H + 24); f.fillRect(W + 9.8 - i * 2.4, -12, 1.2, H + 24); }
    var stripe = H / 12;
    for (i = 0; i < 12; i++) { f.fillStyle = i % 2 ? "#1f5a32" : "#24673a"; f.fillRect(-3, i * stripe, W + 6, stripe + 0.1); }
    f.fillStyle = "#1a4c2b"; f.fillRect(-6, -6, W + 12, 6); f.fillRect(-6, H, W + 12, 6); f.fillRect(-6, -6, 6, H + 12); f.fillRect(W, -6, 6, H + 12);
    f.strokeStyle = "rgba(238,243,230,.8)"; f.lineWidth = 0.35; f.strokeRect(0, 0, W, H);
    f.beginPath(); f.moveTo(0, H / 2); f.lineTo(W, H / 2); f.stroke();
    f.beginPath(); f.arc(W / 2, H / 2, 8, 0, 7); f.stroke();
    f.fillStyle = "rgba(238,243,230,.8)"; f.beginPath(); f.arc(W / 2, H / 2, 0.5, 0, 7); f.fill();
    [[0, 0], [H, Math.PI]].forEach(function (a) {   // goal circles: nobody may stand inside
      f.fillStyle = "rgba(255,255,255,.08)"; f.beginPath(); f.arc(W / 2, a[0], CREASE, a[1], a[1] + Math.PI); f.fill();
      if (f.setLineDash) f.setLineDash([1.2, 1]); f.beginPath(); f.arc(W / 2, a[0], CREASE, a[1], a[1] + Math.PI); f.stroke(); if (f.setLineDash) f.setLineDash([]);
    });
    var half = gw / 2;
    [[0, -4], [H, 4]].forEach(function (a) {
      var gy = a[0], dy = a[1], gx;
      f.fillStyle = "rgba(255,255,255,.13)"; f.fillRect(W / 2 - half, Math.min(gy, gy + dy), half * 2, 4);
      f.strokeStyle = "rgba(255,255,255,.25)"; f.lineWidth = 0.15;
      for (gx = W / 2 - half; gx <= W / 2 + half; gx += 1.2) { f.beginPath(); f.moveTo(gx, gy); f.lineTo(gx, gy + dy); f.stroke(); }
      for (var q = 1; q < 4; q++) { f.beginPath(); f.moveTo(W / 2 - half, gy + dy * q / 4); f.lineTo(W / 2 + half, gy + dy * q / 4); f.stroke(); }
      f.strokeStyle = "#fffbe6"; f.lineWidth = 0.7; f.beginPath(); f.moveTo(W / 2 - half, gy); f.lineTo(W / 2 - half, gy + dy); f.lineTo(W / 2 + half, gy + dy); f.lineTo(W / 2 + half, gy); f.stroke();
    });
    [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (a) {   // floodlight pools
      var rg = f.createRadialGradient(a[0], a[1], 0, a[0], a[1], 40); rg.addColorStop(0, "rgba(255,251,230,.2)"); rg.addColorStop(1, "rgba(255,251,230,0)");
      f.fillStyle = rg; f.fillRect(a[0] - 40, a[1] - 40, 80, 80);
    });
    // the stands' box on screen (the front layer is copied only there); lite / reduced motion: one layer, one copy a frame
    var bx = Math.floor(k * (OX - (H / 2 + 13) * SC)), by = Math.floor(k * (OY - (W / 2 + 12) * SC));
    L.box = [Math.max(0, bx), Math.max(0, by), Math.min(cv.width, Math.ceil(k * (H + 26) * SC) + 2), Math.min(cv.height, Math.ceil(k * (W + 24) * SC) + 2)];
    if (lite) { c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(L.front, 0, 0); L.front = null; }
    return L;
  }
  function drawFans(t, now) {
    var lite = S.lite, hype = S.hypeUntil > now, amp = REDUCED ? 0 : 0.35, big = REDUCED ? 0 : 1.5;
    for (var i = 0; i < FANS.length; i++) {
      if (lite && (i >> 1) % 2) continue;   // fans are stored in pairs (both sides): lite skips every other pair, never a whole side
      var q = FANS[i], ex = hype && (S.hypeTeam < 0 || S.hypeTeam === q.team), j = Math.abs(Math.sin(t * q.f + q.ph)) * (ex ? big : amp);
      if (!lite) { g.fillStyle = "rgba(0,0,0,.4)"; g.beginPath(); g.arc(q.x + 0.25, q.y + 0.35, q.r * 0.75, 0, 7); g.fill(); }
      g.fillStyle = q.c; g.beginPath(); g.arc(q.x, q.y - j, q.r, 0, 7); g.fill();
      if (!lite) { g.fillStyle = "rgba(255,255,255,.25)"; g.beginPath(); g.arc(q.x - q.r * 0.3, q.y - j - q.r * 0.3, q.r * 0.35, 0, 7); g.fill(); }
      if (ex && !REDUCED && i % 9 === 0) { g.strokeStyle = q.c; g.lineWidth = 0.25; g.beginPath(); g.moveTo(q.x - 0.6, q.y - j - 0.4); g.lineTo(q.x - 1.2, q.y - j - 1.6); g.moveTo(q.x + 0.6, q.y - j - 0.4); g.lineTo(q.x + 1.2, q.y - j - 1.6); g.stroke(); }   // arms up
    }
    // phone camera flashes in the crowd: now and then; a storm right after a goal
    var nf = REDUCED ? 0 : S.storm > 0 ? (lite ? 3 : 6) : (Math.random() < 0.12 ? 1 : 0);
    for (var f = 0; f < nf; f++) {
      var p = FANS[(Math.random() * FANS.length) | 0], rg = g.createRadialGradient(p.x, p.y - 1, 0, p.x, p.y - 1, 2.2);
      rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.35, "rgba(255,251,230,.67)"); rg.addColorStop(1, "rgba(255,251,230,0)");
      g.fillStyle = rg; g.beginPath(); g.arc(p.x, p.y - 1, 2.2, 0, 7); g.fill();
    }
  }
  // a real football (owner ~05:45, ~05:48 "make the ball roll"): builder C's assets/ball3d.js, turned into this screen's frame
  var ball3 = window.Ball3D ? window.Ball3D.create() : null, ballLast = null;
  function drawBall(b) {
    if (!REDUCED) S.trail.forEach(function (q, i) {
      g.fillStyle = "rgba(255,251,230," + (i / S.trail.length * 0.18) + ")"; g.beginPath(); g.arc(q[0], q[1], RB * (i / S.trail.length), 0, 7); g.fill();
    });
    g.save(); g.translate(b[0], b[1]); g.rotate(-Math.PI / 2);   // the screen's own frame, so the light stays top-left
    if (ball3) {
      if (ballLast) window.Ball3D.roll(ball3, -(b[1] - ballLast[1]), b[0] - ballLast[0], RB);   // the move, turned into this frame
      window.Ball3D.draw(g, ball3, 0, 0, RB);
    } else { g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, RB, 0, 7); g.fill(); }
    g.restore();
    ballLast = [b[0], b[1]];
  }
  function drawPlayers(p, bots, bt) {
    var size = p.length / 2;
    p.forEach(function (q, i) {
      var team = i < size ? 0 : 1, bot = WC.isBot(i, size, bt, bots);
      g.save(); g.translate(q[0], q[1]); g.rotate(-Math.PI / 2);   // upright on the landscape screen
      g.fillStyle = "rgba(0,0,0,.33)"; g.beginPath(); g.arc(0.5, 0.9, RP * 0.9, 0, 7); g.fill();
      // a plain disc in the team colour (owner ~05:45), an inner ring (white on Matcha, dark on Yuzu so it shows), a little shine
      g.fillStyle = COL[team].f; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.fill();
      g.strokeStyle = team === 1 ? "#3d2a00" : "rgba(255,255,255,.9)"; g.lineWidth = 0.45; g.beginPath(); g.arc(0, 0, RP * 0.62, 0, 7); g.stroke();
      var hl = g.createRadialGradient(-RP * 0.35, -RP * 0.4, RP * 0.1, 0, 0, RP); hl.addColorStop(0, "rgba(255,255,255,.45)"); hl.addColorStop(0.55, "rgba(255,255,255,0)"); hl.addColorStop(1, "rgba(0,0,0,.25)");
      g.fillStyle = hl; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.fill();
      g.strokeStyle = COL[team].d; g.lineWidth = 0.45; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.stroke();
      if (bot) {
        g.font = "900 1.9px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillStyle = "rgba(0,0,0,.66)"; g.fillText("BOT", 0.15, -RP - 1.05); g.fillStyle = "rgba(255,255,255,.75)"; g.fillText("BOT", 0, -RP - 1.2);
      }
      g.restore();
    });
  }
  function text(t, x, y, font, fill, align) { g.font = font; g.textAlign = align; g.fillStyle = fill; g.fillText(t, x, y); }
  function render(v, info, dt, t, now) {
    var LL = layers(v.gw);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(LL.back, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    if (!REDUCED && !S.lite) [[CH * 0.06, 0], [CW - CH * 0.06, 1]].forEach(function (b) {   // slow sweeping floodlight beams (behind the stands)
      var a = Math.sin(t * 0.5 + b[1] * 2) * 0.35 + (b[1] ? -0.5 : 0.5); g.save(); g.translate(b[0], CH * 0.05 + LEDH); g.rotate(a);
      var gr = g.createLinearGradient(0, 0, 0, CH * 1.1); gr.addColorStop(0, "rgba(255,251,230,.2)"); gr.addColorStop(1, "rgba(255,251,230,0)");
      g.fillStyle = gr; g.beginPath(); g.moveTo(-6 * U, 0); g.lineTo(6 * U, 0); g.lineTo(CH * 0.35, CH * 1.1); g.lineTo(-CH * 0.35, CH * 1.1); g.fill(); g.restore();
    });
    if (LL.front) { var bx = LL.box; g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(LL.front, bx[0], bx[1], bx[2], bx[3], bx[0], bx[1], bx[2], bx[3]); }
    world(g); drawFans(t, now); drawBall(v.b); drawPlayers(v.p, info.bots, info.live ? v.bt : undefined);
    g.setTransform(k, 0, 0, k, 0, 0); g.textBaseline = "middle";
    // the goal moment: one white flash (at most one big flash per 1.6 s), then two beams sweep across
    if (S.goalFlash > 0 && !REDUCED) {
      var gf = S.goalFlash;
      if (S.white && gf > 0.85) { g.fillStyle = "rgba(255,251,230," + Math.min(0.45, (gf - 0.85) * 3).toFixed(2) + ")"; g.fillRect(0, 0, CW, CH); }
      var sw = (1 - gf) * Math.PI;
      [0, 1].forEach(function (i) {
        g.save(); g.translate(i ? CW : 0, 0); g.rotate((i ? -1 : 1) * (sw - 0.6));
        var gr = g.createLinearGradient(0, 0, 0, CH * 1.2); gr.addColorStop(0, "rgba(255,251,230," + (gf * 0.5).toFixed(2) + ")"); gr.addColorStop(1, "rgba(255,251,230,0)");
        g.fillStyle = gr; g.beginPath(); g.moveTo(-24, 0); g.lineTo(24, 0); g.lineTo(CW * 0.45, CH * 1.2); g.lineTo(-CW * 0.45, CH * 1.2); g.fill(); g.restore();
      });
    }
    if (S.soft > 0 && !REDUCED) { g.fillStyle = "rgba(255,255,255,.13)"; g.fillRect(0, 0, CW, CH); }
    var fs = CH * 0.055, big = "400 " + Math.round(fs * 1.15) + "px 'Bowlby One', Impact, sans-serif", body = "900 " + Math.round(fs) + "px Nunito, sans-serif";
    // scoreboard: team names (or Player / Matcha Bot), the score when live, the clock in the middle
    var solo = info.live && WC.isSolo(info.md), sc = info.live && v.sc ? v.sc : null, secs = info.secs || 60;
    var first = v.st === 0 && v.tl >= secs * 1000 - 50, clock = first ? "–" : WC.clockText(v.tl, secs);
    if (sc) {   // a live match: the running score big ("MATCHA 2 – 1 YUZU"), the clock under it
      var gapS = CH * 0.14;
      text(solo ? "PLAYER" : "MATCHA", OX - gapS, LEDH + CH * 0.05, body, COL[0].f, "right");
      text(solo ? "MATCHA BOT" : "YUZU", OX + gapS, LEDH + CH * 0.05, body, COL[1].f, "left");
      text(sc[0] + " – " + sc[1], OX, LEDH + CH * 0.053, "400 " + Math.round(fs * 1.3) + "px 'Bowlby One', Impact, sans-serif", "#fffbe6", "center");
      text(clock, OX, LEDH + CH * 0.103, "400 " + Math.round(fs * 0.68) + "px 'Bowlby One', Impact, sans-serif", "rgba(255,251,230,.85)", "center");
    } else {   // the demo (and a server without scores): the approved row, team names either side of the clock
      text("TEAM MATCHA", OX - CH * 0.12, LEDH + CH * 0.062, body, COL[0].f, "right");
      text("TEAM YUZU", OX + CH * 0.12, LEDH + CH * 0.062, body, COL[1].f, "left");
      text(clock, OX, LEDH + CH * 0.065, big, "#fffbe6", "center");
    }
    if (S.cel && S.cel.text) {   // the GOAL banner: the hand-drawn word, the team under it
      var sp = S.cel.sub != null ? { big: S.cel.text, sub: S.cel.sub } : WC.splitCheer(S.cel.text), hs = Math.round(fs * (sp.big.length > 8 ? 2.2 : 3.6));
      var hand = "400 " + hs + "px Gotcha, 'Bowlby One', Impact, sans-serif";
      text(sp.big, OX + 5, OY + 7, hand, "rgba(0,0,0,.6)", "center"); text(sp.big, OX, OY, hand, "#fffbe6", "center");
      if (sp.sub) { var sf = "400 " + Math.round(fs * 1.25) + "px 'Bowlby One', Impact, sans-serif"; text(sp.sub, OX + 3, OY + hs * 0.72 + 4, sf, "rgba(0,0,0,.6)", "center"); text(sp.sub, OX, OY + hs * 0.72, sf, COL[S.cel.w === 1 ? 1 : 0].f, "center"); }
    }
    if (!info.live && S.huhs.length) {   // the idle Viking clap: a big HUH! with each BOOM
      var pn = performance.now(); S.huhs = S.huhs.filter(function (h) { return pn - h < 1000; });
      for (var hi = S.huhs.length - 1; hi >= 0; hi--) { var age = pn - S.huhs[hi]; if (age >= 0 && age < 450) {
        var kk = age / 450, hz = Math.round(fs * 3.4 * (REDUCED ? 1 : 1.18 - 0.18 * kk)), hf = "400 " + hz + "px 'Bowlby One', Impact, sans-serif";
        g.globalAlpha = 1 - kk; text("HUH!", OX + 6, OY + 8, hf, "rgba(0,0,0,.6)", "center"); text("HUH!", OX, OY, hf, "#ffd23f", "center"); g.globalAlpha = 1; break; } }
    }
    drawFx(g, dt);
    drawScan();   // after the confetti and fireworks, so nothing ever covers the QR
    drawLed(t);   // on top of everything, like a stadium's sponsor board
  }

  /* ---------- the LED board + the SCAN TO PLAY box (projector rev 4, owner yes 13 Nov ~05:56; contract §15–16) ---------- */
  // The board's words: WC.ledPhrases (prize words only while the heartbeat says a win really gives a voucher). Drawn once into an image
  // after the fonts load; each frame only places it (scrolling) or, with reduced motion, shows one phrase at a time (no scroll).
  var LEDC = { g: "#ffd23f", w: "#fffbe6", m: "#9be27a" };
  var led = { key: "", img: null, pages: null, grid: null };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { led.key = ""; });   // measure again once the real fonts are in
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", function () { led.key = ""; });
  function ledImage() {
    var ph = WC.ledPhrases(S.closed, S.prizes), key = JSON.stringify(ph) + ":" + cv.width;
    if (led.key === key && led.img) return led;
    led.key = key;
    var h = Math.round(LEDH * k), px = Math.round(h * 0.66), segs = [], i;
    ph.forEach(function (p) { segs.push(p, ["   ⚽   ", "w"]); });
    function font(sg) { return sg[2] ? "400 " + Math.round(px * 1.05) + "px Gotcha, 'Bowlby One', Impact, sans-serif" : "400 " + px + "px 'Bowlby One', Impact, sans-serif"; }
    function strip(list, wmin) {   // one canvas with the segments side by side (centred when wider than needed)
      var c = document.createElement("canvas"), x = c.getContext("2d"), wsum = 0, j;
      for (j = 0; j < list.length; j++) { x.font = font(list[j]); wsum += x.measureText(list[j][0]).width; }
      c.width = Math.max(1, Math.ceil(Math.max(wsum, wmin || 0))); c.height = h; x = c.getContext("2d"); x.textBaseline = "middle"; x.textAlign = "left";
      var cx = Math.max(0, (c.width - wsum) / 2);
      for (j = 0; j < list.length; j++) { x.font = font(list[j]); x.fillStyle = LEDC[list[j][1]] || list[j][1]; x.fillText(list[j][0], cx, h * 0.54); cx += x.measureText(list[j][0]).width; }
      return c;
    }
    led.img = strip(segs);
    led.pages = ph.map(function (p) { return strip([p], cv.width); });   // reduced motion: one phrase at a time
    if (!led.grid || led.grid.width !== cv.width) {   // a light bulb grid (1 px at 25%)
      var gr = document.createElement("canvas"); gr.width = cv.width; gr.height = h; var gx = gr.getContext("2d"); gx.fillStyle = "rgba(0,0,0,.25)";
      for (i = 0; i < gr.width; i += Math.max(3, Math.round(4 * k))) gx.fillRect(i, 0, 1, h);
      for (i = 0; i < h; i += Math.max(3, Math.round(4 * k))) gx.fillRect(0, i, gr.width, 1);
      led.grid = gr;
    }
    return led;
  }
  function drawLed(t) {
    var L2 = ledImage(), h = Math.round(LEDH * k), wImg = L2.img.width;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#040604"; g.fillRect(0, 0, cv.width, h);
    if (REDUCED) g.drawImage(L2.pages[WC.ledPage(t, L2.pages.length)], 0, 0);   // page through, no scroll
    else { var off = Math.round((t * 150 * k) % wImg); for (var x = -off; x < cv.width; x += wImg) g.drawImage(L2.img, x, 0); }   // ~150 px a second
    g.drawImage(L2.grid, 0, 0);
    g.fillStyle = "#ffd23f"; g.fillRect(0, h - Math.round(3 * k), cv.width, Math.round(3 * k));   // a gold edge under the board
    g.setTransform(k, 0, 0, k, 0, 0);
  }
  // one tall box on the left, as high as the stadium: SCAN TO PLAY + the game QR (BACK SOON while paused)
  function scanBox() {
    var top = OY - (W / 2 + 12) * SC, h = (W + 24) * SC, left = CH * 0.025, right = OX - SW / 2 - CH * 0.025, bw = right - left;
    return { top: top, h: h, left: left, bw: bw, cx: left + bw / 2, q: Math.min(bw * 0.84, h * 0.6), qy: top + h * 0.33 };
  }
  function drawScan() {
    var b = scanBox();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = "rgba(0,0,0,.82)"; g.strokeStyle = "#ffd23f"; g.lineWidth = 8; roundBox(b.left, b.top, b.bw, b.h, 36); g.fill(); g.stroke();
    g.textBaseline = "middle";
    text("SCAN TO", b.cx, b.top + b.h * 0.12, "400 " + Math.round(CH * 0.075) + "px 'Bowlby One', Impact, sans-serif", "#fffbe6", "center");
    text("PLAY", b.cx, b.top + b.h * 0.235, "400 " + Math.round(CH * 0.1) + "px 'Bowlby One', Impact, sans-serif", "#ffd23f", "center");
    if (S.closed) { text("BACK SOON", b.cx, b.qy + b.q / 2, "400 " + Math.round(CH * 0.055) + "px 'Bowlby One', Impact, sans-serif", "#fffbe6", "center"); return; }
    var side = Math.floor(b.q * k), c = qrCanvas(WC.GAME_URL, side, 0);
    if (c) { g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(c, Math.round(k * b.cx - c.width / 2), Math.round(k * b.qy + (side - c.width) / 2)); g.imageSmoothingEnabled = true; g.setTransform(k, 0, 0, k, 0, 0); }
  }
  var qrs = [null, null];   // the QR cache: 2 slots, so a resize or a second QR never piles up images (contract §15)
  // the QR as its own canvas: whole pixels per module and a 4-module white quiet zone, so a phone camera reads it from across the booth
  function qrCanvas(text, px, slot) {
    var key = text + ":" + px, sl = slot ? 1 : 0;
    if (qrs[sl] && qrs[sl].key === key) return qrs[sl].cv;
    if (typeof window.qrcode !== "function") return null;
    qrs[sl] = { key: key, cv: null };
    try {
      var q = window.qrcode(0, "M"); q.addData(text); q.make();
      var n = q.getModuleCount(), quiet = 4, m = Math.max(1, Math.floor(px / (n + 2 * quiet))), size = m * (n + 2 * quiet);
      var c = document.createElement("canvas"); c.width = c.height = size;
      var x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, size, size); x.fillStyle = "#000000";
      for (var r = 0; r < n; r++) for (var cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect((cc + quiet) * m, (r + quiet) * m, m, m);
      qrs[sl].cv = c;
    } catch (e) { qrs[sl].cv = null; }   // no QR rather than a wrong one
    return qrs[sl].cv;
  }
  function roundBox(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- the demo: bots only, run here with sim.js ---------- */
  function newDemo() {
    var Sim = window.Sim3; if (!Sim) { S.demo = null; return; }
    var seed = Math.floor(Math.random() * 4294967295);
    S.demo = Sim.createMatch({ seed: seed, humans: [], mode: "versus", size: DEMO_SIZE }); S.demoAcc = 0; S.trail = [];
  }
  function demoFrame(dt) {
    var Sim = window.Sim3;
    if (!Sim) return null;
    try {
      if (!S.demo) newDemo();
      S.demoAcc += Math.min(dt, 0.1);
      var ended = false;
      while (S.demoAcc >= 1 / 60) {
        S.demoAcc -= 1 / 60;
        var ev = Sim.step(S.demo, 1 / 60) || [];
        for (var i = 0; i < ev.length; i++) if (ev[i].k === "end") ended = true;
      }
      var v = Sim.snapshot(S.demo);
      if (ended || v.st === 4) newDemo();
      return v;
    } catch (e) { S.demo = null; return null; }   // a sim hiccup restarts the demo, never the page
  }

  /* ---------- celebrations follow the DRAWN frame, so they land with the ball ---------- */
  function cheer(c, w, goal) {
    var now = performance.now();
    S.cel = { text: c.text, sub: c.sub, w: w, until: c.end ? Infinity : now + 1500 };
    if (c.party || (w >= 0 && c.text !== "DRAW")) {   // every goal: fans jump; one white flash then beams; a flash storm
      S.hypeUntil = now + (c.end ? 3200 : 2400); S.hypeTeam = c.end ? -1 : w;
      S.white = WC.flashOk(now, S.flashAt); if (S.white) S.flashAt = now;
      S.goalFlash = 1; S.storm = 1.4;
      if (c.party) burst([w === 1 ? COL[1].f : COL[0].f, "#fffbe6", w === 1 ? "#fff3b0" : "#bfe8a8"], c.end ? 160 : 70);
      if (c.end && c.party) fireworks(5);
    }
    // crowd sounds (owner yes 13 Nov ~04:50): every goal "Wooo!" + roar (a bot goal too); a win "Hurrah!"; the drum and claps pause
    bgStop();
    var t = A.ctx ? A.ctx.currentTime : 0;
    if (goal) { pb("wooo", t, 1, CR.fg); pb("roar", t, 1, CR.fg); play("whistle"); play("horn"); }
    else play("whistle");   // time up
    if (c.end && c.party) setTimeout(function () { if (A.ctx) pb("hurrah", A.ctx.currentTime, 1, CR.fg); }, goal ? 1700 : 500);
    else if (!goal) play("groan");
  }
  function watch(F, v) {
    var w = WC.scorer(S.prevSc, v.sc);
    if (w >= 0) cheer(WC.goalText(F.md, w, v.sc, F.human, F.need, v.st === 2), w, true);
    else if (v.st === 2 && S.prevSt === 1 && !v.sc) { var w2 = v.b[1] < H / 2 ? 0 : 1; cheer(WC.goalText(F.md, w2, null, F.human, F.need, true), w2, true); }   // a server without scores
    else if (v.st === 3 && S.prevSt !== 3) { var tu = WC.timeUpText(F.md, v.sc); cheer(tu, tu.w != null ? tu.w : -1, false); }
    if (v.sc) S.prevSc = v.sc.slice();
    S.prevSt = v.st;
  }

  /* ---------- the frame ---------- */
  var lastT = 0, demoShown = true, perfN = 0, perfSum = 0;
  if (/[?&]lite=1/.test(qs)) S.lite = true;
  function frame(t) {
    var dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)), raw = (t - lastT) / 1000; lastT = t;
    // a slow TV drops the extras (beams, half the fans, fireworks) after ~3 s of slow frames, for the rest of the day
    if (!S.lite && raw > 0 && raw < 1) { perfN++; perfSum += raw; if (perfN >= 90) { if (perfSum / perfN > 0.034) S.lite = true; perfN = 0; perfSum = 0; } }
    try {
      fit();
      var F = S.F, now = performance.now(), v = null, info;
      var liveOn = !!(F && F.buf.length && now - F.lastAt < 2500 && !(F.endAt && now > F.endAt + HOLD));
      if (liveOn) {
        // drawn ~100 ms behind; slow motion on the last moment before a goal
        S.pt = WC.playClock(S.pt, now - DELAY, dt * 1000, REDUCED || demoShown ? null : WC.goalAhead(F.buf, S.pt, S.prevSc));
        v = WC.sample(F.buf, S.pt);
        if (demoShown) { S.prevSc = v.sc ? v.sc.slice() : null; S.prevSt = v.st; S.trail = []; S.cel = null; demoShown = false; }   // joined mid-match: no stale cheer
        else watch(F, v);
        info = { live: true, md: F.md, need: F.need, secs: F.secs, bots: F.bots };
      } else {
        if (!demoShown) { demoShown = true; S.cel = null; S.pt = null; newDemo(); }
        v = demoFrame(dt);
        info = { live: false, md: 0, need: null, bots: [[1, 1, 1], [1, 1, 1]] };
      }
      if (S.cel && now > S.cel.until) S.cel = null;
      S.goalFlash = Math.max(0, (S.goalFlash || 0) - dt * 1.6); S.storm = Math.max(0, (S.storm || 0) - dt); S.soft = Math.max(0, (S.soft || 0) - dt);
      // during a celebration the stadium flashes softly, never more than once per 1.6 s
      if (S.cel && S.cel.until === Infinity && !REDUCED && WC.flashOk(now, S.flashAt)) { S.flashAt = now; S.soft = 0.08; }
      if (!v) v = { st: 0, tl: 60000, gw: 28, b: [W / 2, H / 2], p: [], sc: null };
      S.aud = { live: liveOn, st: v.st, tl: v.tl };   // the crowd scheduler follows the drawn match
      if (!REDUCED) { S.trail.push([v.b[0], v.b[1]]); if (S.trail.length > 12) S.trail.shift(); }
      render(v, info, dt, t / 1000, now);
      var dot = $("#net");
      if (dot) dot.className = S.online ? "on" : "";
    } catch (e) { /* draw the next frame; the wall never stops */ }
    requestAnimationFrame(frame);
  }

  /* ---------- staff controls: Sound on, Full screen; they fade after 12 s ---------- */
  function controls() {
    var box = $("#ctl"), sb = $("#sound"), fb = $("#full"), idle = 0;
    function paint() { sb.textContent = S.soundOn ? "🔊 Sound off" : "🔈 Sound on"; }
    function show() { box.className = "show"; clearTimeout(idle); idle = setTimeout(function () { box.className = ""; }, 12000); }
    sb.onclick = function () {
      audioStart();
      S.soundOn = !S.soundOn; paint(); crowdOn(S.soundOn); bed(S.soundOn); if (S.soundOn) setTimeout(function () { play("whistle"); }, 60); wake(); show();
    };
    fb.onclick = function () {
      var d = document.documentElement, f = d.requestFullscreen || d.webkitRequestFullscreen;
      try { if (f) { var p = f.call(d); if (p && p.catch) p.catch(function () {}); } } catch (e) { /* not allowed here */ }
      wake(); show();
    };
    ["mousemove", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
      document.addEventListener(e, function (ev) { var was = box.className === "show"; show(); if (e === "keydown" && !was && document.activeElement === document.body) sb.focus(); });
    });
    paint(); show();
  }
  var lock = null;
  function wake() { try { if (navigator.wakeLock && !lock) navigator.wakeLock.request("screen").then(function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); }).catch(function () {}); } catch (e) { /* not here */ } }

  window.addEventListener("DOMContentLoaded", function () {
    cv = $("#wall"); g = cv.getContext("2d");
    try { if (document.fonts && document.fonts.load) document.fonts.load("120px Gotcha"); } catch (e) { /* the banner falls back to Bowlby One */ }
    if (mode !== "live") { var tg = $("#test"); tg.hidden = false; tg.textContent = mode === "fake" ? "FAKE FEED" : "TEST SERVER"; }
    requestAnimationFrame(frame);   // the picture first: nothing below may leave the screen black (review #12)
    try { controls(); } catch (e) { /* the buttons are extras */ }
    window.addEventListener("resize", fit);
    connect();
    if (window.fetch) { health(); setInterval(health, 30000); }
  });
})();
