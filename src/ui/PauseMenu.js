import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';

const KBM_CONTROLS = [
  ['wasd', 'move  ·  hold alt to creep'],
  ['mouse', 'camera  —  click the game once to capture it'],
  ['space', 'dodge / roll  (direction from wasd at the press)'],
  ['shift', 'sprint'],
  ['f', 'jump  ·  with wings: take off, hold to climb'],
  ['left / right click', 'light / heavy attack'],
  ['q  (hold)', 'guard  —  a fresh tap as a hit lands deflects'],
  ['r', 'flask'],
  ['e', 'interact'],
  ['tab', 'lock on / release'],
  ['c', 'alignment ability'],
  ['esc', 'pause'],
];

const PAD_CONTROLS = [
  ['left stick', 'move'],
  ['right stick', 'camera  ·  click: lock on'],
  ['A', 'jump / interact  ·  with wings: fly'],
  ['B', 'dodge / roll / backstep'],
  ['X', 'flask'],
  ['Y / LB', 'alignment ability'],
  ['RB / RT', 'light / heavy attack'],
  ['LT', 'guard  —  a hard fast pull deflects'],
  ['menu', 'pause'],
];

/**
 * PauseMenu — Escape (or the pad's Menu button) pauses the simulation and
 * shows the controls for whichever device is active.
 *
 * Deliberately self-contained on raw DOM/gamepad events rather than the
 * InputSystem action pipeline: the action pipeline stops when the engine
 * pauses, which would make the pause key unable to unpause.
 */
export class PauseMenu {
  updateWhilePaused = true;

  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.input = engine.resolve('input');
    this.open = false;
    this.menuButtonWasDown = false;

    this.#build();

