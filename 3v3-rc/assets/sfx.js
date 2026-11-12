/* Gotcha Shootout 3v3 — sounds made in the browser (Web Audio, no files): the penalty build's engine (shootout assets/core.js Sfx, 18 sounds +
   the stadium crowd bed), copied as-is except the storage key (s3v3:sound), a kick scaled by hit strength and a soft wall knock. Silent until
   the first tap (browser rule; iOS needs the unlock inside a tap). A sound never breaks the game. */
"use strict";
const Sfx = {
  ctx: null, master: null, noiseBuf: null, on: true, bedNodes: null,
  init(){ const v = Net.Store.get("s3v3:sound"); this.on = v === null ? true : !!v; },
  unlock(){   // call from inside a tap
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx){
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
      const c = this.ctx, comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master = c.createGain(); this.master.gain.value = this.on ? 0.9 : 0; this.master.connect(comp); comp.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);   // iOS unlock
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  },
  setOn(v){
    this.on = !!v; Net.Store.set("s3v3:sound", this.on);
    if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  },
  ready(){ return !!(this.ctx && this.on && this.ctx.state === "running"); },
  env(g, t, a, peak, hold, rel){
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  },
  tone(f, t, dur, o){
    o = o || {}; const c = this.ctx, osc = c.createOscillator(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.lp){ const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.lp; osc.connect(lp); node = lp; }
    this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    node.connect(g); g.connect(o.dest || this.master); osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  },
  noise(t, dur, o){
    o = o || {}; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    f.Q.value = o.q || 1;
    this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    s.connect(f); f.connect(g); g.connect(o.dest || this.master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return { s, f, g };
  },
  play(name, arg){
    if (!this.ready()) return;
    const fn = this.S[name]; if (!fn) return;
    try { fn.call(this, this.ctx.currentTime + 0.01, arg); } catch (e) { /* a sound must never break the game */ }
  },
  // a looping stadium murmur under the game; level 0..1
  bed(level){
    if (!this.ready()){ return; }
    const c = this.ctx, t = c.currentTime;
    if (!this.bedNodes){
      const g = c.createGain(); g.gain.value = 0.0001; g.connect(this.master);
      const layers = [[520, 0.5, 0.9], [1300, 0.7, 0.45], [2600, 0.8, 0.18]].map(([f, q, k], i) => {
        const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
        const lg = c.createGain(); lg.gain.value = k;
        const lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 0.13 + i * 0.07; lfoG.gain.value = k * 0.35;
        lfo.connect(lfoG); lfoG.connect(lg.gain); s.connect(bp); bp.connect(lg); lg.connect(g);
        s.start(t, Math.random() * 1.5); lfo.start(t);
        return [s, lfo];
      });
      this.bedNodes = { g, layers };
    }
    this.bedNodes.g.gain.setTargetAtTime(Math.max(0.0001, 0.07 * level), t, 0.6);
  },
  bedStop(){
    if (!this.bedNodes || !this.ctx) return;
    const n = this.bedNodes, t = this.ctx.currentTime; this.bedNodes = null;
    n.g.gain.setTargetAtTime(0.0001, t, 0.3);
    setTimeout(() => { n.layers.forEach(([s, l]) => { try { s.stop(); l.stop(); } catch (e) { /* stopped */ } }); try { n.g.disconnect(); } catch (e) { /* gone */ } }, 1500);
  },
  S: {
    tap(t){ this.tone(700, t, 0.08, { f2: 460, type: "triangle", gain: 0.14 }); },
    whistle(t){
      const blast = (t0, d) => {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
        o.type = "sine"; o.frequency.value = 2950; l.frequency.value = 36; lg.gain.value = 150; l.connect(lg); lg.connect(o.frequency);
        this.env(g, t0, 0.012, 0.13, d - 0.07, 0.05); o.connect(g); g.connect(this.master);
        o.start(t0); l.start(t0); o.stop(t0 + d + 0.05); l.stop(t0 + d + 0.05);
        this.noise(t0, d, { type: "highpass", f: 3500, gain: 0.03 });
      };
      blast(t, 0.16); blast(t + 0.24, 0.46);
    },
    kick(t, p){ p = p >= 0 ? Math.min(1, p) : 0.7; this.tone(150, t, 0.22, { f2: 42, gain: 0.35 + 0.6 * p }); this.noise(t, 0.05, { type: "highpass", f: 1800, gain: 0.1 + 0.2 * p }); },   // thump scaled by hit strength
    beep(t, n){ this.tone([660, 660, 880, 1100][n] || 660, t, 0.12, { type: "square", gain: 0.07, lp: 4000 }); },   // rev 8: the countdown rises 3 · 2 · 1
    wall(t){ this.tone(320, t, 0.06, { type: "square", gain: 0.05, lp: 2000 }); },
    whoosh(t, dur){ dur = dur || 0.6; this.noise(t, dur, { type: "bandpass", f: 450, f2: 2600, q: 1.3, a: dur * 0.65, gain: 0.2 }); },
    net(t){ this.noise(t, 0.5, { type: "bandpass", f: 3400, f2: 1800, q: 0.8, gain: 0.26 }); this.noise(t + 0.02, 0.7, { type: "lowpass", f: 900, gain: 0.14, a: 0.02 }); },
    roar(t, big){
      const len = big ? 3.6 : 2.6, lvl = big ? 0.62 : 0.5;
      [[420, 0.7], [900, 0.95], [1700, 0.6], [3000, 0.32]].forEach(([f, k], i) => {
        const n = this.noise(t, len, { type: "bandpass", f: f * 0.8, f2: f * 1.15, bend: 0.7, q: 0.9, a: 0.16, hold: len * 0.38, gain: lvl * k * 0.55 });
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = 4 + i * 2.3 + Math.random() * 3; lg.gain.value = lvl * k * 0.16;
        lfo.connect(lg); lg.connect(n.g.gain); lfo.start(t); lfo.stop(t + len + 0.1);
      });
    },
    horn(t){ [233, 294, 349].forEach((f, i) => this.tone(f, t, 0.95, { type: "sawtooth", lp: 1900, a: 0.03, hold: 0.62, gain: 0.11, f2: f * 0.94, bend: 0.95, detune: (i - 1) * 6 })); },
    ooh(t){ this.noise(t, 1.1, { f: 400, f2: 300, q: 4, a: 0.14, hold: 0.3, gain: 0.42 }); this.noise(t, 1.1, { f: 850, f2: 680, q: 5, a: 0.14, hold: 0.3, gain: 0.22 }); },
    glove(t){ this.tone(120, t, 0.14, { f2: 60, gain: 0.7 }); this.noise(t, 0.09, { type: "lowpass", f: 700, gain: 0.5 }); },
    clang(t){
      [[523, 1.1, 0.34], [1308, 0.8, 0.24], [2192, 0.55, 0.17], [3402, 0.32, 0.11]].forEach(([f, d, g]) => this.tone(f, t, d, { a: 0.002, gain: g }));
      this.noise(t, 0.035, { type: "highpass", f: 4000, gain: 0.3 });
    },
    groan(t){ this.noise(t, 1.2, { f: 560, f2: 290, q: 3, a: 0.1, hold: 0.25, gain: 0.4 }); this.noise(t, 1.2, { f: 1150, f2: 700, q: 4, a: 0.1, hold: 0.25, gain: 0.2 }); },
    fanfare(t){
      [523, 659, 784, 1047].forEach((f, i) => {
        const d = i === 3 ? 0.9 : 0.16, at = t + i * 0.12;
        this.tone(f, at, d, { type: "square", gain: 0.07, lp: 3200, hold: i === 3 ? 0.5 : 0 }); this.tone(f, at, d, { type: "triangle", gain: 0.13, hold: i === 3 ? 0.5 : 0 });
      });
      this.S.horn.call(this, t + 0.55);
    },
    pop(t){ this.noise(t, 0.28, { type: "highpass", f: 1100, gain: 0.32 }); for (let i = 0; i < 7; i++) this.noise(t + 0.15 + Math.random() * 0.5, 0.03, { type: "highpass", f: 3500, gain: 0.12 }); },
    chime(t){
      [1319, 1568, 1976, 2637].forEach((f, i) => this.tone(f, t + i * 0.065, 0.6, { type: "triangle", gain: 0.11 }));
      this.tone(880, t, 1.3, { gain: 0.12 }); this.tone(880 * 2.76, t, 0.8, { gain: 0.04 });
    },
    coin(t){ this.tone(988, t, 0.09, { type: "square", gain: 0.08, lp: 4000 }); this.tone(1319, t + 0.08, 0.4, { type: "square", gain: 0.08, lp: 4000 }); },
    tick(t){ this.tone(1800, t, 0.03, { type: "square", gain: 0.05, lp: 5000 }); },
    heart(t){ this.tone(72, t, 0.13, { f2: 48, gain: 0.55 }); this.tone(66, t + 0.19, 0.15, { f2: 44, gain: 0.45 }); },
    sad(t){ [392, 370, 349, 330].forEach((f, i) => this.tone(f, t + i * 0.22, 0.32, { type: "triangle", gain: 0.12, f2: f * 0.97 })); }
  }
};

