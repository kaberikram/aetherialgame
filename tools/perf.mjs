#!/usr/bin/env node
/**
 * perf.mjs — what a frame costs, in the only terms this container can measure.
 *
 * There is no GPU here. Everything renders through SwiftShader, so wall-clock
 * frame time measured in this container is meaningless and this tool does not
 * report it. What it reports instead is hardware-independent and is what the
 * frame time is actually made of:
 *
 *   scene passes    how many times the whole scene's geometry is submitted.
 *                   A shadow-casting PointLight is SIX. GTAO's normal
 *                   pre-pass is one. A transmission material's backdrop is
 *                   one. The beauty pass is one.
 *   pixels/frame    resolution x pixelRatio^2, projected onto a real M1
 *                   display rather than this 800x500 headless window.
 *   draw calls      three's own counter, exact.
 *   triangles       likewise.
 *
 * Multiply the first two together and you have the fill cost; the last two are
 * the CPU submission cost. Both budgets are in PROJECT.md: under 1,500 draw
 * calls, under 4ms CPU.
 *
 * Because `ultra` is byte-for-byte what `high` used to be, running this at
 * both levels IS the before/after for the whole performance pass:
 *
 *   node tools/perf.mjs                      # ultra vs high, every zone
 *   node tools/perf.mjs --quality high       # one level
 *   node tools/perf.mjs --only starChamber
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
const PORT = Number(flag('port', 5341));
const LEVELS = flag('quality', null) ? [flag('quality')] : ['ultra', 'high'];
const ONLY = flag('only', null);

/**
 * The reference display: a 13" M1 MacBook Pro's default scaled resolution,
 * which reports 1440x900 logical at devicePixelRatio 2. That is the machine in
 * the request, and it is the pessimistic case for anything fill-bound — an
 * uncapped renderer draws 2880x1800 = 5.2 million pixels through every
 * fullscreen pass in the chain.
 */
const M1 = { width: 1440, height: 900, dpr: 2 };

/** One stop per zone, placed by the same waypoints the debug warps use. */
const STOPS = [
  { name: 'descent', waypoint: 'descentBottom', facing: Math.PI },
  { name: 'greenVein', waypoint: 'greenVein', facing: Math.PI },
  { name: 'poolApproach', waypoint: 'poolApproach', facing: Math.PI },
  { name: 'starChamber', waypoint: 'starChamber', facing: Math.PI },
  { name: 'pagodaWell', waypoint: 'pagodaFloor', facing: -Math.PI / 2 },
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

const fmt = (n) => n.toLocaleString('en-US');

async function measure(browser, level) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:${PORT}/?quality=${level}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 120000 });
  // Skip the void. It hides the whole chapter group, so measuring inside it
  // measures an empty scene — and it is also where the shadow bake happens.
  await page.evaluate(() => window.__VESSEL_API.intro.skip());

  const rows = [];
  for (const stop of STOPS) {
    if (ONLY && ONLY !== stop.name) continue;
    const row = await page.evaluate(async ({ stop, M1 }) => {
      const api = window.__VESSEL_API;
      const wp = window.__VESSEL_WAYPOINTS[stop.waypoint];
      api.player.respawn(wp.clone().setY(wp.y + 0.5), stop.facing);
      api.cameraRig.snap({ yaw: stop.facing + Math.PI });

      // Let the frame actually happen. Counting draw calls before the first
      // render at a new pose counts the previous pose, and on software GL a
      // single Star Chamber frame is slow enough that a wall-clock wait can
      // contain zero of them — so wait on rendered frames, not on time.
      await new Promise((res) => {
        let n = 0;
        const tick = () => { (++n >= 4) ? res() : requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });

      const s = api.renderer.renderStats();
      const cap = api.quality.pixelRatioCap ?? 2;
      const pr = Math.min(M1.dpr, cap);
      return {
        zone: stop.name,
        scenePasses: s.scenePasses,
        shadowLights: s.shadowLights,
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        m1PixelRatio: pr,
        m1Pixels: Math.round(M1.width * pr) * Math.round(M1.height * pr),
      };
    }, { stop, M1 });
    rows.push(row);
  }

  const quality = await page.evaluate(() => {
    const q = window.__VESSEL_API.quality;
    return { name: q.name, pixelRatioCap: q.pixelRatioCap, ao: q.ao, aoScale: q.aoScale,
      liveShadows: q.liveShadows, refractWater: q.refractWater, volumetricSteps: q.volumetricSteps };
  });

  await page.close();
  return { level, quality, rows, errors };
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  let exitCode = 0;
  try {
    const results = [];
    for (const level of LEVELS) {
      process.stdout.write(`› ${level} … `);
      results.push(await measure(browser, level));
      process.stdout.write('done\n');
    }

    console.log(`\nReference display: ${M1.width}×${M1.height} @ DPR ${M1.dpr} (13" M1 MacBook Pro)\n`);

    for (const r of results) {
      const q = r.quality;
      console.log(`── ${r.level} ──  dprCap ${q.pixelRatioCap} · ao ${q.ao ? `×${q.aoScale ?? 1}` : 'off'} · `
        + `shadows ${q.liveShadows ? 'live' : 'baked'} · refract ${q.refractWater ? 'on' : 'off'} · `
        + `vol ${q.volumetricSteps} steps`);
      console.log('   zone            passes   draws    tris     px/frame');
      for (const row of r.rows) {
        console.log(`   ${row.zone.padEnd(15)} ${String(row.scenePasses).padStart(5)}`
          + `${String(fmt(row.drawCalls)).padStart(8)}${String(fmt(row.triangles)).padStart(10)}`
          + `${String(fmt(row.m1Pixels)).padStart(13)}`);
      }
      if (r.errors.length) {
        exitCode = 1;
        console.log(`   page errors: ${r.errors.join(' | ')}`);
      }
      console.log('');
    }

    if (results.length === 2) {
      const [before, after] = results;
      console.log('── before → after ──  (ultra is byte-for-byte the old `high`)');
      console.log('   zone            passes            fill (passes × px)');
      for (const a of after.rows) {
        const b = before.rows.find((x) => x.zone === a.zone);
        if (!b) continue;
        const fillB = b.scenePasses * b.m1Pixels;
        const fillA = a.scenePasses * a.m1Pixels;
        console.log(`   ${a.zone.padEnd(15)} ${String(b.scenePasses).padStart(3)} → ${String(a.scenePasses).padEnd(4)}`
          + `${(b.scenePasses / a.scenePasses).toFixed(1)}×`.padStart(7)
          + `      ${fmt(fillB)} → ${fmt(fillA)}   ${(fillB / fillA).toFixed(1)}×`);
      }
      console.log('\nFrame time is NOT measured here — there is no GPU in this container.');
      console.log('Run the game with ?bench on the M1 for that number.');
    }

    const over = results.flatMap((r) => r.rows).filter((row) => row.drawCalls > 1500);
    if (over.length) {
      exitCode = 1;
      console.log(`\n✗ over the 1,500 draw-call budget: ${over.map((r) => `${r.zone} ${r.drawCalls}`).join(', ')}`);
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    free();
  }
  process.exit(exitCode);
}

main();
