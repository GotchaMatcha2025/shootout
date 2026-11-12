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
// typed game code: upper case, letters and digits only, 4 long (a letter outside the code alphabet stays, so the server can say "No game")
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
const goals = n => n === 1 ? "1 goal" : n + " goals";
root.L3 = { interp, stamp, shouldSend, histAt, toWorld, backoff, cleanCode, goals, CODE_ABC };
})(typeof globalThis !== "undefined" ? globalThis : this);
