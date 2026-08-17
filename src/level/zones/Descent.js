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

/**
 * The traversal tutorial, built entirely into geometry, with no prompts
 * anywhere: a ramp you cannot fail, a ledge you have to commit to, a 2.6m gap
 * that clears with the jump and refuses a walk, and a landing that drops you
 * further than you expected.
 *
 * ## Two routes, and why the gap has a floor under it
 *
 * The old version was a swept tube with a flattened floor band and six ledge
 * boxes sitting inside it. The tube was the most expensive geometry in the
 * zone and the worst surface the character controller had to resolve against
 * — the player walked on whatever triangles the sweep happened to emit.
 *
 * Replacing it with ledges alone left 2.6m of the critical path with nothing
 * underneath it, which the collision audit correctly called a hole. So the
 * gap now spans a **lower route**: miss the jump and you land on a longer,
 * gentler path that rejoins the main line at the bottom. The drop is 3.8m,
 * which at this gravity arrives at 12.9 m/s — under the 14 m/s hard-landing
 * threshold and well under the 19 m/s damage threshold.
 *
 * That is deliberate. This is the first jump the game asks for, and the
 * lesson it should teach is "jumps are a thing you do", not "jumps are a
 * thing you die to". The cost of missing is the walk, which is the same
 * currency the rest of the chapter charges in.
 *
 * Every slope below is under 40°, against a 52° climb limit.
 */
function buildTunnel(ctx, WAYPOINTS) {
  const m = ctx.materials;
  const b = WAYPOINTS.descentBottom;

  // --- the main line -----------------------------------------------------
  // R1: out of the doorway and down. Wide and shallow — the first thing the
  // body does after standing up cannot be something it can fail.
  ctx.ramp(
    new THREE.Vector3(0, 0.1, 25.5),
    new THREE.Vector3(-3.0, -5.6, 18.6),
    8, 1.2, m.descentFloor
  );

  // The jump-off ledge. Short on purpose: standing on it, the gap and the
  // landing beyond are both in frame, and there is nowhere to dither.
  ctx.box(new THREE.Vector3(8, 1, 1.2), new THREE.Vector3(-3.0, -6.1, 18.0), m.ledge);

  // ---- the 2.6m gap: z 17.4 → 14.8 ----

  // The landing, 1.8m below the jump-off. Dropping further than you pushed off
  // from is what makes the jump read as a commitment rather than a step.
  ctx.box(new THREE.Vector3(8, 1, 1.2), new THREE.Vector3(-1.0, -7.9, 14.2), m.ledge);

  ctx.ramp(
    new THREE.Vector3(-1.0, -7.4, 13.6),
    new THREE.Vector3(2.5, -11.6, 8.0),
    8, 1.2, m.descentFloor
  );
  ctx.ramp(
    new THREE.Vector3(2.5, -11.6, 8.0),
    new THREE.Vector3(0, -14.0, 4.8),
    9, 1.2, m.descentFloor
  );

  // The bottom chamber floor. Meets the Green Vein's own ramp at z≈2.
  ctx.box(new THREE.Vector3(12, 1, 6), new THREE.Vector3(b.x, b.y - 0.5, 3.5), m.descentFloor);

  // --- the lower route, under the gap ------------------------------------
  ctx.ramp(
    new THREE.Vector3(-3.0, -9.4, 17.6),
    new THREE.Vector3(-1.5, -11.4, 14.4),
    8, 1.0, m.descentFloor
  );
  ctx.ramp(
    new THREE.Vector3(-1.5, -11.4, 14.4),
    new THREE.Vector3(2.0, -14.0, 5.0),
    8, 1.0, m.descentFloor
  );

  // Walls down the lower route.
  //
  // `buildShell` walls the descent, but it follows the MAIN spine, and the lower
  // route diverges from that spine by up to 5m — so the route you end up on by
  // missing the jump was a ledge in open air with nothing at its edges. Walking
  // into the crawl below scrubs a standing player sideways along the slab, and
  // the scrub slid them straight off that edge and out of the chapter: y −13.8 to
  // −166 and still falling. Found by `tools/controls.mjs`.
  //
  // Inner faces sit at ±3.9 against the route's half-width of 4, so the player
  // meets a wall a little before the drop rather than at it.
  const lowerSpine = [
    new THREE.Vector3(-3.0, -9.4, 17.6),
    new THREE.Vector3(-1.5, -11.4, 14.4),
    new THREE.Vector3(2.0, -14.0, 5.0),
  ];
  for (let i = 0; i < lowerSpine.length - 1; i++) {
    const p0 = lowerSpine[i];
    const p1 = lowerSpine[i + 1];
    const mid = p0.clone().lerp(p1, 0.5);
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    // Euler(0, yaw, 0) with yaw = atan2(dx, dz) sends local +Z along the
    // segment, so `size` reads (thickness, height, length).
    const yaw = Math.atan2(dx, dz);
    const px = dz / len;
    const pz = -dx / len;
    for (const side of [-1, 1]) {
      ctx.box(
        new THREE.Vector3(1.0, 4, len + 1.0),
        new THREE.Vector3(mid.x + px * side * 4.4, mid.y + 1.4, mid.z + pz * side * 4.4),
        m.descentWall,
        { rotation: new THREE.Euler(0, yaw, 0), castShadow: false }
      );
    }
  }

  // The crawl.
  //
  // Crouch needs somewhere to crouch or it is a button that changes nothing,
  // and this is the honest place for it: the lower route is where you end up
  // having *missed* the jump, so the chapter teaches the verb at the moment it
  // is already telling you that you got something wrong.
  //
  // 1.45m of clearance, against a 1.68m standing capsule and a 1.16m crouched
  // one. The first draft used 1.25m, which is arithmetically enough — 9cm of
  // margin — and it did not work: the character controller carries a 0.02m skin
  // offset at each end, snap-to-ground pulls the capsule down into the floor,
  // and autostep tries to lift it over what it is brushing. `tools/controls.mjs`
  // caught it, crouched and blocked. 1.45m leaves ~0.25m either way, which also
  // stops the crawl feeling like it is scraping — a ceiling you have to be
  // pixel-perfect under reads as a bug even when it is passable.
  //
  // The slab hangs BELOW the line passed to `ramp`, so the line sits at the
  // clearance plus the thickness.
  ctx.ramp(
    new THREE.Vector3(-0.98, -11.79 + 1.45 + 1.0, 13.0),
    new THREE.Vector3(0.51, -12.89 + 1.45 + 1.0, 9.0),
    // Width 9 against the lower route's 8: the slab has to overhang the floor it
    // roofs. At width 7 it left 0.5m of open floor down each side, and a
    // standing capsule (0.64m across) scraped along the edge and walked the
    // whole crawl upright — `tools/controls.mjs` caught it doing 37m.
    9, 1.0, m.shell,
    { castShadow: false }
  );

  buildShell(ctx);
  buildCamp(ctx, new THREE.Vector3(-3.0, -5.4, 19.5));
}

