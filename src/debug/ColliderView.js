import * as THREE from 'three';

/**
 * ColliderView — every physics collider in the world, drawn (F5).
 *
 * `DEBUG_KEYS.F5` has declared `colliders` since Phase 0 and nothing has ever
 * read it. `PhysicsWorld.debugMesh` was initialised to null and never touched
 * again. So the one view that answers "is the thing I am standing on where I
 * think it is" has been a dead key for the whole project — while the repo
 * simultaneously documented a bug where the walkable floor and the function
 * that generated it disagreed by half a metre.
 *
 * ## Why `world.debugRender()` and not a hand-built wireframe
 *
 * The obvious implementation is to keep a list of the boxes as they are
 * created and draw a `BoxHelper` for each. That draws *what we asked for*.
 * This draws **what Rapier actually has** — every cuboid, every trimesh
 * triangle, the player's capsule, the arena's containment ring, and anything
 * registered by code that forgot to tell the debug list.
 *
 * The difference is the entire value of the view. A parallel representation
 * can drift from the simulation, and a debug view that drifts from the thing
 * it is debugging is worse than no debug view, because it is confidently wrong.
 */
export class ColliderView {
  updateWhilePaused = true;

  constructor(engine, debug) {
    this.engine = engine;
    this.debug = debug;
    this.physics = engine.resolve('physics');
    this.scene = engine.resolve('renderer').scene;
    this.mesh = null;
  }

  #ensure() {
    if (this.mesh) return this.mesh;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      // Drawn through solid geometry on purpose: the point is to see the
      // collider under the floor you are standing on, and a depth-tested
      // version of this view hides exactly the case you opened it for.
      depthTest: false,
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.scene.add(this.mesh);
    return this.mesh;
  }

  update() {
    const on = this.debug.isOn('colliders');

    if (!on) {
      // Fully torn down rather than hidden. The buffers are proportional to
      // the collider count in the entire chapter, and a debug view should cost
      // nothing at all when it is off.
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh = null;
      }
      return;
    }

    const mesh = this.#ensure();
    const { vertices, colors } = this.physics.world.debugRender();

    // Rapier hands back a fresh pair of typed arrays each call, and the vertex
    // count is stable while nothing is added or removed — so reuse the
    // attribute buffers when the size matches and only reallocate when it does
    // not. This runs every step the view is open.
    const posAttr = mesh.geometry.getAttribute('position');
    if (posAttr && posAttr.array.length === vertices.length) {
      posAttr.array.set(vertices);
      posAttr.needsUpdate = true;
      const colAttr = mesh.geometry.getAttribute('color');
      colAttr.array.set(colors);
      colAttr.needsUpdate = true;
    } else {
      mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    }
    mesh.geometry.computeBoundingSphere();
  }

  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
