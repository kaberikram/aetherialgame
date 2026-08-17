#!/usr/bin/env node
/**
 * playthrough.mjs — plays the whole chapter, start to finish, and complains.
 *
 * Every other harness in this directory measures a *property* of the build:
 * controls.mjs measures four keys, collision.mjs measures geometry, perf.mjs
 * counts draw calls. None of them plays the game, so none of them can catch the
 * thing that actually ruins a build — a chapter that stops being completable
 * somewhere in the middle.
 *
 * This drives the real controller through the real level with the real physics,
 * from the void to the oculus, and asserts:
 *
 *   - all eight beats of `narrative/Beats.js` fire, exactly once each
 *   - the player never leaves the world and never falls out of the chapter
 *   - no console errors for the whole run
 *   - the bot keeps making progress; a bot that stops moving is a stuck bot
 *   - p95 simulation cost per segment
 *
 * ## How it steers
 *
 * Not with keys. A keyboard bot has to solve "which way is the camera facing"
 * on every frame, and when it fails you get a test that reports a level bug and
 * means a bot bug. Instead it writes `input.move` directly — the same vector
 * the stick writes — with `input.enabled = false` so InputSystem cannot
 * overwrite it, which is the pattern `collision.mjs`'s wedge check settled on
 * after exactly that class of false positive. Steering is then a 2D seek toward
 * the next waypoint in world space, which is a problem with an answer.
 *
 * The simulation is pumped with `stepOnce()` rather than waited on. This
 * container has no GPU, so wall-clock and simulation time diverge by more than
 * an order of magnitude; a test that slept would be measuring SwiftShader.
 *
 *   node tools/playthrough.mjs
 *   node tools/playthrough.mjs --port 5351 --verbose
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
const PORT = Number(flag('port', 5351));
const VERBOSE = argv.includes('--verbose');

/**
 * The eight beats, in the order `narrative/Beats.js` numbers them.
 *
 * Numbered order is the DESIGN order, from the PROJECT.md beat sheet. The order
 * the level actually produces them in is a separate question and this harness
 * reports both, because they are not the same and the difference is a design
 * finding rather than a defect — see the note where it prints.
 */
const BEATS = [
  [1, 'the void'], [2, 'embodiment'], [3, 'the descent'], [4, 'the still pool'],
  [5, 'the sword'], [6, 'the boss'], [7, 'the wings'], [8, 'the exit'],
];

/**
 * The route, as segments of "walk to here, then do this".
 *
 * Waypoints come from `src/level/waypoints.js` via the page, so the route
 * cannot drift from the level the way a hardcoded copy would. `action` runs
 * once on arrival and is where the chapter's non-walking verbs happen.
 */
const ROUTE = [
  { to: 'descentTop', steps: 900, label: 'the ledge → descent top' },
  // The 2.6m gap runs z 17.4 → 14.8 with the jump-off ledge at z 18.0, so the
  // bot commits on the approach rather than hopping on a timer. Blind periodic
  // jumping put it in the lower route, where the crouch crawl stopped it dead —
  // which was the crawl working, and the bot not knowing the verb.
  { to: 'descentBottom', steps: 2400, label: 'the descent', jumpZ: [17.2, 18.8] },
  { to: 'greenVein', steps: 1200, label: 'into the Green Vein' },
  { to: 'sword', steps: 1200, label: 'to the sword', action: 'pickup' },
  { to: 'poolApproach', steps: 2400, label: 'down to the pool' },
  // Real frames, not pumped steps.
  //
  // `Engine.stepOnce()` runs `#fixedStep` and nothing else, but `FogGate` does
  // its proximity-and-interact check in `update(dt)` — the variable-rate stage —
  // so under a pumped simulation the gate is never asked whether the player is
  // standing in front of it, and its barrier collider is simply a wall. This
  // segment therefore drives an in-page rAF loop with the engine unpaused, which
  // is slower and less deterministic but is the only way to exercise a verb that
  // lives on the render tick. See DECISIONS D65.
  { to: 'starChamber', ms: 45000, label: 'through the fog gate', realtime: true },
  { to: 'starChamber', steps: 600, label: 'kill the stub', action: 'killBoss' },
  { to: 'starChamber', steps: 900, label: 'the wing choice', action: 'chooseWings' },
  // Via the gate: the pigeon's own path goes starChamber → pagodaGate →
  // pagodaFloor, and a straight line from the arena to the well floor crosses
  // whatever is between the two rooms.
  { to: 'pagodaGate', steps: 3000, label: 'out to the pagoda gate' },
  // Down the corridor, onto the plinth, then around the tower.
  //
  // The seek is a straight line with no pathfinding, and the candi is a solid
  // 14m tower on an 18m plinth in the middle of the well — so the last leg has
  // to be given the way round explicitly. `pagodaFloor` is itself the standing
  // spot beside the tower rather than under it, for the same reason.
  { at: [0, -23.5, -117], steps: 3000, label: 'down the corridor' },
  { at: [17, -25, -120], steps: 2400, label: 'around the candi' },
  { to: 'pagodaFloor', steps: 1800, label: 'to the standing spot' },
];

