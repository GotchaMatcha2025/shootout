/* Gotcha Shootout: the shared match rules (sim.js). Contract: API-3V3.md §1, §7–§13.
   One file, copied byte-identical to the server (the truth), the phone (predicts its own player) and the wall (bots-only demo).
   Port of the approved mock-up engine (rev 2 yes 12 Nov 2026 ~20:20; rev 3 yes ~20:52: 1 v Matcha Bot, 1 v 1, 2 v 2). ES2018, no imports.
   No platform randomness and no clocks: every random call uses the match's own mulberry32 state, so same seed + same inputs = same match. */
(function (root, make) {
  var S = make();
  root.Sim3 = S;
  if (typeof module === "object" && module && module.exports) module.exports = S;   // node tests (CommonJS); the Worker uses globalThis
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

const C = {
  W: 60, H: 96, RP: 3.3, RB: 1.9, CREASE: 9, POST: .5,              // pitch, player and ball radii, goal circle, post radius
  GW0: 28, GW1: 40, GROW_AT_S: 15, GROW_PER_S: 8,                    // goals 28 wide, growing to 40 at 8/s from 15 s left
  COUNT_S: 3, MATCH_S: 60, CELEB_S: 2.6, DT: 1 / 60, SUB: 2,         // 2 physics sub-steps per 1/60 s step
  HUMAN_MAX: 95, FOLLOW: 45, GLIDE: .8,                              // finger: 45x the gap a second, capped 95 (owner ~21:14: 55 felt delayed); up = x0.8 a sub-step
  HUMAN_REACH: 1,                                                    // CTO G1: a human hits the ball at RP+RB+1.0, bots at RP+RB
  BOT_FAST: 55, BOT_GUARD: 34, BOT_SUPPORT: 30, BOT_LINE: 6, BOT_RECOVER_S: .35,
  HELP: .2, BALL_MAX: 75, DRAG: .32, WALL_E: .9, HIT_E: .85, POST_E: .8,
  SQUEEZE_V: 24, SLOW_V: 5, UNSTICK_S: 1.5, UNSTICK_V: 14,
  HIT_MIN: 6, HIT_FULL: 70, HIT_GAP_S: .12,                          // a touch is a "hit" event above impulse 6; p = impulse / 70
  CHALLENGE_GOALS: 1, GW_CH: 14, HARD: 2.6, RESET_S: 1.5, KICKOFF_S: 1,   // vs the Matcha Bot: 1 goal wins, goals 14 and fixed, bot x2.6 (rev 8)
  LEVEL_MIN: .5, LEVEL_MAX: 1.5, KEEPER_STUN_S: .05,                                     // botLevel scales the hard bot's speed and reactions
  ST_COUNT: 0, ST_PLAY: 1, ST_GOAL: 2, ST_DRAW: 3, ST_END: 4, ST_RESET: 5,   // 3 = time up (versus: draw; challenge: the bot wins, w set)
  TEAMS: [{ name: "Matcha", col: "#6fbf4a" }, { name: "Yuzu", col: "#ffd23f" }]
};
C.SUB_DT = C.DT / C.SUB;
Object.freeze(C.TEAMS[0]); Object.freeze(C.TEAMS[1]); Object.freeze(C.TEAMS); Object.freeze(C);
const W = C.W, H = C.H, RP = C.RP, RB = C.RB;

/* rng: mulberry32, kept as one int on the match (m.rs) so the match stays plain JSON */
function mix(a) {
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function mulberry32(seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; return mix(a); }; }
function rnd(m) { m.rs = (m.rs + 0x6D2B79F5) | 0; return mix(m.rs); }

const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = v => typeof v === "number" && isFinite(v);
// never throw on bad input (CTO G1): every export checks its match and numbers first
const isMatch = m => !!(m && typeof m === "object" && (m.size === 1 || m.size === 2 || m.size === 3) && Array.isArray(m.p) && m.p.length === 2 * m.size &&
  m.p.every(q => q && typeof q === "object") && m.b && typeof m.b === "object" && Array.isArray(m.sc));
const attackY = tm => (tm === 0 ? 0 : H);                      // Matcha attacks the top goal (y=0), Yuzu the bottom (y=H)
const seat = (m, team, slot) => (isMatch(m) && (team === 0 || team === 1) && Number.isInteger(slot) && slot >= 0 && slot < m.size ? m.p[team * m.size + slot] : null);
const BASE = { 1: [[W / 2, H * .74]], 2: [[W / 2, H * .62], [W / 2, H * .83]], 3: [[W / 2, H * .62], [W * .25, H * .8], [W * .75, H * .8]] };   // start spots (team 0; team 1 mirrored)

function clampField(o) { o.x = clamp(o.x, RP, W - RP); o.y = clamp(o.y, RP, H - RP); }
// nobody may stand in a goal circle (so a goal can't be blocked by parking in front of it): pushed out to the circle's edge
function outOfCrease(o) {
  const m = C.CREASE + RP;
  for (let k = 0; k < 2; k++) {
    const cy = k === 0 ? 0 : H;
    let dx = o.x - W / 2, dy = o.y - cy, d = Math.hypot(dx, dy);
    if (d < m) { if (d < .01) { dx = 0; dy = cy === 0 ? 1 : -1; d = 1; } o.x = W / 2 + dx / d * m; o.y = cy + dy / d * m; }
  }
}
function keepOut(o) { clampField(o); outOfCrease(o); }
const reach = q => RP + RB + (q.bot ? 0 : C.HUMAN_REACH);

// {seed, humans:[{team,slot}], cats, size: 1|2|3 (default 3), mode: "versus"|"challenge", goalsToWin (challenge, default 1), botLevel 0.5–1.5}
function createMatch(o) {
  o = o && typeof o === "object" ? o : {};
  const size = o.size === 1 || o.size === 2 || o.size === 3 ? o.size : 3, md = o.mode === "challenge" ? 1 : 0;
  const cats = Array.isArray(o.cats) ? o.cats : [[0, 1, 2], [3, 0, 1]];
  const humans = Array.isArray(o.humans) ? o.humans : [];
  const isH = (tm, s) => humans.some(u => u && u.team === tm && u.slot === s);
  const hasH = [0, 1].map(tm => BASE[size].some((_, s) => isH(tm, s)));
  const m = { v: 2, size: size, md: md, need: Number.isInteger(o.goalsToWin) && o.goalsToWin >= 1 && o.goalsToWin <= 9 ? o.goalsToWin : C.CHALLENGE_GOALS,
    lvl: isNum(o.botLevel) ? clamp(o.botLevel, C.LEVEL_MIN, C.LEVEL_MAX) : 1, ht: hasH[0] !== hasH[1] ? (hasH[0] ? 0 : 1) : -1,   // ht: the one team with humans
    rs: isNum(o.seed) ? (o.seed >>> 0) | 0 : 0, n: 0, st: C.ST_COUNT, cd: C.COUNT_S, left: C.MATCH_S, gw: md ? C.GW_CH : C.GW0, grew: false,
    w: -1, sc: [0, 0], after: 0, stuck: 0, lh: -1e6, b: { x: W / 2, y: H / 2, vx: 0, vy: 0 }, p: [] };
  for (let tm = 0; tm < 2; tm++) for (let s = 0; s < size; s++) {
    const x = BASE[size][s][0], y = tm === 0 ? BASE[size][s][1] : H - BASE[size][s][1];
    const h = isH(tm, s) ? 1 : 0;
    const cat = cats[tm] && Number.isInteger(cats[tm][s]) ? cats[tm][s] : 0;
    m.p.push({ team: tm, slot: s, cat: cat, h: h, bot: h ? 0 : 1, hard: md && !hasH[tm] ? 1 : 0,   // challenge: the team without humans is the hard Matcha Bot
      x: x, y: y, hx: x, hy: y, vx: 0, vy: 0, ix: x, iy: y, ia: 0, tx: x, ty: y, think: rnd(m) * .2, recover: 0, role: "", aim: null, fast: false });
  }
  return m;
}

// finger target in world units; non-numbers are ignored, positions are clamped to the pitch (the server re-sends nothing it doesn't trust)
function setInput(m, team, slot, i) {
  const q = seat(m, team, slot);
  if (!q || !i || typeof i !== "object") return false;
  if (isNum(i.x) && isNum(i.y)) { q.ix = clamp(i.x, 0, W); q.iy = clamp(i.y, 0, H); }
  if (i.a !== undefined) q.ia = i.a ? 1 : 0;
  return true;
}

// hand a seat to a bot (dropped phone) or back to its human; the human comes back with the finger up until the phone sends
function setBot(m, team, slot, on) {
  const q = seat(m, team, slot);
  if (!q) return false;
  q.bot = on ? 1 : 0;
  q.think = 0; q.recover = 0; q.role = ""; q.aim = null; q.fast = false; q.tx = q.x; q.ty = q.y;
  if (!on) { q.ia = 0; q.ix = q.x; q.iy = q.y; }
  return true;
}
const botLabel = (m, team, slot) => { const q = seat(m, team, slot); return q && q.bot ? "BOT" : ""; };
// Yuzu's phone turns the world 180° (its own inverse): view(1, x, H) = the bottom of a Yuzu screen = world y 0
const view = (team, x, y) => (!isNum(x) || !isNum(y) ? null : team === 1 ? { x: W - x, y: H - y } : { x: x, y: y });

/* the human mallet: the player chases the finger; one sub-step of at most 1/120 s */
function follow(q, x, y, a, h) {
  if (a) {
    let vx = (x - q.x) * C.FOLLOW, vy = (y - q.y) * C.FOLLOW; const s = Math.hypot(vx, vy);
    if (s > C.HUMAN_MAX) { vx *= C.HUMAN_MAX / s; vy *= C.HUMAN_MAX / s; }
    q.vx = vx; q.vy = vy;
  } else { q.vx *= C.GLIDE; q.vy *= C.GLIDE; }
  q.x += q.vx * h; q.y += q.vy * h; keepOut(q);
}
// exported for the phone's own-player prediction: same sub-steps as the server, so a lone player lands where the server puts it
function followTarget(q, t, dt) {
  if (!q || typeof q !== "object" || !isNum(q.x) || !isNum(q.y) || !isNum(dt) || dt <= 0) return q;
  if (!isNum(q.vx)) q.vx = 0;
  if (!isNum(q.vy)) q.vy = 0;
  const ok = t && typeof t === "object" && isNum(t.x) && isNum(t.y), d = Math.min(dt, .5);
  const n = Math.max(1, Math.ceil(d / C.SUB_DT - 1e-9)), h = d / n;
  for (let i = 0; i < n; i++) follow(q, ok ? clamp(t.x, 0, W) : q.x, ok ? clamp(t.y, 0, H) : q.y, ok && !!t.a, h);
  return q;
}

/* bots: the bot nearest the ball strikes (unless a human team-mate is clearly nearer), the one nearest our goal guards, the other supports */
function think(m, dt) {
  const b = m.b;
  for (let tm = 0; tm < 2; tm++) {
    const gy = attackY(tm), ownY = tm === 0 ? H : 0, bots = [];
    let humBest = 1e9, chaser = null, best = 1e9, guard = null;
    for (let s = 0; s < m.size; s++) {
      const q = m.p[tm * m.size + s], d = Math.hypot(q.x - b.x, q.y - b.y);
      if (!q.bot) { if (d < humBest) humBest = d; continue; }
      bots.push(q); if (d < best) { best = d; chaser = q; }
    }
    if (!bots.length) continue;
    if (humBest < best - 3) chaser = null;
    for (const q of bots) if (q !== chaser && (!guard || Math.abs(q.y - ownY) < Math.abs(guard.y - ownY))) guard = q;   // ties: lower slot
    if (bots.length === 1 && chaser && chaser.hard) {
      // the lone Matcha Bot keeps goal first: it strikes only with the ball on its own side, not rushing at goal, and itself goal-side of it
      const near = Math.abs(b.y - ownY) < H * .42, coming = ownY === 0 ? b.vy < -6 : b.vy > 6, behind = Math.abs(chaser.y - ownY) < Math.abs(b.y - ownY);
      const slow = Math.hypot(b.vx, b.vy) < 25, clear = Math.hypot(b.x - W / 2, b.y - ownY) > C.CREASE + RP + 4;   // never swipes beside its own goal
      if (!near || coming || !behind || !slow || !clear) { guard = chaser; chaser = null; }
    }
    for (const q of bots) {
      q.think -= dt; q.recover = Math.max(0, q.recover - dt);
      if (q.think > 0) continue;
      q.think = q.hard ? (.04 + rnd(m) * .03) / m.lvl : .1 + rnd(m) * .08;   // the hard bot looks again 2–3x as often
      if (q.recover > 0) { q.fast = false; q.tx = q.x + (W / 2 - q.x) * .2; q.ty = q.y + (ownY - q.y) * .25; }   // backs off after a hit
      else if (q === chaser) {
        q.role = "strike";
        if (q.aim === null || rnd(m) < .05) q.aim = (rnd(m) - .5) * 14;
        // aim where the ball will be in a moment, from behind it, toward the other goal
        const bx0 = b.x + b.vx * .12, by0 = b.y + b.vy * .12;
        let dx = W / 2 + q.aim - bx0, dy = gy - by0, dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const K = RP + RB + 1.2; let bx = bx0 - dx * K, by = by0 - dy * K;
        if (bx < RP || bx > W - RP || by < RP || by > H - RP) { dx = W / 2 - bx0; dy = H / 2 - by0; dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; bx = bx0 - dx * K; by = by0 - dy * K; }
        const along = (q.x - bx0) * dx + (q.y - by0) * dy, side = (q.x - bx0) * -dy + (q.y - by0) * dx;
        if (along < 0 && Math.abs(side) < C.BOT_LINE && -along < 14) { q.tx = bx0 + dx * 8; q.ty = by0 + dy * 8; q.fast = true; }   // lined up: hit through
        else if (along < 0) { q.tx = bx; q.ty = by; q.fast = false; }                                                             // get behind it
        else { const sd = side > 0 ? 1 : -1; q.tx = bx + (-dy) * sd * (K + 2); q.ty = by + dx * sd * (K + 2); q.fast = false; }   // go round it
      } else if (q === guard) {
        q.role = "guard"; q.fast = q.hard && bots.length === 1;   // the lone Matcha Bot keeps goal at its full speed
        const dx = b.x - W / 2, dy = b.y - ownY, dl = Math.hypot(dx, dy) || 1;   // on the goal circle's edge, between ball and goal
        // a ball inside its own circle can only be pushed goalward from outside: the Matcha Bot blocks the way to it without touching it
        const R = q.hard && dl < C.CREASE + RB ? Math.max(C.CREASE + RP + .6, dl + RP + RB + .4) : C.CREASE + RP + .6;
        q.tx = W / 2 + dx / dl * R; q.ty = ownY + dy / dl * R;
      } else {
        q.role = "support"; q.fast = false;
        q.tx = q.hx * .45 + b.x * .55 + (rnd(m) - .5) * 2; q.ty = b.y + (ownY - b.y) * .4;
      }
      const t = { x: q.tx, y: q.ty }; keepOut(t); q.tx = t.x; q.ty = t.y;
    }
  }
}

function movePlayers(m, h, slow, ev) {
  const P = m.p;
  for (const q of P) {
    if (!q.bot) { follow(q, q.ix, q.iy, q.ia, h); continue; }
    // the Matcha Bot runs at 2.6x; botLevel speeds up its striking only (a faster keeper overshoots its line and saves less)
    const max = (q.fast ? C.BOT_FAST : (q.role === "guard" ? C.BOT_GUARD : C.BOT_SUPPORT)) * (q.hard ? C.HARD * (q.role === "guard" ? 1 : m.lvl) : 1);
    const dx = q.tx - q.x, dy = q.ty - q.y, d = Math.hypot(dx, dy), sp = Math.min(max, d * 8);
    const vx = d > .01 ? dx / d * sp : 0, vy = d > .01 ? dy / d * sp : 0, k = Math.min(1, h * 10);
    q.vx += (vx - q.vx) * k; q.vy += (vy - q.vy) * k;
    q.x += q.vx * h; q.y += q.vy * h; keepOut(q);
  }
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], c = P[j]; let dx = c.x - a.x, dy = c.y - a.y; const d = Math.hypot(dx, dy);
    // players don't overlap; re-checked against the walls and goal circles so a shove never pushes anyone into one
    if (d < RP * 2 && d > 0) { const o = (RP * 2 - d) / 2; dx /= d; dy /= d; a.x -= dx * o; a.y -= dy * o; c.x += dx * o; c.y += dy * o; keepOut(a); keepOut(c); }
  }
  if (slow) return;
  const b = m.b, order = P.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd(m) * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }   // random order: no team wins a 50/50 by list order
  const touching = [], hits = [];
  for (const q of order) {
    const R = reach(q);   // a human reaches 1.0 further (CTO G1: makes up for the phone seeing the ball late)
    let dx = b.x - q.x, dy = b.y - q.y; const d = Math.hypot(dx, dy);
    if (!(d < R && d > 0)) continue;
    touching.push(q);
    dx /= d; dy /= d; b.x = q.x + dx * R; b.y = q.y + dy * R;
    // mallet hit: the ball bounces off the moving player (player = heavy), so a fast swipe = a hard shot
    const rel = (b.vx - q.vx) * dx + (b.vy - q.vy) * dy;
    if (rel >= 0) continue;
    const before = Math.hypot(b.vx, b.vy);
    b.vx -= (1 + C.HIT_E) * rel * dx; b.vy -= (1 + C.HIT_E) * rel * dy;
    // shot help: a hit already heading within ~60° of the other goal bends 20% onto it
    const sp = Math.hypot(b.vx, b.vy); let ux = b.vx / (sp || 1), uy = b.vy / (sp || 1);
    let gx = W / 2 - b.x, gy = attackY(q.team) - b.y; const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    if (ux * gx + uy * gy > .5) { ux = ux * (1 - C.HELP) + gx * C.HELP; uy = uy * (1 - C.HELP) + gy * C.HELP; const l = Math.hypot(ux, uy); b.vx = ux / l * sp; b.vy = uy / l * sp; }
    const imp = Math.abs(sp - before) + Math.abs(rel);
    if (imp > C.HIT_MIN) hits.push([q, imp]);
  }
  // squeeze: a ball trapped between 2 players, or a player and a wall or post, pops sideways toward the open pitch
  const half = m.gw / 2, nearPost = Math.abs(Math.abs(b.x - W / 2) - half) < RB + C.POST + .4 && (b.y < RB + C.POST + .4 || b.y > H - RB - C.POST - .4);
  const atWall = b.x < RB + .4 || b.x > W - RB - .4 || ((b.y < RB + .4 || b.y > H - RB - .4) && Math.abs(b.x - W / 2) > half) || nearPost;
  if (touching.length >= 2 || (touching.length === 1 && atWall)) {
    let ax, ay;
    if (touching.length >= 2) { ax = touching[1].x - touching[0].x; ay = touching[1].y - touching[0].y; }
    else { ax = b.x - touching[0].x; ay = b.y - touching[0].y; }
    const al = Math.hypot(ax, ay) || 1; let px = -ay / al, py = ax / al;
    if ((W / 2 - b.x) * px + (H / 2 - b.y) * py < 0) { px = -px; py = -py; }
    b.vx = px * C.SQUEEZE_V; b.vy = py * C.SQUEEZE_V; b.x += px * .8; b.y += py * .8;
    // the squeezers are shoved off the ball so the pop has room (two players 6.5 apart left no gap: rev 2 jittered up to 14,000 hits a match)
    for (const q of touching) {
      let dx = q.x - b.x, dy = q.y - b.y; const d = Math.hypot(dx, dy) || 1, R = reach(q) + .3;
      if (d < R) { q.x = b.x + dx / d * R; q.y = b.y + dy / d * R; keepOut(q); }
    }
    return;   // a squeeze is not a shot: no hit events, no bot back-off
  }
  for (const h of hits) {
    const q = h[0];
    // at most one hit event per 0.12 s a match (≤ 500): a 2 v 2 face-off ping-pongs ~12 real bounces a second; the physics is unchanged
    if (m.n - m.lh >= Math.round(C.HIT_GAP_S / C.DT)) { m.lh = m.n; ev.push({ k: "hit", team: q.team, slot: q.slot, p: r2(Math.min(1, h[1] / C.HIT_FULL)) }); }
    // a striker backs off after a hit; the Matcha Bot's keeper only blinks after a save (shorter at a higher botLevel): the human's one chance
    if (q.bot) q.recover = q.hard && q.role === "guard" ? C.KEEPER_STUN_S / (m.lvl * m.lvl) : C.BOT_RECOVER_S;
  }
}

