/* Gotcha Shootout — the rules page (what GRA's trade-promotion class licence says players must be able to read before they play).
   Built from the server's own settings, so the page and the game never disagree; the defaults below show if the server can't be reached. */
"use strict";
const RULES_DEFAULT = {
  windows: [{ opens: "2026-11-13T07:00:00.000Z", closes: "2026-11-13T14:00:00.000Z" }, { opens: "2026-11-14T02:00:00.000Z", closes: "2026-11-14T14:00:00.000Z" },
            { opens: "2026-11-15T02:00:00.000Z", closes: "2026-11-15T10:00:00.000Z" }],
  odds: { goalChance: [0.94, 0.72, 0.44] }, stopBeforeCloseMinutes: 20, prizeMinutes: 15, graceMinutes: 15,
  prizes: { free: { what: "$1 OFF", sub: "any drink, today" }, goals0: { what: "$1 OFF", sub: "your next drink" }, goals1: { what: "$1 OFF", sub: "your next drink" },
    goals2: { what: "FREE SPARKLING YUZU", sub: "with your next matcha" }, goals3: { what: "FREE MATCHA", sub: "with your next drink" }, yuzuOut: { what: "$2 OFF", sub: "your next drink" } }
};
const DAYF = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", year: "numeric" }); } catch (e) { return null; } })();
const HF = (() => { try { return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: true }); } catch (e) { return null; } })();
const toMs = x => typeof x === "number" ? x : Date.parse(x);
const hr = ms => HF ? HF.format(new Date(ms)).replace(":00", "").replace(/[\s\u202f]+/g, "").toLowerCase() : clock(ms);
function renderRules(c){
  const Z = c.prizes, cb = c.odds.cornerBonus != null ? c.odds.cornerBonus : 0.5;
  // lowest = dead centre on the ground; highest = the best on-target corner (corner value ≈ 0.94 once the post and bar bands are taken out)
  const range = g => Math.round(g * (1 - cb / 2) * 10) + "–" + Math.round(Math.min(0.985, g * (1 - cb / 2 + cb * 0.938)) * 10) + " in 10";
  const cap = s => s.toLowerCase().replace(/^./, x => x.toUpperCase());
  const who = esc(CONFIG.company.name) + (CONFIG.company.legal ? " (" + esc(CONFIG.company.legal) + ")" : "");
  $("#rulesDoc").innerHTML =
    '<p class="eyebrow">GOTCHA SHOOTOUT</p><h1>Rules</h1>' +
    (Api.test ? '<p class="staff-stale">TEST SERVER: this page shows the test settings.</p>' : "") +
    '<div class="card"><h2>Who runs it</h2><p>' + who + ", at our booth at the " + esc(CONFIG.where) + ".</p>" +
      "<h2>When</h2><p>" + c.windows.map(w => { const o = toMs(w.opens), e = toMs(w.closes); return (DAYF ? DAYF.format(new Date(o)) : "") + ": " + hr(o) + "–" + hr(e); }).join("<br>") +
      "<br>New games stop " + c.stopBeforeCloseMinutes + " minutes before closing.</p></div>" +
    '<div class="card"><h2>How to play</h2><ul>' +
      "<li>Anyone can play. Pick a nickname. We don't ask for your name, phone number or email.</li>" +
      "<li><b>Free shot:</b> 1 a day on each phone.</li>" +
      "<li><b>Buy a drink:</b> you get a cup card that unlocks 3 shots. One card per paid drink (a trio is 3 drinks). Each card works once, on one phone.</li>" +
    "</ul></div>" +
    '<div class="card"><h2>How shots are decided</h2>' +
      "<p>A shot that misses the goal or hits the post or bar doesn't score. A shot on target has a set chance of beating the keeper: " + range(c.odds.goalChance[0]) + " on shot 1, " + range(c.odds.goalChance[1]) + " on shot 2 and " + range(c.odds.goalChance[2]) + " on shot 3 (the free shot is like shot 1). The middle is hardest, the corners easiest. Our server decides each shot. It's a game of skill and chance.</p></div>" +
    '<div class="card"><h2>Prizes</h2>' +
      '<div class="tbl"><table><thead><tr><th>Your result</th><th>Prize</th></tr></thead><tbody>' +
        "<tr><td>Free shot, goal or miss</td><td>" + esc(Z.free.what + " " + Z.free.sub) + "</td></tr>" +
        "<tr><td>3 shots: 0–1 goals</td><td>" + esc(Z.goals1.what + " " + Z.goals1.sub) + "</td></tr>" +
        "<tr><td>3 shots: 2 goals</td><td>" + esc(cap(Z.goals2.what) + " " + Z.goals2.sub) + "</td></tr>" +
        "<tr><td>3 shots: 3 goals</td><td>" + esc(cap(Z.goals3.what) + " " + Z.goals3.sub) + " + your name in today's Hall of Fame</td></tr>" +
      "</tbody></table></div><ul>" +
        "<li>Use your prize today at the booth, with a new purchase, within " + c.prizeMinutes + " minutes (staff allow " + c.graceMinutes + " more at the counter).</li>" +
        "<li>" + esc(CONFIG.prizeRules) + " Not exchangeable for cash.</li>" +
        "<li>If sparkling yuzu sells out, the 2-goal prize becomes " + esc(Z.yuzuOut.what + " " + Z.yuzuOut.sub) + ".</li>" +
        "<li>Staff mark the prize as used on your phone.</li>" +
      "</ul></div>" +
    '<div class="card"><h2>Names on the big screen</h2><p>Only hat-trick names go on the big screen. Keep it friendly: rude names are blocked, and staff remove any name.</p>' +
      "<h2>Your data</h2><p>We keep your nickname, your shots and a random id your phone makes (no name, number or email) until 30 Nov 2026, then delete them; backups clear within 30 days after that. To stop abuse we count tries per network using a scrambled code of your network address, kept for at most a day. Your phone keeps your open prize and today's free shot, so a reload doesn't lose them.</p>" +
      "<h2>Questions</h2><p>Ask us at the booth. We gotcha.</p></div>" +
    '<p><a href="../">← Back to the game</a></p>';
}
window.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("docpage");
  renderRules(RULES_DEFAULT);
  const r = await Api.post("/config", {}, 6000);
  if (r.ok) renderRules({ windows: r.windows && r.windows.length ? r.windows : RULES_DEFAULT.windows, odds: r.odds || RULES_DEFAULT.odds,
    stopBeforeCloseMinutes: r.stopBeforeCloseMinutes || 20, prizeMinutes: r.prizeMinutes || 15, graceMinutes: r.graceMinutes || 15, prizes: r.prizes || RULES_DEFAULT.prizes });
});
