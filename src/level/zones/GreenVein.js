import * as THREE from 'three';
import { EVENTS } from '../../core/EventBus.js';
import {
  banyanRoots, rubbleField, speleothems, caveTunnel, waterBody, slopedFloor,
} from '../geometry/builders.js';
import { buildSword } from '../../character/Weapon.js';
import { buildCharacter } from '../../character/Rig.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';
import { createWater } from '../../render/WaterMaterial.js';
import { fbm, materialSet, makeGlow } from '../../render/procedural/textures.js';

/** Floor width and centre offset, shared by the surface and anything on it. */
const FLOOR_WIDTH = (z) => 22 + Math.sin(z * 0.12) * 5;
const FLOOR_OFFSET = (z) => Math.sin(z * 0.09) * 2.2;

/**
 * Beats 3 and 5 — the bioluminescent stretch, and the sword.
 *
 * Near-zero ambient, and the emissive jade water is doing all the lighting —
 * so the readable path IS the lit path, and sightlines are controlled by where
 * the water runs. Zone palette: `greenVein` in ZONE_PROFILES, deep olive and
 * black.
 *
 * Concept board (ConceptArtReferences, the Green Vein cave-mouth painting):
 * one broad, still jade lake, not rectangular ducts — dark desaturated teal
 * body, the glow living at the WATERLINE and in streaky flow through it, warm
 * olive-brown rock rather than neutral black, and a pale distant opening that
 * anchors the far background. buildJadeWaterMaterial and buildDistantOpening
 * below exist because of that board specifically.
 */
export function build(ctx) {
  buildCavern(ctx);
  return buildSwordPickup(ctx);
}

function buildCavern(ctx) {
  const m = ctx.materials;
  // ONE floor function. Everything walkable, every emissive channel and
  // every waypoint in this zone is derived from it, because the first pass
  // authored them independently and they disagreed by nearly two metres —
  // which put the player underneath the water they were meant to walk beside.
  const floorY = GREEN_VEIN_FLOOR;

  // Per-zone deviation from the shared stone table via the library's override
  // path: the concept board's darks are warm olive-brown, not the neutral
  // grey-black `rock`/`bark`/`wetRock` read under this zone's near-zero
  // ambient. Tinting through `ctx.library.get` gives Green Vein its own cached
  // instance without touching the shared materials the other two zones still
  // draw from.
  const warmRock = ctx.library.get('rock', { color: new THREE.Color(0x8d7148) });
  const warmBark = ctx.library.get('bark', { color: new THREE.Color(0xa3835a) });
  const warmFloor = ctx.library.get('wetRock', { color: new THREE.Color(0x7c6a4a) });

  // One ribbon that follows GREEN_VEIN_FLOOR per vertex, replacing the run of
  // 8m boxes that each sampled it once at their own centre. The boxes were a
  // staircase standing in for a slope: they disagreed with the function by up
  // to 0.54m, which is why the water needed a local helper to find the floor
  // that was actually there. Now there is nothing to disagree with, and it is
  // one draw call and one collider instead of eight of each.
  ctx.solid(
    slopedFloor({
      fromZ: 2, toZ: -54,
      floorY, widthAt: FLOOR_WIDTH, offsetAt: FLOOR_OFFSET,
      segments: 56, skirt: 1.8,
    }),
    warmFloor, null, { collide: true }
  );

  // Cavern shell: walls and ceiling only. The floor ribbon above is what the
  // player actually stands on, so the shell is sized to sit outside it.
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
  ctx.solid(shell, warmRock, null, { collide: true });

  buildWater(ctx);
  buildDistantOpening(ctx, floorY);

  // Stalactites and banyan roots breaking through the ceiling — sized up and
  // warm-tinted so they have actual presence instead of registering as thin
  // dark threads with nothing catching them.
  ctx.solid(speleothems({ count: 34, radius: 17, length: 6.4, seed: 23 }), warmRock,
    new THREE.Vector3(0, floorY(-24) + 13, -24), { collide: false });
  for (const z of [-8, -24, -42]) {
    ctx.solid(banyanRoots({ count: 9, height: 8, spread: 3.6, seed: 40 - z }), warmBark,
      new THREE.Vector3(z % 4 === 0 ? 7 : -7, floorY(z) + 11, z), { collide: false });
  }

  // In-water stalagmites: dark silhouettes standing IN the jade lake, per the
  // concept board, catching the rim glow only where their base meets it.
  for (const [x, z] of [[-3.6, -14], [1.4, -33], [0.8, -47]]) {
    ctx.solid(speleothems({ count: 3, radius: 1.1, length: 2.6, up: true, seed: Math.abs(z) + 71 }),
      warmRock, new THREE.Vector3(x, GREEN_VEIN_FLOOR(z) - 0.15, z), { collide: false });
  }

  // A warm kiss of light on walls and roots near the midground. Near-zero
  // ambient stays — this is a handful of very local, short-range points, not a
  // fill — but without it the rock has nothing warm hitting it at all and
  // reads as flat neutral black instead of the board's olive-brown.
  for (const [x, y, z] of [
    [-11, floorY(-12) + 4.5, -13], [10, floorY(-32) + 5, -31], [-11, floorY(-45) + 4.5, -45],
  ]) {
    ctx.light(0x7a5c34, 3.2, 15, new THREE.Vector3(x, y, z), { decay: 1.7, animate: false });
  }
}

