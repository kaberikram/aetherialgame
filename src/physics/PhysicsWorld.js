import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision groups. Rapier packs membership in the high 16 bits and the filter
 * mask in the low 16, so a group is `(membership << 16) | mask`.
 *
 * The camera is its own group so it can sweep against world geometry while
 * ignoring the player it is attached to — otherwise it collides with the body
 * it is trying to frame and shoves itself into the character's skull.
 */
export const GROUP = Object.freeze({
  WORLD: 0x0001,
  PLAYER: 0x0002,
  ENEMY: 0x0004,
  HITBOX: 0x0008,
  TRIGGER: 0x0010,
  CAMERA_BLOCKER: 0x0020, // world geometry the camera must not pass through
  WATER: 0x0040,
});

export const filter = (membership, mask) => ((membership << 16) | mask) >>> 0;

/** Ready-made interaction filters for the common cases. */
export const FILTERS = {
  world: filter(GROUP.WORLD | GROUP.CAMERA_BLOCKER, 0xffff),
  player: filter(GROUP.PLAYER, GROUP.WORLD | GROUP.ENEMY | GROUP.TRIGGER | GROUP.HITBOX),
  enemy: filter(GROUP.ENEMY, GROUP.WORLD | GROUP.PLAYER | GROUP.HITBOX),
  // Camera sweeps see world only. Never the player, never enemies, never triggers.
  camera: filter(GROUP.CAMERA_BLOCKER, GROUP.CAMERA_BLOCKER | GROUP.WORLD),
  /**
   * Invisible containment: stops the player leaving an arena but is ignored by
   * the camera. Without this the camera collides with a wall the player cannot
   * even see and shoves itself into the back of their head at the exact moment
   * the boss is doing something worth looking at.
   */
  containment: filter(GROUP.WORLD, GROUP.PLAYER | GROUP.ENEMY),
  trigger: filter(GROUP.TRIGGER, GROUP.PLAYER),
  hitbox: filter(GROUP.HITBOX, GROUP.PLAYER | GROUP.ENEMY),
};

const _v = new THREE.Vector3();

/**
 * PhysicsWorld — owns the Rapier world and the body↔object mapping.
 *
 * Resolves motion. Never authors intent: nothing in here knows what a roll is
 * or why the player wants to be somewhere, only whether they can get there.
 */
export class PhysicsWorld {
  static async create(engine) {
    await RAPIER.init();
    return new PhysicsWorld(engine);
  }

  constructor(engine) {
    this.engine = engine;
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Rapier's own integration step must match our fixed step exactly, or
    // dynamic bodies (ragdolls, debris) desync from the kinematic ones.
    this.world.timestep = engine.fixedDelta;
    this.world.numSolverIterations = 4;

    /** @type {Map<number, THREE.Object3D>} collider handle → owning object */
    this.owners = new Map();
    this.debugMesh = null;
  }

  /** Static level geometry. Accepts a THREE.BufferGeometry with a world matrix. */
  addStaticGeometry(geometry, matrix, { group = FILTERS.world, friction = 0.7 } = {}) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.attributes.position;
    const verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (matrix) _v.applyMatrix4(matrix);
      verts[i * 3] = _v.x;
      verts[i * 3 + 1] = _v.y;
      verts[i * 3 + 2] = _v.z;
    }
    const indices = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) indices[i] = i;

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(verts, indices)
      .setCollisionGroups(group)
      .setFriction(friction);
    const collider = this.world.createCollider(desc, body);
    if (geo !== geometry) geo.dispose();
    return { body, collider };
  }

  /** Convenience for grey box: an axis-aligned box collider. */
  addStaticBox(size, position, quaternion = null, opts = {}) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
    );
    if (quaternion) body.setRotation(quaternion, false);
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setCollisionGroups(opts.group ?? FILTERS.world)
      .setFriction(opts.friction ?? 0.7);
    const collider = this.world.createCollider(desc, body);
    return { body, collider };
  }

  /**
   * Kinematic capsule with a Rapier character controller.
   * Autostep and snap-to-ground are what make stairs and slopes feel solid
   * instead of like an obstacle course.
   */
  createCharacter({
    position,
    radius,
    halfHeight,
    maxSlopeDegrees,
    minSlideSlopeDegrees,
    stepOffset,
    snapDistance,
    group = FILTERS.player,
  }) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(group),
      body
    );

    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(stepOffset, radius * 0.7, true);
    controller.enableSnapToGround(snapDistance);
    controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(maxSlopeDegrees));
    controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(minSlideSlopeDegrees));
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(78);

    return { body, collider, controller };
  }

  createDynamicBox(size, position, { mass = 10, group = FILTERS.world } = {}) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setCollisionGroups(group)
        .setMass(mass),
      body
    );
    return { body, collider };
  }

  removeBody(body) {
    if (body) this.world.removeRigidBody(body);
  }

  /**
   * `exclude` accepts a collider or an array of them. Rapier's single
   * exclude-collider slot is not enough for a line-of-sight test, which has to
   * ignore both ends of the line, so multiples go through the predicate.
   *
   * @returns {{ point: THREE.Vector3, normal: THREE.Vector3, distance: number, collider } | null}
   */
  raycast(origin, direction, maxDistance, { groups = FILTERS.world, exclude = null, solid = true } = {}) {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z }
    );
    const list = Array.isArray(exclude) ? exclude.filter(Boolean) : (exclude ? [exclude] : []);
    const single = list.length === 1 ? list[0] : undefined;
    const predicate = list.length > 1 ? (c) => !list.includes(c) : undefined;
    const hit = this.world.castRayAndGetNormal(
      ray, maxDistance, solid, undefined, groups, single, undefined, predicate
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: new THREE.Vector3(
        origin.x + direction.x * d,
        origin.y + direction.y * d,
        origin.z + direction.z * d
      ),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Sphere sweep. The camera uses this so it pulls in on a volume, not a line. */
  sphereCast(origin, direction, radius, maxDistance, { groups = FILTERS.camera, exclude = null } = {}) {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: direction.x, y: direction.y, z: direction.z },
      shape,
      0,
      maxDistance,
      true,
      undefined,
      groups,
      exclude ?? undefined
    );
    if (!hit) return null;
    return { distance: hit.time_of_impact ?? hit.toi ?? 0, collider: hit.collider };
  }

  /**
   * True when nothing solid sits between the two points.
   *
   * @param {Collider|Collider[]} exclude both endpoints' own colliders — a
   *        target's own body will otherwise block the sightline to itself.
   */
  hasLineOfSight(from, to, exclude = null) {
    const dir = _v.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(from, dir, dist - 0.1, { groups: FILTERS.camera, exclude });
    return hit === null;
  }

  fixedUpdate() {
    this.world.step();
  }

  dispose() {
    this.world.free();
  }
}
