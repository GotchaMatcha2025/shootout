/* Test only (loaded by wall.js when ?api=fake): a fake server feed with the wall messages of API-3V3.md §3/§7/§10, made with Sim3.
   It alternates a 2 v 2, a 1 v the Matcha Bot and a 1 v 1, with 0–40 ms of arrival jitter, then idles so the demo shows.
   ?fake=nostart drops the `start` messages (a wall that joins mid-match); ?fake=drop closes the socket every 25 s.
   ?fake=nocounts leaves out today's counts; ?fake=nobooth leaves out the booth game. Each match re-sends its `start` after 5 s (as after a reconnect); in 2 v 2 a seat turns BOT (`bt`) after 10 s (a dropped player). */
(function () {
  "use strict";
  var q = location.search;
  var BOOTHS = ["K7M4", "XW9Q", "HP3T"];   // the booth code changes every 15 s; "1 waiting" every other 5 s
  function FakeSocket() {
    var self = this, Sim = window.Sim3, tick = 0, wallT = 0, cyc = 0, m = null, id = 0, idle = 0, deliverAt = 0, dead = false, ended = 0;
    this.readyState = 0;
    function send(o) {
      if (dead) return;
      var at = Math.max(deliverAt, Date.now() + Math.random() * 40); deliverAt = at;   // a socket keeps order
      setTimeout(function () { if (!dead && self.onmessage) self.onmessage({ data: JSON.stringify(o) }); }, at - Date.now());
    }
    var PLAN = [{ size: 2, md: 0, bots: [[0, 0], [0, 0]], cats: [[0, 1], [2, 3]], drop: 3 }, { size: 1, md: 1, need: 1, bots: [[0], [1]], cats: [[1], [3]] },
      { size: 1, md: 0, bots: [[0], [0]], cats: [[2], [0]] }], began = 0, resent = false;
    function begin() {
      var P = PLAN[cyc++ % PLAN.length]; id++;
      m = Sim.createMatch({ seed: id * 7919, humans: [], cats: P.cats, mode: P.md ? "challenge" : "versus", size: P.size, goalsToWin: P.need || 1 });
      m.fake = P; began = Date.now(); resent = false;
      if (!/nostart/.test(q)) send({ t: "start", id: "M" + id, md: P.md, need: P.need, cats: P.cats, bots: P.bots, at: Date.now() });
    }
    function loop() {
      if (dead) return;
      var now = Date.now();
      if (now - wallT > 2000) { wallT = now; send({ t: "wall", now: now, live: m ? ["M" + id] : [], closed: 0, goals: /nocounts/.test(q) ? undefined : 120 + id * 3, beaten: /nocounts/.test(q) ? undefined : id > 1 ? id - 1 : 0,
        booth: /nobooth/.test(q) ? undefined : { code: BOOTHS[Math.floor(now / 15000) % BOOTHS.length], n: Math.floor(now / 5000) % 2 } }); }
      if (!m) { if (now - idle > 6000) begin(); return; }
      var ev = Sim.step(m, 1 / 60).concat(Sim.step(m, 1 / 60));
      ev.forEach(function (e) {
        if (e.k === "end") { send({ t: "end", id: "M" + id, w: e.r0 === "win" ? 0 : e.r1 === "win" ? 1 : -1, r: "win", code: "NEVER-SHOWN", prize: null }); ended = 1; }
        else if (e.k !== "hit" || e.p >= 0.15) { var o = { t: "ev" }; for (var k in e) o[k] = e[k]; send(o); }
      });
      if (!resent && now - began > 5000 && !/nostart/.test(q)) { resent = true; var P2 = m.fake; send({ t: "start", id: "M" + id, md: P2.md, need: P2.need, cats: P2.cats, bots: P2.bots, at: began }); }
      var s = Sim.snapshot(m), bt = 0;
      m.fake.bots.forEach(function (row, t) { row.forEach(function (b, sl) { if (b) bt |= 1 << (t * m.fake.size + sl); }); });
      if (m.fake.drop != null && now - began > 10000) bt |= 1 << m.fake.drop;
      s.bt = bt; s.t = "s"; send(s);
      if (ended) { m = null; ended = 0; idle = now; }
    }
    setTimeout(function () {
      self.readyState = 1; if (self.onopen) self.onopen({});
      idle = Date.now() - 4000; tick = setInterval(loop, 33);
      if (/drop/.test(q)) setTimeout(function () { self.close(); }, 25000);
    }, 300);
    this.send = function () {};
    this.close = function () { if (dead) return; dead = true; clearInterval(tick); self.readyState = 3; if (self.onclose) self.onclose({}); };
  }
  window.FakeSocket = FakeSocket;
})();
