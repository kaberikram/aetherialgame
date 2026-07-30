import * as THREE from 'three';
import { kalaFace, nagaBalustrade, speleothems } from '../geometry/builders.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';

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
  for (let i = 0; i < 7; i++) {
    ctx.box(
      new THREE.Vector3(15 - i * 0.5, 1.0, 4.2),
      new THREE.Vector3(0, top - drop * i - 0.5, -54 - i * 3.4),
      m.candi
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
  ctx.solid(kalaFace({ width: 3.6, height: 2.6 }), m.laterite,
    new THREE.Vector3(0, -16.2, -54.7), { collide: false });

  // The chamber shell around the arena.
  const dome = new THREE.SphereGeometry(34, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
  dome.scale(1, 0.78, 1);
  dome.scale(-1, 1, 1); // inward-facing
  const domeMesh = new THREE.Mesh(dome, m.rock);
  domeMesh.position.set(0, -23, -78);
  domeMesh.receiveShadow = true;
  ctx.add(domeMesh);

  ctx.solid(speleothems({ count: 34, radius: 26, length: 7, seed: 61 }), m.rock,
    new THREE.Vector3(0, -6, -78), { collide: false });

  return { chamberDome: domeMesh };
}
