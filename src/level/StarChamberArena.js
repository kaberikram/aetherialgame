import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { FILTERS } from '../physics/PhysicsWorld.js';
import { makeGlow } from '../render/procedural/textures.js';
import { createWater } from '../render/WaterMaterial.js';
import { VolumetricGlow } from '../render/VolumetricShaft.js';
import { votiveStupa } from './geometry/builders.js';

const _v = new THREE.Vector3();

/**
 * A crisp radiating flare for the star, drawn straight into a canvas. The
 * concept board's star is small and reads as intensely bright because of an
 * eight-point burst around a hard little core, not because the room around
 * it is pure black — `makeGlow`'s round halos give it a disc and a soft
 * bloom, but nothing before this gave it the spikes.
 */
function starFlareTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = size / 2;

  const core = g.createRadialGradient(mid, mid, 0, mid, mid, size * 0.17);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);

  g.globalCompositeOperation = 'lighter';
  const spike = (angle, length, width, alpha) => {
    g.save();
    g.translate(mid, mid);
    g.rotate(angle);
    const grad = g.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.28})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -width / 2);
    g.lineTo(length, 0);
    g.lineTo(0, width / 2);
    g.closePath();
    g.fill();
    g.restore();
  };

  const long = size * 0.49;
  const short = size * 0.30;
  for (let i = 0; i < 4; i++) spike((i / 4) * Math.PI * 2, long, size * 0.030, 0.9);
  for (let i = 0; i < 4; i++) spike((i / 4) * Math.PI * 2 + Math.PI / 4, short, size * 0.016, 0.65);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
 */
export class StarChamberArena {
  constructor(engine, { center = new THREE.Vector3(0, 0, 0), radius = 15 } = {}) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.rendererObj = engine.resolve('renderer');
    this.scene = this.rendererObj.scene;
    this.gl = this.rendererObj.renderer;
    this.post = engine.resolve('post');
    this.quality = engine.resolve('quality');
    this.library = engine.resolve('materials');
    this.center = center.clone();
    this.radius = radius;

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.ripples = [];
    this.waterLevel = center.y + 0.0;
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
    // Dark, damp slate for everything the star's light actually lands on
    // close up. The old flat mid-grey rendered near-white once the point
    // light and bloom hit it — a room whose whole palette is desaturated
    // indigo and slate cannot afford a bathroom-tile-bright floor.
    const rim = this.library.get('wetRock');
    const basin = this.library.get('silt');

