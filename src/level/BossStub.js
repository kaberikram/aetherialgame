import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { toonMaterial } from '../render/npr/ToonMaterial.js';
import { Vitals } from '../combat/Vitals.js';
import { StaticCapsule } from '../combat/HitboxSystem.js';

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
 * water with a hurtbox and a health pool, which you kill with R1. It occupies
 * the boss's space at the boss's scale, so the arena still reads at the right
 * proportions, and it exposes the same `engage`/`reset`/`alive` surface
 * `BossEncounter` drives — the real controller drops back into the same seam.
 *
 * It does not attack. It has no AI, no moves and no telegraphs, which is the
 * entire difference between this and a boss. What it does have is the thing
 * the chapter's flow needs: a way to die that the player caused.
 */
export class BossStub {
  constructor(engine, { position, arena }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.arena = arena;
    this.player = engine.resolve('player');
    this.scene = engine.resolve('renderer').scene;

    this.position = position.clone();
    this.faction = 'enemy';
    this.engaged = false;
    this.state = 'idle';
    /** Read by the lock-on camera. */
    this.lockHeight = 2.6;
    this.lockDistanceScale = 1.6;
    /** A stub cannot be executed — there is no stagger to punish. */
    this.criticalImmune = true;
    this.hitPulse = 0;

    this.vitals = new Vitals(this.bus, this, { maxHealth: 900, maxPoise: 120 });
    // Wide and low, matching the hull: a capsule around a boat-shaped mass.
    this.hurtbox = new StaticCapsule({ position: this.position, height: 3.0, radius: 1.9 });

    this.mesh = this.#build();
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
    this.mesh.visible = false; // surfaces when the gate is entered

    engine.resolve('hitboxes').registerHurtbox(this, this.hurtbox);
    engine.resolve('lockOn').register(this);
    this.bus.on(EVENTS.HIT_LANDED, (e) => { if (e.victim === this) this.#onHit(e); });
  }

  get alive() {
    return this.vitals.alive;
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
      speaker: '', text: 'It does not move. Cut it until it stops being there.', duration: 4.2,
    });
  }

  #onHit({ died }) {
    // Rock away from the blow. A target that absorbs a hit without moving
    // reads as a wall, and half of what makes a swing feel like it connected
    // is the thing you hit acknowledging it.
    this.hitPulse = 1;
    if (died) this.#defeat();
  }

  fixedUpdate(dt) {
    this.vitals.fixedUpdate(dt);
    this.hurtbox.update();
    if (this.hitPulse > 0) {
      this.hitPulse = Math.max(0, this.hitPulse - dt * 3.2);
      this.mesh.rotation.z = Math.sin(this.hitPulse * 22) * this.hitPulse * 0.07;
    }
  }

  #defeat() {
    this.engaged = false;
    this.state = 'dead';
    this.mesh.visible = false;
    this.arena?.burst(this.position, 1.4);
    this.bus.emit(EVENTS.BOSS_DEFEATED, { id: 'drowned' });
  }

  reset() {
    this.vitals.refill();
    this.engaged = false;
    this.state = 'idle';
    this.hitPulse = 0;
    this.mesh.rotation.z = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