function moveBall(m, h, ev) {
  const b = m.b, inMouth = ballPhysics(b, h, m.gw, ev);
  if (m.st === C.ST_PLAY) {   // goal = ball centre past the line inside the mouth
    if (b.y < -RB * .2 && inMouth) onGoal(m, 0, ev);
    else if (b.y > H + RB * .2 && inMouth) onGoal(m, 1, ev);
  }
  // unstick: a slow ball nobody can reach (in a goal circle, or pinned on a wall) slides back toward the middle after 1.5 s
  const inCrease = Math.hypot(b.x - W / 2, b.y) < C.CREASE || Math.hypot(b.x - W / 2, b.y - H) < C.CREASE;
  const pinned = b.x < RB + 2.5 || b.x > W - RB - 2.5 || b.y < RB + 2.5 || b.y > H - RB - 2.5;
  if (m.st === C.ST_PLAY && (inCrease || pinned) && Math.hypot(b.vx, b.vy) < C.SLOW_V) {
    m.stuck += h;
    if (m.stuck > C.UNSTICK_S) { const dx = W / 2 - b.x, dy = H / 2 - b.y, d = Math.hypot(dx, dy) || 1; b.vx = dx / d * C.UNSTICK_V; b.vy = dy / d * C.UNSTICK_V; m.stuck = 0; }
  } else m.stuck = 0;
}

