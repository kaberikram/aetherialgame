import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';

/**
 * AudioSystem — every sound in the chapter, synthesised in code.
 *
 * Owns: the AudioContext, the per-zone reverb, the listener, and the voice
 * pool. Exposes nothing but its event subscriptions.
 * Forbidden: knowing why a sound fired. Forty call sites already emit
 * `EVENTS.SFX` with an id and a world position; this listens.
 *
 * There are no audio files, for the same reason there are no meshes: D4. Each
 * sound is a small graph of oscillators and filtered noise. That constraint is
 * not as limiting as it sounds — a sword whiff IS filtered noise with a pitch
 * sweep, and a stone footstep IS a short noise burst through a resonant filter.
 *
 * Routing, and why it is shaped this way:
 *
 *   voice → panner → zone reverb send ─┐
 *                  └── dry ────────────┴→ master → destination
 *
 * The pigeon is the deliberate exception. PROJECT.md wants its wing-flaps
 * positional and its speech not, because a voice with no spatial falloff in a
 * body that small is the first thing that is wrong about it. `positional:
 * false` on an SFX event bypasses the panner entirely — that mismatch is a
 * feature and must not be "fixed".
 */

/** Per-zone impulse responses, generated. Matches ZONE_PROFILES.reverb. */
const REVERB = {
  none: { seconds: 0.28, decay: 6.0, wet: 0.04, damp: 0.5 },
  tunnel: { seconds: 1.30, decay: 3.1, wet: 0.24, damp: 0.42 },
  cavern: { seconds: 2.60, decay: 2.0, wet: 0.34, damp: 0.30 },
  chamber: { seconds: 3.40, decay: 1.7, wet: 0.40, damp: 0.22 },
  well: { seconds: 2.20, decay: 2.4, wet: 0.30, damp: 0.34 },
};

const ZONE_REVERB = {
  void: 'none', descent: 'tunnel', greenVein: 'cavern',
  starChamber: 'chamber', pagodaWell: 'well',
};

/**
 * Footstep timbre per surface. `f` is the resonant centre in Hz, `q` its
 * sharpness, `dur` the tail. Wet surfaces ring lower and longer; gravel is a
 * broadband click with almost no tail.
 */
const FOOTSTEPS = {
  gravel: { f: 1500, q: 1.1, dur: 0.075, gain: 0.16, noise: 'white' },
  stone: { f: 900, q: 3.0, dur: 0.11, gain: 0.19, noise: 'white' },
  wetStone: { f: 620, q: 4.5, dur: 0.16, gain: 0.20, noise: 'pink' },
  water: { f: 380, q: 2.0, dur: 0.26, gain: 0.24, noise: 'pink' },
  waterDeep: { f: 230, q: 1.6, dur: 0.42, gain: 0.28, noise: 'pink' },
};

export class AudioSystem {
  /** Runs while paused so the pause menu does not cut a tail mid-decay. */
  updateWhilePaused = true;

  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');
    this.camera = engine.resolve('renderer').camera;

    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._noiseBuffers = {};
    this._impulses = {};
    this._zone = 'void';
    this._lastFoot = 0;

    // Browsers refuse to start an AudioContext before a gesture, and the game
    // already requires a click to capture the pointer. Both are listened for
    // because a gamepad player never clicks.
    this._unlock = () => this.#init();
    window.addEventListener('pointerdown', this._unlock, { once: false });
    window.addEventListener('keydown', this._unlock, { once: false });

    this.bus.on(EVENTS.SFX, (e) => this.#onSfx(e));
    this.bus.on(EVENTS.PLAYER_FOOTSTEP, (e) => this.#onFootstep(e));
    this.bus.on(EVENTS.ZONE_ENTERED, (e) => this.#onZone(e));
    this.bus.on(EVENTS.MUSIC_CUE, (e) => this.#onMusic(e));
    this.bus.on(EVENTS.BOSS_WINDUP, (e) => this.#onSfx({
      id: e.moveId ? `bossTell_${e.moveId}` : 'bossTell', position: null,
    }));
  }

  // ------------------------------------------------------------------ setup

  #init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // Gentle limiting. Several impacts inside one frame is normal in this
    // game, and without it the sum clips into a click that reads as a bug.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;
    this.limiter.connect(this.master);

    this.dry = this.ctx.createGain();
    this.dry.connect(this.limiter);

    this.convolver = this.ctx.createConvolver();
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0;
    this.convolver.connect(this.wet);
    this.wet.connect(this.limiter);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.limiter);

