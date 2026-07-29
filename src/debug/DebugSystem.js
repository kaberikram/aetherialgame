import { EVENTS } from '../core/EventBus.js';

/**
 * Debug key layout. Reserved slots are declared here from Phase 0 so later
 * phases have somewhere to land without renegotiating the keyboard.
 *
 * F1  overlay: stats (fps / draw calls / tris / cpu ms)   [P0]
 * F2  overlay: hitbox & hurtbox capsules                   [P2]
 * F3  overlay: character state inspector                   [P1]
 * F4  overlay: gamepad raw state + buffered input          [P1]
 * F5  overlay: physics colliders wireframe                 [P1]
 * F6  overlay: navigation / companion path                 [P6]
 * F7  free camera (detach from player)                     [P1]
 * F8  pause simulation  ( . steps one frame while paused )  [P0]
 * F9  cycle per-zone LUT / grading debug                   [P7]
 * F10 toggle post-processing chain                         [P7]
 * F11 grayscale view — the rubric's "does it read" check   [P7]
 * F12 (reserved to the browser, never bound)
 *
 * 1–5  warp to zone: void / descent / green vein / star chamber / pagoda   [P4]
 * 0    god mode
 * -    kill player
 * =    refill flask
 * [ ]  time scale down / up
 * \    reset save and reload
 */
export const DEBUG_KEYS = Object.freeze({
  F1: 'stats',
  F2: 'hitboxes',
  F3: 'state',
  F4: 'gamepad',
  F5: 'colliders',
  F6: 'navigation',
  F7: 'freecam',
  F8: 'pause',
  F9: 'grading',
  F10: 'post',
  F11: 'grayscale',
});

export class DebugSystem {
  updateWhilePaused = true;

  #features = new Map();
  #panels = new Map();

  constructor(engine, root) {
    this.engine = engine;
    this.bus = engine.bus;
    this.root = root;
    this.enabled = true;
    this.timeScale = 1;

    for (const feature of Object.values(DEBUG_KEYS)) this.#features.set(feature, false);

    this.#buildStyles();
    this._onKey = (e) => this.#onKey(e);
    window.addEventListener('keydown', this._onKey);
  }

  isOn(feature) {
    return this.#features.get(feature) === true;
  }

  set(feature, enabled) {
    if (this.#features.get(feature) === enabled) return;
    this.#features.set(feature, enabled);
    const panel = this.#panels.get(feature);
    if (panel) panel.style.display = enabled ? '' : 'none';
    this.bus.emit(EVENTS.DEBUG_TOGGLE, { feature, enabled });
  }

  toggle(feature) {
    this.set(feature, !this.isOn(feature));
  }

  /** Panels are plain DOM. Register once, write into `el` each frame. */
  registerPanel(feature, { corner = 'tl', width = 'auto' } = {}) {
    const el = document.createElement('div');
    el.className = `dbg-panel dbg-${corner}`;
    el.style.width = width;
    el.style.display = this.isOn(feature) ? '' : 'none';
    this.root.appendChild(el);
    this.#panels.set(feature, el);
    return el;
  }

  #onKey(e) {
    const feature = DEBUG_KEYS[e.key];
    if (feature) {
      e.preventDefault();
      if (feature === 'pause') {
        this.engine.setPaused(!this.engine.paused);
      } else {
        this.toggle(feature);
      }
      return;
    }
    if (e.key === '.' && this.engine.paused) {
      e.preventDefault();
      this.engine.stepOnce();
    }
    if (e.key === '[') this.timeScale = Math.max(0.1, this.timeScale - 0.1);
    if (e.key === ']') this.timeScale = Math.min(2, this.timeScale + 0.1);
    if (e.key === '\\' && e.shiftKey) {
      this.engine.resolve('state').clear();
      location.reload();
    }
  }

  #buildStyles() {
    if (document.getElementById('dbg-styles')) return;
    const style = document.createElement('style');
    style.id = 'dbg-styles';
    style.textContent = `
      .dbg-panel {
        position: absolute; pointer-events: none;
        font: 11px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        color: #b9c0cc; background: rgba(6,8,11,.74);
        border: 1px solid rgba(150,170,200,.13); border-radius: 3px;
        padding: 7px 10px; white-space: pre; letter-spacing: .02em;
        backdrop-filter: blur(3px);
      }
      .dbg-tl { top: 10px; left: 10px; }
      .dbg-tr { top: 10px; right: 10px; }
      .dbg-bl { bottom: 10px; left: 10px; }
      .dbg-br { bottom: 10px; right: 10px; }
      .dbg-panel b { color: #e8edf5; font-weight: 600; }
      .dbg-panel .ok { color: #79a86a; }
      .dbg-panel .warn { color: #c99a4e; }
      .dbg-panel .bad { color: #c05f56; }
      .dbg-panel .dim { color: #5c626e; }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    for (const el of this.#panels.values()) el.remove();
    this.#panels.clear();
  }
}
