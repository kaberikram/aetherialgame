import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { ACTION } from '../input/Actions.js';
import { InputBuffer } from '../input/InputBuffer.js';
import { buildCharacter } from './Rig.js';
import { AnimationSystem } from './AnimationSystem.js';
import { buildLocomotionClips } from './clips/gait.js';
import { buildActionClips } from './clips/actions.js';
import { buildAttackClips } from './clips/attacks.js';
import { Stamina } from './Stamina.js';
import { Vitals } from '../combat/Vitals.js';
import { BoundCapsule, StaticCapsule } from '../combat/HitboxSystem.js';
import { PLAYER_MOVES, OPENERS, getMove } from '../combat/data/playerMoves.js';
import { buildSword } from './Weapon.js';
import { Alignment } from './Alignment.js';
import { Flight } from './Flight.js';

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
  ATTACK: 'attack',
  GUARD: 'guard',
  DEFLECT: 'deflect',
  DRINK: 'drink',
  STAGGER: 'stagger',
  CRITICAL: 'critical',
  DEAD: 'dead',
  FLIGHT: 'flight',
});

/** States that commit: input cannot pull the character out of them. */
const COMMITTED = new Set([
  STATE.ROLL, STATE.BACKSTEP, STATE.LAND_HARD, STATE.JUMP_START, STATE.STAND_UP,
  STATE.CORPSE, STATE.ATTACK, STATE.DRINK, STATE.STAGGER, STATE.CRITICAL, STATE.DEAD,
  STATE.DEFLECT,
]);
/** States whose horizontal motion comes from the animation, not from input. */
const ROOT_MOTION_STATES = new Set([
  STATE.ROLL, STATE.BACKSTEP, STATE.STAND_UP, STATE.ATTACK, STATE.STAGGER,
  STATE.CRITICAL, STATE.DEAD, STATE.DRINK,
]);

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

    // Guard state is read by DamageSystem. `deflectFramesLeft` is the narrow
    // window inside a guard where an incoming hit becomes a deflect instead.
    this.guardState = { active: false, deflectFramesLeft: 0 };
    this.deflectBonusFrames = 0;
    this.deflectMultiplier = 1;

    this.flaskCharges = TUNING.health.flaskCharges;
    this.currentMove = null;
    this.moveFrame = 0;
    this.hitboxOpen = false;
    this.chainQueued = null;
    this.criticalTarget = null;

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

    // The sword is parented to the hand bone, so it follows the animation with
    // no extra bookkeeping and the hitbox capsule tracks the same bone.
    this.sword = buildSword();
    this.sword.visible = false;
    rig.byName.get('hand.R').add(this.sword);

    this.anim = new AnimationSystem(rig, this.bus);
    this.anim.register(...buildLocomotionClips(), ...buildActionClips(), ...buildAttackClips());
    this.anim.onEvent = (ev) => this.#onAnimEvent(ev);
    this.anim.play('idle', { fadeFrames: 0 });

    this.hurtbox = new StaticCapsule({ position: this.position, height: 1.68, radius: 0.34 });

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

  /** Wired after construction, once the combat services exist. */
  attachCombat({ hitboxes, damage, lockOn }) {
    this.hitboxes = hitboxes;
    this.damage = damage;
    this.lockOn = lockOn;
    hitboxes.registerHurtbox(this, this.hurtbox);
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
      if (this.state === STATE.DEFLECT) return this.stateFrame >= 18;
      // An attack releases only at the very end of recovery. Chaining is
      // handled separately and explicitly; it is not an escape.
      if (this.state === STATE.ATTACK) return this.moveFrame >= this.currentMove.frames - 2;
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
      case STATE.ATTACK: return this.moveFrame > this.currentMove.active[1];
      case STATE.DRINK: return this.stateFrame >= TUNING.health.flaskDrinkFrames - 12;
      default: return false;
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
      case 'criticalHit':
        if (this.criticalTarget) this.damage?.resolveCritical(this, this.criticalTarget);
        break;
      case 'sfx': this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position }); break;
      case 'swing': this.bus.emit(EVENTS.SFX, { id: ev.id, position: this.position }); break;
      case 'camera-shake': this.engine.resolve('camera').addShake(ev.strength); break;
    }
  }

  // ------------------------------------------------------------------- loop

  fixedUpdate(dt, ctx) {
    // Hit stop scales the simulation for everything animated, which is what
    // makes contact land. Physics still steps normally so nothing tunnels.
    const scale = this.damage?.timeScale ?? 1;
    const adt = dt * scale;

    this.stateFrame += scale;
    this.stamina.fixedUpdate(adt);
    this.vitals.fixedUpdate(adt);
    if (this.deflectBonusFrames > 0) this.deflectBonusFrames -= scale;

    if (this.state === STATE.DRIFT) {
      this.#updateDrift(dt);
      this.anim.fixedUpdate(dt);
      return;
    }

    if (this.state === STATE.DEAD) {
      this.anim.fixedUpdate(adt);
      this.#updateMotion(dt);
      return;
    }

    // Flight replaces ground motion entirely when it is active. It is checked
    // before intent so a takeoff cannot be interleaved with a ground action.
    const flying = this.flight?.fixedUpdate(adt) ?? false;
    if (flying) {
      if (this.state !== STATE.FLIGHT) {
        this.setState(STATE.FLIGHT, { force: true });
        this.anim.play('fall', { fadeFrames: 6 });
      }
      this.#integrate(adt);
      this.anim.fixedUpdate(adt);
      this.alignment?.update(adt, { flying: true, flapPhase: this.flight.flapPhase });
      this.flight.applyPose(this.root);
      this.hurtbox.update();
      return;
    }
    if (this.state === STATE.FLIGHT) this.setState(this.grounded ? STATE.LAND : STATE.AIRBORNE, { force: true });

    this.#readIntent(ctx.frame);
    this.#updateGuard(dt);
    this.#updateFacing(dt);
    this.#updateMotion(adt);
    this.anim.fixedUpdate(adt);
    this.#updateCombatFrames();
    this.#updateAnimationState();
    this.alignment?.update(adt, { flying: false });
    this.flight?.applyPose(this.root);
    this.hurtbox.update();
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

    // --- attacks ---------------------------------------------------------
    for (const [action, kind] of [[ACTION.LIGHT_ATTACK, 'light'], [ACTION.HEAVY_ATTACK, 'heavy']]) {
      if (!inp.actions[action].pressed) continue;
      if (this.state === STATE.ATTACK) {
        // Chaining is not cancelling. The input is remembered and the NEXT
        // move begins when this one's chain window opens, inside recovery.
        const m = this.currentMove;
        if (m.chainInto?.[kind] && this.moveFrame >= m.active[1]) this.chainQueued = kind;
      } else if (this.canAct()) {
        this.#tryAttack(kind);
      } else if (this.#inRecovery()) {
        this.buffer.push(action, inp.move, frame);
      }
    }

    // --- flask -----------------------------------------------------------
    if (inp.actions[ACTION.USE_ITEM].pressed) {
      if (this.canAct()) this.#tryDrink();
      else if (this.#inRecovery()) this.buffer.push(ACTION.USE_ITEM, inp.move, frame);
    }

    // --- drain the buffer -------------------------------------------------
    if (this.canAct() && this.state !== STATE.ATTACK) {
      const queued = this.buffer.peek(frame);
      if (queued) {
        this.buffer.consume(frame);
        if (queued.action === ACTION.DODGE) this.#tryDodge(queued.move);
        else if (queued.action === ACTION.LIGHT_ATTACK) this.#tryAttack('light');
        else if (queued.action === ACTION.HEAVY_ATTACK) this.#tryAttack('heavy');
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

  // --------------------------------------------------------------- attacks

  #tryAttack(kind) {
    if (!this.hasWeapon) return;
    if (!this.grounded) return;
    if (!this.stamina.canAct) return;

    // A staggered target in front invites a critical instead of a normal swing.
    if (kind === 'light') {
      const target = this.#staggeredTargetInFront();
      if (target) return this.#startCritical(target);
    }
    this.#startMove(OPENERS[kind]);
  }

  #startMove(moveId) {
    const move = getMove(moveId);
    if (!this.stamina.spend(move.staminaCost, 'attack')) return;

    this.currentMove = move;
    this.moveFrame = 0;
    this.hitboxOpen = false;
    this.chainQueued = null;
    this.setState(STATE.ATTACK, { force: true });

    // The dark branch swings faster; that speed is the compensation for its
    // lower defence, and it applies to the clip and the frame data alike.
    const speed = this.damage?.attackSpeedMultiplier ?? 1;
    this.anim.play(move.clip, { fadeFrames: 3, speed });
    this.bus.emit(EVENTS.ATTACK_STARTED, { entity: this, moveId });

    // Snap toward the target so an attack does not whiff on a 5° error the
    // player could not see. Only a snap, never tracking mid-swing.
    if (this.lockTarget) {
      _v.copy(this.lockTarget.position).sub(this.position);
      this.targetFacing = Math.atan2(_v.x, _v.z);
      this.facing = this.targetFacing;
    } else if (Math.hypot(this.input.move.x, this.input.move.y) > 0.2) {
      this.facing = this.targetFacing = this.#cameraRelativeYaw(this.input.move);
    }
  }

  #startCritical(target) {
    if (!this.stamina.spend(PLAYER_MOVES.critical.staminaCost, 'critical')) return;
    this.criticalTarget = target;
    this.currentMove = PLAYER_MOVES.critical;
    this.moveFrame = 0;
    this.setState(STATE.CRITICAL, { force: true });
    this.anim.play('critical', { fadeFrames: 3 });
    _v.copy(target.position).sub(this.position);
    this.facing = this.targetFacing = Math.atan2(_v.x, _v.z);
  }

  #staggeredTargetInFront() {
    if (!this.hitboxes) return null;
    for (const [entity] of this.hitboxes.hurtboxes) {
      if (entity === this || entity.faction === 'player') continue;
      if (!entity.vitals?.staggered || !entity.vitals.alive) continue;
      if (entity.criticalImmune) continue;
      _v.copy(entity.position).sub(this.position);
      if (_v.length() > 2.6) continue;
      const angle = Math.atan2(_v.x, _v.z);
      let delta = angle - this.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) < THREE.MathUtils.degToRad(55)) return entity;
    }
    return null;
  }

  /** Drives the hitbox against the frame data. Runs after the animation steps. */
  #updateCombatFrames() {
    if (this.state === STATE.CRITICAL) {
      this.moveFrame += this.damage?.timeScale ?? 1;
      this.invulnerable = this.moveFrame >= PLAYER_MOVES.critical.invulnerable[0]
        && this.moveFrame <= PLAYER_MOVES.critical.invulnerable[1];
      if (this.moveFrame >= PLAYER_MOVES.critical.frames) {
        this.invulnerable = false;
        this.criticalTarget = null;
        this.setState(STATE.IDLE);
      }
      return;
    }
    if (this.state !== STATE.ATTACK) return;

    const move = this.currentMove;
    this.moveFrame += (this.damage?.timeScale ?? 1) * (this.damage?.attackSpeedMultiplier ?? 1);

    // Hyper-armor: poise damage is ignored for the declared window. You will
    // still take the damage; you just will not be interrupted.
    this.vitals.hyperArmor = move.hyperArmor
      && this.moveFrame >= move.hyperArmorFrames[0]
      && this.moveFrame <= move.hyperArmorFrames[1];

    const shouldBeOpen = this.moveFrame >= move.active[0] && this.moveFrame <= move.active[1];
    if (shouldBeOpen && !this.hitboxOpen) {
      this.hitboxOpen = true;
      const capsule = new BoundCapsule(move.hitbox).bind(this.rig);
      this.hitboxes?.activate({
        owner: this,
        capsule,
        move: this.#modifiedMove(move),
        faction: 'player',
        onHit: (entity, point, m) => this.damage?.resolve(this, entity, m, point),
      });
      this.bus.emit(EVENTS.ATTACK_ACTIVE, { entity: this, moveId: move.id });
    } else if (!shouldBeOpen && this.hitboxOpen) {
      this.hitboxOpen = false;
      this.hitboxes?.deactivate(this);
    }

    // Chain: the queued input fires when the window opens, inside recovery.
    if (this.chainQueued && move.chainWindow.length) {
      const [from, to] = move.chainWindow;
      if (this.moveFrame >= from && this.moveFrame <= to) {
        const next = move.chainInto[this.chainQueued];
        if (next) {
          const kind = this.chainQueued;
          this.chainQueued = null;
          this.hitboxes?.deactivate(this);
          this.hitboxOpen = false;
          this.#startMove(next);
          return;
        }
      }
    }

    if (this.moveFrame >= move.frames) {
      this.hitboxes?.deactivate(this);
      this.hitboxOpen = false;
      this.vitals.hyperArmor = false;
      this.bus.emit(EVENTS.ATTACK_RECOVERED, { entity: this, moveId: move.id });
      this.currentMove = null;
      this.setState(this.grounded ? STATE.IDLE : STATE.AIRBORNE);
    }
  }

  /** Applies the deflect counter bonus, if one is live. */
  #modifiedMove(move) {
    if (this.deflectBonusFrames <= 0) return move;
    this.deflectBonusFrames = 0;
    return { ...move, damage: move.damage * this.deflectMultiplier, poiseDamage: move.poiseDamage * 1.5 };
  }

  // ----------------------------------------------------------------- guard

  #updateGuard(dt) {
    const inp = this.input;
    const canGuard = this.hasWeapon
      && !COMMITTED.has(this.state)
      && this.grounded
      && this.stamina.canAct;

    if (this.guardState.deflectFramesLeft > 0) this.guardState.deflectFramesLeft--;

    if (canGuard && inp.isDeflectInput() && this.guardState.deflectFramesLeft <= 0) {
      // A deflect is a distinct, committed action with its own animation. It
      // is not "guard, but better" — it has a window and a whiff cost.
      this.guardState.active = true;
      this.guardState.deflectFramesLeft = this.damage?.deflectWindowFrames ?? TUNING.combat.deflectWindowFrames;
      this.setState(STATE.DEFLECT, { force: true });
      this.anim.play('deflect', { fadeFrames: 1 });
      return;
    }

    if (canGuard && inp.isGuarding()) {
      this.guardState.active = true;
      if (this.state !== STATE.GUARD && this.state !== STATE.DEFLECT) {
        this.setState(STATE.GUARD);
        this.anim.play('guard', { fadeFrames: 5 });
      }
    } else if (this.state === STATE.GUARD) {
      this.guardState.active = false;
      this.setState(STATE.IDLE);
    } else if (this.state !== STATE.DEFLECT) {
      this.guardState.active = false;
    }

    if (this.state === STATE.DEFLECT && this.stateFrame >= 26) {
      this.guardState.active = inp.isGuarding();
      this.setState(this.guardState.active ? STATE.GUARD : STATE.IDLE);
      if (this.guardState.active) this.anim.play('guard', { fadeFrames: 4 });
    }
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

  /** Called by DamageSystem's events, not directly by attackers. */
  onDamaged({ staggered, died }) {
    if (died) return this.die();
    if (staggered) {
      this.setState(STATE.STAGGER, { force: true });
      this.anim.play('stagger', { fadeFrames: 2 });
      this.hitboxes?.deactivate(this);
      this.hitboxOpen = false;
      return;
    }
    // A light hit plays on the upper-body layer only, so the legs keep running.
    // A full-body flinch on chip damage reads as a stun and stops the fight.
    if (!COMMITTED.has(this.state) || this.state === STATE.ATTACK) {
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
    this.hitboxes?.deactivate(this);
    this.guardState.active = false;
    this.invulnerable = true;
    this.bus.emit(EVENTS.PLAYER_DIED, { position: this.position.clone() });
  }

  respawn(position, facing = 0) {
    this.vitals.refill();
    this.stamina.refill();
    this.refillFlask();
    this.invulnerable = false;
    this.currentMove = null;
    this.chainQueued = null;
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
    if (this.state === STATE.GUARD) return m.walkSpeed * 0.72; // guarding is slow
    const wantsSprint = inp.actions[ACTION.SPRINT].held && mag > 0.7
      && this.stamina.canAct && !this.stamina.exhausted;
    if (wantsSprint) return m.sprintSpeed;
    return THREE.MathUtils.lerp(m.walkSpeed * 0.55, m.runSpeed, Math.min(1, mag));
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

    const t = this.body.translation();
    const nx = t.x + corrected.x;
    const ny = t.y + corrected.y;
    const nz = t.z + corrected.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - this.capsuleOffset, nz);

    if (Math.abs(corrected.x) < Math.abs(_v.x) * 0.5) this.velocity.x *= 0.2;
    if (Math.abs(corrected.z) < Math.abs(_v.z) * 0.5) this.velocity.z *= 0.2;

    if (resolveLanding) this.#resolveGroundTransitions(wasGrounded);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;
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
      case STATE.STAGGER:
        if (this.stateFrame >= TUNING.health.staggerFrames) this.setState(STATE.IDLE);
        return;
      case STATE.JUMP_START:
      case STATE.AIRBORNE:
      case STATE.STAND_UP:
      case STATE.CORPSE:
      case STATE.ATTACK:
      case STATE.CRITICAL:
      case STATE.GUARD:
      case STATE.DEFLECT:
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
