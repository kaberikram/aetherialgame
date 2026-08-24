import * as THREE from 'three';

/**
 * Beats 2 and 3 — the ledge the body wakes on, and the descent into the cave.
 *
 * Zone palette: `descent` in ZONE_PROFILES. Cold grey-blue, the last place in
 * the chapter that is merely dim rather than actively dark.
 */
export function build(ctx, WAYPOINTS) {
  ctx.zone('descent');
  buildEmbodimentLedge(ctx, WAYPOINTS);
  buildTunnel(ctx);
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
  ctx.box(new THREE.Vector3(16, 1, 16), new THREE.Vector3(p.x, p.y - 0.5, p.z), m.descentFloor);

  // Enclosing walls with a single gap toward the descent.
  for (const [dx, dz, w, d] of [[0, 8.5, 16, 1.5], [-8.5, 0, 1.5, 18], [8.5, 0, 1.5, 18]]) {
    ctx.box(new THREE.Vector3(w, 7, d), new THREE.Vector3(p.x + dx, p.y + 3.5, p.z + dz), m.descentWall);
  }
  // The exit wall has a doorway-sized gap. The doorway is the tutorial: it is
  // the only break in an otherwise closed box, so it reads without a prompt.
  ctx.box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x - 5.4, p.y + 3.5, p.z - 8.5), m.descentWall);
  ctx.box(new THREE.Vector3(5.2, 7, 1.5), new THREE.Vector3(p.x + 5.4, p.y + 3.5, p.z - 8.5), m.descentWall);
  ctx.box(new THREE.Vector3(16, 3.2, 1.5), new THREE.Vector3(p.x, p.y + 5.4, p.z - 8.5), m.descentWall);

  // A lintel over the doorway. In the art pass this carries a kala face; in
  // the blockout it is what makes the gap read as a door rather than as a hole
  // where a wall failed to build.
  ctx.box(new THREE.Vector3(6.4, 0.9, 0.7), new THREE.Vector3(p.x, p.y + 3.6, p.z - 7.9), m.ledge, { collide: false });

  // A ceiling, so the void's absence of one is something the player felt.
  ctx.box(new THREE.Vector3(16, 1, 18), new THREE.Vector3(p.x, p.y + 7.5, p.z), m.shell);
}

// ---------------------------------------------------------------------------
// The cavern
// ---------------------------------------------------------------------------

/** Clear width of the cavern where it holds one route. */
const CLEAR_WIDTH = 11.6;

/**
 * Clear width where it holds two.
 *
 * Below `WIDEN_FROM_Z` the main line's ramp and the lower route are stacked
 * within a couple of metres of each other, and the space between them closes
 * to nothing by the time both reach the floor. The way out of a closing space
 * is sideways, so the cavern opens here and the main line does not: its floor
 * stays `CLEAR_WIDTH`, which leaves a standing-height strip down each side
 * that is under the ceiling rather than under the ramp.
 *
 * That strip is what the crawl empties into, and it is why the merge no longer
 * has to be a pinch.
 */
const WIDE_WIDTH = 19;
const WIDEN_FROM_Z = 11.0;
/**
 * The cavern narrows again PAST the point where the two routes meet, not at it.
 *
 * `path` closes a width change with a shoulder wall across the step, and the
 * first version put that shoulder on `CHAMBER` — the exact node where the main
 * ramp lands. That walled off the side strip 1.2m short of the merge, and the
 * strip's floor is still 0.44m below the ramp there against a 0.42m step
 * offset: two centimetres of unclimbable, with the only other way out being
 * the space under the ramp, which has already closed. Anyone who missed the
 * jump was stuck at the bottom of the zone.
 */
const WIDEN_TO_Z = 4.0;

/** One width function, read by the enclosure, the lower floor and the ceiling. */
const widthAt = (z) => (z < WIDEN_FROM_Z && z > WIDEN_TO_Z ? WIDE_WIDTH : CLEAR_WIDTH);

