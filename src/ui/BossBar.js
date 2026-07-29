import { EVENTS } from '../core/EventBus.js';

/**
 * Boss health bar and name plate.
 *
 * Souls convention, and it earns its place: the bar appears only once the
 * fight starts, sits low and wide, and carries a ghost that drains behind the
 * real value so a big hit is legible as a big hit. The name is small and
 * under-stated — the creature is what should be intimidating, not the label.
 */
export class BossBar {
  updateWhilePaused = true;

  constructor(engine) {
    this.bus = engine.bus;
    this.root = document.createElement('div');
    this.root.className = 'boss-bar';
    document.getElementById('ui-root').appendChild(this.root);
    this.#styles();

    this.root.innerHTML = `
      <div class="boss-name"></div>
      <div class="boss-track"><em></em><i></i></div>
    `;
    this.nameEl = this.root.querySelector('.boss-name');
    this.fill = this.root.querySelector('.boss-track i');
    this.ghost = this.root.querySelector('.boss-track em');
    this.ghostPct = 100;
    this.targetPct = 100;

    this.bus.on(EVENTS.BOSS_ENCOUNTER_START, ({ name }) => {
      this.nameEl.textContent = name;
      this.ghostPct = this.targetPct = 100;
      this.fill.style.width = '100%';
      this.ghost.style.width = '100%';
      this.root.classList.add('on');
    });
    this.bus.on(EVENTS.BOSS_HEALTH_CHANGED, ({ current, max }) => {
      this.targetPct = Math.max(0, (current / max) * 100);
      this.fill.style.width = `${this.targetPct}%`;
    });
    this.bus.on(EVENTS.BOSS_PHASE_CHANGED, () => this.root.classList.add('phase2'));
    this.bus.on(EVENTS.BOSS_DEFEATED, () => {
      this.root.classList.remove('on');
      setTimeout(() => this.root.classList.remove('phase2'), 900);
    });
    this.bus.on(EVENTS.PLAYER_DIED, () => this.root.classList.remove('on'));
  }

  update(dt) {
    if (this.ghostPct > this.targetPct) {
      this.ghostPct = Math.max(this.targetPct, this.ghostPct - dt * 22);
      this.ghost.style.width = `${this.ghostPct}%`;
    } else if (this.ghostPct < this.targetPct) {
      this.ghostPct = this.targetPct;
      this.ghost.style.width = `${this.ghostPct}%`;
    }
  }

  #styles() {
    if (document.getElementById('boss-bar-styles')) return;
    const s = document.createElement('style');
    s.id = 'boss-bar-styles';
    s.textContent = `
      .boss-bar {
        position:absolute; left:50%; bottom:8.5%; transform:translateX(-50%) translateY(10px);
        width:min(620px, 62vw); opacity:0; pointer-events:none;
        transition:opacity .7s ease, transform .7s ease;
      }
      .boss-bar.on { opacity:1; transform:translateX(-50%) translateY(0); }
      .boss-name {
        font:400 12px/1 ui-serif, Georgia, serif; letter-spacing:.30em; text-indent:.30em;
        text-transform:uppercase; color:#a9b0bb; text-align:center; margin-bottom:8px;
        text-shadow:0 2px 10px #000;
      }
      .boss-track {
        position:relative; height:8px; background:rgba(5,6,8,.82);
        border:1px solid rgba(0,0,0,.7);
        box-shadow:inset 0 1px 3px rgba(0,0,0,.85), 0 0 0 1px rgba(190,200,215,.09);
      }
      .boss-track > i, .boss-track > em { position:absolute; inset:0 auto 0 0; display:block; height:100%; }
      .boss-track > em { background:#6d2b26; z-index:0; }
      .boss-track > i {
        z-index:1; background:linear-gradient(180deg,#9c3d36 0%,#7d2a24 60%,#5f1c18 100%);
        transition:width .16s ease-out;
      }
      /* Phase two shifts the bar cooler, matching the star dimming. */
      .boss-bar.phase2 .boss-track > i {
        background:linear-gradient(180deg,#8a4a6d 0%,#68304f 60%,#4c2039 100%);
      }
      .boss-bar.phase2 .boss-name { color:#c0a8bc; }
    `;
    document.head.appendChild(s);
  }

  dispose() {
    this.root.remove();
  }
}
