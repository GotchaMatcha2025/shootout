/* Gotcha Shootout — shared by every page: settings the page needs before the server answers, helpers, phone storage, the server
   client, sounds (made in the browser: no audio files) and confetti. The server (shootout-server) decides every result. */
"use strict";

/* ---------- copy and fallbacks. Prices / prizes / odds / hours come from the server's /config; these are only shown if it can't be reached ---------- */
const CONFIG = {
  address: "https://gotchamatcha2025.github.io/shootout/",   // printed on the banner (11 Nov 2026): never move
  addressShort: "gotchamatcha2025.github.io/shootout",
  where: "OCBC Arena / Kallang Wave Mall event",
  company: { name: "Gotcha Matcha", legal: "Gotcha Matcha Pte Ltd (UEN 202435893D)" },   // GRA: the rules name the organiser (DECISIONS 12 Nov ~11:30)
  prices: { matcha: 6, yuzu: 5, trio: 16 },   // the OCBC menu (DECISIONS 12 Nov ~12:45): matcha = the cheapest one, yuzu = either sparkling tea, trio = "3 for $16"
  prizeMinutes: 15, graceMinutes: 15, stopBeforeCloseMinutes: 20,
  headlines: [
    "Hat trick = a free matcha with your next drink.",
    "Shoot your shot ⚽ Everyone wins something",
    "Think you can score? Prove it.",
    "@ODDS"                                  // "Only 1 in N get a hat trick." once there are enough rounds
  ],
  lastDayHeadline: "LAST DAY! Last chance for the Hall of Fame.",
  headlineSeconds: 20,
  copy: {
    startCup: "3 shots. 1 keeper. Your name on the big screen.",
    startFree: "1 free shot. Beat our keeper.",
    hat: "HAT TRICK. You're on the wall, legend 🎩",
    two: "Not bad! Your free yuzu's waiting 👇",
    one: "One in! Here's $1 off your next drink.",
    none: "Keeper's on fire tonight 😤 Here's $1 off to soften the blow.",
    freeMiss: "SO close. The keeper got lucky.",
    freeGoal: "GOAL! Now score 3 in a row for a free matcha.",
    afterFree: "Buy a drink → unlock 3 more shots + bigger prizes",
    booth: "The booth is right behind you 👀"
  },
  prizeRules: "One prize per order. Prize drinks don't get a cup card. One cup card per paid drink."
};
// the menu rows (no-go page + after a free shot), in one place; "from": matcha has 4 prices and the server sends the cheapest
CONFIG.menuRows = () => { const P = CONFIG.prices;
  return "<div><span>Matcha</span><span>from " + money(P.matcha) + "</span></div><div><span>Sparkling tea</span><span>" + money(P.yuzu) + "</span></div>" +
    "<div><span>Latte + Strawberry Latte +\u00a0sparkling</span><span>3 for " + money(P.trio) + "</span></div>"; };   // no-break space: a 375 px phone breaks before "+ sparkling"

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const J = globalThis.ShootJudge;
const clamp = J.clamp;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pad2 = n => String(n).padStart(2, "0");
const SGT_FMT = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
const clock = ts => SGT_FMT ? SGT_FMT.format(new Date(ts)) : (d => pad2(d.getHours()) + ":" + pad2(d.getMinutes()))(new Date(ts));   // always Singapore time
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + pad2(s % 60); };
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const money = n => "$" + (Number.isInteger(n) ? n : Number(n).toFixed(2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* not on iPhone */ } };
const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
function randomId(n){
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", out = [];
  const b = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(b);
  for (let i = 0; i < n; i++) out.push(abc[b[i] & 63]);
  return out.join("");
}
// the visible screen height on phones (iOS bars come and go); CSS reads --appH
function sizeApp(){ document.documentElement.style.setProperty("--appH", window.innerHeight + "px"); }

/* ---------- phone storage: every key starts "shootout:" (the spin page lives on the same site). Private mode / blocked storage → memory only ---------- */
const Store = {
  mem: {},
  get(k){ try { const v = localStorage.getItem(k); return v == null ? (k in this.mem ? this.mem[k] : null) : JSON.parse(v); } catch (e) { return k in this.mem ? this.mem[k] : null; } },
  set(k, v){ this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* memory only */ } },
  del(k){ delete this.mem[k]; try { localStorage.removeItem(k); } catch (e) { /* memory only */ } }
};

