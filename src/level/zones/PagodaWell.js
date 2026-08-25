import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';
import { WAYPOINTS } from '../waypoints.js';

/** The approach corridor's surface where it meets the well floor. */
const CORRIDOR_END_Y = -25.0;
/** ...which is also what the candi's entrance steps climb from. */
const CORRIDOR_AT_PLINTH = CORRIDOR_END_Y;

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
  // ...and it needs a doorway, because the corridor from the Star Chamber
  // arrives straight into it.
  //
  // This was a closed cylinder. Three's CylinderGeometry lays out its vertices
  // as x = r·sin θ, z = r·cos θ, so θ=0 faces +z — which is exactly the
  // direction the approach corridor comes from. At the corridor's height the
  // shaft's interpolated radius is ~24.3m, putting its wall at z ≈ −101.7, and
  // the corridor floor runs from z −96 to −125 straight through it. So the wall
  // stood across the passage and the Pagoda Well — the chapter's last room, its
  // flight tutorial and its only daylight — could not be reached on foot at all.
  //
  // The corridor is 9m wide, which subtends atan(4.5/24.3) ≈ 0.185 rad, so the
  // arc starts just past that and stops just short of coming back. The cost is
  // a full-height slot in a wall the player later flies up; the alternative is
  // a room you cannot enter. Found by `tools/playthrough.mjs`.
  const DOOR = 0.23;
  const shaft = new THREE.CylinderGeometry(30, 24, 58, 20, 1, true, DOOR, Math.PI * 2 - DOOR * 2);
  shaft.scale(-1, 1, 1);
  shaft.computeVertexNormals();
  // `solid()`, not `add()` plus a separate collider call. This is one of the two
  // genuinely curved walkable surfaces the chapter keeps a trimesh for, and
  // saying so through the builder is what keeps the collision audit's
  // `noCollide` bookkeeping true — `add()` marks its subtree as decoration.
  const shaftMesh = ctx.solid(shaft, m.pagodaShaft, new THREE.Vector3(w.x, w.y + 27, w.z), { noInk: true });
  shaftMesh.castShadow = false; // 20 vertical lines around a shaft is a cage

  // Floor — a disc, sized to the shaft rather than to a square.
  //
  // This was a 64×64 box. The shaft's inner radius at floor level is 24.2m, so a
  // ±32m slab left a wide apron of floor OUTSIDE the room with nothing at its
  // edges, and every metre of that apron's perimeter was somewhere to walk off
  // the world. Making the floor round means the shaft wall guards its edge all
  // the way around, which is what a wall around a room is for.
  //
  // A trimesh, like the pool basin: flat, so a triangle mesh is exact here and
  // has none of the seam behaviour that made `ZoneBuilder` prefer boxes.
  const floorDisc = new THREE.CylinderGeometry(25.5, 25.5, 1, 32);
  ctx.solid(floorDisc, m.pagodaStone, new THREE.Vector3(w.x, w.y - 0.5, w.z), { noInk: true });

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
  // Entrance steps, from the corridor up onto the plinth.
  //
  // Two things were wrong here and they compounded. The risers were 0.5m
  // against a 0.42m step offset (TUNING.movement), so the capsule bounced off
  // the temple stairs. And they were laid out as a climb of the plinth's full
  // 1.5m — measured from the well floor — when the surface the player actually
  // arrives on is the approach corridor's floor, which is only ~1.1m below the
  // plinth top. So the top step was buried inside the plinth
  // and the bottom two were under the corridor, leaving the plinth's +z face
  // standing as a 1.04m ledge across the full width of the corridor: the
  // player walked down the passage and stopped dead at z −116.4.
  //
  // The last riser *is* the plinth, so one fewer box than risers, and they step
  // outward from the plinth's face rather than inward from the corridor.
  const PLINTH_TOP = w.y + 1.5;
  const PLINTH_FACE = w.z + (BASE_WIDTH + 4) / 2;
  const CORRIDOR_Y = CORRIDOR_AT_PLINTH;
  // Four risers over the plinth's full 1.5m — 0.375m each, inside the 0.42m
  // step offset. The corridor now arrives at the well floor rather than part
  // way up, so the climb is the whole plinth instead of the 0.76m it was.
  const rise = (PLINTH_TOP - CORRIDOR_Y) / 4;
  for (let i = 0; i < 3; i++) {
    ctx.box(
      new THREE.Vector3(6, 0.5, 1.4),
      new THREE.Vector3(w.x, PLINTH_TOP - rise * (i + 1) - 0.25, PLINTH_FACE + 0.7 + i * 1.4),
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

  // The corridor, as one declaration.
  //
  // It used to be three independent loops: walls whose height came off
  // `lerp(-21.5, -23.0, t)`, a ceiling off the same, and a separate run of
  // floor boxes stepping −23.7 down to −24.82. Those two families of numbers
  // were never reconciled, so the walls floated about 1.2m ABOVE the floor they
  // were guarding for the corridor's whole length — you could walk under the
  // railing and off the side into the shaft. That was 52 of the chapter's
  // remaining unguarded edges, all of them here.
  //
  // `ctx.path` takes the surface once. The walls stand on it because they are
  // built from it, and the ramp arrives at −25.0 exactly, which is the well
  // floor's own height — so the last step into the chapter's final room is not
  // a step at all.
  ctx.path([
    // Starts at z−94, under the Star Chamber's dais rather than 2m short of
    // it, so dropping off the dais lands on this floor instead of past its end.
    new THREE.Vector3(0, -23.7, -94),
    new THREE.Vector3(0, -24.4, -108),
    // Ends at the well floor's own height, and BEFORE the candi's plinth.
    // Running on to z−124 buried the last stretch inside the plinth (z−135 to
    // −117, top −23.5), so the corridor dead-ended in solid rock and the whole
    // chapter behind it came back as unreachable from the exit.
    new THREE.Vector3(0, CORRIDOR_END_Y, -116),
  ], {
    width: 9,
    thickness: 1.2,
    material: m.pagodaStone,
    wallMaterial: m.pagodaShaft,
    wallHeight: 8,
    wallThickness: 1.2,
    ceiling: true,
    ceilingHeight: 7,
    ceilingThickness: 1.0,
    ceilingMaterial: m.shell,
  });
}
