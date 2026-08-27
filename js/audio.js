// Tiny WebAudio synth. Every sound is generated from oscillators and noise at
// runtime — there are no sampled or third-party audio assets in this project.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch { this.enabled = false; }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _noiseBuffer(duration) {
    const n = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return buf;
  }

  thud(freq = 180, duration = 0.14, type = 'square', gain = 0.5) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.55), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  crunch(duration = 0.12, gain = 0.35, filterHz = 1400) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t);
  }

  blip(freq = 660, duration = 0.08, gain = 0.25) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  // Named game events
  breakBlock(blockId) { this.crunch(0.16, 0.34, 900 + (blockId % 7) * 220); }
  placeBlock() { this.thud(220, 0.1, 'square', 0.35); }
  step() { this.crunch(0.06, 0.1, 520); }
  hurt() { this.thud(150, 0.26, 'sawtooth', 0.42); }
  hit() { this.thud(320, 0.09, 'square', 0.4); }
  craft() { this.blip(520, 0.07, 0.22); setTimeout(() => this.blip(780, 0.09, 0.22), 70); }
  pickup() { this.blip(880, 0.06, 0.16); }
  click() { this.blip(440, 0.045, 0.14); }
  splash() { this.crunch(0.3, 0.28, 420); }
  die() { this.thud(200, 0.7, 'sawtooth', 0.5); setTimeout(() => this.thud(110, 0.9, 'sine', 0.45), 180); }
}