/* ---------- the server ---------- */
const Api = (() => {
  const BASES = { live: "https://gotcha-shootout.long-fog-ae60.workers.dev", staging: "https://gotcha-shootout-staging.long-fog-ae60.workers.dev", local: "http://127.0.0.1:8787" };
  let mode = null;
  try { mode = new URLSearchParams(location.search).get("api"); } catch (e) { mode = null; }
  try { if (mode && BASES[mode]) sessionStorage.setItem("shootout:api", mode); else mode = sessionStorage.getItem("shootout:api"); } catch (e) { /* no session storage */ }
  if (!BASES[mode]) mode = (location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ? "staging" : "live";
  const base = BASES[mode];
  let offset = 0;                       // server clock − phone clock, so countdowns don't trust a wrong phone clock
  async function post(path, body, ms){
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), ms || 6000);
    try {
      const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
        signal: ctl ? ctl.signal : undefined, cache: "no-store", credentials: "omit" });
      let out = null; try { out = await res.json(); } catch (e) { out = null; }
      if (!out || typeof out !== "object") return { ok: false, code: "network", message: "No answer from the game server.", status: res.status };
      if (typeof out.now === "number") offset = out.now - Date.now();
      out.status = out.status || res.status;
      return out;
    } catch (e) {
      return { ok: false, code: e && e.name === "AbortError" ? "timeout" : "network", message: "Weak signal." };
    } finally { clearTimeout(timer); }
  }
  return { mode, base, post, now: () => Date.now() + offset, test: mode !== "live" };
})();
// phone storage is kept apart per server, so a staging test never leaves a ghost prize or a "free shot used" on the live game (review M1)
const NS = "shootout:" + (Api.mode === "live" ? "" : Api.mode + ":");

