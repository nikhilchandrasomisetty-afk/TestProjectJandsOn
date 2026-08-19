// All sound is synthesized with the Web Audio API — no audio files ship with
// the game. Each material gets its own filter and envelope shape so breaking
// stone reads differently from breaking leaves.

const MATERIALS = {
  hard: { type: "noise", filter: "lowpass", freq: 1500, q: 1.4, decay: 0.16, gain: 0.30 },
  soft: { type: "noise", filter: "lowpass", freq: 620, q: 0.9, decay: 0.14, gain: 0.26 },
  wood: { type: "noise", filter: "bandpass", freq: 900, q: 2.4, decay: 0.15, gain: 0.30 },
  glass: { type: "noise", filter: "highpass", freq: 2600, q: 1.1, decay: 0.22, gain: 0.22 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
  }

  // Must be called from a user gesture or the context stays suspended.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      this.enabled = false;
      return null;
    }
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.enabled = false;
    }
    return this.ctx;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Fade the noise across the buffer so the tail never clicks.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }

  _burst(spec, pitch = 1, gainScale = 1) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer(spec.decay);
    source.playbackRate.value = pitch;

    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.value = spec.freq * pitch;
    filter.Q.value = spec.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(spec.gain * gainScale, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + spec.decay);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + spec.decay + 0.02);
  }

  _tone(freq, duration, { type = "sine", gain = 0.16, slideTo = null } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _materialOf(name) {
    return MATERIALS[name] ?? MATERIALS.hard;
  }

  playBreak(sound) {
    const spec = this._materialOf(sound);
    this._burst(spec, 0.85 + Math.random() * 0.3, 1);
  }

  playPlace(sound) {
    const spec = this._materialOf(sound);
    this._burst(spec, 1.25 + Math.random() * 0.25, 0.7);
  }

  playStep(sound) {
    const spec = this._materialOf(sound);
    this._burst(spec, 0.7 + Math.random() * 0.2, 0.22);
  }

  playMineTick(sound) {
    const spec = this._materialOf(sound);
    this._burst(spec, 1.6 + Math.random() * 0.3, 0.13);
  }

  playHurt() {
    this._tone(320, 0.24, { type: "square", gain: 0.14, slideTo: 130 });
  }

  playDeath() {
    this._tone(220, 0.9, { type: "triangle", gain: 0.18, slideTo: 60 });
  }

  playSplash() {
    this._burst({ filter: "lowpass", freq: 900, q: 0.8, decay: 0.35, gain: 0.24 }, 1, 1);
  }

  playPickup() {
    this._tone(880, 0.1, { type: "sine", gain: 0.1, slideTo: 1320 });
  }

  playCraft() {
    this._tone(520, 0.09, { type: "triangle", gain: 0.12 });
    setTimeout(() => this._tone(780, 0.12, { type: "triangle", gain: 0.12 }), 90);
  }
}