// The main line, in plan and in height. `BROW` is the lip you jump from, and
// `LANDING_TOP` is where the far ledge hands back to sloping ground.
//
// Every x is 0, and that is the whole point — see the note on buildTunnel.
const TOP = new THREE.Vector3(0, 0.1, 25.5);
const BROW = new THREE.Vector3(0, -5.6, 18.6);
const LANDING_TOP = new THREE.Vector3(0, -7.4, 13.6);
const CHAMBER = new THREE.Vector3(0, -14.0, 4.8);
const CHAMBER_TAIL = new THREE.Vector3(0, -14.0, WIDEN_TO_Z);
const CHAMBER_END = new THREE.Vector3(0, -14.0, 2.0);

/**
 * The brow, at the basin's height rather than the ramp's.
 *
 * The enclosure uses this only to set how far DOWN its walls reach, and here
 * that matters: from the brow on, the deepest thing the walls have to guard is
 * the basin at −9.4, not the ramp at −5.6. Based on the ramp's own height they
 * stopped nearly four metres above the basin's edge, and you could walk out
 * from under the jump-off lip and through them.
 */
const BROW_FOOT = new THREE.Vector3(0, -9.4, 18.6);

// The lower route. Same x as the main line at every z — only the heights
// differ. See buildTunnel.
const BASIN = new THREE.Vector3(0, -9.4, 17.6);
const BASIN_END = new THREE.Vector3(0, -11.62, 13.6);
const LOWER_WIDEN = new THREE.Vector3(0, -12.32, WIDEN_FROM_Z);

/**
 * The cavern floor from the brow down: the basin, the slope under the main
 * line, and the chamber both routes end in. One list, because the enclosure
 * and the floor have to be the same shape or they are back to disagreeing.
 */
const CAVERN = [BASIN, BASIN_END, LOWER_WIDEN, CHAMBER, CHAMBER_TAIL, CHAMBER_END];

/**
 * The traversal tutorial, built entirely into geometry, with no prompts
 * anywhere: a ramp you cannot fail, a ledge you have to commit to, a 2.6m gap
 * that clears with the jump and refuses a walk, and a landing that drops you
 * further than you expected.
 *
 * ## Two routes, one enclosure
 *
 * Miss the jump and you land on a lower route that rejoins the main line at
 * the bottom. The drop is survivable on purpose: this is the first jump the
 * game asks for, and the lesson it should teach is "jumps are a thing you do",
 * not "jumps are a thing you die to". The cost of missing is the walk.
 *
 * That rejoin is SIDEWAYS, and it has to be. Two stacked surfaces that end at
 * the same place converge, and the space between them is standing height, then
 * crouching height, then nothing — you cannot merge onto a floor you are
 * underneath. So the cavern opens out below `WIDEN_FROM_Z` and the merge
 * happens in the strips beside the ramp, where there is nothing overhead.
 *
 * Stacking two routes is what made this zone's collision the worst in the
 * chapter, and two decisions fix it.
 *
 * **The routes share a plan polyline.** They differ only in height. When they
 * did not, every guard wall belonging to one route stood somewhere in the
 * other route's floor — which is why the lower route's railings had tops you
 * could step onto (cap −7.0 against a landing surface at −7.4, inside a 0.42m
 * step offset) and then not step off again.
 *
 * **One enclosure, based on the lowest floor.** `ZoneBuilder.path` sits each
 * wall on `min(from.y, to.y) − 0.5`, so a single path given the *lower*
 * route's heights emits one continuous vertical surface from the bottom floor
 * to the ceiling. That guards both routes at once, and neither route then
 * carries walls of its own — the main line's floor is a ledge over the lower
 * one, and walking off it is a drop that lands on something.
 *
 * ## Why every node is on x 0
 *
 * `ZoneBuilder.ramp` builds with Euler order YXZ, so a ramp's width axis stays
 * horizontal: a wide slab on a diagonal heading throws a flat fin out sideways
 * at the height of its own endpoint, reaching metres along z. This zone used to
 * dogleg — x went −1 → 2.5 → 0 — and the fins that produced were the whole
 * problem. The last segment at width 9 reached z ≈ 10.8 at y = −11.6 with the
 * lower route at −12.4 beneath it: 0.4m of clearance, which the crouched player
 * only got through by squeezing round. Every attempt to widen a floor made its
 * fin bigger, which is why three of them sealed the crawl. At the top, the same
 * effect left the entry ramp's slanted end short of the jump-off ledge's square
 * one, opening fifteen cells of floor that stopped existing mid-corridor.
 *
 * A dead straight centreline makes every box in the zone axis-aligned, and a
 * fin of an axis-aligned box is the box. The plan-view wiggle was never worth
 * what it cost; the zone's interest is vertical — a ledge, a gap, a route
 * underneath, a crawl — and none of that needed a bend.
 *
 * The slopes: 37.2° out of the doorway, 36.7° from the landing to the floor,
 * against a 52° climb limit.
 */
