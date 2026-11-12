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
