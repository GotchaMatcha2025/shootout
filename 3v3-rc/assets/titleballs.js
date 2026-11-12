/* The two O's of SHOOTOUT are the real rolling football (owner 13 Nov ~06:55 "the ball here is not updated"): each .ballo gets a canvas
   with Ball3D (assets/ball3d.js), rolling slowly, the two out of step. Drawn only while the home screen shows; reduced motion = drawn once. */
(function () {
  "use strict";
  if (!window.Ball3D) return;
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var balls = [].slice.call(document.querySelectorAll(".ballo")).map(function (el, i) {
    var c = document.createElement("canvas"), st = window.Ball3D.create();
    window.Ball3D.roll(st, 3 + i * 7, 5 - i * 3, 10);   // a different face each
    el.appendChild(c);
    return { el: el, c: c, st: st, dir: i ? -1 : 1 };
  });
  if (!balls.length) return;
  var last = 0;
  function draw(t) {
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (!b.el.offsetParent) continue;   // home screen not showing: nothing to draw
      var px = Math.round(b.el.clientWidth * (window.devicePixelRatio || 1));
      if (px < 4) continue;
      if (b.c.width !== px) { b.c.width = b.c.height = px; }
      var g = b.c.getContext("2d"), r = px / 2;
      if (!reduce) window.Ball3D.roll(b.st, b.dir * r * 1.1 * dt, r * 0.35 * dt, r);   // about one turn every 6 s
      g.clearRect(0, 0, px, px);
      window.Ball3D.draw(g, b.st, r, r, r * 0.96, false);
    }
    if (!reduce) requestAnimationFrame(draw);
  }
  if (reduce) { setTimeout(function () { draw(0); }, 300); window.addEventListener("resize", function () { draw(0); }); }
  else requestAnimationFrame(draw);
})();
