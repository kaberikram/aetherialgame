import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { AnimationSystem } from '../character/AnimationSystem.js';
import { Vitals } from '../combat/Vitals.js';
import { BoundCapsule, StaticCapsule } from '../combat/HitboxSystem.js';
import { buildDrowned } from './bossRig.js';
import { buildBossClips } from './clips/bossClips.js';
import { BOSS_MOVES, BOSS_STATS, bossMovesForPhase } from './data/bossMoves.js';

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

const STATE = Object.freeze({
  DORMANT: 'dormant',
  IDLE: 'idle',
  ATTACK: 'attack',
  SUBMERGED: 'submerged',
  BEACHING: 'beaching',
  STAGGER: 'stagger',
  DEAD: 'dead',
});

/**
 * BossController — the Drowned's state machine.
 *
 * Consumes exactly the same frame-data schema the player does, so "readable and
 * fair" is a structural property rather than a promise: startup is real, the
 * hitbox is bound to the limb the animation is swinging, and recovery is a
 * genuine punish window measured in the same units.
 *
 * Two things it deliberately does NOT do:
 *  - read player input, ever. It reacts to position and state only.
 *  - track the player through a swing. Every move stops turning at its
 *    `trackUntil` frame, so committing to a dodge direction is a real read
 *    rather than a coin flip against a homing attack.
 */
export class BossController {
  faction = 'enemy';
  criticalImmune = false;

  constructor(engine, { position, arena }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.scene = engine.resolve('renderer').scene;
    this.player = engine.resolve('player');
    this.damage = engine.resolve('damage');
    this.hitboxes = engine.resolve('hitboxes');
    this.arena = arena;

    this.name = BOSS_STATS.name;
    this.position = position.clone();
    this.homePosition = position.clone();
    this.facing = Math.PI;
    this.targetFacing = Math.PI;
    this.velocity = new THREE.Vector3();

    this.state = STATE.DORMANT;
    this.stateFrame = 0;
    this.phase = 1;
    this.alive = true;
    this.engaged = false;
    this.submerged = false;

    this.currentMove = null;
    this.moveFrame = 0;
    this.openHitboxes = [];
    this.cooldowns = new Map();
    this.lastMoveId = null;
    this.repeatCount = 0;
    this.idleTimer = 0;

    this.vitals = new Vitals(this.bus, this, {
      maxHealth: BOSS_STATS.maxHealth,
      maxPoise: BOSS_STATS.maxPoise,
      staggerFrames: BOSS_STATS.staggerFrames,
    });

    // Lock-on framing: a large target needs the camera further back or the
    // silhouette leaves the screen exactly when the telegraph matters most.
    this.lockHeight = 2.1;
    this.lockDistanceScale = 1.85;

    this.#build();
  }

  #build() {
    const { mesh, rig, group, hair, mask } = buildDrowned();
    this.mesh = mesh;
    this.rig = rig;
    this.group = group;
    this.hair = hair;
    this.mask = mask;
    group.position.copy(this.position);
    group.rotation.y = this.facing;
    this.scene.add(group);

    this.anim = new AnimationSystem(rig, this.bus);
    this.anim.register(...buildBossClips());
    this.anim.onEvent = (ev) => this.#onAnimEvent(ev);
    this.anim.play('bossIdle', { fadeFrames: 0 });

    // A tall, wide hurtbox. The core is the body, not the mask — hitting the
    // mask would mean the player has to aim upward at a thing standing over them.
    this.hurtbox = new StaticCapsule({ position: this.position, height: 2.9, radius: 1.05, yOffset: 0.2 });