/* ---------- the crowd (owner yes 13 Nov ~04:50; "replace the clap, use the full viking row in game" ~05:10, preview v8) ----------
   All made in the browser, on the game's own audio (mute, the first-tap rule and a hidden page stop it). During a match: the Viking row from
   each kick-off — strokes of two deep drum hits + the crowd's "HU!", then a long "HOOOH", 7 s apart speeding up to ~1 s, then the roar; a 2 s
   rest; again from the top, to the end of the match (owner ~05:15 "only use this": no last-15-s speed-up, no steady drum). Goals: "Wooo!" +
   roar; the row stops and starts again from the top at the next kick-off. A real near miss: "Ooooh". A win: "Hurrah!". Each stroke is built
   just before it plays.
   Slow phones (lite): 8 "HOOOH" voices, 5 "HU!" voices, 10-voice shouts, no reverb or echo. */
const Crowd = {
  bus: null, verb: null, echoIn: null, drumEcho: null, lite: false, mode: null, timer: 0, pausedAt: 0, rowBus: null,
  ROW: 0.6,   // the row is the crowd's only background
  // gaps = seconds from each stroke to the next; the last is from the last stroke to the roar (measured on the owner's clip; timing only)
  ROW_FULL: [7.0, 6.6, 5.1, 3.6, 2.6, 1.75, 1.65, 1.6, 1.5, 1.55, 1.4, 1.2, 1.0, 1.05, 0.7],
  setup(){
    if (this.bus || !Sfx.ctx || !Sfx.master) return !!this.bus;
    const c = Sfx.ctx; this.bus = c.createGain(); this.bus.gain.value = 1; this.bus.connect(Sfx.master);
    // lite from the start on a slow phone: perf-lite already on, or 4 cores or fewer (review 13 Nov) (Draw is a const: not on window)
    this.lite = (typeof Draw !== "undefined" && !!Draw.st.lite) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
    if (!this.lite){
      // the stadium: a long, dark reverb (2.6 s of decaying noise)
      const len = c.sampleRate * 2.6 | 0, ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++){ const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
      this.verb = c.createConvolver(); this.verb.buffer = ir; const vg = c.createGain(); vg.gain.value = 0.42; this.verb.connect(vg); vg.connect(this.bus);
      // the slapback from the far stands (the "HU!"): ~0.19 s later, darker, twice
      this.echoIn = c.createGain(); const dl = c.createDelay(1), fb = c.createGain(), lp = c.createBiquadFilter(), eg = c.createGain();
      dl.delayTime.value = 0.19; fb.gain.value = 0.38; lp.type = "lowpass"; lp.frequency.value = 1400; eg.gain.value = 0.55;
      this.echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eg); eg.connect(this.bus);
      // the deep drum rolls back from the far stands 0.3 s later, dark, 3–4 times, fading (owner ~05:09 "deep drum with echo")
      this.drumEcho = c.createGain(); const dd = c.createDelay(1), dfb = c.createGain(), dlp = c.createBiquadFilter(), dg = c.createGain();
      dd.delayTime.value = 0.3; dfb.gain.value = 0.45; dlp.type = "lowpass"; dlp.frequency.value = 380; dg.gain.value = 0.75;
      this.drumEcho.connect(dd); dd.connect(dlp); dlp.connect(dfb); dfb.connect(dd); dlp.connect(dg); dg.connect(this.bus); dg.connect(this.verb);
    }
    return true;
  },
  ok(){ return Sfx.ready() && this.setup(); },
  slow(){ if (this.lite) return; this.lite = true;   // perf-lite switched on mid-game: drop the reverb and both echoes
    [this.verb, this.echoIn, this.drumEcho].forEach(n => { try { n && n.disconnect(); } catch (e) { /* gone */ } }); this.verb = this.echoIn = this.drumEcho = null; },
  // a background group (the row, the drum) has its own sends, so stopping it fades its reverb and echo tails too
  sub(level){ const c = Sfx.ctx, g = c.createGain(); g.gain.value = level; g.connect(this.bus);
    if (this.verb){ g.wet = c.createGain(); g.wet.gain.value = level; g.wet.connect(this.verb); }
    if (this.echoIn){ g.echo = c.createGain(); g.echo.gain.value = level; g.echo.connect(this.echoIn); }
    if (this.drumEcho){ g.decho = c.createGain(); g.decho.gain.value = level; g.decho.connect(this.drumEcho); }
    return g; },
  fade(g){ if (!g) return; [g, g.wet, g.echo, g.decho].forEach(n => { if (!n) return; try { const t = Sfx.ctx.currentTime; n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(0.0001, t, 0.04);
    setTimeout(() => { try { n.disconnect(); } catch (e) { /* gone */ } }, 600); } catch (e) { /* gone */ } }); },
  out(node, wet, to){ node.connect(to || this.bus); if (wet && this.verb) node.connect(to && to.wet ? to.wet : this.verb); },
  send(node, key, to){ const tgt = to && to[key] ? to[key] : key === "echo" ? this.echoIn : this.drumEcho; if (tgt) node.connect(tgt); },
  src(t, d){ const s = Sfx.ctx.createBufferSource(); s.buffer = Sfx.noiseBuf; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + d + 0.02); return s; },   // one shared noise buffer
  // one hit of the row: a huge drum (62 → 38 Hz, ringing ~1.2 s) + a short 124 Hz partial phones can play + the soft beater + the crowd's "HU!"
  rowHit(t, v, to){
    const c = Sfx.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(); o.type = "sine"; o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
    lp.type = "lowpass"; lp.frequency.value = 200; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(lp); lp.connect(g); this.out(g, true, to); this.send(g, "decho", to); o.start(t); o.stop(t + 1.25);
    const o2 = c.createOscillator(), g2 = c.createGain(); o2.type = "sine"; o2.frequency.setValueAtTime(124, t); o2.frequency.exponentialRampToValueAtTime(76, t + 0.25);
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.3 * v, t + 0.008); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); o2.connect(g2); this.out(g2, true, to); this.send(g2, "decho", to); o2.start(t); o2.stop(t + 0.3);
    const n = this.src(t, 0.09), nf = c.createBiquadFilter(), ng = c.createGain(); nf.type = "lowpass"; nf.frequency.value = 320;
    ng.gain.setValueAtTime(0.4 * v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); n.connect(nf); nf.connect(ng); this.out(ng, true, to); this.send(ng, "decho", to);
    const bus = c.createGain(); bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(0.34 * v, t + 0.02); bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain(); f1.type = "bandpass"; f1.frequency.value = 350; f1.Q.value = 3; f2.type = "bandpass"; f2.frequency.value = 900; f2.Q.value = 4;
    bus.connect(f1); f1.connect(mix); bus.connect(f2); f2.connect(mix); this.out(mix, true, to); this.send(mix, "echo", to);
    for (let k = 0; k < (this.lite ? 5 : 9); k++){ const s = t + Math.random() * 0.03, os = c.createOscillator(), p = 90 + Math.random() * 35; os.type = "sawtooth";   // "HU!"
      os.frequency.setValueAtTime(p * 1.05, s); os.frequency.exponentialRampToValueAtTime(p * 0.9, s + 0.28); os.connect(bus); os.start(s); os.stop(s + 0.32); }
  },
  rowStroke(t, v, pair, voiceDur, to){   // two hits, then the crowd pulls: "HOOOH"
    this.rowHit(t, v, to); this.rowHit(t + pair, Math.min(1, v * 1.1), to);
    if (voiceDur > 0.25){ const d = voiceDur; this.voices([{ at: 0, vowel: "o", dur: d * 0.45, pitch: 1.25 }, { at: d * 0.45, vowel: "u", dur: d * 0.55, pitch: 1.4 }], 0.8 * v, this.lite ? 8 : 20, t + pair + 0.1, to); }
  },
  roar(at, to){ if (!this.ok()) return; const c = Sfx.ctx, t = at || c.currentTime, n = this.src(t, 3), f = c.createBiquadFilter(), g = c.createGain(); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3); n.connect(f); f.connect(g); this.out(g, true, to); },
  // a crowd of voices: buzzing "voices" (sawtooth), each its own pitch, wobble and start, through vowel filters that glide (hu → RAH)
  VOWEL: { u: [350, 900, 2400], o: [480, 820, 2500], a: [760, 1180, 2550], e: [530, 1850, 2500] },
  voices(plan, v, count, at, to){
    if (!this.ok()) return 0;
    const c = Sfx.ctx, t0 = (at || c.currentTime) + 0.03, n0 = this.lite ? Math.min(count, 10) : count;
    const f = [0, 1, 2].map(i => { const b = c.createBiquadFilter(); b.type = "bandpass"; b.Q.value = [6, 9, 12][i]; const g = c.createGain(); g.gain.value = [1, 0.7, 0.35][i] * v; b.connect(g); this.out(g, true, to); return b; });
    plan.forEach(st => { const F = this.VOWEL[st.vowel]; f.forEach((b, i) => b.frequency.setTargetAtTime(F[i], t0 + st.at, 0.03)); });
    const last = plan[plan.length - 1], end = t0 + last.at + last.dur;
    for (let k = 0; k < n0; k++){
      const woman = k % 3 === 0, p = woman ? 200 + Math.random() * 90 : 105 + Math.random() * 60, jit = Math.random() * 0.09;
      const o = c.createOscillator(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(p * 0.92, t0 + jit);
      plan.forEach(st => { if (st.pitch) o.frequency.linearRampToValueAtTime(p * st.pitch, t0 + st.at + jit + st.dur * 0.5); });
      vib.frequency.value = 4 + Math.random() * 3; vg.gain.value = p * 0.025; vib.connect(vg); vg.connect(o.frequency);
      const lv = 0.06 * Math.sqrt(count / n0);   // fewer voices on a slow phone, about as loud
      g.gain.setValueAtTime(0.0001, t0 + jit); g.gain.exponentialRampToValueAtTime(lv, t0 + jit + 0.06);
      g.gain.setValueAtTime(lv, end - 0.15 + jit * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.25 + jit);
      o.connect(g); f.forEach(b => g.connect(b)); o.start(t0 + jit); vib.start(t0 + jit); o.stop(end + 0.3 + jit); vib.stop(end + 0.3 + jit);
    }
    const n = this.src(t0, end - t0 + 0.3), ng = c.createGain();   // the rasp of many throats, through the same vowels
    ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.18 * v, t0 + 0.08); ng.gain.exponentialRampToValueAtTime(0.0001, end + 0.25); n.connect(ng); f.forEach(b => ng.connect(b));
    return n0;
  },
  hurrah(){ return this.voices([{ at: 0, vowel: "u", dur: 0.18, pitch: 1 }, { at: 0.2, vowel: "a", dur: 0.75, pitch: 1.25 }], 1, 24); },
  wooo(){ const n = this.voices([{ at: 0, vowel: "u", dur: 0.3, pitch: 1.1 }, { at: 0.3, vowel: "o", dur: 1.5, pitch: 1.45 }], 1, 28); this.roar(); return n; },
  oooh(){ return this.voices([{ at: 0, vowel: "o", dur: 0.4, pitch: 1.15 }, { at: 0.4, vowel: "u", dur: 0.7, pitch: 0.8 }], 0.9, 22); },
  /* the match */
  start(){ this.mode = "row"; this.pausedAt = 0; this.run(); },                    // the first kick-off of a match
  pause(){ this.halt(); this.pausedAt = Date.now(); },                            // a goal: the cheer has the stage
  stop(){ this.halt(); this.mode = null; this.pausedAt = 0; },                    // the end, leaving, a new match
  halt(){ clearTimeout(this.timer); this.timer = 0; this.fade(this.rowBus); this.rowBus = null; },   // mute, a hidden page
  // a kick-off (or coming back to the page / unmuting): the full row from the top, at least 2 s after a goal
  run(){
    if (!this.mode || !this.ok()) return;
    clearTimeout(this.timer); const wait = this.pausedAt ? Math.max(0, 2000 - (Date.now() - this.pausedAt)) : 0;
    this.timer = setTimeout(() => {
      if (!this.mode || !this.ok()) return; this.halt(); this.pausedAt = 0;
      this.rowBus = this.sub(this.ROW); this.rowRun(this.ROW_FULL);
    }, wait);
  },
  rowRun(gaps){   // build each stroke just before it plays (look-ahead 0.25 s); the roar after the last gap, a 2 s rest, then again
    const bus = this.rowBus; if (!bus || !gaps.length) return;
    let i = 0, t = Sfx.ctx.currentTime + 0.1;
    const next = () => {
      if (this.rowBus !== bus || !this.ok()) return;
      const g = gaps[i], pair = Math.min(0.41, Math.max(0.28, 0.28 + (g - 1) * 0.18)), v = Math.min(1, 0.7 + i * 0.025);
      this.rowStroke(t, v, pair, Math.min(1.3, g - pair - 0.35), bus); i++; t += g;
      if (i >= gaps.length){   // the roar (3 s); then a 2 s rest and the row again from the top
        this.timer = setTimeout(() => { if (this.rowBus !== bus) return; this.roar(t, bus);
          this.timer = setTimeout(() => { if (this.rowBus === bus) this.rowRun(this.ROW_FULL); }, 3000 + 2000); }, Math.max(0, (t - Sfx.ctx.currentTime - 0.25) * 1000));
        return;
      }
      this.timer = setTimeout(next, Math.max(0, (t - Sfx.ctx.currentTime - 0.25) * 1000));
    };
    this.timer = setTimeout(next, Math.max(0, (t - Sfx.ctx.currentTime - 0.25) * 1000));
  }
};
