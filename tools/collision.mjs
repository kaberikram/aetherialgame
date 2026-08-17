#!/usr/bin/env node
/**
 * collision.mjs — is the world you collide with the world you can see?
 *
 * Fully verifiable in this container: physics is CPU-side, so unlike frame
 * time, every number here is the real number.
 *
 * Four questions, in order of how badly a "no" hurts:
 *
 *   1. GROUND      Is there anything under the critical path, everywhere?
 *                  A hole drops the player out of the chapter.
 *   2. CONTINUITY  Does the ground ever step up further than the character can
 *                  climb? That is an invisible wall, and it reads as the game
 *                  refusing to let you walk somewhere that plainly looks
 *                  walkable.
 *   3. SPAWNS      Does every spawn, checkpoint and debug warp put the capsule
 *                  ON the ground — not inside it, not over a hole?
 *   4. AGREEMENT   Where a zone derives heights from a function, does the
 *                  collision actually match it? The Green Vein builds its
 *                  floor from 8m boxes that sample GREEN_VEIN_FLOOR once at
 *                  their centre, so the two are known to diverge; this
 *                  measures by how much rather than taking the comment's word.
 *
 *   node tools/collision.mjs
 *   node tools/collision.mjs --port 5331
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = Number(flag('port', 5331));

/**
 * The critical path, as centreline segments the player must be able to walk.
 * Sampled densely; each sample probes a small cross-section too, because a
 * gap you can sidestep into is still a gap.
 */
/**
 * `continuous: false` marks a stretch that is SUPPOSED to be broken. The
 * descent is the traversal tutorial — stepping ledges with a gap the player
 * has to jump, authored that way — so flagging its drops as defects would be
 * flagging the level design. Those segments are still checked for ground on
 * the centreline, just not for continuity.
 */
const PATH_SEGMENTS = [
  { zone: 'descent', from: [0, 34], to: [0, 26], halfWidth: 5, y0: 0.1, y1: 0.0 },
  { zone: 'descent', from: [0, 26], to: [0, 4], halfWidth: 0, y0: 0.0, y1: -14, continuous: false },
  { zone: 'greenVein', from: [0, 2], to: [0, -50], halfWidth: 7, y0: -14.3, y1: -21.1 },
  { zone: 'greenVein', from: [0, -30], to: [7.5, -30], halfWidth: 2, y0: -18.3, y1: -18.3 },
  { zone: 'starChamber', from: [0, -54], to: [0, -74], halfWidth: 5, y0: -21.6, y1: -23.0 },
  { zone: 'pagodaWell', from: [0, -96], to: [0, -116], halfWidth: 3, y0: -24.2, y1: -25.0 },
  { zone: 'pagodaWell', from: [0, -120], to: [17, -126], halfWidth: 6, y0: -25.0, y1: -25.0 },
];

/**
 * Walkable footprints, swept on a grid.
 *
 * `floorMin`/`floorMax` bound the band the zone's walkable floor lives in, and
 * the probe only accepts an upward-facing surface inside it. This is check 1's
 * trick — "probe from just above the EXPECTED floor, not from high above" —
 * generalised from a centreline to a grid, and it is load-bearing for the same
 * reason: every room in this chapter is roofed, and a roof's top face faces up
 * exactly as convincingly as a floor's does. Starting above the ceiling means
 * measuring the ceiling, which is what the first version of this sweep did for
 * its entire life.
 *
 * Bands come from `src/level/waypoints.js`:
 *   descent      embodiment y0.1 → descentBottom y−14, plus the lower route
 *   greenVein    GREEN_VEIN_FLOOR: −14 at z2 → −21.6 at z−54, ramp 1.6 thick
 *   starChamber  arena waterLevel −23, basin −23.06 at the rim → −24.23 deep
 *   pagodaWell   pagodaFloor y−25
 *
 * Footprints are deliberately tighter than the ZoneManager trigger volumes —
 * those extend well past the geometry so the atmosphere changes before you
 * arrive, and sweeping them would sample mostly empty air.
 */
