/* Gotcha Shootout 3v3 — stadium effects on one canvas over the whole page, from the penalty build's pitch.js (camera flashes in the crowd,
   sweeping beams, fireworks, the goal flash) + the mock-up's confetti. House rules: a big flash at most once per 1.6 s; reduced motion = no
   flash, beams, fireworks, confetti or camera flashes; slow phones (lite) keep only the goal flash and a little confetti. */
"use strict";
const Fx = (() => {
  const cv = document.getElementById("fx"), g = cv.getContext("2d"), R = Draw.REDUCED;
  let W = 0, H = 0, flashA = 0, lastFlash = -1e9, partyT = 0, t = 0, stands = null;
  const rockets = [], sparks = [], conf = [];
  function size(){
    const d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)){ cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); W = w; H = h;
  }
  // the goal flash: never strobing (at most once per 1.6 s)
  function bigFlash(a){ const n = performance.now(); if (R || n - lastFlash < 1600) return false; lastFlash = n; flashA = a || 0.8; return true; }
  function party(s){ if (!R) partyT = Math.max(partyT, s); }
  function confetti(cols, y){ if (R) return; size(); const n = Draw.st.lite ? 40 : 110, y0 = y == null ? H * 0.42 : y;
    for (let i = 0; i < n; i++) conf.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: y0, vx: (Math.random() - 0.5) * 620, vy: -Math.random() * 620 - 120, r: Math.random() * 6 + 3, c: cols[i % cols.length], a: Math.random() * 6, l: 1 }); }
  function fireworks(n){ if (R || Draw.st.lite) return; size();
    for (let i = 0; i < n; i++) rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H * 0.95, ty: H * (0.12 + Math.random() * 0.3), delay: i * 0.35 + Math.random() * 0.2,
      col: ["#fffbe6", "#6fbf4a", "#ffd23f", "#ff6b5b", "#ffffff"][i % 5] });
  }
  // where the crowd sits on this screen (the dark bands above and below the pitch): camera flashes pop there
  function setStands(b){ stands = b; }
  function frame(dt){
    t += dt; flashA = Math.max(0, flashA - dt * 1.8); partyT = Math.max(0, partyT - dt);
    const busy = flashA > 0 || partyT > 0 || rockets.length || sparks.length || conf.length || (stands && !R && !Draw.st.lite);
    if (!busy){ if (W) { g.clearRect(0, 0, W, H); W = 0; } return; }
    size(); g.clearRect(0, 0, W, H);
    g.save(); g.globalCompositeOperation = "lighter";
    if (partyT > 0 && !Draw.st.lite){   // sweeping beams from the floodlight corners
      [[0, 0], [W, 0.9]].forEach(([x, ph]) => {
        const ang = Math.PI / 2 + Math.sin(t * 2.4 + ph * 3) * 0.6 + (x ? 0.35 : -0.35);
        g.save(); g.translate(x, 0); g.rotate(ang - Math.PI / 2); const len = H * 1.1, wd = W * 0.22;
        const lg = g.createLinearGradient(0, 0, 0, len); lg.addColorStop(0, "rgba(142,224,122,0.32)"); lg.addColorStop(1, "rgba(142,224,122,0)");
        g.fillStyle = lg; g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.lineTo(wd, len); g.lineTo(-wd, len); g.closePath(); g.fill(); g.restore();
      });
    }
    if (stands && !R && !Draw.st.lite){   // camera flashes in the crowd: a few always, lots during a celebration
      const n = partyT > 0 ? 10 : 1;
      for (let i = 0; i < n; i++) if (Math.random() < (partyT > 0 ? 0.5 : 0.08)){
        const s = stands[Math.floor(Math.random() * stands.length)]; if (!s || s.h < 4) continue;
        const x = s.x + Math.random() * s.w, y = s.y + Math.random() * s.h, r = partyT > 0 ? 7 : 4;
        const fg = g.createRadialGradient(x, y, 0, x, y, r); fg.addColorStop(0, "rgba(255,255,255,0.95)"); fg.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = fg; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let i = rockets.length - 1; i >= 0; i--){   // fireworks
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
    if (flashA > 0){ g.globalAlpha = flashA * 0.55; g.fillStyle = partyT > 0 ? "#e8ffdc" : "#fff6e0"; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }
  return { bigFlash, party, confetti, fireworks, setStands, frame, state: () => ({ flashA, partyT, rockets: rockets.length, sparks: sparks.length, conf: conf.length }) };
})();
