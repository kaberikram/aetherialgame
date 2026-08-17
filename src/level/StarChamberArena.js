import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { FILTERS } from '../physics/PhysicsWorld.js';
import { buildPalette } from './palette.js';

/**
 * The flooded dais.
 *
 * The arena IS a mechanic. Depth rises from the rim toward the centre, and
 * depth costs movement speed and dodge distance (TUNING.water). So the player
 * has a standing decision the whole fight: the shallow ring at the edge is
 * safe and slow to attack from, the deep centre reaches the boss but strips
 * your ability to get out of the way.
 *
 * That is the "safety versus reach" trade PHASES.md asks for, and it is
 * expressed entirely in geometry — there is no UI for it and no tutorial.
 *
 * ## What survived the blockout, and why
 *
 * `depthAt`, `floorHeightAt`, `contains`, `clamp` and `applyWaterTo` are
 * untouched. They are not decoration — `applyWaterTo` writes `entity.
 * waterDepth`, which the player controller reads to scale speed and dodge
 * distance. Replacing the basin with a flat disc would have silently deleted
 * the fight's core trade-off while leaving every file that mentions it intact.
 * So the basin floor is still generated *from* `floorHeightAt` and still
 * collides as a trimesh: it is the second of the two genuinely curved walkable
 * surfaces in the chapter.
 *
 * What went: the transmissive water (a whole extra scene pass), the raymarched
 * star in-scattering, the shadow-casting point light (six scene passes), the
 * far-wall fill light, the sprite flare, and the per-frame vertex rewrite that
 * re-uploaded the pool's VBO and recomputed its normals **every frame from
 * every zone in the chapter**, including while the player was a hundred metres
 * away in the Descent.
 */
export class StarChamberArena {
  constructor(engine, { center = new THREE.Vector3(0, 0, 0), radius = 15 } = {}) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.rendererObj = engine.resolve('renderer');
    this.scene = this.rendererObj.scene;
    this.quality = engine.resolve('quality');
    this.materials = buildPalette();
    this.center = center.clone();
    this.radius = radius;

    this.group = new THREE.Group();
    this.group.name = 'arena';
    this.scene.add(this.group);
    this.waterLevel = center.y + 0.0;

