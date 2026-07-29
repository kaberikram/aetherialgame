import { STAGE } from '../core/Engine.js';

const BUDGET = { drawCalls: 1500, cpuMs: 4.0, fps: 60 };

/**
 * StatsOverlay — the numbers PROJECT.md says get reported at every phase gate:
 * FPS, draw calls, triangles, CPU frame time. Colour-coded against the budget
 * so a regression is visible without reading digits.
 *
 * Also publishes `window.__VESSEL_PERF` for the Playwright smoke harness.
 */
export class StatsOverlay {
  updateWhilePaused = true;
  static priority = STAGE.DEBUG;

  #el;
  #history = new Float32Array(120);
  #cursor = 0;
  #accum = 0;
  #worst = { cpuMs: 0, drawCalls: 0 };

  constructor(engine, debug) {
    this.engine = engine;
    this.debug = debug;
    this.#el = debug.registerPanel('stats', { corner: 'tl' });
    debug.set('stats', true);
    window.__VESSEL_PERF = { ready: false };
  }

  update(dt) {
    const p = this.engine.perf;
    this.#history[this.#cursor] = p.cpuMs;
    this.#cursor = (this.#cursor + 1) % this.#history.length;
    this.#worst.cpuMs = Math.max(this.#worst.cpuMs, p.cpuMs);
    this.#worst.drawCalls = Math.max(this.#worst.drawCalls, p.drawCalls);

    window.__VESSEL_PERF = {
      ready: true,
      fps: p.fps,
      cpuMs: p.cpuMs,
      simMs: p.simMs,
      renderMs: p.renderMs,
      drawCalls: p.drawCalls,
      triangles: p.triangles,
      programs: p.programs,
      worstCpuMs: this.#worst.cpuMs,
      worstDrawCalls: this.#worst.drawCalls,
      p95CpuMs: this.#percentile(0.95),
      frame: this.engine.frame,
    };

    this.#accum += dt;
    if (this.#accum < 0.1 || !this.debug.isOn('stats')) return;
    this.#accum = 0;
    this.#render(p);
  }

  #percentile(q) {
    const arr = Array.from(this.#history).filter((v) => v > 0).sort((a, b) => a - b);
    if (!arr.length) return 0;
    return arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  }

  #render(p) {
    const cls = (v, budget, invert = false) => {
      const over = invert ? v < budget : v > budget;
      const near = invert ? v < budget * 1.12 : v > budget * 0.88;
      return over ? 'bad' : near ? 'warn' : 'ok';
    };
    const n = (v, d = 0) => v.toFixed(d).padStart(d ? 6 : 5);
    const p95 = this.#percentile(0.95);

    this.#el.innerHTML =
      `<b>VESSEL</b> <span class="dim">frame ${this.engine.frame}${this.engine.paused ? ' PAUSED' : ''}</span>\n` +
      `fps   <span class="${cls(p.fps, BUDGET.fps, true)}">${n(p.fps, 1)}</span>\n` +
      `cpu   <span class="${cls(p.cpuMs, BUDGET.cpuMs)}">${n(p.cpuMs, 2)}</span> ms  ` +
      `<span class="dim">p95 ${p95.toFixed(2)}</span>\n` +
      `  sim <span class="dim">${n(p.simMs, 2)} ms   render ${n(p.renderMs, 2)} ms</span>\n` +
      `draws <span class="${cls(p.drawCalls, BUDGET.drawCalls)}">${n(p.drawCalls)}</span> ` +
      `<span class="dim">/ ${BUDGET.drawCalls}</span>\n` +
      `tris  <span class="dim">${(p.triangles / 1000).toFixed(1)}k   progs ${p.programs}</span>`;
  }
}
