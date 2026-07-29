import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { ACTION } from '../input/Actions.js';

const _v = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _camForward = new THREE.Vector3();

/**
 * LockOn — acquisition, cycling, and breaking.
 *
 * Owns which target is active. Does NOT move the camera: it emits
 * LOCKON_CHANGED and the camera rig decides what to do about it. Keeping those
 * separate is what lets the camera behave differently per target size without
 * the targeting logic knowing anything about framing.
 *
 * Targets are registered objects with `{ position, lockHeight?, alive }`.
 */
export class LockOn {
  constructor(engine, player) {
    this.engine = engine;
    this.bus = engine.bus;
    this.input = engine.resolve('input');
    this.physics = engine.resolve('physics');
    this.renderer = engine.resolve('renderer');
    this.player = player;

    /** @type {Set<object>} */
    this.candidates = new Set();
    this.target = null;
    this.cycleCooldown = 0;
    this.losCounter = 0;
    this.stickReleased = true;
  }

  register(target) {
    this.candidates.add(target);
  }

  unregister(target) {
    this.candidates.delete(target);
    if (this.target === target) this.setTarget(null);
  }

  setTarget(target) {
    if (this.target === target) return;
    this.target = target;
    this.player.lockTarget = target;
    this.bus.emit(EVENTS.LOCKON_CHANGED, { target });
  }

  fixedUpdate(dt) {
    if (this.cycleCooldown > 0) this.cycleCooldown--;

    if (this.input.actions[ACTION.LOCK_ON].pressed) {
      if (this.target) this.setTarget(null);
      else this.setTarget(this.#acquire());
    }

    if (!this.target) return;

    // Flick the right stick while locked to cycle, per CONTROLS.md. Requires a
    // return to neutral in between so one sweep does not cycle four times.
    const look = this.input.look;
    const flick = Math.abs(look.x) > (this.input.device === 'gamepad' ? 0.028 : 0.02);
    if (!flick) this.stickReleased = true;
    else if (this.stickReleased && this.cycleCooldown <= 0) {
      this.stickReleased = false;
      this.cycleCooldown = TUNING.lockOn.cycleCooldownFrames;
      const next = this.#cycle(Math.sign(look.x));
      if (next) this.setTarget(next);
    }

    this.#checkBreak();
  }

  #checkBreak() {
    const t = this.target;
    if (!t || t.alive === false) {
      this.setTarget(null);
      return;
    }
    const dist = this.player.position.distanceTo(t.position);
    if (dist > TUNING.lockOn.breakDistance) {
      this.setTarget(null);
      return;
    }
    // Line of sight is checked periodically rather than every frame: a raycast
    // per frame per target is wasted work, and a few frames of grace stops
    // lock-on dropping every time a pillar clips the sightline mid-strafe.
    if (++this.losCounter >= TUNING.lockOn.losCheckIntervalFrames) {
      this.losCounter = 0;
      _v.copy(this.player.position).setY(this.player.position.y + 1.2);
      _toTarget.copy(t.position).setY(t.position.y + (t.lockHeight ?? 1.0));
      if (!this.physics.hasLineOfSight(_v, _toTarget, [this.player.collider, t.collider])) {
        t.__losMisses = (t.__losMisses ?? 0) + 1;
        if (t.__losMisses > 3) this.setTarget(null);
      } else {
        t.__losMisses = 0;
      }
    }
  }

  #visibleCandidates(coneDegrees) {
    const cam = this.renderer.camera;
    cam.getWorldDirection(_camForward);
    const cosLimit = Math.cos(THREE.MathUtils.degToRad(coneDegrees) * 0.5);
    const out = [];

    for (const t of this.candidates) {
      if (t.alive === false) continue;
      const dist = this.player.position.distanceTo(t.position);
      if (dist > TUNING.lockOn.maxDistance) continue;

      _toTarget.copy(t.position).sub(cam.position).normalize();
      const dot = _toTarget.dot(_camForward);
      if (dot < cosLimit) continue;

      _v.copy(this.player.position).setY(this.player.position.y + 1.2);
      _toTarget.copy(t.position).setY(t.position.y + (t.lockHeight ?? 1.0));
      if (!this.physics.hasLineOfSight(_v, _toTarget, [this.player.collider, t.collider])) continue;

      out.push({ target: t, dist, dot });
    }
    return out;
  }

  /**
   * Acquisition weights screen-centredness above raw proximity. Pointing the
   * camera at something is a clearer statement of intent than standing near it.
   */
  #acquire() {
    const found = this.#visibleCandidates(TUNING.lockOn.acquireConeDegrees);
    if (!found.length) return null;
    found.sort((a, b) => (b.dot * 2.2 - b.dist * 0.055) - (a.dot * 2.2 - a.dist * 0.055));
    return found[0].target;
  }

  /** Cycle to the next target to the left or right of the current one on screen. */
  #cycle(direction) {
    const found = this.#visibleCandidates(TUNING.lockOn.cycleConeDegrees);
    if (found.length <= 1) return null;

    const cam = this.renderer.camera;
    const screenX = (t) => {
      _v.copy(t.position).project(cam);
      return _v.x;
    };
    const currentX = screenX(this.target);

    const side = found
      .filter((f) => f.target !== this.target)
      .map((f) => ({ ...f, x: screenX(f.target) }))
      .filter((f) => (direction > 0 ? f.x > currentX + 0.02 : f.x < currentX - 0.02))
      .sort((a, b) => (direction > 0 ? a.x - b.x : b.x - a.x));

    return side[0]?.target ?? null;
  }

  dispose() {
    this.candidates.clear();
  }
}