const GRID_ZONES = [
  { id: 'descent', minX: -7, maxX: 7, minZ: 2, maxZ: 42, step: 1.5, floorMin: -16.5, floorMax: 1.5 },
  { id: 'greenVein', minX: -12, maxX: 12, minZ: -52, maxZ: 2, step: 1.5, floorMin: -22.5, floorMax: -13.0 },
  { id: 'starChamber', minX: -16, maxX: 16, minZ: -92, maxZ: -54, step: 1.5, floorMin: -25.5, floorMax: -21.0 },
  { id: 'pagodaWell', minX: -24, maxX: 24, minZ: -145, maxZ: -96, step: 2.0, floorMin: -27.0, floorMax: -22.0 },
];

/**
 * Points to test for wedges. Sparser than the grid sweep because each one runs
 * the real controller for eight directions × 40 steps, which is 320 simulation
 * steps per point.
 */
const WEDGE_POINTS = [];
for (const g of GRID_ZONES) {
  for (let x = g.minX + 2; x <= g.maxX - 2; x += 5) {
    for (let z = g.minZ + 2; z <= g.maxZ - 2; z += 6) {
      WEDGE_POINTS.push({ x, y: g.floorMax + 1.0, z });
    }
  }
}

/** cos(52°) — the character controller's climb limit, so "walkable" here and
 * "walkable" in the game are the same question. */
const WALKABLE_NORMAL_Y = Math.cos((52 * Math.PI) / 180);

/**
 * Capsule heights, from `TUNING.movement`. Duplicated as literals rather than
 * imported because this file runs in node and the tuning module is authored for
 * the browser bundle — but they are asserted against the live values inside the
 * page below, so a drift here fails loudly instead of quietly measuring the
 * wrong body.
 */
const STAND_HEIGHT = (0.52 + 0.32) * 2;  // ≈1.68m
const CROUCH_HEIGHT = (0.26 + 0.32) * 2; // ≈1.16m

const free = () => { try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { stdio: 'ignore' }); } catch {} };

