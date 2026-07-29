import { EventBus, EVENTS } from './EventBus.js';
import { Clock } from './Clock.js';

/**
 * Engine — owns the frame. Nothing else calls requestAnimationFrame.
 *
 * Simulation runs on a fixed 60Hz step so physics, frame data and input
 * sampling are all deterministic and expressed in whole frames. Combat in a
 * souls-like is authored in frames ("14 startup, 4 active, 22 recovery") and
 * that only means something if the step never varies.
 *
 * Rendering runs once per animation frame with an interpolation alpha, so a
 * 144Hz display gets smooth motion off a 60Hz simulation.
 *
 * Modules are registered with a priority; lower runs first. Ordering matters:
 * input must be sampled before the character reads it, physics must step before
 * the camera resolves collision against the new position.
 */

export const STAGE = Object.freeze({
  INPUT: 100,
  NARRATIVE: 150,
  AI: 200,
  CHARACTER: 300,
  COMBAT: 400,
  PHYSICS: 500,
  ANIMATION: 600,
  CAMERA: 700,
  WORLD: 800,
  AUDIO: 850,
  UI: 900,
  RENDER: 1000,
  DEBUG: 1100,
});

export class Engine {
  /** @type {EventBus} */ bus;
  /** @type {Map<string, object>} */ services = new Map();

  #modules = [];
  #running = false;
  #rafId = 0;
  #clock;
  #paused = false;
  #frame = 0;

  // Rolling perf counters, read by the debug overlay and the smoke harness.
  perf = {
    fps: 0,
    frameMs: 0,
    cpuMs: 0, // sim + render dispatch, excludes GPU wait
    simMs: 0,
    renderMs: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    steps: 0,
  };

  constructor({ fixedHz = 60, maxSubSteps = 5 } = {}) {
    this.bus = new EventBus();
    this.#clock = new Clock({ fixedHz, maxSubSteps });
  }

  get frame() {
    return this.#frame;
  }
  get fixedDelta() {
    return this.#clock.fixedDelta;
  }
  get paused() {
    return this.#paused;
  }

  /** Register a service other modules resolve by name. */
  provide(name, instance) {
    if (this.services.has(name)) throw new Error(`Engine: service "${name}" already provided`);
    this.services.set(name, instance);
    return instance;
  }

  resolve(name) {
    const s = this.services.get(name);
    if (!s) throw new Error(`Engine: no service "${name}"`);
    return s;
  }

  has(name) {
    return this.services.has(name);
  }

  /**
   * @param {object} module - may implement fixedUpdate(dt, ctx), update(dt, alpha, ctx),
   *                          render(alpha), dispose(). All optional.
   */
  add(module, priority = STAGE.WORLD) {
    module.__priority = priority;
    this.#modules.push(module);
    this.#modules.sort((a, b) => a.__priority - b.__priority);
    return module;
  }

  remove(module) {
    const i = this.#modules.indexOf(module);
    if (i >= 0) this.#modules.splice(i, 1);
    module.dispose?.();
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#clock.reset();
    this.bus.emit(EVENTS.ENGINE_READY);
    const loop = () => {
      this.#rafId = requestAnimationFrame(loop);
      this.#tick();
    };
    this.#rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.#running = false;
    cancelAnimationFrame(this.#rafId);
  }

  setPaused(paused) {
    if (this.#paused === paused) return;
    this.#paused = paused;
    this.#clock.reset();
    this.bus.emit(paused ? EVENTS.ENGINE_PAUSE : EVENTS.ENGINE_RESUME);
  }

  /** Advance exactly one fixed step while paused. Debug key. */
  stepOnce() {
    if (!this.#paused) return;
    this.#fixedStep(this.#clock.fixedDelta);
  }

  #tick() {
    const t0 = performance.now();
    const { steps, alpha, delta } = this.#clock.advance(this.#paused);
    this.perf.steps = steps;

    const simStart = performance.now();
    if (!this.#paused) {
      for (let i = 0; i < steps; i++) this.#fixedStep(this.#clock.fixedDelta);
      const ctx = { frame: this.#frame, paused: false };
      for (const m of this.#modules) m.update?.(delta, alpha, ctx);
    } else {
      // Paused still updates presentation-only modules so debug cameras and
      // overlays stay live while the simulation is frozen.
      const ctx = { frame: this.#frame, paused: true };
      for (const m of this.#modules) {
        if (m.updateWhilePaused) m.update?.(delta, alpha, ctx);
      }
    }
    const simEnd = performance.now();

    for (const m of this.#modules) m.render?.(alpha);
    const t1 = performance.now();

    this.perf.simMs = simEnd - simStart;
    this.perf.renderMs = t1 - simEnd;
    this.perf.cpuMs = t1 - t0;
    this.perf.frameMs = delta * 1000;
    this.perf.fps = this.#clock.fps;
  }

  #fixedStep(dt) {
    this.#frame++;
    const ctx = { frame: this.#frame };
    for (const m of this.#modules) m.fixedUpdate?.(dt, ctx);
  }

  dispose() {
    this.stop();
    for (const m of [...this.#modules].reverse()) m.dispose?.();
    this.#modules.length = 0;
    this.bus.clear();
    this.services.clear();
  }
}