// versus: the first goal wins. Challenge: the human team wins at goalsToWin; any other goal = 1.5 s cheer, then a fresh kick-off
function onGoal(m, w, ev) {
  m.sc[w]++;
  ev.push({ k: "goal", w: w, sc: m.sc.slice() });
  if (!m.md || (m.sc[w] >= m.need && (m.ht < 0 || w === m.ht))) { m.st = C.ST_GOAL; m.w = w; }
  else { m.st = C.ST_RESET; m.after = 0; }
}
function kickoff(m, ev) {   // everyone back to their start spots, ball to the centre, 1 s countdown; the clock waits
  for (const q of m.p) { q.x = q.tx = q.hx; q.y = q.ty = q.hy; q.vx = q.vy = 0; q.recover = 0; q.fast = false; }
  m.b.x = W / 2; m.b.y = H / 2; m.b.vx = m.b.vy = 0;
  m.st = C.ST_COUNT; m.cd = C.KICKOFF_S; m.after = 0; m.stuck = 0;
  ev.push({ k: "kickoff" });
}

// the ball on its own: drag, top speed, walls, posts, net (no players, no scoring); returns whether it is inside the goal mouth
function ballPhysics(b, h, gw, ev) {
  const half = gw / 2, E = C.WALL_E;
  const f = Math.exp(-C.DRAG * h); b.vx *= f; b.vy *= f;
  const sp = Math.hypot(b.vx, b.vy); if (sp > C.BALL_MAX) { b.vx *= C.BALL_MAX / sp; b.vy *= C.BALL_MAX / sp; }
  b.x += b.vx * h; b.y += b.vy * h;
  const inMouth = Math.abs(b.x - W / 2) < half - RB * .3;
  let hit = 0;
  // side walls always (rev 2 skipped them while the ball was past an end line, so a corner shove could leave it outside the pitch)
  if (b.x < RB) { b.x = RB; b.vx = Math.abs(b.vx) * E; hit = Math.abs(b.vx); }
  if (b.x > W - RB) { b.x = W - RB; b.vx = -Math.abs(b.vx) * E; hit = Math.abs(b.vx); }
  if (b.y < RB && !inMouth && b.y > -RB) { b.y = RB; b.vy = Math.abs(b.vy) * E; hit = Math.abs(b.vy); }
  if (b.y > H - RB && !inMouth && b.y < H + RB) { b.y = H - RB; b.vy = -Math.abs(b.vy) * E; hit = Math.abs(b.vy); }
  // a ball shoved past the end line beside the goal (corner squeeze) goes back on the pitch, never sideways into the net
  if (b.y < 0 && Math.abs(b.x - W / 2) > half) { b.y = RB; b.vy = Math.abs(b.vy) * E; b.x = clamp(b.x, RB, W - RB); }
  if (b.y > H && Math.abs(b.x - W / 2) > half) { b.y = H - RB; b.vy = -Math.abs(b.vy) * E; b.x = clamp(b.x, RB, W - RB); }
  if (hit > 25) ev.push({ k: "wall" });
  for (let k = 0; k < 4; k++) {
    const px = W / 2 + (k & 1 ? half : -half), py = k < 2 ? 0 : H;
    let dx = b.x - px, dy = b.y - py; const d = Math.hypot(dx, dy), R = RB + C.POST;
    if (d < R && d > 0) {
      dx /= d; dy /= d; b.x = px + dx * R; b.y = py + dy * R;
      const r = b.vx * dx + b.vy * dy; if (r < 0) { b.vx -= (1 + C.POST_E) * r * dx; b.vy -= (1 + C.POST_E) * r * dy; ev.push({ k: "post" }); }
    }
  }
  if (b.y < 0 || b.y > H) {   // in the net
    b.x = clamp(b.x, W / 2 - half + RB, W / 2 + half - RB);
    if (b.y < -3.5) { b.y = -3.5; b.vy = Math.abs(b.vy) * .15; }
    if (b.y > H + 3.5) { b.y = H + 3.5; b.vy = -Math.abs(b.vy) * .15; }
  }
  return inMouth;
}

