#!/usr/bin/env node
/**
 * rubric.mjs — deterministic frame capture for the critic pass.
 *
 * The critic agent reviews rendered frames against the concept boards. That is
 * only meaningful if the frames are the same frames every run: a critic
 * comparing whatever the camera happened to be pointing at is reviewing noise,
 * and "it got worse" cannot be distinguished from "it moved".
 *
 * So every vantage below pins the game state AND the camera pose, and each one
 * produces three images:
 *
 *   <name>.png             the frame, at 1440p
 *   <name>-gray.png        desaturated — the rubric's "does it read in
 *                          grayscale" line, answered mechanically
 *   <name>-silhouette.png  the frame at 10% height — the squint test for
 *                          silhouette readability
 *
 * Plus one paused frame per boss move at its peak wind-up (frame numbers come
 * from combat/data/bossMoves.js, so they are exact), and the Star Chamber
 * before/light/dark triptych from one identical pose.
 *
 *   node tools/rubric.mjs                  # everything
 *   node tools/rubric.mjs --only greenVein # one zone
 *   node tools/rubric.mjs --list           # names only, no browser
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'captures', 'rubric');
const PORT = 5197;
const CHROME = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => existsSync(p));

/**
 * 1600×900 by default, not 1440p.
 *
 * The critic judges composition, value structure, palette and silhouette, and
 * all four survive the smaller frame intact. What does not survive 1440p is
 * the harness: this container has no GPU, and in the Star Chamber a single
 * software-rasterised 1440p frame takes tens of seconds — long enough that the
 * fixed-step simulation, which advances at most five steps per rendered frame,
 * cannot get through a 3.4-second animation before the run times out.
 *
 * The draw-call and triangle budgets this reports are resolution-independent,
 * so nothing measured here is weakened by the smaller frame. Pass --size 2560
 * for a full-resolution pass when there is time for it.
 */
const [WIDTH, HEIGHT] = (() => {
  const w = Number(process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 1600);
  return [w, Math.round(w * 9 / 16)];
})();
const BUDGET = { drawCalls: 1500 };

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d;
};

/**
 * A vantage pins state and camera.
 *
 * `setup` runs in the page with `api` bound; `camera` is world-space
 * {pos, look, fov}; `settle` is how long to let animation and the zone
 * crossfade land before the shutter. `board` names the concept reference the
 * critic compares against.
 */
const VANTAGES = [
  {
    name: 'void-corpse',
    zone: 'void',
    board: null,
    note: 'Beat 1. The wisp, the corpse, the pigeon. Nothing else exists.',
    settle: 5000,
    useGameCamera: true,
  },
  {
    name: 'descent-tunnel',
    zone: 'descent',
    board: null,
    note: 'Beat 3. Traversal taught by geometry — the steps must read as steps.',
    setup: (api) => api.player.respawn({ x: 0, y: -1.0, z: 22 }, Math.PI),
    camera: { pos: [7, 1.5, 22], look: [0, -8, 6], fov: 52 },
  },
  {
    name: 'greenvein-channels',
    zone: 'greenVein',
    board: 'green-vein',
    note: 'The jade water is the only light. The readable path is the lit path.',
    setup: (api) => api.player.respawn({ x: -2, y: -15.8, z: -8 }, Math.PI),
    camera: { pos: [-4, -13.6, -2], look: [1, -18.0, -30], fov: 55 },
  },
  {
    name: 'greenvein-sword',
    zone: 'greenVein',
    board: null,
    note: 'Beat 5. No glow, no marker. A tool someone else was using.',
    setup: (api) => api.player.respawn({ x: 9.5, y: -18.2, z: -26 }, Math.PI),
    camera: { pos: [10.2, -17.0, -26.4], look: [7.2, -18.3, -30], fov: 44 },
  },
  {
    name: 'poolapproach-gateway',
    zone: 'starChamber',
    board: 'star-chamber',
    note: 'First view of the chamber, framed by the ruined gate. Scale shot.',
    setup: (api) => api.player.respawn({ x: 0, y: -20.4, z: -50 }, Math.PI),
    camera: { pos: [0, -17.4, -46], look: [0, -22.5, -76], fov: 50 },
  },
  {
    name: 'starchamber-dais',
    zone: 'starChamber',
    board: 'star-chamber',
    note: 'The suspended star over the flooded dais. One light doing all the work.',
    setup: (api) => api.player.respawn({ x: 0, y: -22.6, z: -66 }, Math.PI),
    camera: { pos: [0, -19.5, -62], look: [0, -21.5, -80], fov: 55 },
  },
  {
    name: 'pagoda-scale',
    zone: 'pagodaWell',
    board: 'pagoda',
    note: 'The board ratio: a person is a few pixels against the temple.',
    setup: (api) => api.player.respawn({ x: 22, y: -24.6, z: -112 }, -Math.PI / 2),
    camera: { pos: [30, -20, -104], look: [0, -10, -126], fov: 56 },
  },
  {
    name: 'pagoda-oculus',
    zone: 'pagodaWell',
    board: 'pagoda',
    note: 'The only daylight in the chapter, and the shaft it falls through.',
    setup: (api) => api.player.respawn({ x: 17, y: -24.6, z: -126 }, -Math.PI / 2),
    camera: { pos: [19, -23, -118], look: [2, 12, -126], fov: 60 },
  },
];

