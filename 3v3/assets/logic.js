/* Gotcha Shootout 3v3 — the phone's small pure rules, kept apart so node tests can check them (3v3/test/logic.test.mjs). No DOM here. */
(function (root) {
"use strict";
const lerp = (a, b, k) => a + (b - a) * k;
const lerpArr = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const ahead = (q, s) => [q[0] + (q[2] || 0) * s, q[1] + (q[3] || 0) * s, q[2], q[3]];
// the world drawn at time t (phone ms) from snapshots stamped on arrival: others ~100 ms behind; past the newest = up to 100 ms ahead on velocity
function interp(snaps, t){
  if (!snaps || !snaps.length) return null;
  const first = snaps[0];
  if (t <= first.ts) return { gw: first.gw, b: first.b, p: first.p };
  let i = snaps.length - 1; while (i > 0 && snaps[i].ts > t) i--;
  const a = snaps[i], b = snaps[i + 1];
  if (!b){ const s = Math.min(0.1, (t - a.ts) / 1000); return { gw: a.gw, b: ahead(a.b, s), p: a.p.map(q => ahead(q, s)) }; }
  if (b.p.length !== a.p.length) return { gw: b.gw, b: b.b, p: b.p };
  const k = (t - a.ts) / Math.max(1, b.ts - a.ts);
  return { gw: lerp(a.gw, b.gw, k), b: lerpArr(a.b, b.b, k), p: a.p.map((q, j) => lerpArr(q, b.p[j], k)) };
}
// arrival stamps: never two at once, so a bunch of late snapshots still spreads out in time
const stamp = (prev, t) => prev == null ? t : Math.max(t, prev + 8);
// the finger goes to the server at most every minMs, and only when it changed (0.05 world units, or finger down/up)
function shouldSend(last, cur, t, minMs){
  if (last && t - last.t < minMs) return false;
  if (!last || cur.a !== last.a) return true;
  return cur.a === 1 && (Math.abs(cur.x - last.x) >= 0.05 || Math.abs(cur.y - last.y) >= 0.05);
}
// where our own predicted player was at time t (for comparing with the server's position, which is about one round trip old)
function histAt(h, t){
  if (!h || !h.length || t < h[0].t - 50) return null;
  let best = h[0]; for (const e of h) if (Math.abs(e.t - t) < Math.abs(best.t - t)) best = e;
  return best;
}
// screen point → world point. A Yuzu phone draws the world turned 180°, so the same turn is undone here: the bottom of a Yuzu screen is y ≈ 0
function toWorld(v, sx, sy, W, H){
  let x = (sx - v.ox) / v.S, y = (sy - v.oy) / v.S; if (v.flip){ x = -x; y = -y; }
  return { x: x + W / 2, y: y + H / 2 };
}
const backoff = tries => Math.min(3000, 300 * Math.pow(2, tries));   // reconnect wait before jitter: 300, 600, 1200, 2400, 3000 ms
const CODE_ABC = "ACDEFHJKMNPQRTUVWXY34679";
// typed game code: upper case, O read as 0, only the code alphabet kept (§12.5: S, 1, I, L, B never reach the server as a wrong try)
const cleanCode = s => String(s || "").toUpperCase().replace(/O/g, "0").split("").filter(c => CODE_ABC.indexOf(c) >= 0).join("").slice(0, 4);
const goals = n => n === 1 ? "1 goal" : n + " goals";
// the result's prize card shows only when there is something to redeem: a code and a prize name; a lost game vs the bot never (§12.3, §13)
const hasPrize = res => !!(res && res.code && res.prize && res.prize.label && !(res.md === 1 && res.r !== "win"));
// the prize ticket (adversarial S1: a code must never vanish): the newest prize is kept on its own; a later result without a prize never
// replaces it; it shows until staff use it or it expires
function keepPrize(stored, res){
  if (!hasPrize(res)) return stored || null;
  return { code: res.code, label: res.prize.label, exp: res.exp || null, used: res.used || null, id: res.id || null, at: res.at || null };
}
const prizeLive = (p, now) => !!(p && p.code && !p.used && !(p.exp && now >= p.exp));
// a result with no prize card says why, in a few words (none → nothing; a lost game vs the bot never has a prize, so no line)
const WHY = { used: "Prize used today", hours: "Prizes in booth hours", offline: "Offline · no prize", cap: "No prizes left" };
const whyLine = res => !res || hasPrize(res) || (res.md === 1 && res.r !== "win") ? "" : WHY[res.why] || "";
// plan B (§8) when single player hears nothing for 6 s: a socket that is up = the hello is in flight, keep waiting; play on the phone only
// when the server says so or the line really failed (2+ connects); anything else = the game is resting
const planB = (up, fails, soloLocal) => soloLocal ? "local" : up ? "wait" : fails >= 2 ? "local" : "rest";
// the ball is drawn ahead of the newest snapshot while the ball is live, and at the sim's quarter speed during the goal / time-up stop,
// so the switch never snaps it back; at a kick-off (countdown, reset) it is interpolated like everyone else
const ballAhead = (st, ahead) => st === 1 ? ahead : st === 2 || st === 3 ? ahead * 0.25 : null;
// "BOT" over a seat: the snapshot's bt bitmask (seat i held by a bot now, e.g. a dropped phone) wins over the kick-off list
const isBot = (bt, i, startBot) => typeof bt === "number" ? !!((bt >> i) & 1) : startBot !== 0;
// a recovered result (after a sleep or reload) belongs to this match only if the ids match, never by time
const sameMatch = (r, id) => !!(r && r.ok && r.code && id && r.id === id);
// "The game is resting" after 3 failed connects (CTO §9.5) only while asking for a game (create / join); a room or a result on screen
// keeps reconnecting (the server holds the seat 60 s) and never loses the result; single player has plan B instead
const restAfterFails = (phase, solo, fails, screen) => !solo && fails >= 3 && phase === "asking" && screen !== "result";
root.L3 = { restAfterFails, interp, stamp, shouldSend, histAt, toWorld, backoff, cleanCode, goals, hasPrize, keepPrize, prizeLive, whyLine, planB, ballAhead, isBot, sameMatch, CODE_ABC };
})(typeof globalThis !== "undefined" ? globalThis : this);
