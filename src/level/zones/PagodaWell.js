import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';
import { WAYPOINTS } from '../waypoints.js';

/**
 * Beat 8 — the Pagoda Well. A sunken candi under an oculus of open sky, and
 * the only daylight in the chapter.
 *
 * Scale is held against the concept board: a 58m shaft with a 26m tower in it,
 * so the player standing at the base reads as a few pixels tall. That ratio is
 * the entire point of the image and it is the one thing here that must not be
 * compromised for convenience — every number below is the number it was.
 *
 * Zone palette: `pagodaWell` in ZONE_PROFILES — warm daylight into cool wet
 * stone.
 *
 * ## What is gone, and what replaced it
 *
 * The raymarched daylight shaft is gone. It was the single most expensive
 * thing in the game: twenty steps of four dependent texture taps each, over a
 * radius-30 by 58m cylinder with `frustumCulled = false` and depth testing
 * disabled — roughly 200 million texture fetches per frame while standing in
 * the well. It was also sampling an occlusion map that had been baked while
 * the entire chapter was hidden by the void sequence, so every one of those
 * taps returned 1.0 and the shaft it was meant to carve never existed.
 *
 * Nothing stands in for it yet. Under cel shading a god ray is a hard-edged
 * shape, not a density integral, so the honest replacement is drawn geometry
 * and it belongs to the art pass rather than to the blockout.
 */
export function build(ctx) {
  ctx.zone('pagodaWell');
  const m = ctx.materials;
  const w = WAYPOINTS.pagodaWell;

  // The well shaft: a tall cylinder, open at the top.
  //
  // CylinderGeometry's side normals point radially outward. scale(-1,1,1)
  // mirrors the geometry so the reversed winding renders from inside the tube,
  // but a mirror leaves the normal pointing outward at a reflected angle,
  // which is what once made this wall render as a black void. Recomputing
  // normals after the mirror rebuilds them from the winding — which a mirror
  // flips — so they come out genuinely inward-facing.
  //
  // This is one of the two surfaces in the chapter that keeps a trimesh
  // collider. The player *flies* up this shaft, so they are in contact with it
  // at arbitrary angles; boxing it into a polygon would put twelve invisible
  // corners in the way of the flight tutorial.
  const shaft = new THREE.CylinderGeometry(30, 24, 58, 20, 1, true);
  shaft.scale(-1, 1, 1);
  shaft.computeVertexNormals();
  const shaftMesh = new THREE.Mesh(shaft, m.pagodaShaft);
  shaftMesh.position.set(w.x, w.y + 27, w.z);
  shaftMesh.receiveShadow = true;
  shaftMesh.castShadow = false;
  shaftMesh.userData.noInk = true; // 20 vertical lines around a shaft is a cage
  ctx.add(shaftMesh);
  ctx.physics.addStaticGeometry(shaft, shaftMesh.matrixWorld.clone().setPosition(shaftMesh.position),
    { group: FILTERS.world });

  // Floor.
  ctx.box(new THREE.Vector3(64, 1, 64), new THREE.Vector3(w.x, w.y - 0.5, w.z), m.pagodaStone);

  // The moat: one of the few chromatic notes in the chapter, per the board.
  // A flat ring, no refraction, no depth murk.
  const moat = new THREE.Mesh(new THREE.RingGeometry(13, 26, 28), m.chamberWater);
  moat.rotation.x = -Math.PI / 2;
  moat.position.set(w.x, w.y + 0.12, w.z);
  moat.userData.noInk = true;
  ctx.add(moat);

  buildTower(ctx, w);
  const skyDisc = buildOculus(ctx, w);
  buildApproach(ctx);

  return { moat, skyDisc, sun: null, oculusY: w.y + 58 };
}

/**
 * The candi: 26m of stacked, battered tiers on a plinth. The lightest solid
 * value in the frame, per the board — pale warm grey-white against the dark
 * olive shaft.
 *
 * Five tiers, each a box narrower and shorter than the one below it, with a
 * cornice lip between them. That batter — the inward lean as it rises — is the
 * silhouette the concept board is actually about, and it survives being made
 * of boxes because it was always a proportion rather than a detail.
 */
