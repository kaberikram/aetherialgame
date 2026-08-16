import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { toonMaterial } from '../render/npr/ToonMaterial.js';

/**
 * A stand-in for The Drowned.
 *
 * Combat is out this phase, and the boss went with it. But the boss is a
 * *link in the flow*: fog gate → fight → BOSS_DEFEATED → five seconds → the
 * wing choice → flight unlocked → the oculus. Cutting it would break every
 * beat downstream of it and leave half the chapter unreachable while the
 * question on the table is whether walking through the chapter feels good.
 *
 * So this is the smallest thing that keeps the chain intact: a mass in the
 * water you walk up to and press interact on, which emits `BOSS_DEFEATED`.
 * It occupies the boss's space at the boss's scale, so the arena still reads
 * at the right proportions, and it exposes the same `engage`/`reset`/`alive`
 * surface `BossEncounter` drives — the real controller drops back into the
 * same seam.
 */
export class BossStub {
  constructor(engine, { position, arena }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.arena = arena;
    this.player = engine.resolve('player');
    this.scene = engine.resolve('renderer').scene;

    this.position = position.clone();
    this.alive = true;
    this.engaged = false;
    this.state = 'idle';
    /** Read by the lock-on camera when combat returns. */
    this.lockHeight = 2.6;
    this.lockDistanceScale = 1.6;

    this.mesh = this.#build();
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
    this.mesh.visible = false; // surfaces when the gate is entered
  }

  /**
   * A long low mass, mostly submerged. Not a character — deliberately. A
   * placeholder shaped like a creature invites judgement of the creature; a
   * placeholder shaped like a placeholder invites judgement of the room, which
   * is the thing actually being tested.
   */
  #build() {
    const g = new THREE.Group();
    const body = toonMaterial({ color: 0x2a3140, bands: 3, rim: 0x6f88b8, rimStrength: 0.9, rimPower: 2.0 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 7.0), body);
    hull.position.y = 0.9;
    hull.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 2.2), body);
    head.position.set(0, 1.5, 4.0);
    head.castShadow = true;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 3.4), body);
    tail.position.set(0, 0.6, -4.8);

    g.add(hull, head, tail);
    return g;
  }

  engage() {
    this.engaged = true;
    this.state = 'engaged';
    this.mesh.visible = true;
    this.arena?.burst(this.position, 1.2);
    this.bus.emit(EVENTS.BOSS_ENCOUNTER_START, { id: 'drowned', name: 'The Drowned' });
    this.bus.emit(EVENTS.DIALOGUE_LINE, {
      speaker: '', text: 'It is already awake. Walk up to it and end this.', duration: 4.2,
    });
  }

  /** The stub's whole interaction: get close, and it is over. */
  fixedUpdate(dt) {
    if (!this.engaged || !this.alive) return;
    if (this.player.position.distanceTo(this.position) > 3.2) return;
    this.#defeat();
  }

  #defeat() {
    this.alive = false;
    this.engaged = false;
    this.state = 'dead';
    this.mesh.visible = false;
    this.arena?.burst(this.position, 1.4);
    this.bus.emit(EVENTS.BOSS_DEFEATED, { id: 'drowned' });
  }

  reset() {
    this.alive = true;
    this.engaged = false;
    this.state = 'idle';
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
