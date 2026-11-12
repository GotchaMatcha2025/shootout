/* Gotcha Shootout: the staff phone at the booth. PIN → a day token (kept on this phone until 04:00 SGT); type the customer's code → the
   server's answer; hold 1.5 s to redeem. Green only on the server's yes. Booth controls: Pause / Restart, bot Easier / Normal / Harder.
   No names anywhere. Contract: scratchpad/3v3/API-3V3.md §4, §9.6, §10; review fixes 12 Nov (#5, #6, #13). */
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
    // multiplayer is first to 3 (owner 12 Nov ~22:54): the final score, this player's team first (from `team`, else from the result)
    var fs = "";
    if (r.sc && r.sc.length === 2) {
      var a = r.sc[0], b = r.sc[1], mine = r.team === 0 || r.team === 1 ? r.team : r.r === "win" ? (a >= b ? 0 : 1) : r.r === "lose" ? (a <= b ? 0 : 1) : 0;
      fs = " " + r.sc[mine] + "–" + r.sc[1 - mine];
    }
    if (r.size === 1 || r.size === 2) return r.size + " v " + r.size + ": " + w + fs;
    return (r.md == null ? "" : "Multiplayer: ") + w + fs;
  }
  // why a code has no prize (the server's `why`): known codes in shop words, anything else shown as sent (short)
  var WHY = { cap: "used today", day: "used today", dev: "used today", phone: "used today", net: "used today", "used-today": "used today",
    hours: "outside booth hours", lost: "lost game", lose: "lost game", draw: "draw", local: "offline game", offline: "offline game", unset: "not set yet", none: "not set yet" };
  function whyText(why) { return why == null || why === "" ? "" : WHY[why] || String(why).slice(0, 40); }
  // the prize title (§15: prize {t, s}; an older server sends {label})
  function prizeTitle(p) { return p ? p.t || p.label || "" : ""; }
  function prizeLine(p, why) {
    if (prizeTitle(p)) return "Prize: " + prizeTitle(p);
    return why ? "No prize · " + whyText(why) : "Prize: not set yet";
  }
  // how old the code is, for the 15-minute limit staff see (the server still refuses an old code itself)
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
    off = off || res.local === 1 || res.local === true;
    var prize = off ? null : res.prize, has = !!prizeTitle(prize);
    var lines = [modeText(res), "Played at " + clock(res.at) + ago(res.at, now), prizeLine(prize, off ? null : res.why)];
    if (has && !res.used && typeof res.exp === "number") lines.push("Valid until " + clock(res.exp));
    // the hold shows only when the server says this code carries a prize and isn't used (a no-prize code would only be refused)
    var v = { tone: "info", head: head, lines: lines, offline: off, canRedeem: has && !res.used && !off };
    if (off) v.status = { tone: "warn", head: "Offline game · no prize" };
    else if (res.used) v.status = { tone: "bad", head: "USED " + clock(res.used) + (res.used_by === "self" ? " (player)" : res.used_by === "staff" ? " (staff)" : "") };   // who: the player's HOLD TO USE, or staff here
    else if (!has) v.status = { tone: "warn", head: "No prize" };
    else v.status = { tone: "info", head: "Not used yet" };
    return v;
  }
  // the redeem: green only when the server said yes. `mine` = this phone's last hold on this code got no answer (a slow yes may have landed)
  function redeemView(res, ctx) {
    ctx = ctx || {};
    if (!res || res.net) return { tone: "warn", head: "No answer, try again", lines: ["Don't give the prize yet."] };
    if (res.ok) return { tone: "ok", head: "✓ Redeemed", lines: [prizeTitle(ctx.prize) ? "Give: " + prizeTitle(ctx.prize) : "Give the prize", "Used at " + clock(res.used)] };
    if (res.status === 409 && res.e === "expired") return { tone: "bad", head: "TOO OLD (over 15 min)", lines: ["Played at " + clock(res.at != null ? res.at : ctx.at), "No prize."] };
    if (res.status === 409 && res.e === "no-prize") return { tone: "bad", head: "NO PRIZE", lines: [whyText(res.why || ctx.why) || "This code has no prize."] };
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
  // the token ends at 04:00 SGT (server rule); the phone forgets it then too, so the page opens on the PIN, not on a refused call
  function expiry(now) {
    var sg = now + 8 * 3600e3, d = new Date(sg), four = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4) - 8 * 3600e3;
    return four > now ? four : four + 24 * 3600e3;
  }
  // booth controls (review #5): the server's current values only; nothing is assumed before it answers
  var LEVELS = [[0.8, "Easier"], [1, "Normal"], [1.2, "Harder"]];
  function boothView(r) {
    var c = r && r.settings ? r.settings : r || {};
    var paused = typeof c.paused === "boolean" ? c.paused : c.paused === 1 ? true : c.paused === 0 ? false : null;
    var lvl = typeof c.botLevel === "number" ? c.botLevel : null, name = null;
    LEVELS.forEach(function (L) { if (lvl !== null && Math.abs(L[0] - lvl) < 0.001) name = L[1]; });
    return { paused: paused, level: lvl, levelName: name,
      status: paused === null ? "Game: ?" : paused ? "Game: PAUSED" : "Game: ON",
      hold: paused === null ? "" : paused ? "Hold to restart the game" : "Hold to pause the game",
      bot: lvl === null ? "Bot: ?" : "Bot: " + (name || lvl) };
  }
  return { ALPHA: ALPHA, BASES: BASES, pickMode: pickMode, clean: clean, clock: clock, ago: ago, whyText: whyText, modeText: modeText, checkView: checkView,
    redeemView: redeemView, loginError: loginError, tiles: tiles, expiry: expiry, LEVELS: LEVELS, boothView: boothView };
})();
if (typeof module === "object" && module.exports) module.exports = StaffCore;