    // --- the basin floor, matching depthAt() exactly ------------------------
    const segs = 48;
    const floor = new THREE.CircleGeometry(this.radius, segs, 0, Math.PI * 2);
    floor.rotateX(-Math.PI / 2);
    const pos = floor.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.floorHeightAt(x + this.center.x, z + this.center.z) - this.center.y);
    }
    floor.computeVertexNormals();
    const floorMesh = new THREE.Mesh(floor, basin);
    floorMesh.position.copy(this.center);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);
    this.physics.addStaticGeometry(floor, floorMesh.matrix.clone().setPosition(this.center), { group: FILTERS.world });

    // --- the stepped ritual dais rim ---------------------------------------
    // Three concentric steps, matching the concept board's stepped platform.
    for (let i = 0; i < 3; i++) {
      const r = this.radius + 0.5 + i * 1.15;
      const h = 0.34 + i * 0.30;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.5, h, 40, 1, true), rim);
      ring.position.copy(this.center).setY(this.center.y + h / 2 - 0.05 + i * 0.30);
      ring.receiveShadow = true;
      ring.castShadow = true;
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

    // --- votive stupas ringing the dais, SEA vocabulary even in grey box ---
    // Corner markers, not balustrade posts: a box with a cone on it reads as
    // a placeholder no matter how it is lit. These are unlit decoration only
    // (no collider, same as the geometry they replace).
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = this.radius + 2.4;
      const stupa = votiveStupa({ height: 1.7, baseWidth: 0.56, seed: i + 1 });
      const mesh = new THREE.Mesh(stupa, rim);
      mesh.position.set(
        this.center.x + Math.cos(a) * r,
        this.center.y + 0.2,
        this.center.z + Math.sin(a) * r
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    this.#buildWater();
    this.#buildStar();
    return this;
  }

  /**
   * The pool. PROJECT.md: "the pool is a character" — real depth-based murk,
   * driven by the actual scene depth under the surface, so the shallow rim
   * and the deep centre read differently before the player has taken a
   * single step into either. And true refraction via transmission: this is
   * the one surface in the chapter that earns the cost.
   *
   * The concept board is explicit that this water is almost dead flat —
   * "unnaturally still" is the design note, and a bright mirror specular
   * reads as the opposite of that. Roughness goes well past createWater's
   * default and the ripple normal maps get scaled down hard, so the surface
   * stays glassy-murky rather than shiny. The vertex displacement (ripples
   * from a boss breach) is independent of the material — geometry carries
   * the disturbance, the shader carries the depth and the colour.
   */
  #buildWater() {
    const geo = new THREE.CircleGeometry(this.radius + 1.2, 64);
    geo.rotateX(-Math.PI / 2);
    this.waterGeometry = geo;
    this.waterBase = Float32Array.from(geo.attributes.position.array);

    const mat = createWater({
      quality: this.quality,
      shallow: 0x33505e,
      deep: 0x05080e,
      murkDistance: 1.05,
      minOpacity: 0.50,
      maxOpacity: 0.97,
      roughness: 0.55,
      refract: true,
      scrollSpeed: new THREE.Vector2(0.003, 0.005),
    });
    // Kill the shine: real refraction stays, the mirror highlight does not.
    mat.normalScale?.set(0.14, 0.14);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.center).setY(this.waterLevel);
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this.water = mesh;
  }

  /**
   * One suspended star. It is the only light source the chamber has, and it
   * drives three things every frame in `update()`: its own PointLight, the
   * raymarched in-scattering around it, and a dim shadowless fill standing in
   * for the bounce off the far cave wall the concept board paints pale.
   */
  #buildStar() {
    const g = new THREE.Group();
    g.position.copy(this.center).setY(this.center.y + 9.5);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    g.add(core);

    const haloSmall = makeGlow({ color: 0xdfe8ff, scale: 2.2, opacity: 0.95, power: 2.2 });
    g.add(haloSmall);
    const haloBig = makeGlow({ color: 0x9db4e0, scale: 8.0, opacity: 0.34, power: 3.2 });
    g.add(haloBig);

    // The eight-point burst the concept board draws around the star.
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: starFlareTexture(256),
      color: 0xeaf1ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    }));
    flare.scale.setScalar(7.5);
    g.add(flare);

    const light = new THREE.PointLight(0xdce8ff, 46, 42, 1.7);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 45;
    light.shadow.bias = -0.002;
    g.add(light);

    this.scene.add(g);
    this.starGroup = g;
    this.star = light;
    this.starCore = core;
    this.starHaloSmall = haloSmall;
    this.starHaloBig = haloBig;
    this.starFlare = flare;
    this.baseStarIntensity = light.intensity;
    this.starBase = light.intensity;

    // Raymarched in-scattering. PROJECT.md rules out billboard fakes for this
    // room, and `VolumetricGlow` existed but was never wired in here. No
    // shadow sampling: the star hangs in open air with nothing between it and
    // the player, so marching a shadow cube would cost a lot to prove there
    // is nothing in the way.
    this.starGlow = new VolumetricGlow({
      center: g.position.clone(),
      radius: 2.1,
      steps: this.quality.volumetricSteps,
      density: 0.42,
      intensity: 1.1,
      color: 0xd7e3ff,
    });
    this.scene.add(this.starGlow.mesh);
    this.starGlowBaseIntensity = this.starGlow.uniforms.intensity.value;
    this.starGlowBaseDensity = this.starGlow.uniforms.density.value;

    // A dim, shadowless fill aimed at the far cave wall. Not a second key —
    // it stands in for the baked bounce PROJECT.md's tech stack calls for
    // (real-time GI is out of budget). The star's own hard falloff genuinely
    // does not reach 25-30m back to the wall, and the concept board is
    // unambiguous that the wall is one of the palest values in the frame.
    // Tied to the star below so the wing choice still moves this, rather
    // than leaving one part of the room as a fixed stage light.
    this.wallFill = new THREE.PointLight(0x8ea3c6, 3.2, 50, 1.3);
    this.wallFill.position.set(this.center.x, this.center.y + 13, this.center.z - 24);
    this.scene.add(this.wallFill);
    this.wallFillBase = this.wallFill.intensity;
  }

  /** Displacement written by the boss breaching. */
  burst(position, strength = 1) {
    this.ripples.push({
      x: position.x - this.center.x,
      z: position.z - this.center.z,
      t: 0,
      strength,
    });
    this.bus.emit(EVENTS.SFX, { id: 'waterBurst', position });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  update(dt) {
    const t = performance.now() * 0.001;
    const pos = this.waterGeometry.attributes.position;
    const base = this.waterBase;

    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 3.2);

    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      // Two crossed swells give a surface that moves without reading as a
      // regular grid, which a single sine always does.
      let y = Math.sin(x * 0.42 + t * 0.75) * 0.030
        + Math.sin(z * 0.31 - t * 0.55) * 0.026
        + Math.sin((x + z) * 0.19 + t * 1.15) * 0.014;

      for (const r of this.ripples) {
        const d = Math.hypot(x - r.x, z - r.z);
        const front = r.t * 7.5;
        const band = Math.abs(d - front);
        if (band < 3.2) {
          const falloff = (1 - band / 3.2) * Math.max(0, 1 - r.t / 3.2) * r.strength;
          y += Math.sin((d - front) * 2.1) * falloff * 0.55;
        }
      }
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.waterGeometry.computeVertexNormals();

    // Star flicker: two slow beats, never random. Random reads as a fault.
    if (this.starCore) {
      const f = 1 + Math.sin(t * 0.9) * 0.05 + Math.sin(t * 2.3) * 0.03;
      // The wing choice retargets the star's actual output, which moves every
      // shadow in the chamber. That is what makes it a different room rather
      // than the same room with a tint.
      const target = this.star.userData.reactTarget ?? this.baseStarIntensity;
      this.starBase = THREE.MathUtils.damp(this.starBase ?? this.baseStarIntensity, target, 0.9, dt);
      this.star.intensity = this.starBase * f;
      const ratio = this.starBase / this.baseStarIntensity;

      // The star's VISIBLE size and brightness track the reaction nearly
      // proportionally, not with a large constant floor.
      //
      // These used to read `0.6 + ratio * 0.5` and friends, which meant that
      // when dark wings dropped the light to a quarter of base, the star on
      // screen only shrank by a third and kept most of its flare. The light in
      // the room changed; the thing the player is looking at did not. "The
      // chamber darkens and the star dims" is one sentence in PROJECT.md, and
      // half of it was not happening.
      this.starCore.scale.setScalar(f * (0.18 + ratio * 0.92));

      // Distance fade. The flare sprite is fog-exempt and unattenuated, so
      // from the Green Vein — fifty metres and two beats away, through the
      // corridor — it was out-shining that zone's own near-zero-ambient
      // identity before the player had ever seen the pool.
      const dist = this.starGroup.getWorldPosition(_v).distanceTo(this.rendererObj.camera.position);
      const near = 1 - THREE.MathUtils.smoothstep(dist, 42, 70);

      const glowScale = (0.10 + ratio * 0.95) * near;
      this.starHaloSmall.material.opacity = 0.95 * glowScale * f;
      this.starHaloBig.material.opacity = 0.34 * glowScale * f;
      this.starFlare.material.opacity = Math.min(1, 0.9 * glowScale) * f;
      this.starFlare.scale.setScalar(7.5 * (0.35 + ratio * 0.68));
      this.starFlare.material.rotation += dt * 0.045;

      // The in-scattering and the far-wall fill both ride the same ratio, so
      // dark does not just dim the point light — the air stops glowing and
      // the wall the light was bouncing off goes with it. Same room, two
      // different rooms.
      if (this.starGlow) {
        this.starGlow.uniforms.intensity.value = this.starGlowBaseIntensity * ratio;
        this.starGlow.uniforms.density.value = this.starGlowBaseDensity * (0.35 + ratio * 0.65);
      }
      if (this.wallFill) this.wallFill.intensity = this.wallFillBase * (0.3 + ratio * 0.7);
    }

    // Volumetric in-scattering and the water's scroll/depth both want the
    // active camera and, when the post chain is running, the scene depth.
    // The arena is built outside ZoneBuilder, so unlike the other zones it
    // has to fetch those itself instead of Chapter1 handing them in.
    const camera = this.rendererObj.camera;
    const depth = this.post?.depthTexture ?? null;
    this.starGlow?.update(dt, camera, depth);
    this.water.material.userData.water.update(dt, camera, this.gl, depth);
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
    if (this.starGlow) {
      this.scene.remove(this.starGlow.mesh);
      this.starGlow.dispose();
    }
    if (this.wallFill) this.scene.remove(this.wallFill);
  }
}
