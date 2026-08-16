import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';

/**
 * Per-zone atmosphere profiles. The palette split is locked from PROJECT.md,
 * so the chapter reads as three different places rather than one grey box with
 * signposts.
 *
 * Green Vein   deep olive and black, jade cast off the water, near-zero ambient
 * Star Chamber desaturated indigo and slate, one cold key doing all the work
 * Pagoda Well  warm daylight into cool wet stone — the only sky in the chapter
 *
 * These used to also carry an ASC-CDL `grade` applied by a post-processing
 * pass. There is no post chain any more, and under cel shading there should not
 * be one: a grade is a photographic correction, and the whole premise of a
 * banded ramp is that the colour you authored is the colour that ships. The
 * palette now lives where an animator would put it — in the key light, the
 * ambient hemisphere and the fog — and each zone's identity is those three
 * colours rather than a curve pulled over the top of a shared render.
 *
 * `key.direction` is deliberately NOT per-zone. One directional light lights
 * the whole chapter and its shadow map is baked exactly once
 * (`Renderer.freezeShadows`), so rotating it per zone would invalidate the bake
 * and put six-figure costs back into the frame. Colour and intensity crossfade;
 * direction does not move.
 */
/**
 * Roughly 35° above the horizon, raking down the chapter's line of travel.
 *
 * This was near-vertical (61°) and that is a real lighting mistake under cel
 * shading, not a taste call. A banded ramp has no falloff: a surface is either
 * in a band or in the one below it, with nothing in between. With the key
 * overhead, every horizontal surface sat in the top band and every VERTICAL
 * one — walls, the character, anything that owns a silhouette — sat in the
 * bottom band. The result was a bright floor and black everything else, which
 * is the exact failure the grayscale rubric is meant to catch.
 *
 * A low key puts walls and characters in the middle bands, where the shading
 * actually has somewhere to go.
 */
export const KEY_DIRECTION = new THREE.Vector3(0.62, 0.68, 0.5).normalize();

export const ZONE_PROFILES = {
  void: {
    background: 0x000000,
    fog: { color: 0x000000, density: 0.0 },
    ambient: { sky: 0x000000, ground: 0x000000, intensity: 0 },
    key: { color: 0x000000, intensity: 0 },
    reverb: 'none',
  },
  descent: {
    background: 0x0d1113,
    fog: { color: 0x0d1113, density: 0.019 },
    ambient: { sky: 0x2a3330, ground: 0x0a0c0b, intensity: 0.9 },
    key: { color: 0x9fb0ae, intensity: 1.1 },
    reverb: 'tunnel',
  },
  greenVein: {
    // Olive-black, not grey-black. The green lives in the ambient sky term and
    // the fog rather than in a grade that pushed the green channel globally.
    background: 0x060b08,
    fog: { color: 0x081410, density: 0.026 },
    ambient: { sky: 0x2c6b57, ground: 0x090f0b, intensity: 1.05 },
    // Dim and cold from above, so the jade bounce reads as the light source
    // even though it is now ambient rather than six point lights.
    key: { color: 0x7d9c93, intensity: 0.7 },
    reverb: 'cavern',
  },
  starChamber: {
    // Hard falloff into black is the look, but the concept board's falloff
    // happens inside a NARROW value band — a pale flowstone wall down to dark
    // steps — not from white to nothing. Ambient stays low; it does not vanish.
    background: 0x05070c,
    fog: { color: 0x090d16, density: 0.0135 },
    ambient: { sky: 0x2b3550, ground: 0x05070d, intensity: 0.85 },
    key: { color: 0xaebbd8, intensity: 1.25 },
    reverb: 'chamber',
  },
  pagodaWell: {
    // The only daylight in the chapter, and the only warm key. This is the
    // relief after ninety minutes of dark, so it must not read as another cave.
    background: 0x121821,
    fog: { color: 0x1a222c, density: 0.0088 },
    ambient: { sky: 0x5d7286, ground: 0x1b1f21, intensity: 1.5 },
    key: { color: 0xffe6c2, intensity: 2.4 },
    reverb: 'well',
  },
};

/**
 * Which zones stay drawn either side of the one you are standing in.
 *
 * The chapter is a linear chain, so "the neighbours" is the whole rule. It
 * exists so that a doorway never shows an empty void through it — being one
 * zone off is the single visible failure mode of visibility culling, and it is
 * much worse than the cost it saves.
 */
const NEIGHBOURS = {
  void: [],
  descent: ['greenVein'],
  greenVein: ['descent', 'starChamber'],
  starChamber: ['greenVein', 'pagodaWell'],
  pagodaWell: ['starChamber'],
};

/**
 * ZoneManager — owns zone activation, the atmosphere transition, and the two
 * lights the whole chapter is lit by.
 *
 * Zones declare a profile; this applies it. A zone that reached into the
 * renderer itself would break the module contract, which is the whole reason
 * the indirection exists.
 */
export class ZoneManager {
  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');
    this.scene = engine.resolve('renderer').scene;
    this.player = engine.resolve('player');
    this.quality = engine.resolve('quality');

    /** @type {Map<string, {id, bounds, profile, onEnter, onExit}>} */
    this.zones = new Map();
    this.current = null;

    this.ambient = new THREE.HemisphereLight(0x202020, 0x000000, 0);
    this.scene.add(this.ambient);

