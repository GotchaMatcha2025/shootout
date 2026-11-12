/* Gotcha Shootout: a real football that ROLLS (owner 13 Nov ~05:45 "real soccer ball", ~05:48 "make the ball roll").
   The classic 32-panel ball (12 black pentagons) on a sphere, seen from above. Each frame the ball turns about the axis at right angles
   to its travel, by distance ÷ radius, so the panels move across it the way a real rolling ball's do. Light stays top-left; a shadow under it.
   Plain ES5 (old TV browsers). Shared by the phone game and the big screen: window.Ball3D. */
(function () {
  "use strict";
  var T = (1 + Math.sqrt(5)) / 2;
  function norm(p) { var l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]); return [p[0] / l, p[1] / l, p[2] / l]; }
  // the 12 corners of an icosahedron = the centres of the 12 pentagons
  var V = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]].map(norm);
  var PENT = [], SEAM = [], cut = {};
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  // cutting each corner a third of the way along its 5 edges gives the pentagon's 5 corners (the truncated icosahedron)
  V.forEach(function (v, k) {
    var nb = [];
    V.forEach(function (w, j) { if (j !== k && dot(v, w) > 0.4) nb.push(j); });   // the 5 neighbours (dot ≈ 0.447)
    var u = norm(Math.abs(v[0]) < 0.9 ? [0, -v[2], v[1]] : [-v[2], 0, v[0]]), w2 = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]];
    var pts = nb.map(function (j) {
      var w = V[j], p = norm([v[0] * 2 / 3 + w[0] / 3, v[1] * 2 / 3 + w[1] / 3, v[2] * 2 / 3 + w[2] / 3]);
      cut[k + ":" + j] = p;
      return { p: p, a: Math.atan2(dot(p, w2), dot(p, u)) };
    });
    pts.sort(function (a, b) { return a.a - b.a; });
    PENT.push({ c: v, pts: pts.map(function (q) { return q.p; }) });
  });
  V.forEach(function (v, k) { V.forEach(function (w, j) { if (k < j && dot(v, w) > 0.4) SEAM.push([cut[k + ":" + j], cut[j + ":" + k]]); }); });   // hexagon-to-hexagon seams

  function create() { return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] }; }
  // roll by a move (dx, dy) in the frame the ball is drawn in; r = radius in the same units
  function roll(st, dx, dy, r) {
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 1e-6) || !(r > 0)) return;
    if (d > r * 3) d = r * 3;   // a jump (reconnect, kick-off reset) never spins it wildly
    var ax = -dy / Math.sqrt(dx * dx + dy * dy), ay = dx / Math.sqrt(dx * dx + dy * dy), th = d / r, c = Math.cos(th), s = Math.sin(th), t = 1 - c;
    var R = [t * ax * ax + c, t * ax * ay, s * ay, t * ax * ay, t * ay * ay + c, -s * ax, -s * ay, s * ax, c];   // about (ax, ay, 0)
    var m = st.m, n = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) n[i * 3 + j] = R[i * 3] * m[j] + R[i * 3 + 1] * m[3 + j] + R[i * 3 + 2] * m[6 + j];
    // keep it a clean rotation (no drift over thousands of frames)
    var a = norm([n[0], n[3], n[6]]), b = [n[1], n[4], n[7]], k = dot(a, b); b = norm([b[0] - k * a[0], b[1] - k * a[1], b[2] - k * a[2]]);
    var cz = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    st.m = [a[0], b[0], cz[0], a[1], b[1], cz[1], a[2], b[2], cz[2]];
  }
  function rot(m, p) { return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]]; }
  function onDisc(q) { if (q[2] >= 0) return q; var l = Math.sqrt(q[0] * q[0] + q[1] * q[1]) || 1; return [q[0] / l, q[1] / l, 0]; }   // a point round the back sits on the rim
  // draw at (x, y), radius r, in the current transform; light from the top-left of this frame
  function draw(g, st, x, y, r, shadow) {
    if (shadow !== false) { g.fillStyle = "rgba(0,0,0,.38)"; g.beginPath(); g.arc(x + r * 0.22, y + r * 0.32, r * 0.98, 0, 7); g.fill(); }
    g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
    g.fillStyle = "#ffffff"; g.fillRect(x - r, y - r, r * 2, r * 2);
    var m = st.m, i, j;
    g.strokeStyle = "#5b6066"; g.lineWidth = Math.max(r * 0.05, 0.05);
    for (i = 0; i < SEAM.length; i++) {
      var a = rot(m, SEAM[i][0]), b = rot(m, SEAM[i][1]);
      if (a[2] < 0 && b[2] < 0) continue;
      a = onDisc(a); b = onDisc(b);
      g.beginPath(); g.moveTo(x + a[0] * r, y + a[1] * r); g.lineTo(x + b[0] * r, y + b[1] * r); g.stroke();
    }
    g.fillStyle = "#15171a";
    for (i = 0; i < PENT.length; i++) {
      var cz = rot(m, PENT[i].c);
      if (cz[2] < -0.3) continue;   // round the back
      g.beginPath();
      for (j = 0; j < 5; j++) { var q = onDisc(rot(m, PENT[i].pts[j])); g[j ? "lineTo" : "moveTo"](x + q[0] * r, y + q[1] * r); }
      g.closePath(); g.fill();
    }
    var sh = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r * 1.02);   // the light (fixed) and the round edge
    sh.addColorStop(0, "rgba(255,255,255,.55)"); sh.addColorStop(0.45, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(0,0,0,.42)");
    g.fillStyle = sh; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = Math.max(r * 0.08, 0.08); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  }
  window.Ball3D = { create: create, roll: roll, draw: draw };
})();
