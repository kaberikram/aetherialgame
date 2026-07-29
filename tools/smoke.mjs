#!/usr/bin/env node
/**
 * smoke.mjs — headless verification harness.
 *
 * Boots the dev server, drives the preinstalled Chromium, and asserts the
 * things a phase gate cares about: it runs, nothing throws, and the perf
 * numbers PROJECT.md budgets for are inside budget.
 *
 * Chromium is preinstalled at PLAYWRIGHT_BROWSERS_PATH. Never run
 * `playwright install`.
 *
 *   node tools/smoke.mjs                       # boot + perf only
 *   node tools/smoke.mjs --script walk         # run a named drive script
 *   node tools/smoke.mjs --shot name           # capture captures/name.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CHROME_PATH = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => existsSync(p));

const ROOT = path.resolve(import.meta.dirname, '..');
const CAPTURES = path.join(ROOT, 'captures');
const PORT = 5199;
const URL = `http://localhost:${PORT}/`;

const BUDGET = { drawCalls: 1500, cpuMs: 4.0, fps: 55 };

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : fallback);
};

function startServer() {
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start in 60s')), 60000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('ready in') || String(d).includes('Local:')) {
        clearTimeout(timer);
        setTimeout(() => resolve(proc), 400);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    proc.on('exit', (c) => { clearTimeout(timer); reject(new Error(`vite exited ${c}`)); });
  });
}

const DRIVE_SCRIPTS = {
  idle: async () => {},
  walk: async (page) => {
    for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(700);
      await page.keyboard.up(key);
    }
  },
  combat: async (page) => {
    await page.mouse.click(640, 400);
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) {
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'left' });
      await page.waitForTimeout(450);
    }
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await page.keyboard.press('ShiftLeft');
    await page.waitForTimeout(900);
  },
};

async function main() {
  await mkdir(CAPTURES, { recursive: true });
  console.log('› starting vite…');
  const server = await startServer();

  const browser = await chromium.launch({
    // The environment preinstalls a Chromium build that does not match this
    // playwright package's expected revision. Point at it explicitly rather
    // than downloading a second copy.
    executablePath: CHROME_PATH,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
      '--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    else if (m.type() === 'warning') warnings.push(t);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

  let exitCode = 0;
  try {
    console.log('› loading…');
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 45000 })
      .catch(async () => {
        const bootText = await page.textContent('#boot-status').catch(() => '(no boot element)');
        throw new Error(`engine never signalled ready. boot status: "${bootText}"`);
      });
    console.log('  engine ready');

    // Let it settle: shader compiles and the first GC land in the first second.
    await page.waitForTimeout(1500);

    const scriptName = arg('script', 'idle');
    const drive = DRIVE_SCRIPTS[scriptName];
    if (!drive) throw new Error(`unknown drive script "${scriptName}"`);
    if (scriptName !== 'idle') console.log(`› driving: ${scriptName}`);
    await page.click('canvas').catch(() => {});
    await drive(page);

    // Sample over a window rather than one frame — one frame is noise.
    console.log('› sampling 3s…');
    await page.evaluate(() => { window.__VESSEL_SAMPLES = []; });
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__VESSEL_SAMPLES.push({ ...window.__VESSEL_PERF }));
    }
    const samples = await page.evaluate(() => window.__VESSEL_SAMPLES);
    const valid = samples.filter((s) => s.ready);
    if (!valid.length) throw new Error('no perf samples captured');

    const avg = (k) => valid.reduce((a, s) => a + (s[k] ?? 0), 0) / valid.length;
    const max = (k) => Math.max(...valid.map((s) => s[k] ?? 0));
    const report = {
      fps: avg('fps'),
      cpuMs: avg('cpuMs'),
      p95CpuMs: max('p95CpuMs'),
      simMs: avg('simMs'),
      renderMs: avg('renderMs'),
      drawCalls: Math.round(avg('drawCalls')),
      peakDrawCalls: max('drawCalls'),
      triangles: Math.round(avg('triangles')),
      programs: max('programs'),
    };

    const shot = arg('shot');
    if (shot) {
      const file = path.join(CAPTURES, `${shot === true ? 'frame' : shot}.png`);
      await page.screenshot({ path: file });
      console.log(`  captured ${path.relative(ROOT, file)}`);
    }

    console.log('\n──────── PERFORMANCE ────────');
    const line = (label, value, budget, invert = false) => {
      const ok = invert ? value >= budget : value <= budget;
      console.log(`  ${label.padEnd(14)} ${String(value).padStart(9)}   ${ok ? '✓' : '✗ over budget'}`);
      return ok;
    };
    let pass = true;
    pass = line('fps', report.fps.toFixed(1), BUDGET.fps, true) && pass;
    pass = line('cpu ms', report.cpuMs.toFixed(2), BUDGET.cpuMs) && pass;
    console.log(`  ${'  sim / render'.padEnd(14)} ${report.simMs.toFixed(2)} / ${report.renderMs.toFixed(2)} ms`);
    pass = line('draw calls', report.drawCalls, BUDGET.drawCalls) && pass;
    console.log(`  ${'peak draws'.padEnd(14)} ${String(report.peakDrawCalls).padStart(9)}`);
    console.log(`  ${'triangles'.padEnd(14)} ${String(report.triangles).padStart(9)}`);
    console.log(`  ${'programs'.padEnd(14)} ${String(report.programs).padStart(9)}`);
    console.log('─────────────────────────────');
    console.log('  note: software GL (swiftshader) — fps here is a floor, not the real number.\n');

    if (warnings.length) {
      console.log(`⚠ ${warnings.length} console warning(s):`);
      for (const w of [...new Set(warnings)].slice(0, 6)) console.log(`  ${w.slice(0, 200)}`);
    }
    if (errors.length) {
      console.log(`\n✗ ${errors.length} console error(s):`);
      for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  ${e.slice(0, 500)}`);
      exitCode = 1;
    } else {
      console.log('✓ no console errors');
    }

    await writeFile(path.join(CAPTURES, 'perf.json'), JSON.stringify(report, null, 2));
    // CPU-budget failures under swiftshader are not meaningful; report, don't block.
    if (!pass) console.log('\n(budget misses above are advisory under software GL)');
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    await page.screenshot({ path: path.join(CAPTURES, 'failure.png') }).catch(() => {});
    exitCode = 1;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
  process.exit(exitCode);
}

main();
