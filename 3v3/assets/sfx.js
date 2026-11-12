/* Gotcha Shootout 3v3 — sounds made in the browser (Web Audio, no files), from the penalty game's assets/core.js. Silent until the first tap
   (browser rule; iOS needs the unlock inside a tap). On/off is remembered as s3v3:sound. A sound never breaks the game. */
"use strict";
const Sfx = {
  ctx: null, master: null, noiseBuf: null, on: true,
  init(){ const v = Net.Store.get("s3v3:sound"); this.on = v === null ? true : !!v; },
  unlock(){
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
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
  setOn(v){ this.on = !!v; Net.Store.set("s3v3:sound", this.on); if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.05); },
  ready(){ return !!(this.ctx && this.on && this.ctx.state === "running"); },
  env(g, t, a, peak, hold, rel){
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  },
  tone(f, t, dur, o){
    o = o || {}; const c = this.ctx, osc = c.createOscillator(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    let node = osc;
    if (o.lp){ const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.lp; osc.connect(lp); node = lp; }
    this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    node.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + dur + 0.05);
  },
  noise(t, dur, o){
    o = o || {}; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), a = o.a || 0.005, hold = o.hold || 0;
    s.buffer = this.noiseBuf; s.loop = true; f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.bend || dur));
    f.Q.value = o.q || 1; this.env(g, t, a, o.gain || 0.3, hold, Math.max(0.02, dur - a - hold));
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  },
  play(name, arg){ if (!this.ready()) return; const fn = this.S[name]; if (!fn) return; try { fn.call(this, this.ctx.currentTime + 0.01, arg); } catch (e) { /* never breaks the game */ } },
  S: {
    tap(t){ this.tone(700, t, 0.08, { f2: 460, type: "triangle", gain: 0.14 }); },
    tick(t){ this.tone(1800, t, 0.03, { type: "square", gain: 0.05, lp: 5000 }); },
    whistle(t){ [[0, 0.16], [0.24, 0.46]].forEach(([d0, d]) => { this.tone(2950, t + d0, d, { gain: 0.12, hold: d - 0.07 }); this.noise(t + d0, d, { type: "highpass", f: 3500, gain: 0.03 }); }); },
    kick(t, p){ p = p || 0.6; this.tone(150, t, 0.2, { f2: 42, gain: 0.5 + 0.45 * p }); this.noise(t, 0.05, { type: "highpass", f: 1800, gain: 0.25 * p }); },
    wall(t){ this.tone(320, t, 0.06, { type: "square", gain: 0.05, lp: 2000 }); },
    clang(t){ [[523, 1.1, 0.34], [1308, 0.8, 0.24], [2192, 0.55, 0.17]].forEach(([f, d, g]) => this.tone(f, t, d, { a: 0.002, gain: g })); this.noise(t, 0.035, { type: "highpass", f: 4000, gain: 0.3 }); },
    roar(t){ [[420, 0.7], [900, 0.95], [1700, 0.6]].forEach(([f, k]) => this.noise(t, 2.4, { type: "bandpass", f: f * 0.8, f2: f * 1.15, bend: 0.7, q: 0.9, a: 0.16, hold: 0.9, gain: 0.28 * k })); },
    fanfare(t){ [523, 659, 784, 1047].forEach((f, i) => { const d = i === 3 ? 0.9 : 0.16; this.tone(f, t + i * 0.12, d, { type: "triangle", gain: 0.15, hold: i === 3 ? 0.5 : 0 }); }); },
    groan(t){ this.noise(t, 1.2, { f: 560, f2: 290, q: 3, a: 0.1, hold: 0.25, gain: 0.4 }); },
    sad(t){ [392, 370, 349, 330].forEach((f, i) => this.tone(f, t + i * 0.22, 0.32, { type: "triangle", gain: 0.12, f2: f * 0.97 })); }
  }
};
