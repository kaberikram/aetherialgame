import * as THREE from 'three';
import { EVENTS } from '../../core/EventBus.js';
import { GREEN_VEIN_FLOOR, WAYPOINTS } from '../waypoints.js';
import { BEAT } from '../../narrative/Beats.js';

/** Floor width and centre offset, shared by the surface and anything on it. */
const FLOOR_WIDTH = (z) => 22 + Math.sin(z * 0.12) * 5;
const FLOOR_OFFSET = (z) => Math.sin(z * 0.09) * 2.2;

const FROM_Z = 2;
const TO_Z = -54;

/**
 * Beats 3 and 5 — the bioluminescent stretch, and the sword.
 *
 * Zone palette: `greenVein` in ZONE_PROFILES, deep olive and black with jade
 * in the water. The readable path is still the lit path; what changed is that
 * the light now comes from the zone's ambient and key rather than from six
 * point lights strung along the water, because eight point lights in one scene
 * is a 25-iteration loop on every fragment in the chapter.
 *
 * ## The floor, and the bug that is now gone
 *
 * `GREEN_VEIN_FLOOR` is the one height function this zone derives everything
 * from — the walkable surface, the water line, the waypoints, and the step
 * gradient the next zone starts from. Two earlier passes got this wrong in
 * opposite directions: the first authored floor and water independently and
 * they diverged by ~2m, and the fix after that built the floor from 8m boxes
 * that each sampled the function at their own centre, which left the collider
 * and the function disagreeing by up to 0.55m away from those centres. That
 * second divergence was documented in STATUS.md as known and worked around.
 *
 * It is not worked around any more. The function is **linear** in z, so a
 * single ramp between its two endpoints is not an approximation of it — it is
 * the same plane, exactly, with nothing sampled and nothing to drift. One
 * collider, one draw call, zero divergence.
 */
export function build(ctx) {
  ctx.zone('greenVein');
  buildCavern(ctx);
  return buildSwordPickup(ctx);
}

function buildCavern(ctx) {
  const m = ctx.materials;
  const floorY = GREEN_VEIN_FLOOR;

  // The cavern: floor, walls and roof from one declaration of how wide it is.
  //
  // This used to be a floor of ONE constant width — `max(FLOOR_WIDTH(2),
  // FLOOR_WIDTH(−54))` = 23.19 — with walls placed separately at
  // `FLOOR_WIDTH(zm)/2 + 2`. `FLOOR_WIDTH` peaks at 27 where `sin(z·0.12) = 1`,
  // which happens at **z ≈ −39.3, inside this zone**, so the wall stood 15.5m
  // out while the floor stopped at 11.6m. Nearly four metres of open air down
  // each side of the Green Vein, and the audit could not see it because a
  // column with no floor was skipped rather than failed.
  //
  // `ctx.path` takes the width once. The floor is that wide and the walls stand
  // on its edge, and there is no second number to disagree with the first.
  //
  // The spine stays a straight line in x — a meander would tilt each segment's
  // plane and pull the surface off `GREEN_VEIN_FLOOR`, which is the one thing
  // about this zone that is already exact (D57). Only the *width* varies, which
  // is what the narrowing was ever about.
  // The mouth flares before the cavern proper: the Descent arrives as a 9m
  // corridor and this is 23m across at z2, and the join between those two
  // numbers has to belong to somebody. It belongs here, because this is the
  // side whose width is changing. `MOUTH_Z` is flat at `GREEN_VEIN_FLOOR(2)`,
  // which is exactly −14 — the same height the Descent's ramps end at — so the
  // two meet flush with no step to climb.
  /** PoolApproach's first step, from its STAIR_W — the same number. */
  const STAIR_WIDTH = 21;
  const MOUTH_Z = 5;
  const MOUTH_WIDTH = 9;
  const flare = (z) => THREE.MathUtils.clamp((MOUTH_Z - z) / (MOUTH_Z - FROM_Z), 0, 1);

  const SEGMENTS = 12;
  const spine = [
    new THREE.Vector3(FLOOR_OFFSET(FROM_Z), floorY(FROM_Z), MOUTH_Z),
    new THREE.Vector3(FLOOR_OFFSET(FROM_Z), floorY(FROM_Z), (MOUTH_Z + FROM_Z) / 2),
  ];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const z = FROM_Z + (TO_Z - FROM_Z) * t;
    // The centreline arrives at x0, because that is where the stairs are.
    //
    // It used to drift to `FLOOR_OFFSET(TO_Z)` — x+2.2 — while the handover
    // node and PoolApproach's stairs both sit on x0. `path` closes a width
    // change with a shoulder, but it places that shoulder off ONE centreline,
    // so two segments 2.2m apart leave the wider one's floor sticking out past
    // the shoulder on the far side. Two cells of walk-off at x11.3…12.0,
    // z−54.7, and the last unguarded edges in the chapter.
    spine.push(new THREE.Vector3(
      THREE.MathUtils.lerp(FLOOR_OFFSET(FROM_Z), 0, t),
      floorY(z),
      z
    ));
  }
  // And three metres past its own end, on the same function.
  //
  // `PoolApproach` starts its stairs at z−54 and they are 15m wide; this
  // cavern is 21m wide where it hands over. That left the outer 3m either side
  // standing on nothing at the seam between the two zones. Carrying the floor
  // through means the handover happens on top of a floor rather than at the
  // edge of one.
  // Narrowing to the stairs' own width and centred on their centreline, so the
  // handover is a funnel and not a lip. This cavern is 21m across and off to
  // x+2.2 where it ends; the stairs are 15m across and centred on x0, and the
  // difference used to be floor on one side of the seam and nothing on the
  // other.
  const HANDOVER = 3;
  spine.push(new THREE.Vector3(0, floorY(TO_Z - HANDOVER), TO_Z - HANDOVER));
  ctx.path(spine, {
    width: (z) => {
      if (z > FROM_Z) return THREE.MathUtils.lerp(MOUTH_WIDTH, FLOOR_WIDTH(FROM_Z), flare(z));
      if (z < TO_Z) {
        const t = THREE.MathUtils.clamp((TO_Z - z) / HANDOVER, 0, 1);
        return THREE.MathUtils.lerp(FLOOR_WIDTH(TO_Z), STAIR_WIDTH, t);
      }
      return FLOOR_WIDTH(z);
    },
    thickness: 1.6,
    material: m.veinFloor,
    wallMaterial: m.veinWall,
    wallHeight: 13,
    wallThickness: 1.6,
    // Non-casting, handled inside `path`: see the note in Descent's buildShell.
    // A roofed cave lit by a single directional key needs the roof transparent.
    ceiling: true,
    ceilingHeight: 12.6,
    ceilingThickness: 1.2,
    ceilingMaterial: m.shell,
  });

  buildWater(ctx, floorY);

  // Stalagmites standing in the lake — the dark silhouettes the concept board
  // uses to break up the glowing water. Boxes, not cones: at blockout scale
  // the read is "vertical mass interrupting a horizontal plane", and a box
  // does that for twelve triangles.
  for (const [x, z, h] of [[-3.6, -14, 2.6], [1.4, -33, 3.4], [0.8, -47, 2.2]]) {
    ctx.box(
      new THREE.Vector3(0.9, h, 0.9),
      new THREE.Vector3(x, floorY(z) + h * 0.5 - 0.3, z),
      m.veinWall,
      { collide: false }
    );
  }

  // The pale distant opening the board anchors its background on: the lightest
  // value in the frame, glimpsed past the foreground. A flat unlit panel does
  // this in the blockout — it is a value anchor, not a light source.
  ctx.box(
    new THREE.Vector3(7, 5, 0.4),
    new THREE.Vector3(-9, floorY(-52) + 8.5, -55.4),
    m.sky,
    { collide: false, castShadow: false }
  );
}

