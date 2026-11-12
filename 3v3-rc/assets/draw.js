/* Gotcha Shootout 3v3 — drawing, from the approved mock-up rev 2: striped floodlit pitch, goal circles, nets that grow, cat-face players,
   the puck-like ball, confetti. Draws any team size (1, 2 or 3 a side). Lite mode (slow phones): no ball trail, no floodlight pools. */
"use strict";
const Draw = (() => {
  const CATS = [
    { id: "ok", name: "OK Gotcha", src: "../assets/img/cat-ok-gotcha-cream.webp", cx: 305, cy: 284, r: 132 },
    { id: "bar", name: "Barista", src: "../assets/img/cat-barista-cream.webp", cx: 326, cy: 309, r: 128 },
    { id: "whisk", name: "Whisk Rider", src: "../assets/img/cat-whisk-ride-cream.webp", cx: 450, cy: 80, r: 84 },
    { id: "dep", name: "Matcha Deprived", src: "../assets/img/matcha-deprived-cream.webp", cx: 300, cy: 240, r: 150 }
  ];
  CATS.forEach(c => { c.img = new Image(); c.img.src = c.src; });
  const LOGO = new Image(); LOGO.src = "../assets/img/logo-lockup-white.webp";   // rev 8: the logo in the centre circle
  const COL = { 0: { f: "#6fbf4a", d: "#3d7a26", name: "MATCHA", t: "Matcha" }, 1: { f: "#ffd23f", d: "#b88a00", name: "YUZU", t: "Yuzu" } };
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const K = () => Sim3.C;
  // rip = {j: 0 top net | 1 bottom net, a: 0–1}: the net shakes after a goal; hype = seconds the crowd jumps (hypeTeam -1 = everyone);
  // storm = seconds of the phone-flash storm after a goal
  const st = { lite: false, rip: null, hype: 0, hypeTeam: -1, storm: 0 };

  const faceCache = {};
  function faceCanvas(ci, team, px){
    const key = ci + "-" + team + "-" + px; if (faceCache[key]) return faceCache[key];
    const c = CATS[ci] || CATS[0]; if (!c.img.complete || !c.img.naturalWidth) return null;
    const cv = document.createElement("canvas"); cv.width = cv.height = px; const g = cv.getContext("2d"), r = px / 2;
    g.fillStyle = COL[team].f; g.beginPath(); g.arc(r, r, r, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(r, r, r * 0.86, 0, 7); g.clip(); g.fillStyle = "#173a24"; g.fillRect(0, 0, px, px);
    g.drawImage(c.img, c.cx - c.r, c.cy - c.r, c.r * 2, c.r * 2, r - r * 0.86, r - r * 0.86, r * 1.72, r * 1.72); g.restore();
    return faceCache[key] = cv;
  }
  function pitch(g, gw){
    const { W, H, CREASE } = K(), stripe = H / 12;
    for (let i = 0; i < 12; i++){ g.fillStyle = i % 2 ? "#1f5a32" : "#24673a"; g.fillRect(-3, i * stripe, W + 6, stripe + 0.1); }
    g.fillStyle = "#1a4c2b"; g.fillRect(-6, -6, W + 12, 6); g.fillRect(-6, H, W + 12, 6); g.fillRect(-6, -6, 6, H + 12); g.fillRect(W, -6, 6, H + 12);
    g.strokeStyle = "#eef3e6cc"; g.lineWidth = 0.35; g.strokeRect(0, 0, W, H);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 8, 0, 7); g.stroke();
    g.fillStyle = "#eef3e6cc"; g.beginPath(); g.arc(W / 2, H / 2, 0.5, 0, 7); g.fill();
    if (LOGO.complete && LOGO.naturalWidth){ g.save(); g.globalAlpha = 0.16; const lw = 14, lh = lw * LOGO.naturalHeight / LOGO.naturalWidth; g.drawImage(LOGO, W / 2 - lw / 2, H / 2 - lh / 2, lw, lh); g.restore(); }
    [[0, 0], [W, 0], [0, H], [W, H]].forEach(([x, y]) => {   // corner flags
      g.strokeStyle = "#fffbe6"; g.lineWidth = 0.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + (y ? -3 : 3)); g.stroke();
      g.fillStyle = x ? "#ffd23f" : "#6fbf4a"; g.beginPath(); g.moveTo(x, y + (y ? -3 : 3)); g.lineTo(x + (x ? -2.2 : 2.2), y + (y ? -2.2 : 2.2)); g.lineTo(x, y + (y ? -1.4 : 1.4)); g.fill(); });
    [[0, 0], [H, Math.PI]].forEach(([y, a]) => { g.fillStyle = "#ffffff14"; g.beginPath(); g.arc(W / 2, y, CREASE, a, a + Math.PI); g.fill();   // goal circles: nobody stands inside
      g.setLineDash([1.2, 1]); g.beginPath(); g.arc(W / 2, y, CREASE, a, a + Math.PI); g.stroke(); g.setLineDash([]); });
    const half = gw / 2;   // goals (nets) grow in the last 15 s
    [[0, -4], [H, 4]].forEach(([y, dy]) => {
      g.fillStyle = "#ffffff22"; g.fillRect(W / 2 - half, Math.min(y, y + dy), half * 2, 4);
      g.strokeStyle = "#ffffff40"; g.lineWidth = 0.15;
      const rp = st.rip && st.rip.j === (y ? 1 : 0) && !REDUCED ? st.rip.a : 0, wob = (x, k) => rp ? Math.sin(x * 1.7 + k * 2 + st.rip.t * 30) * rp * 0.9 : 0;
      for (let x = W / 2 - half; x <= W / 2 + half; x += 1.2){ g.beginPath(); g.moveTo(x, y); g.lineTo(x + wob(x, 0), y + dy); g.stroke(); }
      for (let k = 1; k < 4; k++){ g.beginPath(); g.moveTo(W / 2 - half, y + dy * k / 4 + wob(0, k)); g.lineTo(W / 2 + half, y + dy * k / 4 + wob(W, k)); g.stroke(); }
      g.strokeStyle = "#fffbe6"; g.lineWidth = 0.7; g.beginPath(); g.moveTo(W / 2 - half, y); g.lineTo(W / 2 - half, y + dy); g.lineTo(W / 2 + half, y + dy); g.lineTo(W / 2 + half, y); g.stroke();
    });
    if (!st.lite) [[0, 0], [W, 0], [0, H], [W, H]].forEach(([x, y]) => { const rg = g.createRadialGradient(x, y, 0, x, y, 40);   // floodlight pools
      rg.addColorStop(0, "#fffbe633"); rg.addColorStop(1, "#fffbe600"); g.fillStyle = rg; g.fillRect(x - 40, y - 40, 80, 80); });
  }
  function players(g, list, S, rot, t, dpr){
    const RP = K().RP, px = Math.max(24, Math.round(RP * 2 * S * dpr));
    list.forEach(q => {
      g.save(); g.translate(q.x, q.y); if (rot) g.rotate(rot);
      g.fillStyle = "#00000055"; g.beginPath(); g.ellipse(0.5, 0.9, RP * 0.95, RP * 0.75, 0, 0, 7); g.fill();
      if (q.me){ const pr = RP + 2.4 + (REDUCED ? 0 : Math.sin(t * 6) * 0.3); g.fillStyle = "#fffbe61f"; g.beginPath(); g.arc(0, 0, pr, 0, 7); g.fill();
        g.strokeStyle = "#fffbe6"; g.lineWidth = 0.6; g.beginPath(); g.arc(0, 0, pr, 0, 7); g.stroke(); }
      const fc = faceCanvas(q.cat, q.team, px);
      if (fc) g.drawImage(fc, -RP, -RP, RP * 2, RP * 2); else { g.fillStyle = COL[q.team].f; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.fill(); }
      g.strokeStyle = COL[q.team].d; g.lineWidth = 0.35; g.beginPath(); g.arc(0, 0, RP, 0, 7); g.stroke();
      const txt = q.me ? "YOU" : q.label;
      if (txt){ g.font = "900 " + (q.me ? 2.3 : 1.7) + "px Nunito, sans-serif"; g.textAlign = "center"; const ty = q.me ? -RP - 3.3 : -RP - 1.2;
        g.fillStyle = "#000a"; g.fillText(txt, 0.15, ty + 0.15); g.fillStyle = q.me ? "#fffbe6" : "#ffffffb0"; g.fillText(txt, 0, ty); }
      g.restore();
    });
  }
  function ball(g, b, trail){
    const RB = K().RB;
    if (!st.lite && !REDUCED && trail) trail.forEach(([x, y], i) => { g.fillStyle = "rgba(255,251,230," + (i / trail.length * 0.25) + ")"; g.beginPath(); g.arc(x, y, RB * (i / trail.length), 0, 7); g.fill(); });
    g.fillStyle = "#0006"; g.beginPath(); g.ellipse(b.x + 0.4, b.y + 0.6, RB, RB * 0.8, 0, 0, 7); g.fill();
    if (b.fast && !st.lite){ g.save(); g.globalCompositeOperation = "lighter";   // the floodlights catch a moving ball
      const gl = g.createRadialGradient(b.x, b.y, RB * 0.5, b.x, b.y, RB * 3.2); gl.addColorStop(0, "rgba(255,244,214,0.35)"); gl.addColorStop(1, "rgba(255,244,214,0)");
      g.fillStyle = gl; g.beginPath(); g.arc(b.x, b.y, RB * 3.2, 0, 7); g.fill(); g.restore(); }
    if (st.lite) g.fillStyle = "#f4f6ef"; else { const rg = g.createRadialGradient(b.x - 0.4, b.y - 0.5, 0.2, b.x, b.y, RB); rg.addColorStop(0, "#fff"); rg.addColorStop(1, "#cfd6c9"); g.fillStyle = rg; }
    g.beginPath(); g.arc(b.x, b.y, RB, 0, 7); g.fill();
    g.fillStyle = "#1b2a20"; g.beginPath(); g.arc(b.x + 0.2, b.y, 0.45, 0, 7); g.fill(); g.beginPath(); g.arc(b.x - 0.7, b.y - 0.6, 0.25, 0, 7); g.fill(); g.beginPath(); g.arc(b.x - 0.5, b.y + 0.75, 0.25, 0, 7); g.fill();
  }

  /* the crowd: fans in the stands round the pitch (mock-up rev 7–8, owner ~21:08): coloured circles that bob, jump with arms up on goals
     and near misses, banners and flags, phone-camera flashes (a storm after a goal). Reduced motion = a still crowd; lite = half the fans. */
  const FAN_COLS = ["#6fbf4a", "#6fbf4a", "#9be27a", "#ffd23f", "#ffd23f", "#ffe06a", "#fffbe6", "#ff6b5b", "#5aa9ff", "#f39c4a", "#c58cff"];
  const FANS = [], BANNERS = [];
  function buildCrowd(){
    const { W, H } = K(); let k = 0;
    const add = (x, y, team) => { k++; const c = Math.random() < 0.55 ? (team ? ["#ffd23f", "#ffe06a"][k % 2] : ["#6fbf4a", "#9be27a"][k % 2]) : FAN_COLS[(k * 7) % FAN_COLS.length];
      FANS.push({ x, y, c, ph: Math.random() * 6.28, f: 3 + Math.random() * 3, r: 0.85 + Math.random() * 0.35, team }); };
    for (let col = 0; col < 3; col++) for (let y = -7; y <= H + 7; y += 2.5){ add(-2.6 - col * 2.4, y + (col % 2) * 1.2, 0); add(W + 2.6 + col * 2.4, y + (col % 2) * 1.2, 1); }
    for (let row = 0; row < 2; row++) for (let x = -6; x <= W + 6; x += 2.5){ add(x + (row % 2) * 1.2, -7.2 - row * 2.4, 1); add(x + (row % 2) * 1.2, H + 7.2 + row * 2.4, 0); }
    BANNERS.push({ x: -5, y: 20, w: 7, c: "#6fbf4a", tc: "#0b1a10", txt: "MATCHA", rot: -Math.PI / 2, ph: 0 }, { x: -5, y: 72, w: 7, c: "#fffbe6", tc: "#0b1a10", txt: "GOTCHA", rot: -Math.PI / 2, ph: 1.3 },
      { x: W + 5, y: 28, w: 7, c: "#ffd23f", tc: "#0b1a10", txt: "YUZU", rot: Math.PI / 2, ph: 2.1 }, { x: W + 5, y: 80, w: 7, c: "#fffbe6", tc: "#0b1a10", txt: "⚽ GOAL", rot: Math.PI / 2, ph: 0.7 },
      { x: 12, y: -8.5, w: 8, c: "#ffd23f", tc: "#0b1a10", txt: "GO YUZU", rot: 0, ph: 0.4 }, { x: W - 12, y: H + 8.5, w: 8.5, c: "#6fbf4a", tc: "#0b1a10", txt: "GO MATCHA", rot: 0, ph: 2.6 },
      { x: -3, y: 46, flag: 1, c: "#6fbf4a", rot: 0, ph: 0.9 }, { x: W + 3, y: 52, flag: 1, c: "#ffd23f", rot: 0, ph: 1.9 }, { x: W - 6, y: -7.5, flag: 1, c: "#ff6b5b", rot: 0, ph: 3.1 }, { x: 6, y: H + 7.5, flag: 1, c: "#5aa9ff", rot: 0, ph: 0.2 });
  }
  function crowd(g, t){
    const { W, H } = K(), lite = st.lite, hype = st.hype > 0; if (!FANS.length) buildCrowd();
    g.fillStyle = "#0d1a12"; g.fillRect(-12, -13, W + 24, H + 26);   // the stands: dark concrete steps behind the fans
    g.fillStyle = "#13261a"; for (let i = 0; i < 4; i++){ g.fillRect(-11 + i * 2.4, -12, 1.2, H + 24); g.fillRect(W + 9.8 - i * 2.4, -12, 1.2, H + 24); }
    const amp = REDUCED ? 0 : 0.35, big = REDUCED ? 0 : 1.5;
    for (let i = 0; i < FANS.length; i += lite ? 2 : 1){
      const q = FANS[i], excited = hype && (st.hypeTeam < 0 || st.hypeTeam === q.team), j = Math.abs(Math.sin(t * q.f + q.ph)) * (excited ? big : amp);
      g.fillStyle = "#0006"; g.beginPath(); g.ellipse(q.x + 0.25, q.y + 0.35, q.r * 0.9, q.r * 0.55, 0, 0, 7); g.fill();
      g.fillStyle = q.c; g.beginPath(); g.arc(q.x, q.y - j, q.r, 0, 7); g.fill();
      g.fillStyle = "#ffffff40"; g.beginPath(); g.arc(q.x - q.r * 0.3, q.y - j - q.r * 0.3, q.r * 0.35, 0, 7); g.fill();
      if (excited && !REDUCED && i % 9 === 0){ g.strokeStyle = q.c; g.lineWidth = 0.25; g.beginPath(); g.moveTo(q.x - 0.6, q.y - j - 0.4); g.lineTo(q.x - 1.2, q.y - j - 1.6); g.moveTo(q.x + 0.6, q.y - j - 0.4); g.lineTo(q.x + 1.2, q.y - j - 1.6); g.stroke(); }   // arms up
    }
    BANNERS.forEach(bn => {   // banners and flags held up, waving (faster when the crowd jumps)
      const w = REDUCED ? 0 : Math.sin(t * (hype ? 7 : 2.2) + bn.ph) * (hype ? 0.35 : 0.15);
      g.save(); g.translate(bn.x, bn.y - (hype && !REDUCED ? Math.abs(Math.sin(t * 6 + bn.ph)) * 1.2 : 0)); g.rotate(bn.rot + w);
      if (bn.flag){ g.strokeStyle = "#ddd"; g.lineWidth = 0.25; g.beginPath(); g.moveTo(0, 1.6); g.lineTo(0, -2.6); g.stroke(); g.fillStyle = bn.c; g.beginPath(); g.moveTo(0, -2.6); g.lineTo(2.6 + w * 2, -2.0); g.lineTo(0, -1.2); g.fill(); }
      else { g.fillStyle = bn.c; g.fillRect(-bn.w / 2, -1.1, bn.w, 2.2); g.strokeStyle = "#0b1a10"; g.lineWidth = 0.15; g.strokeRect(-bn.w / 2, -1.1, bn.w, 2.2);
        g.fillStyle = bn.tc; g.font = "900 1.5px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(bn.txt, 0, 0.1); }
      g.restore();
    });
    const n = REDUCED ? 0 : st.storm > 0 ? 6 : Math.random() < 0.12 ? 1 : 0;   // phone camera flashes: now and then; a storm after a goal
    for (let k = 0; k < n; k++){ const q = FANS[(Math.random() * FANS.length) | 0];
      if (lite){ g.fillStyle = "#fffbe6"; g.beginPath(); g.arc(q.x, q.y - 1, 0.9, 0, 7); g.fill(); continue; }
      const rg = g.createRadialGradient(q.x, q.y - 1, 0, q.x, q.y - 1, 2.2); rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.35, "#fffbe6aa"); rg.addColorStop(1, "#fffbe600");
      g.fillStyle = rg; g.beginPath(); g.arc(q.x, q.y - 1, 2.2, 0, 7); g.fill(); }
  }
  function Confetti(){ this.p = []; }
  Confetti.prototype.burst = function(w, h, cols){ if (REDUCED) return; const n = st.lite ? 50 : 110;
    for (let i = 0; i < n; i++) this.p.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.42, vx: (Math.random() - 0.5) * 620, vy: -Math.random() * 620 - 120, r: Math.random() * 6 + 3, c: cols[i % cols.length], a: Math.random() * 6, l: 1 }); };
  Confetti.prototype.draw = function(g, dt){ this.p = this.p.filter(q => q.l > 0); this.p.forEach(q => { q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.a += dt * 8; q.l -= dt * 0.45;
    g.save(); g.globalAlpha = Math.max(0, q.l); g.translate(q.x, q.y); g.rotate(q.a); g.fillStyle = q.c; g.fillRect(-q.r / 2, -q.r / 4, q.r, q.r / 2); g.restore(); }); };

  function fit(cv){
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, st.lite ? 1.5 : 2);   // 3x screens draw at 2x: same look, less work
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    return { w, h, d, cw: r.width, ch: r.height };
  }
  // world → screen for the phone; a Yuzu phone turns the world 180° so its team attacks up. toWorld undoes that turn for the finger.
  // stands = the match view leaves room for the crowd round the pitch (rev 8)
  function view(cv, flip, padTop, padBot, stands){
    const { W, H } = K(), f = fit(cv), S = Math.min(f.cw / (W + (stands ? 16 : 5)), (f.ch - padTop - padBot) / (H + (stands ? 14 : 10)));
    const ox = f.cw / 2, oy = padTop + (f.ch - padTop - padBot) / 2;
    const v = { f, S, ox, oy, flip }; v.toWorld = (sx, sy) => L3.toWorld(v, sx, sy, W, H); return v;
  }
  // vm = { gw, ball:{x,y}, trail:[[x,y]…], players:[{x,y,team,cat,me,label}] }
  function render(cv, vm, v, t, conf, dt, shake){
    const { W, H } = K(), g = cv.getContext("2d"), f = v.f;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#07110b"; g.fillRect(0, 0, f.w, f.h);
    const sx = shake && !REDUCED ? (Math.random() - 0.5) * shake : 0;
    g.setTransform(f.d * v.S, 0, 0, f.d * v.S, f.d * (v.ox + sx), f.d * v.oy); if (v.flip) g.rotate(Math.PI); g.translate(-W / 2, -H / 2);
    if (vm.crowd) crowd(g, t); pitch(g, vm.gw); if (vm.ball) ball(g, vm.ball, vm.trail); players(g, vm.players, v.S, v.flip ? Math.PI : 0, t, f.d);
    g.setTransform(f.d, 0, 0, f.d, 0, 0); if (conf) conf.draw(g, dt);
  }
  return { CATS, COL, REDUCED, st, faceCanvas, Confetti, view, render };
})();