    /** Set true while the player is in the chamber; gates the per-frame work. */
    this.active = false;
  }

  /**
   * Depth profile. Flat shallow shelf out to 62% of the radius, then a bowl
   * down to the deep centre. Deliberately a plateau rather than a cone, so
   * "am I in the deep part" is a binary the player can feel rather than a
   * gradient they have to estimate.
   */
  depthAt(x, z) {
    const d = Math.hypot(x - this.center.x, z - this.center.z);
    const t = 1 - THREE.MathUtils.clamp(d / (this.radius * 0.62), 0, 1);
    const eased = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(0.06, TUNING.water.deepDepth * 1.12, eased);
  }

  floorHeightAt(x, z) {
    return this.waterLevel - this.depthAt(x, z);
  }

  contains(p, margin = 0) {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) <= this.radius - margin;
  }

  clamp(p, margin = 0) {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const d = Math.hypot(dx, dz);
    const limit = this.radius - margin;
    if (d <= limit) return p;
    p.x = this.center.x + (dx / d) * limit;
    p.z = this.center.z + (dz / d) * limit;
    return p;
  }

  build() {
    const m = this.materials;

    // --- the basin floor, matching depthAt() exactly ------------------------
    // Kept as a displaced disc with a trimesh collider. Boxing this would put
    // steps in a surface whose whole job is to be a continuous depth gradient.
    // 24 segments rather than 48: the shape is a smooth bowl, and cel shading
    // bands it either way.
    const segs = 24;
    const floor = new THREE.CircleGeometry(this.radius, segs, 0, Math.PI * 2);
    floor.rotateX(-Math.PI / 2);
    const pos = floor.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.floorHeightAt(x + this.center.x, z + this.center.z) - this.center.y);
    }
    floor.computeVertexNormals();
    const floorMesh = new THREE.Mesh(floor, m.chamberBasin);
    floorMesh.position.copy(this.center);
    floorMesh.receiveShadow = true;
    floorMesh.userData.noInk = true;
    this.group.add(floorMesh);
    this.physics.addStaticGeometry(floor, floorMesh.matrix.clone().setPosition(this.center), { group: FILTERS.world });

    // --- the stepped ritual dais rim ---------------------------------------
    // Three concentric steps, matching the concept board's stepped platform.
    for (let i = 0; i < 3; i++) {
      const r = this.radius + 0.5 + i * 1.15;
      const h = 0.34 + i * 0.30;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.5, h, 28, 1, true), m.chamberStep);
      ring.position.copy(this.center).setY(this.center.y + h / 2 - 0.05 + i * 0.30);
      ring.receiveShadow = true;
      ring.castShadow = true;
      ring.userData.noInk = true;
      this.group.add(ring);
    }

    // Invisible containment. Explicitly NOT a camera blocker: the camera has
    // to be able to sit outside the ring while framing a fight inside it.
    const wallCount = 40;
    for (let i = 0; i < wallCount; i++) {
      const a = (i / wallCount) * Math.PI * 2;
      const r = this.radius + 3.4;
      this.physics.addStaticBox(
        new THREE.Vector3(3.2, 8, 1.0),
        new THREE.Vector3(this.center.x + Math.cos(a) * r, this.center.y + 4, this.center.z + Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        { group: FILTERS.containment }
      );
    }

    // --- votive stupas ringing the dais ------------------------------------
    // Corner markers. Stacked boxes rather than a merged profile — the read is
    // "a tapering vertical marker", and three boxes give that.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = this.radius + 2.4;
      const at = new THREE.Vector3(
        this.center.x + Math.cos(a) * r,
        this.center.y + 0.2,
        this.center.z + Math.sin(a) * r
      );
      for (const [w, h, dy] of [[0.56, 0.5, 0.25], [0.42, 0.7, 0.85], [0.2, 0.6, 1.5]]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m.chamberStep);
        mesh.position.copy(at).setY(at.y + dy);
        mesh.castShadow = true;
        this.group.add(mesh);
      }
    }

    this.#buildWater();
    this.#buildStar();

    // Say which of these surfaces are decoration.
    //
    // The basin is the only mesh in the arena with a collider under it — the
    // dais rings, the stupas, the water plane and the star are drawn and never
    // collided with, and the containment ring is the reverse, colliders with no
    // meshes at all. `ZoneBuilder` marks this for everything it builds, but the
    // arena is assembled straight onto the scene, so it has to say so itself.
    //
    // Without it the collision audit compares the basin collider against the
    // water surface floating 6cm above it and reports the whole pool as drift.
    this.group.traverse((o) => { o.userData.noCollide = true; });
    this.floorMesh = floorMesh;
    floorMesh.userData.noCollide = false;

    return this;
  }

  /**
   * The pool. "Unnaturally still" is the design note, so a flat plane at the
   * water line is not a compromise here — it is the direction.
   *
   * The displacement pass that used to write 66 vertices, recompute normals
   * and re-upload the buffer every frame is gone. `burst()` still exists so the
   * boss encounter's calls are not broken, and it now shows the disturbance by
   * pulsing the surface rather than deforming it. Real displacement comes back
   * with the real boss.
   */
  #buildWater() {
    const geo = new THREE.CircleGeometry(this.radius + 1.2, 32);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.materials.chamberWater);
    mesh.position.copy(this.center).setY(this.waterLevel);
    mesh.receiveShadow = false;
    mesh.userData.noInk = true;
    this.group.add(mesh);
    this.water = mesh;
    this.burstPulse = 0;
  }

  /**
   * One suspended star. It still drives the room's reaction to the wing
   * choice, but as a light and a core rather than as a light, a shadow cube,
   * two halo sprites, an eight-point flare and a raymarched glow volume.
   */
  #buildStar() {
    const g = new THREE.Group();
    g.position.copy(this.center).setY(this.center.y + 9.5);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), this.materials.star);
    core.userData.noInk = true;
    g.add(core);

    // No shadows. A shadow-casting point light is six full scene renders per
    // frame, and it was six of the ten this chapter used to pay for. The one
    // key light in ZoneManager casts; nothing else in the game does.
    const light = new THREE.PointLight(0xdce8ff, 46, 42, 1.7);
    g.add(light);

    this.scene.add(g);
    this.starGroup = g;
    this.star = light;
    this.starCore = core;
    this.baseStarIntensity = light.intensity;
    this.starBase = light.intensity;
  }

  /** Displacement written by the boss breaching. */
  burst(position, strength = 1) {
    this.burstPulse = Math.min(1.4, this.burstPulse + strength);
    this.bus.emit(EVENTS.SFX, { id: 'waterBurst', position });
  }

  update(dt) {
    // Everything below is chamber-local. It used to run from every zone in the
    // chapter, including while the player was a hundred metres away.
    if (!this.active && this.burstPulse <= 0) return;

    const t = performance.now() * 0.001;

    if (this.burstPulse > 0) {
      this.burstPulse = Math.max(0, this.burstPulse - dt * 0.7);
      this.water.material.opacity = 0.78 + this.burstPulse * 0.15;
    }

    // Star flicker: two slow beats, never random. Random reads as a fault.
    if (this.starCore) {
      const f = 1 + Math.sin(t * 0.9) * 0.05 + Math.sin(t * 2.3) * 0.03;
      // The wing choice retargets the star's actual output, which moves the
      // whole room's illumination. That is what makes it a different room
      // rather than the same room with a tint.
      const target = this.star.userData.reactTarget ?? this.baseStarIntensity;
      this.starBase = THREE.MathUtils.damp(this.starBase ?? this.baseStarIntensity, target, 0.9, dt);
      this.star.intensity = this.starBase * f;
      const ratio = this.starBase / this.baseStarIntensity;
      // The star's visible size tracks the reaction nearly proportionally. A
      // large constant floor here was how "the chamber darkens and the star
      // dims" ended up only half happening.
      this.starCore.scale.setScalar(f * (0.18 + ratio * 0.92));
    }
  }

  /** Called by the player each step so movement can read the depth. */
  applyWaterTo(entity) {
    if (!this.contains(entity.position, -2)) {
      entity.waterDepth = 0;
      return;
    }
    const surface = this.waterLevel;
    const feet = entity.position.y;
    entity.waterDepth = Math.max(0, Math.min(surface - feet, this.depthAt(entity.position.x, entity.position.z)));
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.starGroup);
  }
}
