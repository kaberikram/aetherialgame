import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { ACTION } from '../input/Actions.js';
import { InputBuffer } from '../input/InputBuffer.js';
import { buildCharacter } from './Rig.js';
import { AnimationSystem } from './AnimationSystem.js';
import { buildLocomotionClips } from './clips/gait.js';
import { buildActionClips } from './clips/actions.js';
import { Stamina } from './Stamina.js';
import { Vitals } from '../combat/Vitals.js';
import { Alignment } from './Alignment.js';
import { Flight } from './Flight.js';
import { toonMaterial } from '../render/npr/ToonMaterial.js';

/**
 * The state machine, trimmed to locomotion and narrative.
 *
 * Attack, guard, deflect, stagger and critical are gone with the combat
 * framework. They come back with it — the deletions were at the seams the
 * module contract already declared, not through them — but while the question
 * on the table is "does moving feel good", a state you cannot enter is a state
 * that only makes the machine harder to read.
 */
export const STATE = Object.freeze({
  DRIFT: 'drift',         // beat 1: a formless light, weightless, no collision
  CORPSE: 'corpse',       // the body, before the light enters it
  STAND_UP: 'standUp',    // beat 2: embodiment
  IDLE: 'idle',
  MOVE: 'move',
  JUMP_START: 'jumpStart',
  AIRBORNE: 'airborne',
  LAND: 'land',
  LAND_HARD: 'landHard',
  ROLL: 'roll',
  BACKSTEP: 'backstep',
  DRINK: 'drink',
  DEAD: 'dead',
  FLIGHT: 'flight',
});

/** States that commit: input cannot pull the character out of them. */
const COMMITTED = new Set([
  STATE.ROLL, STATE.BACKSTEP, STATE.LAND_HARD, STATE.JUMP_START, STATE.STAND_UP,
  STATE.CORPSE, STATE.DRINK, STATE.DEAD,
]);
/** States whose horizontal motion comes from the animation, not from input. */
const ROOT_MOTION_STATES = new Set([
  STATE.ROLL, STATE.BACKSTEP, STATE.STAND_UP, STATE.DEAD, STATE.DRINK,
]);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _groundHit = new THREE.Vector3();
/** Reused across every contact read, so the fixed step allocates nothing. */
let _collision = null;
/** cos of the climb limit: above this a surface is floor, below it is wall. */
const _maxSlopeCos = Math.cos(THREE.MathUtils.degToRad(TUNING.movement.maxSlopeDegrees));

/**
 * PlayerController — owns the player state machine and turns input intent into
 * motion requests.
 *
 * It never writes to the physics body directly (that goes through the Rapier
 * character controller) and never computes damage (that is DamageSystem's job).
 *
 * The design rule this file exists to enforce: an action, once started, runs to
 * its recovery. There is no escape branch out of a committed state anywhere in
 * here, and that absence is the whole feel of the genre.
 */
export class PlayerController {
  faction = 'player';

  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.input = engine.resolve('input');
    this.renderer = engine.resolve('renderer');

    this.state = STATE.IDLE;
    this.stateFrame = 0;
    this.prevState = null;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.targetFacing = 0;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.coyoteFrames = 0;
    this.jumpBufferFrames = 0;
    this.invulnerable = false;
    this.waterDepth = 0;
    this.hasWeapon = false;

    this.stamina = new Stamina(this.bus);
    this.vitals = new Vitals(this.bus, this, {
      maxHealth: TUNING.health.playerMax,
      maxPoise: TUNING.health.poiseMax,
    });
    this.buffer = new InputBuffer();

    this.flaskCharges = TUNING.health.flaskCharges;

    /** Filled by LockOn when combat returns; the controller only reads it. */
    this.lockTarget = null;