function buildTunnel(ctx) {
  const m = ctx.materials;

  // --- the enclosure ------------------------------------------------------
  // Walls only, and its spine is the LOWEST floor at each point: the main ramp
  // while that is all there is, then the lower route once it exists. That is
  // what puts every wall's base under the deepest thing it has to guard.
  ctx.path([TOP, BROW_FOOT, ...CAVERN], {
    width: widthAt,
    floor: false,
    walls: true,
    wallHeight: 16,
    wallThickness: 1.2,
    wallMaterial: m.descentWall,
    material: m.descentWall,
  });

  // --- the main line ------------------------------------------------------
  // Out of the doorway and down. Wide and shallow — the first thing the body
  // does after standing up cannot be something it can fail.
  ctx.path([TOP, BROW], {
    width: CLEAR_WIDTH,
    thickness: 1.2,
    material: m.descentFloor,
    walls: false,
  });

  // The jump-off ledge. Short on purpose: standing on it, the gap and the
  // landing beyond are both in frame, and there is nowhere to dither.
  ctx.box(new THREE.Vector3(CLEAR_WIDTH, 1, 1.2), new THREE.Vector3(0, -6.1, 18.0), m.ledge);

  // The basin's back wall — the bedrock the entry ramp is cut into.
  //
  // The enclosure's walls run ALONGSIDE the route; nothing in `path` closes an
  // end. The basin's floor stops just behind the jump-off lip, and behind that
  // is the void under the entry ramp — eight metres of it, with the ramp's
  // underside never dropping below −7.5. So standing in the basin, having just
  // missed the jump, you could walk backwards off the world. Its top is under
  // the lip's own surface, so it is bedrock from below and nothing from above.
  ctx.box(
    new THREE.Vector3(CLEAR_WIDTH + 2.4, 4.5, 1.2),
    new THREE.Vector3(0, -7.95, 18.5),
    m.descentWall
  );

  // ---- the 2.6m gap: z 17.4 → 14.8 ----

  // The landing, 1.8m below the jump-off. Dropping further than you pushed off
  // from is what makes the jump read as a commitment rather than a step.
  ctx.box(new THREE.Vector3(CLEAR_WIDTH, 1, 1.2), new THREE.Vector3(0, -7.9, 14.2), m.ledge);

  // One straight run to the floor, and the bottom chamber. Thin, because this
  // slab is also the lower route's ceiling for most of its length: `ramp` hangs
  // thickness BELOW the walking surface, so a fat floor here is headroom taken
  // from the corridor underneath.
  ctx.path([LANDING_TOP, CHAMBER], {
    width: CLEAR_WIDTH,
    thickness: 0.35,
    material: m.descentFloor,
    walls: false,
  });

  // --- the lower route ----------------------------------------------------
  // The basin under the gap, then down to the same point the main line reaches.
  // Nothing is beneath this floor, so it is free to be as wide as the cavern —
  // and a floor that spans the full width is what turns every ledge above it
  // into a survivable drop rather than a hole.
  ctx.path(CAVERN, {
    width: widthAt,
    thickness: 1.0,
    material: m.descentFloor,
    walls: false,
  });

  // The crawl.
  //
  // Crouch needs somewhere to crouch or it is a button that changes nothing,
  // and this is the honest place for it: the lower route is where you end up
  // having *missed* the jump, so the chapter teaches the verb at the moment it
  // is already telling you that you got something wrong.
  //
  // 1.45m of clearance against a 1.68m standing capsule and a 1.16m crouched
  // one. 1.25m is arithmetically enough and does not work — the controller
  // carries a 0.02m skin offset at each end, snap-to-ground pulls the capsule
  // into the floor, and autostep tries to lift it over what it is brushing.
  //
  // It sits above `WIDEN_FROM_Z`, where the cavern is still one route wide, so
  // there is no way around it; and it is 13m across against an 11.6m cavern, so
  // its ends are buried in the walls. At width 9 over an 8m route it left half
  // a metre of open floor down each side and a standing capsule scraped along
  // the edge and walked the whole thing upright.
  //
  // The slab hangs BELOW the line passed to `ramp`, so the line is the
  // clearance plus the thickness.
  ctx.ramp(
    new THREE.Vector3(0, -9.81, 13.0),
    new THREE.Vector3(0, -10.35, WIDEN_FROM_Z),
    13, 0.5, m.shell,
    { castShadow: false }
  );

  buildCeiling(ctx);
  buildCamp(ctx, new THREE.Vector3(-3.0, -5.4, 19.5));
}

