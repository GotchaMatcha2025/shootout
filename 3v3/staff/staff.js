/* Gotcha Shootout 3v3: the staff phone at the booth. PIN → a day token (this tab only); type the customer's code → the server's answer;
   hold 1.5 s to redeem. Green only on the server's yes. No names anywhere. Contract: scratchpad/3v3/API-3V3.md §4, §9.6, §10. */
"use strict";
var StaffCore = (function () {
  var ALPHA = "ACDEFHJKMNPQRTUVWXY34679";
  var BASES = { live: "https://gotcha-shootout-3v3.long-fog-ae60.workers.dev", staging: "https://gotcha-shootout-3v3-staging.long-fog-ae60.workers.dev",
    local: "http://localhost:8787", fake: "http://fake.invalid" };
  function pickMode(asked, saved, host, proto) {
    if (BASES[asked]) return asked;
    if (BASES[saved]) return saved;
    return proto === "file:" || /^(localhost|127\.0\.0\.1)$/.test(host) ? "staging" : "live";
  }
  // what staff typed → a code: capitals, only the code letters (look-alikes like O 0 I 1 L S 5 B 8 Z 2 G never appear, so they're
  // dropped), 6 of them. A leading "T-" (test server) or "L-" (played offline on the phone) is kept as typed on the customer's screen.
  function clean(raw) {
    var s = String(raw || "").toUpperCase().replace(/[\s.]/g, ""), prefix = "", m, dropped = false;
    while ((m = /^([TL])-/.exec(s))) { prefix += m[1] + "-"; s = s.slice(2); }
    var pend = /^L$/.test(s) ? "L" : "";            // "L" on its own may be the start of "L-": keep it until the next key
    if (pend) s = "";
    var body = "";
    for (var i = 0; i < s.length && body.length < 6; i++) { if (ALPHA.indexOf(s[i]) >= 0) body += s[i]; else dropped = true; }
    return { text: prefix + (pend || body), code: prefix + body, body: body, done: body.length === 6, dropped: dropped, offline: prefix.indexOf("L-") >= 0 };
  }
  var SGT = (function () { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return null; } })();
  function clock(ms) { if (typeof ms !== "number" || !isFinite(ms)) return "?"; if (SGT) return SGT.format(new Date(ms)); var d = new Date(ms + 8 * 3600e3); return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2); }
  function isSolo(md) { return md === 1 || md === "challenge" || md === "solo"; }
  var WORD = { win: "won", lose: "lost", draw: "draw" };
  // "Matcha Bot: won 1–0", "1 v 1: won", "2 v 2: lost"; the score only where goals don't end the match (single player)
  function modeText(r) {
    var w = WORD[r.r] || "?";
    if (isSolo(r.md)) {
      var sc = r.sc, me = r.team === 1 ? 1 : 0;
      return "Matcha Bot: " + w + (sc && sc.length === 2 ? " " + sc[me] + "–" + sc[1 - me] : "");
    }
    if (r.size === 1 || r.size === 2) return r.size + " v " + r.size + ": " + w;
    return (r.md == null ? "" : "Multiplayer: ") + w;
  }
  function prizeLine(p) { return p && p.label ? "Prize: " + p.label : "Prize: not set yet"; }
  // how old the code is, for the 30-minute limit staff see (the server still refuses an old code itself)
  function ago(at, now) {
    if (typeof at !== "number" || typeof now !== "number") return "";
    var m = Math.floor((now - at) / 60000);
    return m < 1 ? " · just now" : m < 60 ? " · " + m + " min ago" : " · over 1 h ago";
  }
  // the check: what this code is and whether it can still be used. tone: ok (green) / bad (red) / warn (amber).
  // L- codes are plan-B games played on the phone while the server was down: never a prize (contract §12.3)
  function checkView(res, code, now) {
    var off = code && code.indexOf("L-") >= 0;
    if (!res || res.net) return { tone: "warn", head: "No answer, try again", retry: true };
    if (res.status === 404) return { tone: "bad", head: "NOT FOUND", lines: ["Check the code with the customer."] };
    if (res.status === 503) return { tone: "warn", head: "Not set up yet", lines: ["Tell Vin or Kai."], retry: true };
    if (!res.ok) return { tone: "warn", head: "No answer, try again", retry: true };
    var head = res.r === "win" ? "WIN" : res.r === "lose" ? "LOSE" : res.r === "draw" ? "DRAW" : "?";
    var lines = [modeText(res), "Played at " + clock(res.at) + ago(res.at, now), prizeLine(off ? null : res.prize)];
    var v = { tone: "info", head: head, lines: lines, offline: off, canRedeem: !res.used && !off };
    if (off) v.status = { tone: "warn", head: "Offline game · no prize" };
    else if (res.used) { v.status = { tone: "bad", head: "ALREADY USED at " + clock(res.used) }; v.canRedeem = false; }
    else v.status = { tone: "info", head: "Not used yet" };
    return v;
  }
  // the redeem: green only when the server said yes. `mine` = this phone's last hold on this code got no answer (a slow yes may have landed)
  function redeemView(res, ctx) {
    ctx = ctx || {};
    if (!res || res.net) return { tone: "warn", head: "No answer, try again", lines: ["Don't give the prize yet."] };
    if (res.ok) return { tone: "ok", head: "✓ Redeemed", lines: [ctx.prize && ctx.prize.label ? "Give: " + ctx.prize.label : "Give the prize", "Used at " + clock(res.used)] };
    if (res.status === 409 && res.e === "expired") return { tone: "bad", head: "TOO OLD (over 30 min)", lines: ["Played at " + clock(res.at != null ? res.at : ctx.at), "No prize."] };
    if (res.status === 409) {
      var lines = ["No prize."];
      if (ctx.mine && typeof res.used === "number" && res.used >= ctx.mine - 5000) lines = ["Your last hold got no answer, but went through. Give the prize once if you haven't."];
      return { tone: "bad", head: "ALREADY USED at " + clock(res.used), lines: lines };
    }
    if (res.status === 404) return { tone: "bad", head: "NOT FOUND", lines: ["Check the code with the customer."] };
    if (res.status === 503) return { tone: "warn", head: "Not set up yet", lines: ["Tell Vin or Kai."] };
    return { tone: "warn", head: "No answer, try again", lines: ["Don't give the prize yet."] };
  }
  function loginError(res) {
    if (!res || res.net) return "No signal. Try again.";
    if (res.status === 429) return "Too many tries. Wait a few minutes.";
    if (res.status === 503) return "Not set up yet. Tell Vin or Kai.";
    return "Wrong PIN. Try again.";
  }
  function n(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
  // today's counts, whatever the server's names (counts may sit under `counts`)
  function tiles(r) {
    var c = r && (r.counts || r.today) || r || {};
    return [["Matches", n(c.matches)], ["Plays", n(c.humans != null ? c.humans : c.plays)], ["Won", n(c.wins)], ["Lost", n(c.losses)], ["Draws", n(c.draws)],
      ["Codes used", n(c.used != null ? c.used : c.codesUsed)]];
  }
  return { ALPHA: ALPHA, BASES: BASES, pickMode: pickMode, clean: clean, clock: clock, ago: ago, modeText: modeText, checkView: checkView, redeemView: redeemView,
    loginError: loginError, tiles: tiles };
})();
if (typeof module === "object" && module.exports) module.exports = StaffCore;