    this.ready = true;
    this.#applyZone(this._zone, 0);
  }

  #noise(kind) {
    if (this._noiseBuffers[kind]) return this._noiseBuffers[kind];
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'pink') {
      // Voss-McCartney. Pink noise reads as "wet" and "heavy" where white
      // reads as "sharp" — the difference between a boot in a puddle and a
      // boot on gravel is mostly spectral tilt, not envelope.
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffers[kind] = buf;
    return buf;
  }

  /**
   * A generated impulse response: exponentially decaying noise with the high
   * end rolling off faster than the low, which is what makes a big stone room
   * sound like stone rather than like a plate.
   */
  #impulse(name) {
    if (this._impulses[name]) return this._impulses[name];
    const p = REVERB[name] ?? REVERB.none;
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * p.seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, p.decay);
        const w = (Math.random() * 2 - 1) * env;
        lp += (w - lp) * (1 - p.damp * t);
        d[i] = lp;
      }
    }
    this._impulses[name] = buf;
    return buf;
  }

  // ------------------------------------------------------------------ zones

  #onZone({ id }) {
    this._zone = id;
    if (this.ready) this.#applyZone(id, 1.2);
  }

  #applyZone(id, seconds) {
    const name = ZONE_REVERB[id] ?? 'none';
    const p = REVERB[name];
    this.convolver.buffer = this.#impulse(name);
    const now = this.ctx.currentTime;
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setValueAtTime(this.wet.gain.value, now);
    this.wet.gain.linearRampToValueAtTime(p.wet, now + Math.max(0.01, seconds));
  }

  // ------------------------------------------------------------- voice graph

  /**
   * Builds the output stage for one sound and returns the node to connect to.
   * Handles the positional/non-positional split and the reverb send.
   */
  out(position, { positional = true, gain = 1, reverbSend = 1 } = {}) {
    const g = this.ctx.createGain();
    g.gain.value = gain;

    if (positional && position) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.maxDistance = 90;
      panner.rolloffFactor = 1.15;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      g.connect(panner);
      panner.connect(this.dry);
      if (reverbSend > 0) {
        const send = this.ctx.createGain();
        send.gain.value = reverbSend;
        panner.connect(send);
        send.connect(this.convolver);
      }
    } else {
      // No panner, no distance law. The pigeon's voice lives here.
      g.connect(this.dry);
      if (reverbSend > 0) {
        const send = this.ctx.createGain();
        send.gain.value = reverbSend * 0.4;
        g.connect(send);
        send.connect(this.convolver);
      }
    }
    return g;
  }

  /** One filtered noise burst — the workhorse behind impacts and footsteps. */
  burst(out, { kind = 'white', freq = 900, q = 2, dur = 0.12, attack = 0.002, type = 'bandpass', sweep = 0 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.#noise(kind);
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    filt.Q.value = q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    src.connect(filt); filt.connect(env); env.connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** One pitched voice — bells, tones, the star, the wing burst. */
  tone(out, { freq = 220, type = 'sine', dur = 0.4, gain = 1, attack = 0.005, glide = 0, detune = 0 }) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    osc.connect(env); env.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ sounds

  #onFootstep({ surface, position }) {
    if (!this.ready || this.muted) return;
    // Both feet can fire within a frame or two when a gait blend crossfades.
    const now = this.ctx.currentTime;
    if (now - this._lastFoot < 0.09) return;
    this._lastFoot = now;

    const s = FOOTSTEPS[surface] ?? FOOTSTEPS.stone;
    const out = this.out(position, { gain: s.gain, reverbSend: 0.5 });
    this.burst(out, { kind: s.noise, freq: s.f * (0.9 + Math.random() * 0.2), q: s.q, dur: s.dur });
    if (surface === 'water' || surface === 'waterDeep') {
      this.burst(out, { kind: 'pink', freq: 1800, q: 0.8, dur: s.dur * 1.6, type: 'lowpass', sweep: 0.25 });
    }
  }

  #onSfx({ id, position = null, positional = true, gain = 1 }) {
    if (!this.ready || this.muted) return;
    const make = SOUNDS[id] ?? SOUNDS[id?.replace(/^bossTell_.*/, 'bossTell')];
    if (!make) return;
    make(this, position, { positional, gain });
  }

  #onMusic({ id }) {
    if (!this.ready || this.muted) return;
    // Not music in the streamed sense — a sustained drone whose interval and
    // brightness change with the beat. A boss phase is a fifth below the
    // approach; the wing choice resolves it.
    const beds = {
      bossPhase1: { root: 55, fifth: 82.5, gain: 0.05 },
      bossPhase2: { root: 49, fifth: 73.5, gain: 0.075 },
      bossTransition: { root: 41, fifth: 61.5, gain: 0.09 },
      bossDefeated: { root: 65.4, fifth: 98, gain: 0.035 },
      wingChoice: { root: 73.4, fifth: 110, gain: 0.05 },
      wingsLight: { root: 98, fifth: 147, gain: 0.055 },
      wingsDark: { root: 43.7, fifth: 65.4, gain: 0.065 },
      respawn: { root: 0, fifth: 0, gain: 0 },
    };
    const bed = beds[id];
    if (!bed) return;
    this.#setDrone(bed);
  }

  #setDrone({ root, fifth, gain }) {
    const t = this.ctx.currentTime;
    if (this._drone) {
      this._drone.gain.gain.cancelScheduledValues(t);
      this._drone.gain.gain.setValueAtTime(this._drone.gain.gain.value, t);
      this._drone.gain.gain.linearRampToValueAtTime(0, t + 1.6);
      const old = this._drone;
      setTimeout(() => old.oscs.forEach((o) => o.stop()), 1900);
      this._drone = null;
    }
    if (!root || gain <= 0) return;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 2.4);
    g.connect(this.musicBus);
    this.musicBus.gain.setTargetAtTime(1, t, 0.5);

    const oscs = [];
    for (const [f, type, det] of [[root, 'sine', 0], [root, 'triangle', -7], [fifth, 'sine', 5]]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      oscs.push(o);
    }
    this._drone = { gain: g, oscs };
  }

  // -------------------------------------------------------------------- loop

  update() {
    if (!this.ready) return;
    // The listener rides the camera, not the player. The player hears what the
    // view hears, which is what makes lock-on circling read correctly.
    const l = this.ctx.listener;
    const p = this.camera.getWorldPosition(_v);
    const q = this.camera.getWorldDirection(_f);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = q.x; l.forwardY.value = q.y; l.forwardZ.value = q.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(q.x, q.y, q.z, 0, 1, 0);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.value = m ? 0 : 0.85;
  }

  dispose() {
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    this.ctx?.close();
  }
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

