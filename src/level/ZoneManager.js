import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';

/**
 * Per-zone atmosphere profiles. The palette split is locked from PROJECT.md,
 * so the chapter reads as three different places rather than one grey box with
 * signposts.
 *
 * Green Vein   deep olive and black, emissive jade from the water, near-zero ambient
 * Star Chamber desaturated indigo and slate, one white point doing all the work
 * Pagoda Well  warm daylight shaft into cool wet stone — the only sky in the chapter
 *
 * `grade` is the ASC-CDL colour grade PostChain applies after tone mapping.
 * Read it as: lift moves the shadows, gain moves the highlights, gamma moves
 * the midtones, all per channel. The Pagoda Well is the clearest example —
 * cool lift and warm gain is literally "warm daylight into cool wet stone"
 * expressed as two numbers pulling in opposite directions.
 */
const GRADE_DEFAULT = {
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
  saturation: 1, contrast: 1, vignette: 0, grain: 0,
};

export const ZONE_PROFILES = {
  void: {
    background: 0x000000,
    fog: null,
    ambient: { sky: 0x000000, ground: 0x000000, intensity: 0 },
    // A colourless place. Grain matters more here than anywhere: the wisp and
    // the corpse glow are long falloffs on pure black, which is where 8-bit
    // banding is most visible.
    grade: {
      lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
      saturation: 0.55, contrast: 1.05, vignette: 0.15, grain: 0.012,
    },
    reverb: 'none',
  },
  descent: {
    background: 0x0d1113,
    fog: { color: 0x0d1113, density: 0.019 },
    ambient: { sky: 0x2a3330, ground: 0x0a0c0b, intensity: 0.34 },
    grade: {
      lift: [-0.004, 0.000, 0.012], gamma: [1.00, 1.00, 0.98], gain: [0.98, 1.00, 1.06],
      saturation: 0.86, contrast: 1.08, vignette: 0.30, grain: 0.010,
    },
    reverb: 'tunnel',
  },
  greenVein: {
    background: 0x060b08,
    fog: { color: 0x081410, density: 0.026 },
    // Near-zero ambient. The jade water is doing the lighting, not a fill light.
    ambient: { sky: 0x14332a, ground: 0x030705, intensity: 0.22 },
    // Red and blue crushed in the shadows, green held: olive-black, not
    // grey-black.
    //
    // Contrast and vignette were 1.16 and 0.42, chasing "the dark between the
    // water must stay dark". They overshot: the warm olive-brown wall the
    // board paints across most of its frame was being crushed to featureless
    // black over roughly seventy percent of ours. Near-zero ambient is a
    // lighting instruction, not an instruction to delete the walls.
    grade: {
      lift: [-0.010, 0.004, -0.012], gamma: [1.06, 0.96, 1.10], gain: [0.86, 1.06, 0.90],
      saturation: 1.06, contrast: 1.07, vignette: 0.30, grain: 0.012,
    },
    reverb: 'cavern',
  },
  starChamber: {
    background: 0x05070c,
    fog: { color: 0x090d16, density: 0.0135 },
    // Deliberately almost nothing: the star is the only light that matters,
    // and hard falloff into black is the whole look of the concept board.
    ambient: { sky: 0x161d2e, ground: 0x04050a, intensity: 0.20 },
    // Desaturated to slate with indigo in the lift.
    //
    // Contrast and vignette were 1.24 and 0.48 — the most aggressive grade in
    // the chapter — on the reading that "hard falloff into black" is a
    // contrast instruction. The board says otherwise: its falloff happens
    // inside a NARROW value band, from a pale flowstone wall down to dark
    // steps, and the star hangs against that pale wall rather than against
    // black. At 1.24 the wall's authored pale value never reached the screen
    // and the room read as a void with a dot in it.
    grade: {
      lift: [0.004, 0.002, 0.020], gamma: [1.02, 1.01, 0.94], gain: [0.92, 0.95, 1.10],
      saturation: 0.72, contrast: 1.08, vignette: 0.28, grain: 0.014,
    },
    reverb: 'chamber',
  },
  pagodaWell: {
    background: 0x121821,
    fog: { color: 0x1a222c, density: 0.0088 },
    ambient: { sky: 0x5d7286, ground: 0x1b1f21, intensity: 0.62 },
    // The only warm grade in the chapter, and the only weak vignette: this is
    // the relief after ninety minutes of dark, so it must not be framed like
    // another cave.
    grade: {
      lift: [-0.006, 0.000, 0.016], gamma: [0.97, 0.99, 1.04], gain: [1.10, 1.04, 0.94],
      saturation: 0.98, contrast: 1.10, vignette: 0.22, grain: 0.006,
    },
    reverb: 'well',
  },
};

/**
 * ZoneManager — owns zone activation and the atmosphere transition.
 *
 * Zones declare a profile; this applies it. A zone that reached into the
 * renderer or the post chain itself would break the Phase 7 fan-out, which is
 * the whole reason the indirection exists.
 */
export class ZoneManager {
  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');
    this.scene = engine.resolve('renderer').scene;
    this.player = engine.resolve('player');

    /** @type {Map<string, {id, bounds, profile, onEnter, onExit}>} */
    this.zones = new Map();
    this.current = null;
    this.transition = 0;

    this.ambient = new THREE.HemisphereLight(0x202020, 0x000000, 0);
    this.scene.add(this.ambient);

    /**
     * Multiplier applied on top of the zone's ambient. The wing choice drives
     * this: light raises the chamber's illumination, dark deepens it. Kept
     * separate from the profile so the zone's own identity is not overwritten.
     */
    this.reactionScale = 1;