async function startServer() {
  free();
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite timeout')), 60000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('Local:')) { clearTimeout(t); setTimeout(res, 400); }
    });
    p.on('exit', (c) => { clearTimeout(t); rej(new Error(`vite exited ${c}`)); });
  });
  return p;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let exitCode = 0;
  try {
    await page.goto(`http://localhost:${PORT}/?quality=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 90000 });
    await page.evaluate(() => window.__VESSEL_API.intro.skip());
    await page.waitForTimeout(300);

    // The capsule this file measures with must be the capsule the game runs.
    const live = await page.evaluate(() => {
      const m = window.__VESSEL_API.TUNING.movement;
      return {
        stand: (m.capsuleHalfHeight + m.capsuleRadius) * 2,
        crouch: (m.crouchHalfHeight + m.capsuleRadius) * 2,
        slopeCos: Math.cos((m.maxSlopeDegrees * Math.PI) / 180),
      };
    });
    for (const [name, mine, theirs] of [
      ['stand height', STAND_HEIGHT, live.stand],
      ['crouch height', CROUCH_HEIGHT, live.crouch],
      ['slope limit', WALKABLE_NORMAL_Y, live.slopeCos],
    ]) {
      if (Math.abs(mine - theirs) > 1e-6) {
        throw new Error(
          `${name} drifted from TUNING: this file says ${mine.toFixed(4)}, the game says ${theirs.toFixed(4)}`
        );
      }
    }

    // ---- 1 & 2: ground presence and continuity -------------------------
    const ground = await page.evaluate((segments) => {
      const api = window.__VESSEL_API;
      const ph = api.engine.resolve('physics');
      const DOWN = { x: 0, y: -1, z: 0 };
      // Probe from just above the EXPECTED floor, not from high above.
      // Every zone in this chapter is enclosed, so a ray dropped from y=60
      // finds the cave ceiling and reports it as ground — which is how the
      // first version of this audit concluded the Green Vein floor was 23m
      // out and the descent had a 7m step in it.
      const probe = (x, z, expectY) => {
        const from = expectY + 2.5;
        const hit = ph.raycast({ x, y: from, z }, DOWN, 12);
        return hit ? from - hit.distance : null;
      };

      const holes = [];
      const steps = [];
      const samples = [];
      for (const seg of segments) {
        const [x0, z0] = seg.from;
        const [x1, z1] = seg.to;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(2, Math.ceil(len / 1.0));
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const cx = x0 + (x1 - x0) * t;
          const cz = z0 + (z1 - z0) * t;
          // centreline plus two lateral offsets
          const expectY = seg.y0 + (seg.y1 - seg.y0) * t;
          const lateral = [0, -seg.halfWidth * 0.6, seg.halfWidth * 0.6];
          const ys = [];
          for (const o of lateral) {
            // offset perpendicular to the segment
            const dx = (z1 - z0) / (len || 1);
            const dz = -(x1 - x0) / (len || 1);
            const y = probe(cx + dx * o, cz + dz * o, expectY);
            ys.push(y);
            if (y === null) holes.push({ zone: seg.zone, x: +(cx + dx * o).toFixed(1), z: +(cz + dz * o).toFixed(1) });
          }
          const centre = ys[0];
          samples.push({ zone: seg.zone, x: +cx.toFixed(1), z: +cz.toFixed(1), y: centre });
          if (seg.continuous !== false && prev !== null && centre !== null) {
            const rise = centre - prev;
            if (rise > 0.55) {
              steps.push({ zone: seg.zone, x: +cx.toFixed(1), z: +cz.toFixed(1), rise: +rise.toFixed(2) });
            }
          }
          prev = centre;
        }
      }
      return { holes, steps, sampleCount: samples.length };
    }, PATH_SEGMENTS);

    console.log('\n──── 1. ground under the critical path ────');
    console.log(`  ${ground.sampleCount} samples`);
    if (ground.holes.length) {
      exitCode = 1;
      console.log(`  ✗ ${ground.holes.length} sample(s) with NO ground beneath:`);
      for (const h of ground.holes.slice(0, 10)) console.log(`      ${h.zone.padEnd(12)} x=${h.x} z=${h.z}`);
    } else {
      console.log('  ✓ ground everywhere');
    }

    console.log('\n──── 2. continuity (steps the capsule cannot climb) ────');
    if (ground.steps.length) {
      exitCode = 1;
      console.log(`  ✗ ${ground.steps.length} step(s) above the 0.55m step offset:`);
      for (const s of ground.steps.slice(0, 12)) {
        console.log(`      ${s.zone.padEnd(12)} x=${s.x} z=${s.z}  rise ${s.rise}m`);
      }
    } else {
      console.log('  ✓ no unclimbable steps along the path');
    }

    // ---- 3: spawns, checkpoints, warps ---------------------------------
    // Behavioural, not geometric: put the capsule there, run the simulation,
    // and see where it ends up. A ray-based "is this buried" proxy fires on
    // every ceiling in an indoor game — this asks the question that actually
    // matters, which is whether a player spawned here can stand up and walk.
    const spawns = await page.evaluate(() => {
      const api = window.__VESSEL_API;
      const engine = window.__VESSEL;

      const points = [];
      for (const cp of api.checkpoints.checkpoints.values()) {
        points.push({ name: `checkpoint:${cp.id}`, p: cp.position });
      }
      // Only the waypoints a player is ever PLACED at. The rest of the table
      // is landmarks the companion paths through and the camera frames —
      // `pagodaWell` is the centre of the well, which the candi occupies, and
      // "you cannot stand inside the temple" is not a defect.
      const SPAWNABLE = new Set([
        'embodiment', 'descentTop', 'descentBottom', 'greenVein',
        'sword', 'poolApproach', 'starChamber', 'pagodaFloor',
      ]);
      for (const [name, wp] of Object.entries(window.__VESSEL_WAYPOINTS ?? {})) {
        if (!SPAWNABLE.has(name)) continue;
        // Debug warps land at waypoint + 0.5, which is the position a player
        // actually arrives at.
        points.push({ name: `waypoint:${name}`, p: { x: wp.x, y: wp.y + 0.5, z: wp.z } });
      }

      const out = [];
      engine.setPaused(true);
      for (const { name, p } of points) {
        api.player.respawn({ x: p.x, y: p.y, z: p.z }, Math.PI);
        for (let i = 0; i < 90; i++) engine.stepOnce(); // 1.5s to settle
        const q = api.player.position;
        out.push({
          name,
          settledY: +q.y.toFixed(2),
          fell: +(p.y - q.y).toFixed(2),
          shoved: +Math.hypot(q.x - p.x, q.z - p.z).toFixed(2),
          grounded: api.player.grounded,
        });
      }
      engine.setPaused(false);
      return out;
    });

    console.log('\n──── 3. can the capsule stand where it spawns? ────');
    for (const s of spawns) {
      // Falling more than a couple of metres means it spawned over a hole;
      // being shoved sideways means it spawned inside something and got
      // squeezed out; not grounded after 1.5s means it never landed.
      const problems = [];
      if (s.fell > 2.5) problems.push(`fell ${s.fell}m`);
      if (s.shoved > 1.0) problems.push(`shoved ${s.shoved}m sideways`);
      if (!s.grounded) problems.push('never landed');
      if (problems.length) exitCode = 1;
      console.log(
        `  ${problems.length ? '✗' : '✓'} ${s.name.padEnd(22)} `
        + (problems.length ? problems.join(', ') : `settled at y=${s.settledY}`)
      );
    }

    // ---- 4: does collision agree with the height function? -------------
    const agreement = await page.evaluate(() => {
      const api = window.__VESSEL_API;
      const ph = api.engine.resolve('physics');
      const DOWN = { x: 0, y: -1, z: 0 };
      const fn = (z) => -14 - ((2 - z) / 56) * 7.6; // GREEN_VEIN_FLOOR
      const rows = [];
      let worst = 0;
      for (let z = 0; z >= -52; z -= 2) {
        // From just above the expected floor — see the note on `probe` above.
        const from = fn(z) + 2.5;
        const hit = ph.raycast({ x: 0, y: from, z }, DOWN, 12);
        if (!hit) { rows.push({ z, collider: null, fn: +fn(z).toFixed(2), delta: null }); continue; }
        const y = from - hit.distance;
        const d = y - fn(z);
        worst = Math.max(worst, Math.abs(d));
        rows.push({ z, collider: +y.toFixed(2), fn: +fn(z).toFixed(2), delta: +d.toFixed(2) });
      }
      return { rows, worst: +worst.toFixed(2) };
    });

    // ---- 5: the grid sweep --------------------------------------------
    // Checks 1 and 2 sample a CENTRELINE. A hole two metres to the left of it
    // is invisible to them, and two metres to the left of the line is exactly
    // where players go. This walks a grid over each zone's walkable footprint.
    //
    // ## What this check asks, and what it used to ask
    //
    // The first version asked "does the collider sit where its mesh is drawn",
    // aimed at the 0.55m Green Vein drift. That question is now a tautology:
    // `ZoneBuilder.box()` and `ramp()` register the collider from the *same*
    // size, position and quaternion as the mesh, and there is no longer a
    // single `solid()` trimesh in the chapter. Agreement is structural. The
    // subtraction is kept — cheap, and it is the tripwire for the day someone
    // hand-places a collider or brings a trimesh back — but it cannot be the
    // point of the sweep.
    //
    // The question that is worth asking on a grid is **can the capsule stand
    // here**, which needs headroom, not just an upward-facing face. Three bugs
    // in the old version all reduce to not asking it:
    //
    //   - "step down until the normal faces up" accepts the TOP of a ceiling
    //     slab, because that face does face up. Green Vein roofs sit at y≈−4.9
    //     against a probe origin of y−4, so a roof was the first hit in most
    //     columns of the zone.
    //   - `THREE.Intersection.normal` is in OBJECT-LOCAL space — three does not
    //     transform it in `Mesh.raycast`. Every `ramp()` is rotated, and a
    //     box's local +Y face reads (0,1,0) whichever way it actually points,
    //     so the mesh-side walkable filter was accepting walls.
    //   - non-colliding decoration was being read as "the visual". The Green
    //     Vein water planes are lifted +0.11 over the floor by design; the
    //     harness reported that authored lift as collider drift.
    //
    // Requiring clearance fixes the first, the normal matrix fixes the second,
    // and `userData.noCollide` — which ZoneBuilder now sets at the one place
    // that knows whether a collider was registered — fixes the third.
    const grid = await page.evaluate(({ zones, WALKABLE_NORMAL_Y, STAND_H, CROUCH_H }) => {
      const api = window.__VESSEL_API;
      const ph = api.engine.resolve('physics');
      const THREE = api.THREE;
      const DOWN = { x: 0, y: -1, z: 0 };
      const UP = { x: 0, y: 1, z: 0 };

      const caster = new THREE.Raycaster();
      const origin = new THREE.Vector3();
      const dir = new THREE.Vector3(0, -1, 0);
      const nrm = new THREE.Vector3();
      const nmat = new THREE.Matrix3();

      // Zone visibility gating hides everything the player is not near, so the
      // sweep would compare a collider against a mesh that is switched off.
      // Force the whole chapter visible for the duration.
      for (const g of api.chapter.ctx.groups.values()) g.visible = true;

      // Only the level, and only the parts of it that collide. Walking the
      // whole scene would pull in the player capsule, the dummies and the
      // pigeon — all of which move during the sweep — and `intersectObject(
      // scene, true)` also hits Sprites, whose raycast() wants a camera this
      // audit has no business supplying.
      // Everything drawn that is not explicitly decoration.
      //
      // Walking the zone groups alone was not enough. Three sets of colliders
      // live outside `ZoneBuilder` and so outside those groups: the arena basin
      // (`StarChamberArena`, and the one remaining TRIMESH in the chapter — the
      // only surface where collider and mesh genuinely *can* drift, so omitting
      // it omitted the only place this comparison still earns its keep), the
      // training dummies, and the fog gate barrier. Their colliders are real —
      // you bump into all of them — so a sweep that saw the collider and not
      // the mesh reported each of them as level drift.
      //
      // `visible` is part of the filter because the boss stub is a real mesh
      // that is switched off until the gate is entered, and three raycasts
      // against hidden geometry regardless.
      const playerRoot = api.player.root;
      const meshes = [];
      api.renderer.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || o.userData.noCollide || o.name === 'inkEdges') return;
        // The player's own body is not level geometry, and it is standing
        // somewhere inside the footprint being swept.
        for (let p = o; p; p = p.parent) if (p === playerRoot) return;
        meshes.push(o);
      });

      // Combat props are not level geometry.
      //
      // A training dummy registers a 0.74m BOX collider around a 0.72m-diameter
      // CAPSULE visual, and no box will ever agree with a dome: away from the
      // axis the capsule's surface is too steep to stand on (normal.y 0.27
      // against a 0.62 limit) while the box top is flat and standable all the
      // way into its corners. That is a real 25cm difference and it is worth
      // knowing about — see DECISIONS D64 — but it is a property of a debug prop
      // that can be moved or deleted, not of the chapter, and this sweep's
      // contract is the chapter.
      const skip = (api.dummies ?? []).map((d) => d.collider).filter(Boolean);

      const mismatched = [];
      const crouchOnly = [];
      const perZone = {};
      let sampled = 0;
      let noRoom = 0;

      /**
       * Headroom above the surface at `y`, or null if a body cannot be there.
       *
       * A ray up from just above the surface. Coming back at distance 0 means
       * the origin is inside solid geometry — which is what a grid column
       * passing through a wall looks like, and the sweep's footprints are
       * rectangles while the rooms are not. Expected, not a defect, so it is
       * counted and skipped rather than reported.
       */
      const standableHead = (x, y, z) => {
        const room = ph.raycast({ x, y: y + 0.05, z }, UP, STAND_H, { exclude: skip });
        const head = room ? 0.05 + room.distance : Infinity;
        if (head < CROUCH_H) { noRoom++; return null; }
        return head;
      };

      // Nudge the lattice off the authored coordinates.
      //
      // Zone geometry is placed on round numbers and the grid steps in round
      // numbers, so samples land exactly on box faces — and a ray through the
      // precise edge of a box is a coin flip that Rapier and three do not have
      // to call the same way. The Green Vein ceiling segments overlap by 1m and
      // z=-26.5 is exactly the far face of one of them, which is the entire
      // source of the "Δ0.76m across many x" row. The capsule has a 0.32m
      // radius and can never balance on a knife edge, so a tangency is a
      // sampling artifact rather than something a player can stand on.
      const EPS = 0.037;

      for (const z of zones) {
        for (let x = z.minX + EPS; x <= z.maxX; x += z.step) {
          for (let zz = z.minZ + EPS; zz <= z.maxZ; zz += z.step) {
            // Find the first surface the capsule could actually occupy: an
            // upward-facing face with a body's worth of air above it. A roof's
            // top face passes the normal test and fails this one, which is the
            // whole difference.
            let py = null;
            let head = 0;
            // Start inside the room, just above the highest the floor gets, and
            // stop just below the lowest. A surface outside that band is not
            // this zone's floor — it is a roof, a ledge underside, or the next
            // zone showing through.
            const top = z.floorMax + 2.5;
            const bottom = z.floorMin - 0.5;
            let cursor = top;
            const range = top - bottom;
            for (let attempt = 0; attempt < 24; attempt++) {
              const remaining = cursor - bottom;
              if (remaining <= 0) break;
              // `solid: false` is what makes stepping down work at all.
              //
              // With Rapier's default (`solid: true`) a ray whose origin is
              // INSIDE a shape reports a hit at distance 0. So on ducking 5cm
              // under a ceiling's top face the probe was still inside the
              // 1.2m slab, got distance 0 back, ducked another 5cm, and burned
              // every attempt marching through the roof it was standing on —
              // which is why this sweep spent its whole life auditing ceiling
              // tops and never once reached a floor. `solid: false` reports the
              // exit face instead, so one step leaves the slab.
              const hit = ph.raycast({ x, y: cursor, z: zz }, DOWN, remaining, { solid: false, exclude: skip });
              if (!hit) break;
              const y = cursor - hit.distance;
              // In band, or it is not this zone's floor. The probe already
              // starts inside the room, but 2.5m of margin above the highest
              // the floor gets is enough to catch the top of the fog gate
              // barrier, which is a 4.2m collider you are never meant to be on.
              if (hit.normal.y > WALKABLE_NORMAL_Y && y <= z.floorMax && y >= z.floorMin) {
                const c = standableHead(x, y, zz);
                if (c !== null) { py = y; head = c; break; }
              }
              cursor = y - 0.05; // duck under this surface and keep going
            }
            if (py === null) continue; // no standable surface in this column,
                                       // which most of a bounding box is
            sampled++;
            perZone[z.id] = (perZone[z.id] ?? 0) + 1;
            if (head < STAND_H) {
              crouchOnly.push({ zone: z.id, x: +x.toFixed(1), z: +zz.toFixed(1), head: +head.toFixed(2) });
            }

            // Visual vs collider, at the same column and on the same terms.
            // World-space normals on both sides, or the comparison is noise.
            origin.set(x, top, zz);
            caster.set(origin, dir);
            caster.near = 0;
            caster.far = range;
            const vhit = caster.intersectObjects(meshes, false).find((h) => {
              if (!h.normal) return false;
              nrm.copy(h.normal).applyNormalMatrix(nmat.getNormalMatrix(h.object.matrixWorld));
              return nrm.normalize().y > WALKABLE_NORMAL_Y && h.point.y <= py + 0.5;
            });
            if (vhit) {
              const d = Math.abs(vhit.point.y - py);
              if (d > 0.05) {
                mismatched.push({ zone: z.id, x: +x.toFixed(1), z: +zz.toFixed(1), delta: +d.toFixed(2) });
              }
            }
          }
        }
      }
      return { sampled, mismatched, crouchOnly, perZone, noRoom };
    }, {
      zones: GRID_ZONES, WALKABLE_NORMAL_Y, STAND_H: STAND_HEIGHT, CROUCH_H: CROUCH_HEIGHT,
    });

    console.log('\n──── 5. grid sweep (standable ground, collider vs visual) ────');
    console.log(`  ${grid.sampled} standable samples across ${GRID_ZONES.length} zones`);
    for (const z of GRID_ZONES) {
      const n = grid.perZone[z.id] ?? 0;
      if (n === 0) exitCode = 1;
      console.log(`      ${n === 0 ? '✗' : '·'} ${z.id.padEnd(12)} ${String(n).padStart(4)} standable`);
    }
    if (grid.mismatched.length) {
      exitCode = 1;
      console.log(`  ✗ ${grid.mismatched.length} sample(s) where the collider and the mesh disagree by >5cm:`);
      for (const m of grid.mismatched.slice(0, 10)) {
        console.log(`      ${m.zone.padEnd(12)} x=${m.x} z=${m.z}  Δ ${m.delta}m`);
      }
    } else {
      console.log('  ✓ every collider sits where its mesh is drawn');
    }
    // Information, not verdicts. The crawl is authored, so crouch-only should
    // be a small cluster in the Descent and nothing anywhere else; the rejected
    // counts are the sweep's rectangles overhanging rooms that are not
    // rectangular, plus the oculus, which is the one place open to the sky.
    const crouchZones = [...new Set(grid.crouchOnly.map((c) => c.zone))];
    console.log(`  · ${grid.crouchOnly.length} crouch-only sample(s)`
      + (crouchZones.length ? ` in ${crouchZones.join(', ')}` : ''));
    console.log(`  · ${grid.noRoom} column(s) skipped: inside geometry, no room for a body`);

    // ---- 6: wedges ------------------------------------------------------
    // A point where the capsule cannot move in ANY direction is a place the
    // player gets stuck, and it is the bug they will actually hit. Geometry
    // checks cannot find these; only running the controller can.
    const wedges = await page.evaluate((pts) => {
      const api = window.__VESSEL_API;
      const engine = window.__VESSEL;
      const stuck = [];
      const input = api.engine.resolve('input');
      // InputSystem runs at STAGE.INPUT, before the character reads the stick,
      // so anything written here is overwritten before it is used. Disabling
      // it makes `move` a value the harness owns for the duration.
      input.enabled = false;
      engine.setPaused(true);
      for (const p of pts) {
        api.player.respawn({ x: p.x, y: p.y, z: p.z }, 0);
        for (let i = 0; i < 40; i++) engine.stepOnce(); // settle
        const start = api.player.position.clone();
        if (!api.player.grounded) continue; // never landed: check 1's problem
        let best = 0;
        for (let d = 0; d < 8; d++) {
          const a = (d / 8) * Math.PI * 2;
          api.player.respawn({ x: start.x, y: start.y + 0.1, z: start.z }, a);
          for (let i = 0; i < 40; i++) {
            input.move.set(Math.sin(a), Math.cos(a));
            input.moveMagnitude = 1;
            engine.stepOnce();
          }
          best = Math.max(best, api.player.position.distanceTo(start));
        }
        if (best < 0.5) stuck.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), moved: +best.toFixed(2) });
      }
      engine.setPaused(false);
      input.enabled = true;
      return stuck;
    }, WEDGE_POINTS);

    console.log('\n──── 6. wedges (places the capsule cannot leave) ────');
    console.log(`  ${WEDGE_POINTS.length} points probed in 8 directions each`);
    if (wedges.length) {
      exitCode = 1;
      console.log(`  ✗ ${wedges.length} point(s) the capsule could not move 0.5m from:`);
      for (const w of wedges.slice(0, 8)) console.log(`      x=${w.x} z=${w.z}  best ${w.moved}m`);
    } else {
      console.log('  ✓ no wedges — the capsule can leave everywhere it can stand');
    }

    console.log('\n──── 4. Green Vein: collision vs GREEN_VEIN_FLOOR ────');
    console.log(`  worst disagreement: ${agreement.worst}m`);
    const bad = agreement.rows.filter((r) => r.delta === null || Math.abs(r.delta) > 0.2);
    if (bad.length) {
      console.log(`  ${bad.length} of ${agreement.rows.length} samples off by more than 0.20m:`);
      for (const r of bad.slice(0, 8)) {
        console.log(`      z=${String(r.z).padStart(4)}  collider ${String(r.collider).padStart(7)}  fn ${String(r.fn).padStart(7)}  Δ ${r.delta}`);
      }
    } else {
      console.log('  ✓ collision matches the height function within 0.20m');
    }

    if (errors.length) {
      exitCode = 1;
      console.log(`\n✗ ${errors.length} console error(s):`);
      for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
    }
    console.log(exitCode === 0 ? '\n✓ collision audit clean\n' : '\n✗ collision audit found problems\n');
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    free();
  }
  return exitCode;
}

process.exit(await main());