/**
 * The lid. Separate from the enclosure because it hangs off the MAIN line's
 * heights rather than the lowest floor — a ceiling measured from the bottom of
 * a two-storey cavern is a ceiling nobody can see.
 *
 * It does not cast. One directional key lights the whole chapter and every
 * zone in it is roofed, so a shadow-casting roof means the key reaches nothing
 * and the interior is lit by ambient alone — which is what turned the
 * character into a black silhouette on the first pass. Walls and floors still
 * cast onto each other; the lid is simply transparent to the light, which is a
 * stage-lighting convention, not a cheat.
 */
function buildCeiling(ctx) {
  const m = ctx.materials;
  const spine = [TOP, BROW, LANDING_TOP, CHAMBER, CHAMBER_END];

  for (let i = 0; i < spine.length - 1; i++) {
    const p0 = spine[i];
    const p1 = spine[i + 1];
    const mid = p0.clone().lerp(p1, 0.5);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const run = Math.hypot(p1.x - p0.x, p1.z - p0.z) + 2.0;
    ctx.box(
      new THREE.Vector3(widthAt(mid.z) + 2.4, 1.0, run),
      mid.clone().setY(mid.y + 9.5),
      m.shell,
      { rotation: new THREE.Euler(0, yaw, 0), castShadow: false }
    );
  }
}

/**
 * The camp is the only narrative object in the zone and it is easy to miss on
 * purpose — the first evidence that the player is not the first thing to come
 * down here. Kept in the blockout: it costs ten boxes and no collision.
 */
function buildCamp(ctx, at) {
  const m = ctx.materials;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.box(
      new THREE.Vector3(0.12, 1.1, 0.12),
      at.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3)),
      m.wood,
      { collide: false, rotation: new THREE.Euler(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5) }
    );
  }
  ctx.box(new THREE.Vector3(0.34, 0.3, 0.34), at.clone().add(new THREE.Vector3(1.6, 0.5, 0.7)), m.bone, { collide: false });
  for (let i = 0; i < 4; i++) {
    ctx.box(
      new THREE.Vector3(0.44, 0.06, 0.06),
      at.clone().add(new THREE.Vector3(1.95 + i * 0.18, 0.42, 0.65)),
      m.bone,
      { collide: false }
    );
  }
}
