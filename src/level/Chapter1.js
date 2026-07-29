import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { ACTION } from '../input/Actions.js';
import { FILTERS } from '../physics/PhysicsWorld.js';
import { makeGlow } from '../render/procedural/textures.js';
import {
  caveTunnel, candiTower, kalaFace, nagaBalustrade,
  banyanRoots, ruinedWall, rubbleField, speleothems,
} from './geometry/builders.js';
import { buildSword } from '../character/Weapon.js';
import { buildCharacter } from '../character/Rig.js';

const _v = new THREE.Vector3();

/**
 * The Green Vein's floor height as a function of depth along the chapter's
 * axis. Exported so the waypoints, the checkpoints and the level geometry
 * cannot disagree about where the ground is.
 */
export const GREEN_VEIN_FLOOR = (z) => -14 - ((2 - z) / 56) * 7.6;

/**
 * Chapter 1, blocked out.
 *
 * The whole path in one descending line, because the chapter's shape is a
 * descent: the player starts at the top and every zone is lower than the last
 * until the oculus, which is the only thing above them and the only daylight.
 *
 *   EMBODIMENT   y   0   z  +34   the ledge the body wakes on
 *   DESCENT      y −14   z  +4    sloping tunnel, traversal taught by geometry
 *   GREEN VEIN   y −19   z −34    the bioluminescent stretch, and the sword
 *   STAR CHAMBER y −23   z −78    the flooded dais
 *   PAGODA WELL  y −25   z −126   the sunken candi under open sky
 *
 * Scale is held against the concept board: the candi is 26m tall and the well
 * chamber is 58m from floor to oculus, so a 1.68m player reads as a few pixels
 * against it — the ratio the board sets.
 */
export const WAYPOINTS = {
  embodiment: new THREE.Vector3(0, 0.1, 34),
  descentTop: new THREE.Vector3(0, 0, 26),
  descentBottom: new THREE.Vector3(0, -14, 4),
  greenVein: new THREE.Vector3(0, GREEN_VEIN_FLOOR(-20), -20),
  sword: new THREE.Vector3(7.5, GREEN_VEIN_FLOOR(-30), -30),
  poolApproach: new THREE.Vector3(0, GREEN_VEIN_FLOOR(-54) - 0.4, -55),
  starChamber: new THREE.Vector3(0, -23, -78),
  pagodaGate: new THREE.Vector3(0, -24, -101),
  pagodaWell: new THREE.Vector3(0, -25, -126),
  /** Standing spot at the base of the candi — the tower occupies the centre. */
  pagodaFloor: new THREE.Vector3(17, -25, -126),
};

export class Chapter1 {
  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.scene = engine.resolve('renderer').scene;
    this.player = engine.resolve('player');
    this.input = engine.resolve('input');
    this.state = engine.resolve('state');

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.lights = [];
    this.emissives = [];
    this.pickups = [];
    this.nearestPickup = null;