/** Anything outside this is not in the chapter any more. */
const WORLD_BOUNDS = { minX: -80, maxX: 80, minY: -60, maxY: 60, minZ: -200, maxZ: 80 };

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

/**
 * Walks a segment on real animation frames, with the engine running.
 *
 * The seek is identical to the pumped path's; the difference is who advances
 * time. Kept separate rather than folded in behind a flag because the two make
 * genuinely different claims: the pumped loop measures simulation cost per step,
 * and this one cannot — on a software rasteriser its frame times are a fact
 * about SwiftShader.
 */
async function runRealtime(page, seg) {
  return page.evaluate(({ to, ms, BOUNDS }) => new Promise((resolve) => {
    const api = window.__VESSEL_API;
    const engine = window.__VESSEL;
    const input = api.engine.resolve('input');
    const target = window.__VESSEL_WAYPOINTS[to];
    const start = api.player.position.clone();
    let last = api.player.position.clone();
    let travelled = 0;
    let frames = 0;
    const escaped = [];
    const trace = [];
    engine.setPaused(false);

    const stop = (arrived) => {
      input.move.set(0, 0);
      input.moveMagnitude = 0;
      input.actions.interact.pressed = false;
      engine.setPaused(true);
      const p = api.player.position;
      resolve({
        arrived, travelled, escaped, frames, worstStall: 0, acted: null, trace,
        steps: frames, sim: [],
        from: [+start.x.toFixed(1), +start.y.toFixed(1), +start.z.toFixed(1)],
        at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
        remaining: +Math.hypot(target.x - p.x, target.z - p.z).toFixed(1),
      });
    };

    const t0 = performance.now();
    const loop = () => {
      const p = api.player.position;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const flat = Math.hypot(dx, dz);
      if (flat < 2.0) return stop(true);
      if (performance.now() - t0 > ms) return stop(false);
      if (p.x < BOUNDS.minX || p.x > BOUNDS.maxX || p.y < BOUNDS.minY
        || p.y > BOUNDS.maxY || p.z < BOUNDS.minZ || p.z > BOUNDS.maxZ) {
        escaped.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) });
        return stop(false);
      }

      const yaw = api.cameraRig.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const nx = dx / flat, nz = dz / flat;
      input.move.set(nx * -fz + nz * fx, nx * fx + nz * fz);
      input.moveMagnitude = 1;
      // Tap, do not hold: `enter()` reads a press edge, and with InputSystem
      // disabled nothing else clears the flag.
      input.actions.interact.pressed = frames % 15 === 0;

      travelled += Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
      last = p.clone();
      if (frames % 60 === 0) {
        trace.push({
          f: frames, at: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)],
          st: api.player.state, gr: api.player.grounded,
          mv: [+input.move.x.toFixed(2), +input.move.y.toFixed(2)],
          yaw: +api.cameraRig.yaw.toFixed(2),
          gate: api.encounter.gate.open ? (api.encounter.gate.sealed ? 'sealed' : 'open') : 'shut',
        });
      }
      frames++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }), { to: seg.to, ms: seg.ms ?? 45000, BOUNDS: WORLD_BOUNDS });
}

