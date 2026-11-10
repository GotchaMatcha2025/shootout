/* Gotcha Shootout — the phone game. Shots are judged on the phone with the server's draws and odds (no waiting per shot); the result is
   sent once at the end and resent quietly until it lands; the server re-judges and issues the prize. The round and the prize live in the
   phone's storage, so a reload, the camera or a pull-down brings them back. */
"use strict";
const OUT_TEXT = { goal: "goal!", save: "saved!", post: "off the post!", bar: "off the bar!", wide: "wide", over: "over the bar" };
const STATUS_TEXT = {
  paused: "Short break. Drinks are still on at the booth 👀",
  stopped: "The game is closed. Drinks are still on at the booth 👀",
  closing: "Games are done for today. The booth's still open 👀",
  over: "That's a wrap. Thanks for playing! 💚"
};
const SGT_DAY = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short" }); } catch (e) { return null; } })();
const sgtDate = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const opensText = at => { const t = typeof at === "number" ? at : Date.parse(at); if (!t) return ""; return (SGT_DAY ? SGT_DAY.format(new Date(t)) : "") + ", " + clock(t); };
const normCup = s => String(s || "").toUpperCase().replace(/[\s-]+/g, "");
const KEY = { round: NS + "round", device: NS + "device", cup: NS + "cup", nick: "shootout:nick", free: NS + "freeday" };