if (typeof window !== "undefined" && window.document) (function () {
  var SC = StaffCore, $ = function (s) { return document.querySelector(s); };
  var qs = location.search, asked = (qs.match(/[?&]api=([a-z]+)/) || [])[1], saved = null;
  try { saved = sessionStorage.getItem("s3v3:api"); } catch (e) { saved = null; }
  var mode = SC.pickMode(asked, saved, location.hostname, location.protocol), base = SC.BASES[mode];
  try { if (asked && SC.BASES[asked]) sessionStorage.setItem("s3v3:api", asked); } catch (e) { /* no session storage */ }
  var KEY = "s3v3:" + (mode === "live" ? "" : mode === "staging" ? "stg:" : mode + ":") + "staff";
  if (mode === "fake") { var fs = document.createElement("script"); fs.src = "fake.js?v=1"; document.head.appendChild(fs); }

  // one server call: {status, ...json} or {net:true} after `ms` (no answer = never green)
  function post(path, body, ms) {
    if (mode === "fake") {
      return new Promise(function (ok) { (function wait(n) { if (window.FakeApi) ok(window.FakeApi(path, body, ms)); else if (n > 40) ok({ net: true }); else setTimeout(function () { wait(n + 1); }, 50); })(0); });
    }
    var ctl = window.AbortController ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 8000);
    return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), cache: "no-store",
      credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j && typeof j === "object" ? j : {}; j.status = r.status; return j; }); })
      .catch(function () { return { net: true }; })
      .then(function (x) { clearTimeout(t); return x; });
  }
  var token = null, pin = "", busy = false, cur = null, lastNoAnswer = null, stateT = 0;
  try { token = sessionStorage.getItem(KEY); } catch (e) { token = null; }
  function store(t) { token = t; try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) { /* this tab only */ } }
  function out(path, body, ms) {   // a call with the token; a refused token sends staff back to the PIN
    body = body || {}; body.token = token;
    return post(path, body, ms).then(function (r) { if (r.status === 401 || r.status === 403) { logout("Type the PIN again."); r.loggedOut = true; } return r; });
  }

  /* ---------- PIN ---------- */
  function dots() { var d = document.querySelectorAll("#dots i"); for (var i = 0; i < d.length; i++) d[i].className = i < pin.length ? "f" : ""; }
  function key(k) {
    if (busy) return;
    if (k === "⌫") pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
    dots(); $("#pinErr").hidden = true;
    if (pin.length < 6) return;
    busy = true;
    post("/staff/login", { pin: pin }, 8000).then(function (r) {
      busy = false; pin = ""; setTimeout(dots, 200);
      if (r.ok && r.token) { store(r.token); showMain(); return; }
      $("#pinErr").hidden = false; $("#pinErr").textContent = SC.loginError(r);
    });
  }
  function logout(why) {
    store(null); $("#main").hidden = true; $("#login").hidden = false;
    $("#pinErr").hidden = !why; $("#pinErr").textContent = why || "";
  }
  function showMain() { $("#login").hidden = true; $("#main").hidden = false; reset(); state(); }

  /* ---------- code → check → hold → redeem ---------- */
  function reset() {
    cur = null; $("#code").value = ""; $("#drop").hidden = true; paint(null, null);
    try { $("#code").focus(); } catch (e) { /* no focus */ }
  }
  function onType() {
    var c = SC.clean($("#code").value);
    if ($("#code").value !== c.text) $("#code").value = c.text;
    $("#drop").hidden = !c.dropped;
    $("#count").textContent = c.body.length + " of 6";
    if (c.done && (!cur || cur.code !== c.code)) check(c.code);
    if (!c.done && cur) { cur = null; paint(null, null); }
  }
  function check(code) {
    cur = { code: code, view: null }; paint({ tone: "info", head: "Checking…" }, null);
    var mine = cur;
    out("/staff/check", { code: code }, 5000).then(function (r) {
      if (cur !== mine || r.loggedOut) return;
      mine.res = r; mine.view = SC.checkView(r, code, Date.now()); paint(mine.view, mine.view.status || null);
    });
  }
  function paint(v, status) {
    var card = $("#card"), st = $("#status"), hold = $("#hold");
    card.hidden = !v; st.hidden = !status; hold.hidden = !(v && v.canRedeem); $("#next").hidden = !v; $("#retry").hidden = !(v && v.retry);
    if (v) {
      card.className = "card " + v.tone;
      $("#head").textContent = v.head;
      $("#lines").innerHTML = "";
      (v.lines || []).forEach(function (l) { var p = document.createElement("p"); p.textContent = l; $("#lines").appendChild(p); });
    }
    if (status) {
      st.className = "status " + status.tone; $("#sHead").textContent = status.head;
      $("#sLines").innerHTML = ""; (status.lines || []).forEach(function (l) { var p = document.createElement("p"); p.textContent = l; $("#sLines").appendChild(p); });
    }
    hold.className = "hold"; hold.disabled = false; $("#holdT").textContent = "Hold 1.5 s to redeem";
  }
  function redeem() {
    if (!cur || !cur.view || !cur.view.canRedeem) return;
    var mine = cur, hold = $("#hold"), code = cur.code, ctx = { prize: cur.res.prize, at: cur.res.at, mine: lastNoAnswer && lastNoAnswer.code === code ? lastNoAnswer.at : 0 };
    hold.disabled = true; $("#holdT").textContent = "Checking…";
    var sent = Date.now();
    out("/staff/redeem", { code: code }, 5000).then(function (r) {
      if (r.loggedOut) return;
      if (r.net) lastNoAnswer = { code: code, at: sent };
      var v = SC.redeemView(r, ctx);
      if (cur !== mine) return;
      // after any answer the hold goes away; a "No answer" keeps it so staff can try again
      mine.view.canRedeem = v.tone === "warn";
      paint(mine.view, v);
      if (r.ok || r.status === 409) state();
    });
  }
  // hold-to-redeem: 1.5 s of pressure, released early = nothing happens
  function holdButton() {
    var b = $("#hold"), t = 0;
    function start(e) { if (b.disabled) return; if (e && e.preventDefault) e.preventDefault(); b.className = "hold on"; $("#holdT").textContent = "Keep holding…"; clearTimeout(t); t = setTimeout(function () { b.className = "hold done"; redeem(); }, 1500); }
    function stop() { if (b.className === "hold on") { clearTimeout(t); b.className = "hold"; $("#holdT").textContent = "Hold 1.5 s to redeem"; } }
    if (window.PointerEvent) { b.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach(function (e) { b.addEventListener(e, stop); }); }
    else { b.addEventListener("touchstart", start); b.addEventListener("touchend", stop); b.addEventListener("mousedown", start); b.addEventListener("mouseup", stop); b.addEventListener("mouseleave", stop); }
    b.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
    b.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") stop(); });
    b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  /* ---------- today's counts ---------- */
  function state() {
    clearTimeout(stateT);
    if (!token) return;
    out("/staff/state", {}, 8000).then(function (r) {
      if (r.loggedOut) return;
      if (r.ok) {
        $("#tiles").innerHTML = "";
        SC.tiles(r).forEach(function (t) { var d = document.createElement("div"); d.className = "tile"; d.innerHTML = "<b></b><span></span>"; d.firstChild.textContent = t[1]; d.lastChild.textContent = t[0]; $("#tiles").appendChild(d); });
        $("#stale").hidden = true; $("#updated").textContent = "Updated " + SC.clock(Date.now());
      } else $("#stale").hidden = false;
      stateT = setTimeout(state, 15000);
    });
  }

  window.addEventListener("DOMContentLoaded", function () {
    if (mode !== "live") { $("#test").hidden = false; $("#test").textContent = mode === "fake" ? "FAKE ANSWERS · nothing is real" : "TEST SERVER · nothing is real"; }
    var pad = $("#pad");
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = k;
      if (!k) { b.disabled = true; b.style.visibility = "hidden"; }
      b.setAttribute("aria-label", k === "⌫" ? "Delete" : k); b.onclick = function () { key(k); }; pad.appendChild(b);
    });
    document.addEventListener("keydown", function (e) { if (!$("#login").hidden && /^[0-9]$/.test(e.key)) key(e.key); else if (!$("#login").hidden && e.key === "Backspace") key("⌫"); });
    $("#code").addEventListener("input", onType);
    $("#next").onclick = reset;
    $("#retry").onclick = function () { if (cur) check(cur.code); };
    $("#logout").onclick = function () { logout(""); };
    holdButton();
    document.addEventListener("visibilitychange", function () { if (!document.hidden && token) state(); });
    if (token) showMain();
  });
})();
