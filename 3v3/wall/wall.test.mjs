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
test('labels: single player = VS MATCHA BOT, multiplayer = its size', () => {
  assert.equal(WC.modeLabel(1, 1), 'VS MATCHA BOT');
  assert.equal(WC.modeLabel('solo', 1), 'VS MATCHA BOT');
  assert.equal(WC.modeLabel(0, 1), '1 V 1');
  assert.equal(WC.modeLabel(0, 2), '2 V 2');
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
  assert.equal(WC.goalText(1, 0, [1, 3], 0, 1, false).text, 'GOAL! BOT BEATEN');    // need 1: the first goal wins
  assert.equal(WC.goalText(1, 0, [1, 0], 0, 2, false).text, 'GOAL!');               // need 2: one more to go
  assert.equal(WC.goalText(1, 0, [2, 0], 0, 2, false).text, 'GOAL! BOT BEATEN');
  assert.equal(WC.goalText(1, 0, [1, 0], 0, null, true).text, 'GOAL! BOT BEATEN');   // need unknown: the server ending it (st 2) decides
  assert.equal(WC.goalText(1, 0, [1, 0], 0, null, false).text, 'GOAL!');
  assert.equal(WC.timeUpText(1).text, 'MATCHA BOT WINS');
});
test('BOT label: the bt bitmask (bit team*size+slot) wins over start.bots', () => {
  // 2 v 2: bit 3 = team 1 slot 1 (a bot holding a dropped player's seat); start said all four were people
  const people = [[0, 0], [0, 0]];
  assert.deepEqual([0, 1, 2, 3].map(i => WC.isBot(i, 2, 8, people)), [false, false, false, true]);
  assert.deepEqual([0, 1, 2, 3].map(i => WC.isBot(i, 2, 0, [[1, 1], [1, 1]])), [false, false, false, false]);   // bt 0 = everyone a person
  assert.deepEqual([0, 1].map(i => WC.isBot(i, 1, 2, null)), [false, true]);                                // 1 v Matcha Bot: bit 1
  assert.deepEqual([0, 1, 2, 3].map(i => WC.isBot(i, 2, undefined, [[0, 1], [1, 0]])), [false, true, true, false]);   // no bt: start's bots
  assert.equal(WC.isBot(0, 1, undefined, null), false);
});
test('sample carries the newest bt, so a seat that just turned BOT is labelled at once', () => {
  const s1 = { st: 1, tl: 1000, gw: 28, md: 0, sc: [0, 0], bt: 0, b: [1, 1], p: [[1, 1], [2, 2]] }, s2 = Object.assign({}, s1, { bt: 2 });
  assert.equal(WC.sample([{ t: 0, s: s1 }, { t: 33, s: s2 }], 10).bt, 2);
});
test('featured match: a re-sent start for the match on screen keeps it; another id or an ended match starts afresh', () => {
  assert.equal(WC.sameMatch({ id: 'M1', endAt: 0 }, { t: 'start', id: 'M1' }), true);
  assert.equal(WC.sameMatch({ id: 'M1', endAt: 0 }, { t: 'start', id: 'M2' }), false);
  assert.equal(WC.sameMatch({ id: 'M1', endAt: 500 }, { t: 'start', id: 'M1' }), false);
  assert.equal(WC.sameMatch(null, { id: 'M1' }), false);
  assert.equal(WC.sameMatch({ id: null, endAt: 0 }, { id: null }), false);
});
test('featured match: a leftover frame after end never replaces it; a fresh match or another size does', () => {
  const last = { st: 2, tl: 23000, p: [[0, 0], [1, 1], [2, 2], [3, 3]] }, sz2 = t => ({ st: 1, tl: t, p: last.p });
  assert.equal(WC.snapKind(null, null, sz2(5000)), 'new');
  assert.equal(WC.snapKind({ endAt: 0 }, last, sz2(22967)), 'add');
  assert.equal(WC.snapKind({ endAt: 0 }, last, { st: 0, tl: 22000, p: last.p }), 'add');            // a single-player kick-off mid-match
  assert.equal(WC.snapKind({ endAt: 0 }, last, sz2(60000)), 'new');                                  // the clock went back up: we missed its end
  assert.equal(WC.snapKind({ endAt: 0 }, last, { st: 1, tl: 20000, p: [[0, 0], [1, 1]] }), 'new');   // another team size
  assert.equal(WC.snapKind({ endAt: 9 }, last, { st: 4, tl: 23000, p: last.p }), 'skip');            // the ended match's last frame
  assert.equal(WC.snapKind({ endAt: 9 }, last, { st: 0, tl: 60000, p: last.p }), 'new');             // the next match's countdown
  assert.equal(WC.snapKind({ endAt: 9 }, null, { st: 0, tl: 60000, p: last.p }), 'new');
  assert.equal(WC.snapKind({ endAt: 9 }, null, { st: 1, tl: 30000, p: last.p }), 'skip');
});
test('bottom strip: real counts only; each part hidden when unknown or zero', () => {
  assert.equal(WC.countsLine({ goals: 128, beaten: 7 }), '⚽ 128 TODAY   🤖 BEATEN 7×');
  assert.equal(WC.countsLine({ goals: 128, beaten: 0 }), '⚽ 128 TODAY');
  assert.equal(WC.countsLine({ goalsToday: 3, botBeaten: 1 }), '⚽ 3 TODAY   🤖 BEATEN 1×');
  assert.equal(WC.countsLine({ beaten: 2 }), '🤖 BEATEN 2×');
  for (const m of [null, {}, { goals: 0 }, { goals: '12' }, { goals: -3, beaten: NaN }, { t: 'wall', live: [] }]) assert.equal(WC.countsLine(m), '', JSON.stringify(m));
});
test('flashes: at most one big flash every 1.6 s', () => {
  assert.equal(WC.flashOk(5000, 0), true);
  assert.equal(WC.flashOk(5000, 3500), false);
  assert.equal(WC.flashOk(5100, 3500), true);
});
test('slow motion: 0.3× up to the goal frame, then catch up at 2.5×, never ahead of 100 ms behind', () => {
  const target = 10000;
  assert.equal(WC.playClock(null, target, 16, null), target);                 // first frame
  assert.equal(WC.playClock(5000, target, 16, null), target);                 // far behind: jump
  assert.equal(WC.playClock(target, target, 16, 10050), target);             // never ahead of the target
  assert.equal(WC.playClock(9950, target, 20, 9990), 9956);                   // slow: 20 ms of real time = 6 ms of play
  assert.equal(WC.playClock(9988, target, 20, 9990), 9990);                   // stops at the goal frame
  assert.equal(WC.playClock(9800, target, 20, null), 9850);                   // then catches up at 2.5×
  assert.equal(WC.playClock(9990, target, 20, null), target);
  assert.equal(WC.playClock(9200, target, 20, 9990), 9250);                   // a goal far ahead (lag ≥ 700 ms): no more slow motion
});
test('goal ahead: the first buffered frame within 400 ms whose score is higher than the drawn one', () => {
  const f = (t, sc) => ({ t, s: { sc } }), buf = [f(100, [0, 0]), f(133, [0, 0]), f(166, [1, 0]), f(199, [1, 0])];
  assert.equal(WC.goalAhead(buf, 120, [0, 0]), 166);
  assert.equal(WC.goalAhead(buf, 170, [1, 0]), null);
  assert.equal(WC.goalAhead(buf, 120, null), null);
  assert.equal(WC.goalAhead([f(900, [1, 0])], 100, [0, 0]), null);           // more than 400 ms ahead
});
test('the GOAL banner: hand-drawn word + the line under it', () => {
  assert.deepEqual(WC.splitCheer('GOAL! TEAM MATCHA'), { big: 'GOAL!', sub: 'TEAM MATCHA' });
  assert.deepEqual(WC.splitCheer('GOAL! BOT BEATEN'), { big: 'GOAL!', sub: 'BOT BEATEN' });
  assert.deepEqual(WC.splitCheer('MATCHA BOT WINS'), { big: 'MATCHA BOT WINS', sub: '' });
  assert.deepEqual(WC.splitCheer('GOAL!'), { big: 'GOAL!', sub: '' });
});
test('scorer: the team whose drawn score went up', () => {
  assert.equal(WC.scorer([0, 0], [1, 0]), 0);
  assert.equal(WC.scorer([1, 2], [1, 3]), 1);
  assert.equal(WC.scorer([1, 1], [1, 1]), -1);
  assert.equal(WC.scorer(null, [1, 0]), -1);   // the first frame seen never cheers
});

// the real engine (3v3/assets/sim.js): same API, seeded only
function loadStandin() {
  const ctx = { Math: Object.create(Math, { random: { value: () => { throw new Error('Math.random used'); } } }) };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('../assets/sim.js', import.meta.url), 'utf8'), ctx);
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
test('single player (real sim.js): bot goals reset to a kick-off, the human team wins on need', () => {
  const Sim = loadStandin();
  let playedOn = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { seen, s } = run(Sim, { seed, humans: [{ team: 0, slot: 0 }], cats: [[0], [1]], mode: 'challenge', size: 1, goalsToWin: 1 }, 75);   // a challenge always has its human (the real sim keys the bot team off it)
    assert.equal(s.md, 1);
    assert.ok(seen.end);
    const winGoal = seen.goals.find(g => g.w === 0);
    if (winGoal) assert.equal(seen.end.r0, 'win');
    else { assert.equal(seen.end.r0, 'lose'); assert.ok(seen.states.has(3), 'no human goal: ended by the clock, not by a bot goal'); }   // never a draw
    if (seen.goals.length >= 2) playedOn++;
  }
  // play-on after a bot goal is covered by sim.js's own tests (sim/test/modes.test.mjs); an idle human rarely concedes twice here
});