    this.#buildBody();
  }

  #buildBody() {
    const { mesh, rig } = buildCharacter();
    this.mesh = mesh;
    this.rig = rig;
    this.root = new THREE.Group();
    this.root.add(mesh);
    this.renderer.scene.add(this.root);

    // The sword is parented to the hand bone, so it follows the animation with
    // no extra bookkeeping. It is inert until combat returns — the pickup is
    // still a beat in the chapter, and a beat that hands you nothing visible
    // is a beat the player will not believe happened.
    this.sword = buildHeldSword();
    this.sword.visible = false;
    rig.byName.get('hand.R').add(this.sword);

    this.anim = new AnimationSystem(rig, this.bus);
    this.anim.register(...buildLocomotionClips(), ...buildActionClips());
    this.anim.onEvent = (ev) => this.#onAnimEvent(ev);
    this.anim.play('idle', { fadeFrames: 0 });

    const m = TUNING.movement;
    const body = this.physics.createCharacter({
      position: new THREE.Vector3(0, 2, 0),
      radius: m.capsuleRadius,
      halfHeight: m.capsuleHalfHeight,
      maxSlopeDegrees: m.maxSlopeDegrees,
      minSlideSlopeDegrees: m.minSlideSlopeDegrees,
      stepOffset: m.stepOffset,
      snapDistance: m.snapToGroundDistance,
    });
    this.body = body.body;
    this.collider = body.collider;
    this.controller = body.controller;
    this.capsuleOffset = m.capsuleHalfHeight + m.capsuleRadius;
    this.position.set(0, 2, 0);
  }

  /** Wired after construction; needs GameState, which needs the engine. */
  attachAlignment() {
    this.alignment = new Alignment(this.engine, this);
    this.flight = new Flight(this.engine, this, this.alignment);
    this.alignment.assemble();
    return this.alignment;
  }

  giveWeapon() {
    this.hasWeapon = true;
    this.sword.visible = true;
    this.bus.emit(EVENTS.ITEM_PICKED_UP, { id: 'sword' });
  }

  // ------------------------------------------------------------------ state

  setState(next, { force = false } = {}) {
    if (this.state === next && !force) return false;
    this.prevState = this.state;
    this.state = next;
    this.stateFrame = 0;
    this.bus.emit(EVENTS.PLAYER_STATE_CHANGED, { from: this.prevState, to: next });
    return true;
  }

  /** True when the player is free to start a new action. */
  canAct() {
    if (this.state === STATE.DEAD) return false;
    if (COMMITTED.has(this.state)) {
      // Roll cancels into roll only, and only once it has reached recovery.
      if (this.state === STATE.ROLL) return this.stateFrame >= TUNING.roll.recoveryStartFrame;
      if (this.state === STATE.BACKSTEP) return this.stateFrame >= 22;
      return false;
    }
    return true;
  }

  /** Buffering is legal only in recovery. Never during active frames. */
  #inRecovery() {
    switch (this.state) {
      case STATE.ROLL: return this.stateFrame >= TUNING.roll.recoveryStartFrame - 8;
      case STATE.BACKSTEP: return this.stateFrame >= 16;
      case STATE.LAND_HARD: return this.stateFrame >= 12;
      case STATE.LAND: return true;
      case STATE.DRINK: return this.stateFrame >= TUNING.health.flaskDrinkFrames - 12;
      default: return false;
    }
  }

  /**
   * What is under the feet right now, for footstep audio.
   *
   * Water wins over the zone because the arena's depth field is the thing the
   * player is actually standing in, and a stone footfall while shin-deep in
   * the pool is the kind of detail that breaks a room.
   */
  currentSurface() {
    if ((this.waterDepth ?? 0) > 0.5) return 'waterDeep';
    if ((this.waterDepth ?? 0) > 0.06) return 'water';
    switch (this.engine.resolve('state').zone) {
      case 'greenVein': return 'wetStone';
      case 'starChamber': return 'wetStone';
      case 'pagodaWell': return 'stone';
      default: return 'gravel';
    }
  }

  #onAnimEvent(ev) {
    switch (ev.type) {
      case 'iframes-on': this.invulnerable = true; break;
      case 'iframes-off': this.invulnerable = false; break;
      case 'launch': this.#launchJump(); break;
      case 'embodied':
        this.bus.emit(EVENTS.PLAYER_EMBODIED);
        this.setState(STATE.IDLE);
        break;
      case 'heal':
        this.vitals.heal(TUNING.health.flaskHealAmount);
        break;
      case 'foot':
        this.bus.emit(EVENTS.PLAYER_FOOTSTEP, {
          foot: ev.foot,
          surface: this.currentSurface(),
          position: this.position,
        });
        break;
      case 'sfx': this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position }); break;
      case 'swing': this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position }); break;
      case 'camera-shake': this.engine.resolve('camera').addShake(ev.strength); break;
    }
  }

  // ------------------------------------------------------------------- loop

  fixedUpdate(dt, ctx) {
    this.stateFrame += 1;
    this.stamina.fixedUpdate(dt);
    this.vitals.fixedUpdate(dt);

    if (this.state === STATE.DRIFT) {
      this.#updateDrift(dt);
      this.anim.fixedUpdate(dt);
      return;
    }

    if (this.state === STATE.DEAD) {
      this.anim.fixedUpdate(dt);
      this.#updateMotion(dt);
      return;
    }

    // Flight replaces ground motion entirely when it is active. It is checked
    // before intent so a takeoff cannot be interleaved with a ground action.
    const flying = this.flight?.fixedUpdate(dt) ?? false;
    if (flying) {
      if (this.state !== STATE.FLIGHT) {
        this.setState(STATE.FLIGHT, { force: true });
        this.anim.play('fall', { fadeFrames: 6 });
      }
      this.#integrate(dt);
      this.anim.fixedUpdate(dt);
      this.alignment?.update(dt, { flying: true, flapPhase: this.flight.flapPhase });
      this.flight.applyPose(this.root);
      return;
    }
    if (this.state === STATE.FLIGHT) this.setState(this.grounded ? STATE.LAND : STATE.AIRBORNE, { force: true });

    this.#readIntent(ctx.frame);
    this.#updateFacing(dt);
    this.#updateMotion(dt);
    this.anim.fixedUpdate(dt);
    this.#updateAnimationState();
    this.alignment?.update(dt, { flying: false });
    this.flight?.applyPose(this.root);
  }

  // ------------------------------------------------------------- beat 1: void

  /**
   * The drifting light. No collision, no gravity, no ground — input moves the
   * point directly with heavy damping so it feels like swimming rather than
   * walking. The absence of weight here is the entire point: it is what makes
   * the body, sixty seconds later, feel like a cost.
   */
  #updateDrift(dt) {
    const move = this.input.move;
    const cam = this.renderer.camera;
    cam.getWorldDirection(_v);
    _v.y = 0;
    _v.normalize();
    // Camera-right is forward × up. The extra ×−1 that used to be here made it
    // camera-LEFT, so drifting with D in the opening moved the wisp the wrong
    // way — the very first control input the game ever asks for.
    _v2.copy(_v).cross(_up);

    _flat.set(0, 0, 0).addScaledVector(_v, move.y).addScaledVector(_v2, move.x);
    const vertical = (this.input.actions[ACTION.JUMP].held ? 1 : 0)
      - (this.input.actions[ACTION.DODGE].held ? 1 : 0);

    this.velocity.addScaledVector(_flat, 5.2 * dt);
    this.velocity.y += vertical * 4.0 * dt;
    this.velocity.multiplyScalar(Math.pow(0.14, dt));
    this.position.addScaledVector(this.velocity, dt);
    this.root.position.copy(this.position);
  }

  // -------------------------------------------------------------- intent

  #readIntent(frame) {
    const inp = this.input;

    if (inp.actions[ACTION.JUMP].pressed) this.jumpBufferFrames = TUNING.movement.jumpBufferFrames;
    else if (this.jumpBufferFrames > 0) this.jumpBufferFrames--;

    // --- dodge -----------------------------------------------------------
    if (inp.actions[ACTION.DODGE].pressed) {
      if (this.canAct()) this.#tryDodge();
      else if (this.#inRecovery()) this.buffer.push(ACTION.DODGE, inp.move, frame);
    }

    // --- flask -----------------------------------------------------------
    if (inp.actions[ACTION.USE_ITEM].pressed) {
      if (this.canAct()) this.#tryDrink();
      else if (this.#inRecovery()) this.buffer.push(ACTION.USE_ITEM, inp.move, frame);
    }

    // --- drain the buffer -------------------------------------------------
    if (this.canAct()) {
      const queued = this.buffer.peek(frame);
      if (queued) {
        this.buffer.consume(frame);
        if (queued.action === ACTION.DODGE) this.#tryDodge(queued.move);
        else if (queued.action === ACTION.USE_ITEM) this.#tryDrink();
      }
    }

    if (this.canAct() && this.jumpBufferFrames > 0 && (this.grounded || this.coyoteFrames > 0)) {
      this.jumpBufferFrames = 0;
      this.#startJump();
    }
  }

  #tryDodge(moveOverride = null) {
    if (!this.grounded && this.coyoteFrames <= 0) return;
    if (!this.stamina.canAct) return;
    // Landing recovery. CONTROLS.md has always documented this window as
    // "cannot attack or roll during this", and it was never actually enforced
    // — `jumpRecoveryFrames` was read by nothing. Rolling out of a landing on
    // frame one is exactly the kind of escape hatch this genre does not have.
    if (this.state === STATE.LAND && this.stateFrame < TUNING.movement.jumpRecoveryFrames) return;

    // Direction is captured HERE, at the press, and never re-read during the
    // animation. A roll is a deliberate read of the stick at input time.
    const move = moveOverride ?? this.input.move;
    const hasDirection = Math.hypot(move.x, move.y) > 0.2;

    if (!hasDirection) {
      if (!this.stamina.spend(TUNING.roll.backstepStaminaCost, 'backstep')) return;
      this.setState(STATE.BACKSTEP, { force: true });
      this.anim.play('backstep', { fadeFrames: 2 });
      return;
    }

    const deep = this.waterDepth > TUNING.water.shallowDepth;
    const cost = TUNING.roll.staminaCost * (deep ? TUNING.water.staminaMultiplierDeep : 1);

    // Dark's dash: when stamina is gone it will still go, and charge health for
    // it. That is the branch's whole character — it can always keep pressing,
    // and pressing is what kills it.
    if (!this.stamina.canAct && this.alignment?.hasCostDash) {
      const hp = TUNING.alignment.dark.dashHealthCost;
      if (this.vitals.health > hp + 1) {
        this.vitals.applyDamage(hp, 0, 'dash');
        this.targetFacing = this.#cameraRelativeYaw(move);
        this.facing = this.targetFacing;
        this.setState(STATE.ROLL, { force: true });
        this.anim.play('roll', { fadeFrames: 2 });
        this.bus.emit(EVENTS.SFX, { id: 'darkDash', position: this.position });
        return;
      }
    }
    if (!this.stamina.spend(cost, 'roll')) return;

    this.targetFacing = this.#cameraRelativeYaw(move);
    this.facing = this.targetFacing; // rolls snap to their direction instantly
    this.setState(STATE.ROLL, { force: true });
    this.anim.play('roll', { fadeFrames: 2 });
  }

  // ----------------------------------------------------------------- flask

  #tryDrink() {
    if (this.flaskCharges <= 0 || !this.grounded) return;
    this.flaskCharges--;
    this.setState(STATE.DRINK, { force: true });
    this.anim.play('drink', { fadeFrames: 3 });
    this.bus.emit(EVENTS.FLASK_USED, { charges: this.flaskCharges });
  }

  refillFlask() {
    this.flaskCharges = TUNING.health.flaskCharges;
    this.bus.emit(EVENTS.FLASK_USED, { charges: this.flaskCharges });
  }

  // -------------------------------------------------------- damage received

  /**
   * Damage arriving from anywhere — currently only a hard landing, since the
   * damage system is out. Kept whole because the death/respawn loop below is
   * what a fall is *for*, and it is the one consequence the movement sandbox
   * still has.
   */
  onDamaged({ died }) {
    if (died) return this.die();
    // A light hit plays on the upper-body layer only, so the legs keep running.
    // A full-body flinch on chip damage reads as a stun and stops the game.
    if (!COMMITTED.has(this.state)) {
      this.anim.play('hitLight', {
        layer: 'upper',
        mask: ['spine', 'chest', 'neck', 'head', 'shoulder', 'upperArm', 'lowerArm', 'hand'],
        fadeFrames: 1,
      });
    }
  }

  die() {
    if (this.state === STATE.DEAD) return;
    this.setState(STATE.DEAD, { force: true });
    this.anim.play('death', { fadeFrames: 2 });
    this.anim.stopLayer('upper', 2);
    this.invulnerable = true;
    this.bus.emit(EVENTS.PLAYER_DIED, { position: this.position.clone() });
  }

  respawn(position, facing = 0) {
    this.vitals.refill();
    this.stamina.refill();
    this.refillFlask();
    this.invulnerable = false;
    this.buffer.clear();
    this.facing = this.targetFacing = facing;
    this.root.rotation.y = facing;
    this.teleport(position);
    this.setState(STATE.IDLE, { force: true });
    this.anim.play('idle', { fadeFrames: 0 });
    this.bus.emit(EVENTS.PLAYER_RESPAWNED, { position });
  }

  // ------------------------------------------------------------------ jump

  #startJump() {
    this.setState(STATE.JUMP_START);
    this.anim.play('jumpStart', { fadeFrames: 3 });
  }

  #launchJump() {
    this.velocity.y = TUNING.movement.jumpVelocity;
    this.grounded = false;
    this.coyoteFrames = 0;
    this.setState(STATE.AIRBORNE);
    this.anim.play('jumpAir', { fadeFrames: 4 });
  }

  /**
   * Turn stick/WASD intent into a world facing, relative to the camera.
   *
   * The offset SUBTRACTS. Movement resolves to `(sin(yaw), cos(yaw))`, so a
   * facing of `camYaw` walks along the camera's forward — but camera-right is
   * forward rotated MINUS ninety degrees about Y, not plus. Adding the offset
   * instead of subtracting it sent A and D the wrong way, which is what made
   * the controls feel inverted.
   *
   * Verified by `tools/controls.mjs`, which drives each key and projects the
   * resulting displacement onto the camera's own basis.
   */
  #cameraRelativeYaw(move) {
    const cam = this.renderer.camera;
    cam.getWorldDirection(_v);
    _v.y = 0;
    _v.normalize();
    const camYaw = Math.atan2(_v.x, _v.z);
    return camYaw - Math.atan2(move.x, move.y);
  }

  // -------------------------------------------------------------- facing

  #updateFacing(dt) {
    const m = TUNING.movement;
    const move = this.input.move;
    const moving = Math.hypot(move.x, move.y) > 0.05;

    if (this.lockTarget) {
      _v.copy(this.lockTarget.position).sub(this.position);
      this.targetFacing = Math.atan2(_v.x, _v.z);
    } else if (moving && !ROOT_MOTION_STATES.has(this.state)) {
      this.targetFacing = this.#cameraRelativeYaw(move);
    }

    let rate = m.turnRateWalk;
    if (ROOT_MOTION_STATES.has(this.state)) rate = 0; // committed actions do not steer
    else if (this.lockTarget) rate = m.turnRateLocked;
    else if (this.state === STATE.MOVE) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      rate = speed > m.runSpeed * 1.05 ? m.turnRateSprint
        : speed > m.walkSpeed * 1.2 ? m.turnRateRun
        : m.turnRateWalk;
    }
    if (rate <= 0) return;

    // Rate-limited turning is where a lot of "weight" comes from: a 180 costs
    // real time, so committing to a direction is a decision.
    let delta = this.targetFacing - this.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = rate * dt;
    this.facing += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
  }

  // -------------------------------------------------------------- motion

  #speedForInput() {
    const m = TUNING.movement;
    const inp = this.input;
    const mag = Math.min(1, Math.hypot(inp.move.x, inp.move.y));
    if (mag < 0.001) return 0;
    const wantsSprint = inp.actions[ACTION.SPRINT].held && mag > 0.7
      && this.stamina.canAct && !this.stamina.exhausted;
    const base = wantsSprint
      ? m.sprintSpeed
      : THREE.MathUtils.lerp(m.walkSpeed * 0.55, m.runSpeed, Math.min(1, mag));
    return base * this.#slopeSpeedScale();
  }

  /**
   * Uphill costs speed; downhill does not give it back.
   *
   * `groundNormal` was declared in this class and never written or read, so
   * every slope in the chapter walked exactly like flat ground — which is a
   * strange thing for a chapter whose entire shape is a descent. Now that the
   * floor is analytic ramps rather than a sampled trimesh, the normal is
   * stable enough to drive feel off.
   *
   * Downhill deliberately does NOT speed the player up: free acceleration on a
   * decline reads as losing control, and this chapter is one long decline.
   */
  #slopeSpeedScale() {
    if (!this.grounded) return 1;
    const m = TUNING.movement;
    // The component of the facing direction that points uphill. Positive when
    // climbing, negative when descending.
    const climb = -(Math.sin(this.facing) * this.groundNormal.x
      + Math.cos(this.facing) * this.groundNormal.z);
    if (climb <= 0) return 1;
    return THREE.MathUtils.lerp(1, m.slopeSpeedUphill, Math.min(1, climb / 0.6));
  }

  #updateMotion(dt) {
    const m = TUNING.movement;
    const useRootMotion = ROOT_MOTION_STATES.has(this.state);

    if (useRootMotion) {
      const rm = this.anim.consumeRootMotion(_v);
      _q.setFromAxisAngle(_up, this.facing);
      _v.applyQuaternion(_q);
      const scale = this.#waterRollScale();
      this.velocity.x = dt > 0 ? (_v.x * scale) / dt : 0;
      this.velocity.z = dt > 0 ? (_v.z * scale) / dt : 0;
    } else if (this.state === STATE.LAND_HARD || this.state === STATE.JUMP_START) {
      this.velocity.x *= Math.pow(0.02, dt);
      this.velocity.z *= Math.pow(0.02, dt);
    } else {
      const speed = this.#speedForInput() * this.#waterSpeedScale();
      const wantsSprint = speed > m.runSpeed + 0.01;
      if (wantsSprint && this.grounded) {
        this.stamina.drain(TUNING.stamina.sprintDrainPerSecond, dt);
      }

      const move = this.input.move;
      const mag = Math.hypot(move.x, move.y);
      if (mag > 0.05) {
        const yaw = this.lockTarget ? this.#cameraRelativeYaw(move) : this.facing;
        _flat.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
      } else {
        _flat.set(0, 0, 0);
      }

      const accel = this.grounded ? (mag > 0.05 ? m.groundAccel : m.groundDecel) : m.airAccel;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, _flat.x, accel, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, _flat.z, accel, dt);
    }

    if (!this.grounded) {
      const g = this.velocity.y < 0 ? m.gravity * m.fallMultiplier : m.gravity;
      this.velocity.y = Math.max(m.maxFallSpeed, this.velocity.y + g * dt);
    } else if (this.velocity.y < 0) {
      this.velocity.y = -2;
    }

    this.#integrate(dt, { resolveLanding: true });
  }

  /**
   * Move the capsule by the current velocity and read back what the world
   * allowed. Shared by walking and flying so there is exactly one place that
   * writes to the physics body.
   */
  #integrate(dt, { resolveLanding = true } = {}) {
    _v.set(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    this.controller.computeColliderMovement(this.collider, { x: _v.x, y: _v.y, z: _v.z });
    const corrected = this.controller.computedMovement();

    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    this.#readContacts();

    const t = this.body.translation();
    const nx = t.x + corrected.x;
    const ny = t.y + corrected.y;
    const nz = t.z + corrected.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - this.capsuleOffset, nz);

    // Wall scrub: when a wall stops you, most of your speed into it should go
    // with it, or you peel along the surface at full pace and it reads as ice.
    //
    // This used to fire on *any* axis the controller shortened by more than
    // half — which includes every legitimate step-up and every slope climb,
    // because autostep and slope resolution both return less horizontal motion
    // than was asked for. Walking up stairs cut your speed to a fifth on the
    // frame each step was cleared, which is the stutter that made the descent
    // feel bad. Now it needs an actual near-vertical surface in contact.
    if (this.wallContact) {
      if (Math.abs(corrected.x) < Math.abs(_v.x) * 0.5) this.velocity.x *= 0.2;
      if (Math.abs(corrected.z) < Math.abs(_v.z) * 0.5) this.velocity.z *= 0.2;
    }

    if (resolveLanding) this.#resolveGroundTransitions(wasGrounded);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;
  }

  /**
   * Reads what the capsule actually touched this step: the ground's normal,
   * and whether anything near-vertical is in the way.
   *
   * `normal1` is the *collider's* normal — the surface the character hit —
   * which is the one that describes the world. `normal2` is the character
   * capsule's own and points back the other way.
   */
  #readContacts() {
    // Allocated once, on the first step, and refilled in place thereafter.
    // Rapier allocates a fresh CharacterCollision per call when `out` is
    // omitted, and this runs for every contact of every fixed step.
    if (!_collision) _collision = new this.physics.RAPIER.CharacterCollision();
    const n = this.controller.numComputedCollisions();
    this.wallContact = false;
    let bestUp = -1;
    for (let i = 0; i < n; i++) {
      const hit = this.controller.computedCollision(i, _collision);
      if (!hit) continue;
      const ny = hit.normal1.y;
      // A surface counts as a wall once it is too steep to stand on. Reusing
      // the climb limit means "wall" and "cannot walk up this" are the same
      // question, answered once.
      if (Math.abs(ny) < _maxSlopeCos) this.wallContact = true;
      if (ny > bestUp) {
        bestUp = ny;
        _groundHit.set(hit.normal1.x, ny, hit.normal1.z);
      }
    }
    if (bestUp > _maxSlopeCos) this.groundNormal.copy(_groundHit).normalize();
    else if (this.grounded) this.groundNormal.set(0, 1, 0);
  }

  /** Ground steepness in degrees. Read by the debug inspector. */
  get slopeAngle() {
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(this.groundNormal.y, -1, 1)));
  }

  #waterSpeedScale() {
    const w = TUNING.water;
    if (this.waterDepth <= 0.01) return 1;
    const t = THREE.MathUtils.clamp((this.waterDepth - w.shallowDepth) / (w.deepDepth - w.shallowDepth), 0, 1);
    return THREE.MathUtils.lerp(w.speedAtShallow, w.speedAtDeep, t);
  }

  #waterRollScale() {
    const w = TUNING.water;
    if (this.waterDepth <= 0.01) return 1;
    const t = THREE.MathUtils.clamp((this.waterDepth - w.shallowDepth) / (w.deepDepth - w.shallowDepth), 0, 1);
    return THREE.MathUtils.lerp(w.rollDistanceAtShallow, w.rollDistanceAtDeep, t);
  }

  #resolveGroundTransitions(wasGrounded) {
    const m = TUNING.movement;

    if (this.grounded) {
      this.coyoteFrames = m.coyoteFrames;
      if (!wasGrounded) {
        const impact = -this.velocity.y;
        this.velocity.y = 0;
        this.bus.emit(EVENTS.PLAYER_LANDED, { impactSpeed: impact });

        if (impact > m.fallDamageThreshold && this.state !== STATE.DEAD) {
          const fatal = impact > m.fallDeathSpeed;
          const dmg = fatal
            ? this.vitals.maxHealth * 2
            : (impact - m.fallDamageThreshold) * m.fallDamagePerSpeed;
          const res = this.vitals.applyDamage(dmg, 0, 'fall');
          if (res.died) return this.die();
        }

        if (impact > m.landHardThreshold) {
          this.setState(STATE.LAND_HARD, { force: true });
          this.anim.play('landHard', { fadeFrames: 2 });
        } else if (impact > 5) {
          this.setState(STATE.LAND, { force: true });
          this.anim.play('land', { fadeFrames: 3 });
        } else if (!COMMITTED.has(this.state)) {
          this.setState(STATE.IDLE);
        }
      }
    } else {
      if (this.coyoteFrames > 0) this.coyoteFrames--;
      if (wasGrounded && !COMMITTED.has(this.state) && this.state !== STATE.AIRBORNE) {
        this.setState(STATE.AIRBORNE);
        this.anim.play('fall', { fadeFrames: 8 });
      }
    }
  }

  // ------------------------------------------------------- animation state

  #updateAnimationState() {
    switch (this.state) {
      case STATE.ROLL:
        if (this.stateFrame >= TUNING.roll.totalFrames) this.setState(this.grounded ? STATE.IDLE : STATE.AIRBORNE);
        return;
      case STATE.BACKSTEP:
        if (this.stateFrame >= TUNING.roll.backstepFrames) this.setState(this.grounded ? STATE.IDLE : STATE.AIRBORNE);
        return;
      case STATE.LAND:
        if (this.stateFrame >= 14) this.setState(STATE.IDLE);
        return;
      case STATE.LAND_HARD:
        if (this.stateFrame >= TUNING.movement.landHardRecoveryFrames) this.setState(STATE.IDLE);
        return;
      case STATE.DRINK:
        if (this.stateFrame >= TUNING.health.flaskDrinkFrames) this.setState(STATE.IDLE);
        return;
      case STATE.JUMP_START:
      case STATE.AIRBORNE:
      case STATE.STAND_UP:
      case STATE.CORPSE:
      case STATE.DEAD:
        return;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = speed > 0.35;
    if (moving && this.state !== STATE.MOVE) this.setState(STATE.MOVE);
    if (!moving && this.state !== STATE.IDLE) this.setState(STATE.IDLE);

    this.#blendLocomotion(speed);
  }

  /**
   * The locomotion blend tree.
   *
   * Free movement blends idle → walk → run → sprint on speed alone, because
   * the character always faces where it is going. Locked on, the character is
   * squared at the target, so the same speed has to be distributed across four
   * directional cycles by the movement vector in character-local space.
   */
  #blendLocomotion(speed) {
    const m = TUNING.movement;

    if (!this.lockTarget) {
      const entries = [];
      if (speed < 0.35) {
        entries.push({ id: 'idle', weight: 1 });
      } else if (speed < m.walkSpeed) {
        const t = speed / m.walkSpeed;
        entries.push({ id: 'idle', weight: 1 - t }, { id: 'walkF', weight: t });
      } else if (speed < m.runSpeed) {
        const t = (speed - m.walkSpeed) / (m.runSpeed - m.walkSpeed);
        entries.push({ id: 'walkF', weight: 1 - t }, { id: 'runF', weight: t });
      } else {
        const t = THREE.MathUtils.clamp((speed - m.runSpeed) / (m.sprintSpeed - m.runSpeed), 0, 1);
        entries.push({ id: 'runF', weight: 1 - t }, { id: 'sprintF', weight: t });
      }
      this.#setGaitSpeed(speed);
      this.anim.setBlend(entries, { fadeFrames: 5 });
      return;
    }

    _v.set(this.velocity.x, 0, this.velocity.z);
    const fwd = _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const forward = _v.dot(fwd);
    const right = _v.x * Math.cos(this.facing) - _v.z * Math.sin(this.facing);

    if (speed < 0.35) {
      this.anim.setBlend([{ id: 'idle', weight: 1 }], { fadeFrames: 5 });
      return;
    }

    const fast = speed > m.walkSpeed * 1.25;
    const fw = Math.max(0, forward) / Math.max(0.001, speed);
    const bw = Math.max(0, -forward) / Math.max(0.001, speed);
    const rw = Math.max(0, right) / Math.max(0.001, speed);
    const lw = Math.max(0, -right) / Math.max(0.001, speed);
    const total = fw + bw + rw + lw || 1;

    this.#setGaitSpeed(speed);
    this.anim.setBlend([
      { id: fast ? 'runF' : 'walkF', weight: fw / total },
      { id: fast ? 'runB' : 'walkB', weight: bw / total },
      { id: 'strafeR', weight: rw / total },
      { id: 'strafeL', weight: lw / total },
    ], { fadeFrames: 5 });
  }

  #setGaitSpeed(speed) {
    const m = TUNING.movement;
    for (const p of this.anim.playing) {
      if (!p.clip.loop || p.layer !== 'base') continue;
      const ref = p.clip.id === 'sprintF' ? m.sprintSpeed
        : p.clip.id.startsWith('run') ? m.runSpeed
        : p.clip.id === 'idle' ? 0
        : m.walkSpeed;
      p.speed = ref > 0 ? THREE.MathUtils.clamp(speed / ref, 0.55, 1.75) : 1;
    }
  }

  // ------------------------------------------------------------- transitions

  beginDrift(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.root.position.copy(position);
    this.mesh.visible = false;
    this.setState(STATE.DRIFT, { force: true });
  }

  beginCorpse(position, facing = 0) {
    this.teleport(position);
    this.facing = this.targetFacing = facing;
    this.root.rotation.y = facing;
    this.mesh.visible = true;
    this.setState(STATE.CORPSE, { force: true });
    this.anim.play('corpse', { fadeFrames: 0 });
  }

  beginStandUp() {
    this.setState(STATE.STAND_UP, { force: true });
    this.anim.play('standUp', { fadeFrames: 10 });
  }

  teleport(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.body.setTranslation(
      { x: position.x, y: position.y + this.capsuleOffset, z: position.z },
      true
    );
    this.root.position.copy(position);
    // The camera must be told, or it spends several frames smoothing in from
    // wherever it was. Movement is camera-relative, so during those frames the
    // character turns toward a direction that no longer exists.
    this.bus.emit(EVENTS.PLAYER_SPAWNED, { position: this.position });
  }

  dispose() {
    this.renderer.scene.remove(this.root);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * The held sword.
 *
 * Inert geometry parented to the hand bone. Combat is out this phase, but the
 * sword is beat 5 of the chapter and a beat that hands the player nothing they
 * can see is a beat they will not believe happened — so the pickup still puts
 * a visible blade in the hand, it just does not swing yet.
 */
function buildHeldSword() {
  const g = new THREE.Group();
  const steel = toonMaterial({ color: 0xa8b0b8, bands: 4, rimStrength: 0.7, rimPower: 3.2 });
  const wood = toonMaterial({ color: 0x6b5138, bands: 3, rimStrength: 0.36 });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.98, 0.028), steel);
  blade.position.y = 0.62;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.055, 0.065), steel);
  guard.position.y = 0.12;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.24, 0.062), wood);
  const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.09), steel);
  pommel.position.y = -0.15;

  g.add(blade, guard, grip, pommel);
  // Held down the forearm rather than straight up out of the fist.
  g.rotation.set(-0.15, 0, 0.08);
  return g;
}