function buildTower(ctx, w) {
  const m = ctx.materials;
  const TIERS = 5;
  const BASE_WIDTH = 14;
  const TOTAL_HEIGHT = 26;

  // Plinth and its entrance steps.
  ctx.box(new THREE.Vector3(BASE_WIDTH + 4, 1.5, BASE_WIDTH + 4), new THREE.Vector3(w.x, w.y + 0.75, w.z), m.pagodaStone);
  for (let i = 0; i < 3; i++) {
    ctx.box(
      new THREE.Vector3(6, 0.5, 1.4),
      new THREE.Vector3(w.x, w.y + 0.25 + i * 0.5, w.z + 11.4 - i * 1.4),
      m.pagodaStone
    );
  }

  let y = w.y + 1.5;
  for (let i = 0; i < TIERS; i++) {
    const t = i / TIERS;
    const width = BASE_WIDTH * (1 - t * 0.62);
    const height = (TOTAL_HEIGHT / TIERS) * (1 - t * 0.22);
    ctx.box(new THREE.Vector3(width, height, width), new THREE.Vector3(w.x, y + height / 2, w.z), m.pagodaTower);
    // The cornice: a thin overhanging lip that reads as a shadow line between
    // tiers and is most of what makes stacked boxes read as architecture.
    ctx.box(
      new THREE.Vector3(width + 1.1, 0.5, width + 1.1),
      new THREE.Vector3(w.x, y + height + 0.25, w.z),
      m.pagodaStone
    );
    y += height + 0.5;
  }

  // The bell and finial crowning the tower.
  ctx.box(new THREE.Vector3(3.4, 2.6, 3.4), new THREE.Vector3(w.x, y + 1.3, w.z), m.pagodaTower);
  ctx.box(new THREE.Vector3(1.0, 3.2, 1.0), new THREE.Vector3(w.x, y + 4.2, w.z), m.pagodaStone);

  // Balustrades flanking the entrance steps.
  for (const s of [-1, 1]) {
    ctx.box(
      new THREE.Vector3(0.7, 1.4, 8),
      new THREE.Vector3(w.x + s * 3.4, w.y + 1.4, w.z + 11.0),
      m.pagodaStone,
      { collide: false }
    );
  }
}

/**
 * The oculus, and the sky beyond it.
 *
 * The rim is a ring of chunky blocks rather than a smooth lip: an irregular,
 * foliage-eaten opening, not an engineered porthole. Its mean radius holds the
 * locked value of 21; only the outline stops being a circle.
 */
function buildOculus(ctx, w) {
  const m = ctx.materials;
  const oculusY = w.y + 58;
  const RADIUS = 21;

  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    // Deterministic jitter — a fixed sequence, so the rim is the same shape on
    // every boot and a screenshot means something.
    const jr = RADIUS + Math.sin(i * 2.3) * 1.6;
    const jy = oculusY - 0.4 + Math.sin(i * 1.7) * 0.9;
    ctx.box(
      new THREE.Vector3(4.6, 2.4 + Math.sin(i * 3.1) * 0.8, 3.0),
      new THREE.Vector3(w.x + Math.cos(a) * jr, jy, w.z + Math.sin(a) * jr),
      m.pagodaStone,
      { collide: false, rotation: new THREE.Euler(0, -a, 0) }
    );
  }

  // The sky disc. The only daylight in the chapter, and it must read as
  // genuinely outside — a flat bright value, not a lit surface. Unlit and
  // unfogged, which is exactly what the `sky` palette entry is for.
  const sky = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 28), m.sky);
  sky.rotation.x = Math.PI / 2;
  sky.position.set(w.x, oculusY + 1.5, w.z);
  sky.userData.noInk = true;
  ctx.add(sky);
  return sky;
}

/** The doorway from the Star Chamber, and the corridor that connects them. */
function buildApproach(ctx) {
  const m = ctx.materials;
  const gate = WAYPOINTS.pagodaGate;
  ctx.box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x - 4.5, gate.y + 4, gate.z), m.pagodaStone);
  ctx.box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x + 4.5, gate.y + 4, gate.z), m.pagodaStone);
  ctx.box(new THREE.Vector3(12, 2, 3.0), new THREE.Vector3(gate.x, gate.y + 9.5, gate.z), m.pagodaStone);

  // The corridor: a box passage, where it used to be a swept tube. Six
  // segments from the chamber wall to the well, dropping 1.5m over 20m.
  const SEGMENTS = 6;
  const zA = -96;
  const zB = -116;
  for (let i = 0; i < SEGMENTS; i++) {
    const z0 = zA + (zB - zA) * (i / SEGMENTS);
    const z1 = zA + (zB - zA) * ((i + 1) / SEGMENTS);
    const zm = (z0 + z1) * 0.5;
    const len = Math.abs(z1 - z0) + 0.8;
    const y = THREE.MathUtils.lerp(-21.5, -23.0, (zm - zA) / (zB - zA));
    for (const side of [-1, 1]) {
      ctx.box(new THREE.Vector3(1.2, 8, len), new THREE.Vector3(side * 5.6, y + 3, zm), m.pagodaShaft);
    }
    ctx.box(new THREE.Vector3(12, 1, len), new THREE.Vector3(0, y + 7, zm), m.shell, { castShadow: false });
  }

  // The walkable floor of the corridor, stepping down toward the well.
  for (let i = 0; i < 4; i++) {
    ctx.box(new THREE.Vector3(9, 1, 8), new THREE.Vector3(0, -24.2 - i * 0.28, -100 - i * 7), m.pagodaStone);
  }
}
