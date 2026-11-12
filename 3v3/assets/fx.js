/* Gotcha Shootout 3v3 — effects on one canvas over the whole page: the goal moment of mock-up rev 8 (one white stadium flash, then two
   light beams sweeping across), confetti, fireworks (the penalty build's). House rules: a goal moment at most once per 1.6 s (no strobing);
   reduced motion = none of it; slow phones (lite) = the flash without beams, little confetti, no fireworks. The crowd's phone flashes are
   drawn by draw.js in the stands. */
"use strict";
const Fx = (() => {
  const cv = document.getElementById("fx"), g = cv.getContext("2d"), R = Draw.REDUCED;
  let W = 0, H = 0, flash = 0, lastFlash = -1e9;
  const rockets = [], sparks = [], conf = [];
  function size(){
    const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)){ cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); W = w; H = h;
  }
  function goalFlash(){ const n = performance.now(); if (R || n - lastFlash < 1600) return false; lastFlash = n; flash = 1; return true; }
  function confetti(cols, y){ if (R) return; size(); const n = Draw.st.lite ? 40 : 110, y0 = y == null ? H * 0.42 : y;
    for (let i = 0; i < n; i++) conf.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: y0, vx: (Math.random() - 0.5) * 620, vy: -Math.random() * 620 - 120, r: Math.random() * 6 + 3, c: cols[i % cols.length], a: Math.random() * 6, l: 1 }); }
  function fireworks(n){ if (R || Draw.st.lite) return; size();
    for (let i = 0; i < n; i++) rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H * 0.95, ty: H * (0.12 + Math.random() * 0.3), delay: i * 0.35 + Math.random() * 0.2,
      col: ["#fffbe6", "#6fbf4a", "#ffd23f", "#ff6b5b", "#ffffff"][i % 5] });
  }
  function frame(dt){
    flash = Math.max(0, flash - dt * 1.6);
    if (!(flash > 0 || rockets.length || sparks.length || conf.length)){ if (W){ g.clearRect(0, 0, W, H); W = 0; } return; }
    size(); g.clearRect(0, 0, W, H);
    if (flash > 0){
      if (flash > 0.85){ g.fillStyle = "rgba(255,251,230," + ((flash - 0.85) * 3).toFixed(2) + ")"; g.fillRect(0, 0, W, H); }   // one white flash
      if (!Draw.st.lite){ const a = (1 - flash) * Math.PI;   // then two light beams sweep across from the floodlights
        [0, 1].forEach(i => { g.save(); g.translate(i ? W : 0, 0); g.rotate((i ? -1 : 1) * (a - 0.6)); const gr = g.createLinearGradient(0, 0, 0, H * 1.2);
          gr.addColorStop(0, "rgba(255,251,230," + (flash * 0.5).toFixed(2) + ")"); gr.addColorStop(1, "rgba(255,251,230,0)"); g.fillStyle = gr;
          g.beginPath(); g.moveTo(-8, 0); g.lineTo(8, 0); g.lineTo(W * 0.45, H * 1.2); g.lineTo(-W * 0.45, H * 1.2); g.fill(); g.restore(); }); }
    }
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = rockets.length - 1; i >= 0; i--){   // fireworks (the penalty build's)
      const r = rockets[i]; if (r.delay > 0){ r.delay -= dt; continue; }
      r.y -= dt * Math.max(260, H * 0.9); g.fillStyle = "#fff6dc"; g.fillRect(r.x - 1.5, r.y, 3, 10);
      if (r.y <= r.ty){ rockets.splice(i, 1); Sfx.play("pop");
        for (let k = 0; k < 46; k++){ const a = k / 46 * 6.283, v = (0.6 + Math.random() * 0.5) * Math.max(60, W * 0.28); sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.3 + Math.random() * 0.5, col: r.col }); } }
    }
    for (let i = sparks.length - 1; i >= 0; i--){
      const s = sparks[i]; s.vy += 90 * dt; s.vx *= (1 - dt * 1.4); s.vy *= (1 - dt * 1.4); s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0){ sparks.splice(i, 1); continue; }
      g.globalAlpha = Math.max(0, Math.min(1, s.life)); g.fillStyle = s.col; g.beginPath(); g.arc(s.x, s.y, 2.2, 0, 6.283); g.fill();
    }
    g.restore(); g.globalAlpha = 1;
    for (let i = conf.length - 1; i >= 0; i--){   // confetti (the mock-up's)
      const q = conf[i]; q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.a += dt * 8; q.l -= dt * 0.45;
      if (q.l <= 0 || q.y > H + 20){ conf.splice(i, 1); continue; }
      g.save(); g.globalAlpha = q.l; g.translate(q.x, q.y); g.rotate(q.a); g.fillStyle = q.c; g.fillRect(-q.r / 2, -q.r / 4, q.r, q.r / 2); g.restore();
    }
  }
  function clear(){ flash = 0; rockets.length = sparks.length = conf.length = 0; }   // a new match or a loss never carries the last celebration
  return { goalFlash, confetti, fireworks, frame, clear, state: () => ({ flash, rockets: rockets.length, sparks: sparks.length, conf: conf.length }) };
})();
