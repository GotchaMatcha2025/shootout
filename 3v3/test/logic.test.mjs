// Gotcha Shootout 3v3 phone: the small rules in assets/logic.js + the shared sim's follow rule. Run: node --test 3v3/test/*.test.mjs
// SIM_SRC=<path to the shared 3v3/sim/sim.js> also checks the phone's copy is byte-identical (CTO G1 §9.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const here = new URL('../assets/', import.meta.url).pathname;
const ctx = vm.createContext({ Math, console });
for (const f of ['sim.js', 'logic.js']) vm.runInContext(fs.readFileSync(here + f, 'utf8'), ctx, { filename: f });
const L = ctx.L3, Sim = ctx.Sim3, { W, H } = Sim.C;

test('Yuzu flip: a finger at the bottom of a Yuzu screen is near y = 0, the top near y = H; Matcha is the other way', () => {
  const v = { S: 5.5, ox: 187.5, oy: 400, flip: true };                 // a 375 px phone; pitch centre at (187.5, 400)
  const bottom = L.toWorld(v, 187.5, 400 + (H / 2) * 5.5, W, H), top = L.toWorld(v, 187.5, 400 - (H / 2) * 5.5, W, H);
  assert.ok(Math.abs(bottom.y - 0) < 0.01 && Math.abs(bottom.x - W / 2) < 0.01, JSON.stringify(bottom));
  assert.ok(Math.abs(top.y - H) < 0.01, JSON.stringify(top));
  const left = L.toWorld(v, 187.5 - 20 * 5.5, 400, W, H); assert.ok(Math.abs(left.x - (W / 2 + 20)) < 0.01, 'left of a Yuzu screen = right of the world');
  const m = L.toWorld({ ...v, flip: false }, 187.5, 400 + (H / 2) * 5.5, W, H); assert.ok(Math.abs(m.y - H) < 0.01, 'Matcha: bottom of the screen = y H');
  // the shared sim's own view() agrees (it is its own inverse)
  assert.deepEqual(JSON.parse(JSON.stringify(Sim.view(1, bottom.x, bottom.y))), { x: W / 2, y: H });
});

test('finger messages: at most one per 33 ms, only when the finger moved 0.05 or went down / up', () => {
  const last = { x: 10, y: 10, a: 1, t: 1000 };
  assert.equal(L.shouldSend(null, { x: 1, y: 1, a: 0 }, 0, 33), true, 'first message always goes');
  assert.equal(L.shouldSend(last, { x: 20, y: 20, a: 1 }, 1020, 33), false, 'too soon after the last');
  assert.equal(L.shouldSend(last, { x: 10.02, y: 10.03, a: 1 }, 1100, 33), false, 'not moved enough');
  assert.equal(L.shouldSend(last, { x: 10.06, y: 10, a: 1 }, 1100, 33), true, 'moved');
  assert.equal(L.shouldSend(last, { x: 10, y: 10, a: 0 }, 1034, 33), true, 'finger lifted');
  assert.equal(L.shouldSend({ ...last, a: 0 }, { x: 30, y: 30, a: 0 }, 1100, 33), false, 'finger up: moving the target sends nothing');
  let n = 0, prev = null;                                                // a finger moving every 8 ms for 1 s → ≤ 31 messages
  for (let t = 0; t <= 1000; t += 8){ const cur = { x: t / 10, y: 5, a: 1 }; if (L.shouldSend(prev, cur, t, 33)){ n++; prev = { ...cur, t }; } }
  assert.ok(n <= 31 && n >= 25, 'sent ' + n);
});

test('others are interpolated between snapshots; past the newest they run on for at most 100 ms', () => {
  const s = (ts, x) => ({ ts, gw: 28, b: [x, 50, 10, 0], p: [[x, 1, 0, 0], [x, 2, 0, 0]] });
  const snaps = [s(1000, 0), s(1033, 10), s(1066, 20)];
  assert.equal(L.interp(snaps, 1016.5).b[0], 5);
  assert.equal(L.interp(snaps, 900).b[0], 0, 'before the first: hold the first');
  assert.equal(L.interp(snaps, 1066 + 50).b[0], 20 + 10 * 0.05, 'ahead on velocity');
  assert.equal(L.interp(snaps, 1066 + 5000).b[0], 20 + 10 * 0.1, 'never more than 100 ms ahead');
  assert.equal(L.interp([], 1), null);
  assert.equal(L.stamp(1000, 990), 1008, 'a late bunch still spreads out');
});

test('own-player history: the entry nearest the asked time; nothing when asked before the history', () => {
  const h = [{ t: 100, x: 1 }, { t: 116, x: 2 }, { t: 133, x: 3 }];
  assert.equal(L.histAt(h, 120).x, 2); assert.equal(L.histAt(h, 0), null); assert.equal(L.histAt([], 5), null);
});

test('prediction uses the same follow rule as the server: a lone human lands where the sim puts it', () => {
  const m = Sim.createMatch({ seed: 7, humans: [{ team: 0, slot: 0 }] }), q = m.p[0], own = { x: q.x, y: q.y, vx: 0, vy: 0 };
  const target = { x: 20, y: 70, a: 1 };
  for (let i = 0; i < 30; i++){ Sim.setInput(m, 0, 0, target); Sim.followTarget(q, target, 1 / 60); Sim.followTarget(own, target, 1 / 60); }
  assert.ok(Math.hypot(own.x - q.x, own.y - q.y) < 1e-9);
  assert.ok(Math.hypot(own.x - 20, own.y - 70) < 1, 'reached the finger');
});

test('reconnect backoff: 300 ms doubling to a 3 s cap', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(L.backoff), [300, 600, 1200, 2400, 3000, 3000]);
});

test('game codes: upper case, letters and digits, 4 long; goal words', () => {
  assert.equal(L.cleanCode(' k7-m4x '), 'K7M4'); assert.equal(L.cleanCode('nOne'), 'NNE', 'O and letters outside the alphabet are dropped');
  assert.equal(L.cleanCode('s1il'), '', 'S, 1, I, L never reach the server');
  assert.equal(L.goals(1), '1 goal'); assert.equal(L.goals(2), '2 goals');
});

test('prize card: only with a code and a prize name; never for a lost or timed-out game vs the bot', () => {
  const p = { label: 'FREE MATCHA' };
  assert.equal(L.hasPrize({ code: 'K7M2QX', prize: p, md: 0, r: 'lose' }), true, 'friends: the loser gets the consolation prize');
  assert.equal(L.hasPrize({ code: 'K7M2QX', prize: p, md: 1, r: 'win' }), true);
  assert.equal(L.hasPrize({ code: 'K7M2QX', prize: p, md: 1, r: 'lose' }), false, 'lost vs the bot: no card');
  assert.equal(L.hasPrize({ code: 'K7M2QX', prize: null, md: 0, r: 'win' }), false, 'prizes still blank: no card');
  assert.equal(L.hasPrize({ code: null, prize: p, md: 1, r: 'win' }), false, 'no code (plan B without the server): no card');
});

test('sim.js copy is byte-identical to the shared one (set SIM_SRC)', { skip: !process.env.SIM_SRC }, () => {
  const h = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(h(here + 'sim.js'), h(process.env.SIM_SRC));
});
