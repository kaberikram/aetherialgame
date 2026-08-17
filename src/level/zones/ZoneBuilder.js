import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';

const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _euler = new THREE.Euler();

/**
 * Flags a subtree as decoration — drawn, never collided with.
 *
 * The builder is the only place that knows whether a mesh got a collider, so it
 * is the only place that can say so honestly. Harnesses that compare the physics
 * world against the scene graph need to know which meshes were never meant to
 * agree, and the alternative is every harness maintaining its own list of props
 * by name, which rots the first time a zone gains a rock.
 */
function markNoCollide(object) {
  object.traverse((o) => { o.userData.noCollide = true; });
  return object;
}

/**
 * ZoneBuilder — the construction context every zone module receives.
 *
 * Owns: the per-zone scene subgroups, static collider registration, and the
 * registries the chapter reads back.
 * Forbidden: knowing which zone is calling it, or what any zone looks like.
 *
 * ## Cuboids, not trimeshes
 *
 * `box()` and `ramp()` register **analytic cuboid** colliders. `solid()`
 * registers a triangle mesh built from the visual geometry, and it is now the
 * exception rather than the rule.
 *
 * This is not a rendering decision, it is a *controller* decision. A Rapier
 * kinematic capsule resolving against a box knows the contact plane exactly,
 * so autostep, slope limits and ground snapping all behave the way their
 * constants say they will. Against a swept-tube trimesh it is resolving
 * against whatever triangles the sweep happened to emit, and the result is the
 * class of bug this project already documented and worked around: geometry and
 * the function that generated it disagreeing by half a metre, and a capsule
 * that catches on seams that are not visible.
 *
 * Keep `solid()` for surfaces that are genuinely curved and genuinely walked
 * on — the well shaft, the pool basin. Everything else is a box.
 */
export class ZoneBuilder {
  constructor(engine, root, materials) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.player = engine.resolve('player');
    this.state = engine.resolve('state');
    this.root = root;
    this.materials = materials;
    this.quality = engine.resolve('quality');

    /** Per-zone subtrees. `id -> THREE.Group`. Gated by ZoneManager. */
    this.groups = new Map();
    /** The subgroup `add`/`box`/`solid` currently parent into. */
    this.group = root;

    /** Interactables. `{ id, position, radius, label, onPick }`. */
    this.pickups = [];
  }

  /**
   * Switches the active subgroup. Every zone module calls this first; anything
   * built afterwards belongs to that zone and is hidden with it.
   */
  zone(id) {
    let g = this.groups.get(id);
    if (!g) {
      g = new THREE.Group();
      g.name = `zone:${id}`;
      this.root.add(g);
      this.groups.set(id, g);
    }
    this.group = g;
    return g;
  }

  /** Parents an object into the active zone group without collision. */
  add(object) {
    this.group.add(object);
    markNoCollide(object);
    return object;
  }

  /**
   * Mesh + analytic cuboid collider. The blockout primitive.
   *
   * @param {THREE.Vector3} size full extents, not half
   * @param {THREE.Vector3} position centre
   */
  box(size, position, material, opts = {}) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(position);
    if (opts.rotation) mesh.rotation.copy(opts.rotation);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    if (opts.noInk) mesh.userData.noInk = true;
    this.group.add(mesh);
    if (opts.collide !== false) {
      this.physics.addStaticBox(size, position,
        opts.rotation ? new THREE.Quaternion().setFromEuler(opts.rotation) : null,
        { group: opts.group ?? FILTERS.world });
    } else {
      markNoCollide(mesh);
    }
    return mesh;
  }

  /**
   * A box spanning two points, rotated to lie along them. The slope primitive.
   *
   * This exists because sampling a height function per vertex and colliding the
   * result is how the walkable floor and the function that defines it drifted
   * apart in the first place. A ramp between two points on the function *is*
   * the function wherever the function is linear, exactly, with no sampling
   * and nothing to diverge.
   *
   * @param {THREE.Vector3} from centre of the low end, on the walking surface
   * @param {THREE.Vector3} to   centre of the high end, on the walking surface
   * @param {number} width  across the direction of travel
   * @param {number} thickness downward, from the walking surface
   */
  ramp(from, to, width, thickness, material, opts = {}) {
    _dir.subVectors(to, from);
    const length = _dir.length();
    if (length < 1e-4) throw new Error('ZoneBuilder.ramp: from and to coincide');
    _dir.divideScalar(length);

    // The slab is built length-along-local-Z, then yawed to face the direction
    // of travel and pitched to its slope. With Euler order YXZ, local +Z lands
    // on `_dir` for exactly these two angles, and local +Y is then the surface
    // normal — which is what we push the slab down along.
    const yaw = Math.atan2(_dir.x, _dir.z);
    const pitch = -Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
    _euler.set(pitch, yaw, 0, 'YXZ');
    _quat.setFromEuler(_euler);
    _up.set(0, 1, 0).applyQuaternion(_quat);

    const size = new THREE.Vector3(width, thickness, length);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.quaternion.copy(_quat);
    // `from` and `to` describe the surface the player stands on, not the
    // centre of a slab, so the body hangs entirely below that line.
    _mid.addVectors(from, to).multiplyScalar(0.5).addScaledVector(_up, -thickness * 0.5);
    mesh.position.copy(_mid);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    if (opts.noInk) mesh.userData.noInk = true;
    this.group.add(mesh);

    if (opts.collide !== false) {
      this.physics.addStaticBox(size, mesh.position, mesh.quaternion,
        { group: opts.group ?? FILTERS.world });
    } else {
      markNoCollide(mesh);
    }
    return mesh;
  }

  /**
   * Mesh + trimesh collider. For genuinely curved walkable surfaces only —
   * see the class comment. Prefer `box`/`ramp`.
   */
  solid(geometry, material, position, { collide = true, rotation = null, group = FILTERS.world, noInk = false } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (noInk) mesh.userData.noInk = true;
    mesh.updateMatrixWorld(true);
    this.group.add(mesh);
    if (collide) this.physics.addStaticGeometry(geometry, mesh.matrixWorld.clone(), { group });
    return mesh;
  }

  pickup(def) {
    this.pickups.push(def);
    return def;
  }
}
