import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';
import {
  caveTunnel, candiTower, kalaFace, banyanRoots, nagaBalustrade, mossClump, oculusRim,
} from '../geometry/builders.js';
import { VolumetricShaft } from '../../render/VolumetricShaft.js';
import { createWater } from '../../render/WaterMaterial.js';
import { fbm, materialSet } from '../../render/procedural/textures.js';
import { WAYPOINTS } from '../waypoints.js';

/**
 * A pale gradient with a faint hint of drifting cloud, for the sky disc. A
 * flat MeshBasicMaterial colour reads as a hole cut in a poster at full
 * resolution — this keeps the value flat and bright (still "outside", not a
 * lit surface) while giving it just enough internal structure to survive a
 * close look. Canvas-drawn like every other texture in the project; no
 * binary asset.
 */
function skyTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx2d = c.getContext('2d');
  const img = ctx2d.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const d = Math.min(1, Math.hypot(dx, dy));
      // Cool pale blue at the rim, warming slightly toward the side the sun
      // rakes from — a hint of the world above, not a lit dome.
      const cloud = fbm(u * 3.2, v * 3.2, { octaves: 4, frequency: 2, seed: 201, period: 4 });
      const warm = Math.max(0, (dx * 0.7 + dy * 0.5)) * 0.5;
      const base = 0.90 - d * 0.05 + (cloud - 0.5) * 0.05;
      const r = base + warm * 0.09;
      const g = base + warm * 0.05;
      const b = base + 0.045 - warm * 0.03;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(Math.min(1, r) * 255);
      img.data[i + 1] = Math.round(Math.min(1, g) * 255);
      img.data[i + 2] = Math.round(Math.min(1, b) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx2d.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Beat 8 — the Pagoda Well. A sunken candi under an oculus of open sky, and
 * the only daylight in the chapter.
 *
 * Scale is held against the concept board: a 58m shaft with a 26m tower in it,
 * so the player standing at the base reads as a few pixels tall. That ratio is
 * the entire point of the image and it is the one thing here that must not be
 * compromised for convenience.
 *
 * Zone palette: `pagodaWell` in ZONE_PROFILES — warm daylight into cool wet
 * stone.
 */
export function build(ctx) {
  const m = ctx.materials;
  const w = WAYPOINTS.pagodaWell;

  // The well shaft: a tall cylinder, open at the top.
  //
  // CylinderGeometry's side normals point radially OUTWARD (away from the
  // axis, into the rock). scale(-1,1,1) mirrors the geometry so the reversed
  // winding renders from inside the tube — the trick that avoids touching
  // the shared wetRock material's `side` — but a mirror transforms normals
  // through the same diagonal matrix as position, so the outward-pointing
  // normal survives the mirror unchanged in character: still outward, now at
  // the reflected angle. That leaves every interior light (the sun, the fill
  // lights below, the hemisphere ambient's vertical component) looking at the
  // wall from the wrong side of its own normal, which is the actual reason
  // the shaft read as a pure black void rather than lit wet stone.
  // computeVertexNormals() after the mirror rebuilds the normal from the
  // (already-mirrored) positions using the face winding, which — because a
  // mirror flips handedness — comes out genuinely inward-facing this time.
  // 48 radial segments, not the original 32: now that the wall is correctly
  // lit (see below), a coarser cylinder shows its facets as broken-up
  // specular highlights rather than a curved wall. More segments costs
  // nothing (still one draw call; a few thousand extra triangles against a
  // quarter-million-triangle scene) and the height, radii and floor plan are
  // unchanged.
  const shaft = new THREE.CylinderGeometry(30, 24, 58, 48, 1, true);
  shaft.scale(-1, 1, 1);
  shaft.computeVertexNormals();
  // A bespoke material using the cylinder's OWN cylindrical UVs, not
  // ctx.library's shared world-space projection. That projection picks
  // between world X and world Z per fragment by whichever the surface
  // normal is more aligned with — fine for the boxy architecture it was
  // built for, but the shaft is a full circle the player sees from every
  // angle, and the projection's own seam (where |Nx|≈|Nz|, i.e. every
  // diagonal azimuth) lands squarely on screen here instead of "almost
  // never," showing up as a hard, moiré-like diamond pattern at ~45°/135°/
  // 225°/315°. The cylinder's native UV wraps once around with no such seam,
  // so building this one surface with materialSet() directly and letting it
  // use the mesh's real UVs sidesteps the bug entirely rather than fighting it.
  const shaftSize = Math.max(128, ctx.quality.textureSize);
  const shaftMaps = materialSet('pagodaShaftWall', shaftSize, (u, v) => {
    const base = fbm(u, v, { octaves: 5, frequency: 4, seed: 7, period: 4 });
    const wet = fbm(u, v, { octaves: 3, frequency: 9, seed: 19, period: 9 });
    const h = base * 0.8 + wet * 0.2;
    const damp = Math.pow(1 - h, 2.2);
    const lo = [0.137, 0.169, 0.118]; // 0x232b1e
    const hi = [0.318, 0.373, 0.235]; // 0x515f3c
    const value = 0.82 + h * 0.42;
    return {
      h,
      color: [lo[0] + (hi[0] - lo[0]) * h, lo[1] + (hi[1] - lo[1]) * h, lo[2] + (hi[2] - lo[2]) * h]
        .map((c) => c * value),
      // Capped well short of the shared wetRock's glossiest damp patches —
      // this wall carries several fill lights across a 48-sided cylinder,
      // and a tight specular there reads as faceted rather than wet.
      rough: THREE.MathUtils.lerp(0.92, 0.62, damp),
    };
  }, { normalStrength: 1.3, repeat: 1 });
  // Cylindrical UV: u wraps the full circumference once, v spans the height
  // once. Scale the repeat to real-world texel density by hand, the way
  // metresPerTile does for the shared table's world-space projection.
  const shaftCircumference = Math.PI * (30 + 24);
  const shaftRepeat = new THREE.Vector2(Math.max(1, Math.round(shaftCircumference / 3)), Math.max(1, Math.round(58 / 3)));
  for (const t of [shaftMaps.map, shaftMaps.normalMap, shaftMaps.roughnessMap]) t.repeat.copy(shaftRepeat);
  const shaftMat = new THREE.MeshStandardMaterial({ ...shaftMaps, metalness: 0.05 });
  const shaftMesh = new THREE.Mesh(shaft, shaftMat);
  shaftMesh.position.set(w.x, w.y + 27, w.z);
  shaftMesh.receiveShadow = true;
  ctx.add(shaftMesh);
  ctx.physics.addStaticGeometry(shaft, shaftMesh.matrixWorld.clone().setPosition(shaftMesh.position),
    { group: FILTERS.world });

  // Floor and the shallow moat the board shows around the plinth.
  ctx.box(new THREE.Vector3(64, 1, 64), new THREE.Vector3(w.x, w.y - 0.5, w.z), m.wetRock);

  // A notably saturated blue ring — one of the few chromatic notes in the
  // chapter, per the board. Desaturated navy reads as just another dark pool.
  const moat = new THREE.Mesh(
    new THREE.RingGeometry(13, 26, 40),
    ctx.water(createWater({
      quality: ctx.quality,
      shallow: 0x1c8fc4,
      deep: 0x0a3e5c,
      murkDistance: 1.4,
      minOpacity: 0.34,
      maxOpacity: 0.90,
      roughness: 0.07,
    }))
  );
  moat.rotation.x = -Math.PI / 2;
  moat.position.set(w.x, w.y + 0.12, w.z);
  ctx.add(moat);

  // The candi: the lightest solid value in the frame, per the board — a pale
  // warm grey-white against the dark olive shaft, not the mid-brown ashlar
  // `candi` reads as elsewhere. A warm tint plus a small warm emissive lift
  // (the underlying map can only be darkened by a multiply, never brightened
  // past it) is what actually raises the value; the per-block masonry
  // variation the rubric praised survives untouched underneath it.
  const towerMat = ctx.library.get('candi', {
    color: new THREE.Color(0xefe6cf),
    roughness: 0.68,
    emissive: new THREE.Color(0x2e2716),
    emissiveIntensity: 0.4,
  });
  const tower = candiTower({ tiers: 5, baseWidth: 14, totalHeight: 26, seed: 3 });
  ctx.solid(tower, towerMat, new THREE.Vector3(w.x, w.y, w.z), { collide: true });

  // Guardian stonework flanking the entrance steps and set into the tiers —
  // this is the most architectural room in the chapter and, before this pass,
  // carried the least SEA stonework of the three zones.
  //
  // The plinth's front steps (above) run from the plinth top (y=1.5, z~10.9)
  // down to the ground at the plinth's outer edge (z~15). nagaBalustrade
  // descends from `height` at its near end (small z) to `height - drop` at
  // its far end (large z, where the reared head sits) — the same direction,
  // so no mirroring is needed to run one down each side of the stair.
  const balustradeMat = ctx.library.get('candi', { color: new THREE.Color(0xd8cdb2) });
  for (const s of [-1, 1]) {
    ctx.solid(nagaBalustrade({ length: 8, height: 1.4, drop: 1.5 }), balustradeMat,
      new THREE.Vector3(w.x + s * 2.6, w.y, w.z + 11.0),
      { collide: false });
  }
  // A threshold guardian over the entrance, set against tier 0's front face.
  ctx.solid(kalaFace({ width: 5.0, height: 3.4 }), m.laterite,
    new THREE.Vector3(w.x, w.y + 3.2, w.z + 6.7), { collide: false });

  // Vegetation breaking the masonry, per the board: clumped rounded mounds in
  // two hues, not single faceted shards, denser than a token scattering.
  const mossA = ctx.library.get('moss', { color: new THREE.Color(0xc7d47a) }); // yellow-green
  const mossB = m.moss; // mid-green, the shared default
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2) * 0.18;
    const r = 6.4 + (i % 3) * 2.1;
    ctx.solid(banyanRoots({ count: 6, height: 5.5 + (i % 3), spread: 2.4, seed: 70 + i }), m.bark,
      new THREE.Vector3(w.x + Math.cos(a) * r, w.y + 5 + (i % 4) * 3.2, w.z + Math.sin(a) * r),
      { collide: false });
    const clump = mossClump({
      count: 7 + (i % 3),
      radius: 1.1 + (i % 3) * 0.35,
      spread: 1.3,
      seed: 200 + i,
    });
    ctx.solid(clump, i % 2 === 0 ? mossA : mossB,
      new THREE.Vector3(w.x + Math.cos(a) * r * 0.92, w.y + 7 + (i % 4) * 3.6, w.z + Math.sin(a) * r * 0.92),
      { collide: false });
  }
  // A pooling mass at the base, where the board shows growth thickest.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    ctx.solid(mossClump({ count: 8, radius: 1.6, spread: 1.7, seed: 240 + i }),
      i % 2 === 0 ? mossB : mossA,
      new THREE.Vector3(w.x + Math.cos(a) * 9.5, w.y + 1.1, w.z + Math.sin(a) * 9.5),
      { collide: false });
  }

  // The oculus: an irregular, foliage-eaten opening, not an engineered
  // porthole. The rim's mean radius holds the locked oculus radius; only its
  // outline stops being a circle.
  const oculusY = w.y + 58;
  const rimRock = ctx.library.get('rock', { color: new THREE.Color(0x3a4530) });
  const lip = new THREE.Mesh(oculusRim({ radius: 21, thickness: 3.4, segments: 26, jaggedness: 0.32, droop: 2.4, seed: 15 }), rimRock);
  lip.position.set(w.x, oculusY, w.z);
  lip.castShadow = true;
  lip.receiveShadow = true;
  ctx.add(lip);
  // Foliage clumps and hanging roots overhanging the rim, breaking its
  // silhouette against the bright disc — the highest-value single change to
  // this shot, per the board.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const r = 20.5 + (i % 3) * 1.4;
    ctx.solid(mossClump({ count: 6, radius: 1.3 + (i % 2) * 0.5, spread: 1.4, seed: 300 + i }),
      i % 2 === 0 ? mossA : mossB,
      new THREE.Vector3(w.x + Math.cos(a) * r, oculusY - 0.6 + (i % 3) * 0.6, w.z + Math.sin(a) * r),
      { collide: false });
    if (i % 3 === 0) {
      ctx.solid(banyanRoots({ count: 4, height: 6.5, spread: 1.6, seed: 320 + i }), m.bark,
        new THREE.Vector3(w.x + Math.cos(a) * r * 0.94, oculusY - 1.2, w.z + Math.sin(a) * r * 0.94),
        { collide: false });
    }
  }

  // The sky disc. The only daylight in the chapter, and it must read as
  // genuinely outside — a flat bright value, not a lit surface — but with
  // enough internal structure not to read as a hole cut in a poster.
  const sky = new THREE.Mesh(
    new THREE.CircleGeometry(21, 40),
    new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false, side: THREE.DoubleSide })
  );
  sky.rotation.x = Math.PI / 2;
  sky.position.set(w.x, oculusY + 1.5, w.z);
  ctx.add(sky);

  // Soft bounce fill up the shaft: the board's wall is dark olive-green with
  // real atmospheric depth, not black, and the whole room should feel lit
  // from above rather than carved out around one hard beam. Unshadowed and
  // cheap — these exist to put SOME light on the now-correctly-facing
  // interior wall and the tower's shadowed faces, not to act as key lights.
  const fillHeights = [6, 16, 26, 38, 50];
  for (let i = 0; i < fillHeights.length; i++) {
    const t = i / (fillHeights.length - 1);
    const rad = THREE.MathUtils.lerp(24, 29, t);
    const a = (i * 2.4) + 0.6;
    ctx.light(
      i % 2 === 0 ? 0xdfe6c2 : 0xffe6bd,
      3.4,
      26,
      new THREE.Vector3(w.x + Math.cos(a) * rad * 0.55, w.y + fillHeights[i], w.z + Math.sin(a) * rad * 0.55),
      { decay: 1.7, animate: false }
    );
  }

  // The daylight shaft itself: a directional key from above, plus a wide
  // cone of visible light. Volumetrics replace the cone in Phase 7.
  const sun = new THREE.DirectionalLight(0xfff0d8, 6.2);
  // Angled to rake the face the player arrives facing. A shaft that lights
  // the far side leaves the tower a flat silhouette from the only approach.
  sun.position.set(w.x + 13, oculusY, w.z + 19);
  sun.target.position.set(w.x, w.y, w.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(ctx.quality.shadowMap, ctx.quality.shadowMap);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  ctx.add(sun);
  ctx.add(sun.target);

  // The daylight shaft, raymarched, sampling the sun's own shadow map — so
  // the candi tower carves a real silhouette out of the beam instead of the
  // beam passing through it. That shadowed shaft is the chapter's one daylight
  // image and the reason PROJECT.md forbids a billboard here.
  //
  // Tuned toward general fill rather than a hard laser: the board's rays are
  // subtle and diffuse, with the room feeling lit from above rather than cut
  // by a beam through the middle. Density carries more of that than
  // intensity — a denser, softer volume reads as "the room is full of lit
  // air" where a brighter thin one just reads as a bright thin line.
  const lightShaft = ctx.volumetric(new VolumetricShaft({
    light: sun,
    top: oculusY,
    bottom: w.y - 1,
    topRadius: 23,
    bottomRadius: 29,
    center: new THREE.Vector3(w.x, 0, w.z),
    steps: ctx.quality.volumetricSteps,
    density: 0.017,
    intensity: 0.72,
    color: 0xe9eefa,
  }));

  buildApproach(ctx);

  return { moat, skyDisc: sky, sun, lightShaft, oculusY };
}