/**
 * Walls and a ceiling around the descent. Non-colliding except the walls,
 * which are what stop the player walking off the side of a ramp into the void
 * — the ramps themselves are only as wide as they are.
 */
function buildShell(ctx) {
  const m = ctx.materials;

  // Sampled from the main line rather than from a curve, so the enclosure
  // follows the path the player is actually on.
  const spine = [
    new THREE.Vector3(0, 0.1, 25.5),
    new THREE.Vector3(-3.0, -5.6, 18.6),
    new THREE.Vector3(-1.0, -7.4, 14.2),
    new THREE.Vector3(2.5, -11.6, 8.0),
    new THREE.Vector3(0, -14.0, 4.0),
  ];

  for (let i = 0; i < spine.length - 1; i++) {
    const p0 = spine[i];
    const p1 = spine[i + 1];
    const mid = p0.clone().lerp(p1, 0.5);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + 2.0;
    const rot = new THREE.Euler(0, yaw, 0);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    for (const side of [-1, 1]) {
      ctx.box(
        new THREE.Vector3(1.2, 16, len),
        mid.clone().addScaledVector(right, side * 6.4).setY(mid.y + 2.0),
        m.descentWall,
        { rotation: rot }
      );
    }
    // The ceiling does not cast. One directional key lights the whole chapter
    // and every zone in it is roofed, so a shadow-casting roof means the key
    // reaches nothing and the interior is lit by ambient alone — which is what
    // turned the character into a black silhouette on the first pass. Walls
    // and floors still cast onto each other; the lid is simply transparent to
    // the light, which is a stage-lighting convention, not a cheat.
    ctx.box(
      new THREE.Vector3(13.6, 1.0, len),
      mid.clone().setY(mid.y + 9.5),
      m.shell,
      { rotation: rot, castShadow: false }
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
