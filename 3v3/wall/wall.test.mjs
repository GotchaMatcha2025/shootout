// Big-screen rules (node --test 3v3/wall/wall.test.mjs). The drawing is checked in a browser; these pin the decisions it draws from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const WC = require('./wall.js');

test('server choice: ?api= first, then the tab, then localhost = staging, else live', () => {
  assert.equal(WC.pickMode('local', 'staging', 'gotchamatcha2025.github.io', 'https:'), 'local');
  assert.equal(WC.pickMode(undefined, 'fake', 'gotchamatcha2025.github.io', 'https:'), 'fake');
  assert.equal(WC.pickMode('bogus', null, 'localhost', 'http:'), 'staging');
  assert.equal(WC.pickMode(undefined, null, 'x', 'file:'), 'staging');
  assert.equal(WC.pickMode(undefined, null, 'gotchamatcha2025.github.io', 'https:'), 'live');
});
test('socket address: wss for https, ws for http, role=wall, no device id', () => {
  assert.equal(WC.wsUrl(WC.BASES.live), 'wss://gotcha-shootout-3v3.long-fog-ae60.workers.dev/ws?role=wall');
  assert.equal(WC.wsUrl(WC.BASES.local), 'ws://localhost:8787/ws?role=wall');
});
test('reconnect forever: grows from ~0.5 s and never passes 12.5 s', () => {
  assert.equal(WC.backoff(0, 0.5), 500);
  assert.equal(WC.backoff(3, 0.5), 4000);
  for (const n of [5, 9, 50, 1e6]) { const d = WC.backoff(n, 1); assert.ok(d > 0 && d <= 12500, n + ' → ' + d); }
});
test('labels: single player = VS THE MATCHA BOT, multiplayer = its size', () => {
  assert.equal(WC.modeLabel(1, 1), 'VS THE MATCHA BOT');
  assert.equal(WC.modeLabel('solo', 1), 'VS THE MATCHA BOT');
  assert.equal(WC.modeLabel(0, 1), '1 V 1');
  assert.equal(WC.modeLabel(0, 2), '2 V 2');
});
test('info line: only what the server sent; nothing when nothing waits', () => {
  const now = 1_000_000;
  assert.equal(WC.infoLine({ k: now + 12000, humans: [1, 1] }, [], now), 'Next kick-off 0:12 · 2 players waiting');
  assert.equal(WC.infoLine({ k: now + 1000, humans: [1, 0] }, [], now), 'Next kick-off 0:01 · 1 player waiting');
  assert.equal(WC.infoLine({ k: now - 1, humans: [2, 0] }, [], now), '');   // a stale kick-off is not shown
  assert.equal(WC.infoLine(null, ['a', 'b', 'c'], now), '3 matches on now');
  assert.equal(WC.infoLine(null, ['a'], now), '');
  assert.equal(WC.infoLine(undefined, undefined, now), '');
});
const snap = (x, tl, extra) => Object.assign({ st: 1, tl, gw: 28, md: 0, sc: [0, 0], b: [x, 50], p: [[x, 10], [x, 80]] }, extra);
test('drawn ~100 ms behind: halfway between two snapshots is halfway', () => {
  const buf = [{ t: 1000, s: snap(10, 50000) }, { t: 1033, s: snap(20, 49967) }];
  const v = WC.sample(buf, 1016.5);
  assert.ok(Math.abs(v.b[0] - 15) < 1e-9 && Math.abs(v.p[1][0] - 15) < 1e-9);
  assert.equal(WC.sample(buf, 900).b[0], 10);     // before the first: the first
  assert.equal(WC.sample(buf, 5000).b[0], 20);    // after the last: hold the last (no guessing past the server)
  assert.equal(WC.sample([], 1), null);
});
test('a kick-off reset (jump > 12 units) is not slid across the pitch', () => {
  const buf = [{ t: 0, s: snap(2, 30000) }, { t: 33, s: snap(30, 29967) }];
  assert.equal(WC.sample(buf, 16).b[0], 30);
});
test('cheers: versus first goal wins; draw at time up', () => {
  assert.deepEqual(WC.goalText(0, 0, [1, 0], 0, null, true), { text: 'GOAL! TEAM MATCHA', party: true, end: true });
  assert.equal(WC.goalText(0, 1, [0, 1], 0, null, true).text, 'GOAL! TEAM YUZU');
  assert.equal(WC.timeUpText(0).text, 'DRAW');
});
test("cheers: single player uses the server's need; bot goals only restart play", () => {
  assert.deepEqual(WC.goalText(1, 1, [0, 1], 0, 1, false), { text: 'MATCHA BOT SCORES', party: false, end: false });
  assert.equal(WC.goalText(1, 0, [1, 3], 0, 1, false).text, 'MATCHA BOT BEATEN!');   // need 1: the first goal wins
  assert.equal(WC.goalText(1, 0, [1, 0], 0, 2, false).text, 'GOAL!');                // need 2: one more to go
  assert.equal(WC.goalText(1, 0, [2, 0], 0, 2, false).text, 'MATCHA BOT BEATEN!');
  assert.equal(WC.goalText(1, 0, [1, 0], 0, null, true).text, 'MATCHA BOT BEATEN!');  // need unknown: the server ending it (st 2) decides
  assert.equal(WC.goalText(1, 0, [1, 0], 0, null, false).text, 'GOAL!');
  assert.equal(WC.timeUpText(1).text, 'THE MATCHA BOT WINS');
  assert.equal(WC.needLine(1), 'ONE GOAL WINS');
  assert.equal(WC.needLine(3), 'SCORE 3 TO WIN');
  assert.equal(WC.needLine(null), '');
});
test('scorer: the team whose drawn score went up', () => {
  assert.equal(WC.scorer([0, 0], [1, 0]), 0);
  assert.equal(WC.scorer([1, 2], [1, 3]), 1);
  assert.equal(WC.scorer([1, 1], [1, 1]), -1);
  assert.equal(WC.scorer(null, [1, 0]), -1);   // the first frame seen never cheers
});