    this._off = this.bus.on(EVENTS.HIT_LANDED, (e) => {
      if (e.victim === this) this.#onDamaged(e);
    });
  }

  register(hitboxes, lockOn) {
    hitboxes.registerHurtbox(this, this.hurtbox);
    lockOn?.register(this);
    this.lockOn = lockOn;
  }

  // ------------------------------------------------------------- encounter

  engage() {
    if (this.engaged) return;
    this.engaged = true;
    this.state = STATE.IDLE;
    this.stateFrame = 0;
    this.bus.emit(EVENTS.BOSS_ENCOUNTER_START, { id: 'drowned', name: this.name });
    this.bus.emit(EVENTS.BOSS_HEALTH_CHANGED, {
      id: 'drowned', current: this.vitals.health, max: this.vitals.maxHealth,
    });
    this.bus.emit(EVENTS.MUSIC_CUE, { id: 'bossPhase1' });
  }

  reset() {
    this.vitals.refill();
    this.alive = true;
    this.engaged = false;
    this.phase = 1;
    this.state = STATE.DORMANT;
    this.stateFrame = 0;
    this.currentMove = null;
    this.moveFrame = 0;
    this.submerged = false;
    this.cooldowns.clear();
    this.lastMoveId = null;
    this.repeatCount = 0;
    this.position.copy(this.homePosition);
    this.group.position.copy(this.position);
    this.facing = this.targetFacing = Math.PI;
    this.#closeHitboxes();
    this.anim.play('bossIdle', { fadeFrames: 0 });
    this.mesh.visible = true;
  }

  /**
   * Debug: hold the boss at one frame of one move.
   *
   * The rubric asks whether a paused wind-up is nameable, and answering that
   * honestly means posing the exact frame the frame data calls the tell —
   * not whichever frame the fight happened to be on when the screenshot fired.
   * `tools/rubric.mjs` drives this.
   *
   * @param {string} moveId a key of BOSS_MOVES
   * @param {number} [frame] defaults to the move's own peak wind-up
   */
  debugPose(moveId, frame = null) {
    const move = BOSS_MOVES[moveId];
    if (!move) throw new Error(`debugPose: no boss move "${moveId}"`);
    // One frame before the hitboxes open: the last moment the player still has
    // to read it, which is the only frame worth judging readability on.
    const at = frame ?? Math.max(0, move.startup - 1);

    this.alive = true;
    this.engaged = true;
    this.mesh.visible = true;
    this.submerged = false;
    this.phase = move.phase.includes(2) ? 2 : 1;
    this.state = STATE.ATTACK;
    this.currentMove = move;
    this.moveFrame = at;
    this.#closeHitboxes();

    this.anim.play(move.clip, { fadeFrames: 0 });
    this.anim.fixedUpdate(at / 60);
    return { moveId, frame: at, tell: move.tell };
  }

  // ------------------------------------------------------------------ loop

  fixedUpdate(dt) {
    const scale = this.damage?.timeScale ?? 1;
    const adt = dt * scale;

    this.stateFrame += scale;
    this.vitals.fixedUpdate(adt);
    for (const [id, n] of this.cooldowns) {
      if (n <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, n - scale);
    }

    if (this.state === STATE.DORMANT) {
      this.anim.fixedUpdate(adt);
      this.#applyTransform(adt);
      return;
    }

    switch (this.state) {
      case STATE.IDLE: this.#updateIdle(adt); break;
      case STATE.ATTACK: this.#updateAttack(adt); break;
      case STATE.SUBMERGED: this.#updateAttack(adt); break;
      case STATE.BEACHING: this.#updateBeaching(adt); break;
      case STATE.STAGGER: this.#updateStagger(adt); break;
      case STATE.DEAD: break;
    }

    this.anim.fixedUpdate(adt);
    this.#applyRootMotion(adt);
    this.#applyTransform(adt);
    this.hurtbox.update();
  }

  #distanceToPlayer() {
    _v.copy(this.player.position).sub(this.position);
    return Math.hypot(_v.x, _v.z);
  }

  #faceTowardPlayer(dt, rate = 2.2) {
    _v.copy(this.player.position).sub(this.position);
    this.targetFacing = Math.atan2(_v.x, _v.z);
    let delta = this.targetFacing - this.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = rate * dt;
    this.facing += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
  }

  // ------------------------------------------------------------------ idle

  /**
   * Phase one is strike-and-retreat: it does not crowd the player, it waits at
   * the edge of its range and punishes approaches. Phase two closes distance.
   */
  #updateIdle(dt) {
    this.#faceTowardPlayer(dt, this.phase === 2 ? 2.6 : 1.7);
    this.idleTimer += dt;

    const dist = this.#distanceToPlayer();

    // Drift toward the preferred spacing rather than standing perfectly still.
    const preferred = this.phase === 2 ? 4.2 : 6.4;
    const err = dist - preferred;
    if (Math.abs(err) > 1.2) {
      _v.copy(this.player.position).sub(this.position).setY(0).normalize();
      const speed = (this.phase === 2 ? 2.0 : 1.25) * Math.sign(err);
      this.velocity.x = _v.x * speed;
      this.velocity.z = _v.z * speed;
    } else {
      this.velocity.x *= 0.86;
      this.velocity.z *= 0.86;
    }

    const gap = this.phase === 2 ? 0.42 : 0.85;
    if (this.idleTimer < gap) return;

    const move = this.#chooseMove(dist);
    if (move) this.#startMove(move);
  }

  /**
   * Move selection. Weighted random over what is in range and off cooldown,
   * with an anti-repeat penalty so the fight does not collapse into one move.
   *
   * Deliberately NOT a fixed rotation: a memorised loop stops being a fight and
   * starts being a rhythm game. But it is also not uniform random — the
   * telegraph-heavy moves are common and the punishing ones are rare.
   */
  #chooseMove(dist) {
    const candidates = bossMovesForPhase(this.phase).filter((m) => {
      if (this.cooldowns.has(m.id)) return false;
      if (dist < m.range[0] || dist > m.range[1]) return false;
      return true;
    });
    if (!candidates.length) return null;

    let total = 0;
    const weighted = candidates.map((m) => {
      let w = m.weight;
      // Third consecutive use of the same move is heavily discouraged.
      if (m.id === this.lastMoveId) w *= this.repeatCount >= 1 ? 0.12 : 0.45;
      total += w;
      return { m, w };
    });

    let roll = Math.random() * total;
    for (const { m, w } of weighted) {
      roll -= w;
      if (roll <= 0) return m;
    }
    return weighted[weighted.length - 1].m;
  }

  #startMove(move) {
    this.currentMove = move;
    this.moveFrame = 0;
    this.idleTimer = 0;
    this.state = move.reposition ? STATE.SUBMERGED : STATE.ATTACK;
    this.stateFrame = 0;
    this.repeatCount = move.id === this.lastMoveId ? this.repeatCount + 1 : 0;
    this.lastMoveId = move.id;
    this.cooldowns.set(move.id, move.cooldown);

    this.anim.play(move.clip, { fadeFrames: 4 });
    this.bus.emit(EVENTS.BOSS_WINDUP, { id: 'drowned', moveId: move.id, tell: move.tell });
    if (move.windupSfx) this.bus.emit(EVENTS.SFX, { id: move.windupSfx, position: this.position });
  }

  #updateAttack(dt) {
    const move = this.currentMove;
    this.moveFrame += this.damage?.timeScale ?? 1;

    // Tracking stops at trackUntil. After that the attack is committed to the
    // direction it was aimed, which is what makes dodging it a read.
    if (this.moveFrame < move.trackUntil) {
      this.#faceTowardPlayer(dt, this.phase === 2 ? 3.0 : 2.2);
    }

    const [a0, a1] = move.active;
    const shouldBeOpen = a0 >= 0 && this.moveFrame >= a0 && this.moveFrame <= a1;
    if (shouldBeOpen && !this.openHitboxes.length) this.#openHitboxes(move);
    else if (!shouldBeOpen && this.openHitboxes.length) this.#closeHitboxes();

    if (this.moveFrame >= move.frames) {
      this.#closeHitboxes();
      this.currentMove = null;
      this.state = STATE.IDLE;
      this.stateFrame = 0;
      this.idleTimer = 0;
    }
  }

  #openHitboxes(move) {
    const specs = [move.hitbox, ...(move.extraHitboxes ?? [])].filter(Boolean);
    for (const spec of specs) {
      const capsule = new BoundCapsule(spec).bind(this.rig);
      this.hitboxes.activate({
        owner: this,
        capsule,
        move,
        faction: 'enemy',
        onHit: (entity, point, m) => {
          const res = this.damage.resolve(this, entity, m, point);
          if (res?.outcome === 'deflect') this.#onDeflected();
        },
      });
      this.openHitboxes.push(capsule);
    }
    this.bus.emit(EVENTS.ATTACK_ACTIVE, { entity: this, moveId: move.id });
  }

  #closeHitboxes() {
    if (!this.openHitboxes.length) return;
    this.hitboxes.deactivate(this);
    this.openHitboxes.length = 0;
  }

  /** A deflect cuts the recovery short in the player's favour, not the boss's. */
  #onDeflected() {
    this.#closeHitboxes();
    if (this.currentMove) this.moveFrame = Math.max(this.moveFrame, this.currentMove.active[1] + 1);
  }

  // -------------------------------------------------------------- reactions

  #onDamaged({ staggered, died, damage }) {
    this.bus.emit(EVENTS.BOSS_HEALTH_CHANGED, {
      id: 'drowned', current: this.vitals.health, max: this.vitals.maxHealth,
    });

    if (died) return this.#die();

    // The phase change is a SCRIPTED event triggered by crossing a threshold,
    // not a stat swap. It interrupts whatever is happening.
    if (this.phase === 1
      && this.vitals.healthNormalized <= BOSS_STATS.phaseTwoAt
      && this.state !== STATE.BEACHING) {
      return this.#beginBeaching();
    }

    if (staggered) {
      this.#closeHitboxes();
      this.state = STATE.STAGGER;
      this.stateFrame = 0;
      this.currentMove = null;
      this.anim.play('bossStagger', { fadeFrames: 2 });
      return;
    }

    if (this.state !== STATE.BEACHING && this.state !== STATE.STAGGER) {
      this.anim.play('bossHit', {
        layer: 'upper',
        mask: ['torso', 'chest', 'neck', 'head'],
        fadeFrames: 1,
      });
    }
  }

  #updateStagger(dt) {
    this.velocity.multiplyScalar(0.8);
    if (this.stateFrame >= BOSS_STATS.staggerFrames) {
      this.state = STATE.IDLE;
      this.stateFrame = 0;
      this.idleTimer = 0;
      this.anim.play('bossIdle', { fadeFrames: 8 });
    }
  }

  // ------------------------------------------------------- phase transition

  #beginBeaching() {
    this.#closeHitboxes();
    this.state = STATE.BEACHING;
    this.stateFrame = 0;
    this.currentMove = null;
    this.vitals.invulnerable = true;
    this.velocity.set(0, 0, 0);
    this.anim.play('bossBeach', { fadeFrames: 6 });
    this.bus.emit(EVENTS.MUSIC_CUE, { id: 'bossTransition' });
  }

  #updateBeaching() {
    // Faces the centre of the dais while hauling itself out, so the player can
    // always see the whole silhouette during the one moment it holds still.
    if (this.stateFrame >= 210) {
      this.state = STATE.IDLE;
      this.stateFrame = 0;
      this.idleTimer = 0;
      this.vitals.invulnerable = false;
      this.anim.play('bossIdle', { fadeFrames: 10 });
    }
  }

  #onAnimEvent(ev) {
    switch (ev.type) {
      case 'phase2':
        this.phase = 2;
        this.vitals.poise = this.vitals.maxPoise;
        this.bus.emit(EVENTS.BOSS_PHASE_CHANGED, { id: 'drowned', phase: 2 });
        this.bus.emit(EVENTS.MUSIC_CUE, { id: 'bossPhase2' });
        break;
      case 'submerged':
        this.submerged = true;
        this.#repositionUnderwater();
        break;
      case 'surfacing':
        this.bus.emit(EVENTS.SFX, { id: 'bossSurface', position: this.position });
        break;
      case 'surfaced':
        this.submerged = false;
        break;
      case 'shake':
        this.engine.resolve('camera').addShake(ev.strength);
        break;
      case 'waterBurst':
        this.arena?.burst(this.position, ev.strength ?? 1);
        break;
      case 'tell':
      case 'sfx':
        this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position });
        break;
    }
  }

  /**
   * Surfaces somewhere the player is not looking. This is the camera lesson:
   * if you have not learned to break lock and sweep the pool, you lose it.
   */
  #repositionUnderwater() {
    const arena = this.arena;
    const radius = (arena?.radius ?? 12) * 0.62;
    const camForward = new THREE.Vector3();
    this.engine.resolve('renderer').camera.getWorldDirection(camForward);
    const camYaw = Math.atan2(camForward.x, camForward.z);

    // Pick the candidate furthest from where the camera is currently pointed.
    let best = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const p = new THREE.Vector3(
        this.player.position.x + Math.cos(a) * radius,
        this.homePosition.y,
        this.player.position.z + Math.sin(a) * radius
      );
      if (arena && !arena.contains(p)) continue;
      const toP = Math.atan2(p.x - this.player.position.x, p.z - this.player.position.z);
      let d = Math.abs(toP - camYaw);
      while (d > Math.PI) d = Math.PI * 2 - d;
      if (!best || d > best.score) best = { p, score: d };
    }
    if (best) {
      this.position.copy(best.p);
      this.group.position.copy(this.position);
    }
  }

  #die() {
    this.alive = false;
    this.state = STATE.DEAD;
    this.stateFrame = 0;
    this.#closeHitboxes();
    this.anim.play('bossDeath', { fadeFrames: 4 });
    this.lockOn?.unregister(this);
    this.bus.emit(EVENTS.BOSS_DEFEATED, { id: 'drowned' });
    this.bus.emit(EVENTS.MUSIC_CUE, { id: 'bossDefeated' });
  }

  // ------------------------------------------------------------- transform

  #applyRootMotion(dt) {
    const rm = this.anim.consumeRootMotion(_v);
    if (rm.lengthSq() < 1e-9) {
      // Root-motion states must not coast on a stale velocity between keys.
      if (this.state === 'attack' || this.state === 'submerged') {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
      return;
    }
    _q.setFromAxisAngle(_up, this.facing);
    _v.applyQuaternion(_q);
    if (dt > 0) {
      this.velocity.x = _v.x / dt;
      this.velocity.z = _v.z / dt;
    }
    this.position.y += rm.y;
  }

  #applyTransform(dt) {
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // Kept inside the arena. A boss that can be kited off the dais is a boss
    // the arena design does not matter for.
    if (this.arena) this.arena.clamp(this.position, 1.6);

    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    // Hair drifts behind the movement, which is most of what sells the
    // creature as something that lives in water.
    const drift = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) * 0.12);
    this.hair.rotation.x = THREE.MathUtils.damp(this.hair.rotation.x, -0.35 * drift, 5, dt);
  }

  dispose() {
    this._off?.();
    this.#closeHitboxes();
    this.hitboxes.unregisterHurtbox(this);
    this.lockOn?.unregister(this);
    this.scene.remove(this.group);
  }
}

export { STATE as BOSS_STATE };