/**
 * The jade water: one broad, winding, still body rather than rectangular
 * ducts — this is the zone's only light source, so its shape and the glow
 * material both ARE the level's lighting design.
 */
function buildWater(ctx) {
  const anchors = [
    { x: -7, z: 2, width: 3.4 },
    { x: -4, z: -12, width: 4.6 },
    { x: 5, z: -24, width: 6.2 },
    { x: -3, z: -36, width: 7.8 },
    { x: 0, z: -50, width: 10.2 },
  ];

  // Straight off GREEN_VEIN_FLOOR. The floor is that function now, rather
  // than a staircase approximating it, so there is no longer a second height
  // to reconcile against.
  const geo = waterBody({
    anchors, floorY: GREEN_VEIN_FLOOR, lift: 0.11, dip: 0.055,
    segments: 110, radial: 16, edgeNoise: 0.38, seed: 12,
  });

  const centreline = new THREE.CatmullRomCurve3(
    anchors.map((a) => new THREE.Vector3(a.x, GREEN_VEIN_FLOOR(a.z) + 0.11, a.z))
  );
  const material = buildJadeWaterMaterial(ctx.quality, centreline.getLength());

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  ctx.add(mesh);
  ctx.water(material);
  ctx.emissive(mesh, 0.5);

  // Point lights strung along the water: the ONLY light source in the zone,
  // so their spacing is the level's lighting design and the readable path is
  // literally the lit path. Short-ish range and a steep decay keep the green
  // confined near the water itself — the board's floor away from the bank
  // reads warm and dim, not flooded the same cool green as the lake.
  for (const t of [0.07, 0.24, 0.4, 0.56, 0.72, 0.9]) {
    const p = centreline.getPointAt(t);
    ctx.light(0x2fbe8c, 3.6, 13, p.clone().setY(p.y + 1.1), { decay: 1.9 });
  }
}

/**
 * The jade water's own bespoke material.
 *
 * The board reads as a dark, desaturated body close in value to the
 * surrounding rock, with the glow concentrated at the waterline and in
 * serpentine streaks through it — not a uniformly lit slab. `createWater`
 * supplies real depth-murk, scrolling ripple normals and the per-frame plumbing
 * (`ctx.water` binds scene depth automatically); a second baked texture rides
 * on top as the emissive map and carries the rim + streak structure, keyed off
 * the geometry's own u (0/1 = the two banks, 0.5 = centreline).
 */
