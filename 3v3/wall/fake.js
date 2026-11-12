/* Test only (loaded by wall.js when ?api=fake): a fake server feed with the wall messages of API-3V3.md §3/§7/§10, made with Sim3.
   It alternates a 2 v 2, a 1 v the Matcha Bot and a 1 v 1, with 0–40 ms of arrival jitter, then idles so the demo shows.
   ?fake=nostart drops the `start` messages (a wall that joins mid-match); ?fake=drop closes the socket every 25 s.
   The heartbeat sends the owner's 4 prizes (§15); ?fake=noprizes sends none; ?fake=closed = paused. Each match re-sends its `start` after 5 s (as after a reconnect); in 2 v 2 a seat turns BOT (`bt`) after 10 s (a dropped player). */
(function () {
  "use strict";
  var q = location.search;
  var PRIZES = [["FREE Sparkling Yuzu Oolong", "with any 2 drinks purchased"], ["FREE Sparkling Strawberry Oolong", "with any 2 drinks purchased"], ["10% OFF", "with any 3 drinks purchased"], ["3 drinks for $14.90", "usual $20+"]];
  function FakeSocket(url) {
    window.__fakeUrl = url;   // tests read the socket address (the wall key)
    var self = this, Sim = window.Sim3, tick = 0, wallT = 0, cyc = 0, m = null, id = 0, idle = 0, deliverAt = 0, dead = false, ended = 0;
    this.readyState = 0;
    function send(o) {
      if (dead) return;
      var at = Math.max(deliverAt, Date.now() + Math.random() * 40); deliverAt = at;   // a socket keeps order
      setTimeout(function () { if (!dead && self.onmessage) self.onmessage({ data: JSON.stringify(o) }); }, at - Date.now());
    }
    // multiplayer = first to 3 in 2 min (owner 12 Nov ~22:54), wrapped round sim.js until it has it: after a goal that doesn't decide,
    // 1.5 s of st 5 (the sim's ST_RESET), then a fresh kick-off that keeps the clock; ?fake=quick = first to 1 in 60 s
    var VN = /quick/.test(q) ? 1 : 3, VS = /quick/.test(q) ? 60 : 120;
    var PLAN = [{ size: 2, md: 0, need: VN, secs: VS, bots: [[0, 0], [0, 0]], drop: 3 }, { size: 1, md: 1, need: 1, secs: 60, bots: [[0], [1]] },
      { size: 1, md: 0, need: VN, secs: VS, bots: [[0], [0]] }], began = 0, resent = false, V = null;
    function versus(P, left) { var x = Sim.createMatch({ seed: id * 7919 + (V ? V.sc[0] * 31 + V.sc[1] : 0), humans: [], mode: "versus", size: P.size }); x.left = left; x.fake = P; return x; }
    function begin() {
      var P = PLAN[cyc++ % PLAN.length]; id++;
      V = P.md ? null : { sc: [0, 0], resetAt: 0 };
      m = P.md ? Sim.createMatch({ seed: id * 7919, humans: [{ team: 0, slot: 0 }], mode: "challenge", size: P.size, goalsToWin: P.need || 1 }) : versus(P, P.secs);
      m.fake = P; began = Date.now(); resent = false;
      if (!/nostart/.test(q)) send({ t: "start", id: "M" + id, md: P.md, need: P.need, secs: P.secs, bots: P.bots, at: Date.now() });
    }
    function loop() {
      if (dead) return;
      var now = Date.now();
      if (now - wallT > 2000) { wallT = now; send({ t: "wall", now: now, live: m ? ["M" + id] : [], closed: /fake=closed/.test(q) ? 1 : 0, prizes: /noprizes|fake=closed/.test(q) ? [] : PRIZES }); }
      if (!m) { if (now - idle > 6000 && !/[?&]fake=idle/.test(q)) begin(); return; }   // ?fake=idle: no matches (the demo + idle sounds only)
      if (V && V.resetAt && now >= V.resetAt) { var keep = m.left; m = versus(m.fake, keep); m.cd = 1; V.resetAt = 0; send({ t: "ev", k: "kickoff" }); }
      var ev = Sim.step(m, 1 / 60).concat(Sim.step(m, 1 / 60));
      ev.forEach(function (e) {
        if (V && e.k === "goal") {   // count it ourselves; only the need-th goal lets the sim's own end run
          V.sc[e.w]++; send({ t: "ev", k: "goal", w: e.w, sc: V.sc.slice() });
          if (V.sc[e.w] < m.fake.need) V.resetAt = now + 1500; else V.won = e.w;
          return;
        }
        if (e.k === "end") { var w = V ? (V.won != null ? V.won : V.sc[0] > V.sc[1] ? 0 : V.sc[1] > V.sc[0] ? 1 : -1) : e.r0 === "win" ? 0 : e.r1 === "win" ? 1 : -1;
          send({ t: "end", id: "M" + id, w: w, r: "win", code: "NEVER-SHOWN", prize: null }); ended = 1; }
        else if (e.k !== "hit" || e.p >= 0.15) { var o = { t: "ev" }; for (var k in e) o[k] = e[k]; send(o); }
      });
      if (!resent && now - began > 5000 && !/nostart/.test(q)) { resent = true; var P2 = m.fake; send({ t: "start", id: "M" + id, md: P2.md, need: P2.need, bots: P2.bots, at: began }); }
      var s = Sim.snapshot(m), bt = 0;
      m.fake.bots.forEach(function (row, t) { row.forEach(function (b, sl) { if (b) bt |= 1 << (t * m.fake.size + sl); }); });
      if (m.fake.drop != null && now - began > 10000) bt |= 1 << m.fake.drop;
      if (V) { s.sc = V.sc.slice(); if (V.resetAt) s.st = 5; }
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
