import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { FILTERS } from '../physics/PhysicsWorld.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * CameraRig — collision-aware third-person camera.
 *
 * Three rules do most of the work:
 *
 * 1. Position lags more than rotation. A camera that tracks position perfectly
 *    feels welded to the character; one that lags slightly feels attached to
 *    a body that has mass.
 * 2. Collision pulls in fast and pushes out slow. Snapping outward as you clear
 *    a corner is far more nauseating than easing out over a few frames.
 * 3. Locked on, auto-recenter is disabled entirely and the target is framed
 *    slightly off-centre — Souls framing, not FPS dead-centre.
 */
export class CameraRig {
  constructor(engine, player) {
    this.engine = engine;
    this.bus = engine.bus;
    this.input = engine.resolve('input');
    this.physics = engine.resolve('physics');
    this.player = player;

    this.camera = engine.resolve('renderer').camera;

    this.yaw = 0;
    this.pitch = 0.12;
    this.distance = TUNING.camera.distance;
    this.currentDistance = TUNING.camera.distance;
    this.smoothPivot = new THREE.Vector3();
    this.idleTime = 0;
    this.shake = 0;
    this.shakeDecay = 4.2;
    this.fovOffset = 0;
    this.enabled = true;
    // The void has no geometry, so it has nothing to collide with. Leaving the
    // sweep on there is not just wasted work — it finds whatever level is
    // parked elsewhere in the world and yanks the camera into the character.
    this.collisionEnabled = true;
    this.lockTarget = null;
    this.lockPivotLift = 0;
    /**
     * Optional arena confinement: { center: Vector3, radius: number }.
     * A boss arena is ringed by stonework the camera must not sit behind. A
     * collider ring would work but would also stop the camera backing off from
     * a large target, so instead the camera is simply kept inside the circle
     * and gives up distance at the rim — which is the trade you want anyway.
     */
    this.bounds = null;

    this.bus.on(EVENTS.LOCKON_CHANGED, ({ target }) => {
      this.lockTarget = target;
    });
    this.bus.on(EVENTS.PLAYER_SPAWNED, () => this.snap());

    this.smoothPivot.copy(player.position).add(_v.set(0, TUNING.camera.height, 0));
  }

  addShake(strength) {
    this.shake = Math.min(1.4, this.shake + strength);
  }

  /** Place the rig at its resolved position with no smoothing. */
  snap({ yaw = null } = {}) {
    const c = TUNING.camera;
    if (yaw !== null) this.yaw = yaw;
    this.smoothPivot.copy(this.player.position);
    this.smoothPivot.y += c.height;
    _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(c.shoulderOffset);
    this.smoothPivot.add(_v2);
    this.currentDistance = this.distance;
    _dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.position.copy(this.smoothPivot).addScaledVector(_dir, this.currentDistance);
    this.camera.lookAt(this.smoothPivot);
    this.camera.updateMatrixWorld(true);
  }

  fixedUpdate(dt) {
    if (!this.enabled) return;
    const c = TUNING.camera;
    const look = this.input.look;

    if (Math.abs(look.x) > 0.0001 || Math.abs(look.y) > 0.0001) {
      this.yaw -= look.x;
      this.pitch -= look.y;
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, c.pitchMin, c.pitchMax);

    if (this.lockTarget) {
      this.#updateLocked(dt);
    } else {
      this.#updateFree(dt);
    }
  }

