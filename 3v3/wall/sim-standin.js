/* STAND-IN for ../assets/sim.js (builder A) until it ships: the approved mock-up's engine (rev 2) behind the Sim3 API of API-3V3.md
   §1 + §7 + §8, so the wall's demo and the ?api=fake feed run today. It defines Sim3 only when the real sim.js didn't load.
   DELETE this file (and its <script> tag) once 3v3/assets/sim.js is in the repo. Seeded rng only: no Math.random. */
(function (root) {
  "use strict";
  if (root.Sim3) return;
  var W = 60, H = 96, RP = 3.3, RB = 1.9, GW0 = 28, GW1 = 40, MATCH_S = 60, CREASE = 9, SUB = 2, HUMAN_MAX = 55, HELP = 0.2, BOT_LINE = 6;
  var C = { W: W, H: H, RP: RP, RB: RB, CREASE: CREASE, GW0: GW0, GW1: GW1, MATCH_S: MATCH_S, HUMAN_MAX: HUMAN_MAX, CHALLENGE_GOALS: 1, STANDIN: 1 };
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var BASES = { 1: [[W / 2, H * 0.7]], 2: [[W * 0.35, H * 0.64], [W * 0.65, H * 0.8]], 3: [[W / 2, H * 0.62], [W * 0.25, H * 0.8], [W * 0.75, H * 0.8]] };
  function clampField(o) { o.x = Math.max(RP, Math.min(W - RP, o.x)); o.y = Math.max(RP, Math.min(H - RP, o.y)); }
  function outOfCrease(o) {
    [[W / 2, 0], [W / 2, H]].forEach(function (c) {
      var dx = o.x - c[0], dy = o.y - c[1], d = Math.hypot(dx, dy), m = CREASE + RP;
      if (d < m) { if (d < 0.01) { dx = 0; dy = c[1] === 0 ? 1 : -1; d = 1; } o.x = c[0] + dx / d * m; o.y = c[1] + dy / d * m; }
    });
  }
  function attackY(tm) { return tm === 0 ? 0 : H; }   // Matcha attacks y=0, Yuzu y=H
  function place(m) {
    var b = BASES[m.size];
    m.p.forEach(function (q) { var bx = b[q.slot][0], by = q.team === 0 ? b[q.slot][1] : H - b[q.slot][1]; q.x = q.hx = q.tx = bx; q.y = q.hy = q.ty = by; q.vx = q.vy = 0; q.recover = 0; });
    m.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  }
  function createMatch(o) {
    var size = o.size === 1 || o.size === 2 ? o.size : 3, mode = o.mode === "challenge" ? "challenge" : "versus";
    var m = { rng: mulberry32(o.seed >>> 0 || 1), size: size, mode: mode, goalsToWin: o.goalsToWin || C.CHALLENGE_GOALS, n: 0, state: 0, cd: 3, left: MATCH_S,
      gw: GW0, grew: false, after: 0, stuck: 0, winner: -1, sc: [0, 0], resetIn: 0, p: [], hard: [false, false] };
    var hum = o.humans || [];
    for (var tm = 0; tm < 2; tm++) for (var s = 0; s < size; s++) {
      var h = hum.some(function (x) { return x.team === tm && x.slot === s; });
      m.p.push({ team: tm, slot: s, human: h, input: { x: 0, y: 0, a: 0 }, think: m.rng() * 0.2, role: "" });
    }
    if (mode === "challenge") for (var t2 = 0; t2 < 2; t2++) m.hard[t2] = !hum.some(function (x) { return x.team === t2; });
    m.humanTeam = hum.length ? hum[0].team : 0;
    place(m);
    return m;
  }
  function setInput(m, team, slot, inp) {
    var q = m.p[team * m.size + slot]; if (!q || typeof inp.x !== "number" || typeof inp.y !== "number") return;
    q.input = { x: Math.max(0, Math.min(W, inp.x)), y: Math.max(0, Math.min(H, inp.y)), a: inp.a ? 1 : 0 };
  }
  function followTarget(q, t, dt) {
    var vx = (t.x - q.x) * 30, vy = (t.y - q.y) * 30, s = Math.hypot(vx, vy);
    if (s > HUMAN_MAX) { vx *= HUMAN_MAX / s; vy *= HUMAN_MAX / s; }
    q.vx = vx; q.vy = vy; q.x += vx * dt; q.y += vy * dt; clampField(q); outOfCrease(q);
  }
  function think(m, dt) {
    var b = m.ball;
    for (var tm = 0; tm < 2; tm++) {
      var mine = m.p.filter(function (q) { return q.team === tm; }), gy = attackY(tm), ownY = tm === 0 ? H : 0, hard = m.hard[tm];
      var hum = mine.filter(function (q) { return q.human; })[0], bots = mine.filter(function (q) { return !q.human; });
      if (!bots.length) continue;
      var chaser = null, best = 1e9;
      bots.forEach(function (q) { var d = Math.hypot(q.x - b.x, q.y - b.y); if (d < best) { best = d; chaser = q; } });
      if (hum && Math.hypot(hum.x - b.x, hum.y - b.y) < best - 3) chaser = null;
      var rest = bots.filter(function (q) { return q !== chaser; }).sort(function (a, c) { return Math.abs(a.y - ownY) - Math.abs(c.y - ownY); });
      var guard = rest[0] || null;
      bots.forEach(function (q) {
        q.think -= dt; q.recover = Math.max(0, (q.recover || 0) - dt); if (q.think > 0) return;
        q.think = hard ? 0.05 + m.rng() * 0.03 : 0.1 + m.rng() * 0.08;
        q.hard = hard;
        if (q.recover > 0) { q.fast = false; q.tx = q.x + (W / 2 - q.x) * 0.2; q.ty = q.y + (ownY - q.y) * 0.25; }
        else if (q === chaser) {
          q.role = "strike";
          var spread = hard ? 6 : 14;
          q.aim = q.aim === undefined || m.rng() < 0.05 ? (m.rng() - 0.5) * spread : q.aim;
          var bx0 = b.x + b.vx * 0.12, by0 = b.y + b.vy * 0.12;
          var dx = W / 2 + q.aim - bx0, dy = gy - by0, dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
          var K = RP + RB + 1.2, bx = bx0 - dx * K, by = by0 - dy * K;
          if (bx < RP || bx > W - RP || by < RP || by > H - RP) { dx = W / 2 - bx0; dy = H / 2 - by0; dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; bx = bx0 - dx * K; by = by0 - dy * K; }
          var along = (q.x - bx0) * dx + (q.y - by0) * dy, off = Math.abs((q.x - bx0) * -dy + (q.y - by0) * dx);
          if (along < 0 && off < BOT_LINE && -along < 14) { q.tx = bx0 + dx * 8; q.ty = by0 + dy * 8; q.fast = true; }
          else if (along < 0) { q.tx = bx; q.ty = by; q.fast = false; }
          else { var side = ((q.x - bx0) * -dy + (q.y - by0) * dx) > 0 ? 1 : -1; q.tx = bx + (-dy) * side * (K + 2); q.ty = by + dx * side * (K + 2); q.fast = false; }
        } else if (q === guard) {
          q.role = "guard"; q.fast = false;
          var gx = b.x - W / 2, gyy = b.y - ownY, gl = Math.hypot(gx, gyy) || 1;
          q.tx = W / 2 + gx / gl * (CREASE + RP + 0.6); q.ty = ownY + gyy / gl * (CREASE + RP + 0.6);
        } else {
          q.role = "support"; q.fast = false;
          q.tx = q.hx * 0.45 + b.x * 0.55 + (m.rng() - 0.5) * 2; q.ty = b.y + (ownY - b.y) * 0.4;
        }
        var t = { x: q.tx, y: q.ty }; clampField(t); outOfCrease(t); q.tx = t.x; q.ty = t.y;
      });
    }
  }
  function movePlayers(m, dt, slow, ev) {
    m.p.forEach(function (q) {
      if (q.human) { if (q.input.a) { followTarget(q, q.input, dt); return; } q.vx *= 0.8; q.vy *= 0.8; }
      else {
        var max = q.fast ? (q.hard ? 64 : 55) : (q.role === "guard" ? (q.hard ? 48 : 34) : (q.hard ? 40 : 30));
        var dx = q.tx - q.x, dy = q.ty - q.y, d = Math.hypot(dx, dy), sp = Math.min(max, d * 8);
        var vx = d > 0.01 ? dx / d * sp : 0, vy = d > 0.01 ? dy / d * sp : 0, k = Math.min(1, dt * 10);
        q.vx += (vx - q.vx) * k; q.vy += (vy - q.vy) * k;
      }
      q.x += q.vx * dt; q.y += q.vy * dt; clampField(q); outOfCrease(q);
    });
    for (var i = 0; i < m.p.length; i++) for (var j = i + 1; j < m.p.length; j++) {
      var a = m.p[i], c = m.p[j], ddx = c.x - a.x, ddy = c.y - a.y, dd = Math.hypot(ddx, ddy);
      if (dd < RP * 2 && dd > 0) { var o = (RP * 2 - dd) / 2; ddx /= dd; ddy /= dd; a.x -= ddx * o; a.y -= ddy * o; c.x += ddx * o; c.y += ddy * o; }
    }
    if (slow) return;
    var b = m.ball, order = m.p.slice(), touching = [];
    for (var s = order.length - 1; s > 0; s--) { var r = Math.floor(m.rng() * (s + 1)), tmp = order[s]; order[s] = order[r]; order[r] = tmp; }   // no team wins a 50/50 by list order
    order.forEach(function (q) {
      var dx = b.x - q.x, dy = b.y - q.y, d = Math.hypot(dx, dy);
      if (d < RP + RB && d > 0) {
        touching.push(q); dx /= d; dy /= d; b.x = q.x + dx * (RP + RB); b.y = q.y + dy * (RP + RB);
        var rel = (b.vx - q.vx) * dx + (b.vy - q.vy) * dy;
        if (rel < 0) {
          var before = Math.hypot(b.vx, b.vy); b.vx -= 1.85 * rel * dx; b.vy -= 1.85 * rel * dy;
          var sp = Math.hypot(b.vx, b.vy), ux = b.vx / (sp || 1), uy = b.vy / (sp || 1);
          var gx = W / 2 - b.x, gy = attackY(q.team) - b.y, gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
          if (ux * gx + uy * gy > 0.5) { ux = ux * (1 - HELP) + gx * HELP; uy = uy * (1 - HELP) + gy * HELP; var l = Math.hypot(ux, uy); b.vx = ux / l * sp; b.vy = uy / l * sp; }
          var imp = Math.abs(sp - before) + Math.abs(rel);
          if (imp > 6) { ev.push({ k: "hit", team: q.team, slot: q.slot, p: Math.min(1, imp / 70) }); if (!q.human) q.recover = 0.35; }
        }
      }
    });
    var atWall = b.x < RB + 0.4 || b.x > W - RB - 0.4 || ((b.y < RB + 0.4 || b.y > H - RB - 0.4) && Math.abs(b.x - W / 2) > m.gw / 2);
    if (touching.length >= 2 || (touching.length === 1 && atWall)) {
      var ax, ay;
      if (touching.length >= 2) { ax = touching[1].x - touching[0].x; ay = touching[1].y - touching[0].y; } else { ax = b.x - touching[0].x; ay = b.y - touching[0].y; }
      var al = Math.hypot(ax, ay) || 1, px = -ay / al, py = ax / al;
      if ((W / 2 - b.x) * px + (H / 2 - b.y) * py < 0) { px = -px; py = -py; }
      b.vx = px * 24; b.vy = py * 24; b.x += px * 0.8; b.y += py * 0.8;
    }
  }
  function moveBall(m, dt, ev) {
    var b = m.ball, half = m.gw / 2, E = 0.9, f = Math.exp(-0.32 * dt);
    b.vx *= f; b.vy *= f;
    var sp = Math.hypot(b.vx, b.vy); if (sp > 75) { b.vx *= 75 / sp; b.vy *= 75 / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    var inMouth = Math.abs(b.x - W / 2) < half - RB * 0.3, hit = 0;
    if (b.y >= 0 && b.y <= H) {
      if (b.x < RB) { b.x = RB; b.vx = Math.abs(b.vx) * E; hit = Math.abs(b.vx); }
      if (b.x > W - RB) { b.x = W - RB; b.vx = -Math.abs(b.vx) * E; hit = Math.abs(b.vx); }
    }
    if (b.y < RB && !inMouth && b.y > -RB) { b.y = RB; b.vy = Math.abs(b.vy) * E; hit = Math.abs(b.vy); }
    if (b.y > H - RB && !inMouth && b.y < H + RB) { b.y = H - RB; b.vy = -Math.abs(b.vy) * E; hit = Math.abs(b.vy); }
    if (hit > 25) ev.push({ k: "wall" });
    [[W / 2 - half, 0], [W / 2 + half, 0], [W / 2 - half, H], [W / 2 + half, H]].forEach(function (pp) {
      var dx = b.x - pp[0], dy = b.y - pp[1], d = Math.hypot(dx, dy);
      if (d < RB + 0.5 && d > 0) { dx /= d; dy /= d; b.x = pp[0] + dx * (RB + 0.5); var r = b.vx * dx + b.vy * dy; if (r < 0) { b.vx -= 1.8 * r * dx; b.vy -= 1.8 * r * dy; ev.push({ k: "post" }); } }
    });
    if (b.y < 0 || b.y > H) {
      b.x = Math.max(W / 2 - half + RB, Math.min(W / 2 + half - RB, b.x));
      if (b.y < -3.5) { b.y = -3.5; b.vy = Math.abs(b.vy) * 0.15; } if (b.y > H + 3.5) { b.y = H + 3.5; b.vy = -Math.abs(b.vy) * 0.15; }
    }
    if (m.state === 1 && m.resetIn <= 0) {
      var w = b.y < -RB * 0.2 && inMouth ? 0 : b.y > H + RB * 0.2 && inMouth ? 1 : -1;
      if (w >= 0) {
        m.sc[w]++;
        ev.push({ k: "goal", w: w, sc: m.sc.slice() });
        // versus: first goal wins. Challenge: only the humans' goalsToWin-th goal ends it; any other goal resets to a kick-off
        if (m.mode === "versus" || (w === m.humanTeam && m.sc[w] >= m.goalsToWin)) { m.state = 2; m.winner = w; }
        else m.resetIn = 1.5;
      }
    }
    var inCrease = Math.hypot(b.x - W / 2, b.y) < CREASE || Math.hypot(b.x - W / 2, b.y - H) < CREASE;
    var pinned = b.x < RB + 2.5 || b.x > W - RB - 2.5 || b.y < RB + 2.5 || b.y > H - RB - 2.5;
    if (m.state === 1 && m.resetIn <= 0 && (inCrease || pinned) && Math.hypot(b.vx, b.vy) < 5) {
      m.stuck += dt; if (m.stuck > 1.5) { var ddx = W / 2 - b.x, ddy = H / 2 - b.y, dd = Math.hypot(ddx, ddy) || 1; b.vx = ddx / dd * 14; b.vy = ddy / dd * 14; m.stuck = 0; }
    } else m.stuck = 0;
  }
  function results(m) {
    if (m.state === 3 && m.mode === "challenge") { var h = m.humanTeam; return h === 0 ? ["lose", "win"] : ["win", "lose"]; }
    if (m.winner < 0) return ["draw", "draw"];
    return m.winner === 0 ? ["win", "lose"] : ["lose", "win"];
  }
  function step(m, dt) {
    var ev = []; m.n++;
    if (m.state === 4) return ev;
    if (m.state === 0) { m.cd -= dt; if (m.cd <= 0) { m.state = 1; ev.push({ k: m.kicked ? "kickoff" : "go" }); m.kicked = true; } return ev; }
    if (m.state === 2 || m.state === 3) {
      m.after += dt; var h = dt * 0.25 / SUB;
      for (var i = 0; i < SUB; i++) { moveBall(m, h, []); movePlayers(m, h, true, []); }
      if (m.after >= 2.6) { m.state = 4; var r = results(m); ev.push({ k: "end", r0: r[0], r1: r[1] }); }
      return ev;
    }
    if (m.resetIn > 0) {   // a challenge goal: short celebration, then everyone back to the start spots and a 1 s countdown
      m.resetIn -= dt; var hh = dt * 0.25 / SUB;
      for (var k = 0; k < SUB; k++) { moveBall(m, hh, []); movePlayers(m, hh, true, []); }
      if (m.resetIn <= 0) { place(m); m.state = 0; m.cd = 1; }
      return ev;
    }
    m.left -= dt;
    if (m.left <= 15 && !m.grew) { m.grew = true; ev.push({ k: "grow" }); }
    if (m.grew) m.gw = Math.min(GW1, m.gw + dt * 8);
    if (m.left <= 0) { m.left = 0; m.state = 3; ev.push({ k: "draw" }); return ev; }
    think(m, dt);
    var hs = dt / SUB;
    for (var j = 0; j < SUB && m.state === 1 && m.resetIn <= 0; j++) { movePlayers(m, hs, false, ev); moveBall(m, hs, ev); }
    return ev;
  }
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  function snapshot(m) {
    var b = m.ball;
    return { n: m.n, st: m.state, tl: Math.max(0, Math.round(m.left * 1000)), gw: r2(m.gw), md: m.mode === "challenge" ? 1 : 0, sc: m.sc.slice(),
      b: [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy)], p: m.p.map(function (q) { return [r2(q.x), r2(q.y), r2(q.vx), r2(q.vy)]; }) };
  }
  root.Sim3 = { C: C, createMatch: createMatch, setInput: setInput, step: step, snapshot: snapshot, followTarget: followTarget };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
