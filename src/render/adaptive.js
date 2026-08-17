import { PIXEL_RATIO_RUNGS } from './quality.js';

/**
 * AdaptiveResolution — keeps the pixel ratio at the highest rung that still
 * holds the frame budget.
 *
 * Judged on p95, not the mean. A build that averages 60 and dips to 40 four
 * times a second does not feel like 60, and the mean cannot see that.
 *
 * Two rules keep it from oscillating, which is worse than being one rung too
 * low permanently:
 *
 *  - The step-up threshold is well below the step-down threshold, so a frame
 *    time sitting between them holds its rung rather than hunting.
 *  - Stepping up requires the window to be *sustained* good, and every change
 *    clears the window. A rung change costs a real resize, so it must never
 *    happen on noise.
 */

const WINDOW = 90;              // frames of history, ~1.5s at 60fps
const DROP_ABOVE_MS = 15.0;     // p95 worse than this: give up a rung
const RAISE_BELOW_MS = 11.0;    // p95 better than this, sustained: take one back
const RAISE_HOLD_MS = 3000;     // how long "sustained" is
const SETTLE_MS = 800;          // grace after a change, before judging again

export class AdaptiveResolution {
  updateWhilePaused = true;

  constructor(engine, renderer, quality) {
    this.engine = engine;
    this.renderer = renderer;
    this.quality = quality;

    this.enabled = quality.adaptive !== false;
    this.cap = quality.pixelRatioCap ?? 1.5;

    // Never exceed what the display actually has. On a DPR-1 monitor the whole
    // ladder collapses to a single rung and this does nothing, correctly.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    this.rungs = PIXEL_RATIO_RUNGS.filter((r) => r <= Math.min(this.cap, dpr));
    if (this.rungs.length === 0) this.rungs = [Math.min(this.cap, dpr)];

    this.index = this.rungs.length - 1;
    this.samples = [];
    this.goodSince = 0;
    this.settleUntil = 0;
    this.last = performance.now();
  }

  /** The ratio currently applied. */
  get pixelRatio() {
    return this.rungs[this.index];
  }

  /** p95 of the current window, or 0 before it fills. */
  get p95() {
    if (this.samples.length < WINDOW) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  update() {
    const now = performance.now();
    const frameMs = now - this.last;
    this.last = now;

    if (!this.enabled) return;
    // A tab that was backgrounded produces one enormous frame. Judging on it
    // would drop the ratio for a reason that has nothing to do with the scene.
    if (frameMs > 250) { this.#reset(now); return; }

    this.samples.push(frameMs);
    if (this.samples.length > WINDOW) this.samples.shift();
    if (now < this.settleUntil || this.samples.length < WINDOW) return;

    const p95 = this.p95;

    if (p95 > DROP_ABOVE_MS && this.index > 0) {
      this.#apply(this.index - 1, now);
      return;
    }

    if (p95 < RAISE_BELOW_MS && this.index < this.rungs.length - 1) {
      if (this.goodSince === 0) this.goodSince = now;
      else if (now - this.goodSince > RAISE_HOLD_MS) this.#apply(this.index + 1, now);
    } else {
      this.goodSince = 0;
    }
  }

  #apply(index, now) {
    this.index = index;
    this.renderer.setPixelRatio(this.rungs[index]);
    this.#reset(now);
  }

  #reset(now) {
    this.samples.length = 0;
    this.goodSince = 0;
    this.settleUntil = now + SETTLE_MS;
  }
}
