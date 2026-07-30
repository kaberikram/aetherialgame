import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';
import { caveTunnel, candiTower, kalaFace, banyanRoots } from '../geometry/builders.js';
import { WAYPOINTS } from '../waypoints.js';

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
  const shaft = new THREE.CylinderGeometry(30, 24, 58, 32, 1, true);
  shaft.scale(-1, 1, 1);
  const shaftMesh = new THREE.Mesh(shaft, m.wetRock);
  shaftMesh.position.set(w.x, w.y + 27, w.z);
  shaftMesh.receiveShadow = true;
  ctx.add(shaftMesh);
  ctx.physics.addStaticGeometry(shaft, shaftMesh.matrixWorld.clone().setPosition(shaftMesh.position),
    { group: FILTERS.world });

  // Floor and the shallow moat the board shows around the plinth.
  ctx.box(new THREE.Vector3(64, 1, 64), new THREE.Vector3(w.x, w.y - 0.5, w.z), m.wetRock);

  const moat = new THREE.Mesh(
    new THREE.RingGeometry(13, 26, 40),
    new THREE.MeshStandardMaterial({
      color: 0x1c3442, roughness: 0.14, metalness: 0.4, transparent: true, opacity: 0.88,
    })
  );
  moat.rotation.x = -Math.PI / 2;
  moat.position.set(w.x, w.y + 0.12, w.z);
  ctx.add(moat);

  // The candi.
  const tower = candiTower({ tiers: 5, baseWidth: 14, totalHeight: 26, seed: 3 });
  ctx.solid(tower, m.candi, new THREE.Vector3(w.x, w.y, w.z), { collide: true });

  // Vegetation breaking the masonry, per the board.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 7 + (i % 2) * 2.5;
    ctx.solid(banyanRoots({ count: 5, height: 5, spread: 2.2, seed: 70 + i }), m.bark,
      new THREE.Vector3(w.x + Math.cos(a) * r, w.y + 6 + (i % 3) * 3.5, w.z + Math.sin(a) * r),
      { collide: false });
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + (i % 3) * 0.5, 0), m.moss);
    bush.position.set(w.x + Math.cos(a) * r * 0.9, w.y + 8 + (i % 3) * 4, w.z + Math.sin(a) * r * 0.9);
    bush.castShadow = true;
    ctx.add(bush);
  }

  // The oculus: a ring of vegetation around a hole to the sky.
  const oculusY = w.y + 58;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(21, 3.2, 8, 32), m.moss);
  lip.rotation.x = Math.PI / 2;
  lip.position.set(w.x, oculusY, w.z);
  ctx.add(lip);

  // The sky disc. The only daylight in the chapter, and it must read as
  // genuinely outside — a flat bright value, not a lit surface.
  const sky = new THREE.Mesh(
    new THREE.CircleGeometry(21, 40),
    new THREE.MeshBasicMaterial({ color: 0x9dc0e8, fog: false, side: THREE.DoubleSide })
  );
  sky.rotation.x = Math.PI / 2;
  sky.position.set(w.x, oculusY + 1.5, w.z);
  ctx.add(sky);

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
  ctx.add(sun);
  ctx.add(sun.target);

  const shaftCone = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 26, 58, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xcfe0f5, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    })
  );
  shaftCone.position.set(w.x, w.y + 29, w.z);
  ctx.add(shaftCone);

  buildApproach(ctx);

  return { moat, skyDisc: sky, sun, shaftCone, oculusY };
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
