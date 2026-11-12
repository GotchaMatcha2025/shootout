/* Gotcha Shootout 3v3 — the prize voucher (owner 13 Nov ~05:22 / ~05:30, mock-up yes ~05:56; API §15): on the result screen and in the 🎟 sheet.
   One card, three states:
   ready (live countdown + a slow shine, so staff can tell it is not a screenshot; HOLD TO USE, ~1.5 s), USED (red stamp + time), EXPIRED
   (grey stamp). A quick reveal (~1 s: the server's prizes roll, the won one flips in). Fewest words. */
"use strict";
const Voucher = (() => {
  // the four prizes (owner ~05:22): the server sends the real list; this copy is only for the fake demo (?api=fake)
  const PRIZES = [
    { t: "FREE Sparkling Yuzu Oolong", s: "with any 2 drinks purchased" },
    { t: "FREE Sparkling Strawberry Oolong", s: "with any 2 drinks purchased" },
    { t: "10% OFF", s: "with any 3 drinks purchased" },
    { t: "3 drinks for $14.90", s: "1 Matcha Latte + 1 Strawberry Matcha Latte + 1 Yuzu or Strawberry Sparkling (usual $20+)" }
  ];
  const HOLD_MS = 3000, MOVE_PX = 15, R = typeof Draw !== "undefined" && Draw.REDUCED;
  // the server's clock: the offset from this voucher's own reply (end / result / use), else the socket's ping offset; never the phone alone
  const vnow = v => Date.now() + (v && typeof v.off === "number" ? v.off : typeof Net !== "undefined" ? Net.clock.offset : 0);
  const SGT = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
  const hhmm = ts => SGT ? SGT.format(new Date(ts)) : new Date(ts).toTimeString().slice(0, 5);
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const live = new Set();   // cards on screen (result + sheet) that tick
  setInterval(() => live.forEach(el => tick(el)), 250);

  // v = { code, title, sub, exp, used, roll: [titles from the server] }; opt = { reveal: true | 0–1 (frozen, mock), hold: 0–1 (frozen), onUse(v) }
  function render(el, v, opt){
    opt = opt || {}; el._v = v; el._opt = opt; el.classList.add("vcard");
    el.innerHTML =
      '<div class="vshine" aria-hidden="true"></div>' +
      '<span class="vtag">🎟 YOUR PRIZE</span>' +
      '<span class="vtitle">' + esc(v.title) + "</span>" +
      '<span class="vsub">' + esc(v.sub) + "</span>" + '<span class="vone">1 per order</span>' +
      '<span class="vclock" aria-live="off">⏱ <b>' + mmss(v.exp - vnow(v)) + "</b></span>" +
      '<span class="vcode">' + esc(v.code) + "</span>" +
      '<button class="vhold" type="button" aria-label="Hold 3 seconds at the counter"><i class="vfill"></i><span class="vlbl">HOLD AT COUNTER</span></button>' +
      '<span class="vmsg" role="alert" hidden></span>' +
      '<span class="vstamp" aria-live="polite"></span><span class="vwhen"></span>';
    bindHold(el);
    tick(el); live.add(el);
    if (opt.reveal) reveal(el, typeof opt.reveal === "number" ? opt.reveal : null);
    if (typeof opt.hold === "number") setFill(el, opt.hold, true);
  }
  function state(v){ return v.used ? "used" : v.expired || vnow(v) >= v.exp ? "expired" : "ready"; }
  function tick(el){
    if (!el.isConnected){ live.delete(el); return; }
    const v = el._v, st = state(v); el.dataset.st = st;
    const b = el.querySelector(".vclock b"); if (b && st === "ready"){ const t = mmss(v.exp - vnow(v)); if (b.textContent !== t) b.textContent = t; }
    const stamp = el.querySelector(".vstamp"), when = el.querySelector(".vwhen");
    if (st === "used"){ stamp.textContent = "USED"; when.textContent = "USED " + hhmm(v.used); }
    else if (st === "expired"){ stamp.textContent = "EXPIRED"; when.textContent = ""; }
  }
  // the reveal: the four prizes roll past, the won one lands and the card flips in (~1 s). p = a frozen moment (mock screenshots)
  function reveal(el, p){
    const title = el.querySelector(".vtitle"), sub = el.querySelector(".vsub"), v = el._v, start = performance.now(), D = 1000;
    if (R && p === null){ return; }
    el.classList.add("revealing");
    const frame = now => {
      const k = p === null ? Math.min(1, (now - start) / D) : p, e = 1 - Math.pow(1 - k, 3);
      el.style.transform = "perspective(700px) rotateX(" + ((1 - e) * 75).toFixed(1) + "deg) scale(" + (0.86 + 0.14 * e).toFixed(3) + ")";
      // a frozen frame (mock) shows another prize rolling past
      const roll = v.roll && v.roll.length ? v.roll : [{ t: v.title, s: v.sub }];   // what the server sent (fake: the four prizes)
      if (k < 0.8){ const i = p === null ? Math.floor(now / 70) % roll.length : Math.floor(k * 12) % roll.length; title.textContent = roll[i].t; sub.textContent = roll[i].s || ""; title.classList.add("rolling"); }
      else { title.textContent = v.title; sub.textContent = v.sub; title.classList.remove("rolling"); }
      if (p === null && k < 1) requestAnimationFrame(frame);
      else if (p === null){ el.style.transform = ""; el.classList.remove("revealing"); if (typeof Sfx !== "undefined") Sfx.play("chime"); }
    };
    requestAnimationFrame(frame);
  }
  // HOLD AT COUNTER: fills while held (~3 s); letting go early or moving the finger (> 15 px, e.g. scrolling) = nothing; full = the
  // server marks it used. Never silent: "Checking…" while it asks; no answer = a red line with the code for staff (their page is the backup)
  function setFill(el, k, pressed){ const f = el.querySelector(".vfill"); if (f) f.style.transform = "scaleX(" + k.toFixed(3) + ")"; el.querySelector(".vhold").classList.toggle("down", !!pressed); }
  function msg(el, text){ const m = el.querySelector(".vmsg"); m.textContent = text || ""; m.hidden = !text; }
  function bindHold(el){
    const btn = el.querySelector(".vhold"); let t0 = 0, raf = 0, x0 = 0, y0 = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; t0 = 0; setFill(el, 0, false); };
    btn.addEventListener("pointermove", e => { if (t0 && Math.hypot(e.clientX - x0, e.clientY - y0) > MOVE_PX) stop(); });
    btn.addEventListener("pointerdown", e => {
      if (state(el._v) !== "ready" || el.dataset.busy) return; e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
      t0 = performance.now(); x0 = e.clientX; y0 = e.clientY; msg(el, "");
      const step = now => { if (!t0) return; const k = Math.min(1, (now - t0) / HOLD_MS); setFill(el, k, true);
        if (k < 1){ raf = requestAnimationFrame(step); return; }
        t0 = 0; use(el); };
      raf = requestAnimationFrame(step);
    });
    ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"].forEach(n => btn.addEventListener(n, () => { if (t0) stop(); }));
    btn.addEventListener("contextmenu", e => e.preventDefault());   // a long press must not open the phone's menu
  }
  async function use(el){
    const v0 = el._v, lbl = el.querySelector(".vlbl"); setFill(el, 1, true); el.dataset.busy = "1"; lbl.textContent = "Checking…";
    let r = null; try { r = el._opt.onUse ? await el._opt.onUse(v0) : { ok: true, used: vnow(v0) }; } catch (e) { r = null; }
    // the card may have been drawn again while we waited (a recheck): the answer goes on the card on screen now (same code), not the old copy
    const v = el._v && el._v.code === v0.code ? el._v : v0, nl = el.querySelector(".vlbl");
    delete el.dataset.busy; if (nl) nl.textContent = "HOLD AT COUNTER"; setFill(el, 0, false);
    if (r && typeof r.now === "number") v.off = r.now - Date.now();
    if (r && r.ok){ v.used = r.used || vnow(v); try { navigator.vibrate && navigator.vibrate([30, 40, 90]); } catch (e) { /* not on iPhone */ } if (typeof Sfx !== "undefined") Sfx.play("coin"); }
    else if (r && r.e === "already") v.used = r.used || vnow(v);           // used before (another tab, staff): USED with the server's time
    else if (r && r.e === "expired") v.expired = true;                    // the server says the 15 minutes are over
    else if (r && (r.e === "no-prize" || r.e === "not-found" || r.status === 404)) msg(el, "Show code " + v.code + " to staff");   // the server doesn't know it as a prize
    else msg(el, "No signal · show code " + v.code + " to staff");        // no answer: staff check / redeem it on their page
    tick(el); live.forEach(x => { if (x !== el && x._v && x._v.code === v.code){ x._v.used = v.used; x._v.expired = v.expired; tick(x); } });   // the other copy (sheet / result)
  }
  return { PRIZES, render, state };
})();
