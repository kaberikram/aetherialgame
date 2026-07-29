import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { SLOTS, VARIANT } from '../core/GameState.js';
import { buildWings } from './Wings.js';

/**
 * Alignment — the seven-slot architecture, built in full.
 *
 * Seven trials times a binary choice is 128 end-states. The whole point of
 * this file is that none of those 128 are authored: a character is ASSEMBLED
 * at runtime from whichever variants it owns, on one shared skeleton. Fourteen
 * assets, not 128.
 *
 * Chapter 1 resolves `wings` only. The other six slots are wired, registered
 * and swappable — they simply have no variants supplied yet, and adding one
 * later is a single `register()` call with no changes anywhere else.
 */

/**
 * The slot registry. Each slot declares the bone it attaches to and the
 * factories for its two variants. A slot with no factory is unpopulated, which
 * is a normal state, not an error.
 */
const SLOT_DEFS = {
  wings: {
    bone: 'chest',
    offset: [0, 0.14, -0.13],
    light: () => buildWings('light'),
    dark: () => buildWings('dark'),
  },
  head: { bone: 'head', offset: [0, 0.10, 0], light: null, dark: null },
  chest: { bone: 'chest', offset: [0, 0.06, 0], light: null, dark: null },
  arms: { bone: 'upperArm.R', offset: [0, 0, 0], light: null, dark: null },
  legs: { bone: 'thigh.R', offset: [0, 0, 0], light: null, dark: null },
  weapon: { bone: 'hand.R', offset: [0, -0.11, 0.02], light: null, dark: null },
  aura: { bone: 'hips', offset: [0, 0.2, 0], light: null, dark: null },
};

export class Alignment {
  constructor(engine, player) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');
    this.player = player;

    /** @type {Map<string, THREE.Object3D>} attached variant objects by slot */
    this.attached = new Map();

    this.bus.on(EVENTS.ALIGNMENT_CHOSEN, ({ slot }) => this.assemble(slot));
  }

  get alignment() {
    return this.state.alignment;
  }

  get branch() {
    return this.state.branch;
  }

  /** Mechanical modifiers for the active branch. Read by DamageSystem etc. */
  get modifiers() {
    if (this.branch === 'light') return TUNING.alignment.light;
    if (this.branch === 'dark') return TUNING.alignment.dark;
    return {
      deflectWindowBonusFrames: 0, damageMultiplier: 1,
      defenceMultiplier: 1, attackSpeedMultiplier: 1,
    };
  }

  /** Does the active branch have the health-cost dash? Dark only. */
  get hasCostDash() {
    return this.branch === 'dark';
  }

  /** Does the active branch heal on a deflect? Light only. */
  get healsOnDeflect() {
    return this.branch === 'light';
  }

  /**
   * Rebuild one slot (or all of them) from the owned variants.
   * Idempotent: safe to call on load, on respawn, and after any choice.
   */
  assemble(slot = null) {
    const slots = slot ? [slot] : SLOTS;
    for (const s of slots) {
      const def = SLOT_DEFS[s];
      if (!def) continue;

      const existing = this.attached.get(s);
      if (existing) {
        existing.parent?.remove(existing);
        this.attached.delete(s);
      }

      const variant = this.state.slots[s];
      if (variant === VARIANT.NONE) continue;
      const factory = variant === VARIANT.LIGHT ? def.light : def.dark;
      if (!factory) continue; // registered but not yet populated — expected

      const bone = this.player.rig.byName.get(def.bone);
      if (!bone) {
        console.warn(`Alignment: slot "${s}" wants bone "${def.bone}", which does not exist`);
        continue;
      }
      const obj = factory();
      obj.position.fromArray(def.offset);
      bone.add(obj);
      this.attached.set(s, obj);
    }
    return this;
  }

  get wings() {
    return this.attached.get('wings') ?? null;
  }

  /**
   * Wing motion. Folded while grounded, spread and beating in flight.
   * Driven here rather than in a clip because the wings are attached at
   * runtime and may not exist — the animation system must not have to care.
   */
  update(dt, { flying = false, flapPhase = 0, speed = 0 } = {}) {
    const w = this.wings;
    if (!w) return;

    const t = performance.now() * 0.001;
    const spread = flying ? 1 : 0.12;
    const target = THREE.MathUtils.lerp(-1.15, 0.05, spread);

    for (const child of w.children) {
      if (!child.name?.startsWith('wing.')) continue;
      const side = child.name === 'wing.L' ? 1 : -1;

      // Folded: swept back and down against the spine. Spread: out and level.
      const wantZ = side * (flying ? 0.10 + Math.sin(flapPhase) * 0.55 : 1.02);
      const wantY = side * (flying ? -0.20 : 1.24);
      const wantX = flying ? -0.10 + Math.sin(flapPhase) * 0.22 : 0.55;

      child.rotation.z = THREE.MathUtils.damp(child.rotation.z, wantZ, flying ? 16 : 6, dt);
      child.rotation.y = THREE.MathUtils.damp(child.rotation.y, wantY, flying ? 12 : 6, dt);
      child.rotation.x = THREE.MathUtils.damp(child.rotation.x, wantX, flying ? 14 : 6, dt);
    }

    // The light wings' own lamp brightens with effort, so a hard climb is
    // visibly brighter than a glide. Nothing about that needs a UI.
    const lamp = w.userData.light;
    if (lamp) {
      const effort = flying ? 0.55 + Math.abs(Math.sin(flapPhase)) * 0.9 : 0.35;
      lamp.intensity = THREE.MathUtils.damp(lamp.intensity, 6 + effort * 7, 5, dt);
    }
  }

  /** For the debug overlay and the save summary. */
  describe() {
    return SLOTS.map((s) => {
      const v = this.state.slots[s];
      return `${s}:${v === VARIANT.LIGHT ? 'light' : v === VARIANT.DARK ? 'dark' : '—'}`;
    }).join(' ');
  }
}

export { SLOT_DEFS };
