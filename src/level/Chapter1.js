import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { ACTION } from '../input/Actions.js';
import { ZoneBuilder } from './zones/ZoneBuilder.js';
import { buildPalette } from './palette.js';
import { buildInkEdges, inkable } from '../render/npr/InkEdges.js';
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
 * Owns the scene group, the palette and the ink pass. It does not build
 * geometry: each zone module does that, in its own file.
 *
 * `update()` used to run three per-frame passes over the whole chapter — an
 * emissive breathing loop, a hardcoded green-light pulse that tested every
 * light's colour channels, and a water update that rebound a depth texture.
 * None of them exist now. What is left is the pickup proximity check, which is
 * gameplay.
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
    this.quality = engine.resolve('quality');

    this.group = new THREE.Group();
    this.group.name = 'chapter1';
    this.scene.add(this.group);
    this.nearestPickup = null;

    this.materials = buildPalette();
    this.ctx = new ZoneBuilder(engine, this.group, this.materials);
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

  /**
   * Draws the ink over everything the zones built, one merged LineSegments per
   * zone group.
   *
   * Called once from main after every zone exists — and after the arena, which
   * is constructed separately. Baking edges per-zone rather than per-mesh is
   * what keeps this to four draw calls instead of several hundred, and
   * parenting each batch inside its own zone group is what makes the ink
   * disappear along with the geometry it belongs to.
   */
  bakeInk() {
    if (this.quality?.outlines === false) return this;
    for (const [id, group] of this.ctx.groups) {
      const lines = buildInkEdges(inkable(group));
      if (lines) group.add(lines);
      void id;
    }
    return this;
  }

  /** Hands the zone subtrees to ZoneManager so it can gate their visibility. */
  registerZoneGroups(zones) {
    for (const [id, group] of this.ctx.groups) zones.registerGroup(id, group);
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

  dispose() {
    this.scene.remove(this.group);
  }
}