    this._onKey = (e) => {
      if (e.key === 'Escape') this.toggle();
    };
    window.addEventListener('keydown', this._onKey);
  }

  #build() {
    const el = document.createElement('div');
    el.className = 'pause-menu';
    el.innerHTML = `
      <div class="pause-inner">
        <div class="pause-title">VESSEL</div>
        <div class="pause-sub">paused</div>
        <div class="pause-settings">
          <div class="pause-row">
            <span class="pause-label">look sensitivity</span>
            <button class="pause-btn" data-act="sens-down">−</button>
            <span class="pause-value" data-val="sens">100%</span>
            <button class="pause-btn" data-act="sens-up">+</button>
          </div>
          <div class="pause-row">
            <span class="pause-label">invert look</span>
            <button class="pause-btn pause-wide" data-act="invert">off</button>
          </div>
        </div>
        <table class="pause-controls"></table>
        <div class="pause-resume">esc — resume</div>
      </div>
    `;
    // Clicking the backdrop resumes; clicking a setting must not. Without this
    // the menu closes the instant you try to adjust anything.
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const act = e.target?.dataset?.act;
      if (act) { this.#onSetting(act); return; }
      if (e.target === el || e.target.closest('.pause-inner') === null) this.toggle();
    });
    document.getElementById('ui-root').appendChild(el);
    this.el = el;
    this.table = el.querySelector('.pause-controls');
    this.#loadSettings();

    if (!document.getElementById('pause-styles')) {
      const s = document.createElement('style');
      s.id = 'pause-styles';
      s.textContent = `
        .pause-menu {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          background:rgba(3,4,6,.82); backdrop-filter:blur(4px);
          opacity:0; pointer-events:none; transition:opacity .25s ease; z-index:40;
        }
        .pause-menu.on { opacity:1; pointer-events:auto; cursor:pointer; }
        .pause-inner { text-align:center; }
        .pause-title {
          font:400 15px/1 ui-monospace,monospace; letter-spacing:.72em; text-indent:.72em;
          color:#8b93a1; margin-bottom:6px;
        }
        .pause-sub {
          font:400 10px/1 ui-monospace,monospace; letter-spacing:.34em;
          color:#4d525c; margin-bottom:30px; text-transform:uppercase;
        }
        .pause-controls { margin:0 auto; border-collapse:collapse; text-align:left; }
        .pause-controls td {
          font:400 12.5px/2.1 ui-monospace,monospace; color:#9aa2ae; padding:0 10px;
        }
        .pause-controls td:first-child {
          text-align:right; color:#d5dae2; letter-spacing:.05em; white-space:nowrap;
        }
        .pause-resume {
          margin-top:32px; font:400 11px/1 ui-monospace,monospace;
          letter-spacing:.26em; color:#565c66;
        }
        .pause-settings {
          margin:0 auto 26px; display:flex; flex-direction:column; gap:8px;
          align-items:center;
        }
        .pause-row { display:flex; align-items:center; gap:8px; }
        .pause-label {
          font:400 12.5px/1 ui-monospace,monospace; color:#9aa2ae;
          width:132px; text-align:right;
        }
        .pause-value {
          font:400 12.5px/1 ui-monospace,monospace; color:#d5dae2;
          width:46px; text-align:center;
        }
        .pause-btn {
          font:400 12.5px/1 ui-monospace,monospace; color:#d5dae2;
          background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14);
          border-radius:3px; padding:4px 9px; cursor:pointer; min-width:26px;
        }
        .pause-btn:hover { background:rgba(255,255,255,.13); }
        .pause-wide { min-width:46px; }
      `;
      document.head.appendChild(s);
    }
  }

  /**
   * Look settings live here rather than in tuning.js because they are the
   * player's preference, not the game's design. "Too fast" and "inverted" are
   * the two complaints a third-person camera reliably generates, and neither
   * has a correct answer someone else gets to pick.
   *
   * Sensitivity is stored as a multiplier and applied to both device
   * sensitivities, so switching between mouse and pad keeps the same feel.
   */
  #loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('vessel.look') ?? '{}'); } catch { /* first run */ }
    this.baseMouse = TUNING.camera.lookSensitivityMouse;
    this.basePad = TUNING.camera.lookSensitivityGamepad;
    this.sens = saved.sens ?? 1;
    this.invert = saved.invert ?? false;
    this.#applySettings();
  }

  #applySettings() {
    TUNING.camera.lookSensitivityMouse = this.baseMouse * this.sens;
    TUNING.camera.lookSensitivityGamepad = this.basePad * this.sens;
    TUNING.input.kbm.invertY = this.invert;
    TUNING.input.gamepad.invertY = this.invert;

    const v = this.el.querySelector('[data-val="sens"]');
    if (v) v.textContent = `${Math.round(this.sens * 100)}%`;
    const b = this.el.querySelector('[data-act="invert"]');
    if (b) b.textContent = this.invert ? 'on' : 'off';

    try {
      localStorage.setItem('vessel.look', JSON.stringify({ sens: this.sens, invert: this.invert }));
    } catch { /* private browsing */ }
  }

  #onSetting(act) {
    if (act === 'sens-up') this.sens = Math.min(3, +(this.sens + 0.1).toFixed(2));
    else if (act === 'sens-down') this.sens = Math.max(0.2, +(this.sens - 0.1).toFixed(2));
    else if (act === 'invert') this.invert = !this.invert;
    this.#applySettings();
  }

  toggle() {
    this.open = !this.open;
    if (this.open) {
      const rows = this.input.device === 'gamepad' ? PAD_CONTROLS : KBM_CONTROLS;
      this.table.innerHTML = rows
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join('');
    }
    this.el.classList.toggle('on', this.open);
    this.engine.setPaused(this.open);
  }

  /** Pad Menu button, polled directly — the action pipeline is paused. */
  update() {
    const pad = this.input.gamepad;
    if (!pad) return;
    const down = pad.buttons[9]?.pressed ?? false;
    if (down && !this.menuButtonWasDown) this.toggle();
    this.menuButtonWasDown = down;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.el.remove();
  }
}
