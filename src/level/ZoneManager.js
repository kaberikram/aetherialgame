import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';

/**
 * Per-zone atmosphere profiles. These are the values Phase 7 will refine, but
 * the palette split is locked from PROJECT.md now so the blockout already
 * reads as three different places rather than one grey box with signposts.
 *
 * Green Vein   deep olive and black, emissive jade from the water, near-zero ambient
 * Star Chamber desaturated indigo and slate, one white point doing all the work
 * Pagoda Well  warm daylight shaft into cool wet stone — the only sky in the chapter
 */
export const ZONE_PROFILES = {
  void: {
    background: 0x000000,
    fog: null,
    ambient: { sky: 0x000000, ground: 0x000000, intensity: 0 },
    grade: 'void',
    reverb: 'none',
  },
  descent: {
    background: 0x0d1113,
    fog: { color: 0x0d1113, density: 0.019 },
    ambient: { sky: 0x2a3330, ground: 0x0a0c0b, intensity: 0.34 },
    grade: 'descent',
    reverb: 'tunnel',
  },
  greenVein: {
    background: 0x060b08,
    fog: { color: 0x081410, density: 0.026 },
    // Near-zero ambient. The jade water is doing the lighting, not a fill light.
    ambient: { sky: 0x14332a, ground: 0x030705, intensity: 0.22 },
    grade: 'greenVein',
    reverb: 'cavern',
  },
  starChamber: {
    background: 0x05070c,
    fog: { color: 0x090d16, density: 0.0135 },
    // Deliberately almost nothing: the star is the only light that matters,
    // and hard falloff into black is the whole look of the concept board.
    ambient: { sky: 0x161d2e, ground: 0x04050a, intensity: 0.20 },
    grade: 'starChamber',
    reverb: 'chamber',
  },
  pagodaWell: {
    background: 0x121821,
    fog: { color: 0x1a222c, density: 0.0088 },
    ambient: { sky: 0x5d7286, ground: 0x1b1f21, intensity: 0.62 },
    grade: 'pagodaWell',
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

    this.target = { ...ZONE_PROFILES.void };
    this.fogColor = new THREE.Color(0x000000);
    this.bgColor = new THREE.Color(0x000000);
    this.fogDensity = 0;
    this.ambientIntensity = 0;
    this.skyColor = new THREE.Color(0x000000);
    this.groundColor = new THREE.Color(0x000000);
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
    this.ambient.intensity = this.ambientIntensity;
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
    this.#apply();
  }

  dispose() {
    this.scene.remove(this.ambient);
  }
}

const _c1 = new THREE.Color();
