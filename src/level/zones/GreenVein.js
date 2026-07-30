import * as THREE from 'three';
import { EVENTS } from '../../core/EventBus.js';
import { banyanRoots, rubbleField, speleothems, caveTunnel } from '../geometry/builders.js';
import { buildSword } from '../../character/Weapon.js';
import { buildCharacter } from '../../character/Rig.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';

const _v = new THREE.Vector3();

/**
 * Beats 3 and 5 — the bioluminescent stretch, and the sword.
 *
 * Near-zero ambient, and the emissive jade water is doing all the lighting —
 * so the readable path IS the lit path, and sightlines are controlled by where
 * the water runs. Zone palette: `greenVein` in ZONE_PROFILES, deep olive and
 * black.
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

  const segStep = 8;
  for (let z = 2; z >= -54; z -= segStep) {
    const y = floorY(z - segStep / 2);
    const width = 22 + Math.sin(z * 0.12) * 5;
    ctx.box(
      new THREE.Vector3(width, 1.2, segStep + 0.4),
      new THREE.Vector3(Math.sin(z * 0.09) * 2.2, y - 0.6, z - segStep / 2),
      m.wetRock
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
  ctx.solid(shell, m.rock, null, { collide: true });

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

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + i * 0.45, len), m.jade.clone());
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = -Math.atan2(dir.x, dir.z);
    plane.position.copy(mid);
    ctx.add(plane);
    ctx.emissive(plane, i * 1.3);

    // Dim, green, slow decay. Long falloff so the dark between channels
    // stays genuinely dark rather than washing to a uniform mid-tone.
    for (const t of [0.25, 0.75]) {
      ctx.light(0x2fbe8c, 5.6, 26, from.clone().lerp(to, t).setY(from.y + 1.4), { decay: 1.5 });
    }
  }

  // Stalactites and banyan roots breaking through the ceiling.
  ctx.solid(speleothems({ count: 30, radius: 17, length: 5, seed: 23 }), m.rock,
    new THREE.Vector3(0, floorY(-24) + 13, -24), { collide: false });
  for (const z of [-8, -24, -42]) {
    ctx.solid(banyanRoots({ count: 8, height: 7, spread: 3.2, seed: 40 - z }), m.bark,
      new THREE.Vector3(z % 4 === 0 ? 7 : -7, floorY(z) + 11, z), { collide: false });
  }
}

/**
 * Beat 5. Half-buried in mud beside a dead warrior's bones.
 *
 * Deliberately unlit and off the main line: no glow, no marker, no rarity
 * colour. It is a tool someone else was using when they died here.
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