/* ---------- sound: synthesised with Web Audio (no files to download, nothing to licence). Off until the first tap (browser rule). ---------- */
const Sfx = {
  ctx: null, master: null, noiseBuf: null, on: true, bedNodes: null,
  init(defaultOn){ const v = Store.get("shootout:sound"); this.on = v === null ? defaultOn : !!v; },
  unlock(){   // call from inside a tap
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx){
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
      const c = this.ctx, comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master = c.createGain(); this.master.gain.value = this.on ? 0.9 : 0; this.master.connect(comp); comp.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);   // iOS unlock
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  },
  setOn(v){
    this.on = !!v; Store.set("shootout:sound", this.on);
    if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  },
  ready(){ return !!(this.ctx && this.on && this.ctx.state === "running"); },
  env(g, t, a, peak, hold, rel){
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  },
  tone(f, t, dur, o){
    o = o || {}; const c = this.ctx, osc = c.createOscillator(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.lp){ const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.lp; osc.connect(lp); node = lp; }
    this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    node.connect(g); g.connect(o.dest || this.master); osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  },
  noise(t, dur, o){
    o = o || {}; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    f.Q.value = o.q || 1;
    this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    s.connect(f); f.connect(g); g.connect(o.dest || this.master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return { s, f, g };
  },
  play(name, arg){
    if (!this.ready()) return;
    const fn = this.S[name]; if (!fn) return;
    try { fn.call(this, this.ctx.currentTime + 0.01, arg); } catch (e) { /* a sound must never break the game */ }
  },
  // a looping stadium murmur under the game; level 0..1
  bed(level){
    if (!this.ready()){ return; }
    const c = this.ctx, t = c.currentTime;
    if (!this.bedNodes){
      const g = c.createGain(); g.gain.value = 0.0001; g.connect(this.master);
      const layers = [[520, 0.5, 0.9], [1300, 0.7, 0.45], [2600, 0.8, 0.18]].map(([f, q, k], i) => {
        const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
        const lg = c.createGain(); lg.gain.value = k;
        const lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 0.13 + i * 0.07; lfoG.gain.value = k * 0.35;
        lfo.connect(lfoG); lfoG.connect(lg.gain); s.connect(bp); bp.connect(lg); lg.connect(g);
        s.start(t, Math.random() * 1.5); lfo.start(t);
        return [s, lfo];
      });
      this.bedNodes = { g, layers };
    }
    this.bedNodes.g.gain.setTargetAtTime(Math.max(0.0001, 0.07 * level), t, 0.6);
  },
  bedStop(){
    if (!this.bedNodes || !this.ctx) return;
    const n = this.bedNodes, t = this.ctx.currentTime; this.bedNodes = null;
    n.g.gain.setTargetAtTime(0.0001, t, 0.3);
    setTimeout(() => { n.layers.forEach(([s, l]) => { try { s.stop(); l.stop(); } catch (e) { /* stopped */ } }); try { n.g.disconnect(); } catch (e) { /* gone */ } }, 1500);
  },
  // a rising tone while staff hold the redeem button; returns a stop function
  holdTone(){
    if (!this.ready()) return () => {};
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.9);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    o.connect(g); g.connect(this.master); o.start(t);
    return () => { const n = c.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.03); o.stop(n + 0.2); };
  },
  S: {
    tap(t){ this.tone(700, t, 0.08, { f2: 460, type: "triangle", gain: 0.14 }); },
    whistle(t){
      const blast = (t0, d) => {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
        o.type = "sine"; o.frequency.value = 2950; l.frequency.value = 36; lg.gain.value = 150; l.connect(lg); lg.connect(o.frequency);
        this.env(g, t0, 0.012, 0.13, d - 0.07, 0.05); o.connect(g); g.connect(this.master);
        o.start(t0); l.start(t0); o.stop(t0 + d + 0.05); l.stop(t0 + d + 0.05);
        this.noise(t0, d, { type: "highpass", f: 3500, gain: 0.03 });
      };
      blast(t, 0.16); blast(t + 0.24, 0.46);
    },
    kick(t){ this.tone(150, t, 0.22, { f2: 42, gain: 0.95 }); this.noise(t, 0.05, { type: "highpass", f: 1800, gain: 0.3 }); },
    whoosh(t, dur){ dur = dur || 0.6; this.noise(t, dur, { type: "bandpass", f: 450, f2: 2600, q: 1.3, a: dur * 0.65, gain: 0.2 }); },
    net(t){ this.noise(t, 0.5, { type: "bandpass", f: 3400, f2: 1800, q: 0.8, gain: 0.26 }); this.noise(t + 0.02, 0.7, { type: "lowpass", f: 900, gain: 0.14, a: 0.02 }); },
    roar(t, big){
      const len = big ? 3.6 : 2.6, lvl = big ? 0.62 : 0.5;
      [[420, 0.7], [900, 0.95], [1700, 0.6], [3000, 0.32]].forEach(([f, k], i) => {
        const n = this.noise(t, len, { type: "bandpass", f: f * 0.8, f2: f * 1.15, bend: 0.7, q: 0.9, a: 0.16, hold: len * 0.38, gain: lvl * k * 0.55 });
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = 4 + i * 2.3 + Math.random() * 3; lg.gain.value = lvl * k * 0.16;
        lfo.connect(lg); lg.connect(n.g.gain); lfo.start(t); lfo.stop(t + len + 0.1);
      });
    },
    horn(t){ [233, 294, 349].forEach((f, i) => this.tone(f, t, 0.95, { type: "sawtooth", lp: 1900, a: 0.03, hold: 0.62, gain: 0.11, f2: f * 0.94, bend: 0.95, detune: (i - 1) * 6 })); },
    ooh(t){ this.noise(t, 1.1, { f: 400, f2: 300, q: 4, a: 0.14, hold: 0.3, gain: 0.42 }); this.noise(t, 1.1, { f: 850, f2: 680, q: 5, a: 0.14, hold: 0.3, gain: 0.22 }); },
    glove(t){ this.tone(120, t, 0.14, { f2: 60, gain: 0.7 }); this.noise(t, 0.09, { type: "lowpass", f: 700, gain: 0.5 }); },
    clang(t){
      [[523, 1.1, 0.34], [1308, 0.8, 0.24], [2192, 0.55, 0.17], [3402, 0.32, 0.11]].forEach(([f, d, g]) => this.tone(f, t, d, { a: 0.002, gain: g }));
      this.noise(t, 0.035, { type: "highpass", f: 4000, gain: 0.3 });
    },
    groan(t){ this.noise(t, 1.2, { f: 560, f2: 290, q: 3, a: 0.1, hold: 0.25, gain: 0.4 }); this.noise(t, 1.2, { f: 1150, f2: 700, q: 4, a: 0.1, hold: 0.25, gain: 0.2 }); },
    fanfare(t){
      [523, 659, 784, 1047].forEach((f, i) => {
        const d = i === 3 ? 0.9 : 0.16, at = t + i * 0.12;
        this.tone(f, at, d, { type: "square", gain: 0.07, lp: 3200, hold: i === 3 ? 0.5 : 0 }); this.tone(f, at, d, { type: "triangle", gain: 0.13, hold: i === 3 ? 0.5 : 0 });
      });
      this.S.horn.call(this, t + 0.55);
    },
    pop(t){ this.noise(t, 0.28, { type: "highpass", f: 1100, gain: 0.32 }); for (let i = 0; i < 7; i++) this.noise(t + 0.15 + Math.random() * 0.5, 0.03, { type: "highpass", f: 3500, gain: 0.12 }); },
    chime(t){
      [1319, 1568, 1976, 2637].forEach((f, i) => this.tone(f, t + i * 0.065, 0.6, { type: "triangle", gain: 0.11 }));
      this.tone(880, t, 1.3, { gain: 0.12 }); this.tone(880 * 2.76, t, 0.8, { gain: 0.04 });
    },
    coin(t){ this.tone(988, t, 0.09, { type: "square", gain: 0.08, lp: 4000 }); this.tone(1319, t + 0.08, 0.4, { type: "square", gain: 0.08, lp: 4000 }); },
    tick(t){ this.tone(1800, t, 0.03, { type: "square", gain: 0.05, lp: 5000 }); },
    heart(t){ this.tone(72, t, 0.13, { f2: 48, gain: 0.55 }); this.tone(66, t + 0.19, 0.15, { f2: 44, gain: 0.45 }); },
    sad(t){ [392, 370, 349, 330].forEach((f, i) => this.tone(f, t + i * 0.22, 0.32, { type: "triangle", gain: 0.12, f2: f * 0.97 })); }
  }
};

