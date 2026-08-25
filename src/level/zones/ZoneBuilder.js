import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';

const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _euler = new THREE.Euler();
const _right = new THREE.Vector3();

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

  /**
   * A walkable route: the floor, and the walls that keep you on it, from ONE
   * declaration of how wide it is.
   *
   * ## The bug this primitive exists to make unrepresentable
   *
   * Every route in this chapter used to state its width twice — once when it
   * built its floor, and again, separately, when it built the walls that were
   * supposed to stop the player walking off that floor. Nothing reconciled the
   * two, and wherever the wall number was the larger one there was an open
   * strip between the floor's edge and the wall's inner face:
   *
   *   Descent main line   floor half 4.0–4.5   wall inner 5.8    → 1.3–1.8m
   *   Green Vein          floor half 11.6      wall inner ≤15.5  → up to 3.9m
   *   Pool approach       floor half 6.0–7.5   no colliding wall → unbounded
   *
   * The Green Vein is the clearest: its floor is one ramp of constant width
   * `max(FLOOR_WIDTH(2), FLOOR_WIDTH(−54))`, while its walls were placed at
   * `FLOOR_WIDTH(zm)/2 + 2`, and `FLOOR_WIDTH` peaks *inside the zone* at
   * z≈−39. So the wall stood 15.5m out and the floor stopped at 11.6m, and the
   * player fell down the gap.
   *
   * This is the same failure as the one D57 fixed — geometry and the function
   * that generates it, drifting — in the other axis. The answer is the same:
   * one declaration, read by both.
   *
   * @param {Array<THREE.Vector3|{at: THREE.Vector3, noFloor?: boolean}>} points
   *        the walking surface, as a polyline. A point marked `noFloor` opens a
   *        hole in the FLOOR of the segment leaving it while keeping the walls
   *        and ceiling — that is how the Descent's authored jump gap stays a
   *        gap you can fall through and not a gap you can walk out of sideways.
   * @param {number|function} width across the direction of travel. A function
   *        is sampled at each segment's midpoint as `width(z, t)`, so a passage
   *        can narrow — and the walls narrow with it, because they read this.
   *
   * `floor: false` emits only the walls. That is for a route whose walkable
   * surface is authored some other way — stairs, say — which still wants its
   * edges guarded off the same width expression the stairs are cut from.
   */
  path(points, {
    width,
    thickness = 1.2,
    material,
    floor = true,
    walls = true,
    wallHeight = 8,
    wallThickness = 1.2,
    wallMaterial = material,
    ceiling = false,
    ceilingHeight = 7,
    ceilingThickness = 1.0,
    ceilingMaterial = material,
    castShadow,
    noInk = false,
  } = {}) {
    const nodes = points.map((p) => (p.isVector3 ? { at: p } : p));
    if (nodes.length < 2) throw new Error('ZoneBuilder.path: needs at least two points');

    const widthAt = typeof width === 'function' ? width : () => width;
    const out = { floors: [], walls: [], ceilings: [], shoulders: [] };
    /** Per-segment geometry, kept so joints can be closed afterwards. */
    const segs = [];

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const from = a.at;
      const to = b.at;

      _dir.subVectors(to, from);
      const length = _dir.length();
      if (length < 1e-4) continue;
      _dir.divideScalar(length);

      const t = (i + 0.5) / (nodes.length - 1);
      const mid = from.clone().lerp(to, 0.5);
      const w = widthAt(mid.z, t);

      // Joints overlap rather than meet.
      //
      // Two ramps sharing an endpoint share their top EDGE, but at a change of
      // heading those two edges are perpendicular to different axes, so the
      // outside of every turn is a wedge of missing floor. Extending each
      // segment along its own axis past both ends closes that, at the cost of a
      // lip where the two planes cross: `overlap × Δslope`, which at this
      // chapter's slopes is ~0.12m against a 0.42m step offset.
      const grow = ZoneBuilder.JOINT_OVERLAP;
      const ext0 = from.clone().addScaledVector(_dir, -grow);
      const ext1 = to.clone().addScaledVector(_dir, grow);

      if (floor && !a.noFloor) {
        out.floors.push(this.ramp(ext0, ext1, w, thickness, material, { castShadow, noInk }));
      }

      // Walls. The inner face lands at exactly w/2 from the centreline, which
      // is the floor's edge, because both came off `widthAt`.
      if (walls) {
        const yaw = Math.atan2(_dir.x, _dir.z);
        const right = _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const rot = new THREE.Euler(0, yaw, 0);
        segs.push({ w, yaw, from, to, right: right.clone() });
        // Horizontal run: a wall is vertical, so it spans the segment's ground
        // distance, not its 3D length.
        const run = Math.hypot(to.x - from.x, to.z - from.z) + grow * 2;
        // A wall is vertical and the floor under it is not. Sitting the wall on
        // the segment's MIDPOINT leaves its bottom edge above the floor at the
        // low end by half the segment's fall — half a metre on the Descent's
        // lower route, which is a slot under the railing at exactly the place
        // the player is sliding along it. Drop the wall by that much and make
        // it taller by the same, so its base is under the lowest floor it
        // guards and its top is where it was.
        // Exactly to the segment's own lowest floor, and no further. Extending
        // by a blanket margin instead pushed the Descent's 16m walls three
        // metres below their midpoint and straight through the lower route
        // running underneath, which walled off the crawl.
        const base = Math.min(from.y, to.y) - 0.5;
        const cap = mid.y + wallHeight - 0.5;
        for (const side of [-1, 1]) {
          out.walls.push(this.box(
            new THREE.Vector3(wallThickness, cap - base, run),
            mid.clone()
              .addScaledVector(right, side * (w * 0.5 + wallThickness * 0.5))
              .setY((cap + base) * 0.5),
            wallMaterial,
            { rotation: rot, castShadow, noInk }
          ));
        }

        if (ceiling) {
          const run2 = Math.hypot(to.x - from.x, to.z - from.z) + grow * 2;
          out.ceilings.push(this.box(
            new THREE.Vector3(w + wallThickness * 2, ceilingThickness, run2),
            mid.clone().setY(mid.y + ceilingHeight),
            ceilingMaterial,
            // Roofs never cast: one directional key lights the whole chapter and
            // every room is enclosed, so a shadow-casting lid means the key
            // reaches nothing. See the note in Descent's buildShell.
            { rotation: rot, castShadow: false, noInk: true }
          ));
        }
      }
    }

    // Shoulders: close the joints where the width changes.
    //
    // Each segment's wall stands at its OWN half-width, so where the route
    // narrows, the wider segment's floor runs out past the narrower segment's
    // wall and its far edge is open air. That is a hole, and it is the one the
    // Green Vein's handover into the pool stairs opened — 21m of cavern meeting
    // 15m of staircase, with 3m of floor either side ending at nothing.
    //
    // A short wall across the step closes it, on the side that shrank, at every
    // joint that shrinks. Cheap: most joints do not change width at all.
    for (let i = 0; i < segs.length - 1; i++) {
      const a = segs[i];
      const b = segs[i + 1];
      const delta = a.w - b.w;
      if (Math.abs(delta) < 0.1) continue;
      const wide = delta > 0 ? a : b;
      const span = Math.abs(delta) * 0.5 + wallThickness;
      const at = a.to;
      for (const side of [-1, 1]) {
        out.shoulders.push(this.box(
          new THREE.Vector3(span, wallHeight, wallThickness),
          at.clone()
            .addScaledVector(wide.right, side * (Math.min(a.w, b.w) * 0.5 + span * 0.5))
            .setY(at.y + wallHeight * 0.5 - 0.5),
          wallMaterial,
          { rotation: new THREE.Euler(0, wide.yaw, 0), castShadow, noInk }
        ));
      }
    }

    return out;
  }

  pickup(def) {
    this.pickups.push(def);
    return def;
  }
}

/**
 * How far each path segment reaches past its own endpoints, so joints overlap
 * instead of meeting at a line. See the note in `path()`.
 */
ZoneBuilder.JOINT_OVERLAP = 0.6;