/** The doorway from the Star Chamber, and the corridor that connects them. */
function buildApproach(ctx) {
  const m = ctx.materials;
  const gate = WAYPOINTS.pagodaGate;
  ctx.box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x - 4.5, gate.y + 4, gate.z), m.laterite);
  ctx.box(new THREE.Vector3(3.0, 9, 3.0), new THREE.Vector3(gate.x + 4.5, gate.y + 4, gate.z), m.laterite);
  ctx.box(new THREE.Vector3(12, 2, 3.0), new THREE.Vector3(gate.x, gate.y + 9.5, gate.z), m.laterite);
  ctx.solid(kalaFace({ width: 4.2, height: 3.0 }), m.laterite,
    new THREE.Vector3(gate.x, gate.y + 8.2, gate.z + 1.8), { collide: false });

  const corridor = caveTunnel(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -21.5, -96),
      new THREE.Vector3(0, -22.2, -106),
      new THREE.Vector3(0, -23.0, -116),
    ]),
    () => 5.0,
    { segments: 30, radial: 12, roughness: 0.24, seed: 12 }
  );
  ctx.solid(corridor, m.wetRock, null, { collide: true });
  // The corridor is the transition from the chamber's one white point to the
  // well's daylight, so it is lit from both ends and dark in the middle.
  ctx.light(0xbfd0e8, 4.0, 22, new THREE.Vector3(0, -21.0, -98), { decay: 1.6 });
  ctx.light(0xffe9c8, 6.0, 30, new THREE.Vector3(0, -22.4, -118), { decay: 1.5 });
  for (let i = 0; i < 4; i++) {
    ctx.box(new THREE.Vector3(9, 1, 8), new THREE.Vector3(0, -24.2 - i * 0.28, -100 - i * 7), m.wetRock);
  }
}