    /**
     * Multiplicative grade offset layered on top of the zone's own grade. The
     * wing choice drives this too: the chamber does not just get dimmer, it
     * gets a different colour temperature. Owned by whatever runs the choice,
     * applied here so the zone's identity is never overwritten.
     */
    this.reactionGrade = null;

    this.target = { ...ZONE_PROFILES.void };
    this.fogColor = new THREE.Color(0x000000);
    this.bgColor = new THREE.Color(0x000000);
    this.fogDensity = 0;
    this.ambientIntensity = 0;
    this.skyColor = new THREE.Color(0x000000);
    this.groundColor = new THREE.Color(0x000000);

    this.post = null; // set by main once the chain exists
    this.grade = structuredClone(ZONE_PROFILES.void.grade);
  }

  /**
   * @param {object|null} g partial grade — only the keys present are applied.
   *   `{ gain: [0.8,0.8,0.9], saturation: 0.8 }` dims and desaturates without
   *   touching the zone's lift or contrast.
   */
  setReactionGrade(g) {
    this.reactionGrade = g;
  }

  /**
   * @param {string} id
   * @param {{min:THREE.Vector3, max:THREE.Vector3}} bounds axis-aligned trigger volume
   */
  register(id, bounds, { onEnter, onExit } = {}) {
    const profile = ZONE_PROFILES[id];
    if (!profile) throw new Error(`ZoneManager: no profile for zone "${id}"`);
    this.zones.set(id, { id, bounds, profile, onEnter, onExit });
  }

  /** Applies a profile instantly. Used at boot and on respawn. */
  snapTo(id) {
    const zone = this.zones.get(id);
    const profile = zone?.profile ?? ZONE_PROFILES[id];
    if (!profile) return;
    this.current = zone ?? null;
    this.state.zone = id;
    this.target = profile;

    this.bgColor.setHex(profile.background);
    this.skyColor.setHex(profile.ambient.sky);
    this.groundColor.setHex(profile.ambient.ground);
    this.ambientIntensity = profile.ambient.intensity;
    this.fogDensity = profile.fog?.density ?? 0;
    if (profile.fog) this.fogColor.setHex(profile.fog.color);
    this.grade = structuredClone(profile.grade ?? GRADE_DEFAULT);
    this.#apply();
    this.bus.emit(EVENTS.ZONE_ENTERED, { id });
  }

  #apply() {
    this.scene.background = this.bgColor;
    if (this.fogDensity > 0) {
      if (!this.scene.fog?.isFogExp2) this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.fogDensity);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = this.fogDensity;
    } else {
      this.scene.fog = null;
    }
    this.ambient.color.copy(this.skyColor);
    this.ambient.groundColor.copy(this.groundColor);
    this.ambient.intensity = this.ambientIntensity * this.reactionScale;

    if (!this.post) return;
    const r = this.reactionGrade;
    if (!r) { this.post.setGrade(this.grade); return; }
    const g = this.grade;
    this.post.setGrade({
      lift: r.lift ? g.lift.map((v, i) => v + r.lift[i]) : g.lift,
      gamma: r.gamma ? g.gamma.map((v, i) => v * r.gamma[i]) : g.gamma,
      gain: r.gain ? g.gain.map((v, i) => v * r.gain[i]) : g.gain,
      saturation: g.saturation * (r.saturation ?? 1),
      contrast: g.contrast * (r.contrast ?? 1),
      vignette: Math.min(1, g.vignette + (r.vignette ?? 0)),
      grain: g.grain,
    });
  }

  #contains(bounds, p) {
    return p.x >= bounds.min.x && p.x <= bounds.max.x
      && p.y >= bounds.min.y && p.y <= bounds.max.y
      && p.z >= bounds.min.z && p.z <= bounds.max.z;
  }

  fixedUpdate(dt) {
    const p = this.player.position;
    for (const zone of this.zones.values()) {
      if (zone === this.current) continue;
      if (!this.#contains(zone.bounds, p)) continue;

      this.current?.onExit?.();
      this.bus.emit(EVENTS.ZONE_EXITED, { id: this.current?.id ?? null });
      this.current = zone;
      this.target = zone.profile;
      this.state.zone = zone.id;
      zone.onEnter?.();
      this.bus.emit(EVENTS.ZONE_ENTERED, { id: zone.id });
      break;
    }
  }

  /**
   * Atmosphere crossfades rather than cutting. The transition is slow — three
   * seconds — because the zones are the chapter's structure and a hard cut
   * between them would read as a level load.
   */
  update(dt) {
    const t = Math.min(1, dt * 0.55);
    const p = this.target;
    this.bgColor.lerp(_c1.setHex(p.background), t);
    this.skyColor.lerp(_c1.setHex(p.ambient.sky), t);
    this.groundColor.lerp(_c1.setHex(p.ambient.ground), t);
    this.ambientIntensity += (p.ambient.intensity - this.ambientIntensity) * t;
    const wantDensity = p.fog?.density ?? 0;
    this.fogDensity += (wantDensity - this.fogDensity) * t;
    if (p.fog) this.fogColor.lerp(_c1.setHex(p.fog.color), t);
    this.#lerpGrade(p.grade ?? GRADE_DEFAULT, t);
    this.#apply();
  }

  /** The grade rides the same three-second crossfade as the fog and ambient. */
  #lerpGrade(target, t) {
    const g = this.grade;
    for (const key of ['lift', 'gamma', 'gain']) {
      for (let i = 0; i < 3; i++) g[key][i] += (target[key][i] - g[key][i]) * t;
    }
    for (const key of ['saturation', 'contrast', 'vignette', 'grain']) {
      g[key] += ((target[key] ?? GRADE_DEFAULT[key]) - g[key]) * t;
    }
  }

  dispose() {
    this.scene.remove(this.ambient);
  }
}

const _c1 = new THREE.Color();