/* ---------- confetti on a canvas overlay (phone + wall) ---------- */
class Confetti {
  constructor(canvas, w, h){ this.c = canvas; this.g = canvas.getContext("2d"); this.p = []; this.fixedW = w; this.fixedH = h; }
  size(){
    if (this.fixedW) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = this.c.clientWidth, h = this.c.clientHeight;
    if (this.c.width !== Math.round(w * dpr)){ this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    this.W = w; this.H = h;
  }
  burst(n, opt){
    if (REDUCED) return;
    this.size(); opt = opt || {};
    const W = this.fixedW || this.W, cols = opt.colors || ["#F5F0E5", "#BE6E4A", "#8EE07A", "#ffffff", "#F2B15C", "#5f8f6c"];
    const x0 = opt.x != null ? opt.x : W / 2, y0 = opt.y != null ? opt.y : -10, spread = opt.spread || W * 0.6, up = !!opt.up;
    for (let i = 0; i < n; i++){
      const shape = i % 7 === 0 ? "leaf" : i % 3 === 0 ? "dot" : "rect";
      this.p.push({ x: x0 + (Math.random() - 0.5) * spread, y: y0 - Math.random() * (up ? 0 : 160),
        vx: (Math.random() - 0.5) * (up ? 520 : 140), vy: up ? -(380 + Math.random() * 420) : 60 + Math.random() * 200,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, w: 5 + Math.random() * 7, h: 3 + Math.random() * 5, c: cols[i % cols.length], shape, life: 4.5 });
    }
  }
  frame(dt){
    this.size(); const g = this.g, W = this.fixedW || this.W, H = this.fixedH || this.H, P = this.p;
    g.clearRect(0, 0, W, H); if (!P.length) return;
    for (let i = P.length - 1; i >= 0; i--){
      const p = P[i]; p.vy += 260 * dt; p.vx *= (1 - dt * 0.9); p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= dt;
      if (p.y > H + 20 || p.life <= 0){ P.splice(i, 1); continue; }
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
      if (p.shape === "dot"){ g.beginPath(); g.arc(0, 0, p.h * 0.6, 0, 6.283); g.fill(); }
      else if (p.shape === "leaf"){ g.fillStyle = "#6fae5d"; g.beginPath(); g.ellipse(0, 0, p.w * 0.9, p.h * 0.5, 0, 0, 6.283); g.fill(); }
      else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      g.restore();
    }
  }
}

/* ---------- QR codes. The wall uses the banner's own QR (the printed one, scan-checked 11 Nov) ---------- */
const BANNER_QR = ["111111101011001110001010001111111","100000101101101111000000101000001","101110100011111011110100101011101","101110100101111010001101101011101",
"101110100110101110100101001011101","100000100100101000101000001000001","111111101010101010101010101111111","000000000101110000111011100000000","010000111111110111111010110000011",
"000100011010001110011111000011100","110101101001101100101010000010110","001011001110000000000011101111101","111011100110001011111001011100000","110000011001100000010101001101111",
"100110101100101000000110011001010","100110010011110010000001010111101","000011110001011011100011110110001","000010010011011000011101001001101","110010110001101000011001100101111",
"010111001000000100000010001011110","100100100100111110111010110011010","110010001101101100110001100110000","100001110100001001001100010101110","100001011000101100101011011011100",
"111111110011000110111000111110000","000000001000011110011011100010111","111111101110111111001111101010100","100000100001000101011011100011100","101110100000010100101010111111000",
"101110100100001011011001010111101","101110100001000111010100010111111","100000101110101011011000001111100","111111100100000001010011110100010"];
function qrSvg(rows, dark){
  const n = rows.length; let d = "";
  rows.forEach((s, r) => { for (let c = 0; c < n; c++) if (s[c] === "1") d += "M" + c + " " + r + "h1v1h-1z"; });
  return '<svg viewBox="-1 -1 ' + (n + 2) + " " + (n + 2) + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><path d="' + d + '" fill="' + (dark || "#0b120d") + '"/></svg>';
}
function qrFor(text){
  if (typeof qrcode !== "function") return '<div style="font:900 16px var(--font);color:#14211a;text-align:center;padding-top:30%;word-break:break-all">' + esc(text) + "</div>";
  const q = qrcode(0, "Q"); q.addData(text); q.make(); const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++){ let s = ""; for (let c = 0; c < n; c++) s += q.isDark(r, c) ? "1" : "0"; rows.push(s); }
  return qrSvg(rows);
}
