// Generated sound: engine, surf, sliding sand, beeps. No audio files needed.
export class Sound {
  constructor(muted) { this.muted = muted; this.ctx = null; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(ctx.destination);
    // engine: two detuned oscillators through a low-pass filter
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 500; this.lp.Q.value = 3;
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.o1.connect(this.lp); this.o2.connect(g2).connect(this.lp); this.lp.connect(this.eng).connect(this.master);
    this.o1.start(); this.o2.start();
    // noise for surf + sliding
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const surfF = ctx.createBiquadFilter(); surfF.type = 'lowpass'; surfF.frequency.value = 900;
    this.surf = ctx.createGain(); this.surf.gain.value = 0;
    src.connect(surfF).connect(this.surf).connect(this.master);
    const slideF = ctx.createBiquadFilter(); slideF.type = 'bandpass'; slideF.frequency.value = 1800; slideF.Q.value = 0.7;
    this.slide = ctx.createGain(); this.slide.gain.value = 0;
    src.connect(slideF).connect(this.slide).connect(this.master);
    src.start();
  }
  update(k) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, rpm = Math.min(1.2, Math.abs(k.speed) / k.top);
    const f = 55 + rpm * 130 + k.throttle * 12 + (k.boosting ? 30 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.06); this.o2.frequency.setTargetAtTime(f * 0.501, t, 0.06);
    this.lp.frequency.setTargetAtTime(350 + 1500 * Math.max(k.throttle, rpm * 0.6), t, 0.08);
    this.eng.gain.setTargetAtTime(0.07 + 0.09 * k.throttle + 0.04 * rpm, t, 0.1);
    const waves = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23);
    this.surf.gain.setTargetAtTime(0.05 + 0.4 * Math.max(0, 1 - k.shore / 90) * (0.4 + 0.6 * waves), t, 0.3);
    this.slide.gain.setTargetAtTime(k.loose ? Math.min(0.25, Math.abs(k.speed) / 60 + k.slip / 20) : Math.min(0.15, k.slip / 25), t, 0.08);
  }
  beep(freq, dur = 0.18) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7; }
}
