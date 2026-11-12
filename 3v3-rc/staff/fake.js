/* Test only (loaded by staff.js when ?api=fake): fake answers in the shapes of API-3V3.md §4 / §9.6. PIN 123456 (000000 = too many tries).
   Codes: ACDEF3 2 v 2 won, unused · HJKMN4 1 v 1 lost, used · PQRTU6 Matcha Bot won 1–0, unused · L-WXY379 played offline ·
   VWXY97 too old · CCCCCC redeem never answers · DDDDDD redeem loses a race (409) · EEEEEE check never answers · FFFFFF token refused ·
   KKKKKK won, no prize (why "cap") · MMMMMM prize, but the server refuses (409 no-prize). Anything else: not found.
   /staff/settings keeps paused + botLevel in memory; ?fake=nosettings answers it 404 (an older server). */
(function () {
  "use strict";
  var now = Date.now(), M = 60000;
  var B = { paused: false, botLevel: 1 };
  var C = {
    ACDEF3: { r: "win", md: 0, size: 2, sc: [3, 1], team: 0, at: now - 5 * M, prize: { label: "TEST Free sparkling yuzu" }, used: null },
    KKKKKK: { r: "win", md: 0, size: 1, at: now - 3 * M, prize: null, why: "cap", used: null },
    MMMMMM: { r: "win", md: 0, size: 1, at: now - 3 * M, prize: { label: "TEST $1 off" }, used: null, refuse: 1 },
    HJKMN4: { r: "lose", md: 0, size: 1, at: now - 10 * M, prize: { label: "TEST $1 off" }, used: now - 3 * M },
    PQRTU6: { r: "win", md: 1, size: 1, sc: [1, 0], team: 0, at: now - 2 * M, prize: { label: "TEST Free sparkling yuzu" }, used: null },
    "L-WXY379": { r: "win", md: 1, size: 1, sc: [1, 0], team: 0, at: now - 4 * M, prize: { label: "TEST Free sparkling yuzu" }, used: null },
    VWXY97: { r: "draw", md: 0, size: 1, at: now - 40 * M, prize: { label: "TEST $1 off" }, used: null, old: 1 },
    CCCCCC: { r: "win", md: 0, size: 1, at: now - M, prize: { label: "TEST $1 off" }, used: null, slow: 1 },
    DDDDDD: { r: "win", md: 1, size: 1, sc: [1, 3], at: now - M, prize: { label: "TEST $1 off" }, used: null, race: 1 },
    EEEEEE: { r: "win", md: 0, size: 2, at: now - M, prize: null, used: null }
  };
  function later(x, ms) { return new Promise(function (ok) { setTimeout(function () { ok(x); }, ms); }); }
  function never(ms) { return later({ net: true }, ms || 5000); }   // what staff.js sees when the server never answers
  window.FakeApi = function (path, b, ms) {
    var t = 250 + Math.random() * 300;
    if (path === "/staff/login") return b.pin === "123456" ? later({ ok: true, token: "fake-token", status: 200 }, t) : b.pin === "000000" ? later({ ok: false, e: "busy", status: 429 }, t) : later({ ok: false, e: "pin", status: 401 }, t);
    if (b.token !== "fake-token") return later({ ok: false, e: "login", status: 401 }, t);
    if (path === "/staff/state") return later({ ok: true, status: 200, matches: 14, humans: 21, wins: 8, losses: 10, draws: 3, used: 6, paused: B.paused, botLevel: B.botLevel }, t);
    if (path === "/staff/settings") {
      if (/nosettings/.test(location.search)) return later({ ok: false, e: "not-found", status: 404 }, t);
      if (typeof b.paused === "boolean") B.paused = b.paused;
      if ([0.8, 1, 1.2].indexOf(b.botLevel) >= 0) B.botLevel = b.botLevel;
      return later({ ok: true, status: 200, paused: B.paused, botLevel: B.botLevel }, t);
    }
    var c = C[b.code];
    if (b.code === "FFFFFF") return later({ ok: false, e: "login", status: 401 }, t);
    if (path === "/staff/check") {
      if (b.code === "EEEEEE") return never(ms);
      if (!c) return later({ ok: false, e: "not-found", status: 404 }, t);
      return later({ ok: true, status: 200, r: c.r, md: c.md, size: c.size, sc: c.sc, team: c.team, at: c.at, prize: c.prize, used: c.used, why: c.why,
        exp: c.at + 30 * M, local: b.code.indexOf("L-") >= 0 ? 1 : 0 }, t);
    }
    if (path === "/staff/redeem") {
      if (!c) return later({ ok: false, e: "not-found", status: 404 }, t);
      if (c.slow) { c.slow = 0; c.used = Date.now(); return never(ms); }   // the server said yes, but the answer never came back (once)
      if (c.race) { c.used = Date.now() - 20000; c.race = 0; }
      if (c.refuse) return later({ ok: false, e: "no-prize", status: 409 }, t);
      if (c.old) return later({ ok: false, e: "expired", at: c.at, status: 409 }, t);
      if (c.used) return later({ ok: false, e: "already", used: c.used, status: 409 }, t);
      c.used = Date.now(); return later({ ok: true, status: 200, used: c.used }, t);
    }
    return later({ ok: false, e: "bad", status: 400 }, t);
  };
})();
