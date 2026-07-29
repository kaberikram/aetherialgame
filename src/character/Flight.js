import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { ACTION } from '../input/Actions.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Flight.
 *
 * The design constraint from PHASES.md is that the exit must be "a triumph
 * rather than a fight with the camera". So flight is deliberately NOT a free
 * six-axis controller: heading follows the camera, the player controls climb
 * and speed, and banking is a consequence of turning rather than an input.
 * That leaves exactly one thing to be good at — managing altitude against a
 * stamina cost — which is enough for one ascent and not enough to be fiddly.
 *
 * Light and dark share this controller and diverge in the numbers only:
 * light glides longer and turns wide, dark climbs faster and turns sharp.
 */
export class Flight {
  constructor(engine, player, alignment) {
    this.engine = engine;
    this.bus = engine.bus;
    this.input = engine.resolve('input');
    this.player = player;
    this.alignment = alignment;

    this.active = false;
    this.flapCooldown = 0;
    this.flapPhase = 0;
    this.bank = 0;
    this.landingFrames = 0;
    this.unlocked = false;
  }

  get params() {
    const f = TUNING.flight;
    const branch = this.alignment.branch;
    const b = branch === 'light' ? f.light : branch === 'dark' ? f.dark : {};
    return { ...f, ...b };
  }

  unlock() {
    this.unlocked = true;
  }

  canTakeOff() {
    return this.unlocked
      && !this.active
      && this.player.stamina.current > TUNING.flight.flapStaminaCost;
  }

  takeOff() {
    if (!this.canTakeOff()) return false;
    const p = this.params;
    this.active = true;
    this.flapCooldown = 0;
    this.flapPhase = 0;
    this.player.velocity.y = Math.max(this.player.velocity.y, p.takeoffImpulse);
    this.player.grounded = false;
    this.player.stamina.spend(TUNING.flight.flapStaminaCost, 'takeoff');
    this.bus.emit(EVENTS.FLIGHT_TAKEOFF);
    this.bus.emit(EVENTS.SFX, { id: 'flap', position: this.player.position });
    return true;
  }

  land() {
    if (!this.active) return;
    this.active = false;
    this.landingFrames = TUNING.flight.landingRecoveryFrames;
    this.bus.emit(EVENTS.FLIGHT_LANDED);
  }

  /**
   * Called from the player controller in place of the normal ground motion.
   * @returns {boolean} whether flight handled movement this step
   */
  fixedUpdate(dt) {
    if (this.landingFrames > 0) this.landingFrames--;
    if (this.flapCooldown > 0) this.flapCooldown--;

    const inp = this.input;

    // Takeoff: jump from the ground, or jump while falling to convert the fall
    // into a glide — per CONTROLS.md, A is the single verb and the situation
    // decides the outcome.
    if (!this.active && this.unlocked && inp.actions[ACTION.JUMP].pressed && this.landingFrames <= 0) {
      if (this.player.grounded || this.player.velocity.y < -2) this.takeOff();
    }

    if (!this.active) return false;

    const p = this.params;
    const player = this.player;

    if (player.grounded && player.velocity.y <= 0) {
      this.land();
      return false;
    }

    // Heading follows the camera. This is the single decision that keeps the
    // ascent from becoming a wrestling match with two sticks.
    const cam = this.engine.resolve('renderer').camera;
    cam.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.copy(_fwd).cross(_up).negate();

    const move = inp.move;
    const throttle = THREE.MathUtils.clamp(move.y, -0.6, 1);
    const turn = move.x;

    // Flap: costs stamina, has a cooldown, and is the only source of climb.
    const held = inp.actions[ACTION.JUMP].held;
    if (held && this.flapCooldown <= 0 && player.stamina.current > TUNING.flight.flapStaminaCost) {
      this.flapCooldown = p.flapCooldownFrames;
      player.velocity.y += p.flapImpulse;
      player.stamina.spend(TUNING.flight.flapStaminaCost, 'flap');
      this.bus.emit(EVENTS.FLIGHT_FLAP);
      this.bus.emit(EVENTS.SFX, { id: 'flap', position: player.position });
    }

    // Glide gravity is much weaker than walking gravity — that difference is
    // the whole sensation of having wings.
    const diving = move.y < -0.3;
    const gravity = diving ? p.glideGravity * 2.6 : p.glideGravity;
    player.velocity.y = Math.max(-p.diveSpeed, player.velocity.y + gravity * dt);

    const speed = p.glideForwardSpeed * (0.55 + throttle * 0.45) + (diving ? 6 : 0);
    _v.copy(_fwd).multiplyScalar(speed).addScaledVector(_right, turn * speed * 0.55);

    player.velocity.x = THREE.MathUtils.damp(player.velocity.x, _v.x, 3.2, dt);
    player.velocity.z = THREE.MathUtils.damp(player.velocity.z, _v.z, 3.2, dt);

    // Facing follows the flight path; bank is a consequence of turning.
    const heading = Math.atan2(player.velocity.x, player.velocity.z);
    let delta = heading - player.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    player.facing += delta * Math.min(1, (p.turnRate ?? p.bankRate) * dt);
    this.bank = THREE.MathUtils.damp(this.bank, THREE.MathUtils.clamp(-turn, -1, 1) * p.maxBankAngle, 5, dt);

    this.flapPhase += dt * (this.flapCooldown > p.flapCooldownFrames * 0.5 ? 16 : 5);

    // Out of stamina means the glide continues but the climb does not. You do
    // not fall out of the sky; you simply stop going up.
    return true;
  }

  /** Applied to the character root after motion, so banking reads as roll. */
  applyPose(root) {
    root.rotation.z = this.active ? this.bank : THREE.MathUtils.damp(root.rotation.z, 0, 8, 1 / 60);
  }
}
