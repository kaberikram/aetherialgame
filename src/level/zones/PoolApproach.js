import * as THREE from 'three';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';

/**
 * Beat 4 — the walk to the water's edge, before the fight.
 *
 * PHASES.md is specific that the player must be able to get close enough to be
 * scared, so the approach is a long open descent with the chamber visible the
 * whole way down and nothing to do but look at it. The arena itself and
 * everything in the water belong to StarChamberArena.
 *
 * Zone palette: `starChamber` in ZONE_PROFILES — desaturated indigo and slate.
 *
 * ## The shell
 *
 * The chamber wall used to be a jittered hemisphere on a jittered cylinder,
 * carrying a bespoke 256² procedural flowstone material with a baked emissive
 * to stand in for bounce light. All of that was in service of one read: **the
 * wall the star hangs against is one of the palest values in the frame**, and
 * the falloff into black happens inside a narrow band rather than a swing from
 * white to nothing.
 *
 * That read survives into the blockout, because it was always a value
 * decision rather than a texture one. `chamberWall` is a pale material and the
 * shell is a low-segment cylinder. The player standing on the last step sees
 * the same value relationship they did before; they just see it in flat bands.
 */
export function build(ctx) {
  ctx.zone('starChamber');
  const m = ctx.materials;

  const top = GREEN_VEIN_FLOOR(-54);
  const drop = (top - (WAYPOINTS.starChamber.y + 0.2)) / 6;

  // Seven steps down. The value gradient runs cool-and-dark to darker rather
  // than starting bright: these are the steps the player is standing on for
  // the chamber's establishing shot, filling the bottom third of frame, and a
  // lit-white plaza in front of an indigo room reads as a different game.
  // Width comes off one expression, shared with the balustrades below and
  // matched to the Green Vein's own width where the two meet. The first step
  // used to be 15m against a 21m cavern mouth, so 3m either side of the seam
  // was cavern floor ending at nothing.
  const STAIR_W = (i) => 21 - i * 1.2;
  for (let i = 0; i < 7; i++) {
    ctx.box(
      new THREE.Vector3(STAIR_W(i), 1.0, 4.2),
      new THREE.Vector3(0, top - drop * i - 0.5, -54 - i * 3.4),
      i < 3 ? m.chamberStep : m.chamberBasin
    );
  }

  // A ruined gateway framing the first view of the chamber. The lintel is the
  // frame: it crops the room on the approach so the reveal happens by walking
  // rather than by turning.
  ctx.box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(-6.5, -19, -56), m.chamberWall);
  ctx.box(new THREE.Vector3(2.2, 8, 2.2), new THREE.Vector3(6.5, -19, -56), m.chamberWall);
  ctx.box(new THREE.Vector3(15, 1.6, 2.2), new THREE.Vector3(0, -15.6, -56), m.chamberWall);

  // Balustrades flanking the descent — the stair guardians, and now solid.
  //
  // They were `collide: false`, which meant the seven steps down into the
  // chamber had no edges at all: 12–15m wide, nothing either side, and the
  // chamber shell beyond them is decoration. Walking off the stairs walked you
  // out of the chapter.
  //
  // They come off the same `15 - i*0.5` expression the steps are cut from, so
  // the rail stands on the step's edge rather than near it. Only the upper
  // stretch is railed: below z≈−62 the arena's dais is wider than the stairs
  // are, so a rail there would divide the room the fight happens in rather than
  // guard anything.
  const railSpine = [];
  for (let i = 0; i <= 3; i++) {
    railSpine.push(new THREE.Vector3(0, top - drop * i + 0.5, -54 - i * 3.4));
  }
  ctx.path(railSpine, {
    floor: false,
    width: (z) => STAIR_W(Math.max(0, (-54 - z) / 3.4)),
    material: m.chamberStep,
    wallMaterial: m.chamberStep,
    wallHeight: 3,
    wallThickness: 0.6,
  });

  // The chamber shell. A cylinder plus a cap, both inward-facing, both
  // non-colliding — the player is held in by the arena's containment ring, not
  // by this. Segment counts are deliberately low: a 48-segment wall was
  // smoothing a surface that is about to be read as flat bands anyway.
  const wallRadius = 34;
  const equatorY = -23 + 20;    // comfortably above the star
  const wallBottomY = -23 - 12; // comfortably below the pool floor

  const wallGeo = new THREE.CylinderGeometry(
    wallRadius, wallRadius, equatorY - wallBottomY, 24, 1, true
  );
  wallGeo.scale(-1, 1, 1); // inward-facing
  const wallMesh = new THREE.Mesh(wallGeo, m.chamberWall);
  wallMesh.position.set(0, (equatorY + wallBottomY) / 2, -78);
  wallMesh.receiveShadow = true;
  wallMesh.castShadow = false;
  // No ink on the shell: EdgesGeometry on a 24-segment cylinder draws 24
  // vertical lines around the room, which reads as a birdcage rather than as
  // a cave. Ink belongs on things with corners.
  wallMesh.userData.noInk = true;
  ctx.add(wallMesh);

  // A cap over the top, so looking straight up at the star finds stone rather
  // than the scene's clear colour.
  const capGeo = new THREE.SphereGeometry(wallRadius, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  capGeo.scale(-1, 1, 1);
  const capMesh = new THREE.Mesh(capGeo, m.chamberWall);
  capMesh.position.set(0, equatorY, -78);
  capMesh.castShadow = false;
  capMesh.userData.noInk = true;
  ctx.add(capMesh);

  // A dark floor cap well below the water line — never meant to be seen, just
  // insurance against a downward ray finding the open bottom of the cylinder.
  const floorCap = new THREE.Mesh(new THREE.CircleGeometry(wallRadius, 20), m.chamberBasin);
  floorCap.rotation.x = -Math.PI / 2;
  floorCap.position.set(0, wallBottomY, -78);
  floorCap.userData.noInk = true;
  ctx.add(floorCap);

  // The darker masonry counterweight on one side: the pale wall needs a
  // denser value beside it or the room reads as one uniform light surface
  // instead of two materials meeting.
  ctx.box(
    new THREE.Vector3(15, 11, 2),
    new THREE.Vector3(23, -24, -82),
    m.chamberStep,
    { collide: false, rotation: new THREE.Euler(0, -0.5, 0) }
  );

  return { chamberDome: capMesh };
}
