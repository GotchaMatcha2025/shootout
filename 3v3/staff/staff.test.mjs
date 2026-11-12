// Staff page rules (node --test 3v3/staff/staff.test.mjs): code entry, what each server answer shows, and that green needs the server's yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SC = require('./staff.js');
const at = Date.UTC(2026, 10, 13, 12, 41);   // 20:41 in Singapore

test('code entry: capitals, code letters only, 6 long', () => {
  assert.deepEqual([SC.clean('acdef3').code, SC.clean('acdef3').done], ['ACDEF3', true]);
  assert.equal(SC.clean(' a c d.e f 3 ').code, 'ACDEF3');
  assert.equal(SC.clean('ACDEF3XY').code, 'ACDEF3');
  assert.equal(SC.clean('acd').done, false);
});
test('code entry: look-alikes (O 0 I 1 L S 5 B 8 Z 2 G) are ignored and flagged', () => {
  const c = SC.clean('AOC0DI1E5F8S3Z2BG');
  assert.equal(c.code, 'ACDEF3'); assert.equal(c.dropped, true);
  assert.equal(SC.clean('ACDEF3').dropped, false);
  for (const ch of 'OIL0125SBZG8') assert.equal(SC.clean(ch + 'ACDEF').body, 'ACDEF', ch);
});
test('code entry: "L-" (played offline) and "T-" (test server) are kept as typed', () => {
  assert.equal(SC.clean('l').text, 'L');                // may be the start of L-: kept until the next key
  assert.equal(SC.clean('l').body, '');
  const off = SC.clean('l-wxy379');
  assert.deepEqual([off.code, off.offline, off.done], ['L-WXY379', true, true]);
  assert.equal(SC.clean('t-acdef3').code, 'T-ACDEF3');
  assert.equal(SC.clean('TACDEF').code, 'TACDEF');      // T is a code letter too
  assert.equal(SC.clean('LK').code, 'K');               // L not followed by "-": a look-alike, dropped
});
test('times are Singapore time', () => { assert.equal(SC.clock(at), '20:41'); assert.equal(SC.clock(null), '?'); });
test('mode line: Matcha Bot with the score; multiplayer with its size', () => {
  assert.equal(SC.modeText({ r: 'win', md: 1, sc: [1, 0], team: 0 }), 'Matcha Bot: won 1–0');
  assert.equal(SC.modeText({ r: 'lose', md: 1, sc: [0, 3] }), 'Matcha Bot: lost 0–3');
  assert.equal(SC.modeText({ r: 'win', md: 'challenge', sc: [0, 2], team: 1 }), 'Matcha Bot: won 2–0');   // the player's goals first
  assert.equal(SC.modeText({ r: 'win', md: 1 }), 'Matcha Bot: won');
  assert.equal(SC.modeText({ r: 'win', md: 0, size: 1 }), '1 v 1: won');
  assert.equal(SC.modeText({ r: 'lose', md: 0, size: 2 }), '2 v 2: lost');
  assert.equal(SC.modeText({ r: 'draw', md: 0 }), 'Multiplayer: draw');
});
test('check: an unused code shows result, mode, time, prize, and offers the hold', () => {
  const v = SC.checkView({ ok: true, status: 200, r: 'win', md: 0, size: 2, at, prize: null, used: null }, 'ACDEF3');
  assert.equal(v.head, 'WIN');
  assert.deepEqual(v.lines, ['2 v 2: won', 'Played at 20:41', 'Prize: not set yet']);
  assert.equal(v.canRedeem, true); assert.equal(v.status.head, 'Not used yet'); assert.equal(v.offline, false);
  assert.equal(SC.checkView({ ok: true, r: 'lose', md: 0, size: 1, at, prize: { label: '$1 off' }, used: null }, 'X').lines[2], 'Prize: $1 off');
});
test('check: a used code is red with its time and no hold; not found is red; no answer is amber', () => {
  const u = SC.checkView({ ok: true, r: 'lose', md: 0, size: 1, at, prize: null, used: at }, 'HJKMN4');
  assert.deepEqual([u.status.tone, u.status.head, u.canRedeem], ['bad', 'ALREADY USED at 20:41', false]);
  assert.deepEqual([SC.checkView({ ok: false, status: 404 }).tone, SC.checkView({ ok: false, status: 404 }).head], ['bad', 'NOT FOUND']);
  for (const r of [{ net: true }, { ok: false, status: 500 }, null]) { const v = SC.checkView(r); assert.deepEqual([v.tone, v.head, !!v.canRedeem], ['warn', 'No answer, try again', false]); }
  assert.equal(SC.checkView({ ok: true, r: 'win', md: 1, sc: [1, 0], at, used: null }, 'L-WXY379').offline, true);
});
test("redeem: green only on the server's yes", () => {
  const ok = SC.redeemView({ ok: true, status: 200, used: at }, { prize: { label: 'Free yuzu' } });
  assert.deepEqual([ok.tone, ok.head, ok.lines[0]], ['ok', '✓ Redeemed', 'Give: Free yuzu']);
  const answers = [{ net: true }, { ok: false, status: 409, e: 'already', used: at }, { ok: false, status: 409, e: 'expired', at }, { ok: false, status: 404 },
    { ok: false, status: 500 }, { ok: false, status: 503 }, { status: 200 }, null];
  for (const r of answers) assert.notEqual(SC.redeemView(r, {}).tone, 'ok', JSON.stringify(r));
});
test('redeem: 409 already = red ALREADY USED at hh:mm; 409 expired = red TOO OLD with the play time; 404 = NOT FOUND; no answer = amber', () => {
  assert.deepEqual([SC.redeemView({ ok: false, status: 409, e: 'already', used: at }).tone, SC.redeemView({ ok: false, status: 409, e: 'already', used: at }).head], ['bad', 'ALREADY USED at 20:41']);
  const old = SC.redeemView({ ok: false, status: 409, e: 'expired' }, { at });
  assert.deepEqual([old.tone, old.head, old.lines[0]], ['bad', 'TOO OLD (over 30 min)', 'Played at 20:41']);
  assert.equal(SC.redeemView({ ok: false, status: 404 }).head, 'NOT FOUND');
  assert.deepEqual([SC.redeemView({ net: true }).tone, SC.redeemView({ net: true }).head], ['warn', 'No answer, try again']);
});
test("redeem: a 409 right after this phone's own unanswered hold says so", () => {
  const sent = at - 3000;
  assert.match(SC.redeemView({ ok: false, status: 409, e: 'already', used: at }, { mine: sent }).lines[0], /Your last hold/);
  assert.equal(SC.redeemView({ ok: false, status: 409, e: 'already', used: at - 600000 }, { mine: sent }).lines[0], 'No prize.');
  assert.equal(SC.redeemView({ ok: false, status: 409, e: 'already', used: at }, {}).lines[0], 'No prize.');
});
test('login errors in plain words', () => {
  assert.equal(SC.loginError({ ok: false, status: 401 }), 'Wrong PIN. Try again.');
  assert.equal(SC.loginError({ ok: false, status: 429 }), 'Too many tries. Wait a few minutes.');
  assert.equal(SC.loginError({ ok: false, status: 503 }), 'Not set up yet. Tell Vin or Kai.');
  assert.equal(SC.loginError({ net: true }), 'No signal. Try again.');
});
test("today's counts: read flat or under counts; missing = 0", () => {
  assert.deepEqual(SC.tiles({ ok: true, matches: 3, humans: 5, wins: 2, losses: 2, draws: 1, used: 1 }).map(t => t[1]), [3, 5, 2, 2, 1, 1]);
  assert.deepEqual(SC.tiles({ ok: true, counts: { matches: 4, plays: 6 } }).map(t => t[1]), [4, 6, 0, 0, 0, 0]);
  assert.deepEqual(SC.tiles({}).map(t => t[0]), ['Matches', 'Plays', 'Won', 'Lost', 'Draws', 'Codes used']);
});
