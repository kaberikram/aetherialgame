import * as THREE from 'three';
import { FILTERS } from '../physics/PhysicsWorld.js';

/**
 * TestRoom — the Phase 1 proving ground.
 *
 * Slopes at every angle around the climb limit, a step run at increasing
 * heights around the step offset, ledges to drop off, gaps to jump, a pillar
 * forest to test camera collision, and a lock-on dummy.
 *
 * Everything here is measured against real numbers rather than eyeballed, so
 * "the step offset is wrong" is a thing you can observe rather than suspect.
 */
export class TestRoom {
  constructor(engine) {
    this.engine = engine;
    this.physics = engine.resolve('physics');
    this.scene = engine.resolve('renderer').scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.colliders = [];
  }

  #mat(color, roughness = 0.94) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  }

  #box(size, position, color, rotation = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), this.#mat(color));
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (rotation) mesh.rotation.copy(rotation);
    this.group.add(mesh);

    const q = rotation ? new THREE.Quaternion().setFromEuler(rotation) : null;
    const { collider } = this.physics.addStaticBox(size, position, q, { group: FILTERS.world });
    this.colliders.push(collider);
    return mesh;
  }

  build() {
    const GREY = 0x6a6f76;
    const MID = 0x585d64;
    const DARK = 0x474b51;
    const ACCENT = 0x7d848c;

    // Floor
    this.#box(new THREE.Vector3(70, 1, 70), new THREE.Vector3(0, -0.5, 0), GREY);

    // --- Slopes, 5° apart across the 52° climb limit -----------------------
    // Below the limit you walk up. Above it you slide. The pair either side of
    // the threshold is what makes the limit legible rather than mysterious.
    const slopeAngles = [12, 24, 36, 46, 52, 58];
    slopeAngles.forEach((deg, i) => {
      const rad = THREE.MathUtils.degToRad(deg);
      const len = 7;
      const x = -26 + i * 5.2;
      this.#box(
        new THREE.Vector3(4.2, 0.5, len),
        new THREE.Vector3(x, (Math.sin(rad) * len) / 2, -14),
        i >= 4 ? DARK : MID,
        new THREE.Euler(-rad, 0, 0)
      );
    });

    // --- Step run: 0.15m up to 0.60m, bracketing the 0.42m step offset -----
    const stepHeights = [0.15, 0.25, 0.35, 0.42, 0.5, 0.6];
    let y = 0;
    stepHeights.forEach((h, i) => {
      y += h;
      this.#box(new THREE.Vector3(5, y, 1.6), new THREE.Vector3(14, y / 2, -6 + i * 1.7), i === 3 ? ACCENT : MID);
    });

    // --- Ledges to drop from: 1m, 3m, 6m, 11m ------------------------------
    // The 11m drop is past the fall-damage threshold, and well past it is death.
    const ledgeHeights = [1, 3, 6, 11];
    ledgeHeights.forEach((h, i) => {
      this.#box(new THREE.Vector3(6, h, 6), new THREE.Vector3(-22 + i * 7.5, h / 2, 12), MID);
    });

    // --- Gaps to jump: 1.5m to 4.5m ----------------------------------------
    // The jump arc clears about 3.4m, so the last gap is meant to be refused.
    const gaps = [1.5, 2.4, 3.2, 4.5];
    let z = 24;
    gaps.forEach((gap) => {
      this.#box(new THREE.Vector3(5, 2, 3), new THREE.Vector3(16, 1, z), MID);
      z += 3 + gap;
    });
    this.#box(new THREE.Vector3(5, 2, 3), new THREE.Vector3(16, 1, z), MID);

    // --- Pillar forest: camera collision under pressure ---------------------
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 7.5 + (i % 3) * 1.4;
      this.#box(
        new THREE.Vector3(0.65, 5.5, 0.65),
        new THREE.Vector3(Math.cos(a) * r - 8, 2.75, Math.sin(a) * r + 26),
        DARK
      );
    }

    // --- Narrow corridor: capsule radius sanity check ----------------------
    // 0.78m wide against a 0.64m capsule diameter. Passable, but you feel it.
    this.#box(new THREE.Vector3(0.6, 3, 12), new THREE.Vector3(-0.69, 1.5, -30), DARK);
    this.#box(new THREE.Vector3(0.6, 3, 12), new THREE.Vector3(0.69, 1.5, -30), DARK);

    // --- Overhead beam: forces the camera down ------------------------------
    this.#box(new THREE.Vector3(14, 0.5, 2), new THREE.Vector3(0, 2.4, 6), DARK);

    this.#addLights();
    return this;
  }

  /** Grey box lighting: flat and unglamorous on purpose. Phase 7 owns looks. */
  #addLights() {
    const key = new THREE.DirectionalLight(0xdfe6f2, 2.8);
    key.position.set(26, 38, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    const s = 48;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.035;
    this.group.add(key);
    this.group.add(new THREE.HemisphereLight(0x8494a8, 0x22262c, 1.15));

    const grid = new THREE.GridHelper(70, 70, 0x2f343b, 0x1e2228);
    grid.position.y = 0.008;
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    this.group.add(grid);
  }

  /** A static dummy to lock onto and orbit. */
  addDummy(position) {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.36, 1.1, 6, 12),
      this.#mat(0x8d6f62, 0.85)
    );
    mesh.position.copy(position).setY(position.y + 0.91);
    mesh.castShadow = true;
    this.group.add(mesh);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), this.#mat(0x4a4f56));
    post.position.copy(position).setY(position.y + 0.45);
    post.castShadow = true;
    this.group.add(post);

    // A dummy you can walk through is not a dummy you can circle, and circling
    // is the whole point of locking onto one.
    const { collider } = this.physics.addStaticBox(
      new THREE.Vector3(0.72, 1.82, 0.72),
      new THREE.Vector3(position.x, position.y + 0.91, position.z),
      null,
      { group: FILTERS.world }
    );

    // The lock-on target descriptor. `collider` is what lets the line-of-sight
    // test ignore the target's own body when checking whether it can be seen.
    return {
      mesh,
      collider,
      position: mesh.position,
      lockHeight: 0.55,
      alive: true,
      name: 'Training Dummy',
    };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
  }
}
