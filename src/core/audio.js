import { smoothstep, clamp, lerp } from './noise.js';

// Procedural soundscape: wind, river, tyres, freewheel, bell, birds, crickets and a sparse koto melody.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.birdTimer = 2;
    this.noteTimer = 3;
    this.phrase = [];
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // reverb for bell and music
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.45;
    this.reverb.connect(revGain).connect(master);

    this.noise = this.noiseBuffer(2);
    // wind
    this.wind = this.loopNoise([
      ['highpass', 90, 0.5],
      ['lowpass', 900, 0.7],
    ]);
    // river
    this.river = this.loopNoise([
      ['bandpass', 700, 0.5],
      ['lowpass', 2200, 0.5],
    ]);
    // tyre roll on asphalt and grass swish
    this.tyre = this.loopNoise([
      ['bandpass', 230, 1.2],
      ['lowpass', 900, 0.7],
    ]);
    this.grass = this.loopNoise([
      ['highpass', 2200, 0.6],
      ['lowpass', 7000, 0.6],
    ]);
    // freewheel ticking: a looped click train with variable playback rate
    this.tick = this.makeTicker();
    // crickets at night
    this.crickets = this.makeCrickets();

    // koto notes (Karplus-Strong), hirajoshi scale on D
    const freqs = [146.83, 164.81, 174.61, 220.0, 233.08, 293.66, 329.63, 349.23, 440.0, 466.16, 587.33];
    this.koto = freqs.map((f) => this.pluck(f, 3.2));
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(master);
    this.musicGain.connect(this.reverb);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(master);
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  noiseBuffer(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // a touch of pink
      d[i] = w * 0.6 + b * 2.5;
    }
    return buf;
  }

  loopNoise(filters) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    let node = src;
    const fl = [];
    for (const [type, f, q] of filters) {
      const bf = ctx.createBiquadFilter();
      bf.type = type;
      bf.frequency.value = f;
      bf.Q.value = q;
      node.connect(bf);
      node = bf;
      fl.push(bf);
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g).connect(this.master);
    src.start();
    return { src, gain: g, filters: fl };
  }

  makeTicker() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr, sr);
    const d = buf.getChannelData(0);
    const clicks = 30;
    for (let k = 0; k < clicks; k++) {
      const s = Math.floor((k / clicks) * sr);
      for (let i = 0; i < 220; i++) d[s + i] += (Math.random() * 2 - 1) * Math.exp(-i / 28) * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp).connect(g).connect(this.master);
    src.start();
    return { src, gain: g };
  }

  makeCrickets() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = 4400;
    const am = ctx.createOscillator();
    am.frequency.value = 28;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.5;
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 1.6;
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    const carrierGain = ctx.createGain();
    carrierGain.gain.value = 0.5;
    am.connect(amGain).connect(carrierGain.gain);
    pulse.connect(pulseGain).connect(carrierGain.gain);
    osc.connect(carrierGain).connect(g).connect(this.master);
    osc.start();
    am.start();
    pulse.start();
    return { gain: g };
  }

  pluck(freq, sec) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * sec);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const N = Math.round(sr / freq);
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    const decay = 0.996;
    for (let i = 0; i < len; i++) {
      const a = ring[idx];
      const b = ring[(idx + 1) % N];
      const v = 0.5 * (a + b) * decay;
      ring[idx] = v;
      d[i] = a * (i < 40 ? i / 40 : 1);
      idx = (idx + 1) % N;
    }
    return buf;
  }

  playNote(i, when = 0, vel = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.koto[i];
    const g = ctx.createGain();
    g.gain.value = 0.55 * vel;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = (Math.random() - 0.5) * 0.6;
    src.connect(g);
    if (pan) g.connect(pan).connect(this.musicGain);
    else g.connect(this.musicGain);
    src.start(ctx.currentTime + when);
  }

  bell() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const strike = (t0) => {
      const partials = [
        [2200, 1.0, 1.4],
        [5980, 0.45, 0.6],
        [3350, 0.35, 0.9],
        [8900, 0.18, 0.3],
      ];
      for (const [f, a, dec] of partials) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.16 * a, t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
        o.connect(g);
        g.connect(this.sfx);
        g.connect(this.reverb);
        o.start(t0);
        o.stop(t0 + dec + 0.05);
      }
    };
    const t = ctx.currentTime;
    strike(t);
    strike(t + 0.17);
  }

  bump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + 0.3);
  }

  chirp(night) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 0.06 + Math.random() * 0.05;
    if (pan) {
      pan.pan.value = Math.random() * 2 - 1;
      out.connect(pan).connect(this.master);
    } else out.connect(this.master);
    out.connect(this.reverb);
    const t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 5);
    const base = 2600 + Math.random() * 2600;
    const kind = Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const t = t0 + k * (0.09 + Math.random() * 0.12);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const f0 = base * (kind === 0 ? 1 : 1.2 - k * 0.04);
      o.frequency.setValueAtTime(f0, t);
      if (kind === 1) o.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.07);
      else o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.08);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  update(dt, s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const set = (node, v, tc = 0.15) => node.gain.gain.setTargetAtTime(v, t, tc);
    const v = s.speed;
    set(this.wind, 0.025 + clamp(v * v * 0.0022, 0, 0.35));
    this.wind.filters[1].frequency.setTargetAtTime(500 + v * 90, t, 0.3);
    set(this.river, 0.3 * smoothstep(45, 6, s.waterDist) * (1 - s.night * 0.3));
    const roll = smoothstep(0.2, 6, v);
    set(this.tyre, s.surface === 'grass' ? roll * 0.1 : s.surface === 'wood' ? roll * 0.2 : roll * 0.09);
    this.tyre.filters[0].frequency.setTargetAtTime(s.surface === 'wood' ? 140 : s.surface === 'gravel' ? 420 : 230 + v * 8, t, 0.2);
    set(this.grass, s.surface === 'grass' ? roll * 0.08 : s.surface === 'gravel' ? roll * 0.06 : 0);
    const coasting = s.pedaling < 0.3 && v > 0.6;
    set(this.tick, coasting ? 0.22 : 0, 0.05);
    const wheelRps = v / (2 * Math.PI * 0.34);
    this.tick.src.playbackRate.setTargetAtTime(clamp((wheelRps * 24) / 30, 0.1, 6), t, 0.1);
    set(this.crickets, 0.012 * s.night);

    // birds by day
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.5 + Math.random() * 5;
      if (s.night < 0.5) this.chirp(false);
    }
    // sparse koto phrases
    if (this.musicOn && !this.muted) {
      this.noteTimer -= dt;
      if (this.noteTimer <= 0) {
        if (!this.phrase.length) {
          // build a short phrase walking the scale
          let i = 3 + Math.floor(Math.random() * 5);
          const len = 3 + Math.floor(Math.random() * 4);
          for (let k = 0; k < len; k++) {
            this.phrase.push(i);
            i = clamp(i + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)), 0, this.koto.length - 1);
          }
          this.noteTimer = 3 + Math.random() * 5;
        } else {
          const n = this.phrase.shift();
          this.playNote(n, 0, 0.7 + Math.random() * 0.3);
          if (Math.random() < 0.25) this.playNote(Math.max(0, n - 3), 0.02, 0.4);
          this.noteTimer = this.phrase.length ? 0.35 + Math.random() * 0.6 : 5 + Math.random() * 6;
        }
      }
    }
  }
}
