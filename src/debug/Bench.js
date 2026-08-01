import { STAGE } from '../core/Engine.js';

/**
 * Bench — the frame-time number that cannot be measured in the build container.
 *
 * Everything else in this repo's performance work is measured headlessly:
 * scene passes, pixels per frame, draw calls, triangles. Those are exact and
 * hardware-independent. Frame time is neither — the CI container renders
 * through SwiftShader, where a single Star Chamber frame takes seconds. So the
 * one number the target actually cares about, "does it hold 60 on an M1", has
 * to come from the M1.
 *
 * This walks a fixed route through every zone, holds at each stop long enough
 * to fill a sample window, and reports p50/p95 **wall-clock** frame time
 * alongside the pass and pixel counts that explain it. Fixed route, fixed
 * dwell, so two runs are comparable and a regression is visible as a number
 * rather than as a feeling.
 *
 *   http://localhost:5173/?bench            the shipping default (`high`)
 *   http://localhost:5173/?bench&quality=ultra
 *
 * Deliberately behind a query param and constructed nowhere else, so it costs
 * the shipping build one `if`.
 */

/** Seconds spent at each stop. The first is discarded as warm-up. */
const DWELL = 4.0;
/** Seconds discarded at the start of every stop, for shader compiles. */
const SETTLE = 1.25;

const STOPS = [
  { name: 'descent', waypoint: 'descentBottom', facing: Math.PI },
  { name: 'greenVein', waypoint: 'greenVein', facing: Math.PI },
  { name: 'poolApproach', waypoint: 'poolApproach', facing: Math.PI },
  { name: 'starChamber', waypoint: 'starChamber', facing: Math.PI },
  { name: 'pagodaWell', waypoint: 'pagodaFloor', facing: -Math.PI / 2 },
];

export class Bench {
  updateWhilePaused = true;
  static priority = STAGE.DEBUG + 10;

  #stop = -1;
  #timer = 0;
  #samples = [];
  #results = [];
  #last = 0;
  #el = null;
  #done = false;

  constructor(engine, { player, cameraRig, intro, waypoints, renderer, quality }) {
    this.engine = engine;
    this.player = player;
    this.cameraRig = cameraRig;
    this.intro = intro;
    this.waypoints = waypoints;
    this.renderer = renderer;
    this.quality = quality;

    this.#el = document.createElement('div');
    this.#el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'z-index:9999;background:rgba(10,12,16,.92);color:#dfe6ef;border:1px solid #2a3340;'
      + 'padding:18px 22px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'white-space:pre;border-radius:6px;pointer-events:none;text-align:left';
    this.#el.textContent = 'bench — warming up';
    document.body.appendChild(this.#el);

    window.__VESSEL_BENCH = { running: true, results: null };
  }

  start() {
    if (!this.intro.finished) this.intro.skip();
    this.#advance();
  }

  #advance() {
    // Close out the stop that just finished before moving on.
    if (this.#stop >= 0) this.#record(STOPS[this.#stop]);

    this.#stop++;
    if (this.#stop >= STOPS.length) return this.#finish();

    const s = STOPS[this.#stop];
    const wp = this.waypoints[s.waypoint];
    this.player.respawn(wp.clone().setY(wp.y + 0.5), s.facing);
    this.cameraRig.snap({ yaw: s.facing + Math.PI });
    this.#timer = 0;
    this.#samples = [];
    this.#last = 0;
    this.#el.textContent = `bench — ${s.name}  (${this.#stop + 1}/${STOPS.length})`;
  }

  #record(stop) {
    const r = this.renderer.renderStats();
    const ms = this.#samples.slice().sort((a, b) => a - b);
    const at = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * q))] : 0);
    this.#results.push({
      zone: stop.name,
      frames: ms.length,
      p50: at(0.5),
      p95: at(0.95),
      worst: ms.length ? ms[ms.length - 1] : 0,
      drawCalls: r.drawCalls,
      triangles: r.triangles,
      scenePasses: r.scenePasses,
      pixels: r.pixelsPerFrame,
      resolution: r.resolution,
    });
  }

  update(dt) {
    if (this.#done) return;
    if (this.#stop < 0) return;

    // dt from the engine is clamped for simulation safety, which is exactly
    // the wrong thing to measure: a clamp turns a 200ms hitch into a 33ms one
    // and hides the stutter. Read the clock directly.
    const now = performance.now();
    if (this.#last) {
      const frameMs = now - this.#last;
      if (this.#timer >= SETTLE) this.#samples.push(frameMs);
    }
    this.#last = now;

    this.#timer += dt;
    if (this.#timer >= DWELL + SETTLE) this.#advance();
  }

  #finish() {
    this.#done = true;
    const q = this.quality;
    const all = this.#results;
    const worstZone = all.reduce((a, b) => (b.p95 > a.p95 ? b : a), all[0]);

    const head = `VESSEL bench · quality=${q.name} · ${all[0]?.resolution ?? '?'}`
      + ` · dpr ${this.renderer.renderer.getPixelRatio()}`;
    const rows = all.map((r) =>
      `${r.zone.padEnd(14)} ${r.p50.toFixed(1).padStart(6)}ms ${(1000 / r.p50).toFixed(0).padStart(4)}fps`
      + ` | p95 ${r.p95.toFixed(1).padStart(6)}ms | ${String(r.scenePasses).padStart(2)} passes`
      + ` | ${String(r.drawCalls).padStart(4)} draws | ${(r.triangles / 1000).toFixed(0).padStart(4)}k tris`);

    // 16.7ms is the 60fps line. Judged on p95, not p50: a game that averages
    // 60 and dips to 40 four times a second does not feel like 60.
    const holds = all.every((r) => r.p95 <= 16.7);
    const verdict = holds
      ? '✓ holds 60fps at p95 in every zone'
      : `✗ misses 60fps — worst is ${worstZone.zone} at p95 ${worstZone.p95.toFixed(1)}ms `
        + `(${(1000 / worstZone.p95).toFixed(0)}fps)`;

    const report = [head, '', ...rows, '', verdict].join('\n');
    this.#el.textContent = report;
    console.log(`\n${report}\n`);

    window.__VESSEL_BENCH = { running: false, quality: q.name, holds, results: all, report };
  }
}
