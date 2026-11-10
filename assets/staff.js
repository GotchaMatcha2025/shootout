/* Gotcha Shootout — the staff phone page. The PIN is checked by the server (wrong tries slowed down); the page keeps a day token. */
"use strict";
const STAFF_KEY = NS + "staff";
const Staff = {
  pin: "", token: null, s: null, msg: "", msgOk: false, lastCode: "", codeDraft: "", sig: "", busy: false,
  init(){
    document.body.classList.add("staffpage");
    if (Api.test) $("#testNote").hidden = false;
    const pad = $("#pad");
    ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach(k => {
      const b = document.createElement("button"); b.textContent = k; if (!k){ b.disabled = true; b.style.visibility = "hidden"; }
      b.onclick = () => this.key(k); b.setAttribute("aria-label", k === "⌫" ? "Delete" : k); pad.appendChild(b);
    });
    Api.post("/config", {}, 6000).then(r => { if (r.ok){ this.cfg = r; if (this.s) this.render(); } });
    const saved = Store.get(STAFF_KEY);
    if (saved && saved.token && saved.day === new Date(Api.now() + 8 * 3600e3).toISOString().slice(0, 10)){ this.token = saved.token; this.showMain(); }
    setInterval(() => { if (this.token && !document.hidden) this.refresh(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && this.token) this.refresh(); });
  },
  dots(){ $$("#pinDots i").forEach((d, i) => d.classList.toggle("f", i < this.pin.length)); },
  async key(k){
    if (this.busy) return;
    if (k === "⌫") this.pin = this.pin.slice(0, -1); else if (this.pin.length < 6) this.pin += k;
    this.dots(); $("#pinErr").hidden = true;
    if (this.pin.length < 6) return;
    this.busy = true;
    const r = await Api.post("/staff/login", { pin: this.pin }, 8000);
    this.busy = false; this.pin = ""; setTimeout(() => this.dots(), 200);
    if (r.ok && r.token){ this.token = r.token; Store.set(STAFF_KEY, { token: r.token, day: r.token.split(".")[0] }); this.showMain(); return; }
    $("#pinErr").hidden = false;
    $("#pinErr").textContent = r.code === "bad-pin" ? "Wrong PIN. Try again." : r.code === "busy" ? "Too many wrong PINs. Try again after the hour, or use a phone that's already logged in." : (r.message || "No signal. Try again.");
  },
  showMain(){ $("#staffPin").hidden = true; $("#staffMain").hidden = false; this.refresh(); },
  logout(why){
    this.token = null; Store.del(STAFF_KEY); this.s = null;
    $("#staffMain").hidden = true; $("#staffPin").hidden = false; $("#pinErr").hidden = !why; $("#pinErr").textContent = why || "";
  },
  async call(path, body){
    const r = await Api.post(path, Object.assign({ token: this.token }, body || {}), 8000);
    if (!r.ok && r.code === "login"){ this.logout("Please type the PIN again."); }
    return r;
  },
  async refresh(){
    const r = await this.call("/staff/state");
    if (!r.ok){ if (r.code !== "login"){ this.stale = true; this.paintStale(); } return; }
    this.stale = false; this.s = r;
    // redraw the whole page only when the names or switches change, so a Hide tap never lands on a moved row
    const sig = JSON.stringify([r.names, r.switches, r.status]);
    if (sig !== this.sig || !$("#staffTiles")) this.render(); else { $("#staffTiles").innerHTML = this.tiles(r.tiles); $("#staffTally").innerHTML = this.tally(r); this.paintStale(); }
  },
  paintStale(){ const el = $("#staleNote"); if (el) el.hidden = !this.stale; },
  tiles(t){
    t = t || {};
    return '<div class="tile key"><b>' + (t.usedFree || 0) + " of " + (t.givenFree || 0) + "</b><span>free-shot $1-offs used (" + pct(t.usedFree, t.givenFree) + "% of " + (t.givenFree || 0) + "): new people who bought a drink</span></div>" +
      '<div class="tile key"><b>' + (t.usedCup || 0) + " of " + (t.givenCup || 0) + "</b><span>cup-card prizes used (" + pct(t.usedCup, t.givenCup) + "% of " + (t.givenCup || 0) + "): buyers who came back</span></div>" +
      '<div class="tile"><b>' + (t.shots || 0) + "</b><span>shots</span></div>" +
      '<div class="tile"><b>' + (t.goals || 0) + "</b><span>goals: " + pct(t.goals, t.shots) + "% of " + (t.shots || 0) + " shots</span></div>" +
      '<div class="tile"><b>' + (t.rounds || 0) + "</b><span>cup-card rounds (3 shots)</span></div>" +
      '<div class="tile"><b>' + (t.hatTricks || 0) + "</b><span>hat tricks: " + pct(t.hatTricks, t.rounds) + "% of " + (t.rounds || 0) + " rounds</span></div>";
  },
  // for the till at closing: today's used prizes by prize (most used first), staff-made cards, undos
  tally(s){
    const used = Object.entries(s.used || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return '<p class="sub">Most used first. Match these with the till at closing.</p>' +
      (used.length ? '<div class="namelist">' + used.map(([k, n]) => '<div class="namerow"><span>' + esc(k) + "</span><b>" + n + "</b></div>").join("") + "</div>" : '<p class="sub">No prizes used yet today.</p>') +
      '<p class="sub">Staff-made cup codes today: <b>' + (s.staffCups || 0) + "</b> · Undos today: <b>" + (s.undos || 0) + "</b></p>";
  },
  render(){
    const s = this.s; if (!s) return;
    const el = $("#staffMain"), sw = s.switches || {}, names = s.names || [];
    this.sig = JSON.stringify([s.names, s.switches, s.status]);
    const hadFocus = !!(document.activeElement && document.activeElement.id === "rCode");
    const keep = hadFocus ? $("#rCode").value : this.codeDraft;
    const yz = this.cfg && this.cfg.prizes && this.cfg.prizes.yuzuOut, alt = yz ? yz.what + " " + yz.sub : "$2 OFF your next drink";
    el.innerHTML =
      '<div class="staff-top"><h2>Staff</h2><img src="../assets/img/cat-chawan-cream.webp" alt="" width="64" height="46"></div>' +
      '<p class="staff-stale" id="staleNote" hidden>No signal: these numbers may be old. Prizes on customers\' phones still work.</p>' +
      (s.status && s.status !== "open" ? '<p class="staff-stale">Game status: ' + esc(s.status) + (sw.paused ? " (paused here)" : "") + "</p>" : "") +
      '<div class="sec"><h2>Redeem a prize</h2><p class="sub"><b>Hold first.</b> You hold their phone; it must turn green ✓ right then. Already grey or red before you hold = no discount. Type the code here only when their phone died or froze.</p>' +
        '<div class="row"><input class="input" id="rCode" maxlength="4" placeholder="4 letters" aria-label="Prize code" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" id="rGo" style="flex:0 0 auto;min-height:56px">Redeem</button></div>' +
        (this.msg ? '<p class="' + (this.msgOk ? "okmsg" : "err") + '">' + this.msg + "</p>" : "") +
        '<div class="row" style="flex-wrap:wrap"><input class="input" id="uCode" maxlength="4" placeholder="Undo code" aria-label="Code to undo" autocomplete="off" autocapitalize="characters" spellcheck="false" style="min-height:44px;font-size:17px"><button class="smallbtn" id="uGo" style="flex:0 0 auto">Undo a redeem</button></div>' +
        (this.lastCode ? '<button class="smallbtn" id="rUndo">Undo ' + esc(this.lastCode) + " (pressed by mistake)</button>" : "") + "</div>" +
      '<div class="sec"><h2>Today</h2><div class="tiles" id="staffTiles">' + this.tiles(s.tiles) + "</div></div>" +
      '<div class="sec"><h2>Prizes used today</h2><div id="staffTally">' + this.tally(s) + "</div></div>" +
      '<div class="sec"><h2>Names</h2><p class="sub">On the wall first (newest first), then the newest players. Tap Hide and the name leaves the wall within 2 seconds.</p>' +
        '<button class="btn ' + (sw.namesOff ? "cream" : "ghost") + '" id="namesOff">' + (sw.namesOff ? "Put names back on the wall" : "Take all names off the wall") + "</button>" +
        '<div class="namelist">' +
        (names.length ? names.map(r => '<div class="namerow' + (r.hidden ? " hid" : "") + '"><span>' + esc(r.name) + "<small>" + clock(r.at) + "</small>" + (r.wall ? '<em class="onwall">ON WALL</em>' : "") + "</span>" +
          '<button class="smallbtn' + (r.hidden ? "" : " warn") + '" data-name="' + esc(r.name) + '" data-hide="' + (r.hidden ? "0" : "1") + '">' + (r.hidden ? "Show again" : "Hide") + "</button></div>").join("") : '<p class="sub">No players yet today.</p>') +
      "</div></div>" +
      '<div class="sec"><h2>Out of cup cards?</h2><p class="sub">Makes one code. The customer scans it from this phone. One card per paid drink.</p><button class="btn ghost" id="newCup">New cup code</button><div id="newCupOut"></div></div>' +
      '<div class="sec"><h2>Something wrong?</h2>' +
        '<button class="btn ' + (sw.yuzuOut ? "cream" : "ghost") + '" id="yuzuBtn">' + (sw.yuzuOut ? "Yuzu is back in stock" : "Yuzu sold out") + "</button>" +
        '<p class="sub">' + (sw.yuzuOut ? "On: the 2-goal prize is now " + esc(alt) + ". Someone shows an older yuzu prize: give " + esc(alt) + " instead." : "Turns the 2-goal prize into " + esc(alt) + ".") + "</p>" +
        '<button class="btn ' + (sw.paused ? "cream" : "ghost") + '" id="pauseBtn">' + (sw.paused ? "Restart the game" : "Pause the game") + "</button>" +
        '<p class="sub">' + (sw.paused ? "Paused: the game page says \"short break\". Prizes already given still work." : "Pausing stops new rounds. Prizes already given still work.") + " Keep selling, then WhatsApp Vin or Kai.</p></div>" +
      '<div class="sec"><h3>What staff do</h3><ul class="sub" style="padding-left:18px;display:flex;flex-direction:column;gap:6px">' +
        "<li><b>Each paid drink:</b> hand over one cup card with it. Prize drinks get no card.</li>" +
        "<li><b>Someone shows a prize:</b> hold \"Staff: hold to redeem\" on their phone, then wait for ✓ confirmed (no tick after 10 seconds: type their code above). One prize per order.</li>" +
        "<li><b>A rude name on the wall:</b> tap Hide, or take all names off.</li>" +
        "<li><b>Last 20 minutes:</b> no new games (Fri/Sat after 9:40pm, Sun after 5:40pm). Fri/Sat cup cards still work the next day; on Sunday after 5:40pm give no card.</li>" +
        "<li><b>\"Card in use on another phone\":</b> a new card only for the buyer whose phone died, never for a friend.</li>" +
        "<li><b>A prize card with TEST on it</b> is not real: no discount.</li>" +
        "<li><b>Before opening:</b> log in on the booth phones and stay logged in all day.</li>" +
        "<li><b>Closing:</b> match \"Prizes used today\" with the till (old yuzu prizes swapped for $2 off still count under yuzu).</li>" +
        "<li><b>Wall screen:</b> open …/shootout/wall/ on the projector, press Sound on and Full screen.</li></ul>" +
        '<button class="smallbtn" id="logout" style="align-self:flex-start">Log out</button></div>';
    const rc = $("#rCode"); rc.value = keep || ""; if (hadFocus) rc.focus();
    rc.addEventListener("input", () => { this.codeDraft = rc.value; });
    rc.addEventListener("keydown", e => { if (e.key === "Enter") this.redeem(); });
    $("#rGo").onclick = () => this.redeem();
    $("#uGo").onclick = () => this.undo($("#uCode").value);
    if ($("#rUndo")) $("#rUndo").onclick = () => this.undo(this.lastCode);
    $$(".namerow button", el).forEach(b => b.onclick = async () => { b.disabled = true; await this.call("/staff/hide", { name: b.dataset.name, hidden: b.dataset.hide === "1" }); this.refresh(); });
    $("#namesOff").onclick = () => this.flip("namesOff", !sw.namesOff);
    $("#yuzuBtn").onclick = () => this.flip("yuzuOut", !sw.yuzuOut);
    $("#pauseBtn").onclick = () => this.flip("paused", !sw.paused);
    $("#newCup").onclick = async () => {
      const r = await this.call("/staff/newcup");
      $("#newCupOut").innerHTML = r.ok ? '<div style="display:flex;gap:14px;align-items:center;margin-top:8px"><div class="qrsmall">' + qrFor(CONFIG.address + "?c=" + r.code) + '</div><div><div style="font:900 30px var(--font);letter-spacing:.1em">' + esc(r.code) + '</div><p class="sub">Works once.</p></div></div>' : '<p class="err">' + esc(r.message || "No signal. Try again.") + "</p>";
    };
    $("#logout").onclick = () => this.logout("");
    this.paintStale();
  },
  async flip(key, on){ const r = await this.call("/staff/switch", { key, on }); if (!r.ok && r.code !== "login"){ this.msg = esc(r.message || "No signal. Try again."); this.msgOk = false; } this.refresh(); },
  async redeem(){
    const code = ($("#rCode").value || "").trim().toUpperCase();
    if (code.length !== 4){ this.msg = "Prize codes have 4 letters."; this.msgOk = false; this.render(); return; }
    const r = await this.call("/staff/redeem", { code });
    if (r.code === "login") return;
    this.codeDraft = ""; this.msgOk = !!r.ok; this.lastCode = r.ok ? code : "";
    const p = r.prize || {};
    this.msg = r.ok ? "✓ " + esc(code) + " redeemed: " + esc(p.what) + " (" + esc(p.sub) + ")" + (r.late ? ". It was in the 15-minute grace." : "")
      : r.code === "already" ? (r.hold && Api.now() - r.redeemedAt < 60000 ? esc(code) + " was used by their phone at " + clock(r.redeemedAt) + ", under a minute ago. If that was the hold you just did, give the discount once." : esc(code) + " was already used at " + clock(r.redeemedAt) + ". No discount.")
      : r.code === "expired" ? esc(code) + " ran out at " + clock(r.expiresAt) + ", and the grace time is over."
      : r.code === "not-found" ? "No prize with the code " + esc(code) + "." : esc(r.message || "No signal. Try again.");
    this.render(); this.refresh();
  },
  async undo(code){
    code = String(code || "").trim().toUpperCase();
    if (code.length !== 4){ this.msg = "Type the 4-letter code to undo."; this.msgOk = false; this.render(); return; }
    const r = await this.call("/staff/unredeem", { code });
    if (r.code === "login") return;
    this.msg = r.ok ? esc(code) + " is open again." : esc(r.message || "Couldn't undo " + code + "."); this.msgOk = !!r.ok;
    if (r.ok && this.lastCode === code) this.lastCode = "";
    this.render(); this.refresh();
  }
};
window.addEventListener("DOMContentLoaded", () => Staff.init());