/** The wing choice: same room, same pose, three states. */
const TRIPTYCH = {
  camera: { pos: [0, -18.5, -63], look: [0, -20.5, -80], fov: 55 },
  settle: 2600,
};

const BOSS_MOVES = ['lunge', 'sweep', 'delayed', 'slam', 'skitter'];

// --------------------------------------------------------------------------

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

/** Places the camera and stops the rig from moving it back. */
async function poseCamera(page, cam) {
  await page.evaluate(({ pos, look, fov }) => {
    const api = window.__VESSEL_API;
    api.cameraRig.enabled = false;
    const c = api.renderer.camera;
    c.position.set(pos[0], pos[1], pos[2]);
    c.lookAt(look[0], look[1], look[2]);
    c.fov = fov;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }, cam);
}

/**
 * One screenshot, plus its two derived images.
 *
 * The derivatives are produced in-page from the same canvas rather than by
 * re-rendering, so all three are provably the same frame. The canvas is
 * created with preserveDrawingBuffer, which is what makes reading it back
 * legal here.
 */
async function capture(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });

  const derived = await page.evaluate(() => {
    const src = document.querySelector('canvas');
    const draw = (w, h, filter) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (filter) ctx.filter = filter;
      ctx.drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/png').split(',')[1];
    };
    return {
      gray: draw(src.width, src.height, 'grayscale(1)'),
      // 10% height: the squint test. If the silhouette does not survive this,
      // it does not survive being 40 metres away either.
      silhouette: draw(Math.round(src.width * 0.1), Math.round(src.height * 0.1), null),
    };
  });

  await writeFile(path.join(OUT, `${name}-gray.png`), Buffer.from(derived.gray, 'base64'));
  await writeFile(path.join(OUT, `${name}-silhouette.png`), Buffer.from(derived.silhouette, 'base64'));
}

/**
 * A booted page with the overlays hidden.
 *
 * The triptych gets a fresh one per branch rather than reloading: the wing
 * choice is irreversible by design and GameState refuses a second resolution
 * of the same slot, so each branch needs a clean process. Reloading in place
 * races with the dev server's HMR reconnect, which destroys the execution
 * context mid-evaluate.
 */
