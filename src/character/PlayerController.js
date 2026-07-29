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
});

/** States that commit: input cannot pull the character out of them. */
const COMMITTED = new Set([
  STATE.ROLL, STATE.BACKSTEP, STATE.LAND_HARD, STATE.JUMP_START, STATE.STAND_UP, STATE.CORPSE,
]);
/** States whose horizontal motion comes from the animation, not from input. */
const ROOT_MOTION_STATES = new Set([STATE.ROLL, STATE.BACKSTEP, STATE.STAND_UP]);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * PlayerController — owns the player state machine and turns input intent into
 * motion requests.
 *
 * It never writes to the physics body directly (that goes through the Rapier
 * character controller) and never computes damage (that is combat's job).
 *
 * The design rule this file exists to enforce: an action, once started, runs to
 * its recovery. Nothing here has an "escape" branch out of a committed state,
 * and that absence is the whole feel of the genre.
 */
export class PlayerController {
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
    this.facing = 0;             // yaw, radians
    this.targetFacing = 0;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.coyoteFrames = 0;
    this.jumpBufferFrames = 0;
    this.invulnerable = false;
    this.waterDepth = 0;

    this.stamina = new Stamina(this.bus);
    this.buffer = new InputBuffer();

    /** Filled by LockOn; the controller only reads it. */
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
    // The capsule's centre sits this far above the feet.
    this.capsuleOffset = m.capsuleHalfHeight + m.capsuleRadius;
    this.position.set(0, 2, 0);
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
    if (this.state === STATE.ROLL) return this.stateFrame >= TUNING.roll.recoveryStartFrame - 8;
    if (this.state === STATE.BACKSTEP) return this.stateFrame >= 16;
    if (this.state === STATE.LAND_HARD) return this.stateFrame >= 12;
    if (this.state === STATE.LAND) return true;
    return false;
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
      case 'sfx': this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position }); break;
      case 'camera-shake': this.engine.bus.emit(EVENTS.SFX, { id: 'shake', gain: ev.strength }); break;
    }
  }

  // ------------------------------------------------------------------- loop

  fixedUpdate(dt, ctx) {
    this.stateFrame++;
    this.stamina.fixedUpdate(dt);

    if (this.state === STATE.DRIFT) {
      this.#updateDrift(dt);
      this.anim.fixedUpdate(dt);
      return;
    }

    this.#readIntent(ctx.frame);
    this.#updateFacing(dt);
    this.#updateMotion(dt);
    this.anim.fixedUpdate(dt);
    this.#updateAnimationState();
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
    _v2.copy(_v).cross(_up).multiplyScalar(-1);

    _flat.set(0, 0, 0)
      .addScaledVector(_v, move.y)
      .addScaledVector(_v2, move.x);
    // Vertical drift on jump/dodge, so the void has three axes and no floor.
    const vertical = (this.input.actions[ACTION.JUMP].held ? 1 : 0)
      - (this.input.actions[ACTION.DODGE].held ? 1 : 0);

    this.velocity.addScaledVector(_flat, 5.2 * dt);
    this.velocity.y += vertical * 4.0 * dt;
    this.velocity.multiplyScalar(Math.pow(0.14, dt)); // heavy damping, long glide
    this.position.addScaledVector(this.velocity, dt);
    this.root.position.copy(this.position);
  }

  // -------------------------------------------------------------- intent

  #readIntent(frame) {
    const inp = this.input;

    if (inp.actions[ACTION.JUMP].pressed) this.jumpBufferFrames = TUNING.movement.jumpBufferFrames;
    else if (this.jumpBufferFrames > 0) this.jumpBufferFrames--;

    if (inp.actions[ACTION.DODGE].pressed) {
      if (this.canAct()) this.#tryDodge();
      else if (this.#inRecovery()) this.buffer.push(ACTION.DODGE, inp.move, frame);
    }

    if (this.canAct() && this.jumpBufferFrames > 0 && (this.grounded || this.coyoteFrames > 0)) {
      this.jumpBufferFrames = 0;
      this.#startJump();
    }

    // Drain the buffer the moment the current action lets go.
    if (this.canAct()) {
      const queued = this.buffer.peek(frame);
      if (queued?.action === ACTION.DODGE) {
        this.buffer.consume(frame);
        this.#tryDodge(queued.move);
      }
    }
  }

  #tryDodge(moveOverride = null) {
    if (!this.grounded && this.coyoteFrames <= 0) return;
    if (!this.stamina.canAct) return;

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

    const cost = TUNING.roll.staminaCost * (this.waterDepth > TUNING.water.shallowDepth ? TUNING.water.staminaMultiplierDeep : 1);
    if (!this.stamina.spend(cost, 'roll')) return;

    this.targetFacing = this.#cameraRelativeYaw(move);
    this.facing = this.targetFacing; // rolls snap to their direction instantly
    this.setState(STATE.ROLL, { force: true });
    this.anim.play('roll', { fadeFrames: 2 });
  }

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

  #cameraRelativeYaw(move) {
    const cam = this.renderer.camera;
    cam.getWorldDirection(_v);
    _v.y = 0;
    _v.normalize();
    const camYaw = Math.atan2(_v.x, _v.z);
    return camYaw + Math.atan2(move.x, move.y);
  }

  // -------------------------------------------------------------- facing

  #updateFacing(dt) {
    const m = TUNING.movement;
    const move = this.input.move;
    const moving = Math.hypot(move.x, move.y) > 0.05;

    if (this.lockTarget) {
      // Locked on, the character always squares up to the target and strafes.
      _v.copy(this.lockTarget.position).sub(this.position);
      this.targetFacing = Math.atan2(_v.x, _v.z);
    } else if (moving && !ROOT_MOTION_STATES.has(this.state)) {
      this.targetFacing = this.#cameraRelativeYaw(move);
    }

    let rate = m.turnRateWalk;
    if (this.lockTarget) rate = m.turnRateLocked;
    else if (this.state === STATE.MOVE) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      rate = speed > m.runSpeed * 1.05 ? m.turnRateSprint
        : speed > m.walkSpeed * 1.2 ? m.turnRateRun
        : m.turnRateWalk;
    }

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

    const wantsSprint = inp.actions[ACTION.SPRINT].held && mag > 0.7 && this.stamina.canAct && !this.stamina.exhausted;
    if (wantsSprint) return m.sprintSpeed;
    // Below full tilt the stick maps into the walk↔run band, so creeping near
    // a ledge is achievable rather than an all-or-nothing lurch.
    return THREE.MathUtils.lerp(m.walkSpeed * 0.55, m.runSpeed, Math.min(1, mag));
  }

  #updateMotion(dt) {
    const m = TUNING.movement;
    const useRootMotion = ROOT_MOTION_STATES.has(this.state);

    if (useRootMotion) {
      const rm = this.anim.consumeRootMotion(_v);
      _q.setFromAxisAngle(_up, this.facing);
      _v.applyQuaternion(_q);
      // Water resists a dodge: the deep centre of the dais is a real cost.
      const scale = this.#waterRollScale();
      this.velocity.x = (_v.x * scale) / dt;
      this.velocity.z = (_v.z * scale) / dt;
    } else if (this.state === STATE.LAND_HARD || this.state === STATE.JUMP_START) {
      this.velocity.x *= Math.pow(0.02, dt);
      this.velocity.z *= Math.pow(0.02, dt);
    } else {
      const speed = this.#speedForInput() * this.#waterSpeedScale();
      const wantsSprint = speed > m.runSpeed + 0.01;
      if (wantsSprint && this.grounded) {
        if (!this.stamina.drain(TUNING.stamina.sprintDrainPerSecond, dt)) {
          // Out of stamina mid-sprint: you drop to a run, you do not stop dead.
        }
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

    // Gravity. Extra past the apex kills the floaty hang time that makes a
    // jump read as weightless.
    if (!this.grounded) {
      const g = this.velocity.y < 0 ? m.gravity * m.fallMultiplier : m.gravity;
      this.velocity.y = Math.max(m.maxFallSpeed, this.velocity.y + g * dt);
    } else if (this.velocity.y < 0) {
      this.velocity.y = -2; // keep it pressed into slopes so snap-to-ground works
    }

    _v.set(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    this.controller.computeColliderMovement(this.collider, { x: _v.x, y: _v.y, z: _v.z });
    const corrected = this.controller.computedMovement();

    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    const t = this.body.translation();
    const nx = t.x + corrected.x;
    const ny = t.y + corrected.y;
    const nz = t.z + corrected.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - this.capsuleOffset, nz);

    // A wall stops horizontal velocity rather than letting it build up
    // invisibly and fling the character on release.
    if (Math.abs(corrected.x) < Math.abs(_v.x) * 0.5) this.velocity.x *= 0.2;
    if (Math.abs(corrected.z) < Math.abs(_v.z) * 0.5) this.velocity.z *= 0.2;

    this.#resolveGroundTransitions(wasGrounded);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;
  }

  #waterSpeedScale() {
    const w = TUNING.water;
    if (this.waterDepth <= 0.01) return 1;
    const t = THREE.MathUtils.clamp(
      (this.waterDepth - w.shallowDepth) / (w.deepDepth - w.shallowDepth), 0, 1
    );
    return THREE.MathUtils.lerp(w.speedAtShallow, w.speedAtDeep, t);
  }

  #waterRollScale() {
    const w = TUNING.water;
    if (this.waterDepth <= 0.01) return 1;
    const t = THREE.MathUtils.clamp(
      (this.waterDepth - w.shallowDepth) / (w.deepDepth - w.shallowDepth), 0, 1
    );
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
        if (impact > m.landHardThreshold) {
          this.setState(STATE.LAND_HARD, { force: true });
          this.anim.play('landHard', { fadeFrames: 2 });
        } else if (impact > 5) {
          this.setState(STATE.LAND, { force: true });
          this.anim.play('land', { fadeFrames: 3 });
        } else if (COMMITTED.has(this.state) === false) {
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
    // Committed states hold until their clip ends; they own their own animation.
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
      case STATE.JUMP_START:
      case STATE.AIRBORNE:
      case STATE.STAND_UP:
      case STATE.CORPSE:
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
      // Stride rate tracks actual speed, so feet do not skate on slopes or in water.
      this.#setGaitSpeed(speed);
      this.anim.setBlend(entries, { fadeFrames: 5 });
      return;
    }

    // Local-space movement direction relative to the character's facing.
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

  /** Beat 1 → 2. Called by the narrative driver, not by input. */
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
