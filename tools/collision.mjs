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
