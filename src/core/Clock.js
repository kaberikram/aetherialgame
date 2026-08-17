/**
 * Clock — fixed-timestep accumulator with a spiral-of-death guard.
 *
 * If a frame takes 400ms (tab restored, GC pause, shader compile) we do not
 * try to catch up 24 simulation steps; we drop the backlog. Dropping time is
 * strictly better than a stall that cascades into a longer stall.
 */
export class Clock {
  #fixedDelta;
  #maxSubSteps;
  #accumulator = 0;
  #last = 0;
  #fpsAccum = 0;
  #fpsFrames = 0;
  fps = 0;
  elapsed = 0;

  constructor({ fixedHz = 60, maxSubSteps = 5 } = {}) {
    this.#fixedDelta = 1 / fixedHz;
    this.#maxSubSteps = maxSubSteps;
  }

  get fixedDelta() {
    return this.#fixedDelta;
  }

  reset() {
    this.#last = performance.now();
    this.#accumulator = 0;
  }

  /**
   * @param {boolean} paused
   * @param {number} timeScale debug slow-motion. Scales how much real time is
   *   fed to the accumulator — so fewer fixed steps run — rather than scaling
   *   the step itself. The step must stay exactly 1/60 or frame data stops
   *   meaning anything, and determinism goes with it.
   */
  advance(paused = false, timeScale = 1) {
    const now = performance.now();
    if (this.#last === 0) this.#last = now;
    // Clamp a single frame's contribution. 250ms is a quarter second of
    // real time thrown away, which the player reads as a hitch, not a warp.
    let delta = Math.min((now - this.#last) / 1000, 0.25);
    this.#last = now;

    this.#fpsAccum += delta;
    this.#fpsFrames++;
    if (this.#fpsAccum >= 0.5) {
      this.fps = this.#fpsFrames / this.#fpsAccum;
      this.#fpsAccum = 0;
      this.#fpsFrames = 0;
    }

    if (paused) return { steps: 0, alpha: 1, delta };

    const scaled = delta * timeScale;
    this.elapsed += scaled;
    this.#accumulator += scaled;

    let steps = 0;
    while (this.#accumulator >= this.#fixedDelta && steps < this.#maxSubSteps) {
      this.#accumulator -= this.#fixedDelta;
      steps++;
    }
    // Backlog beyond maxSubSteps is discarded rather than deferred.
    if (this.#accumulator > this.#fixedDelta) this.#accumulator = 0;

    return { steps, alpha: this.#accumulator / this.#fixedDelta, delta: scaled };
  }
}
