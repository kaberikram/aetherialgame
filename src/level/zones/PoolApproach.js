import * as THREE from 'three';
import { kalaFace, nagaBalustrade, speleothems, banyanRoots, ruinedWall } from '../geometry/builders.js';
import { fbm, materialSet } from '../../render/procedural/textures.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';

const mixc = (a, b, t) => a + (b - a) * t;
const rgbHex = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/**
 * The far cave wall. The concept board inverts the naive reading of "hard
 * falloff into black": the wall the star hangs against is one of the PALEST
 * values in the frame, painted as streaky vertical flowstone drapery, and the
 * falloff happens inside a narrow blue-grey band rather than a swing from
 * white to black. High frequency across u (many separate streaks) and low
 * frequency across v (each streak runs a long way down) is the same
 * anisotropy `bark` uses for tree grain in the shared library, tuned pale and
 * cool here instead of brown.
 *
 * Built locally with the shared `fbm`/`materialSet` helpers rather than added
 * to MaterialLibrary, because this palette (pale, blue, streaked) belongs to
 * this one room and has no business being reachable by the other two zones.
 */
function flowstoneMaterial(quality, { minHeight = 0, key = 'starchamber-flowstone' } = {}) {
  const size = Math.max(128, quality.textureSize);
  const black = rgbHex(0x0e1218);   // the waterline: the wall is nearly gone
  const dark = rgbHex(0x2c3340);    // groove tone, higher up
  const pale = rgbHex(0xacb9cc);    // streak crest — the palest value in the room
  const maps = materialSet(key, size, (u, v) => {
    const drape = fbm(u * 8.5, v * 3.2, { octaves: 5, frequency: 3, seed: 141, period: 3 });
    const fine = fbm(u * 15, v * 6.0, { octaves: 3, frequency: 9, seed: 149, period: 9 });
    const streak = Math.min(1, drape * 0.74 + fine * 0.26);
    // v is 0 at the waterline and 1 at the ceiling. The wall's OWN value
    // carries the concept board's fall from pale to near-black as a function
    // of height, independent of what light actually reaches it — the streaks
    // only get to read as pale near the ceiling; the same wall down at the
    // water is dark almost regardless of them. `minHeight` floors this for
    // the ceiling cap, which sits entirely above the transition and should
    // not fade back toward black at its own seam.
    const height = Math.pow(THREE.MathUtils.clamp(Math.max(v, minHeight), 0, 1), 0.85);
    const drip = Math.max(0, fbm(u * 3.2, v * 1.6, { octaves: 2, frequency: 1.4, seed: 151, period: 1.4 }) - 0.42) * 1.6;
    const shade = 0.82 + drip * 0.28;
    const groove = [mixc(black[0], dark[0], height), mixc(black[1], dark[1], height), mixc(black[2], dark[2], height)];
    const crest = [mixc(black[0], pale[0], height), mixc(black[1], pale[1], height), mixc(black[2], pale[2], height)];
    return {
      h: streak,
      color: [
        mixc(groove[0], crest[0], streak) * shade,
        mixc(groove[1], crest[1], streak) * shade,
        mixc(groove[2], crest[2], streak) * shade,
      ],
      rough: 0.94 - streak * 0.14,
    };
  }, { normalStrength: 1.1, repeat: 1 });

  // Many repeats around the circumference so the streaks stay narrow against
  // a ~30m-radius wall; exactly one repeat vertically so the pale-to-black
  // gradient baked into the sample above spans the wall's full height instead
  // of repeating into bands.
  maps.map.repeat.set(46, 1);
  maps.normalMap.repeat.set(46, 1);
  maps.roughnessMap.repeat.set(46, 1);

  // A modest self-glow baked from the same map, so the wall's paleness is
  // guaranteed rather than riding entirely on a point light's falloff across
  // 30-40m of room — the star's hard falloff genuinely does not reach this
  // far, and real-time GI is out of budget per PROJECT.md's tech stack, so
  // this stands in for the bounce a baked probe would otherwise supply. It
  // rides the same texture, so it is pale exactly where the albedo is pale
  // and near-zero at the dark waterline — never a flat wash.
  const mat = new THREE.MeshStandardMaterial({
    ...maps, roughness: 0.92, metalness: 0,
    emissive: 0xffffff, emissiveMap: maps.map, emissiveIntensity: 0.28,
  });
  mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
  return mat;
}

/** Radial jitter, shared by the dome cap and the cylinder wall below it, so
 * the seam between a perfect sphere and a perfect cylinder does not itself
 * read as a hard edge. */
function jitterRadial(geo, { alongY = false } = {}) {
  const dp = geo.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i);
    const y = dp.getY(i);
    const z = dp.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue; // pole / cap centre
    const angle = Math.atan2(z, x);
    // Sampled through cos/sin rather than the raw angle so the noise wraps
    // seamlessly at the +-PI seam instead of showing a jump there.
    const n = fbm(Math.cos(angle) * 3 + 5, Math.sin(angle) * 3 + (alongY ? y * 0.04 : 0), {
      octaves: 3, frequency: 2.0, seed: 233, period: 50,
    });
    const jitter = 1 + (n - 0.5) * 0.09;
    dp.setX(i, x * jitter);
    dp.setZ(i, z * jitter);
  }
  geo.computeVertexNormals();
}

/**
 * Beat 4 — the walk to the water's edge, before the fight.
 *
 * PHASES.md is specific that the player must be able to get close enough to be
 * scared, so the approach is a long open descent with the chamber visible the
 * whole way down and nothing to do but look at it. The arena itself and
 * everything in the water belong to StarChamberArena.
 *
 * Zone palette: `starChamber` in ZONE_PROFILES — desaturated indigo and slate,
 * one white point light doing all the work, hard falloff into black.
 */
