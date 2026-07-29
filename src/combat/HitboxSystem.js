import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Shortest distance between two capsule segments. Used for hit tests.
 * Standard segment-to-segment closest-approach; the guard cases are the
 * degenerate ones where a capsule has (near) zero length.
 */
function segmentDistance(p1, q1, p2, q2) {
  const d1 = _ab.copy(q1).sub(p1);
  const d2 = _ac.copy(q2).sub(p2);
  const r = _bc.copy(p1).sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);

  let s, t;
  const EPS = 1e-6;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = _closest.copy(p1).addScaledVector(d1, s);
  const c2 = _bc.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/**
 * A capsule bound to a bone. Its world endpoints are recomputed from the bone's
 * matrix every frame, so it follows the animation exactly rather than being a
 * guess at where the blade probably is.
 */
export class BoundCapsule {
  constructor({ bone, offset = [0, 0, 0], radius = 0.2, length = 0.6 }) {
    this.boneName = bone;
    this.offset = new THREE.Vector3().fromArray(offset);
    this.radius = radius;
    this.length = length;
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this._bone = null;
  }

  bind(rig) {
    this._bone = rig.byName.get(this.boneName);
    if (!this._bone) throw new Error(`HitboxSystem: no bone "${this.boneName}"`);
    return this;
  }

  /** Endpoints run along the bone's local −Y, the direction limbs extend. */
  update() {
    const bone = this._bone;
    bone.updateWorldMatrix(true, false);
    _a.copy(this.offset).applyMatrix4(bone.matrixWorld);
    _b.copy(this.offset).setY(this.offset.y - this.length).applyMatrix4(bone.matrixWorld);
    this.a.copy(_a);
    this.b.copy(_b);
    return this;
  }

  intersects(other) {
    return segmentDistance(this.a, this.b, other.a, other.b) <= this.radius + other.radius;
  }

  /** Midpoint, used as the impact position for VFX and audio. */
  midpoint(out = new THREE.Vector3()) {
    return out.copy(this.a).add(this.b).multiplyScalar(0.5);
  }
}

/**
 * A simple upright hurtbox for anything without a rig (dummies, props).
 * Same interface as BoundCapsule so the overlap test does not care which it is.
 */
export class StaticCapsule {
  constructor({ position, height = 1.6, radius = 0.36, yOffset = 0 }) {
    this.radius = radius;
    this.height = height;
    this.yOffset = yOffset;
    this._source = position;
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.update();
  }

  update() {
    this.a.copy(this._source).setY(this._source.y + this.yOffset + this.radius);
    this.b.copy(this._source).setY(this._source.y + this.yOffset + this.height - this.radius);
    return this;
  }

  midpoint(out = new THREE.Vector3()) {
    return out.copy(this.a).add(this.b).multiplyScalar(0.5);
  }
}

/**
 * HitboxSystem — owns which capsules are live on which frame and reports
 * overlaps. It does NOT apply damage: it says "these two capsules touched" and
 * DamageSystem decides what that means.
 *
 * A swing registers at most one hit per target, tracked per activation, so a
 * six-frame active window is not six hits.
 */
export class HitboxSystem {
  constructor(engine) {
    this.engine = engine;
    /** @type {Map<object, {hurtbox: object, entity: object}>} */
    this.hurtboxes = new Map();
    /** @type {Array<{owner, capsule, move, alreadyHit:Set, onHit}>} */
    this.active = [];
    this.debugGroup = null;
  }

  registerHurtbox(entity, hurtbox) {
    this.hurtboxes.set(entity, hurtbox);
  }

  unregisterHurtbox(entity) {
    this.hurtboxes.delete(entity);
  }

  /**
   * Open a hitbox for the duration of a swing. Called on the exact frame the
   * move data says `active` begins.
   */
  activate({ owner, capsule, move, onHit, faction = 'player' }) {
    this.active.push({ owner, capsule, move, faction, onHit, alreadyHit: new Set() });
  }

  deactivate(owner) {
    this.active = this.active.filter((h) => h.owner !== owner);
  }

  get activeCount() {
    return this.active.length;
  }

  fixedUpdate() {
    if (!this.active.length) return;

    for (const hit of this.active) {
      hit.capsule.update();
      for (const [entity, hurtbox] of this.hurtboxes) {
        if (entity === hit.owner) continue;
        if (entity.faction === hit.faction) continue;
        if (entity.alive === false) continue;
        if (hit.alreadyHit.has(entity)) continue;

        hurtbox.update();
        if (!hit.capsule.intersects(hurtbox)) continue;

        // One registration per target per swing. A six-frame active window is
        // one hit, not six.
        hit.alreadyHit.add(entity);
        hit.onHit?.(entity, hit.capsule.midpoint(), hit.move);
        if (!hit.move.multiTarget) break;
      }
    }
  }

  /** F2 debug visualisation. Green = idle hurtbox, red = live hitbox. */
  buildDebug(scene) {
    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    scene.add(this.debugGroup);
    this._debugMeshes = new Map();
    return this;
  }

  updateDebug(visible) {
    if (!this.debugGroup) return;
    this.debugGroup.visible = visible;
    if (!visible) return;

    const seen = new Set();
    const draw = (key, capsule, color) => {
      seen.add(key);
      let mesh = this._debugMeshes.get(key);
      const length = Math.max(0.01, capsule.a.distanceTo(capsule.b));
      if (!mesh) {
        // The built length is recorded on the mesh rather than read back from
        // geometry.parameters, whose key name has moved between Three versions.
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(capsule.radius, length, 3, 8),
          new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.85 })
        );
        mesh.userData.builtLength = length;
        mesh.renderOrder = 999;
        this.debugGroup.add(mesh);
        this._debugMeshes.set(key, mesh);
      }
      mesh.visible = true;
      mesh.material.color.setHex(color);
      mesh.position.copy(capsule.a).add(capsule.b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        _up.set(0, 1, 0),
        _ab.copy(capsule.b).sub(capsule.a).normalize()
      );
      mesh.scale.y = length / mesh.userData.builtLength;
    };

    for (const [entity, hurtbox] of this.hurtboxes) {
      hurtbox.update();
      draw(`hurt:${entity.id ?? entity.name ?? entity.uuid}`, hurtbox, 0x4fa85c);
    }
    for (let i = 0; i < this.active.length; i++) {
      draw(`hit:${i}`, this.active[i].capsule, 0xd0453c);
    }
    for (const [key, mesh] of this._debugMeshes) {
      if (!seen.has(key)) mesh.visible = false;
    }
  }
}
