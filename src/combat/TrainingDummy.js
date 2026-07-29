import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { Vitals } from './Vitals.js';
import { StaticCapsule } from './HitboxSystem.js';
import { FILTERS } from '../physics/PhysicsWorld.js';

/**
 * A dummy that reacts, staggers, and reports the frame data of what hit it.
 *
 * The reporting is the point. "Does an attack feel committed" is a subjective
 * question, but "did light2 open on frame 10 and deal 40" is not, and being
 * able to read the second while feeling the first is how the first gets tuned.
 */
export class TrainingDummy {
  faction = 'enemy';

  constructor(engine, position, { name = 'Training Dummy', maxHealth = 800, maxPoise = 60 } = {}) {
    this.engine = engine;
    this.bus = engine.bus;
    this.name = name;
    this.position = position.clone();
    this.alive = true;
    this.facing = 0;
    this.criticalImmune = false;

    this.vitals = new Vitals(this.bus, this, { maxHealth, maxPoise, staggerFrames: 150 });
    this.hurtbox = new StaticCapsule({ position: this.position, height: 1.75, radius: 0.36 });
    this.lockHeight = 0.85;

    this.hitLog = [];
    this.wobble = 0;
    this.wobbleAxis = new THREE.Vector3(1, 0, 0);

    this.#build();
  }

  #build() {
    const scene = this.engine.resolve('renderer').scene;
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.36, 1.02, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.88 })
    );
    body.position.y = 0.9;
    body.castShadow = true;
    body.receiveShadow = true;
    this.body = body;

    // A pivot at the base, so the whole dummy rocks on its post when hit
    // rather than sliding. Reaction sells impact more than damage numbers do.
    this.pivot = new THREE.Group();
    this.pivot.add(body);
    this.group.add(this.pivot);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.13, 0.42, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 })
    );
    post.position.y = 0.21;
    post.castShadow = true;
    this.group.add(post);

    scene.add(this.group);

    const { collider } = this.engine.resolve('physics').addStaticBox(
      new THREE.Vector3(0.74, 1.78, 0.74),
      new THREE.Vector3(this.position.x, this.position.y + 0.89, this.position.z),
      null,
      { group: FILTERS.world }
    );
    this.collider = collider;
  }

  register(hitboxes, lockOn) {
    hitboxes.registerHurtbox(this, this.hurtbox);
    lockOn?.register(this);
    this.hitboxes = hitboxes;
    this.lockOn = lockOn;

    this._off = this.bus.on(EVENTS.HIT_LANDED, (e) => {
      if (e.victim !== this) return;
      this.#react(e);
    });
    return this;
  }

  #react({ attacker, damage, poiseDamage, staggered }) {
    const move = attacker?.currentMove;
    this.hitLog.unshift({
      move: move?.id ?? '—',
      startup: move?.startup ?? 0,
      active: move ? `${move.active[0]}–${move.active[1]}` : '—',
      recovery: move ? move.frames - move.active[1] : 0,
      damage: Math.round(damage),
      poise: Math.round(poiseDamage),
      staggered,
      hp: Math.round(this.vitals.health),
      at: performance.now(),
    });
    if (this.hitLog.length > 8) this.hitLog.pop();

    // Rock away from the attacker, scaled by poise damage.
    this.wobble = Math.min(0.55, 0.14 + poiseDamage * 0.006);
    if (attacker?.position) {
      const dx = this.position.x - attacker.position.x;
      const dz = this.position.z - attacker.position.z;
      const len = Math.hypot(dx, dz) || 1;
      this.wobbleAxis.set(dz / len, 0, -dx / len);
    }
  }

  fixedUpdate(dt) {
    this.vitals.fixedUpdate(dt);
    this.hurtbox.update();

    // Dummies come back. They are for practice, not for a kill count.
    if (!this.vitals.alive) {
      this.vitals.refill();
      this.hitLog.unshift({ move: 'destroyed → reset', damage: 0, poise: 0, hp: this.vitals.maxHealth, at: performance.now() });
    }

    if (this.wobble > 0.0005) {
      this.wobble *= Math.pow(0.055, dt);
      const t = performance.now() * 0.014;
      this.pivot.quaternion.setFromAxisAngle(this.wobbleAxis, Math.sin(t) * this.wobble);
    } else if (this.wobble !== 0) {
      this.wobble = 0;
      this.pivot.quaternion.identity();
    }

    // Staggered dummies slump, which is the visual cue that a critical is on.
    const target = this.vitals.staggered ? 0.42 : 0;
    this.pivot.position.y = THREE.MathUtils.damp(this.pivot.position.y, -target, 9, dt);
    this.body.material.color.setHex(this.vitals.staggered ? 0xa8724a : 0x8a6a58);
  }

  dispose() {
    this._off?.();
    this.hitboxes?.unregisterHurtbox(this);
    this.lockOn?.unregister(this);
    this.engine.resolve('renderer').scene.remove(this.group);
  }
}
