/* Gotcha Shootout — the pitch: hand-made perspective on a plain 2D canvas (looks 3D, no WebGL, runs on old phones and the projector's
   browser) + stadium lighting: floodlight towers with light cones and flares, sweeping beams, camera flashes in the crowd, a glowing ball
   with a trail, fireworks, a goal flash and a slow-motion moment. Reduced motion: no flash, shake, slow-motion, fireworks or sweeping. */
"use strict";
const Loop = {
  items: new Set(), last: 0,
  add(x){ this.items.add(x); },
  start(){
    const step = ts => {
      const dt = Math.min(0.05, (ts - (this.last || ts)) / 1000); this.last = ts;
      this.items.forEach(it => { if (it.visible()){ try { it.frame(dt); } catch (e) { console.error(e); } } });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
};

const GOAL = J.GOAL;
const KIT = { shirt: "#BE6E4A", shirtDark: "#9b5638", shorts: "#1d2c23", skin: "#c58c5f", hair: "#1a120c", glove: "#F5F0E5", sock: "#F5F0E5" };
const AD_TEXT = () => "GOTCHA MATCHA  ·  WE GOTCHA  ·  MATCHA " + money(CONFIG.prices.matcha) + "  ·  TRIO " + money(CONFIG.prices.trio) + "  ·  ";
function sprite(w, h, paint){ const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); paint(c.getContext("2d"), c.width, c.height); return c; }

class Pitch {
  constructor(canvas, opt){
    this.c = canvas; this.g = canvas.getContext("2d");
    this.o = Object.assign({ camZ: 17.5, camY: 1.75, lookY: 0.95, fit: 0.86, cy: 0.40, maxDpr: 2, attract: false, slowmo: false }, opt || {});
    this.t = 0; this.ev = {}; this.trail = []; this.trailA = 0; this.inputOn = false; this.inputCb = null;
    this.k = { F: { x: 0, y: 0 }, phi: 0, mode: "idle", t: 0, spread: 0.05, hands: null };
    this.ball = { x: 0, y: GOAL.ball, z: 11, vx: 0, vy: 0, vz: 0, spin: 0, mode: "rest", u: 0, a: 1 };
    this.net = { x: 0, y: 1, t: 99 };
    this.shake = 0; this.attractT = 1.2; this.queue = []; this.label = ""; this.adX = 0; this.after = 0;
    this.flashA = 0; this.quake = 0; this.partyT = 0; this.slowT = 0; this.rockets = []; this.sparks = []; this.btrail = []; this.flashes = [];
    this.perf = { n: 0, sum: 0 }; this.lite = false;
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindInput();
    Loop.add(this);
  }
  on(n, f){ (this.ev[n] || (this.ev[n] = [])).push(f); }
  emit(n, a){ (this.ev[n] || []).slice().forEach(f => f(a)); }
  once(n, f){ const w = a => { this.ev[n] = (this.ev[n] || []).filter(x => x !== w); f(a); }; this.on(n, w); }
  visible(){ return !this.paused && this.c.offsetParent !== null && this.c.clientWidth > 0; }
  setCy(v){ if (this.o.cy === v) return; this.o.cy = v; this.W = 0; this.resize(); }
  resize(){
    const w = this.c.clientWidth, h = this.c.clientHeight; if (!w || !h) return;
    const dpr = Math.min(this.o.maxDpr, window.devicePixelRatio || 1);
    if (this.W === w && this.H === h && this.dpr === dpr) return;
    this.W = w; this.H = h; this.dpr = dpr;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    const o = this.o, th = Math.atan2(o.camY - o.lookY, o.camZ);
    this.sn = Math.sin(th); this.cs = Math.cos(th);
    this.f = Math.min(o.fit * w * o.camZ / 7.32, h * 0.30 * o.camZ / 2.44);
    this.cx = w / 2; this.cy = h * o.cy;
    this.buildBackdrop();
  }
  P(x, y, z){
    const Y = y - this.o.camY, D = this.o.camZ - z;
    const depth = -Y * this.sn + D * this.cs, up = Y * this.cs + D * this.sn, s = this.f / Math.max(depth, 0.05);
    return { x: this.cx + x * s, y: this.cy - up * s, s, d: depth };
  }
  line(g, a, b, wm, color){   // world segment, width in metres, clipped in front of the camera
    let A = a.slice(), B = b.slice();
    const dA = this.o.camZ - A[2], dB = this.o.camZ - B[2], minD = 1.2;
    if (dA < minD && dB < minD) return;
    if (dA < minD){ const t = (minD - dA) / (dB - dA); A = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]; }
    if (dB < minD){ const t = (minD - dB) / (dA - dB); B = [lerp(B[0], A[0], t), lerp(B[1], A[1], t), lerp(B[2], A[2], t)]; }
    const p = this.P(A[0], A[1], A[2]), q = this.P(B[0], B[1], B[2]);
    g.strokeStyle = color; g.lineWidth = Math.max(1, wm * (p.s + q.s) / 2);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  }
  /* ---------- the still picture (redrawn only on resize): sky, towers, stands, pitch, lines + the light sprites ---------- */
  buildBackdrop(){
    const W = this.W, H = this.H, d = this.dpr;
    const bg = this.bg || (this.bg = document.createElement("canvas"));
    bg.width = this.c.width; bg.height = this.c.height;
    const g = bg.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0);
    const r = mulberry32(3);
    const yStandTop = this.P(0, 9, -22).y, yStandBot = this.P(0, 0, -6).y;
    this.yStandTop = yStandTop; this.yStandBot = yStandBot;
    // night sky
    const sky = g.createLinearGradient(0, 0, 0, yStandBot); sky.addColorStop(0, "#03070a"); sky.addColorStop(1, "#0d1a12");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // floodlight towers (screen space, at the top corners) — poles + lamp grids
    const lampY = Math.max(10, yStandTop - Math.max(18, H * 0.06)), lw = Math.max(26, W * 0.11);
    this.lamps = [{ x: W * 0.09, y: lampY }, { x: W * 0.91, y: lampY }];
    this.lamps.forEach(L => {
      g.fillStyle = "#0b1410"; g.fillRect(L.x - 2, L.y, 4, yStandTop - L.y + 6);
      g.fillStyle = "#1a2a21"; g.fillRect(L.x - lw / 2 - 3, L.y - 9, lw + 6, 20);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++){
        const x = L.x - lw / 2 + (i + 0.5) * lw / 6, y = L.y - 4 + j * 9;
        g.fillStyle = "#fff8e6"; g.beginPath(); g.arc(x, y, Math.max(1.6, lw * 0.035), 0, 6.283); g.fill();
      }
    });
    // stands + crowd
    g.fillStyle = "#0a140e"; g.fillRect(0, yStandTop, W, yStandBot - yStandTop);
    const cols = ["#2c4436", "#3a5444", "#5b6e5f", "#BE6E4A", "#d9cfbd", "#1f3328", "#7a5a44", "#8EE07A", "#46604f"];
    const rows = 14;
    for (let i = 0; i < rows; i++){
      const t = i / (rows - 1), y = lerp(yStandBot - 6, yStandTop + 4, t), size = lerp(4.2, 2.2, t) * Math.max(1, W / 420);
      const step = size * 1.9;
      for (let x = -4 + r() * step; x < W + 4; x += step * (0.8 + r() * 0.5)){
        g.globalAlpha = 0.45 + r() * 0.45; g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.beginPath(); g.arc(x, y + (r() - 0.5) * size, size * 0.55, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "rgba(245,240,229,0.18)"; g.fillRect(0, yStandBot - 2, W, 2);
    // pitch with mowing stripes
    for (let z = -6, i = 0; z < this.o.camZ - 0.6; z += 2.2, i++){
      const y1 = this.P(0, 0, z).y, y2 = this.P(0, 0, Math.min(z + 2.2, this.o.camZ - 0.6)).y;
      g.fillStyle = i % 2 ? "#174126" : "#1b4a2c"; g.fillRect(0, y1, W, Math.max(1, y2 - y1 + 1));
    }
    g.fillStyle = "#1b4a2c"; g.fillRect(0, this.P(0, 0, this.o.camZ - 0.6).y, W, H);
    const vg = g.createLinearGradient(0, yStandBot, 0, H); vg.addColorStop(0, "rgba(4,9,6,0.55)"); vg.addColorStop(0.5, "rgba(4,9,6,0)"); vg.addColorStop(1, "rgba(4,9,6,0.35)");
    g.fillStyle = vg; g.fillRect(0, yStandBot, W, H - yStandBot);
    // the floodlit box: a warm pool of light on the grass around the goal and the spot
    const pool = this.P(0, 0, 4.5), pr = Math.max(W, H) * 0.55;
    g.save(); g.globalCompositeOperation = "lighter";
    const pg = g.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, pr); pg.addColorStop(0, "rgba(255,240,200,0.16)"); pg.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = pg; g.fillRect(0, yStandBot, W, H - yStandBot); g.restore();
    // lines
    g.lineCap = "round";
    const L = "rgba(245,240,229,0.8)", lwm = 0.12;
    this.line(g, [-30, 0, 0], [30, 0, 0], lwm, L);
    this.line(g, [-9.16, 0, 0], [-9.16, 0, 5.5], lwm, L); this.line(g, [9.16, 0, 0], [9.16, 0, 5.5], lwm, L); this.line(g, [-9.16, 0, 5.5], [9.16, 0, 5.5], lwm, L);
    this.line(g, [-20.16, 0, 0], [-20.16, 0, 16.5], lwm, L); this.line(g, [20.16, 0, 0], [20.16, 0, 16.5], lwm, L);
    const ps = this.P(0, 0, 11); g.fillStyle = L; g.beginPath(); g.ellipse(ps.x, ps.y, 0.16 * ps.s, 0.05 * ps.s, 0, 0, 6.283); g.fill();
    // ad board frame (the scrolling LED text is drawn per frame)
    const a1 = this.P(-18, 0.95, -3.4), a2 = this.P(18, 0, -3.4);
    this.ad = { x: a1.x, y: a1.y, w: a2.x - a1.x, h: a2.y - a1.y, s: a1.s };
    g.fillStyle = "#07100b"; g.fillRect(a1.x, a1.y, a2.x - a1.x, a2.y - a1.y);
    g.fillStyle = "rgba(142,224,122,0.35)"; g.fillRect(a1.x, a1.y, a2.x - a1.x, Math.max(1, 0.03 * a1.s));
    this.buildLights();
  }
  buildLights(){
    const W = this.W, H = this.H, d = this.dpr;
    // light cones from both towers down onto the goal mouth (one still layer, drawn with a flicker)
    this.cones = sprite(W * d, H * d, (g) => {
      g.setTransform(d, 0, 0, d, 0, 0); g.globalCompositeOperation = "lighter";
      const tgt = this.P(0, 0, 1.5), half = Math.max(W * 0.55, this.P(GOAL.half * 2.2, 0, 1.5).x - tgt.x);
      this.lamps.forEach(Lp => {
        const gr = g.createLinearGradient(Lp.x, Lp.y, tgt.x, tgt.y);
        gr.addColorStop(0, "rgba(255,246,222,0.20)"); gr.addColorStop(0.55, "rgba(255,246,222,0.07)"); gr.addColorStop(1, "rgba(255,246,222,0)");
        g.fillStyle = gr; g.beginPath(); g.moveTo(Lp.x - 6, Lp.y); g.lineTo(Lp.x + 6, Lp.y); g.lineTo(tgt.x + half, tgt.y + H * 0.08); g.lineTo(tgt.x - half, tgt.y + H * 0.08); g.closePath(); g.fill();
      });
    });
    // lamp flare: round glow + a long horizontal streak
    const fs = Math.max(90, Math.min(W, H) * 0.45);
    this.flare = sprite(fs, fs, (g, w, h) => {
      const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      rg.addColorStop(0, "rgba(255,252,240,0.95)"); rg.addColorStop(0.12, "rgba(255,240,205,0.55)"); rg.addColorStop(0.4, "rgba(242,177,92,0.14)"); rg.addColorStop(1, "rgba(242,177,92,0)");
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
    });
    this.streak = sprite(fs * 2.4, fs * 0.16, (g, w, h) => {
      const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, "rgba(255,240,210,0)"); lg.addColorStop(0.5, "rgba(255,240,210,0.55)"); lg.addColorStop(1, "rgba(255,240,210,0)");
      g.fillStyle = lg; g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 6.283); g.fill();
    });
    // a sweeping search beam (drawn rotated around its foot)
    const bw = Math.max(60, W * 0.2), bh = Math.max(H, W) * 1.25;
    const beam = (rgb) => sprite(bw, bh, (g, w, h) => {
      const lg = g.createLinearGradient(0, h, 0, 0); lg.addColorStop(0, "rgba(" + rgb + ",0.55)"); lg.addColorStop(0.5, "rgba(" + rgb + ",0.14)"); lg.addColorStop(1, "rgba(" + rgb + ",0)");
      g.fillStyle = lg; g.beginPath(); g.moveTo(w * 0.47, h); g.lineTo(w * 0.53, h); g.lineTo(w, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    });
    this.beamWarm = beam("255,244,214"); this.beamGreen = beam("142,224,122");
    // edge vignette
    this.vig = sprite(W * d, H * d, (g, w, h) => {
      const rg = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.78);
      rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, "rgba(0,0,0,0.55)"); g.fillStyle = rg; g.fillRect(0, 0, w, h);
    });
  }
  /* ---------- input: swipe up to shoot ---------- */
  bindInput(){
    const c = this.c; let pts = null, id = null;
    const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (this.W / r.width), y: (e.clientY - r.top) * (this.H / r.height), t: performance.now() }; };
    c.addEventListener("pointerdown", e => {
      if (!this.inputOn) return;
      const p = pos(e); if (p.y < this.H * 0.28) return;
      id = e.pointerId; try { c.setPointerCapture(id); } catch (err) { /* old browser */ }
      pts = [p]; this.trail = pts; this.trailA = 1; e.preventDefault();
    });
    c.addEventListener("pointermove", e => { if (!pts || e.pointerId !== id) return; pts.push(pos(e)); if (pts.length > 80) pts.splice(1, 1); });
    const end = e => {
      if (!pts || e.pointerId !== id) return;
      const p = pts; pts = null;
      if (this.inputCb) this.inputCb(Pitch.swipeToAim(p, this.W, this.H));
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => { pts = null; this.trail = []; });
  }
  static swipeToAim(pts, W, H){
    if (!pts || pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (dy > -24 || len < 34) return null;
    const dur = Math.max(40, b.t - a.t), speed = len / dur, L = len / H;
    const power = clamp(speed / 1.6, 0.25, 1.3);
    const tx = clamp(7.6 * dx / -dy, -7, 7);
    const ty = clamp(-0.35 + L * 3.3 + power * 0.55, 0.05, 4.2);
    let dev = 0;
    for (const p of pts){ const c = ((p.x - a.x) * dy - (p.y - a.y) * dx) / len; if (Math.abs(c) > Math.abs(dev)) dev = c; }
    return { tx, ty, power, curve: clamp(-dev / len * 3, -1, 1) };
  }
  /* ---------- effects other pages trigger ---------- */
  celebrate(kind){   // "goal" | "hat"
    if (REDUCED){ this.partyT = 0; return; }
    this.flashA = kind === "hat" ? 1 : 0.8; this.quake = kind === "hat" ? 9 : 6; this.partyT = kind === "hat" ? 5 : 2.4;
    if (kind === "hat" && !this.lite) this.fireworks(7);
  }
  fireworks(n){
    if (REDUCED) return;
    for (let i = 0; i < n; i++) this.rockets.push({ x: this.W * (0.15 + Math.random() * 0.7), y: this.yStandTop, tx: 0, ty: this.yStandTop * (0.15 + Math.random() * 0.55), delay: i * 0.35 + Math.random() * 0.2,
      col: ["#F5F0E5", "#8EE07A", "#F2B15C", "#BE6E4A", "#ffffff"][i % 5] });
  }
  /* ---------- shots ---------- */
  kick(shot){
    const b = this.ball;
    Object.assign(b, { x: 0, y: GOAL.ball, z: 11, vx: 0, vy: 0, vz: 0, mode: "flight", u: 0, a: 1 });
    this.shot = Object.assign({ plan: null }, shot);
    this.T = clamp(0.82 - 0.24 * (shot.power || 0.7), 0.5, 0.82);
    this.ft = 0; this.waitT = 0; this.resolved = false; this.aborted = false; this.done = false; this.after = 0; this.slowDone = false; this.btrail = [];
    this.k.mode = "idle";
    this.emit("kick", { T: this.T });
  }
  setPlan(plan){ if (!this.shot || this.aborted) return; this.shot.plan = plan; if (plan.aim){ this.shot.tx = plan.aim.tx; this.shot.ty = plan.aim.ty; } }
  queueShot(spec){ this.queue.push(spec); if (this.queue.length > 4) this.queue.shift(); }
  reset(){
    Object.assign(this.ball, { x: 0, y: GOAL.ball, z: 11, vx: 0, vy: 0, vz: 0, mode: "rest", u: 0, a: 1 });
    this.shot = null; this.net.t = 99; this.resolved = false; this.done = true; this.curSpec = null; this.btrail = [];
    if (this.k.mode !== "idle"){ this.k.mode = "back"; this.k.t = 0; this.k.Fs = Object.assign({}, this.k.F); this.k.phis = this.k.phi; }
  }
  pathAt(u){
    const s = this.shot, h = 0.22 + (1 - clamp(s.power || 0.7, 0, 1.2)) * 0.5, bend = (s.curve || 0) * 1.1 * Math.sin(Math.PI * u);
    return { x: lerp(0, s.tx, u) + bend, y: lerp(GOAL.ball, s.ty, u) + h * 4 * u * (1 - u), z: lerp(11, 0, u) };
  }
  startDive(kp, dur){
    const k = this.k, H = { x: kp.hx, y: kp.hy }, s = Math.sign(H.x) || 1, ax = Math.abs(H.x);
    let Ff, phiF;
    if (ax < 1.0 && H.y < 1.85){ Ff = { x: H.x * 0.7, y: 0 }; phiF = s * 0.15 * ax; }
    else if (ax < 1.0){ Ff = { x: H.x * 0.6, y: Math.min(0.55, H.y - 1.75) }; phiF = s * 0.08; }
    else { phiF = s * clamp(Math.atan2(ax, Math.max(0.25, H.y - 0.25)), 0.4, 1.38); const L = 2.05; Ff = { x: H.x - Math.sin(phiF) * L, y: Math.max(0, H.y - Math.cos(phiF) * L) }; }
    Object.assign(k, { mode: "dive", p: 0, dur, F0: Object.assign({}, k.F), phi0: k.phi, Ff, phiF, H, t: 0 });
  }
  bodyPt(lx, ly){ const k = this.k, c = Math.cos(k.phi), s = Math.sin(k.phi); return { x: k.F.x + lx * c + ly * s, y: k.F.y - lx * s + ly * c }; }
  readyHands(){ return [this.bodyPt(-0.42, 1.02), this.bodyPt(0.42, 1.02)]; }
  targetHands(){
    const k = this.k, root = this.bodyPt(0, 1.36), dx = k.H.x - root.x, dy = k.H.y - root.y, dist = Math.hypot(dx, dy) || 1;
    const reach = Math.min(0.8, dist), ux = dx / dist, uy = dy / dist, px = -uy * 0.1, py = ux * 0.1;
    return [{ x: root.x + ux * reach + px, y: root.y + uy * reach + py }, { x: root.x + ux * reach - px, y: root.y + uy * reach - py }];
  }
  updateKeeper(dt){
    const k = this.k; k.t += dt;
    if (k.mode === "idle"){
      const sway = Math.sin(this.t * 2.1) * 0.22;
      k.F.x = lerp(k.F.x, sway, 1 - Math.exp(-dt * 6)); k.F.y = lerp(k.F.y, 0, 1 - Math.exp(-dt * 10)); k.phi = lerp(k.phi, 0, 1 - Math.exp(-dt * 8));
      k.spread = 0.05 + Math.abs(Math.sin(this.t * 4.2)) * 0.03; k.hands = this.readyHands();
    } else if (k.mode === "dive"){
      k.p = Math.min(1, k.p + dt / k.dur); const e = easeOut(k.p);
      k.F.x = lerp(k.F0.x, k.Ff.x, e); k.F.y = lerp(k.F0.y, k.Ff.y, Math.sin(k.p * Math.PI / 2)); k.phi = lerp(k.phi0, k.phiF, e); k.spread = lerp(0.05, 0.14, e);
      const r0 = this.readyHands(), t0 = this.targetHands();
      k.hands = [0, 1].map(i => ({ x: lerp(r0[i].x, t0[i].x, e), y: lerp(r0[i].y, t0[i].y, e) }));
      if (k.p >= 1){ k.mode = "hold"; k.t = 0; }
    } else if (k.mode === "hold"){
      k.hands = this.targetHands();
      if (k.t > 0.3){
        k.mode = "fall"; k.t = 0; k.Fs = Object.assign({}, k.F); k.phis = k.phi;
        const c = Math.cos(k.phi), s = Math.sin(k.phi);
        k.handsL = k.hands.map(h => { const dx = h.x - k.F.x, dy = h.y - k.F.y; return { x: dx * c - dy * s, y: dx * s + dy * c }; });
      }
    } else if (k.mode === "fall"){
      const e = easeInOut(Math.min(1, k.t / 0.35));
      k.F.y = lerp(k.Fs.y, 0, e);
      const target = Math.abs(k.phiF) > 0.45 ? Math.sign(k.phiF) * 1.42 : k.phiF * 0.4;
      k.phi = lerp(k.phis, target, e);
      k.hands = k.handsL.map(h => this.bodyPt(h.x, h.y));
    } else if (k.mode === "back"){
      const e = easeInOut(Math.min(1, k.t / 0.5));
      k.F.x = lerp(k.Fs.x, 0, e); k.F.y = lerp(k.Fs.y, 0, e); k.phi = lerp(k.phis, 0, e); k.spread = 0.05;
      const r0 = this.readyHands(); k.hands = k.hands ? k.hands.map((h, i) => ({ x: lerp(h.x, r0[i].x, 0.25), y: lerp(h.y, r0[i].y, 0.25) })) : r0;
      if (k.t >= 0.5) k.mode = "idle";
    }
  }
  resolve(outcome){ if (this.resolved) return; this.resolved = true; this.emit("resolve", { outcome, near: this.shot && this.shot.plan && this.shot.plan.near }); }
  updateBall(dt){
    const b = this.ball, s = this.shot;
    b.spin += dt * (b.mode === "rest" ? 0 : 14);
    if (b.mode === "flight"){
      let rate = 1;
      if (!s.plan && b.u > 0.7){ rate = 0.07; this.waitT += dt; if (this.waitT > 3){ this.abort(); return; } }
      this.ft += dt * rate;
      if (s.plan && this.k.mode === "idle" && this.ft > 0.16){
        const uk = (11 - 0.35) / 11, remain = Math.max(0.12, (uk - b.u) * this.T);
        this.startDive(s.plan.kp, clamp(remain, 0.14, 0.48));
      }
      // the slow-motion moment: a goal-bound ball slows right before the line
      if (this.o.slowmo && !REDUCED && !this.slowDone && s.plan && s.plan.outcome === "goal" && b.u > 0.8){ this.slowDone = true; this.slowT = 0.42; }
      b.u = Math.min(1, b.u + dt * rate / this.T);
      const p = this.pathAt(b.u); b.x = p.x; b.y = p.y; b.z = p.z;
      const oc = s.plan && s.plan.outcome;
      const vel = () => { const p2 = this.pathAt(Math.min(1, b.u + 0.01)), p1 = this.pathAt(Math.max(0, b.u - 0.01)); const k = 1 / (0.02 * this.T); return { vx: (p2.x - p1.x) * k, vy: (p2.y - p1.y) * k, vz: (p2.z - p1.z) * k }; };
      if (oc === "save" && b.z <= 0.45){
        const v = vel(), sx = b.x >= 0 ? 1 : -1;
        Object.assign(b, { vx: sx * (2 + Math.random() * 1.5), vy: b.y > 1.6 ? 4.5 : 2.2, vz: Math.abs(v.vz) * 0.28, mode: "free" });
        this.shake = 0.15; this.quake = Math.max(this.quake, 2.5); this.resolve("save");
      } else if (b.u >= 1 && s.plan){
        const v = vel();
        if (oc === "goal"){ Object.assign(b, v, { mode: "net" }); this.resolve("goal"); }
        else if (oc === "post"){ const sx = b.x >= 0 ? 1 : -1; Object.assign(b, { vx: sx * 3.5, vy: 1.2, vz: 3.2, mode: "free" }); this.shake = 0.4; this.quake = Math.max(this.quake, 3); this.resolve("post"); }
        else if (oc === "bar"){ Object.assign(b, { vx: v.vx * 0.3, vy: 4.2, vz: 2.6, mode: "free" }); this.shake = 0.4; this.quake = Math.max(this.quake, 3); this.resolve("bar"); }
        else { Object.assign(b, v, { mode: "free" }); this.resolve(oc); }
      }
    } else if (b.mode === "net"){
      const zb = -2.0 + clamp(b.y / GOAL.bar, 0, 1) * 1.0;
      b.vy -= 9.8 * dt * 0.4; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.z <= zb + 0.12 && this.net.t > 50){ this.net = { x: b.x, y: b.y, t: 0 }; b.vz = 0.8; b.vx *= 0.15; b.vy = Math.min(b.vy, 0); b.mode = "free"; this.emit("net"); }
    } else if (b.mode === "free"){
      b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.z < 0 && Math.abs(b.x) < GOAL.half && b.y < GOAL.bar){ const zb = -2.0 + clamp(b.y / GOAL.bar, 0, 1) * 1.0; if (b.z < zb + 0.12){ b.z = zb + 0.12; b.vz = Math.abs(b.vz) * 0.2; } }
      if (b.y < GOAL.ball && b.vy < 0){ b.y = GOAL.ball; b.vy = -b.vy * 0.42; b.vx *= 0.82; b.vz *= 0.82; if (Math.abs(b.vy) < 0.4) b.vy = 0; }
      if (b.z < -7) b.a = Math.max(0, b.a - dt * 4);
    }
    if (this.resolved && !this.done){ this.after += dt; if (this.after > 1.35){ this.done = true; this.emit("done", { outcome: s && s.plan ? s.plan.outcome : null }); } }
  }
  abort(){ this.aborted = true; this.ball.mode = "rest"; this.ball.a = 0; this.emit("timeout"); }
  update(dt){
    // a slow phone drops the extra lights after ~2 s of slow frames
    this.perf.n++; this.perf.sum += dt;
    if (this.perf.n >= 90){ if (this.perf.sum / this.perf.n > 0.034) this.lite = true; this.perf.n = 0; this.perf.sum = 0; }
    if (this.slowT > 0){ this.slowT -= dt; dt *= 0.28; }
    this.t += dt; this.adX += dt * 26; this.net.t += dt; this.shake = Math.max(0, this.shake - dt);
    this.flashA = Math.max(0, this.flashA - dt * 1.8); this.quake = Math.max(0, this.quake - dt * 14); this.partyT = Math.max(0, this.partyT - dt);
    if (this.trailA > 0 && !this.inputOn) this.trailA = Math.max(0, this.trailA - dt * 2.5);
    this.updateKeeper(dt); this.updateBall(dt); this.updateFireworks(dt);
    // self-driving: queued real shots (wall replays) first, else practice shots
    if (this.o.attract && this.ball.mode === "rest" && !this.shot){
      if (this.queue.length){ this.playAuto(this.queue.shift()); }
      else { this.attractT -= dt; if (this.attractT <= 0){ this.attractT = 2.2 + Math.random() * 1.5; this.playAuto(null); } }
    }
  }
  updateFireworks(dt){
    for (let i = this.rockets.length - 1; i >= 0; i--){
      const r = this.rockets[i];
      if (r.delay > 0){ r.delay -= dt; continue; }
      r.y -= dt * Math.max(140, this.H * 0.9);
      if (r.y <= r.ty){
        this.rockets.splice(i, 1); this.emit("boom");
        for (let k = 0; k < 46; k++){ const a = k / 46 * 6.283, v = (0.6 + Math.random() * 0.5) * Math.max(60, this.W * 0.28);
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.3 + Math.random() * 0.5, col: r.col }); }
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--){
      const s = this.sparks[i]; s.vy += 90 * dt; s.vx *= (1 - dt * 1.4); s.vy *= (1 - dt * 1.4); s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
  }
  playAuto(spec){
    if (!spec){
      const r = Math.random, aim = { tx: (r() * 2 - 1) * 3.3, ty: 0.3 + r() * 1.9 };
      const outcome = r() < 0.15 ? (r() < 0.5 ? "post" : "wide") : (r() < 0.55 ? "goal" : "save");
      if (outcome === "post") aim.tx = (aim.tx < 0 ? -1 : 1) * GOAL.half;
      if (outcome === "wide") aim.tx = (aim.tx < 0 ? -1 : 1) * (GOAL.half + 0.35);
      spec = { aim, outcome, kp: J.keeperPlan(outcome, aim, r), power: 0.6 + r() * 0.5, curve: (r() - 0.5) * 0.8, label: "", practice: true };
    }
    this.label = spec.label || "";
    this.kick({ tx: spec.aim.tx, ty: spec.aim.ty, power: spec.power, curve: spec.curve });
    this.curSpec = spec;
    this.setPlan({ outcome: spec.outcome, kp: spec.kp, aim: spec.aim, near: spec.near });
    this._auto = true;
    this.once("done", () => setTimeout(() => { if (this._auto){ this._auto = false; this.reset(); } }, 250));
  }
  /* ---------- drawing ---------- */
  frame(dt){ if (!this.W){ this.resize(); if (!this.W) return; } this.update(dt); this.draw(); }
  netPt(x, y, back){
    const zb = back ? -2.0 + clamp(y / GOAL.bar, 0, 1) * 1.0 : 0;
    let dz = 0;
    if (back && this.net.t < 3){ const tt = this.net.t, d2 = (x - this.net.x) ** 2 + (y - this.net.y) ** 2; dz = -0.75 * Math.exp(-d2 / 0.55) * Math.exp(-3.2 * tt) * Math.cos(9 * tt); }
    return this.P(x, y, zb + dz);
  }
  drawNet(g){
    g.strokeStyle = "rgba(245,240,229,0.34)"; g.lineWidth = 1;
    const xs = [], ys = [];
    for (let i = 0; i <= 20; i++) xs.push(-GOAL.half + i * (GOAL.half * 2 / 20));
    for (let j = 0; j <= 8; j++) ys.push(j * GOAL.bar / 8);
    g.beginPath();
    xs.forEach(x => { ys.forEach((y, j) => { const p = this.netPt(x, y, true); j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); });
    ys.forEach(y => { xs.forEach((x, i) => { const p = this.netPt(x, y, true); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); });
    [-GOAL.half, GOAL.half].forEach(x => { ys.forEach(y => { const a = this.P(x, y, 0), b = this.netPt(x, y, true); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); });
      for (let k = 1; k < 4; k++){ const zf = k / 4; g.moveTo(this.P(x, 0, -2 * zf).x, this.P(x, 0, -2 * zf).y); const top = this.P(x, GOAL.bar, -1 * zf); g.lineTo(top.x, top.y); } });
    for (let i = 0; i <= 20; i += 2){ const x = xs[i], a = this.P(x, GOAL.bar, 0), b = this.netPt(x, GOAL.bar, true); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    g.stroke();
    g.strokeStyle = "rgba(245,240,229,0.55)"; g.lineWidth = 1.5; g.beginPath();
    const bl = this.P(-GOAL.half, 0, -2), br = this.P(GOAL.half, 0, -2); g.moveTo(bl.x, bl.y); g.lineTo(br.x, br.y);
    [-GOAL.half, GOAL.half].forEach(x => { const a = this.P(x, 0, 0), b = this.P(x, 0, -2), c = this.P(x, GOAL.bar, -1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); });
    g.stroke();
  }
  drawFrame(g){
    const sh = this.shake > 0 ? Math.sin(this.t * 90) * 0.03 * (this.shake / 0.4) : 0;
    g.lineCap = "round";
    const C = "#F5F0E5";
    this.line(g, [-GOAL.half + sh, 0, 0], [-GOAL.half + sh, GOAL.bar, 0], 0.12, C);
    this.line(g, [GOAL.half + sh, 0, 0], [GOAL.half + sh, GOAL.bar, 0], 0.12, C);
    this.line(g, [-GOAL.half + sh, GOAL.bar + sh, 0], [GOAL.half + sh, GOAL.bar + sh, 0], 0.12, C);
  }
  drawKeeper(g){
    const k = this.k, z = 0.35, P = (pt) => this.P(pt.x, pt.y, z);
    const sh = this.P(k.F.x + Math.sin(k.phi) * 0.7, 0, z); g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.ellipse(sh.x, sh.y, 0.75 * sh.s * (0.6 + Math.abs(Math.sin(k.phi)) * 0.8), 0.14 * sh.s, 0, 0, 6.283); g.fill();
    const seg = (a, b, w, col) => { const p = P(a), q = P(b); g.strokeStyle = col; g.lineWidth = w * p.s; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); };
    const dot = (a, r, col) => { const p = P(a); g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y, r * p.s, 0, 6.283); g.fill(); };
    g.lineCap = "round";
    const sp = k.spread || 0.05;
    const hipL = this.bodyPt(-0.1, 0.9), hipR = this.bodyPt(0.1, 0.9), footL = this.bodyPt(-0.14 - sp, 0.06), footR = this.bodyPt(0.14 + sp, 0.06);
    const kneeL = this.bodyPt(-0.13 - sp * 0.5, 0.5), kneeR = this.bodyPt(0.13 + sp * 0.5, 0.5);
    const shL = this.bodyPt(-0.2, 1.35), shR = this.bodyPt(0.2, 1.35), hip = this.bodyPt(0, 0.95), chest = this.bodyPt(0, 1.3), head = this.bodyPt(0, 1.6);
    const hands = k.hands || this.readyHands();
    const farIdx = (k.phi >= 0) ? 0 : 1;
    seg(farIdx ? shR : shL, hands[farIdx], 0.12, KIT.shirtDark); dot(hands[farIdx], 0.085, "#d9d2c3");
    seg(hipL, kneeL, 0.15, KIT.shorts); seg(kneeL, footL, 0.13, KIT.sock); seg(hipR, kneeR, 0.15, KIT.shorts); seg(kneeR, footR, 0.13, KIT.sock);
    seg(hip, chest, 0.42, KIT.shirt);
    seg(this.bodyPt(-0.12, 0.88), this.bodyPt(0.12, 0.88), 0.2, KIT.shorts);
    dot(head, 0.12, KIT.skin);
    const hp = P(head); g.fillStyle = KIT.hair; g.beginPath(); g.arc(hp.x, hp.y, 0.125 * hp.s, Math.PI + 0.2 + k.phi, 2 * Math.PI - 0.2 + k.phi); g.fill();
    const ni = 1 - farIdx; seg(ni ? shR : shL, hands[ni], 0.12, KIT.shirt); dot(hands[ni], 0.09, KIT.glove);
  }
  drawBall(g){
    const b = this.ball; if (b.a <= 0) return;
    const p = this.P(b.x, b.y, b.z); if (p.d < 0.4) return;
    const r = GOAL.ball * p.s, shd = this.P(b.x, 0, b.z);
    g.globalAlpha = b.a * clamp(1 - (b.y - 0.11) / 3, 0.15, 0.55); g.fillStyle = "#000";
    g.beginPath(); g.ellipse(shd.x, shd.y, r * 1.1, r * 0.35, 0, 0, 6.283); g.fill();
    g.globalAlpha = b.a;
    // glow around a moving ball (the floodlights catching it)
    if (b.mode !== "rest" && !this.lite){
      g.save(); g.globalCompositeOperation = "lighter";
      const gl = g.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3.2); gl.addColorStop(0, "rgba(255,244,214,0.35)"); gl.addColorStop(1, "rgba(255,244,214,0)");
      g.fillStyle = gl; g.beginPath(); g.arc(p.x, p.y, r * 3.2, 0, 6.283); g.fill(); g.restore();
    }
    const gr = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.7, "#eae6dc"); gr.addColorStop(1, "#b9b3a6");
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.fill();
    g.save(); g.beginPath(); g.arc(p.x, p.y, r, 0, 6.283); g.clip(); g.fillStyle = "#1d2a22";
    const pent = (cx, cy, rr) => { g.beginPath(); for (let i = 0; i < 5; i++){ const a = b.spin + i * 1.2566; g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    pent(p.x + Math.sin(b.spin) * r * 0.25, p.y, r * 0.33);
    for (let i = 0; i < 5; i++){ const a = b.spin * 0.6 + i * 1.2566; pent(p.x + Math.cos(a) * r * 0.95, p.y + Math.sin(a) * r * 0.95, r * 0.3); }
    g.restore(); g.globalAlpha = 1;
  }
  drawLights(g, before){
    const W = this.W, H = this.H, party = this.partyT > 0, lite = this.lite || REDUCED;
    g.save(); g.globalCompositeOperation = "lighter";
    if (before){
      // sweeping beams behind the goal
      if (!lite || party){
        const sp = party ? 2.4 : 0.32, a = party ? 0.42 : 0.16, img = party ? this.beamGreen : this.beamWarm;
        [[0.22, 0], [0.78, 2.1], [0.5, 4.2]].forEach(([fx, ph], i) => {
          if (i === 2 && !party) return;
          const ang = Math.sin(this.t * sp + ph) * (party ? 0.7 : 0.45) + (fx < 0.5 ? -0.12 : fx > 0.5 ? 0.12 : 0);
          g.save(); g.globalAlpha = a; g.translate(W * fx, this.yStandBot); g.rotate(ang); g.drawImage(img, -img.width / 2, -img.height); g.restore();
        });
      }
      // the towers' cones, gently flickering
      const fl = 0.85 + 0.15 * Math.sin(this.t * 13.7) * Math.sin(this.t * 3.1);
      g.globalAlpha = lite ? 0.8 : fl * (party ? 1.25 : 1); g.drawImage(this.cones, 0, 0, W, H);
      g.globalAlpha = 1;
      // camera flashes in the crowd (lots during a celebration)
      const n = REDUCED ? 0 : party ? 10 : 2;
      for (let i = 0; i < n; i++){
        if (Math.random() < (party ? 0.5 : 0.25)){
          const x = Math.random() * W, y = lerp(this.yStandTop, this.yStandBot, Math.random() * 0.92), s = (party ? 7 : 4) * Math.max(1, W / 500);
          const fg = g.createRadialGradient(x, y, 0, x, y, s); fg.addColorStop(0, "rgba(255,255,255,0.95)"); fg.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = fg; g.fillRect(x - s, y - s, s * 2, s * 2);
        }
      }
    } else {
      // lamp flares on top of everything
      const pulse = 0.85 + 0.15 * Math.sin(this.t * 2.3) + (party ? 0.35 : 0), fs = this.flare.width * pulse;
      this.lamps.forEach(L => {
        g.globalAlpha = 0.9; g.drawImage(this.flare, L.x - fs / 2, L.y - fs / 2, fs, fs);
        if (!lite){ g.globalAlpha = 0.5 * pulse; g.drawImage(this.streak, L.x - this.streak.width / 2, L.y - this.streak.height / 2); }
      });
      // fireworks
      this.rockets.forEach(r => { if (r.delay <= 0){ g.globalAlpha = 1; g.fillStyle = "#fff6dc"; g.fillRect(r.x - 1.5, r.y, 3, 10); } });
      this.sparks.forEach(s => {
        g.globalAlpha = Math.max(0, Math.min(1, s.life)); g.fillStyle = s.col;
        g.beginPath(); g.arc(s.x, s.y, 2.2 * Math.max(1, W / 600), 0, 6.283); g.fill();
      });
      // the goal flash
      if (this.flashA > 0 && !REDUCED){ g.globalAlpha = this.flashA * 0.55; g.fillStyle = party ? "#e8ffdc" : "#fff6e0"; g.fillRect(0, 0, W, H); }
    }
    g.restore();
  }
  draw(){
    const g = this.g, d = this.dpr; g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.quake > 0.2 && !REDUCED){ const q = this.quake * d; g.setTransform(1, 0, 0, 1, (Math.random() - 0.5) * q, (Math.random() - 0.5) * q); }
    g.drawImage(this.bg, 0, 0);
    const m = g.getTransform ? g.getTransform() : null;
    g.setTransform(d, 0, 0, d, m ? m.e : 0, m ? m.f : 0);
    this.drawLights(g, true);
    // scrolling LED ad board
    const ad = this.ad;
    if (ad && ad.h > 3){
      g.save(); g.beginPath(); g.rect(ad.x, ad.y, ad.w, ad.h); g.clip();
      const fs = Math.max(5, ad.h * 0.42); g.font = "900 " + fs + "px Nunito, system-ui, sans-serif"; g.textBaseline = "middle";
      const txt = AD_TEXT(), tw = g.measureText(txt).width || 1; let x = ad.x - (this.adX * ad.s * 0.05 % tw);
      g.fillStyle = this.partyT > 0 ? "rgba(142,224,122,0.95)" : "rgba(142,224,122,0.6)";
      while (x < ad.x + ad.w){ g.fillText(txt, x, ad.y + ad.h * 0.55); x += tw; }
      g.restore();
    }
    const b = this.ball;
    this.drawNet(g);
    if (b.z < 0) this.drawBall(g);
    this.drawFrame(g);
    this.drawKeeper(g);
    // the ball's light trail
    if (b.mode === "flight" || b.mode === "net"){
      const p = this.P(b.x, b.y, b.z); this.btrail.push({ x: p.x, y: p.y, r: GOAL.ball * p.s }); if (this.btrail.length > 14) this.btrail.shift();
    } else if (this.btrail.length) this.btrail.shift();
    if (this.btrail.length > 1 && !REDUCED){
      g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
      for (let i = 1; i < this.btrail.length; i++){
        const a = this.btrail[i - 1], c = this.btrail[i], k = i / this.btrail.length;
        g.strokeStyle = "rgba(255,240,205," + (0.38 * k) + ")"; g.lineWidth = Math.max(1, c.r * 1.6 * k);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
      }
      g.restore();
    }
    if (b.z >= 0) this.drawBall(g);
    // swipe trail
    if (this.trail.length > 1 && this.trailA > 0){
      g.save(); g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(242,177,92," + (0.5 * this.trailA) + ")"; g.lineWidth = 14; g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath(); this.trail.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
      g.strokeStyle = "rgba(255,248,232," + (0.85 * this.trailA) + ")"; g.lineWidth = 5;
      g.beginPath(); this.trail.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
      g.restore();
    }
    this.drawLights(g, false);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.vig, 0, 0);
  }
}