  #updateFree(dt) {
    const c = TUNING.camera;
    // Auto-recenter behind the player after a spell of no camera input, so
    // traversal does not become a two-stick chore.
    const p = this.player;
    const moving = Math.hypot(p.velocity.x, p.velocity.z) > 1.2;
    if (this.idleTime > c.autoRecenterDelay && moving) {
      // The rig's yaw is the direction from the pivot OUT to the camera, so
      // sitting behind the player means facing + π. Targeting `facing` puts the
      // camera in front, and since movement is camera-relative the two then
      // chase each other and the character walks in a slow circle.
      let delta = p.facing + Math.PI - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * Math.min(1, c.autoRecenterSpeed * dt);
      // Ease the pitch back to neutral at the same time.
      this.pitch += (0.09 - this.pitch) * Math.min(1, c.autoRecenterSpeed * 0.6 * dt);
    }
    this.distance = c.distance;
  }

  #updateLocked(dt) {
    const c = TUNING.camera;
    const p = this.player;
    _v.copy(this.lockTarget.position).sub(p.position);
    const flatDist = Math.hypot(_v.x, _v.z);

    // Yaw sits behind the player, looking down the player→target line.
    const targetYaw = Math.atan2(-_v.x, -_v.z);
    let delta = targetYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * Math.min(1, c.lockedSmoothing * dt);

    // A tall enemy at close range must not be framed by pitching the camera
    // down and looking up — that drives the camera into the floor. Instead the
    // PIVOT rises toward the target's lock point, so the camera stays level
    // and the framing opens upward. Pitch is clamped to stay at or above the
    // pivot for the same reason.
    const heightDelta = (this.lockTarget.position.y + (this.lockTarget.lockHeight ?? 1.0)) - (p.position.y + c.height);
    const closeness = 1 - THREE.MathUtils.clamp((flatDist - 2.0) / 7.0, 0, 1);
    const wantLift = THREE.MathUtils.clamp(heightDelta, 0, 3.2) * (0.35 + closeness * 0.5);
    this.lockPivotLift = THREE.MathUtils.damp(this.lockPivotLift, wantLift, 6.0, dt);

    const wantPitch = THREE.MathUtils.clamp(
      -Math.atan2(heightDelta - this.lockPivotLift, Math.max(2.6, flatDist)) - TUNING.lockOn.screenBiasY,
      -0.12,
      c.pitchMax * 0.7
    );
    this.pitch += (wantPitch - this.pitch) * Math.min(1, c.lockedSmoothing * 0.7 * dt);

    // Back off from very large targets so the whole silhouette stays readable —
    // a wind-up you cannot see is not a wind-up.
    const scale = this.lockTarget.lockDistanceScale ?? 1;
    this.distance = THREE.MathUtils.clamp(c.lockedDistance * scale + flatDist * 0.10, 3.4, 13.0);
  }

  /** Runs in update (not fixedUpdate) so camera motion is smooth above 60Hz. */
  update(dt, alpha) {
    if (!this.enabled) return;
    const c = TUNING.camera;
    const p = this.player;

    _pivot.copy(p.position);
    _pivot.y += c.height + (this.lockTarget ? this.lockPivotLift : 0);
    if (!this.lockTarget) this.lockPivotLift = THREE.MathUtils.damp(this.lockPivotLift, 0, 6, dt);
    // The shoulder offset gives the character somewhere to be other than the
    // exact centre of the screen, which is what makes the framing read as
    // over-the-shoulder rather than as a tripod.
    _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(c.shoulderOffset);
    _pivot.add(_v2);

    this.smoothPivot.lerp(_pivot, Math.min(1, c.positionSmoothing * dt));

    _dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    _desired.copy(this.smoothPivot).addScaledVector(_dir, this.distance);

    let limit = this.distance;
    if (this.bounds) limit = Math.min(limit, this.#distanceToBounds(this.smoothPivot, _dir));
    const target = this.#resolveCollision(this.smoothPivot, _dir, limit);
    // Pull in fast, push out slow. Corners stop popping.
    const rate = target < this.currentDistance ? c.collisionPullInSpeed : c.collisionPushOutSpeed;
    this.currentDistance = THREE.MathUtils.damp(this.currentDistance, target, rate, dt);
    _desired.copy(this.smoothPivot).addScaledVector(_dir, this.currentDistance);

    if (this.shake > 0.001) {
      const s = this.shake * 0.16;
      _desired.x += (Math.random() - 0.5) * s;
      _desired.y += (Math.random() - 0.5) * s;
      _desired.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt);
    }

    // Last-resort floor guard. Collision sweeps handle walls, but a camera
    // that ends up under the ground plane produces a black frame, which is
    // worse than any framing compromise.
    const minY = p.position.y + 0.45;
    if (_desired.y < minY) _desired.y = minY;

    this.camera.position.copy(_desired);

    // Look at the pivot, biased so a locked target sits off-centre.
    _v.copy(this.smoothPivot);
    if (this.lockTarget) {
      _v2.copy(this.lockTarget.position);
      _v2.y += this.lockTarget.lockHeight ?? 1.0;
      _v.lerp(_v2, 0.38);
    }
    this.camera.lookAt(_v);

    // Sprint FOV. Small, but it is most of what makes speed read as speed.
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const wantFov = c.fov + (speed > TUNING.movement.runSpeed * 1.05 ? c.fovSprintBoost : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, wantFov, c.fovSmoothing, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Sphere-sweep from the pivot outward. A sphere rather than a ray, because a
   * ray squeezes the camera through railings and thin pillars and then the
   * near plane clips into them.
   */
  /**
   * How far along `dir` the camera can travel before leaving the arena circle.
   * Solves |pivot + t·dir − centre|² = r² for the positive root, in the
   * horizontal plane only — vertical is handled by the collision sweep.
   */
  #distanceToBounds(pivot, dir) {
    const { center, radius } = this.bounds;
    const ox = pivot.x - center.x;
    const oz = pivot.z - center.z;
    const dx = dir.x;
    const dz = dir.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-6) return Infinity;
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) return TUNING.camera.minCollisionDistance; // pivot already outside
    const t = (-b + Math.sqrt(disc)) / (2 * a);
    return Math.max(TUNING.camera.minCollisionDistance, t);
  }

  #resolveCollision(pivot, dir, maxDistance) {
    const c = TUNING.camera;
    if (!this.collisionEnabled) return maxDistance;
    const hit = this.physics.sphereCast(pivot, dir, c.collisionRadius, maxDistance, {
      groups: FILTERS.camera,
    });
    if (!hit) return maxDistance;
    return Math.max(c.minCollisionDistance, hit.distance - 0.06);
  }
}