const Play = {
  st: null, idx: 0, busy: false, timer: 0, poll: 0, saving: false, starting: false, cfg: null, beat: 0,
  init(){
    this.root = $("#app");
    this.device = Store.get(KEY.device);
    if (!this.device || !/^[A-Za-z0-9_-]{16,40}$/.test(this.device)){ this.device = randomId(22); Store.set(KEY.device, this.device); }
    this.pitch = new Pitch($("#pitch"), { attract: true, cy: 0.28, slowmo: true });
    this.fx = new Confetti($("#fx"));
    Loop.add({ visible: () => true, frame: dt => this.fx.frame(dt) });
    this.pitch.inputCb = a => this.onSwipe(a);
    this.pitch.on("kick", e => { if (!this.pitch.o.attract){ Sfx.play("kick"); Sfx.play("whoosh", e.T); } });
    this.pitch.on("net", () => { if (!this.pitch.o.attract) Sfx.play("net"); });
    this.pitch.on("boom", () => Sfx.play("pop"));
    this.pitch.on("resolve", r => this.onResolve(r));
    this.pitch.on("done", () => this.onDone());
    if (Api.test) $("#testRibbon").hidden = false;
    // sound
    Sfx.init(true);
    const sb = $("#soundBtn"), paintSound = () => { sb.textContent = Sfx.on ? "🔊" : "🔇"; sb.setAttribute("aria-pressed", Sfx.on ? "true" : "false"); sb.setAttribute("aria-label", Sfx.on ? "Sound on" : "Sound off"); };
    paintSound();
    sb.onclick = () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); paintSound(); Sfx.play("tap"); if (Sfx.on && this.st && !this.st.prize) Sfx.bed(1); if (!Sfx.on) Sfx.bedStop(); };
    ["pointerdown", "touchend", "click"].forEach(t => document.addEventListener(t, () => Sfx.unlock(), { capture: true, passive: true }));
    // landing
    $("#playBtn").onclick = () => this.start();
    $("#nick").value = Store.get(KEY.nick) || "";
    $("#nick").addEventListener("keydown", e => { if (e.key === "Enter") this.start(); });
    $("#nick").addEventListener("input", () => { $("#landErr").hidden = true; });
    $("#haveCup").onclick = () => { Sfx.play("tap"); $("#cupEntry").hidden = false; $("#cupCode").focus(); };
    $("#cupGo").onclick = () => this.typeCup($("#cupCode").value);
    $("#cupCode").addEventListener("keydown", e => { if (e.key === "Enter") this.typeCup($("#cupCode").value); });
    $("#fbRetry").onclick = () => { $("#fallback").hidden = true; $("#landing").hidden = false; this.start(); };
    // a cup card's QR opens …/shootout/?c=CODE: keep the code, then clean the address bar
    try {
      const u = new URL(location.href), c = normCup(u.searchParams.get("c"));
      if (c){ Store.set(KEY.cup, c); u.searchParams.delete("c"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); }
    } catch (e) { /* old browser: the code stays in the address */ }
    this.cup = Store.get(KEY.cup) || null;
    window.addEventListener("resize", sizeApp); sizeApp();
    document.addEventListener("visibilitychange", () => { if (!document.hidden){ this.loadConfig(); this.checkPrize(); } else Sfx.bedStop(); });
    // another tab of this browser used the prize: show it here at once (review B1)
    window.addEventListener("storage", e => {
      if (e.key !== KEY.round || !this.st || !this.st.prize) return;
      const v = Store.get(KEY.round);
      if (v && v.round && v.round.id === this.st.round.id && v.prize){ this.st = v; this.tickPrize(); this.renderAgain(); }
    });
    this.resume();
    this.loadConfig();
    setInterval(() => { if (!this.st) this.loadConfig(); }, 30000);
  },
  async loadConfig(){
    const r = await Api.post("/config", {}, 6000);
    if (!r.ok) return;
    this.cfg = r;
    if (r.prices) CONFIG.prices = r.prices;
    if (r.prizeMinutes) CONFIG.prizeMinutes = r.prizeMinutes;
    if (r.graceMinutes) CONFIG.graceMinutes = r.graceMinutes;
    if (r.prizes) CONFIG.prizes = r.prizes;
    this.renderLanding();
  },
  freeUsed(){ return Store.get(KEY.free) === sgtDate(Api.now()); },
  err(msg){ const e = $("#landErr"); e.textContent = msg || ""; e.hidden = !msg; },
  save(){ Store.set(KEY.round, this.st); },
  typeCup(v){
    Sfx.play("tap");
    const c = normCup(v);
    if (c.length !== 6){ this.err("Cup card codes have 6 letters."); return; }
    this.cup = c; Store.set(KEY.cup, c); this.err(""); this.renderLanding();
  },
  /* on page load: an open prize first, then an unfinished round, else the landing */
  resume(){
    const st = Store.get(KEY.round);
    this.st = st && st.round && Array.isArray(st.results) ? st : null;
    const now = Api.now();
    // a prize stays on screen (the card says if it ran out); only one hours past its time is cleared: a wrong phone clock can't wipe it (review M2)
    if (this.st && this.st.prize && now < this.st.prize.expiresAt + CONFIG.graceMinutes * 60000 + 3 * 3600e3){ this.showResult(); return; }
    if (this.st && !this.st.prize && this.st.results.length === this.st.round.shots){ this.showResult(); return; }
    if (this.st && !this.st.prize && this.st.results.length < this.st.round.shots){ this.enterGame(true); return; }
    if (this.st) Store.del(KEY.round);
    this.st = null; this.showLanding();
  },
  showLanding(){
    clearInterval(this.timer); clearInterval(this.poll); clearInterval(this.beat); Sfx.bedStop();
    $("#result").hidden = true; $("#result").innerHTML = ""; $("#fallback").hidden = true; $("#landing").hidden = false; $("#hud").hidden = true;
    this.pitch.paused = false; this.pitch.inputOn = false; this.pitch.o.attract = true; this.pitch.reset(); this.pitch.attractT = 1; this.pitch.setCy(0.28);
    this.renderLanding();
  },
  renderLanding(){
    if (this.st) return;
    const s = this.cfg ? this.cfg.status : "open", blocked = s !== "open";
    let msg = STATUS_TEXT[s] || "";
    if ((s === "closed" || s === "later") && this.cfg.opensAt) msg = "Games open " + opensText(this.cfg.opensAt) + ". See you then! 👋";
    else if (s === "closed" || s === "later") msg = "Games are closed right now. The booth's still open 👀";
    $("#pausedMsg").hidden = !blocked; $("#pausedMsg").textContent = msg;
    const cb = $("#cupBanner"), free = this.freeUsed();
    if (this.cup){
      cb.hidden = false; cb.innerHTML = "Cup card <b>" + esc(this.cup) + "</b> · 3 shots unlocked ✓";
      $("#playBtn").textContent = "Take your 3 shots ⚽"; $("#haveCup").hidden = true; $("#cupEntry").hidden = true;
    } else {
      cb.hidden = true; $("#playBtn").textContent = free ? "Free shot used today" : "Take your free shot ⚽"; $("#haveCup").hidden = free;
      if (free) $("#cupEntry").hidden = false;
    }
    $("#playBtn").disabled = blocked || (!this.cup && free);
    $("#lede").textContent = this.cup ? CONFIG.copy.startCup : free ? "You've had today's free shot. " + CONFIG.copy.afterFree + "." : CONFIG.copy.startFree;
  },
  showFallback(){
    // the automatic no-go page: the server didn't answer twice
    const P = CONFIG.prices;
    $("#fbMenu").innerHTML = "<div><span>Matcha drinks</span><span>" + money(P.matcha) + "</span></div><div><span>Sparkling yuzu</span><span>" + money(P.yuzu) + "</span></div>" +
      "<div><span>Trio · 2 matcha + 1 yuzu</span><span><s>" + money(CONFIG.trioWas()) + "</s>" + money(P.trio) + "</span></div>";
    $("#landing").hidden = true; $("#fallback").hidden = false;
  },
  async start(){
    if (this.starting) return;
    Sfx.unlock(); Sfx.play("tap");
    const chk = J.checkName($("#nick").value);
    if (!chk.ok){ this.err(chk.why); vibrate(40); return; }
    Store.set(KEY.nick, chk.name);
    this.err(""); this.starting = true; $("#playBtn").disabled = true; $("#playBtn").textContent = "Getting the keeper…";
    const body = { device: this.device, name: chk.name };
    if (this.cup) body.cup = this.cup;
    let res = await Api.post("/start", body, 6000);
    if (!res.ok && (res.code === "timeout" || res.code === "network")){ $("#playBtn").textContent = "Still trying…"; res = await Api.post("/start", body, 6000); }
    this.starting = false;
    if (!res.ok){
      const c = res.code;
      if (c === "timeout" || c === "network"){ this.renderLanding(); this.showFallback(); return; }
      if (c === "free-used"){ Store.set(KEY.free, sgtDate(Api.now())); this.renderLanding(); return; }
      if (["paused", "closing", "closed", "later", "over", "stopped"].includes(c)){ if (this.cfg) this.cfg.status = c; else this.cfg = { status: c }; if (res.opensAt) this.cfg.opensAt = res.opensAt; this.renderLanding(); return; }
      if (c === "unknown-cup" || c === "used-cup" || c === "card-in-use"){ this.cup = null; Store.del(KEY.cup); }
      this.renderLanding(); this.err(res.message || "Something went wrong. Try again."); vibrate(40); return;
    }
    const r = res.round;
    if (r.mode === "free") Store.set(KEY.free, sgtDate(Api.now()));
    else { this.cup = null; Store.del(KEY.cup); }
    this.st = { round: r, aims: [], results: [], outcomes: [], prize: null, usedLocal: 0, usedAck: false };
    this.save();
    this.enterGame(false);
  },
  enterGame(resumed){
    $("#landing").hidden = true; $("#fallback").hidden = true; $("#result").hidden = true; $("#hud").hidden = false;
    this.pitch.paused = false; this.pitch.o.attract = false; this.pitch.queue = []; this.pitch._auto = false; this.pitch.reset(); this.pitch.label = ""; this.pitch.setCy(0.40);
    this.idx = this.st.results.length; this.busy = false;
    Sfx.bed(1); if (!resumed) Sfx.play("whistle");
    this.armShot();
  },
  level(){ return this.st.round.mode === "free" ? 0 : this.idx; },
  armShot(){
    const r = this.st.round, lv = this.level();
    $("#hudShot").innerHTML = r.mode === "free" ? "FREE SHOT · <em>" + J.LEVELS[lv] + "</em>" : "SHOT " + (this.idx + 1) + " OF 3 · <em" + (lv === 2 ? ' class="hard"' : "") + ">" + J.LEVELS[lv] + "</em>";
    this.drawDots($("#hudDots"));
    this.pitch.inputOn = true; this.busy = false;
    $("#hint").hidden = this.idx > 0; $("#hintText").textContent = "Swipe up from the ball to shoot";
    // the last, hardest shot: a heartbeat until the swipe
    clearInterval(this.beat);
    if (r.mode === "cup" && this.idx === 2){ Sfx.play("heart"); this.beat = setInterval(() => Sfx.play("heart"), 1100); }
  },
  drawDots(el){ const st = this.st, n = st.round.shots; let h = ""; for (let i = 0; i < n; i++) h += "<i class='" + (i < st.results.length ? (st.results[i] ? "g" : "m") : "") + "'></i>"; el.innerHTML = h; },
  onSwipe(aim){
    if (!this.st || this.busy || this.st.results.length >= this.st.round.shots) return;
    if (!aim){ $("#hint").hidden = false; $("#hintText").textContent = "Swipe UP towards the goal"; return; }
    clearInterval(this.beat);
    this.busy = true; this.pitch.inputOn = false; $("#hint").hidden = true;
    const odds = this.st.round.odds, lv = this.level(), a = J.assist(aim.tx, aim.ty, lv, odds), i = this.idx;
    const j = J.judge(a, lv, this.st.round.draws[i], odds);        // same rule, same draw, same odds the server uses at "finish"
    const kp = J.keeperPlan(j.outcome, a, Math.random);              // the keeper's dive is only a picture
    this.near = j.near;
    this.pitch.kick({ tx: a.tx, ty: a.ty, power: aim.power, curve: aim.curve });
    this.pitch.setPlan({ outcome: j.outcome, kp, aim: a, near: j.near });
    vibrate(20);
    this.st.aims[i] = { tx: aim.tx, ty: aim.ty }; this.st.results[i] = j.outcome === "goal"; this.st.outcomes[i] = j.outcome; this.save();
    Api.post("/ping", { round: this.st.round.id, i, aim: { tx: aim.tx, ty: aim.ty }, power: aim.power, curve: aim.curve }, 5000);   // best effort, for the wall
  },
  onResolve(r){
    if (!this.st || this.st.prize || this.pitch.o.attract) return;
    const o = r.outcome, near = this.near, st = this.st;
    const goals = st.results.filter(Boolean).length, hat = st.round.mode === "cup" && st.results.length === 3 && goals === 3;
    let txt = OUT_TEXT[o] || "";
    if (o === "wide" && near) txt = "just wide!";
    if (o === "over" && near) txt = "just over!";
    const sub = o === "save" ? "Fingertips!" : (o === "post" || o === "bar") ? "So close." : hat ? "HAT TRICK!" : "";
    this.callout(txt, o === "goal", sub);
    this.drawDots($("#hudDots"));
    if (o === "goal"){
      this.pitch.celebrate(hat ? "hat" : "goal"); Sfx.play("roar", hat); Sfx.play(hat ? "fanfare" : "horn");
      this.fx.burst(hat ? 220 : 90, { y: -10 });
      vibrate(hat ? [80, 50, 80, 50, 160] : [60, 40, 90]);
    } else if (o === "save"){ Sfx.play("glove"); Sfx.play("ooh"); vibrate(30); }
    else if (o === "post" || o === "bar"){ Sfx.play("clang"); Sfx.play("groan"); vibrate([20, 30, 20]); }
    else { Sfx.play("groan"); vibrate(30); }
  },
  callout(txt, good, sub){
    const c = $("#callout"); c.className = "callout"; c.innerHTML = esc(txt) + (sub ? "<small>" + esc(sub) + "</small>" : "");
    void c.offsetWidth; c.className = "callout show" + (good ? " good" : "");
  },
  onDone(){
    if (!this.st || this.st.prize || this.pitch.o.attract || this.st.results.length <= this.idx) return;
    this.idx++;
    if (this.idx >= this.st.round.shots){ setTimeout(() => this.showResult(), 300); return; }
    setTimeout(() => { this.pitch.reset(); this.armShot(); }, 200);
  },
  headline(){
    const st = this.st, goals = st.results.filter(Boolean).length;
    if (st.round.mode === "free") return goals ? CONFIG.copy.freeGoal : CONFIG.copy.freeMiss;
    return goals === 3 ? CONFIG.copy.hat : goals === 2 ? CONFIG.copy.two : goals === 1 ? CONFIG.copy.one : CONFIG.copy.none;
  },
  catFor(){
    const st = this.st, goals = st.results.filter(Boolean).length;
    if (st.round.mode === "free") return goals ? ["cat-whisk-ride-cream.webp", "A cat riding a matcha whisk"] : ["matcha-deprived-cream.webp", "A matcha-deprived cat"];
    if (goals === 3) return ["cat-ok-gotcha-cream.webp", "A cat saying ok gotcha"];
    if (goals === 2) return ["cat-barista-cream.webp", "A cat lifting a whisk like a barbell"];
    return ["matcha-deprived-cream.webp", "A matcha-deprived cat"];
  },
  showResult(){
    const st = this.st, r = st.round, goals = st.results.filter(Boolean).length, P = CONFIG.prices, cat = this.catFor();
    clearInterval(this.beat);
    this.pitch.inputOn = false;
    Sfx.bedStop(); this.pitch.paused = true;   // the stadium stops drawing behind the prize screen (battery)
    const el = $("#result");
    el.innerHTML =
      '<div class="res-top"><img class="res-cat" src="assets/img/' + cat[0] + '" alt="' + esc(cat[1]) + '" width="96" height="100"><div>' +
        '<p class="eyebrow">' + (r.mode === "free" ? "FREE SHOT" : "YOUR 3 SHOTS") + " · " + esc(r.name) + "</p>" +
        '<p class="res-head">' + esc(this.headline()) + "</p>" +
        '<div class="res-score"><div class="dots" id="resDots"></div><span>' + goals + " of " + r.shots + " goal" + (r.shots > 1 ? "s" : "") + "</span></div></div></div>" +
      (Api.test ? '<p class="err" style="text-align:center">TEST SERVER: not a real prize.</p>' : "") +
      '<div class="prize saving' + (Api.test ? " testcard" : "") + '" id="prizeCard"><img class="prize-photo" id="pPhoto" src="assets/img/matcha-latte-cut.webp" alt="" width="84" height="105" hidden>' +
        '<div class="prize-what" id="pWhat">…</div><div class="prize-sub" id="pSub">Saving your result</div>' +
        '<div class="prize-code" aria-label="Prize code" id="pCode">····</div><div class="prize-timer" id="prizeTimer"></div>' +
        '<div class="prize-rules">Today only · at the booth · with a new purchase<br>' + esc(CONFIG.prizeRules) + '</div><div class="stamp">USED</div><div class="prize-roll"><span class="ball"></span></div></div>' +
      '<p class="err" id="saveMsg" hidden></p>' +
      '<button class="hold" id="holdBtn" hidden><span class="fill"></span><span class="t">Staff: hold to redeem · discount on green ✓</span></button>' +
      '<p class="booth">' + esc(CONFIG.copy.booth) + "</p>" +
      '<div class="again" id="again"></div>' +
      (r.mode === "free" ?
        '<div class="cta"><h3>' + esc(CONFIG.copy.afterFree) + '</h3><div class="menu">' +
          "<div><span>Matcha drinks</span><span>" + money(P.matcha) + "</span></div>" +
          "<div><span>Sparkling yuzu</span><span>" + money(P.yuzu) + "</span></div>" +
          "<div><span>Trio · 2 matcha + 1 yuzu</span><span><s>" + money(CONFIG.trioWas()) + "</s>" + money(P.trio) + "</span></div></div>" +
          '<p class="win">With 3 shots: <b>2 goals</b> = free sparkling yuzu with your next matcha · <b>3 goals</b> = free matcha with your next drink + your name in the Hall of Fame · 0–1 goals = $1 off.</p></div>' : "") +
      '<div class="foot"><a href="rules/">Rules</a><span>We gotcha 💚</span></div>';
    this.countDots();
    $("#hud").hidden = true; $("#landing").hidden = true; el.hidden = false; el.scrollTop = 0;
    this.bindHold();
    clearInterval(this.timer); this.timer = setInterval(() => this.tickPrize(), 250);
    clearInterval(this.poll); this.poll = setInterval(() => this.checkPrize(), 10000);
    if (st.prize) this.fillPrize(false); else this.sendResult();
    this.renderAgain();
  },
  countDots(){   // the score dots pop in one by one
    const el = $("#resDots"); if (!el) return;
    const st = this.st, n = st.round.shots; el.innerHTML = "<i></i>".repeat(n);
    st.results.forEach((g, i) => setTimeout(() => { const d = el.children[i]; if (!d) return; d.className = g ? "g" : "m"; Sfx.play("tick"); }, 250 + i * 280));
  },
  async sendResult(){
    if (this.saving) return; this.saving = true;
    const id = this.st.round.id, aims = this.st.aims;
    for (let attempt = 0; this.st && this.st.round.id === id && !this.st.prize; attempt++){
      const res = await Api.post("/finish", { round: id, aims }, 8000);
      if (!this.st || this.st.round.id !== id) break;
      if (res.ok){
        this.st.prize = res.prize;
        if (Array.isArray(res.results) && res.results.join() !== this.st.results.join()){   // the server's answer wins
          this.st.results = res.results; $(".res-head").textContent = this.headline(); this.countDots();
        }
        this.save(); $("#saveMsg").hidden = true; this.fillPrize(true); break;
      }
      if (res.code === "not-found" || res.code === "bad-input"){ $("#saveMsg").hidden = false; $("#saveMsg").textContent = "We couldn't save this round. Show this screen at the booth."; break; }
      $("#saveMsg").hidden = false;
      $("#saveMsg").textContent = "Weak signal. Your result is safe on this phone. Keep this page open; it keeps trying.";
      await sleep(Math.min(10000, 2500 + attempt * 1500));
    }
    this.saving = false;
  },
  fillPrize(fresh){
    const p = this.st.prize, card = $("#prizeCard"); if (!card) return;
    card.classList.remove("saving");
    $("#pWhat").textContent = p.what; $("#pSub").textContent = p.sub; $("#pCode").textContent = p.code;
    $("#pPhoto").hidden = p.kind !== "goals3";
    $("#holdBtn").hidden = false;
    if (fresh && !REDUCED){ card.classList.remove("flip"); void card.offsetWidth; card.classList.add("flip"); }
    if (fresh){ Sfx.play("chime"); if (p.kind === "goals3" || p.kind === "goals2") this.fx.burst(p.kind === "goals3" ? 160 : 70, { y: -10 }); }
    if (this.st.usedLocal && !this.st.usedAck) this.sendRedeem();   // a hold the server hadn't heard about before a reload
    this.tickPrize(); this.renderAgain();
  },
  // what the phone may do next: another cup card waiting, or nothing
  renderAgain(){
    const el = $("#again"); if (!el || !this.st) return;
    const p = this.st.prize, now = Api.now();
    const done = !p || this.st.usedLocal || p.redeemedAt || now > p.expiresAt + CONFIG.graceMinutes * 60000;
    if (!this.cup){ el.innerHTML = done && p ? '<button class="btn ghost" id="againBtn">Play again with a cup card</button>' : ""; }
    else el.innerHTML = '<div class="cup">Next cup card <b>' + esc(this.cup) + "</b> is ready · 3 shots</div>" +
      (done ? '<button class="btn glow" id="againBtn">Take your 3 shots ⚽</button>' : '<p class="note">Use the prize above first, then play it.</p><button class="linkbtn" id="skipBtn">Play it now and lose this prize</button>');
    const a = $("#againBtn"); if (a) a.onclick = () => this.newRound();
    const s = $("#skipBtn"); if (s) s.onclick = () => { if (window.confirm("Your prize " + p.what + " (code " + p.code + ") will be gone from this phone. Play the new card now?")) this.newRound(); };
  },
  newRound(){
    Sfx.play("tap");
    Store.del(KEY.round); this.st = null;
    this.showLanding();
    if (!this.cup){ $("#cupEntry").hidden = false; $("#cupCode").focus(); }
  },
  bindHold(){
    const b = $("#holdBtn"); let tm = 0, stopTone = () => {};
    const down = e => {
      e.preventDefault(); if (b.dataset.done || !this.st || !this.st.prize) return;
      const fresh = Store.get(KEY.round);   // another tab may have used it already (review B1)
      if (fresh && fresh.round && fresh.round.id === this.st.round.id && (fresh.usedLocal || (fresh.prize && fresh.prize.redeemedAt))){ this.st = fresh; this.tickPrize(); return; }
      Sfx.unlock(); b.classList.add("on"); stopTone = Sfx.holdTone();
      tm = setTimeout(() => {
        stopTone(); b.dataset.done = "1"; this.st.usedLocal = Api.now(); this.st.holdId = randomId(16); this.save();
        Sfx.play("coin"); vibrate([40, 30, 80]); this.tickPrize(); this.sendRedeem(); this.renderAgain();
      }, 900);
    };
    const up = () => { if (b.dataset.done) return; clearTimeout(tm); stopTone(); b.classList.remove("on"); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up); b.addEventListener("pointercancel", up);
    b.addEventListener("contextmenu", e => e.preventDefault());
    b.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) down(e); });
    b.addEventListener("keyup", up);
  },
  async sendRedeem(){
    // the phone shows "checking" at once; the server is asked again and again until it answers. Only the server's yes turns it green.
    const code = this.st.prize.code, id = this.st.round.id;
    for (let i = 0; this.st && this.st.prize && this.st.prize.code === code; i++){
      const r = await Api.post("/redeem", { round: id, code, hold: this.st.holdId || undefined }, 6000);
      if (r.ok || r.code === "already"){
        if (!this.st || !this.st.prize || this.st.prize.code !== code) return;
        // "already" for this phone's own hold (a retry after a lost answer) = confirmed; staff typed the code after this hold (the phone
        // was amber) = used, shown grey; another phone's hold, or a redeem from before this hold = red, no discount (review B1)
        const ownRetry = r.code !== "already" || (this.st.holdId && r.hold === this.st.holdId);
        const byStaffAfter = !ownRetry && !r.hold && r.redeemedAt >= this.st.usedLocal - 2000;
        if (!ownRetry && !byStaffAfter){ this.st.dupAt = r.redeemedAt || Api.now(); vibrate([200, 100, 200]); Sfx.play("groan"); }
        if (byStaffAfter) this.st.elsewhere = true;
        this.st.usedAck = true; this.st.prize.redeemedAt = r.redeemedAt || this.st.usedLocal; this.save(); this.tickPrize(); return;
      }
      // only "expired" and "not found" mean the prize isn't valid; a passing server error keeps retrying (amber after 5 s) (re-check)
      if (r.code === "expired" || r.code === "not-found"){
        if (this.st && this.st.prize && this.st.prize.code === code){ this.st.badRedeem = r.message || "Not valid."; this.save(); vibrate([200, 100, 200]); Sfx.play("groan"); this.tickPrize(); }
        return;
      }
      if (r.code === "bad-input") return;   // our own bug, not the customer's: stays amber, staff type the code
      await sleep(3000);
    }
  },
  // the server's view every 10 s: a staff Undo or a redeem typed at the counter shows here
  async checkPrize(){
    if (!this.st || !this.st.prize || document.hidden) return;
    const code = this.st.prize.code, ackAtSend = this.st.usedAck, usedAtSend = this.st.usedLocal;
    const r = await Api.post("/prize", { round: this.st.round.id }, 6000);
    if (!r.ok || !r.prize || !this.st || !this.st.prize || this.st.prize.code !== code) return;
    const srv = r.prize;
    // an Undo only if the redeem was already confirmed when this check was sent (review G4)
    if (ackAtSend && this.st.usedAck && this.st.usedLocal === usedAtSend && !srv.redeemedAt && !this.st.dupAt){   // staff pressed Undo
      this.st.usedLocal = 0; this.st.usedAck = false; this.st.elsewhere = false; this.st.prize.redeemedAt = null; this.st.badRedeem = null; this.save();
      const b = $("#holdBtn"); if (b){ delete b.dataset.done; b.classList.remove("on"); }
    } else if (srv.redeemedAt && !this.st.usedLocal){ this.st.usedLocal = srv.redeemedAt; this.st.usedAck = true; this.st.elsewhere = true; this.st.prize.redeemedAt = srv.redeemedAt; this.save(); }
    this.st.prize.expiresAt = srv.expiresAt || this.st.prize.expiresAt;
    this.tickPrize(); this.renderAgain();
  },
  tickPrize(){
    if (!this.st || !this.st.prize || !$("#prizeCard")) return;
    const card = $("#prizeCard"), t = $("#prizeTimer"), hb = $("#holdBtn"), p = this.st.prize;
    const used = this.st.usedLocal || p.redeemedAt;
    // the counter rule: only a green USED ✓ (the server said yes) earns the discount (adversarial review 1)
    if (this.st.dupAt || this.st.badRedeem){
      card.classList.add("used", "dup"); card.classList.remove("ok", "unsure"); if (hb) hb.hidden = true; t.className = "prize-timer dupmsg";
      t.innerHTML = this.st.dupAt ? "ALREADY USED at <b>" + clock(this.st.dupAt) + "</b>. No discount." : "NOT VALID: " + esc(this.st.badRedeem) + " No discount.";
      return;
    }
    if (used){
      card.classList.add("used"); if (hb) hb.hidden = true;
      // green only for a minute after a hold on THIS phone that the server confirmed: an old green screen can't be shown again later
      const age = Api.now() - this.st.usedLocal, fresh = this.st.usedAck && !this.st.elsewhere && age < 60000, late = !this.st.usedAck && age > 5000;
      card.classList.toggle("ok", fresh); card.classList.toggle("unsure", late);
      t.className = "prize-timer" + (fresh ? " ok" : late ? " unsure" : "");
      t.innerHTML = fresh ? "✓ Redeemed just now · confirmed"
        : this.st.usedAck ? "Used at <b>" + clock(used) + "</b>"
        : late ? "Not checked yet. Staff: type the code " + esc(p.code) + " on the staff page." : "Checking with our server…";
      return;
    }
    card.classList.remove("used", "dup", "ok", "unsure");
    if (hb) hb.hidden = false;
    const left = p.expiresAt - Api.now(), graceLeft = left + CONFIG.graceMinutes * 60000;
    if (left > 0){ t.className = "prize-timer" + (left < 60000 ? " low" : ""); t.innerHTML = "Use within <b>" + mmss(left) + "</b>"; card.classList.remove("expired"); }
    else if (graceLeft > 0){ t.className = "prize-timer low"; t.innerHTML = "Time's up. Show staff now: <b>" + mmss(graceLeft) + "</b> left at the counter"; }
    else { if (!card.classList.contains("expired")){ card.classList.add("expired"); this.renderAgain(); } t.innerHTML = "Ran out at <b>" + clock(p.expiresAt) + "</b>"; if (hb) hb.hidden = true; }
  }
};

window.addEventListener("DOMContentLoaded", () => { Play.init(); Loop.start(); });