export function build(ctx) {
  const m = ctx.materials;

  const top = GREEN_VEIN_FLOOR(-54);
  const drop = (top - (WAYPOINTS.starChamber.y + 0.2)) / 6;
  // The approach steps run from Green Vein's warm candi into the chamber's
  // cool indigo one step at a time rather than snapping the palette at the
  // threshold. The last couple of steps are also what the player is standing
  // on in the chamber's own establishing shot, so their value has to sit
  // inside the room's palette instead of reading as a lit-white plaza dropped
  // in front of it.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const tint = new THREE.Color(mixc(1, 0.30, t), mixc(1, 0.335, t), mixc(1, 0.375, t));
    ctx.box(
      new THREE.Vector3(15 - i * 0.5, 1.0, 4.2),
      new THREE.Vector3(0, top - drop * i - 0.5, -54 - i * 3.4),
      ctx.library.get('candi', { color: tint })
    );
  }

  // Naga balustrades flanking the descent — the stair guardians.
  for (const s of [-1, 1]) {
    const naga = nagaBalustrade({ length: 22, height: 1.2, drop: 2.4 });
    ctx.solid(naga, m.laterite, new THREE.Vector3(s * 6.6, -21.2, -63), { collide: false });
  }

  // A ruined gateway framing the first view of the chamber.
  ctx.box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(-6.5, -19, -56), m.laterite);
  ctx.box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(6.5, -19, -56), m.laterite);
  ctx.box(new THREE.Vector3(15, 1.6, 2.2), new THREE.Vector3(0, -15.6, -56), m.laterite);
  ctx.solid(kalaFace({ width: 4.0, height: 2.9 }), m.laterite,
    new THREE.Vector3(0, -16.3, -54.7), { collide: false });

  // Banyan roots breaking through the gateway posts — Green Vein's
  // vocabulary following the player down into the chamber.
  for (const s of [-1, 1]) {
    ctx.solid(banyanRoots({ count: 4, height: 4.2, spread: 1.6, seed: 90 + s }), m.bark,
      new THREE.Vector3(s * 6.5, -15.2, -56), { collide: false });
  }

  // The chamber shell around the arena. Originally a partial sphere: fine
  // while it was dark enough to disappear into the black background, but the
  // moment it is repainted pale (per the concept board) its finite angular
  // coverage shows up as a hard-edged ball rim with the void visible past it
  // — a sphere only wraps the camera through a limited cone of directions,
  // and there is nothing beyond that cone but the scene's clear colour.
  //
  // A hemisphere cap on a same-radius cylinder ("capsule" shape) has no such
  // edge: the cylinder covers every azimuth at every height below the
  // equator with no angular limit, and the hemisphere covers every azimuth
  // above it, meeting the cylinder at a matching radius with no crease. There
  // is no direction the camera can look that exits through a seam into
  // black — including straight up at the star, which is exactly what an open
  // cylinder with no cap could not survive.
  const wallRadius = 34;
  const equatorY = -23 + 20;   // comfortably above the star (~-13.5)
  const wallBottomY = -23 - 12; // comfortably below the pool floor (~-24.2)

  const domeGeo = new THREE.SphereGeometry(wallRadius, 40, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
  jitterRadial(domeGeo, { alongY: true });
  domeGeo.scale(-1, 1, 1); // inward-facing
  const domeMesh = new THREE.Mesh(domeGeo, flowstoneMaterial(ctx.quality, {
    minHeight: 0.85, key: 'starchamber-flowstone-dome',
  }));
  domeMesh.position.set(0, equatorY, -78);
  domeMesh.receiveShadow = true;
  ctx.add(domeMesh);

  const wallGeo = new THREE.CylinderGeometry(wallRadius, wallRadius, equatorY - wallBottomY, 48, 6, true);
  jitterRadial(wallGeo, { alongY: true });
  wallGeo.scale(-1, 1, 1); // inward-facing
  const wallMesh = new THREE.Mesh(wallGeo, flowstoneMaterial(ctx.quality));
  wallMesh.position.set(0, (equatorY + wallBottomY) / 2, -78);
  wallMesh.receiveShadow = true;
  ctx.add(wallMesh);

  // A simple dark cap well below the floor line — always in shadow, never
  // meant to be seen, just insurance against a downward ray finding the open
  // bottom of the cylinder.
  const floorCap = new THREE.Mesh(new THREE.CircleGeometry(wallRadius, 24), m.rock);
  floorCap.rotation.x = -Math.PI / 2;
  floorCap.position.set(0, wallBottomY, -78);
  ctx.add(floorCap);

  // Kept a few metres inside the wall's own radius — the old sphere and
  // these stalactites were within centimetres of each other at this height,
  // which is the "hard geometric intersection" the shell showed against the
  // back wall.
  ctx.solid(speleothems({ count: 30, radius: 22, length: 7, seed: 61 }), m.rock,
    new THREE.Vector3(0, -6, -78), { collide: false });

  // A darker masonry counterweight on one side, per the board: the pale cave
  // wall needs a cooler, denser value next to it or the room reads as one
  // uniform light surface instead of two materials meeting.
  ctx.solid(ruinedWall({ length: 15, height: 11, seed: 88 }), m.laterite,
    new THREE.Vector3(23, -24, -82), { collide: false });

  return { chamberDome: domeMesh };
}