const pct = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  let exitCode = 0;
  try {
    await page.goto(`http://localhost:${PORT}/?quality=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 90000 });

    // Record beats from the bus itself, before anything else runs.
    await page.evaluate(() => {
      const api = window.__VESSEL_API;
      window.__beats = [];
      api.engine.bus.on('story:beat', ({ id }) => {
        window.__beats.push({ id, at: window.__beats.length });
      });
      // The harness owns the stick for the duration. InputSystem runs at
      // STAGE.INPUT, ahead of the character reading it, so without this every
      // vector written below is overwritten before it is used.
      api.engine.resolve('input').enabled = false;
      window.__VESSEL.setPaused(true);
    });

    console.log('\n  segment                        steps   travelled   p95 sim   verdict');
    console.log('  ' + '─'.repeat(70));

    // ---- the void ------------------------------------------------------
    // Beats 1 and 2. Driven rather than skipped: `intro.skip()` is what every
    // other harness uses, and a test that skipped the first two beats could not
    // honestly claim all eight fire.
    const voidResult = await page.evaluate(() => {
      const api = window.__VESSEL_API;
      const engine = window.__VESSEL;
      const input = api.engine.resolve('input');
      // The corpse is placed 2.5s into the drift, and the body pulls the light
      // toward it once inside 12m, so drifting roughly forward is enough.
      for (let i = 0; i < 900; i++) {
        input.move.set(0, 1);
        input.moveMagnitude = 1;
        engine.stepOnce();
        if (api.intro.promptShown) break;
      }
      if (!api.intro.promptShown) return { reached: false };
      // "take it" — the same action the prompt asks for.
      for (let i = 0; i < 240; i++) {
        input.move.set(0, 0);
        input.moveMagnitude = 0;
        input.actions.interact.pressed = i === 0;
        engine.stepOnce();
        if (api.intro.finished) break;
      }
      // The stand-up plays out over a few seconds before control returns, and
      // the sequence only calls itself done a beat AFTER the state clears — so
      // stepping until the state changes stops one step too early.
      for (let i = 0; i < 900 && !api.intro.finished; i++) engine.stepOnce();
      return { reached: true, finished: api.intro.finished, y: api.player.position.y };
    });

    if (!voidResult.reached) {
      exitCode = 1;
      console.log('  the void                          —           —         —   ✗ never reached the corpse');
    } else {
      console.log(`  ${'the void → embodiment'.padEnd(30)}     —           —         —   ${voidResult.finished ? '✓' : '✗ intro never finished'}`);
      if (!voidResult.finished) exitCode = 1;
    }

    // ---- the walk ------------------------------------------------------
    for (const seg of ROUTE) {
      const r = seg.realtime ? await runRealtime(page, seg) : await page.evaluate(({ seg, BOUNDS }) => {
        const api = window.__VESSEL_API;
        const engine = window.__VESSEL;
        const input = api.engine.resolve('input');
        const target = seg.at ? { x: seg.at[0], y: seg.at[1], z: seg.at[2] }
          : window.__VESSEL_WAYPOINTS[seg.to];

        const start = api.player.position.clone();
        let travelled = 0;
        let last = api.player.position.clone();
        const sim = [];
        const escaped = [];
        let stalledFor = 0;
        let worstStall = 0;
        let arrived = false;

        for (let i = 0; i < seg.steps; i++) {
          const p = api.player.position;
          const dx = target.x - p.x;
          const dz = target.z - p.z;
          const flat = Math.hypot(dx, dz);
          if (flat < 2.0) { arrived = true; break; }

          // Seek in world space. `input.move` is camera-relative, so it is
          // rotated into the camera's yaw — the same transform the stick goes
          // through, which means the bot is exercising the real path and not a
          // shortcut around it.
          const yaw = api.cameraRig.yaw;
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
          const rx = -fz, rz = fx;
          const nx = dx / flat, nz = dz / flat;
          input.move.set(nx * rx + nz * rz, nx * fx + nz * fz);
          input.moveMagnitude = 1;

          // Jump the gap, on the approach to it. The Descent's 2.6m gap is
          // authored with a lower route underneath, so missing it costs the
          // long way round rather than the run — but taking it is the intended
          // line and is what the traversal tutorial is for.
          input.actions.jump.pressed = !!seg.jumpZ && api.player.grounded
            && p.z <= seg.jumpZ[1] && p.z >= seg.jumpZ[0];

          // Stall recovery, in the order a player would try it.
          //
          // Crouch first, because the one place in the chapter that stops a
          // standing capsule is the Green Vein-style crawl on the Descent's
          // lower route, and crouching is the answer there by construction.
          // Then jump, for a lip the step offset will not take. Both are real
          // verbs on real buttons — the bot is not being teleported out.
          // Crouch is a toggle, so a wrong guess has to be undone or the bot
          // spends the rest of the segment at half speed under full headroom.
          input.actions.crouch.pressed = stalledFor === 45 || stalledFor === 150;
          if (stalledFor > 200 && stalledFor % 30 === 0) input.actions.jump.pressed = true;

          const t0 = performance.now();
          engine.stepOnce();
          sim.push(performance.now() - t0);

          const q = api.player.position;
          const moved = Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z);
          travelled += moved;
          last = q.clone();

          // Progress, not motion: running on the spot into a wall is a stall.
          if (moved < 0.004) {
            stalledFor++;
            worstStall = Math.max(worstStall, stalledFor);
          } else {
            stalledFor = 0;
          }

          if (q.x < BOUNDS.minX || q.x > BOUNDS.maxX || q.y < BOUNDS.minY
            || q.y > BOUNDS.maxY || q.z < BOUNDS.minZ || q.z > BOUNDS.maxZ) {
            escaped.push({ x: +q.x.toFixed(1), y: +q.y.toFixed(1), z: +q.z.toFixed(1) });
            break;
          }
        }

        // The chapter's non-walking verbs, at the point the route reaches them.
        let acted = null;
        let diag = null;
        if (seg.action === 'pickup') {
          for (let i = 0; i < 120; i++) {
            input.actions.interact.pressed = i % 20 === 0;
            engine.stepOnce();
          }
          acted = api.state.hasFlag('hasSword');
        } else if (seg.action === 'killBoss') {
          // R1 until it stops being there. 900hp against the light chain.
          // Close the distance between swings. Attacks carry root motion, and
          // 225 of them in a row walked the bot 18m out of the arena and off
          // the edge of the basin — the swings kept landing on air and the run
          // ended in a fall. A player re-approaches; so does this.
          let swings = 0;
          for (let i = 0; i < 5400 && api.boss.alive; i++) {
            const p = api.player.position;
            const dx = api.boss.position.x - p.x;
            const dz = api.boss.position.z - p.z;
            const flat = Math.hypot(dx, dz);
            if (flat > 2.4) {
              const yaw = api.cameraRig.yaw;
              const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
              const nx = dx / flat, nz = dz / flat;
              input.move.set(nx * -fz + nz * fx, nx * fx + nz * fz);
              input.moveMagnitude = 1;
            } else {
              input.move.set(0, 0);
              input.moveMagnitude = 0;
            }
            input.actions.lightAttack.pressed = flat < 3.2 && i % 24 === 0;
            if (input.actions.lightAttack.pressed) swings++;
            engine.stepOnce();
          }
          acted = !api.boss.alive;
          diag = {
            swings,
            bossHp: Math.round(api.boss.vitals.health),
            engaged: api.boss.engaged,
            hasWeapon: api.player.hasWeapon,
            grounded: api.player.grounded,
            state: api.player.state,
            dist: +api.player.position.distanceTo(api.boss.position).toFixed(2),
          };
        } else if (seg.action === 'chooseWings') {
          // There is no button for this. The choice is gated behind a 5s pause
          // after the kill, the two forms then rise for 3.4s, and it resolves
          // when the player walks within 2.3m of one of them — "no UI labels,
          // no good or evil", so approach IS the input. The bot walks to the
          // light form, which is an arbitrary pick: the assertion is that the
          // slot resolves and beat 8 fires, not which way it went.
          for (let i = 0; i < 3600; i++) {
            const wc = api.encounter.wingChoice;
            const form = wc?.forms?.[0];
            if (form) {
              const p = api.player.position;
              const dx = form.home.x - p.x;
              const dz = form.home.z - p.z;
              const flat = Math.hypot(dx, dz);
              if (flat > 1.2) {
                const yaw = api.cameraRig.yaw;
                const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
                const nx = dx / flat, nz = dz / flat;
                input.move.set(nx * -fz + nz * fx, nx * fx + nz * fz);
                input.moveMagnitude = 1;
              }
            }
            engine.stepOnce();
            if (api.state.hasFlag('wingsResolved')) break;
          }
          acted = api.state.hasFlag('wingsResolved');
          diag = {
            phase: api.encounter.wingChoice?.phase ?? 'none',
            resolved: api.encounter.wingChoice?.resolved ?? false,
            alignment: api.state.hasFlag('wingsResolved'),
          };
        }
        input.actions.interact.pressed = false;
        input.actions.lightAttack.pressed = false;
        input.actions.alignmentAbility.pressed = false;
        input.actions.jump.pressed = false;
        input.actions.crouch.pressed = false;
        // Crouch is a TOGGLE, so leaving a segment crouched would halve the
        // next segment's speed and its headroom.
        if (api.player.state === 'crouch') {
          for (let i = 0; i < 30; i++) {
            input.actions.crouch.pressed = i === 0;
            engine.stepOnce();
          }
          input.actions.crouch.pressed = false;
        }
        input.move.set(0, 0);
        input.moveMagnitude = 0;

        const p = api.player.position;
        return {
          arrived, travelled, escaped, worstStall, acted, diag,
          steps: sim.length,
          sim,
          from: [+start.x.toFixed(1), +start.y.toFixed(1), +start.z.toFixed(1)],
          at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
          remaining: +Math.hypot(target.x - p.x, target.z - p.z).toFixed(1),
        };
      }, { seg, BOUNDS: WORLD_BOUNDS });

      const problems = [];
      if (!r.arrived) problems.push(`stopped ${r.remaining}m short at ${r.at.join(',')}`);
      if (r.escaped.length) problems.push(`left the world at ${r.escaped[0].x},${r.escaped[0].y},${r.escaped[0].z}`);
      // 240 steps is four seconds of simulation with no progress at all.
      if (r.worstStall > 240) problems.push(`stalled ${r.worstStall} steps`);
      if (seg.action && r.acted === false) problems.push(`${seg.action} did not take`);
      if (problems.length) exitCode = 1;

      console.log(
        `  ${seg.label.padEnd(30)} ${String(r.steps).padStart(5)}   `
        + `${r.travelled.toFixed(1).padStart(7)}m   `
        + `${pct(r.sim, 0.95).toFixed(2).padStart(6)}ms   `
        + (problems.length ? `✗ ${problems.join('; ')}` : '✓')
      );
      if (VERBOSE) console.log(`      ${r.from.join(',')} → ${r.at.join(',')}`);
      if (r.diag) console.log(`      ${JSON.stringify(r.diag)}`);
      if (VERBOSE && r.trace) for (const t of r.trace) console.log(`      ${JSON.stringify(t)}`);
    }

    // ---- the beats -----------------------------------------------------
    const beats = await page.evaluate(() => window.__beats);
    console.log('\n  beat                    fired   order');
    console.log('  ' + '─'.repeat(46));
    const seq = beats.map((b) => b.id);
    for (const [id, name] of BEATS) {
      const n = seq.filter((s) => s === id).length;
      const where = n ? `#${seq.indexOf(id) + 1}` : '—';
      if (n !== 1) exitCode = 1;
      console.log(
        `  ${String(id)}. ${name.padEnd(20)} ${String(n).padStart(3)}   ${where.padStart(5)}   `
        + (n === 1 ? '✓' : n === 0 ? '✗ never fired' : `✗ fired ${n}×`)
      );
    }

    // Design order vs level order. Not a failure: the beat sheet puts the pool
    // (4) before the sword (5), and the level puts the sword at z−30 and the
    // pool at z−55, so walking the chapter produces 5 before 4. Which one is
    // wrong is a design call, not something a harness should decide.
    const outOfOrder = seq.filter((id, i) => i > 0 && id < seq[i - 1]);
    console.log(`\n  fired order: ${seq.join(' → ')}`);
    if (outOfOrder.length) {
      console.log(`  · note: ${outOfOrder.map((i) => `beat ${i}`).join(', ')} fired after a later-numbered`);
      console.log('    beat. The level\'s geography and PROJECT.md\'s beat sheet disagree about');
      console.log('    whether the pool or the sword comes first. Design call, not a defect.');
    }

    if (errors.length) {
      exitCode = 1;
      console.log(`\n✗ ${errors.length} console error(s):`);
      for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
    }
    console.log(exitCode === 0
      ? '\n✓ the chapter plays start to finish\n'
      : '\n✗ the chapter does not play start to finish\n');
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