async function bootPage(browser) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  // Software GL at 1440p: a single frame in the busiest scene can take tens of
  // seconds, and the default 30s applies to the screenshot itself.
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* first load */ } });
  await page.goto(`http://localhost:${PORT}/?quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 90000 });
  await page.evaluate(() => {
    document.getElementById('debug-root').style.display = 'none';
    document.getElementById('ui-root').style.display = 'none';
  });
  return page;
}

async function perf(page) {
  return page.evaluate(() => ({
    drawCalls: window.__VESSEL_PERF.drawCalls,
    triangles: window.__VESSEL_PERF.triangles,
    programs: window.__VESSEL_PERF.programs,
  }));
}

async function main() {
  if (flag('list')) {
    for (const v of VANTAGES) console.log(`${v.name.padEnd(24)} ${v.zone.padEnd(13)} ${v.note}`);
    for (const m of BOSS_MOVES) console.log(`${`boss-${m}`.padEnd(24)} ${'starChamber'.padEnd(13)} peak wind-up`);
    for (const s of ['before', 'light', 'dark']) console.log(`${`star-${s}`.padEnd(24)} ${'starChamber'.padEnd(13)} wing choice triptych`);
    return 0;
  }

  const only = flag('only');
  // A filtered run refreshes its own shots and leaves the rest alone, so a
  // per-zone critic loop does not destroy the other zones' baseline.
  if (!only) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  console.log('› starting vite…');
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
    ],
  });
  const errors = [];
  browser.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  });

  const manifest = { capturedAt: new Date().toISOString(), width: WIDTH, height: HEIGHT, shots: [] };
  let exitCode = 0;
  let page;

  try {
    // The critic judges the rendered world, not the debug overlay or the HUD;
    // bootPage hides both.
    page = await bootPage(browser);
    console.log(`  engine ready · ${WIDTH}×${HEIGHT} · quality=high`);

    for (const v of VANTAGES) {
      if (only && only !== true && v.zone !== only && v.name !== only) continue;
      process.stdout.write(`› ${v.name} … `);

      if (v.name !== 'void-corpse') {
        await page.evaluate(() => {
          const api = window.__VESSEL_API;
          if (!api.intro.finished) api.intro.skip();
        });
        await page.waitForTimeout(300);
      }

      if (v.setup) {
        await page.evaluate(`(() => { const api = window.__VESSEL_API; (${v.setup.toString()})(api); })()`);
      }
      await page.evaluate((z) => window.__VESSEL_API.zones.snapTo(z), v.zone);
      await page.waitForTimeout(v.settle ?? 1400);
      if (v.camera) await poseCamera(page, v.camera);
      await page.waitForTimeout(500);

      await capture(page, v.name);
      const p = await perf(page);
      manifest.shots.push({ ...v, setup: undefined, camera: v.camera ?? null, perf: p });
      console.log(`${p.drawCalls} draws · ${(p.triangles / 1000).toFixed(1)}k tris`);
      if (p.drawCalls > BUDGET.drawCalls) {
        console.log(`  ✗ over the ${BUDGET.drawCalls} draw-call budget`);
        exitCode = 1;
      }
    }

    // ---- boss wind-ups: one paused frame per move, at the frame the data
    //      calls the tell. "Nameable from a single frame" is the rubric line.
    if (!only || only === true || only === 'boss' || only === 'starChamber') {
      await page.evaluate(() => {
        const api = window.__VESSEL_API;
        if (!api.intro.finished) api.intro.skip();
        api.encounter.forceStart();
      });
      await page.waitForTimeout(1200);

      for (const moveId of BOSS_MOVES) {
        process.stdout.write(`› boss-${moveId} … `);
        const pose = await page.evaluate((id) => {
          const api = window.__VESSEL_API;
          api.player.respawn({ x: 0, y: -22.6, z: -70 }, Math.PI);
          const info = api.boss.debugPose(id);
          api.engine.setPaused(true);
          return info;
        }, moveId);

        await poseCamera(page, { pos: [0, -20.4, -68], look: [0, -22.0, -80], fov: 46 });
        await page.waitForTimeout(400);
        await capture(page, `boss-${moveId}`);
        const p = await perf(page);
        manifest.shots.push({
          name: `boss-${moveId}`, zone: 'starChamber', board: null,
          note: `Peak wind-up, frame ${pose.frame}. Tell: ${pose.tell ?? '(none authored)'}`,
          perf: p,
        });
        await page.evaluate(() => window.__VESSEL_API.engine.setPaused(false));
        console.log(`frame ${pose.frame} · ${p.drawCalls} draws`);
      }
    }

    // ---- the triptych. Same room, same pose, before / light / dark.
    if (!only || only === true || only === 'starChamber' || only === 'wings') {
      // Close the main page first. Two 1440p WebGL contexts both running a
      // render loop on a software rasteriser starve each other badly enough
      // that the second one cannot finish navigating.
      await page.close();
      page = null;

      for (const branch of ['before', 'light', 'dark']) {
        process.stdout.write(`› star-${branch} … `);
        const bp = await bootPage(browser);
        try {
          await bp.evaluate(() => {
            const api = window.__VESSEL_API;
            api.intro.skip();
            api.encounter.forceWingChoice();
          });
          // The forms take 3.4s to rise before the choice is live at all.
          await bp.waitForFunction(
            () => window.__VESSEL_API.encounter.wingChoice?.phase === 'offered',
            { timeout: 60000 }
          );

          if (branch !== 'before') {
            // Walking into a form is how the choice is taken — there is no
            // menu, so the harness takes it the way a player does. Proximity
            // is measured against `home`, not the group's bobbing position.
            await bp.evaluate((b) => {
              const api = window.__VESSEL_API;
              const form = api.encounter.wingChoice.forms.find((f) => f.variant === b);
              const h = form.home;
              api.player.respawn({ x: h.x, y: h.y - 1.2, z: h.z }, Math.PI);
            }, branch);
            await bp.waitForFunction(
              () => window.__VESSEL_API.state.alignment !== 0,
              { timeout: 30000 }
            );
            await bp.waitForTimeout(TRIPTYCH.settle);
          }

          await poseCamera(bp, TRIPTYCH.camera);
          await bp.waitForTimeout(700);
          await capture(bp, `star-${branch}`);

          const p = await perf(bp);
          const readout = await bp.evaluate(() => {
            const api = window.__VESSEL_API;
            return {
              starIntensity: +api.arena.star.intensity.toFixed(2),
              ambientScale: +api.zones.reactionScale.toFixed(2),
              alignment: api.state.alignment,
            };
          });
          manifest.shots.push({
            name: `star-${branch}`, zone: 'starChamber', board: 'star-chamber',
            note: `Wing choice: ${branch}. star ${readout.starIntensity}, ambient ×${readout.ambientScale}, alignment ${readout.alignment}`,
            camera: TRIPTYCH.camera, perf: p,
          });
          console.log(`star ${readout.starIntensity} · ambient ×${readout.ambientScale} · alignment ${readout.alignment}`);
        } finally {
          await bp.close();
        }
      }
    }

    manifest.boards = {
      'green-vein': 'ConceptArtReferences/',
      'star-chamber': 'ConceptArtReferences/',
      pagoda: 'ConceptArtReferences/',
    };
    await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const peak = Math.max(...manifest.shots.map((s) => s.perf.drawCalls));
    const peakTris = Math.max(...manifest.shots.map((s) => s.perf.triangles));
    console.log('\n──────── RUBRIC CAPTURE ────────');
    console.log(`  shots          ${String(manifest.shots.length).padStart(9)}`);
    console.log(`  peak draws     ${String(peak).padStart(9)} / ${BUDGET.drawCalls}  ${peak <= BUDGET.drawCalls ? '✓' : '✗'}`);
    console.log(`  peak triangles ${String(peakTris).padStart(9)}`);
    console.log('────────────────────────────────');
    console.log('  note: software GL — draws and triangles are exact, frame time is not.\n');

    if (errors.length) {
      console.log(`✗ ${errors.length} console error(s):`);
      for (const e of [...new Set(errors)].slice(0, 8)) console.log(`  ${e.slice(0, 300)}`);
      exitCode = 1;
    } else {
      console.log('✓ no console errors');
    }
    console.log(`  captures/rubric/ — ${manifest.shots.length * 3} images + manifest.json`);
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    await page?.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
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
