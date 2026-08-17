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
    /** Fight-time containment ring; see setContained(). */
    this.containment = [];
    this.contained = false;
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
    //
    // Three concentric steps, matching the concept board's stepped platform.
    //
    // ## The pit that was here
    //
    // These were three open-ended `CylinderGeometry` tubes with no colliders:
    // risers with no treads, drawn and not solid. The basin is a disc of radius
    // `this.radius` and the containment ring stands at `radius + 3.4`, so the
    // annulus between them had no floor in it at all — 21 of 24 directions
    // sampled around the arena came back with nothing under them. You could walk
    // off the edge of the boss arena, through the dais you can plainly see, and
    // fall out of the chapter. `tools/playthrough.mjs` found it by doing exactly
    // that: the bot drifted out on attack root motion and the run ended at
    // y −1020.
    //
    // ## Why the steps are boxes and the mesh is built from them
    //
    // The first fix drew each tread as a flat `RingGeometry` annulus over a ring
    // of box colliders. That leaves the collider and the visual as two different
    // shapes — a chord approximating an arc, against a true arc — and they
    // cannot agree at a band boundary no matter how the chords are sized,
    // because a chord's inner edge bows away from the centre between its ends.
    // The collision audit found the seam, and widening the boxes to cover the
    // sagitta simply moved it.
    //
    // So the dais follows the rule `ZoneBuilder` states for the rest of the
    // chapter: one transform produces both. Each step is a ring of boxes, every
    // box is registered as a collider AND appended to one merged buffer, and the
    // mesh is therefore the exact union of the colliders. Ninety-six boxes, one
    // draw call, and nothing left to diverge.
    const STEPS = 3;
    const ARC = 32;
    const daisPos = [];
    const daisNrm = [];
    const _m4 = new THREE.Matrix4();
    const _nm3 = new THREE.Matrix3();
    const _one = new THREE.Vector3(1, 1, 1);
    const _t = new THREE.Vector3();

    // `at`, not `pos` — `pos` is the basin's position attribute above.
    const addStepBox = (size, at, quat) => {
      this.physics.addStaticBox(size, at, quat, { group: FILTERS.world });
      const g = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
      _m4.compose(at, quat, _one);
      _nm3.getNormalMatrix(_m4);
      const pa = g.getAttribute('position');
      const na = g.getAttribute('normal');
      for (let i = 0; i < pa.count; i++) {
        _t.fromBufferAttribute(pa, i).applyMatrix4(_m4);
        daisPos.push(_t.x, _t.y, _t.z);
        _t.fromBufferAttribute(na, i).applyNormalMatrix(_nm3).normalize();
        daisNrm.push(_t.x, _t.y, _t.z);
      }
      g.dispose();
    };

    for (let i = 0; i < STEPS; i++) {
      // Bands overlap by 0.5m so no boundary is a butt joint. The innermost
      // starts at `radius` rather than beyond it, so it meets the basin instead
      // of leaving a slot at the waterline.
      const inner = this.radius + i * 1.15;
      const outer = inner + 1.65;
      const top = this.center.y + (0.34 + i * 0.30) - 0.05 + i * 0.30;
      const rm = (inner + outer) * 0.5;
      // 1.12 overlap tangentially, or the ring leaks between segments.
      const arcLen = ((Math.PI * 2 * rm) / ARC) * 1.12;
      for (let k = 0; k < ARC; k++) {
        const a = (k / ARC) * Math.PI * 2;
        addStepBox(
          new THREE.Vector3(arcLen, 0.9, outer - inner),
          new THREE.Vector3(
            this.center.x + Math.cos(a) * rm,
            top - 0.45,
            this.center.z + Math.sin(a) * rm
          ),
          // A Y-rotation of −(π/2 + a) puts the box's local +X along the tangent
          // and its +Z along the radius, so `size` reads (along the ring, up,
          // across the ring) — check it at a=0, where local +X must land on +Z:
          // cos(−π/2)=0, −sin(−π/2)=1. ✓
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -(Math.PI / 2 + a), 0))
        );
      }
    }

    const daisGeo = new THREE.BufferGeometry();
    daisGeo.setAttribute('position', new THREE.Float32BufferAttribute(daisPos, 3));
    daisGeo.setAttribute('normal', new THREE.Float32BufferAttribute(daisNrm, 3));
    const dais = new THREE.Mesh(daisGeo, m.chamberStep);
    dais.receiveShadow = true;
    dais.castShadow = true;
    // No ink: 96 boxes of EdgesGeometry around a ring reads as a wire cage.
    dais.userData.noInk = true;
    this.group.add(dais);

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

    this.setContained(true);


    this.#buildWater();
    this.#buildStar();

    // Say which of these surfaces are decoration.
    //
    // The basin and the dais are the meshes in the arena with colliders under
    // them — the stupas, the water plane and the star are drawn and never
    // collided with, and the containment ring is the reverse, colliders with no
    // meshes at all. `ZoneBuilder` marks this for everything it builds, but the
    // arena is assembled straight onto the scene, so it has to say so itself.
    //
    // Without it the collision audit compares the basin collider against the
    // water surface floating 6cm above it and reports the whole pool as drift.
    this.group.traverse((o) => { o.userData.noCollide = true; });
    this.floorMesh = floorMesh;
    this.walkable = [floorMesh, dais];
    for (const o of this.walkable) o.userData.noCollide = false;

    return this;
  }

  /**
   * The ring that keeps the fight in the room — and lets the player leave it.
   *
   * ## Two bugs lived here
   *
   * **The axes were swapped.** `size` was `(3.2, 8, 1.0)`, read as "3.2 along
   * the ring, 1.0 through it". It is not: a Y-rotation of −a sends local +X to
   * (cos a, 0, sin a) — the RADIAL direction, the one `position` is built from —
   * and local +Z to the tangent. So this was forty spokes 3.2m deep and 1m wide
   * rather than forty wall panels, and it failed both ways at once. It did not
   * contain: arc spacing here is 2π·18.4/40 = 2.89m, so 1m panels left 1.9m
   * gaps and the player could walk out between them and off the edge of the
   * chapter. And it blocked the way IN: the spoke at a = π/2 reached from
   * z −61.2 to −58.0 across x ≈ 0, exactly where the approach steps arrive,
   * which with the capsule's 0.32m radius is a hard stop at z −57.68. An
   * invisible wall on the critical path, in front of the fog gate, with the
   * boss engaged on the far side of it.
   *
   * **It was permanent.** Closing the circle correctly only replaced one wall
   * with a better-built one, because the fog gate stands at `radius + 2.6` —
   * INSIDE this ring — so the approach has to cross it, and after the fight the
   * player has to cross back to reach the Pagoda Well. The leak was doing that
   * job by accident. So the ring is a *fight* fixture: it goes up with the
   * room and comes down when the boss dies, which is what a Souls arena does
   * anyway. The doorway on the +z side covers the approach, and the gate's own
   * barrier fills it from the moment the room is entered until the boss is dead.
   *
   * Both found by `tools/playthrough.mjs`, which walked into the first from six
   * start points and stopped at −57.7 every time, then got sealed in by the
   * second.
   */
  setContained(on) {
    if (on === this.contained) return;
    this.contained = on;
    if (!on) {
      for (const body of this.containment ?? []) this.physics.removeBody(body);
      this.containment = [];
      return;
    }

    const COUNT = 40;
    const r = this.radius + 3.4;
    const step = (Math.PI * 2) / COUNT;
    // A little over the arc spacing, so neighbours overlap instead of meeting.
    const panel = r * step * 1.15;
    // The approach bears +z from the centre; the doorway is one panel either
    // side of it, which is ~5.8m of gap against the gate's 5.0m width.
    const door = Math.atan2(1, 0);
    this.containment = [];
    for (let i = 0; i < COUNT; i++) {
      const a = i * step;
      let d = Math.abs(a - door);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < step * 1.5) continue;
      const { body } = this.physics.addStaticBox(
        new THREE.Vector3(1.0, 8, panel),
        new THREE.Vector3(
          this.center.x + Math.cos(a) * r,
          this.center.y + 4,
          this.center.z + Math.sin(a) * r
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        // Explicitly NOT a camera blocker: the camera has to be able to sit
        // outside the ring while framing a fight inside it.
        { group: FILTERS.containment }
      );
      this.containment.push(body);
    }
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
