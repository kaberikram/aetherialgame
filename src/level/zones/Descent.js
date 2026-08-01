import * as THREE from 'three';
import { caveTunnel, kalaFace, ruinedWall, rubbleField } from '../geometry/builders.js';

/**
 * Beats 2 and 3 — the ledge the body wakes on, and the descent into the cave.
 *
 * Zone palette: `descent` in ZONE_PROFILES. Cold grey-blue, low ambient, two
 * weak point lights. This is the last place in the chapter that is merely dim
 * rather than actively dark.
 */
export function build(ctx, WAYPOINTS) {
  buildEmbodimentLedge(ctx, WAYPOINTS);
  buildTunnel(ctx, WAYPOINTS);
  return {};
}

/**
 * The ledge the body wakes on. Small, enclosed, one exit — the first thing
 * the player sees after the void has to be legible in a single glance, and
 * the only direction they can go is the one the chapter needs them to.
 */
function buildEmbodimentLedge(ctx, WAYPOINTS) {
  const m = ctx.materials;
  const p = WAYPOINTS.embodiment;
  ctx.box(new THREE.Vector3(16, 1, 16), new THREE.Vector3(p.x, p.y - 0.5, p.z), m.rock);

  // Enclosing walls with a single gap toward the descent.
  for (const [dx, dz, w, d] of [[0, 8.5, 16, 1.5], [-8.5, 0, 1.5, 18], [8.5, 0, 1.5, 18]]) {
    ctx.box(new THREE.Vector3(w, 7, d), new THREE.Vector3(p.x + dx, p.y + 3.5, p.z + dz), m.rock);
  }
  // The exit wall has a doorway-sized gap, with a kala face over it.
  ctx.box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x - 5.4, p.y + 3.5, p.z - 8.5), m.rock);
  ctx.box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x + 5.4, p.y + 3.5, p.z - 8.5), m.rock);
  ctx.box(new THREE.Vector3(16, 3.2, 1.5), new THREE.Vector3(p.x, p.y + 5.4, p.z - 8.5), m.rock);

  ctx.solid(kalaFace({ width: 3.0, height: 2.1 }), m.laterite,
    new THREE.Vector3(p.x, p.y + 4.3, p.z - 7.7), { collide: false });

  ctx.solid(rubbleField({ count: 18, radius: 6, seed: 21 }), m.rock,
    new THREE.Vector3(p.x, p.y, p.z + 1), { collide: false });

  // A ceiling, so the void's absence of one is something the player felt.
  ctx.box(new THREE.Vector3(16, 1, 18), new THREE.Vector3(p.x, p.y + 7.5, p.z), m.rock);
}

/**
 * The traversal tutorial, built entirely into geometry. In order, and with
 * no prompts anywhere: a ramp you cannot fail, a step-down that teaches
 * landing, a gap narrow enough that walking off it is survivable, then one
 * that is not, and a ledge drop that requires the jump.
 */
function buildTunnel(ctx, WAYPOINTS) {
  const m = ctx.materials;
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
  ctx.solid(tunnel, m.rock, null, { collide: true });

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
  for (const st of steps) ctx.box(st.s, st.p, m.rock);

  // Bones and an abandoned camp: someone came down here before you.
  buildCamp(ctx, new THREE.Vector3(a.x - 3.2, a.y - 3.0, a.z - 10));

  // Carvings the player cannot read yet — a band of relief along the wall.
  for (let i = 0; i < 5; i++) {
    const t = 0.2 + i * 0.15;
    const pt = curve.getPointAt(t);
    const panel = ruinedWall({ length: 3.2, height: 1.8, blockH: 0.42, seed: 30 + i });
    ctx.solid(panel, m.laterite, new THREE.Vector3(pt.x + 3.4, pt.y - 1.2, pt.z), { collide: false });
  }

  ctx.light(0x6b7f92, 3.2, 16, new THREE.Vector3(a.x, a.y + 1, a.z - 4));
  ctx.light(0x5a6d80, 2.4, 14, new THREE.Vector3(a.x, a.y - 7, a.z - 16));
}

function buildCamp(ctx, at) {
  const m = ctx.materials;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 5, 10), m.rock);
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(at).setY(at.y + 0.4);
  ctx.add(ring);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 4), m.bark);
    stick.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3));
    stick.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    ctx.add(stick);
  }
  // A skull and a ribcage, small and easy to miss.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m.bone);
  skull.position.copy(at).add(new THREE.Vector3(1.6, 0.5, 0.7));
  skull.castShadow = true;
  ctx.add(skull);
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 4, 8, Math.PI), m.bone);
    rib.position.copy(at).add(new THREE.Vector3(1.9 + i * 0.16, 0.42, 0.65));
    rib.rotation.set(Math.PI / 2, 0.2, 0.1 * i);
    ctx.add(rib);
  }
}
