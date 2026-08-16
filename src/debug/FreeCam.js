import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * FreeCam — detach the camera and fly it (F7).
 *
 * Declared in `DEBUG_KEYS` since Phase 0 and never implemented. It matters
 * more now than it did then: the whole point of this phase is judging a
 * blockout's shape and its colliders, and both questions are asked from
 * vantages the third-person camera cannot reach — above the Descent to see
 * whether the corridor lines up with the steps, out in the middle of the well
 * shaft to check the tower's scale against the oculus.
 *
 * The simulation keeps running underneath. This borrows the camera; it does
 * not pause the game, so you can watch the pigeon path or a physics settle
 * from outside it.
 *
 * WASD to fly, Q/E down and up, Shift for a x4 boost, mouse to look (the
 * camera rig's own look input is reused, so sensitivity and invert match).
 */
export class FreeCam {
  updateWhilePaused = true;

  constructor(engine, debug) {
    this.engine = engine;
    this.debug = debug;
    this.input = engine.resolve('input');
    this.rig = engine.resolve('camera');
    this.camera = engine.resolve('renderer').camera;

    this.active = false;
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 14;
    this.keys = new Set();

    this._onDown = (e) => this.keys.add(e.code);
    this._onUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  #enter() {
    this.active = true;
    // The rig is disabled rather than removed, so it keeps its yaw, pitch and
    // smoothed pivot and hands the camera back exactly where it left it.
    this.rig.enabled = false;
    this.yaw = this.rig.yaw + Math.PI;
    this.pitch = -this.rig.pitch;
  }

  #exit() {
    this.active = false;
    this.rig.enabled = true;
    this.rig.snap();
  }

  update(dt) {
    const want = this.debug.isOn('freecam');
    if (want !== this.active) {
      if (want) this.#enter(); else this.#exit();
    }
    if (!this.active) return;

    const look = this.input.consumeLook(dt);
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -1.5, 1.5);

    _fwd.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
    _right.crossVectors(_fwd, _up).normalize();

    const k = this.keys;
    const boost = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 4 : 1;
    const step = this.speed * boost * dt;

    if (k.has('KeyW')) this.camera.position.addScaledVector(_fwd, step);
    if (k.has('KeyS')) this.camera.position.addScaledVector(_fwd, -step);
    if (k.has('KeyD')) this.camera.position.addScaledVector(_right, step);
    if (k.has('KeyA')) this.camera.position.addScaledVector(_right, -step);
    if (k.has('KeyE')) this.camera.position.y += step;
    if (k.has('KeyQ')) this.camera.position.y -= step;

    this.camera.lookAt(
      this.camera.position.x + _fwd.x,
      this.camera.position.y + _fwd.y,
      this.camera.position.z + _fwd.z
    );
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    if (this.active) this.#exit();
  }
}
