#!/usr/bin/env node
/**
 * probe.mjs — ad-hoc live inspection.
 *
 * Boots the build, optionally drives it, then evaluates an arbitrary
 * expression against `window.__VESSEL_API` and prints the result.
 *
 *   node tools/probe.mjs "api.player.position"
 *   node tools/probe.mjs --wait 6 "api.intro.phase"
 *   node tools/probe.mjs --keys "KeyW:1200" --shot walk "api.player.state"
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 5198;
const CHROME = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d;
};
const expr = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))).pop();

const free = () => { try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { stdio: 'ignore' }); } catch {} };

const server = await (async () => {
  free();
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite timeout')), 60000);
    p.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); setTimeout(res, 400); } });
    p.on('exit', (c) => { clearTimeout(t); rej(new Error(`vite exited ${c}`)); });
  });
  return p;
})();

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__VESSEL_READY === true, { timeout: 45000 });
  await page.click('canvas').catch(() => {});

  const wait = Number(flag('wait', 2));
  await page.waitForTimeout(wait * 1000);

  const keys = flag('keys');
  if (keys && keys !== true) {
    for (const spec of String(keys).split(',')) {
      const [key, ms] = spec.split(':');
      await page.keyboard.down(key);
      await page.waitForTimeout(Number(ms ?? 500));
      await page.keyboard.up(key);
    }
  }

  // Keys left held while the expression is evaluated, so mid-action state
  // (speed while running, frame counts mid-roll) is observable at all.
  const hold = flag('hold');
  if (hold && hold !== true) {
    const [spec, ms] = String(hold).split('@');
    for (const key of spec.split('+')) await page.keyboard.down(key);
    await page.waitForTimeout(Number(ms ?? 800));
  }

  const shot = flag('shot');
  if (shot) {
    await mkdir(path.join(ROOT, 'captures'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'captures', `${shot}.png`) });
    console.log(`captured captures/${shot}.png`);
  }

  if (expr) {
    const result = await page.evaluate((src) => {
      const api = window.__VESSEL_API;
      const engine = window.__VESSEL;
      try {
        // eslint-disable-next-line no-eval
        const v = eval(src);
        return JSON.parse(JSON.stringify(v, (k, val) => (typeof val === 'function' ? '[fn]' : val)));
      } catch (e) {
        return { __error: e.message };
      }
    }, expr);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error('✗', err.message);
  await page.screenshot({ path: path.join(ROOT, 'captures', 'probe-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  free();
}