// the stand-in engine (until 3v3/assets/sim.js ships): same API, seeded only
function loadStandin() {
  const ctx = { Math: Object.create(Math, { random: { value: () => { throw new Error('Math.random used'); } } }) };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('./sim-standin.js', import.meta.url), 'utf8'), ctx);
  return ctx.Sim3;
}
function run(Sim, o, maxS) {
  const m = Sim.createMatch(o), seen = { goals: [], states: new Set(), end: null };
  for (let i = 0; i < maxS * 60 && !seen.end; i++) {
    for (const e of Sim.step(m, 1 / 60)) { if (e.k === 'goal') seen.goals.push(e); if (e.k === 'end') seen.end = e; }
    seen.states.add(Sim.snapshot(m).st);
  }
  return { m, seen, s: Sim.snapshot(m) };
}
test('stand-in: any team size, 2·size players, never Math.random, always ends', () => {
  const Sim = loadStandin();
  for (const size of [1, 2, 3]) {
    const { s, seen } = run(Sim, { seed: 7 + size, humans: [], cats: [[0, 1, 2], [3, 0, 1]], mode: 'versus', size }, 70);
    assert.equal(s.p.length, size * 2);
    assert.ok(seen.end, 'size ' + size + ' ended');
    assert.equal(s.md, 0);
  }
});
test('stand-in single player: bot goals reset to a kick-off, the human team wins on need', () => {
  const Sim = loadStandin();
  let playedOn = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { seen, s } = run(Sim, { seed, humans: [], cats: [[0], [1]], mode: 'challenge', size: 1, goalsToWin: 1 }, 75);
    assert.equal(s.md, 1);
    assert.ok(seen.end);
    const winGoal = seen.goals.find(g => g.w === 0);
    if (winGoal) assert.equal(seen.end.r0, 'win');
    else { assert.equal(seen.end.r0, 'lose'); assert.ok(seen.states.has(3), 'no human goal: ended by the clock, not by a bot goal'); }   // never a draw
    if (seen.goals.length >= 2) playedOn++;
  }
  assert.ok(playedOn > 0, 'some match played on after a bot goal');
});