// CTO G1: the phone draws the ball ahead of the newest snapshot (up to 150 ms) with the server's own ball code; [x,y,vx,vy] or {x,y,vx,vy}
function stepBall(ball, dt, gw) {
  if (!ball || typeof ball !== "object") return ball;
  const arr = Array.isArray(ball), b = arr ? { x: ball[0], y: ball[1], vx: ball[2], vy: ball[3] } : { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  if (![b.x, b.y, b.vx, b.vy].every(isNum) || !isNum(dt) || dt <= 0) return ball;
  const g = isNum(gw) ? clamp(gw, C.GW_CH, C.GW1) : C.GW0, n = Math.min(60, Math.max(1, Math.ceil(Math.min(dt, .5) / C.SUB_DT - 1e-9))), h = Math.min(dt, .5) / n, sink = [];
  for (let i = 0; i < n; i++) ballPhysics(b, h, g, sink);
  if (arr) { ball[0] = b.x; ball[1] = b.y; ball[2] = b.vx; ball[3] = b.vy; } else { ball.x = b.x; ball.y = b.y; ball.vx = b.vx; ball.vy = b.vy; }
  return ball;
}

// advance by dt seconds (server: 1/60, twice per 1/30 s tick); returns this step's events
function step(m, dt) {
  const ev = [];
  if (!isMatch(m) || !isNum(dt) || dt <= 0) return ev;
  dt = Math.min(dt, .05);   // a stalled tab or tick never jumps the ball through a player
  m.n++;
  if (m.st === C.ST_END) return ev;
  if (m.st === C.ST_COUNT) {
    m.cd -= dt;
    if (m.cd <= 1e-9) { m.cd = 0; m.st = C.ST_PLAY; ev.push({ k: "go" }); }
    return ev;
  }
  if (m.st === C.ST_RESET) {   // challenge goal that doesn't end it: a short cheer at 0.3 speed, then the kick-off
    m.after += dt;
    const h = dt * .3 / C.SUB;
    for (let i = 0; i < C.SUB; i++) { moveBall(m, h, ev); movePlayers(m, h, true, ev); }
    if (m.after >= C.RESET_S - 1e-9) kickoff(m, ev);
    return ev;
  }
  if (m.st === C.ST_GOAL || m.st === C.ST_DRAW) {   // celebration: the world rolls on at quarter speed, then the match ends
    m.after += dt;
    const h = dt * .25 / C.SUB;
    for (let i = 0; i < C.SUB; i++) { moveBall(m, h, ev); movePlayers(m, h, true, ev); }
    if (m.after >= C.CELEB_S - 1e-9) {
      m.st = C.ST_END;
      const r = tm => (m.w < 0 ? "draw" : m.w === tm ? "win" : "lose");
      ev.push({ k: "end", r0: r(0), r1: r(1) });
    }
    return ev;
  }
  m.left -= dt;
  if (!m.md) {   // versus goals grow 28 → 40 from 15 s left; the challenge's goals stay 16
    if (m.left <= C.GROW_AT_S + 1e-9 && !m.grew) { m.grew = true; ev.push({ k: "grow" }); }
    if (m.grew) m.gw = Math.min(C.GW1, m.gw + dt * C.GROW_PER_S);
  }
  if (m.left <= 1e-9) {   // time up: a draw in versus; in a challenge the bot wins (no draw)
    m.left = 0; m.st = C.ST_DRAW;
    if (m.md && m.ht >= 0) { m.w = 1 - m.ht; ev.push({ k: "timeup", w: m.w }); } else ev.push({ k: "draw" });
    return ev;
  }
  think(m, dt);
  const h = dt / C.SUB;
  for (let i = 0; i < C.SUB && m.st === C.ST_PLAY; i++) { movePlayers(m, h, false, ev); moveBall(m, h, ev); }
  return ev;
}

// what goes on the wire ~30/s (< 220 bytes; md 0 versus / 1 challenge, sc = goals [team 0, team 1]): positions to 0.01, ball velocity to 0.1 (stepBall extrapolates it), player velocity whole
// (only drawn: others are interpolated, your own is predicted from your finger), times in ms
function snapshot(m) {
  if (!isMatch(m)) return null;
  const b = m.b, s = { n: m.n, st: m.st, tl: Math.round(m.left * 1000), gw: r2(m.gw), b: [r2(b.x), r2(b.y), r1(b.vx), r1(b.vy)], p: [], md: m.md, sc: m.sc.slice() };
  for (const q of m.p) s.p.push([r2(q.x), r2(q.y), Math.round(q.vx) || 0, Math.round(q.vy) || 0]);
  if (m.st === C.ST_COUNT) s.cd = Math.round(m.cd * 1000);
  if (m.w >= 0) s.w = m.w;
  return s;
}

return { VERSION: "3v3-sim-2", C: C, mulberry32: mulberry32, createMatch: createMatch, setInput: setInput, setBot: setBot, step: step,
  snapshot: snapshot, followTarget: followTarget, stepBall: stepBall, botLabel: botLabel, attackY: attackY, view: view };
});
