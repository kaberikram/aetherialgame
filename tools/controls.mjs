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

    // ---- tap versus hold on the dodge key --------------------------------
    // The load-bearing change of the Elden Ring pass: Space taps into a roll
    // and holds into a sprint. Moving the roll's trigger from press to release
    // touches the buffer, the coyote window and the roll-cancel rule, so it
    // gets a test that drives the real key rather than reading the code.
    console.log('  dodge key      result                        expected            verdict');
    console.log('  ' + '─'.repeat(74));

    const dodgeCase = async (label, holdSteps, expect) => {
      await page.evaluate(() => {
        const api = window.__VESSEL_API;
        api.player.respawn({ x: 0, y: 0.6, z: 34 }, Math.PI);
        api.cameraRig.enabled = true;
        window.__seen = { roll: false, sprint: false };
      });
      await pump(30);

      // Walk first: a sprint from standing is a different code path, and
      // "hold to sprint" is a thing you do while already moving.
      await page.keyboard.down('KeyW');
      await pump(20);
      await page.keyboard.down('Space');

      // Sample every step, because both outcomes are transient — a roll is
      // ~54 frames and `isSprinting()` is only true while the key is down.
      const watch = (n) => page.evaluate((count) => {
        const api = window.__VESSEL_API;
        const engine = window.__VESSEL;
        const input = api.engine.resolve('input');
        engine.setPaused(true);
        for (let i = 0; i < count; i++) {
          engine.stepOnce();
          if (api.player.state === 'roll') window.__seen.roll = true;
          if (input.isSprinting()) window.__seen.sprint = true;
        }
        engine.setPaused(false);
      }, n);

      await watch(holdSteps);
      await page.keyboard.up('Space');
      await watch(40);
      await page.keyboard.up('KeyW');
      await pump(10);

      const seen = await page.evaluate(() => window.__seen);
      const ok = seen.roll === expect.roll && seen.sprint === expect.sprint;
      if (!ok) exitCode = 1;
      const got = `roll ${seen.roll ? 'yes' : 'no '}  sprint ${seen.sprint ? 'yes' : 'no '}`;
      console.log(
        `  ${label.padEnd(14)} ${got.padEnd(29)} ${expect.text.padEnd(19)} ${ok ? '✓' : '✗'}`
      );
    };

    // sprintHoldFrames is 10, so 4 steps is unambiguously a tap and 40 is
    // unambiguously a hold.
    await dodgeCase('tap (4 steps)', 4, { roll: true, sprint: false, text: 'roll, no sprint' });
    await dodgeCase('hold (40)', 40, { roll: false, sprint: true, text: 'sprint, no roll' });
    console.log();

    // ---- crouch ----------------------------------------------------------
    // A toggle on C, and it has to actually change the body — a crouch that
    // only plays an animation is a button that changes nothing.
    console.log('  crouch         result                        expected            verdict');
    console.log('  ' + '─'.repeat(74));

    const standing = await page.evaluate(() => {
      const api = window.__VESSEL_API;
      api.player.respawn({ x: 0, y: 0.6, z: 34 }, Math.PI);
      return api.player.collider.halfHeight();
    });
    await pump(30);
    await page.keyboard.press('KeyC');
    await pump(20);
    const crouched = await page.evaluate(() => ({
      half: window.__VESSEL_API.player.collider.halfHeight(),
      state: window.__VESSEL_API.player.state,
    }));
    await page.keyboard.press('KeyC');
    await pump(20);
    const stoodBack = await page.evaluate(() => ({
      half: window.__VESSEL_API.player.collider.halfHeight(),
      state: window.__VESSEL_API.player.state,
    }));

    for (const [label, got, want, ok] of [
      ['C once', `halfHeight ${standing.toFixed(2)} → ${crouched.half.toFixed(2)}, state ${crouched.state}`,
        'capsule shrinks', crouched.half < standing - 0.2 && crouched.state === 'crouch'],
      ['C again', `halfHeight ${stoodBack.half.toFixed(2)}, state ${stoodBack.state}`,
        'capsule restored', Math.abs(stoodBack.half - standing) < 1e-6 && stoodBack.state !== 'crouch'],
    ]) {
      if (!ok) exitCode = 1;
      console.log(`  ${label.padEnd(14)} ${got.padEnd(29)} ${want.padEnd(19)} ${ok ? '✓' : '✗'}`);
    }
    console.log();

    // ---- the crawl -------------------------------------------------------
    // Crouch needs somewhere to crouch or the button is decoration. The
    // Descent's lower route has ~1.25m of clearance under a slab, against a
    // 1.68m standing capsule and a 1.16m crouched one — so this asserts BOTH
    // halves: you cannot walk it, and you can crawl it. The grid sweep cannot
    // see this, because a downward probe lands on top of the slab.
    const crawl = await page.evaluate(() => {
      const api = window.__VESSEL_API;
      const engine = window.__VESSEL;
      const input = api.engine.resolve('input');
      input.enabled = false;
      engine.setPaused(true);

      const run = (crouch) => {
          // On the lower route's floor, which is y −10.65 at z 15.6 — the first
        // draft spawned at −11.0, i.e. inside it, so the standing run began by
        // being squeezed out of the geometry and its result meant nothing.
        api.player.respawn({ x: -0.98, y: -10.2, z: 15.6 }, Math.PI);
        // `input.move` is CAMERA-relative, and the rig is still wherever the
        // strafe cases left it. Camera forward is (−sin yaw, 0, −cos yaw), so
        // yaw 0 is the only value that makes move (0,1) mean −z — which is the
        // direction the crawl runs. Without this the bot walks off diagonally
        // and the test reports the crawl passable because it never entered it.
        api.cameraRig.snap({ yaw: 0 });
        for (let i = 0; i < 40; i++) engine.stepOnce();
        if (crouch) {
          for (let i = 0; i < 30; i++) {
            input.actions.crouch.pressed = i === 0;
            engine.stepOnce();
          }
          input.actions.crouch.pressed = false;
        }
        const from = api.player.position.z;
        // 900 steps, because crouch speed is 0.45x walk and the slab's footprint
        // is a rotated cuboid ~6.4m deep in z — a budget tuned to walking speed
        // reports the crawl impassable when it is merely slow.
        for (let i = 0; i < 900; i++) {
          input.move.set(0, 1);
          input.moveMagnitude = 1;
          engine.stepOnce();
        }
        input.move.set(0, 0);
        input.moveMagnitude = 0;
        return {
          travelled: +(from - api.player.position.z).toFixed(2),
          z: +api.player.position.z.toFixed(2),
          state: api.player.state,
        };
      };

      const walked = run(false);
      const crawled = run(true);
      // Leave the world as it was found.
      if (api.player.state === 'crouch') {
        for (let i = 0; i < 30; i++) {
          input.actions.crouch.pressed = i === 0;
          engine.stepOnce();
        }
        input.actions.crouch.pressed = false;
      }
      engine.setPaused(false);
      input.enabled = true;
      return { walked, crawled };
    });

    console.log('  the crawl      result                        expected            verdict');
    console.log('  ' + '─'.repeat(74));
    // Judge on clearing the slab, not on distance travelled. The slab's box is
    // rotated, so its z footprint is not the 13 → 9 the authoring coordinates
    // suggest; "did you come out the far side" is the question either way, and
    // it does not need the footprint solved to ask.
    const walkBlocked = crawl.walked.z > 10.0;
    const crawlPasses = crawl.crawled.z < 8.5;
    if (!walkBlocked || !crawlPasses) exitCode = 1;
    console.log(`  ${'standing'.padEnd(14)} ${`stopped at z ${crawl.walked.z} (${crawl.walked.travelled}m)`.padEnd(29)} ${'blocked (z>10)'.padEnd(19)} ${walkBlocked ? '✓' : '✗'}`);
    console.log(`  ${'crouched'.padEnd(14)} ${`reached z ${crawl.crawled.z} (${crawl.crawled.travelled}m)`.padEnd(29)} ${'through (z<8.5)'.padEnd(19)} ${crawlPasses ? '✓' : '✗'}`);
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