/**
 * The sound table. Each entry builds one sound from the primitives above.
 *
 * Read these as recipes rather than as parameters: a deflect is a hard metal
 * transient plus a rising bell, because that is what the player has to hear
 * differently from a block inside a 100ms window.
 */
const SOUNDS = {
  // ---- combat
  hit: (a, p) => {
    const g = a.out(p, { gain: 0.5 });
    a.burst(g, { kind: 'white', freq: 2600, q: 1.4, dur: 0.06, sweep: 0.3 });
    a.burst(g, { kind: 'pink', freq: 320, q: 2.2, dur: 0.14 });
  },
  hitHeavy: (a, p) => {
    const g = a.out(p, { gain: 0.72 });
    a.burst(g, { kind: 'white', freq: 3200, q: 1.2, dur: 0.09, sweep: 0.22 });
    a.burst(g, { kind: 'pink', freq: 190, q: 2.6, dur: 0.30 });
    a.tone(g, { freq: 96, type: 'triangle', dur: 0.26, gain: 0.5, glide: 0.6 });
  },
  critical: (a, p) => {
    const g = a.out(p, { gain: 0.9 });
    a.burst(g, { kind: 'white', freq: 4200, q: 0.9, dur: 0.13, sweep: 0.12 });
    a.tone(g, { freq: 132, type: 'sawtooth', dur: 0.44, gain: 0.34, glide: 0.35 });
  },
  whiff: (a, p) => {
    // A swing through air is a band of noise sweeping DOWN as it passes.
    const g = a.out(p, { gain: 0.30, reverbSend: 0.35 });
    a.burst(g, { kind: 'white', freq: 1700, q: 0.7, dur: 0.19, attack: 0.05, sweep: 0.35 });
  },
  guard: (a, p) => {
    const g = a.out(p, { gain: 0.55 });
    a.burst(g, { kind: 'white', freq: 1400, q: 3.5, dur: 0.10 });
    a.tone(g, { freq: 174, type: 'triangle', dur: 0.16, gain: 0.3 });
  },
  /** The reward sound. Brighter, longer and pitched UP, so it is unmistakable. */
  deflect: (a, p) => {
    const g = a.out(p, { gain: 0.8 });
    a.burst(g, { kind: 'white', freq: 5200, q: 1.0, dur: 0.07 });
    a.tone(g, { freq: 880, type: 'sine', dur: 0.62, gain: 0.28, glide: 1.5 });
    a.tone(g, { freq: 1320, type: 'sine', dur: 0.48, gain: 0.16, glide: 1.5, detune: 6 });
  },
  guardBreak: (a, p) => {
    const g = a.out(p, { gain: 0.85 });
    a.burst(g, { kind: 'white', freq: 900, q: 0.8, dur: 0.34, sweep: 0.2 });
    a.tone(g, { freq: 82, type: 'sawtooth', dur: 0.5, gain: 0.4, glide: 0.5 });
  },
  stagger: (a, p) => {
    const g = a.out(p, { gain: 0.5 });
    a.burst(g, { kind: 'pink', freq: 260, q: 1.6, dur: 0.34, sweep: 0.5 });
  },

  // ---- the body
  breath: (a, p) => a.burst(a.out(p, { gain: 0.14, reverbSend: 0.3 }),
    { kind: 'pink', freq: 700, q: 0.8, dur: 0.5, attack: 0.12, type: 'lowpass' }),
  roll: (a, p) => a.burst(a.out(p, { gain: 0.30 }),
    { kind: 'pink', freq: 500, q: 1.1, dur: 0.30, attack: 0.03, sweep: 0.5 }),
  land: (a, p) => a.burst(a.out(p, { gain: 0.34 }),
    { kind: 'pink', freq: 400, q: 2.0, dur: 0.16 }),
  landHard: (a, p) => {
    const g = a.out(p, { gain: 0.6 });
    a.burst(g, { kind: 'pink', freq: 240, q: 2.4, dur: 0.28 });
    a.tone(g, { freq: 62, type: 'sine', dur: 0.34, gain: 0.5, glide: 0.7 });
  },
  scrape: (a, p) => a.burst(a.out(p, { gain: 0.22 }),
    { kind: 'white', freq: 2400, q: 0.6, dur: 0.22, attack: 0.06, sweep: 0.6 }),
  stumble: (a, p) => a.burst(a.out(p, { gain: 0.28 }),
    { kind: 'pink', freq: 330, q: 1.4, dur: 0.24 }),
  death: (a, p) => {
    const g = a.out(p, { gain: 0.7, reverbSend: 1.4 });
    a.tone(g, { freq: 110, type: 'sine', dur: 2.4, gain: 0.34, glide: 0.35, attack: 0.02 });
    a.burst(g, { kind: 'pink', freq: 600, q: 0.9, dur: 1.6, attack: 0.05, sweep: 0.2 });
  },
  uncork: (a, p) => a.burst(a.out(p, { gain: 0.4 }),
    { kind: 'white', freq: 1100, q: 6, dur: 0.07 }),
  recover: (a, p) => {
    const g = a.out(p, { positional: false, gain: 0.4 });
    a.tone(g, { freq: 392, type: 'sine', dur: 0.9, gain: 0.22, glide: 1.25 });
  },
  rest: (a, p) => {
    const g = a.out(p, { gain: 0.5, reverbSend: 1.6 });
    a.tone(g, { freq: 196, type: 'sine', dur: 2.6, gain: 0.24, attack: 0.3 });
    a.tone(g, { freq: 294, type: 'sine', dur: 2.0, gain: 0.14, attack: 0.5, detune: 4 });
  },
  pickup: (a, p) => {
    const g = a.out(p, { gain: 0.45 });
    a.tone(g, { freq: 523, type: 'triangle', dur: 0.5, gain: 0.2, glide: 1.2 });
  },

  // ---- alignment
  darkDash: (a, p) => {
    const g = a.out(p, { gain: 0.6 });
    a.burst(g, { kind: 'pink', freq: 1400, q: 0.8, dur: 0.3, sweep: 0.12 });
    a.tone(g, { freq: 73, type: 'sawtooth', dur: 0.34, gain: 0.32, glide: 0.6 });
  },
  wingBurst: (a) => {
    // Non-positional: it happens to the player, not near them.
    const g = a.out(null, { positional: false, gain: 1.0, reverbSend: 2.0 });
    a.burst(g, { kind: 'white', freq: 900, q: 0.5, dur: 1.4, attack: 0.02, sweep: 4.0 });
    a.tone(g, { freq: 147, type: 'sawtooth', dur: 1.8, gain: 0.3, glide: 2.0, attack: 0.05 });
    a.tone(g, { freq: 441, type: 'sine', dur: 2.2, gain: 0.18, glide: 2.0, attack: 0.2 });
  },
  flap: (a, p) => a.burst(a.out(p, { gain: 0.34 }),
    { kind: 'pink', freq: 220, q: 1.2, dur: 0.26, attack: 0.04, sweep: 2.2, type: 'lowpass' }),

  // ---- the world
  embodiment: (a) => {
    const g = a.out(null, { positional: false, gain: 1.0, reverbSend: 0.6 });
    a.tone(g, { freq: 55, type: 'sine', dur: 3.4, gain: 0.4, glide: 1.8, attack: 0.6 });
    a.burst(g, { kind: 'pink', freq: 300, q: 0.7, dur: 2.6, attack: 0.8, type: 'lowpass', sweep: 2.5 });
  },
  fogGate: (a, p) => {
    const g = a.out(p, { gain: 0.5, reverbSend: 1.5 });
    a.burst(g, { kind: 'pink', freq: 500, q: 0.6, dur: 1.8, attack: 0.4, sweep: 0.4 });
  },
  waterBurst: (a, p) => {
    const g = a.out(p, { gain: 0.85 });
    a.burst(g, { kind: 'pink', freq: 2200, q: 0.7, dur: 0.7, sweep: 0.12 });
    a.tone(g, { freq: 88, type: 'sine', dur: 0.6, gain: 0.4, glide: 0.6 });
  },
  bossSurface: (a, p) => {
    const g = a.out(p, { gain: 0.9, reverbSend: 1.4 });
    a.burst(g, { kind: 'pink', freq: 1600, q: 0.6, dur: 1.1, sweep: 0.1 });
    a.tone(g, { freq: 49, type: 'sawtooth', dur: 1.2, gain: 0.4, glide: 0.7 });
  },
  bossRise: (a, p) => {
    const g = a.out(p, { gain: 1.0, reverbSend: 1.6 });
    a.tone(g, { freq: 41, type: 'sawtooth', dur: 2.2, gain: 0.45, glide: 1.6, attack: 0.3 });
    a.burst(g, { kind: 'pink', freq: 700, q: 0.5, dur: 2.0, attack: 0.4, sweep: 0.3 });
  },
  bossStagger: (a, p) => {
    const g = a.out(p, { gain: 0.8 });
    a.burst(g, { kind: 'pink', freq: 340, q: 1.4, dur: 0.6, sweep: 0.4 });
    a.tone(g, { freq: 65, type: 'triangle', dur: 0.5, gain: 0.34, glide: 0.6 });
  },
  bossDeath: (a, p) => {
    const g = a.out(p, { gain: 1.0, reverbSend: 2.2 });
    a.tone(g, { freq: 44, type: 'sawtooth', dur: 4.0, gain: 0.5, glide: 0.4, attack: 0.1 });
    a.burst(g, { kind: 'pink', freq: 900, q: 0.4, dur: 3.2, attack: 0.2, sweep: 0.15 });
  },
  bossSubmerge: (a, p) => a.burst(a.out(p, { gain: 0.6 }),
    { kind: 'pink', freq: 1200, q: 0.7, dur: 0.9, sweep: 0.18 }),

  /**
   * The boss wind-up cues. PROJECT.md asks for a distinct cue per wind-up, and
   * distinct means distinct in PITCH DIRECTION, not just in timbre — a player
   * learns "rising means the lunge" far faster than they learn a texture.
   */
  bossLungeTell: (a, p) => a.tone(a.out(p, { gain: 0.55, reverbSend: 1.2 }),
    { freq: 180, type: 'triangle', dur: 0.5, gain: 0.34, glide: 2.1 }),
  bossSweepTell: (a, p) => a.tone(a.out(p, { gain: 0.55, reverbSend: 1.2 }),
    { freq: 300, type: 'triangle', dur: 0.45, gain: 0.34, glide: 0.42 }),
  bossDelayedTell: (a, p) => {
    // Same rising shape as the lunge, then it holds — which is exactly the
    // lie the move tells in animation.
    const g = a.out(p, { gain: 0.55, reverbSend: 1.2 });
    a.tone(g, { freq: 180, type: 'triangle', dur: 0.42, gain: 0.34, glide: 2.1 });
    a.tone(g, { freq: 378, type: 'sine', dur: 0.9, gain: 0.14, attack: 0.4 });
  },
  bossSlamTell: (a, p) => a.tone(a.out(p, { gain: 0.6, reverbSend: 1.2 }),
    { freq: 120, type: 'sawtooth', dur: 0.66, gain: 0.34, glide: 1.35 }),
  bossSkitterTell: (a, p) => a.burst(a.out(p, { gain: 0.5, reverbSend: 0.9 }),
    { kind: 'white', freq: 2800, q: 2.5, dur: 0.26, sweep: 0.5 }),
  bossTell: (a, p) => a.tone(a.out(p, { gain: 0.45 }),
    { freq: 220, type: 'triangle', dur: 0.4, gain: 0.28, glide: 1.4 }),

  // ---- the companion
  pigeonFlap: (a, p) => a.burst(a.out(p, { gain: 0.22 }),
    { kind: 'pink', freq: 420, q: 1.4, dur: 0.13, attack: 0.01, sweep: 1.8 }),
  /**
   * Non-positional on purpose, and NOT a bird sound.
   *
   * PROJECT.md: "a voice too smooth for its body." It is a low, even,
   * close-mic'd tone that does not fall off with distance — the player should
   * feel it is speaking inside their head long before they can say why.
   */
  pigeonVoice: (a) => {
    const g = a.out(null, { positional: false, gain: 0.30, reverbSend: 0.12 });
    a.tone(g, { freq: 128, type: 'sine', dur: 0.36, gain: 0.22, attack: 0.04 });
    a.tone(g, { freq: 192, type: 'sine', dur: 0.30, gain: 0.09, attack: 0.05, detune: -4 });
  },
  pigeonFlinch: (a, p) => a.burst(a.out(p, { gain: 0.3 }),
    { kind: 'pink', freq: 900, q: 2.0, dur: 0.12, sweep: 0.5 }),
};
