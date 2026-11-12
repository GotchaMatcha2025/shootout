/* Gotcha Shootout 3v3: the big screen at the booth (1920×1080 on the projector / Android TV browser, so plain ES2018, no `inset`).
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
  function wsUrl(base) { return base.replace(/^http/, "ws") + "/ws?role=wall"; }
  // reconnect forever: 0.5 s, 1 s, 2 s … capped at 10 s, ±25% so a room of walls doesn't knock at once
  function backoff(n, r) { return Math.round(Math.min(10000, 500 * Math.pow(2, Math.min(n, 5))) * (0.75 + 0.5 * r)); }
  function isSolo(md) { return md === 1 || md === "challenge" || md === "solo"; }
  function modeLabel(md, size) { return isSolo(md) ? "VS MATCHA BOT" : size + " V " + size; }
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
    return { st: A.st, tl: lerp(A.tl, B.tl, k), gw: lerp(A.gw, B.gw, k), md: B.md, sc: A.sc, b: pt(A.b, B.b), p: p };
  }
  // what the wall shouts when the drawn score changes or time runs out. Versus: first goal wins. Single player: the human team wins at the
  // server's `need` (or when the server ends the match on that goal, st 2); the bot's goals only restart play
  function goalText(md, w, sc, humanTeam, need, ended) {
    if (!isSolo(md)) return { text: "GOAL! TEAM " + TEAM[w], party: true, end: true };
    if (w !== humanTeam) return { text: "MATCHA BOT SCORES", party: false, end: false };
    if (ended || (need && sc && sc[w] >= need)) return { text: "GOAL! BOT BEATEN", party: true, end: true };
    return { text: "GOAL!", party: true, end: false };
  }
  function timeUpText(md) { return isSolo(md) ? { text: "MATCHA BOT WINS", party: false, end: true } : { text: "DRAW", party: false, end: true }; }
  // the team whose score went up between two drawn frames (-1 = none)
  function scorer(prev, cur) {
    if (!prev || !cur) return -1;
    if ((cur[0] || 0) > (prev[0] || 0)) return 0;
    if ((cur[1] || 0) > (prev[1] || 0)) return 1;
    return -1;
  }
  return { TEAM: TEAM, BASES: BASES, pickMode: pickMode, wsUrl: wsUrl, backoff: backoff, isSolo: isSolo, modeLabel: modeLabel,
    sample: sample, goalText: goalText, timeUpText: timeUpText, scorer: scorer };
})();
if (typeof module === "object" && module.exports) module.exports = WallCore;

if (typeof window !== "undefined" && window.document) (function () {
  var WC = WallCore, $ = function (s) { return document.querySelector(s); };
  var DELAY = 100, HOLD = 3200, CW = 1920, CH = 1080;
  var REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var COL = [{ f: "#6fbf4a", d: "#3d7a26" }, { f: "#ffd23f", d: "#b88a00" }];
  // the four cat faces of the approved mock-up (crop centre + radius in the source image)
  var CATS = [{ f: "cat-ok-gotcha-cream.webp", cx: 305, cy: 284, r: 132 }, { f: "cat-barista-cream.webp", cx: 326, cy: 309, r: 128 },
    { f: "cat-whisk-ride-cream.webp", cx: 450, cy: 80, r: 84 }, { f: "matcha-deprived-cream.webp", cx: 300, cy: 240, r: 150 }];
  var DEMO_CATS = [[0, 1, 2], [3, 2, 0]], DEMO_SIZE = 2;   // rev 3 demo: 2 v 2, cats [[0,1],[3,2]]
  // images: the 3v3 assets folder first, then the repo's shared one (whichever exists after the switch)
  CATS.forEach(function (c) {
    c.img = new Image(); c.img.onerror = function () { if (!c.tried) { c.tried = 1; c.img.src = "../../assets/img/" + c.f; } };
    c.img.src = "../assets/img/" + c.f;
  });

  var mode, base, qs = "";
  try { qs = location.search; } catch (e) { qs = ""; }
  var asked = (qs.match(/[?&]api=([a-z]+)/) || [])[1], saved = null;
  try { saved = sessionStorage.getItem("s3v3:api"); } catch (e) { saved = null; }
  mode = WC.pickMode(asked, saved, location.hostname, location.protocol);
  try { if (asked && WC.BASES[asked]) sessionStorage.setItem("s3v3:api", asked); } catch (e) { /* no session storage */ }
  base = WC.BASES[mode];
  if (mode === "fake") { var fs = document.createElement("script"); fs.src = "fake.js?v=1"; document.head.appendChild(fs); }

  /* ---------- state ---------- */
  var S = { online: false, closed: false, F: null, demo: null, demoAcc: 0, view: null, prevSc: null, prevSt: -1,
    cel: null, trail: [], soundOn: false };
  if (mode === "fake") window.__wall = S;   // tests read the state on the fake feed only
  function newFeatured(m) {
    return { id: m && m.id || null, md: m && m.md != null ? m.md : null, need: m && typeof m.need === "number" ? m.need : null, cats: m && m.cats || null, bots: m && m.bots || null,
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
    if (!Sock) { timer = setTimeout(connect, 300); return; }   // fake.js still loading
    try { ws = new Sock(WC.wsUrl(base)); } catch (e) { ws = null; retry(); return; }
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
    if (m.t === "wall") { if (m.closed != null) S.closed = !!m.closed; return; }   // the heartbeat; GET / is the closed switch's main source
    if (m.t === "start") { S.F = newFeatured(m); S.F.lastAt = now; S.prevSc = null; S.prevSt = -1; S.cel = null; S.trail = []; return; }
    if (m.t === "s") {
      var F = S.F, n = m.p ? m.p.length : 0, last = F && F.buf.length ? F.buf[F.buf.length - 1].s : null;
      // snapshots after an end, a different team size or a clock that went back up = another match the server now features
      if (!F || F.endAt || (last && (last.p.length !== n || m.tl > last.tl + 1500))) { S.F = F = newFeatured({ md: m.md }); S.prevSc = null; S.prevSt = -1; S.cel = null; S.trail = []; }
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
    var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
    fetch(base + "/?v=1", { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); }).then(function (j) { if (j && typeof j === "object") S.closed = j.closed === true; })
      .catch(function () { /* no answer: keep what we knew */ }).then(function () { clearTimeout(t); });
  }

  /* ---------- sound: made in the browser, off until staff press Sound on ---------- */
  var AC = null;
  function tone(f, d, type, v, slide) {
    if (!S.soundOn || !AC) return;
    try {
      var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
      o.type = type || "sine"; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
      g.gain.setValueAtTime(v || 0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
    } catch (e) { /* a sound never breaks the wall */ }
  }
  function noise(d, v, f) {
    if (!S.soundOn || !AC) return;
    try {
      var n = Math.floor(AC.sampleRate * d), b = AC.createBuffer(1, n, AC.sampleRate), a = b.getChannelData(0);
      for (var i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain();
      fl.type = "bandpass"; fl.frequency.value = f; g.gain.value = v; s.buffer = b; s.connect(fl); fl.connect(g); g.connect(AC.destination); s.start();
    } catch (e) { /* a sound never breaks the wall */ }
  }
  var SND = {
    kick: function (p) { tone(140, 0.12, "sine", 0.35 * p, -90); noise(0.05, 0.15 * p, 2000); },
    whistle: function () { tone(2600, 0.35, "square", 0.05); setTimeout(function () { tone(2500, 0.5, "square", 0.05); }, 380); },
    goal: function () { noise(1.6, 0.35, 700); [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.35, "triangle", 0.18); }, i * 110); }); },
    sad: function () { [392, 330, 262].forEach(function (f, i) { setTimeout(function () { tone(f, 0.3, "sine", 0.15); }, i * 180); }); }
  };
  function sound(m) {
    if (m.k === "hit") SND.kick(Math.max(0.2, m.p || 0.5));
    else if (m.k === "post") tone(1200, 0.25, "triangle", 0.12);
    else if (m.k === "wall") tone(320, 0.06, "square", 0.05);
    else if (m.k === "go" || m.k === "kickoff") SND.whistle();
  }

  /* ---------- confetti (screen space, logical 1920×1080) ---------- */
  var conf = [];
  function burst(cols, n) {
    if (REDUCED) return;
    for (var i = 0; i < n; i++) conf.push({ x: CW / 2 + (Math.random() - 0.5) * CW * 0.3, y: CH * 0.42, vx: (Math.random() - 0.5) * 1800, vy: -Math.random() * 1500 - 300,
      r: Math.random() * 14 + 8, c: cols[i % cols.length], a: Math.random() * 6, l: 1 });
  }
  function drawConf(g, dt) {
    for (var i = conf.length - 1; i >= 0; i--) {
      var q = conf[i]; q.vy += 2200 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.a += dt * 8; q.l -= dt * 0.45;
      if (q.l <= 0 || q.y > CH + 40) { conf.splice(i, 1); continue; }
      g.save(); g.globalAlpha = Math.max(0, q.l); g.translate(q.x, q.y); g.rotate(q.a); g.fillStyle = q.c; g.fillRect(-q.r / 2, -q.r / 4, q.r, q.r / 2); g.restore();
    }
  }

  /* ---------- drawing (the mock-up's renderWall, in a fixed 1920×1080 frame) ---------- */
  var cv, g, k = 1, layer = null, layerKey = "", faces = {};
  var W = 60, H = 96, RP = 3.3, RB = 1.9, CREASE = 9;
  var TOP = CH * 0.14, SC = Math.min((CW * 0.94) / (H + 10), (CH - TOP - CH * 0.08) / (W + 6)), OX = CW / 2, OY = TOP + (CH - TOP - CH * 0.06) / 2;
  function fit() {
    var vw = window.innerWidth || CW, vh = window.innerHeight || CH, s = Math.min(vw / CW, vh / CH), w = Math.round(CW * s), h = Math.round(CH * s);
    cv.style.width = w + "px"; cv.style.height = h + "px"; cv.style.left = Math.round((vw - w) / 2) + "px"; cv.style.top = Math.round((vh - h) / 2) + "px";
    var bw = Math.min(CW, Math.round(w * (window.devicePixelRatio || 1)));   // never more pixels than 1920 wide: old TV chips
    if (cv.width !== bw) { cv.width = bw; cv.height = Math.round(bw * CH / CW); layerKey = ""; }
    k = cv.width / CW;
  }
  function world(gg) { gg.setTransform(k * SC, 0, 0, k * SC, k * OX, k * OY); gg.rotate(Math.PI / 2); gg.translate(-W / 2, -H / 2); }   // Matcha (y=H) on the left
  // background + pitch + goals drawn once into a layer; redrawn only when the goal width changes (last 15 s)
  function pitchLayer(gw) {
    var key = cv.width + ":" + Math.round(gw * 2);
    if (key === layerKey) return layer;
    if (!layer) layer = document.createElement("canvas");
    layer.width = cv.width; layer.height = cv.height; layerKey = key;
    var c = layer.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    var bg = c.createLinearGradient(0, 0, 0, layer.height); bg.addColorStop(0, "#0b1d12"); bg.addColorStop(1, "#050b07"); c.fillStyle = bg; c.fillRect(0, 0, layer.width, layer.height);
    world(c);
    var stripe = H / 12, i;
    for (i = 0; i < 12; i++) { c.fillStyle = i % 2 ? "#1f5a32" : "#24673a"; c.fillRect(-3, i * stripe, W + 6, stripe + 0.1); }
    c.fillStyle = "#1a4c2b"; c.fillRect(-6, -6, W + 12, 6); c.fillRect(-6, H, W + 12, 6); c.fillRect(-6, -6, 6, H + 12); c.fillRect(W, -6, 6, H + 12);
    c.strokeStyle = "rgba(238,243,230,.8)"; c.lineWidth = 0.35; c.strokeRect(0, 0, W, H);
    c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 8, 0, 7); c.stroke();
    c.fillStyle = "rgba(238,243,230,.8)"; c.beginPath(); c.arc(W / 2, H / 2, 0.5, 0, 7); c.fill();
    [[0, 0], [H, Math.PI]].forEach(function (a) {   // goal circles: nobody may stand inside
      c.fillStyle = "rgba(255,255,255,.08)"; c.beginPath(); c.arc(W / 2, a[0], CREASE, a[1], a[1] + Math.PI); c.fill();
      if (c.setLineDash) c.setLineDash([1.2, 1]); c.beginPath(); c.arc(W / 2, a[0], CREASE, a[1], a[1] + Math.PI); c.stroke(); if (c.setLineDash) c.setLineDash([]);
    });
    var half = gw / 2;
    [[0, -4], [H, 4]].forEach(function (a) {
      var y = a[0], dy = a[1], x;
      c.fillStyle = "rgba(255,255,255,.13)"; c.fillRect(W / 2 - half, Math.min(y, y + dy), half * 2, 4);
      c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = 0.15;
      for (x = W / 2 - half; x <= W / 2 + half; x += 1.2) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + dy); c.stroke(); }
      for (var j = 1; j < 4; j++) { c.beginPath(); c.moveTo(W / 2 - half, y + dy * j / 4); c.lineTo(W / 2 + half, y + dy * j / 4); c.stroke(); }
      c.strokeStyle = "#fffbe6"; c.lineWidth = 0.7; c.beginPath(); c.moveTo(W / 2 - half, y); c.lineTo(W / 2 - half, y + dy); c.lineTo(W / 2 + half, y + dy); c.lineTo(W / 2 + half, y); c.stroke();
    });
    [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (a) {   // floodlight pools
      var rg = c.createRadialGradient(a[0], a[1], 0, a[0], a[1], 40); rg.addColorStop(0, "rgba(255,251,230,.2)"); rg.addColorStop(1, "rgba(255,251,230,0)");
      c.fillStyle = rg; c.fillRect(a[0] - 40, a[1] - 40, 80, 80);
    });
    return layer;
  }
  function face(ci, team) {
    var px = Math.max(24, Math.round(RP * 2 * SC * k)), key = ci + "-" + team + "-" + px;
    if (faces[key]) return faces[key];
    var c = CATS[ci]; if (!c || !c.img.complete || !c.img.naturalWidth) return null;
    var f = document.createElement("canvas"); f.width = f.height = px;
    var x = f.getContext("2d"), r = px / 2;
    x.fillStyle = COL[team].f; x.beginPath(); x.arc(r, r, r, 0, 7); x.fill();
    x.save(); x.beginPath(); x.arc(r, r, r * 0.86, 0, 7); x.clip(); x.fillStyle = "#173a24"; x.fillRect(0, 0, px, px);
    x.drawImage(c.img, c.cx - c.r, c.cy - c.r, c.r * 2, c.r * 2, r - r * 0.86, r - r * 0.86, r * 1.72, r * 1.72); x.restore();
    return (faces[key] = f);
  }
  function drawBall(b) {
    if (!REDUCED) S.trail.forEach(function (q, i) {
      g.fillStyle = "rgba(255,251,230," + (i / S.trail.length * 0.25) + ")"; g.beginPath(); g.arc(q[0], q[1], RB * (i / S.trail.length), 0, 7); g.fill();
    });
    g.fillStyle = "rgba(0,0,0,.4)"; g.beginPath(); g.arc(b[0] + 0.4, b[1] + 0.6, RB * 0.9, 0, 7); g.fill();
    var rg = g.createRadialGradient(b[0] - 0.4, b[1] - 0.5, 0.2, b[0], b[1], RB); rg.addColorStop(0, "#fff"); rg.addColorStop(1, "#cfd6c9");
    g.fillStyle = rg; g.beginPath(); g.arc(b[0], b[1], RB, 0, 7); g.fill();
    g.fillStyle = "#1b2a20"; g.beginPath(); g.arc(b[0] + 0.2, b[1], 0.45, 0, 7); g.fill();
    g.beginPath(); g.arc(b[0] - 0.7, b[1] - 0.6, 0.25, 0, 7); g.fill(); g.beginPath(); g.arc(b[0] - 0.5, b[1] + 0.75, 0.25, 0, 7); g.fill();
  }
  function drawPlayers(p, cats, bots) {
    var size = p.length / 2;
    p.forEach(function (q, i) {
      var team = i < size ? 0 : 1, slot = i % size, cat = cats && cats[team] ? cats[team][slot] : null, bot = bots && bots[team] ? !!bots[team][slot] : false;
      g.save(); g.translate(q[0], q[1]); g.rotate(-Math.PI / 2);   // faces upright on the landscape screen
      g.fillStyle = "rgba(0,0,0,.33)"; g.beginPath(); g.arc(0.5, 0.9, RP * 0.9, 0, 7); g.fill();
      var fc = cat == null ? null : face(cat, team);
      if (fc) g.drawImage(fc, -RP, -RP, RP * 2, RP * 2); else { g.fillStyle = COL[team].f; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.fill(); }
      g.strokeStyle = COL[team].d; g.lineWidth = 0.35; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.stroke();
      if (bot) {
        g.font = "900 1.9px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillStyle = "rgba(0,0,0,.66)"; g.fillText("BOT", 0.15, -RP - 1.05); g.fillStyle = "rgba(255,255,255,.75)"; g.fillText("BOT", 0, -RP - 1.2);
      }
      g.restore();
    });
  }
  function text(t, x, y, font, fill, align) { g.font = font; g.textAlign = align; g.fillStyle = fill; g.fillText(t, x, y); }
  function render(v, info, dt) {
    var L = pitchLayer(v.gw);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(L, 0, 0);
    world(g); drawBall(v.b); drawPlayers(v.p, info.cats, info.bots);
    g.setTransform(k, 0, 0, k, 0, 0); g.textBaseline = "middle";
    var fs = CH * 0.055, big = "400 " + Math.round(fs * 1.15) + "px 'Bowlby One', Impact, sans-serif", body = "900 " + Math.round(fs) + "px Nunito, sans-serif";
    // scoreboard: team names (or Player / Matcha Bot), the score when live, the clock in the middle
    var solo = info.live && WC.isSolo(info.md), sc = info.live && v.sc ? v.sc : null, gap = CH * 0.12;
    var left = solo ? "PLAYER" : "TEAM MATCHA", right = solo ? "MATCHA BOT" : "TEAM YUZU";
    if (sc) { left += "  " + sc[0]; right = sc[1] + "  " + right; }
    text(left, CW / 2 - gap, CH * 0.075, body, COL[0].f, "right");
    text(right, CW / 2 + gap, CH * 0.075, body, COL[1].f, "left");
    var first = v.st === 0 && v.tl >= 59950;
    text(first ? "–" : String(Math.ceil(v.tl / 1000)), CW / 2, CH * 0.078, big, "#fffbe6", "center");
    // bottom row: LIVE / DEMO with its dot, the call to play (fewest words, owner 12 Nov ~20:52)
    var small = "900 " + Math.round(fs * 0.48) + "px Nunito, sans-serif", y = CH * 0.967;
    g.fillStyle = info.live ? "#ff6b5b" : "#9db5a3"; g.beginPath(); g.arc(CH * 0.04, y, CH * 0.011, 0, 7); g.fill();
    text(info.live ? "LIVE · " + WC.modeLabel(info.md, v.p.length / 2) : "DEMO · BOTS PLAYING", CH * 0.06, y, small, "rgba(255,251,230,.85)", "left");
    text(S.closed ? "BACK SOON" : "SCAN TO PLAY", CW - CH * 0.04, y, small, "#ffd23f", "right");
    if (S.cel && S.cel.text) {
      var f2 = "400 " + Math.round(fs * (S.cel.text.length > 14 ? 1.9 : 2.4)) + "px 'Bowlby One', Impact, sans-serif";
      text(S.cel.text, CW / 2 + 4, CH * 0.55 + 5, f2, "rgba(0,0,0,.66)", "center"); text(S.cel.text, CW / 2, CH * 0.55, f2, "#fffbe6", "center");
    }
    drawConf(g, dt);
  }

  /* ---------- the demo: bots only, run here with sim.js ---------- */
  function newDemo() {
    var Sim = window.Sim3; if (!Sim) { S.demo = null; return; }
    var seed = Math.floor(Math.random() * 4294967295), cats = [DEMO_CATS[0].slice(0, DEMO_SIZE), DEMO_CATS[1].slice(0, DEMO_SIZE)];
    S.demo = Sim.createMatch({ seed: seed, humans: [], cats: cats, mode: "versus", size: DEMO_SIZE }); S.demoAcc = 0; S.trail = [];
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
  function cheer(c, w) {
    S.cel = { text: c.text, until: c.end ? Infinity : performance.now() + 1500 };
    if (c.party) { burst([w === 1 ? COL[1].f : COL[0].f, "#fffbe6", w === 1 ? "#fff3b0" : "#bfe8a8"], c.end ? 160 : 70); if (S.soundOn) SND.goal(); }
    else if (S.soundOn) (c.end ? SND.sad : SND.whistle)();
  }
  function watch(F, v) {
    var w = WC.scorer(S.prevSc, v.sc);
    if (w >= 0) cheer(WC.goalText(F.md, w, v.sc, F.human, F.need, v.st === 2), w);
    else if (v.st === 2 && S.prevSt === 1 && !v.sc) { var w2 = v.b[1] < H / 2 ? 0 : 1; cheer(WC.goalText(F.md, w2, null, F.human, F.need, true), w2); }   // a server without scores
    else if (v.st === 3 && S.prevSt !== 3) cheer(WC.timeUpText(F.md), -1);
    if (v.sc) S.prevSc = v.sc.slice();
    S.prevSt = v.st;
  }

  /* ---------- the frame ---------- */
  var lastT = 0, demoShown = true;
  function frame(t) {
    var dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
    try {
      fit();
      var F = S.F, now = performance.now(), v = null, info;
      var liveOn = !!(F && F.buf.length && now - F.lastAt < 2500 && !(F.endAt && now > F.endAt + HOLD));
      if (liveOn) {
        v = WC.sample(F.buf, now - DELAY);
        if (demoShown) { S.prevSc = v.sc ? v.sc.slice() : null; S.prevSt = v.st; S.trail = []; S.cel = null; demoShown = false; }   // joined mid-match: no stale cheer
        else watch(F, v);
        info = { live: true, md: F.md, need: F.need, cats: F.cats, bots: F.bots };
      } else {
        if (!demoShown) { demoShown = true; S.cel = null; newDemo(); }
        v = demoFrame(dt);
        info = { live: false, md: 0, need: null, cats: DEMO_CATS, bots: [[1, 1, 1], [1, 1, 1]] };
      }
      if (S.cel && now > S.cel.until) S.cel = null;
      if (!v) v = { st: 0, tl: 60000, gw: 28, b: [W / 2, H / 2], p: [], sc: null };
      if (!REDUCED) { S.trail.push([v.b[0], v.b[1]]); if (S.trail.length > 12) S.trail.shift(); }
      render(v, info, dt);
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
      var A = window.AudioContext || window.webkitAudioContext;
      if (!AC && A) { try { AC = new A(); } catch (e) { AC = null; } }
      if (AC && AC.state === "suspended" && AC.resume) AC.resume();
      S.soundOn = !S.soundOn; paint(); if (S.soundOn) SND.whistle(); wake(); show();
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
    if (mode !== "live") { var tg = $("#test"); tg.hidden = false; tg.textContent = mode === "fake" ? "FAKE FEED" : "TEST SERVER"; }
    controls(); fit(); window.addEventListener("resize", fit);
    connect(); health(); setInterval(health, 30000);
    requestAnimationFrame(frame);
  });
})();