    this.materials = {
      rock: new THREE.MeshStandardMaterial({ color: 0x3f443f, roughness: 0.97, metalness: 0 }),
      wetRock: new THREE.MeshStandardMaterial({ color: 0x33393f, roughness: 0.62, metalness: 0.05 }),
      laterite: new THREE.MeshStandardMaterial({ color: 0x6a5f55, roughness: 0.95, metalness: 0 }),
      candi: new THREE.MeshStandardMaterial({ color: 0x8a8579, roughness: 0.88, metalness: 0 }),
      moss: new THREE.MeshStandardMaterial({ color: 0x35462c, roughness: 0.98, metalness: 0 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.93, metalness: 0 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xada396, roughness: 0.86, metalness: 0 }),
      // Emissive, but not blown out. The rubric asks whether a frame reads in
      // grayscale, and a channel pinned at full white does not — it becomes a
      // flat shape with no internal value. Kept dark enough that the highlight
      // lives in the specular and the bloom, not in the albedo.
      jade: new THREE.MeshStandardMaterial({
        color: 0x06251c, emissive: 0x1f9c72, emissiveIntensity: 0.72,
        roughness: 0.14, metalness: 0.25, transparent: true, opacity: 0.94,
      }),
    };
  }

  /** Mesh + trimesh collider in one call. Static level geometry only. */
  #solid(geometry, material, position, { collide = true, rotation = null, group = FILTERS.world } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    this.group.add(mesh);
    if (collide) this.physics.addStaticGeometry(geometry, mesh.matrixWorld.clone(), { group });
    return mesh;
  }

  #box(size, position, material, opts = {}) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(position);
    if (opts.rotation) mesh.rotation.copy(opts.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (opts.collide !== false) {
      this.physics.addStaticBox(size, position,
        opts.rotation ? new THREE.Quaternion().setFromEuler(opts.rotation) : null,
        { group: opts.group ?? FILTERS.world });
    }
    return mesh;
  }

  #light(color, intensity, distance, position, { decay = 1.8, shadow = false } = {}) {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.position.copy(position);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(512, 512);
      l.shadow.camera.far = distance;
      l.shadow.bias = -0.004;
    }
    this.group.add(l);
    this.lights.push(l);
    return l;
  }

  build() {
    this.#buildEmbodimentLedge();
    this.#buildDescent();
    this.#buildGreenVein();
    this.#buildPoolApproach();
    this.#buildPagodaWell();
    return this;
  }

  // ------------------------------------------------------ beat 2/3: waking

  /**
   * The ledge the body wakes on. Small, enclosed, one exit — the first thing
   * the player sees after the void has to be legible in a single glance, and
   * the only direction they can go is the one the chapter needs them to.
   */
  #buildEmbodimentLedge() {
    const p = WAYPOINTS.embodiment;
    this.#box(new THREE.Vector3(16, 1, 16), new THREE.Vector3(p.x, p.y - 0.5, p.z), this.materials.rock);

    // Enclosing walls with a single gap toward the descent.
    for (const [dx, dz, w, d] of [[0, 8.5, 16, 1.5], [-8.5, 0, 1.5, 18], [8.5, 0, 1.5, 18]]) {
      this.#box(new THREE.Vector3(w, 7, d), new THREE.Vector3(p.x + dx, p.y + 3.5, p.z + dz), this.materials.rock);
    }
    // The exit wall has a doorway-sized gap, with a kala face over it.
    this.#box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x - 5.4, p.y + 3.5, p.z - 8.5), this.materials.rock);
    this.#box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x + 5.4, p.y + 3.5, p.z - 8.5), this.materials.rock);
    this.#box(new THREE.Vector3(16, 3.2, 1.5), new THREE.Vector3(p.x, p.y + 5.4, p.z - 8.5), this.materials.rock);

    const kala = kalaFace({ width: 3.0, height: 2.1 });
    this.#solid(kala, this.materials.laterite,
      new THREE.Vector3(p.x, p.y + 4.3, p.z - 7.7), { collide: false });

    this.#solid(rubbleField({ count: 18, radius: 6, seed: 21 }), this.materials.rock,
      new THREE.Vector3(p.x, p.y, p.z + 1), { collide: false });

    // A ceiling, so the void's absence of one is something the player felt.
    this.#box(new THREE.Vector3(16, 1, 18), new THREE.Vector3(p.x, p.y + 7.5, p.z), this.materials.rock);
  }

  // ------------------------------------------------------ beat 3: the descent

  /**
   * The traversal tutorial, built entirely into geometry. In order, and with
   * no prompts anywhere: a ramp you cannot fail, a step-down that teaches
   * landing, a gap narrow enough that walking off it is survivable, then one
   * that is not, and a ledge drop that requires the jump.
   */
  #buildDescent() {
    const a = WAYPOINTS.descentTop;
    const b = WAYPOINTS.descentBottom;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x, a.y + 3, a.z),
      new THREE.Vector3(a.x - 3, a.y - 2.5, a.z - 7),
      new THREE.Vector3(a.x + 2, a.y - 7, a.z - 14),
      new THREE.Vector3(b.x - 1, b.y + 2.4, b.z + 5),
      new THREE.Vector3(b.x, b.y + 2.6, b.z),
    ]);
    const tunnel = caveTunnel(curve, (t) => 4.6 + Math.sin(t * 5) * 0.7, {
      segments: 80, radial: 14, roughness: 0.34, seed: 3,
    });
    this.#solid(tunnel, this.materials.rock, null, { collide: true });

    // Walkable ledges stepping down through the tunnel. Deliberately generous:
    // this is where the player is still learning what the body can do.
    const steps = [
      { p: new THREE.Vector3(a.x - 1.5, a.y - 1.2, a.z - 5), s: new THREE.Vector3(6, 0.6, 6) },
      { p: new THREE.Vector3(a.x - 3.2, a.y - 3.4, a.z - 10), s: new THREE.Vector3(6, 0.6, 6) },
      { p: new THREE.Vector3(a.x - 0.5, a.y - 6.0, a.z - 15), s: new THREE.Vector3(7, 0.6, 6) },
      { p: new THREE.Vector3(a.x + 2.0, a.y - 8.4, a.z - 19), s: new THREE.Vector3(6, 0.6, 5) },
      // A 2.6m gap: clears with the jump, refuses a walk.
      { p: new THREE.Vector3(a.x + 1.0, a.y - 10.6, a.z - 25.6), s: new THREE.Vector3(6, 0.6, 5) },
      { p: new THREE.Vector3(b.x, b.y + 0.4, b.z + 4), s: new THREE.Vector3(9, 0.8, 7) },
    ];
    for (const st of steps) this.#box(st.s, st.p, this.materials.rock);

    // Bones and an abandoned camp: someone came down here before you.
    this.#buildCamp(new THREE.Vector3(a.x - 3.2, a.y - 3.0, a.z - 10));

    // Carvings the player cannot read yet — a band of relief along the wall.
    for (let i = 0; i < 5; i++) {
      const t = 0.2 + i * 0.15;
      const pt = curve.getPointAt(t);
      const panel = ruinedWall({ length: 3.2, height: 1.8, blockH: 0.42, seed: 30 + i });
      this.#solid(panel, this.materials.laterite,
        new THREE.Vector3(pt.x + 3.4, pt.y - 1.2, pt.z), { collide: false });
    }

    this.#light(0x6b7f92, 3.2, 16, new THREE.Vector3(a.x, a.y + 1, a.z - 4));
    this.#light(0x5a6d80, 2.4, 14, new THREE.Vector3(a.x, a.y - 7, a.z - 16));
  }

  #buildCamp(at) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 5, 10), this.materials.rock);
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(at).setY(at.y + 0.4);
    this.group.add(ring);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 4), this.materials.bark);
      stick.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3));
      stick.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      this.group.add(stick);
    }
    // A skull and a ribcage, small and easy to miss.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.materials.bone);
    skull.position.copy(at).add(new THREE.Vector3(1.6, 0.5, 0.7));
    skull.castShadow = true;
    this.group.add(skull);
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 4, 8, Math.PI), this.materials.bone);
      rib.position.copy(at).add(new THREE.Vector3(1.9 + i * 0.16, 0.42, 0.65));
      rib.rotation.set(Math.PI / 2, 0.2, 0.1 * i);
      this.group.add(rib);
    }
  }

  // -------------------------------------------------- beat 3/5: green vein

  /**
   * The Green Vein. Near-zero ambient, and the emissive jade water is doing
   * all the lighting — so the readable path IS the lit path, and sightlines
   * are controlled by where the water runs.
   */
  #buildGreenVein() {
    // ONE floor function. Everything walkable, every emissive channel and
    // every waypoint in this zone is derived from it, because the first pass
    // authored them independently and they disagreed by nearly two metres —
    // which put the player underneath the water they were meant to walk beside.
    const floorY = GREEN_VEIN_FLOOR;

    const segStep = 8;
    for (let z = 2; z >= -54; z -= segStep) {
      const y = floorY(z - segStep / 2);
      const width = 22 + Math.sin(z * 0.12) * 5;
      this.#box(
        new THREE.Vector3(width, 1.2, segStep + 0.4),
        new THREE.Vector3(Math.sin(z * 0.09) * 2.2, y - 0.6, z - segStep / 2),
        this.materials.wetRock
      );
    }

    // Cavern shell: walls and ceiling only. The floor boxes above are what the
    // player actually stands on, so the shell is sized to sit outside them.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, floorY(4) + 7, 4),
      new THREE.Vector3(2, floorY(-10) + 7.5, -10),
      new THREE.Vector3(0, floorY(-22) + 8, -22),
      new THREE.Vector3(-2, floorY(-34) + 8, -34),
      new THREE.Vector3(0, floorY(-46) + 7.5, -46),
      new THREE.Vector3(0, floorY(-56) + 7, -56),
    ]);
    const shell = caveTunnel(curve, (t) => 15 - t * 2.5, {
      segments: 70, radial: 16, roughness: 0.4, floorFlatten: 0.52, seed: 9,
    });
    this.#solid(shell, this.materials.rock, null, { collide: true });

    // The jade water: emissive channels winding along the floor. These are the
    // ONLY light sources here, so their layout is the level's lighting design
    // and the readable path is literally the lit path.
    const channelPath = [
      { z: 2, x: -7 }, { z: -12, x: -4 }, { z: -24, x: 5 },
      { z: -36, x: -3 }, { z: -50, x: 0 },
    ];
    for (let i = 0; i < channelPath.length - 1; i++) {
      const a = channelPath[i];
      const b = channelPath[i + 1];
      const from = new THREE.Vector3(a.x, floorY(a.z) + 0.07, a.z);
      const to = new THREE.Vector3(b.x, floorY(b.z) + 0.07, b.z);
      const dir = _v.copy(to).sub(from);
      const len = dir.length();
      const mid = from.clone().addScaledVector(dir, 0.5);

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + i * 0.45, len), this.materials.jade.clone());
      plane.rotation.x = -Math.PI / 2;
      plane.rotation.z = -Math.atan2(dir.x, dir.z);
      plane.position.copy(mid);
      this.group.add(plane);
      this.emissives.push({ __phase: i * 1.3, mesh: plane });

      // Dim, green, slow decay. Long falloff so the dark between channels
      // stays genuinely dark rather than washing to a uniform mid-tone.
      for (const t of [0.25, 0.75]) {
        this.#light(0x2fbe8c, 5.6, 26, from.clone().lerp(to, t).setY(from.y + 1.4), { decay: 1.5 });
      }
    }

    // Stalactites and banyan roots breaking through the ceiling.
    this.#solid(speleothems({ count: 30, radius: 17, length: 5, seed: 23 }), this.materials.rock,
      new THREE.Vector3(0, floorY(-24) + 13, -24), { collide: false });
    for (const z of [-8, -24, -42]) {
      this.#solid(banyanRoots({ count: 8, height: 7, spread: 3.2, seed: 40 - z }), this.materials.bark,
        new THREE.Vector3(z % 4 === 0 ? 7 : -7, floorY(z) + 11, z), { collide: false });
    }

    this.#buildSwordPickup();
  }

  /**
   * Beat 5. Half-buried in mud beside a dead warrior's bones.
   *
   * Deliberately unlit and off the main line: no glow, no marker, no rarity
   * colour. It is a tool someone else was using when they died here.
   */
  #buildSwordPickup() {
    const p = WAYPOINTS.sword;
    const g = new THREE.Group();
    g.position.copy(p);

    // The warrior: a collapsed skeleton, not a prop pile.
    const { mesh } = buildCharacter({ material: this.materials.bone });
    mesh.scale.setScalar(0.97);
    const body = new THREE.Group();
    body.add(mesh);
    body.rotation.set(-Math.PI * 0.46, 0.7, 0.2);
    body.position.set(-0.9, 0.05, 0.3);
    g.add(body);

    const sword = buildSword();
    sword.rotation.set(-Math.PI * 0.42, 0.5, 0.25);
    sword.position.set(0, 0.9, 0);
    g.add(sword);
    this.swordMesh = sword;

    this.#solid(rubbleField({ count: 10, radius: 2.2, seed: 55 }), this.materials.wetRock,
      p.clone(), { collide: false });

    this.group.add(g);
    this.swordGroup = g;

    this.pickups.push({
      id: 'sword',
      position: p.clone().setY(p.y + 0.8),
      radius: 2.4,
      label: 'take the sword',
      onPick: () => {
        g.remove(sword);
        this.player.giveWeapon();
        this.state.setFlag('hasSword');
        this.bus.emit(EVENTS.DIALOGUE_LINE, {
          speaker: '', text: 'Cold steel. Someone else needed it first.', duration: 3.6,
        });
      },
    });
  }

  // ---------------------------------------------- beat 4: the pool approach

  /**
   * The walk to the water's edge, before the fight. PHASES.md is specific that
   * the player must be able to get close enough to be scared, so the approach
   * is a long open descent with the chamber visible the whole way down and
   * nothing to do but look at it.
   */
  #buildPoolApproach() {
    const a = WAYPOINTS.poolApproach;

    const top = GREEN_VEIN_FLOOR(-54);
    const drop = (top - (WAYPOINTS.starChamber.y + 0.2)) / 6;
    for (let i = 0; i < 7; i++) {
      this.#box(
        new THREE.Vector3(15 - i * 0.5, 1.0, 4.2),
        new THREE.Vector3(0, top - drop * i - 0.5, -54 - i * 3.4),
        this.materials.candi
      );
    }

    // Naga balustrades flanking the descent — the stair guardians.
    for (const s of [-1, 1]) {
      const naga = nagaBalustrade({ length: 22, height: 1.2, drop: 2.4 });
      this.#solid(naga, this.materials.laterite,
        new THREE.Vector3(s * 6.6, -21.2, -63), { collide: false });
    }

    // A ruined gateway framing the first view of the chamber.
    this.#box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(-6.5, -19, -56), this.materials.laterite);
    this.#box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(6.5, -19, -56), this.materials.laterite);
    this.#box(new THREE.Vector3(15, 1.6, 2.2), new THREE.Vector3(0, -15.6, -56), this.materials.laterite);
    const kala = kalaFace({ width: 3.6, height: 2.6 });
    this.#solid(kala, this.materials.laterite, new THREE.Vector3(0, -16.2, -54.7), { collide: false });

    // The chamber shell around the arena.
    const dome = new THREE.SphereGeometry(34, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
    dome.scale(1, 0.78, 1);
    const domeMesh = new THREE.Mesh(dome, this.materials.rock);
    domeMesh.material = this.materials.rock;
    domeMesh.geometry.scale(-1, 1, 1); // inward-facing
    domeMesh.position.set(0, -23, -78);
    domeMesh.receiveShadow = true;
    this.group.add(domeMesh);

    this.#solid(speleothems({ count: 34, radius: 26, length: 7, seed: 61 }), this.materials.rock,
      new THREE.Vector3(0, -6, -78), { collide: false });
  }

  // ---------------------------------------------------- beat 8: pagoda well

  /**
   * The Pagoda Well. A sunken candi under an oculus of open sky, and the only
   * daylight in the chapter.
   *
   * Scale is held against the concept board: a 58m shaft with a 26m tower in
   * it, so the player standing at the base reads as a few pixels tall. That
   * ratio is the entire point of the image and it is the one thing here that
   * must not be compromised for convenience.
   */
  #buildPagodaWell() {
    const w = WAYPOINTS.pagodaWell;

    // The well shaft: a tall cylinder, open at the top.
    const shaft = new THREE.CylinderGeometry(30, 24, 58, 32, 1, true);
    shaft.scale(-1, 1, 1);
    const shaftMesh = new THREE.Mesh(shaft, this.materials.wetRock);
    shaftMesh.position.set(w.x, w.y + 27, w.z);
    shaftMesh.receiveShadow = true;
    this.group.add(shaftMesh);
    this.physics.addStaticGeometry(shaft, shaftMesh.matrixWorld.clone().setPosition(shaftMesh.position),
      { group: FILTERS.world });

    // Floor and the shallow moat the board shows around the plinth.
    this.#box(new THREE.Vector3(64, 1, 64), new THREE.Vector3(w.x, w.y - 0.5, w.z), this.materials.wetRock);

    const moat = new THREE.Mesh(
      new THREE.RingGeometry(13, 26, 40),
      new THREE.MeshStandardMaterial({ color: 0x1c3442, roughness: 0.14, metalness: 0.4, transparent: true, opacity: 0.88 })
    );
    moat.rotation.x = -Math.PI / 2;
    moat.position.set(w.x, w.y + 0.12, w.z);
    this.group.add(moat);
    this.moat = moat;

    // The candi.
    const tower = candiTower({ tiers: 5, baseWidth: 14, totalHeight: 26, seed: 3 });
    this.#solid(tower, this.materials.candi, new THREE.Vector3(w.x, w.y, w.z), { collide: true });

    // Vegetation breaking the masonry, per the board.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 7 + (i % 2) * 2.5;
      this.#solid(banyanRoots({ count: 5, height: 5, spread: 2.2, seed: 70 + i }), this.materials.bark,
        new THREE.Vector3(w.x + Math.cos(a) * r, w.y + 6 + (i % 3) * 3.5, w.z + Math.sin(a) * r),
        { collide: false });
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + (i % 3) * 0.5, 0), this.materials.moss);
      bush.position.set(w.x + Math.cos(a) * r * 0.9, w.y + 8 + (i % 3) * 4, w.z + Math.sin(a) * r * 0.9);
      bush.castShadow = true;
      this.group.add(bush);
    }

    // The oculus: a ring of vegetation around a hole to the sky.
    const oculusY = w.y + 58;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(21, 3.2, 8, 32), this.materials.moss);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(w.x, oculusY, w.z);
    this.group.add(lip);

    // The sky disc. The only daylight in the chapter, and it must read as
    // genuinely outside — a flat bright value, not a lit surface.
    const sky = new THREE.Mesh(
      new THREE.CircleGeometry(21, 40),
      new THREE.MeshBasicMaterial({ color: 0x9dc0e8, fog: false, side: THREE.DoubleSide })
    );
    sky.rotation.x = Math.PI / 2;
    sky.position.set(w.x, oculusY + 1.5, w.z);
    this.group.add(sky);
    this.skyDisc = sky;

    // The daylight shaft itself: a directional key from above, plus a wide
    // cone of visible light. Volumetrics replace the cone in Phase 7.
    const sun = new THREE.DirectionalLight(0xfff0d8, 4.6);
    // Angled to rake the face the player arrives facing. A shaft that lights
    // the far side leaves the tower a flat silhouette from the only approach.
    sun.position.set(w.x + 13, oculusY, w.z + 19);
    sun.target.position.set(w.x, w.y, w.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;

    const shaftCone = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 26, 58, 28, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xcfe0f5, transparent: true, opacity: 0.055,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      })
    );
    shaftCone.position.set(w.x, w.y + 29, w.z);
    this.group.add(shaftCone);

    // The doorway from the Star Chamber.
    const gate = WAYPOINTS.pagodaGate;
    this.#box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x - 4.5, gate.y + 4, gate.z), this.materials.laterite);
    this.#box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x + 4.5, gate.y + 4, gate.z), this.materials.laterite);
    this.#box(new THREE.Vector3(12, 2, 3.0), new THREE.Vector3(gate.x, gate.y + 9.5, gate.z), this.materials.laterite);
    this.#solid(kalaFace({ width: 4.2, height: 3.0 }), this.materials.laterite,
      new THREE.Vector3(gate.x, gate.y + 8.2, gate.z + 1.8), { collide: false });

    // The corridor connecting chamber to well.
    const corridor = caveTunnel(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -21.5, -96),
        new THREE.Vector3(0, -22.2, -106),
        new THREE.Vector3(0, -23.0, -116),
      ]),
      () => 5.0,
      { segments: 30, radial: 12, roughness: 0.24, seed: 12 }
    );
    this.#solid(corridor, this.materials.wetRock, null, { collide: true });
    // The corridor is the transition from the chamber's one white point to the
    // well's daylight, so it is lit from both ends and dark in the middle.
    this.#light(0xbfd0e8, 4.0, 22, new THREE.Vector3(0, -21.0, -98), { decay: 1.6 });
    this.#light(0xffe9c8, 6.0, 30, new THREE.Vector3(0, -22.4, -118), { decay: 1.5 });
    for (let i = 0; i < 4; i++) {
      this.#box(new THREE.Vector3(9, 1, 8), new THREE.Vector3(0, -24.2 - i * 0.28, -100 - i * 7), this.materials.wetRock);
    }
  }

  // --------------------------------------------------------------- runtime

  fixedUpdate(dt) {
    this.#updatePickups();
  }

  #updatePickups() {
    let found = null;
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (this.player.position.distanceTo(p.position) < p.radius) { found = p; break; }
    }
    if (found !== this.nearestPickup) {
      this.nearestPickup = found;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, found ? { id: found.id, label: found.label } : null);
    }
    if (found && this.input.actions[ACTION.INTERACT].pressed && this.player.canAct()) {
      found.taken = true;
      this.nearestPickup = null;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
      this.bus.emit(EVENTS.SFX, { id: 'pickup', position: found.position });
      found.onPick();
    }
  }

  update(dt) {
    // The jade water breathes. Two out-of-phase sines per channel so the whole
    // cavern does not pulse as one organism.
    const t = performance.now() * 0.001;
    for (const e of this.emissives) {
      if (!e.__phase && e.__phase !== 0) continue;
      const f = 1.25 + Math.sin(t * 0.62 + e.__phase) * 0.28 + Math.sin(t * 1.37 + e.__phase * 2) * 0.12;
      e.mesh.material.emissiveIntensity = f;
    }
    for (const [i, l] of this.lights.entries()) {
      if (l.color.g > 0.7 && l.color.r < 0.4) {
        l.intensity = 5.6 * (1 + Math.sin(t * 0.7 + i) * 0.16);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
