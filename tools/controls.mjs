#!/usr/bin/env node
/**
 * controls.mjs — does each key move the player the way the camera says it should?
 *
 * This exists because "strafe feels inverted" is the kind of claim that is
 * easy to argue about and hard to settle. Reading the trigonometry gets you a
 * strong opinion; driving the key and measuring where the body actually went
 * gets you an answer.
 *
 * Method: pin the camera to a known yaw, hold one key, pump the fixed step,
 * and project the resulting world displacement onto the camera's own forward
 * and right vectors. W must move along +forward, D along +right, and so on.
 *
 * Camera right is `forward × up` — check it against the canonical three.js
 * camera, which looks down −Z with +Y up and has +X on its right:
 *   (0,0,−1) × (0,1,0) = (1,0,0)  ✓
 *
 * The simulation is pumped rather than waited on: this container has no GPU,
 * so wall-clock and simulation time diverge by more than an order of
 * magnitude and a test that slept would be measuring the rasteriser.
 *
 *   node tools/controls.mjs
 *   node tools/controls.mjs --yaw 1.9 --port 5321
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
const PORT = Number(flag('port', 5321));

/** Each key, and where it must take you in camera space. */
const CASES = [
  { key: 'KeyW', label: 'W  forward', forward: +1, right: 0 },
  { key: 'KeyS', label: 'S  back', forward: -1, right: 0 },
  { key: 'KeyD', label: 'D  right', forward: 0, right: +1 },
  { key: 'KeyA', label: 'A  left', forward: 0, right: -1 },
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
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  let exitCode = 0;
  try {
    // quality=low, not off: this measures physics and input rather than
    // pixels, but the camera applies look in update(), and `off` is a
    // different enough render path that it is not worth testing controls on a
    // configuration nobody plays.
    await page.goto(`http://localhost:${PORT}/?quality=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 90000 });
    await page.click('canvas').catch(() => {});

    await page.evaluate(() => {
      const api = window.__VESSEL_API;
      api.intro.skip();
    });
    await page.waitForTimeout(400);

    const pump = (n) => page.evaluate((count) => {
      const engine = window.__VESSEL;
      engine.setPaused(true);
      for (let i = 0; i < count; i++) engine.stepOnce();
      engine.setPaused(false);
    }, n);

    const yaw = Number(flag('yaw', 0.8));
    console.log(`\n  camera yaw pinned to ${yaw.toFixed(2)} rad, on the embodiment ledge\n`);

    const results = [];
    for (const c of CASES) {
      // Reset to the middle of the flat ledge each time, and re-pin the rig so
      // one case cannot contaminate the next.
      const basis = await page.evaluate((y) => {
        const api = window.__VESSEL_API;
        api.player.respawn({ x: 0, y: 0.6, z: 34 }, Math.PI);
        api.cameraRig.enabled = true;
        api.cameraRig.snap({ yaw: y });
        api.cameraRig.enabled = false; // freeze it: look input must not drift the basis

        // Read the basis straight off the camera's world matrix rather than
        // constructing vectors — column 2 is its local +Z, and a camera looks
        // down its own −Z.
        const e = api.renderer.camera.matrixWorld.elements;
        let fx = -e[8], fz = -e[10];
        const fl = Math.hypot(fx, fz);
        fx /= fl; fz /= fl;
        // right = forward × up, with up = (0,1,0), which works out to
        // (−fz, 0, fx). Sanity-check it against the canonical camera rather
        // than trusting the algebra: forward (0,0,−1) must give right
        // (+1,0,0), and −(−1)=+1 ✓. Getting this backwards makes the test
        // agree with the very bug it is supposed to catch.
        return { fwd: [fx, 0, fz], right: [-fz, 0, fx] };
      }, yaw);

      await pump(30); // let the respawn settle onto the ground

      const before = await page.evaluate(() => {
        const p = window.__VESSEL_API.player.position;
        return [p.x, p.y, p.z];
      });

      await page.keyboard.down(c.key);
      await pump(90); // 1.5s of simulation
      const after = await page.evaluate(() => {
        const p = window.__VESSEL_API.player.position;
        return [p.x, p.y, p.z];
      });
      await page.keyboard.up(c.key);
      await pump(10);

      const d = [after[0] - before[0], 0, after[2] - before[2]];
      const dist = Math.hypot(d[0], d[2]);
      const alongFwd = d[0] * basis.fwd[0] + d[2] * basis.fwd[2];
      const alongRight = d[0] * basis.right[0] + d[2] * basis.right[2];

      // Normalised so the verdict does not depend on how far it walked.
      const nf = dist > 0.05 ? alongFwd / dist : 0;
      const nr = dist > 0.05 ? alongRight / dist : 0;

      const ok = dist > 0.25
        && Math.abs(nf - c.forward) < 0.35
        && Math.abs(nr - c.right) < 0.35;
      if (!ok) exitCode = 1;

      results.push({ ...c, dist, nf, nr, ok });
    }

    console.log('  key          moved   along-fwd  along-right   expected        verdict');
    console.log('  ' + '─'.repeat(72));
    for (const r of results) {
      console.log(
        `  ${r.label.padEnd(12)} ${r.dist.toFixed(2).padStart(5)}m  `
        + `${r.nf.toFixed(2).padStart(8)}  ${r.nr.toFixed(2).padStart(10)}   `
        + `(${r.forward.toString().padStart(2)}, ${r.right.toString().padStart(2)})   `
        + `${r.ok ? '✓' : '✗ INVERTED/WRONG'}`
      );
    }
    console.log();

    // ---- look direction -------------------------------------------------
    // Mouse down must look DOWN and mouse right must turn RIGHT, with
    // `invertY: false`. This is the half of the dizziness that is not strafe.
    console.log('  look          moved        expected     verdict');
    console.log('  ' + '─'.repeat(52));

    const lookCase = async (label, dx, dy, expect) => {
      const before = await page.evaluate((y) => {
        const api = window.__VESSEL_API;
        // Look is applied in update(), and the rig does not run while paused —
        // so the strafe section's stepping must be undone before measuring it.
        api.engine.setPaused(false);
        api.player.respawn({ x: 0, y: 0.6, z: 34 }, Math.PI);
        api.cameraRig.enabled = true;
        api.cameraRig.snap({ yaw: y });
        api.engine.resolve('input').pointerLocked = true;
        const e = api.renderer.camera.matrixWorld.elements;
        return { fy: -e[9], theta: Math.atan2(-e[8], -e[10]) };
      }, Number(flag('yaw', 0.8)));

      await page.evaluate(({ mx, my }) => {
        // Synthetic, because a headless browser grants no real pointer lock.
        // It exercises the same handler a real mouse does.
        window.__frames = 0;
        const tick = () => { window.__frames++; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        for (let i = 0; i < 8; i++) {
          window.dispatchEvent(new MouseEvent('mousemove', { movementX: mx / 8, movementY: my / 8 }));
        }
      }, { mx: dx, my: dy });

      // Wait for RENDERED FRAMES, not wall-clock. Look is applied in update(),
      // and on a software rasteriser several hundred milliseconds can contain
      // no frames at all — which made this test report "inverted" for the
      // first case or two and "fine" for the rest, purely by warm-up order.
      await page.waitForFunction(() => window.__frames >= 4, { timeout: 60000 });

      const after = await page.evaluate(() => {
        const api = window.__VESSEL_API;
        const e = api.renderer.camera.matrixWorld.elements;
        return {
          fy: -e[9], theta: Math.atan2(-e[8], -e[10]),
          _rigEnabled: api.cameraRig.enabled,
          _paused: api.engine.paused,
          _locked: api.engine.resolve('input').pointerLocked,
          _pitch: +api.cameraRig.pitch.toFixed(4),
          _yaw: +api.cameraRig.yaw.toFixed(4),
        };
      });
      if (process.env.CONTROLS_DEBUG) console.log('   ', JSON.stringify(after));

      let dTheta = after.theta - before.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const dPitch = after.fy - before.fy;

      const moved = expect.axis === 'pitch' ? dPitch : dTheta;
      const ok = Math.sign(moved) === expect.sign && Math.abs(moved) > 0.02;
      if (!ok) exitCode = 1;
      console.log(
        `  ${label.padEnd(13)} ${moved.toFixed(3).padStart(6)}   `
        + `${expect.text.padEnd(14)} ${ok ? '✓' : '✗ INVERTED'}`
      );
    };

    // Camera forward .y drops when looking down; view yaw decreases turning right.
    await lookCase('mouse down', 0, 220, { axis: 'pitch', sign: -1, text: 'view tilts down' });
    await lookCase('mouse up', 0, -220, { axis: 'pitch', sign: +1, text: 'view tilts up' });
    await lookCase('mouse right', 220, 0, { axis: 'yaw', sign: -1, text: 'view turns right' });
    await lookCase('mouse left', -220, 0, { axis: 'yaw', sign: +1, text: 'view turns left' });
    console.log();

    if (errors.length) {
      console.log(`✗ ${errors.length} console error(s):`);
      for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
      exitCode = 1;
    }
    console.log(exitCode === 0
      ? '✓ every key moves the player the way the camera says it should\n'
      : '✗ at least one axis does not agree with the camera\n');
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
