/* Gotcha Shootout — the projector wall (the Xiaomi projector's own browser, 1920x1080). Polls the server every 2 s; replays real shots
   on its own pitch, celebrates goals (no name) and hat tricks (name), lists today's hat tricks. Offline it keeps playing practice shots
   and only the small dot top right turns grey: it never shows an error. Sound is off until staff press "Sound on" (browser rule). */
"use strict";
const Wall = {
  last: -1, fails: 0, online: true, data: null, hi: 0, cel: [], celOn: false, lastHat: null,
  init(){
    document.body.classList.add("wallpage");
    this.fit = $("#wallFit");
    this.fit.innerHTML =
      '<div class="wall" id="wall">' +
        '<div class="w-beams" aria-hidden="true"><i></i><i></i><i></i></div>' +
        '<div class="w-head"><div class="w-headline" id="wHead"></div><div class="w-brand"><img src="../assets/img/logo-lockup-white.webp" alt="Gotcha Matcha" width="330" height="101"><small>we gotcha</small></div></div>' +
        '<div class="w-net" id="wNet"><i></i><span>live</span></div>' +
        '<div class="w-qr"><div class="qrbox">' + qrSvg(BANNER_QR) + '</div><div class="w-scan">Scan to play</div><div class="w-sub">Free · 10 seconds · Everyone wins</div><div class="w-url">' + CONFIG.addressShort + "</div></div>" +
        '<div class="w-pitch"><canvas></canvas><div class="w-live" id="wLive" hidden></div></div>' +
        '<div class="w-board"><h3>Hat tricks today</h3><p class="w-order" id="wOrder">Newest first</p><ol id="wList"></ol><div id="wEmpty" class="w-empty" hidden></div><div class="w-more" id="wMore"></div></div>' +
        '<div class="w-count" id="wCount"></div>' +
        '<div class="w-deal" id="wDeal"></div>' +
        '<div class="w-flash" id="wFlash"></div>' +
        '<div class="w-cel" id="wCel" hidden><img id="wCelImg" alt="" hidden><div class="big" id="wCelBig"></div><div class="who" id="wCelWho"></div><div class="note" id="wCelNote"></div></div>' +
        '<canvas class="w-confetti" id="wConf" width="1920" height="1080"></canvas>' +
      "</div>";
    this.stage = $("#wall");
    this.pitch = new Pitch($(".w-pitch canvas"), { attract: true, maxDpr: 1, fit: 0.62, cy: 0.42, camZ: 17, slowmo: true });
    this.pitch.on("kick", () => {
      const lv = $("#wLive"); lv.hidden = false; lv.innerHTML = this.pitch.label ? "<i></i>" + esc(this.pitch.label) : "Practice shots";
      const sp = this.pitch.curSpec; if (sp && !sp.practice) Sfx.play("kick");
    });
    this.pitch.on("resolve", r => {
      const sp = this.pitch.curSpec; if (!sp || sp.practice) return;
      if (r.outcome === "save") Sfx.play("ooh"); else if (r.outcome === "post" || r.outcome === "bar") Sfx.play("clang");
      if (sp.cel){ const c = sp.cel; sp.cel = null; this.celebrate(c.kind, c.name, c.ev); }
    });
    this.pitch.on("boom", () => Sfx.play("pop"));
    this.conf = new Confetti($("#wConf"), 1920, 1080);
    Loop.add({ visible: () => true, frame: dt => this.conf.frame(dt) });
    // controls for staff (TV remote or mouse): sound, full screen. They fade after a while.
    Sfx.init(false);
    const sb = $("#wSound"), paint = () => { sb.textContent = Sfx.on ? "🔊 Sound off" : "🔈 Sound on"; };
    paint();
    sb.onclick = () => { Sfx.unlock(); Sfx.setOn(!Sfx.on); paint(); if (Sfx.on){ Sfx.bed(0.5); Sfx.play("whistle"); } else Sfx.bedStop(); this.wake(); };
    $("#wFull").onclick = () => { const d = document.documentElement; try { (d.requestFullscreen || d.webkitRequestFullscreen).call(d); } catch (e) { /* not allowed */ } this.wake(); };
    let idle = 0; const ctl = $("#wCtl"), show = () => { ctl.hidden = false; clearTimeout(idle); idle = setTimeout(() => { ctl.hidden = true; }, 12000); };
    ["mousemove", "keydown", "pointerdown"].forEach(e => document.addEventListener(e, () => { show(); if (Sfx.on){ Sfx.unlock(); Sfx.bed(0.5); } }));
    show();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.wake(); });
    window.addEventListener("resize", () => this.scale()); this.scale();
    this.render(); this.rotate();
    setInterval(() => this.rotate(), CONFIG.headlineSeconds * 1000);
    this.poll();
  },
  async wake(){ try { if (navigator.wakeLock && !this.lock) { this.lock = await navigator.wakeLock.request("screen"); this.lock.addEventListener("release", () => { this.lock = null; }); } } catch (e) { /* not supported */ } },
  scale(){
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    this.stage.style.transform = "translate(" + Math.round((window.innerWidth - 1920 * k) / 2) + "px," + Math.round((window.innerHeight - 1080 * k) / 2) + "px) scale(" + k + ")";
    this.pitch.resize();
  },
  async poll(){
    try { await this.pollOnce(); } catch (e) { console.error(e); }   // one bad answer must never stop the wall for the day (review M4)
    setTimeout(() => this.poll(), (CONFIG.wallPollSeconds || 2) * 1000);
  },
  async pollOnce(){
    const r = await Api.post("/wall", { after: this.last }, 5000);
    if (r.ok){
      this.fails = 0; this.online = true; this.data = r;
      if (r.prices) CONFIG.prices = r.prices;
      const first = this.last === -1;
      this.last = typeof r.last === "number" ? r.last : this.last;
      if (!first) (r.events || []).forEach(ev => this.onEvent(ev));
      this.render();
    } else if (++this.fails >= 2){ this.online = false; this.render(); }
  },
  headlines(){
    const d = this.data, list = [];
    if (d && d.lastDay) list.push(CONFIG.lastDayHeadline);
    CONFIG.headlines.forEach(h => {
      if (h !== "@ODDS") return list.push(h);
      const c = d && d.counts;
      if (c && c.hatTricks >= 3 && c.rounds >= 15) list.push("Only 1 in " + Math.round(c.rounds / c.hatTricks) + " cup cards gets a hat trick.");
    });
    return list;
  },
  statusLine(){
    const d = this.data, s = d && d.status;
    if (s === "paused" || s === "stopped") return "Back in a few minutes. Drinks still on!";
    if (s === "closing" || s === "closed" || s === "over") return "Games are done for now. Drinks still on!";
    if (s === "later") return "Games start soon. Drinks are on now!";
    return "";
  },
  rotate(){
    const el = $("#wHead"), fixed = this.statusLine();
    if (fixed){ el.textContent = fixed; return; }
    const list = this.headlines(); this.hi = (this.hi + 1) % list.length;
    el.classList.add("fade"); setTimeout(() => { el.textContent = list[this.hi % list.length]; el.classList.remove("fade"); }, 450);
  },
  render(){
    const d = this.data || { hall: { total: 0, rows: [] }, counts: { shots: 0, hatTricks: 0, rounds: 0 }, switches: {} };
    const rows = (d.hall && d.hall.rows) || [], total = (d.hall && d.hall.total) || 0, namesOff = d.switches && d.switches.namesOff;
    const show = namesOff ? [] : rows.slice(0, 8);
    $("#wList").innerHTML = show.map((h, i) => '<li class="' + (i === 0 && this.lastHat && this.lastHat === h.name ? "new" : "") + '"><span>' + esc(h.name) + "</span><time>" + clock(h.at) + "</time></li>").join("");
    const em = $("#wEmpty"), c = d.counts || {};
    em.hidden = show.length > 0;
    em.textContent = total ? total + " hat trick" + (total === 1 ? "" : "s") + " today." + (namesOff ? " Names are off for now." : "") : "No hat tricks yet today. Be the first!";
    $("#wOrder").hidden = !show.length;
    $("#wMore").textContent = total > show.length && show.length ? show.length + " newest of " + total : "";
    $("#wCount").innerHTML = "<b>" + (c.shots || 0) + "</b> shots today · <b>" + (c.hatTricks || 0) + "</b> hat trick" + (c.hatTricks === 1 ? "" : "s");
    $("#wDeal").textContent = "Matcha from " + money(CONFIG.prices.matcha) + " · 3 for " + money(CONFIG.prices.trio);   // the OCBC menu words
    $("#wNet").classList.toggle("off", !this.online);
    $("#wNet span").textContent = this.online ? (Api.test ? "test server" : "live") : "reconnecting";
    const fixed = this.statusLine(); if (fixed && $("#wHead").textContent !== fixed) $("#wHead").textContent = fixed;
  },
  onEvent(ev){
    if (ev.type === "shot"){
      const cel = ev.outcome === "goal" ? { kind: "goal", name: null, ev } : null;
      const kp = J.keeperPlan(ev.outcome, ev.aim, Math.random);
      this.pitch.queueShot({ rid: ev.round, shotNo: ev.i + 1, aim: ev.aim, kp, outcome: ev.outcome, near: ev.near, power: ev.power, curve: ev.curve,
        label: "LIVE · " + (ev.mode === "free" ? "FREE SHOT" : "SHOT " + (ev.i + 1) + " OF " + ev.of), cel });
    }
    if (ev.type === "hat"){
      this.lastHat = ev.name || null;
      const cel = { kind: "hat", name: ev.name || null, ev };
      // if the 3rd goal is still waiting to be replayed, show HAT TRICK when it goes in; otherwise now
      const pend = [this.pitch.resolved ? null : this.pitch.curSpec].concat(this.pitch.queue).find(sp => sp && sp.rid === ev.round && sp.shotNo === 3);
      if (pend) pend.cel = cel; else this.celebrate("hat", cel.name, ev);
    }
  },
  celebrate(kind, name, ev){
    if (kind === "hat") this.cel = this.cel.filter(c => c.kind === "hat");
    if (this.cel.length >= 4) this.cel.shift();
    this.cel.push({ kind, name, ev }); if (!this.celOn) this.nextCel();
  },
  nextCel(){
    const c = this.cel.shift(), box = $("#wCel");
    if (!c){ this.celOn = false; box.hidden = true; return; }
    if (c.name){ const d = this.data, rows = (d && d.hall && d.hall.rows) || []; if ((d && d.switches && d.switches.namesOff) || !rows.some(h => h.name === c.name)) c.name = null; }
    this.celOn = true; box.hidden = false; box.className = "w-cel show" + (c.kind === "hat" ? " hat" : "");
    const img = $("#wCelImg"); img.hidden = c.kind !== "hat"; if (c.kind === "hat") img.src = "../assets/img/cat-ok-gotcha-cream.webp";
    $("#wCelBig").textContent = c.kind === "hat" ? "hat trick!" : "goal!";
    const who = $("#wCelWho"); who.textContent = c.name || ""; who.hidden = !c.name; who.style.fontSize = "";
    if (c.name){ let fs = parseFloat(getComputedStyle(who).fontSize) || 150; while (who.scrollWidth > who.clientWidth + 2 && fs > 60){ fs -= 10; who.style.fontSize = fs + "px"; } }   // long names shrink to fit
    $("#wCelNote").textContent = c.kind === "hat" ? (c.name ? "In the Hall of Fame. Who's next?" : "Who's next?") :
      (c.ev && c.ev.mode === "free" ? "Free shot. Scan the QR and try yours!" : "Shot " + ((c.ev && c.ev.i + 1) || 1) + " of 3. Hat trick next?");
    // lights + sound
    this.pitch.celebrate(c.kind);
    if (!REDUCED){ const f = $("#wFlash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
    this.stage.classList.add("party"); clearTimeout(this.partyT); this.partyT = setTimeout(() => this.stage.classList.remove("party"), c.kind === "hat" ? 5000 : 2600);
    this.conf.burst(c.kind === "hat" ? 320 : 140, { x: 1290, spread: 1100 });
    Sfx.play("roar", c.kind === "hat"); Sfx.play(c.kind === "hat" ? "fanfare" : "horn");
    void box.offsetWidth;
    setTimeout(() => this.nextCel(), this.cel.length ? 1600 : (c.kind === "hat" ? 4200 : 2600));
  }
};
window.addEventListener("DOMContentLoaded", () => { Wall.init(); Loop.start(); });