    // The chapter's key light. Directional, not point: a point light with
    // shadows is six scene renders, and the previous build had eight of them
    // plus seventeen more without. Every fragment in the game now evaluates a
    // light loop of exactly three.
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.key.position.copy(KEY_DIRECTION).multiplyScalar(90);
    this.key.target.position.set(0, -12, -40);
    this.scene.add(this.key, this.key.target);

    // The fill: low, cold, from behind and opposite, casting nothing.
    //
    // Not optional under cel shading. A banded ramp has no gradient, so a
    // surface facing away from the key does not fall off toward darkness — it
    // lands in the bottom band and stays there. With a key alone, a character
    // walking away from it is a flat black cut-out, and PROJECT.md's rubric
    // asks whether the silhouette reads at 10% screen height, not whether it
    // exists. Two-point lighting is the standard animation answer and it costs
    // one more iteration of a loop that is now three long instead of
    // twenty-five.
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    this.fill.position.copy(KEY_DIRECTION).multiplyScalar(-70).setY(30);
    this.fill.target.position.set(0, -12, -40);
    this.scene.add(this.fill, this.fill.target);

    if (this.quality?.shadows !== false) {
      this.key.castShadow = true;
      const s = this.quality?.shadowMap ?? 2048;
      this.key.shadow.mapSize.set(s, s);
      // One ortho covering the entire chapter: z from +46 to -150, x ±48, and
      // the full vertical drop. At 2048 that is roughly 9cm per texel, which is
      // chunky — and chunky is correct here. Soft accurate shadows are a
      // photographic goal; hard blocky ones sit inside the ink-and-paint
      // language, and this map is baked once rather than re-rendered.
      const cam = this.key.shadow.camera;
      cam.left = -110; cam.right = 110;
      cam.top = 110; cam.bottom = -110;
      cam.near = 1; cam.far = 320;
      cam.updateProjectionMatrix();
      this.key.shadow.bias = -0.0012;
      this.key.shadow.normalBias = 0.04;
    }

    /**
     * Multiplier applied on top of the zone's ambient. The wing choice drives
     * this: light raises the chamber's illumination, dark deepens it. Kept
     * separate from the profile so the zone's own identity is not overwritten.
     */
    this.reactionScale = 1;

    /** Per-zone scene subtrees, for visibility gating. `id -> THREE.Group`. */
    this.groups = new Map();

    this.target = ZONE_PROFILES.void;
    this.fogColor = new THREE.Color(0x000000);
    this.bgColor = new THREE.Color(0x000000);
    this.keyColor = new THREE.Color(0x000000);
    this.fogDensity = 0;
    this.ambientIntensity = 0;
    this.keyIntensity = 0;
    this.skyColor = new THREE.Color(0x000000);
    this.groundColor = new THREE.Color(0x000000);

    // Created once and never replaced. Assigning `scene.fog = null` flips the
    // USE_FOG define on every material in the scene, which recompiles every
    // program — a multi-hundred-millisecond hitch, and it used to fire at
    // exactly the moment the player crossed between zones. Density goes to
    // zero instead; the fog object itself outlives the run.
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
  }

  /** Registers a zone's scene subtree so its visibility can be gated. */
  registerGroup(id, group) {
    this.groups.set(id, group);
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
    this.keyColor.setHex(profile.key.color);
    this.ambientIntensity = profile.ambient.intensity;
    this.keyIntensity = profile.key.intensity;
    this.fogDensity = profile.fog?.density ?? 0;
    if (profile.fog) this.fogColor.setHex(profile.fog.color);
    this.#apply();
    this.#applyVisibility(id);
    this.bus.emit(EVENTS.ZONE_ENTERED, { id });
  }

  #apply() {
    this.scene.background = this.bgColor;
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = this.fogDensity;

    this.ambient.color.copy(this.skyColor);
    this.ambient.groundColor.copy(this.groundColor);
    this.ambient.intensity = this.ambientIntensity * this.reactionScale;

    this.key.color.copy(this.keyColor);
    this.key.intensity = this.keyIntensity * this.reactionScale;
    // The fill rides the key's colour, cooled and cut to a third. It is a
    // readability device, not a second key, and it must never compete for the
    // eye — the moment it does, the form the key is describing goes flat.
    this.fill.color.copy(this.keyColor).lerp(_cool, 0.55);
    this.fill.intensity = this.keyIntensity * 0.34 * this.reactionScale;
  }

  /**
   * Draws the current zone and its immediate neighbours; hides the rest.
   *
   * Frustum culling is per-object and still walks the whole graph to do it, so
   * it does not save the traversal — this does. The void is the exception: it
   * hides everything, which is what the opening sequence wants anyway.
   */
  #applyVisibility(id) {
    if (this.groups.size === 0) return;
    const live = new Set([id, ...(NEIGHBOURS[id] ?? [])]);
    for (const [gid, group] of this.groups) group.visible = live.has(gid);
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
      this.#applyVisibility(zone.id);
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
    this.keyColor.lerp(_c1.setHex(p.key.color), t);
    this.ambientIntensity += (p.ambient.intensity - this.ambientIntensity) * t;
    this.keyIntensity += (p.key.intensity - this.keyIntensity) * t;
    const wantDensity = p.fog?.density ?? 0;
    this.fogDensity += (wantDensity - this.fogDensity) * t;
    if (p.fog) this.fogColor.lerp(_c1.setHex(p.fog.color), t);
    this.#apply();
  }

  dispose() {
    this.scene.remove(this.ambient, this.key, this.key.target, this.fill, this.fill.target);
  }
}

const _c1 = new THREE.Color();
const _cool = new THREE.Color(0x6f8cc4);