/**
 * The jade water. One broad, winding, still body rather than rectangular
 * ducts — its shape is the zone's readable path.
 *
 * A flat translucent plane at the surface height, and nothing under it. The
 * previous version was a MeshPhysicalMaterial with depth-driven murk,
 * scrolling ripple normals, a baked emissive rim map and a per-frame update
 * bound to the post chain's depth texture. None of that survives contact with
 * cel shading, which has no concept of a Fresnel-blended refractive surface —
 * the rim term on the toon material does the waterline read instead.
 */
function buildWater(ctx, floorY) {
  const m = ctx.materials;
  const anchors = [
    { x: -7, z: 2, width: 3.4 },
    { x: -4, z: -12, width: 4.6 },
    { x: 5, z: -24, width: 6.2 },
    { x: -3, z: -36, width: 7.8 },
    { x: 0, z: -50, width: 10.2 },
  ];

  // A quad per span, each lying flat at the floor height plus the lift. Water
  // never collides; movement through it is handled by the arena's depth query
  // in the Star Chamber, and this stretch is decorative.
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const zm = (a.z + b.z) * 0.5;
    const from = new THREE.Vector3(a.x, floorY(a.z) + 0.11, a.z);
    const to = new THREE.Vector3(b.x, floorY(b.z) + 0.11, b.z);
    ctx.ramp(from, to, (a.width + b.width) * 0.5, 0.12, m.veinJade, {
      collide: false, castShadow: false,
    });
    void zm;
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

  // The warrior, as a collapsed pile rather than a rigged skeleton: a ribcage
  // and a skull, tipped over. Enough to read as a body from the path.
  const bones = new THREE.Group();
  bones.position.set(-0.9, 0.15, 0.3);
  bones.rotation.set(-0.3, 0.7, 0.2);
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), m.bone);
    rib.position.set(0, 0.05, -0.3 + i * 0.16);
    bones.add(rib);
  }
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), m.bone);
  skull.position.set(0, 0.12, 0.45);
  bones.add(skull);
  g.add(bones);

  // The sword: a blade, a guard and a grip. Steel value, no emissive.
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.03), m.steel);
  blade.position.y = 0.5;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.07), m.steel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), m.wood);
  grip.position.y = -0.16;
  sword.add(blade, guard, grip);
  sword.rotation.set(-Math.PI * 0.42, 0.5, 0.25);
  sword.position.set(0, 0.9, 0);
  g.add(sword);

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
      ctx.bus.emit(EVENTS.BEAT_ENTERED, { id: BEAT.SWORD });
      ctx.bus.emit(EVENTS.DIALOGUE_LINE, {
        speaker: '', text: 'Cold steel. Someone else needed it first.', duration: 3.6,
      });
    },
  });

  return { swordMesh: sword, swordGroup: g };
}