if (typeof window !== "undefined" && window.document) (function () {
  var SC = StaffCore, $ = function (s) { return document.querySelector(s); };
  var qs = location.search, asked = (qs.match(/[?&]api=([a-z]+)/) || [])[1], saved = null;
  try { saved = sessionStorage.getItem("s3v3:api"); } catch (e) { saved = null; }
  var mode = SC.pickMode(asked, saved, location.hostname, location.protocol), base = SC.BASES[mode];
  try { if (asked && SC.BASES[asked]) sessionStorage.setItem("s3v3:api", asked); } catch (e) { /* no session storage */ }
  var KEY = "s3v3:" + (mode === "live" ? "" : mode === "staging" ? "stg:" : mode + ":") + "staff";
  if (mode === "fake") { var fs = document.createElement("script"); fs.src = "fake.js?v=4"; document.head.appendChild(fs); }

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
  // the token lives on this phone until 04:00 SGT (review #13: a closed tab or a reload no longer needs the PIN again mid-shift)
  try { var kept = JSON.parse(localStorage.getItem(KEY) || "null"); if (kept && kept.t && kept.until > Date.now()) token = kept.t; else localStorage.removeItem(KEY); } catch (e) { token = null; }
  function store(t) { token = t; try { if (t) localStorage.setItem(KEY, JSON.stringify({ t: t, until: SC.expiry(Date.now()) })); else localStorage.removeItem(KEY); } catch (e) { /* memory only */ } }
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
    var mine = cur, hold = $("#hold"), code = cur.code, ctx = { prize: cur.res.prize, at: cur.res.at, why: cur.res.why, mine: lastNoAnswer && lastNoAnswer.code === code ? lastNoAnswer.at : 0 };
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
  // hold-to-confirm (redeem, pause / restart): 1.5 s of pressure, released early = nothing happens
  function makeHold(b, txt, idle, done) {
    var t = 0;
    function start(e) { if (b.disabled || b.hidden) return; if (e && e.preventDefault) e.preventDefault(); b.className = "hold on"; txt.textContent = "Keep holding…"; clearTimeout(t); t = setTimeout(function () { b.className = "hold done"; done(); }, 1500); }
    function stop() { if (b.className === "hold on") { clearTimeout(t); b.className = "hold"; txt.textContent = idle(); } }
    if (window.PointerEvent) { b.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach(function (e) { b.addEventListener(e, stop); }); }
    else { b.addEventListener("touchstart", start); b.addEventListener("touchend", stop); b.addEventListener("mousedown", start); b.addEventListener("mouseup", stop); b.addEventListener("mouseleave", stop); }
    b.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
    b.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") stop(); });
    b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  /* ---------- booth controls: Pause / Restart (hold), bot Easier / Normal / Harder; the server's values only ---------- */
  var booth = SC.boothView(null);
  function paintBooth(bv) {
    booth = bv;
    var st = $("#bStat"); st.textContent = bv.status; st.className = "bstat" + (bv.paused === null ? "" : bv.paused ? " warn" : " ok");
    var pb = $("#pause"); pb.hidden = bv.paused === null; pb.className = "hold"; pb.disabled = false; $("#pauseT").textContent = bv.hold;
    $("#bBot").textContent = bv.bot;
    var bs = document.querySelectorAll("#levels button");
    for (var i = 0; i < bs.length; i++) { var on = bv.level !== null && Math.abs(Number(bs[i].getAttribute("data-l")) - bv.level) < 0.001; bs[i].setAttribute("aria-pressed", on ? "true" : "false"); bs[i].disabled = false; }
  }
  function setting(body, what) {
    var e = $("#bErr"); e.hidden = true;
    what.textContent = "Saving…";
    return out("/staff/settings", body, 6000).then(function (r) {
      if (r.loggedOut) return;
      if (!r.ok) { e.hidden = false; e.textContent = r.net ? "No answer, try again" : r.status === 404 ? "Not on the server yet" : "Didn't save, try again"; }
      state();   // repaint from what the server now says, saved or not
    });
  }
  function boothControls() {
    makeHold($("#pause"), $("#pauseT"), function () { return booth.hold; }, function () {
      if (booth.paused === null) return;
      $("#pause").disabled = true; setting({ paused: !booth.paused }, $("#pauseT"));
    });
    var bs = document.querySelectorAll("#levels button");
    for (var i = 0; i < bs.length; i++) bs[i].onclick = function () {
      var l = Number(this.getAttribute("data-l"));
      if (booth.level !== null && Math.abs(l - booth.level) < 0.001) return;
      var all = document.querySelectorAll("#levels button"); for (var j = 0; j < all.length; j++) all[j].disabled = true;
      setting({ botLevel: l }, $("#bBot"));
    };
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
        paintBooth(SC.boothView(r));
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
    makeHold($("#hold"), $("#holdT"), function () { return "Hold 1.5 s to redeem"; }, redeem);
    boothControls();
    document.addEventListener("visibilitychange", function () { if (!document.hidden && token) state(); });
    if (token) showMain();
  });
})();