function buildJadeWaterMaterial(quality, arcLength) {
  const material = createWater({
    quality,
    shallow: 0x16352c,
    deep: 0x040f0c,
    murkDistance: 1.6,
    minOpacity: 0.55,
    maxOpacity: 0.93,
    roughness: 0.22,
    refract: false,
    scrollSpeed: new THREE.Vector2(0.006, 0.01),
  });

  const size = Math.max(128, quality.textureSize);
  const glow = materialSet('greenvein-jade-glow', size, (u, v) => {
    // Rim: a genuinely THIN bright line at both banks (u near 0 or 1), dark
    // through the rest of the body — the board's glowing waterline, not a
    // wide lit band. Chapter1's breathing pass drives emissiveIntensity
    // between roughly 0.85 and 1.65 on top of this and this zone cannot
    // change that, so the texture itself has to stay conservative or the
    // rim blows out to a flat, shapeless white under bloom.
    const edgeL = Math.pow(Math.max(0, 1 - u * 9), 3);
    const edgeR = Math.pow(Math.max(0, 1 - (1 - u) * 9), 3);
    let rim = Math.max(edgeL, edgeR);
    // Ragged rather than a clean drafted line — painterly, per the board.
    rim *= 0.45 + fbm(u * 30 + 2, v * 6, { octaves: 3, frequency: 8, seed: 201, period: 8 }) * 0.6;
    rim = Math.min(1, rim);

    // Faint serpentine flow streaks stretched along v (the length) — a hint
    // of movement through the dark body, well below the rim's value.
    const streak = fbm(u * 3.1 + 1, v * 0.6, { octaves: 4, frequency: 2.4, seed: 211, period: 9 });
    const streaks = Math.max(0, streak - 0.56) * 0.9 * (1 - rim * 0.85);

    // A body floor: even away from the rim the lake needs to read as a dark
    // teal PRESENCE next to the rock, not drop to the exact same black —
    // without it the water only exists where the rim or a streak happens to
    // land, and vanishes everywhere else.
    const body = 0.16 + fbm(u * 2 + 5, v * 0.8, { octaves: 2, frequency: 2, seed: 231, period: 6 }) * 0.06;
    const h = Math.max(body, Math.min(1, rim * 0.8 + streaks * 0.3));
    // Peaks stay well under 1: the core is near-black jade, and even the
    // brightest rim pixel is a moderate value, not a saturated white.
    const core = [0.02, 0.075, 0.058];
    const bright = [0.28, 0.62, 0.42];
    return {
      h,
      color: [
        core[0] + (bright[0] - core[0]) * h,
        core[1] + (bright[1] - core[1]) * h,
        core[2] + (bright[2] - core[2]) * h,
      ],
      rough: 0.5,
    };
  }, { normalStrength: 0.35, repeat: 1 });

  // U (across the width) must stay unrepeated — the rim gradient is drawn to
  // land exactly on the mesh's own 0/1 banks. V (along the length, in real
  // metres via the geometry's UV) gets scaled down so streaks read as metres-
  // long brush marks instead of a repeat every few centimetres.
  glow.map.repeat.set(1, Math.max(0.06, 7 / Math.max(1, arcLength)));

  material.emissive = new THREE.Color(0xffffff);
  material.emissiveMap = glow.map;
  material.emissiveIntensity = 1.0;

  return material;
}

/**
 * The pale, distant opening the board anchors its background on: the
 * lightest value in the frame, glimpsed past the foreground silhouettes of
 * roots and speleothems. Purely a light and a pair of soft glows — nothing
 * here is collidable or navigable, so it changes what the frame reads as
 * without touching the level's shape.
 */
function buildDistantOpening(ctx, floorY) {
  const at = new THREE.Vector3(-13, floorY(-44) + 13.5, -52);

  // Small and soft — a value anchor glimpsed past the foreground silhouettes,
  // not a second sun. Two thin, low-power sprites rather than one blunt disc,
  // so it stays a soft-edged patch instead of a hard-edged bloom blob.
  const far = makeGlow({ color: 0xcfe6d8, scale: 5.5, opacity: 0.22, power: 2.1 });
  far.position.copy(at);
  ctx.add(far);
  const core = makeGlow({ color: 0xdff2e6, scale: 2.4, opacity: 0.3, power: 2.6 });
  core.position.copy(at).add(new THREE.Vector3(0.5, -0.3, 0.3));
  ctx.add(core);

  ctx.light(0xa8d6c2, 0.9, 16, at.clone(), { decay: 1.8, animate: false });
}

/**
 * Beat 5. Half-buried in mud beside a dead warrior's bones.
 *
 * Deliberately unlit and off the main line: no glow, no marker, no rarity
 * colour. It is a tool someone else was using when they died here. The
 * warrior beside it gets an ordinary warm environmental light so it reads as
 * a body rather than a silhouette with nothing on it — the sword itself stays
 * untouched by that light's intent.
 */
function buildSwordPickup(ctx) {
  const m = ctx.materials;
  const p = WAYPOINTS.sword;
  const g = new THREE.Group();
  g.position.copy(p);

  // The warrior: a collapsed skeleton, not a prop pile.
  const { mesh } = buildCharacter({ material: m.bone });
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

  ctx.solid(rubbleField({ count: 10, radius: 2.2, seed: 55 }), m.wetRock, p.clone(), { collide: false });
  ctx.add(g);
  ctx.light(0x6a5a3c, 1.5, 6.5, p.clone().add(new THREE.Vector3(-0.6, 1.7, 0.2)), { decay: 2, animate: false });

  ctx.pickup({
    id: 'sword',
    position: p.clone().setY(p.y + 0.8),
    radius: 2.4,
    label: 'take the sword',
    onPick: () => {
      g.remove(sword);
      ctx.player.giveWeapon();
      ctx.state.setFlag('hasSword');
      ctx.bus.emit(EVENTS.DIALOGUE_LINE, {
        speaker: '', text: 'Cold steel. Someone else needed it first.', duration: 3.6,
      });
    },
  });

  return { swordMesh: sword, swordGroup: g };
}
