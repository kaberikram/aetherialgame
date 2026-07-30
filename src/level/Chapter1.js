import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { ACTION } from '../input/Actions.js';
import { ZoneBuilder } from './zones/ZoneBuilder.js';
import * as Descent from './zones/Descent.js';
import * as GreenVein from './zones/GreenVein.js';
import * as PoolApproach from './zones/PoolApproach.js';
import * as PagodaWell from './zones/PagodaWell.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from './waypoints.js';

// Re-exported: the rest of the project has always imported these from here.
export { GREEN_VEIN_FLOOR, WAYPOINTS };

/**
 * Chapter 1 — the composer.
 *
 * Owns the scene group, the material table and the runtime passes that every
 * zone shares. It does not build geometry: each zone module does that, in its
 * own file, so the art pass can run one agent per zone without two of them
 * editing the same source. See `zones/ZoneBuilder.js` for the contract they
 * are handed.
 */
export class Chapter1 {
  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.scene = engine.resolve('renderer').scene;
    this.player = engine.resolve('player');
    this.input = engine.resolve('input');
    this.state = engine.resolve('state');

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.nearestPickup = null;

    this.materials = {
      rock: new THREE.MeshStandardMaterial({ color: 0x3f443f, roughness: 0.97, metalness: 0 }),
      wetRock: new THREE.MeshStandardMaterial({ color: 0x33393f, roughness: 0.62, metalness: 0.05 }),
      laterite: new THREE.MeshStandardMaterial({ color: 0x6a5f55, roughness: 0.95, metalness: 0 }),
      candi: new THREE.MeshStandardMaterial({ color: 0x8a8579, roughness: 0.88, metalness: 0 }),
      moss: new THREE.MeshStandardMaterial({ color: 0x35462c, roughness: 0.98, metalness: 0 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.93, metalness: 0 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xada396, roughness: 0.86, metalness: 0 }),
      // Emissive, but not blown out. The rubric asks whether a frame reads in
      // grayscale, and a channel pinned at full white does not — it becomes a
      // flat shape with no internal value. Kept dark enough that the highlight
      // lives in the specular and the bloom, not in the albedo.
      jade: new THREE.MeshStandardMaterial({
        color: 0x06251c, emissive: 0x1f9c72, emissiveIntensity: 0.72,
        roughness: 0.14, metalness: 0.25, transparent: true, opacity: 0.94,
      }),
    };

    this.ctx = new ZoneBuilder(engine, this.group, this.materials);
    this.lights = this.ctx.lights;
    this.emissives = this.ctx.emissives;
    this.pickups = this.ctx.pickups;
  }

  build() {
    Object.assign(this,
      Descent.build(this.ctx, WAYPOINTS),
      GreenVein.build(this.ctx),
      PoolApproach.build(this.ctx),
      PagodaWell.build(this.ctx));
    return this;
  }

  // --------------------------------------------------------------- runtime

  fixedUpdate(dt) {
    this.#updatePickups();
  }

  #updatePickups() {
    let found = null;
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (this.player.position.distanceTo(p.position) < p.radius) { found = p; break; }
    }
    if (found !== this.nearestPickup) {
      this.nearestPickup = found;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, found ? { id: found.id, label: found.label } : null);
    }
    if (found && this.input.actions[ACTION.INTERACT].pressed && this.player.canAct()) {
      found.taken = true;
      this.nearestPickup = null;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
      this.bus.emit(EVENTS.SFX, { id: 'pickup', position: found.position });
      found.onPick();
    }
  }

  update(dt) {
    // The jade water breathes. Two out-of-phase sines per channel so the whole
    // cavern does not pulse as one organism.
    const t = performance.now() * 0.001;
    for (const e of this.emissives) {
      const f = 1.25 + Math.sin(t * 0.62 + e.phase) * 0.28 + Math.sin(t * 1.37 + e.phase * 2) * 0.12;
      e.mesh.material.emissiveIntensity = f;
    }
    for (const [i, l] of this.lights.entries()) {
      if (l.color.g > 0.7 && l.color.r < 0.4) {
        l.intensity = 5.6 * (1 + Math.sin(t * 0.7 + i) * 0.16);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
