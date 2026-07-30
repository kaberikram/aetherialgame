import { EVENTS } from '../core/EventBus.js';

/** Key names shown in prompts, per device. */
const KEY_HINTS = {
  kbm: { interact: 'E' },
  gamepad: { interact: 'A' },
};

/**
 * HUD — plain DOM, driven by events, never polled, never load-bearing.
 *
 * Souls HUDs are quiet: bars in the corner, nothing centred, nothing animated
 * unless it changed. The stamina bar fades out when full, because a bar you
 * are not spending is noise on top of the frame.
 */
export class HUD {
  updateWhilePaused = true;

  constructor(engine, player) {
    this.engine = engine;
    this.player = player;
    this.bus = engine.bus;

    this.root = document.createElement('div');
    this.root.className = 'hud';
    document.getElementById('ui-root').appendChild(this.root);
    this.#styles();

    this.root.innerHTML = `
      <div class="hud-bars">
        <div class="hud-bar hud-health"><i></i><em></em></div>
        <div class="hud-bar hud-stamina"><i></i></div>
      </div>
      <div class="hud-subtitle"></div>
      <div class="hud-prompt"></div>
      <div class="hud-hint"></div>
    `;
    this.healthFill = this.root.querySelector('.hud-health i');
    this.healthGhost = this.root.querySelector('.hud-health em');
    this.staminaBar = this.root.querySelector('.hud-stamina');
    this.staminaFill = this.root.querySelector('.hud-stamina i');
    this.subtitle = this.root.querySelector('.hud-subtitle');
    this.prompt = this.root.querySelector('.hud-prompt');
    this.hintEl = this.root.querySelector('.hud-hint');
    this.bars = this.root.querySelector('.hud-bars');
    this.device = 'kbm';
    this.explicitHint = null;
    this.input = engine.services.get('input') ?? null;
    this.bus.on(EVENTS.INPUT_DEVICE_CHANGED, ({ device }) => { this.device = device; });

    this.staminaHideTimer = 0;
    this.subtitleTimer = 0;
    this.visible = true;

    this.bus.on(EVENTS.DIALOGUE_LINE, ({ speaker, text, duration }) => {
      this.subtitle.innerHTML = `<span class="who">${speaker}</span>${text}`;
      this.subtitle.classList.add('on');
      this.subtitleTimer = duration ?? 4.5;
    });
    this.bus.on(EVENTS.INTERACT_AVAILABLE, (payload) => {
      if (!payload) {
        this.prompt.classList.remove('on');
      } else {
        // The prompt names its key. A label with no key is a riddle, and the
        // first playtest proved players do not solve riddles — they mash.
        const key = KEY_HINTS[this.device]?.interact ?? 'E';
        this.prompt.innerHTML = `${payload.label} <kbd>${key}</kbd>`;
        this.prompt.classList.add('on');
      }
    });
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.opacity = v ? '1' : '0';
  }

  /**
   * Hides the stat bars only. Subtitles, prompts and hints stay live — the
   * void sequence has no health to show but absolutely has things to say,
   * and hiding the whole HUD there is how the first playtest got stuck.
   */
  setBarsVisible(v) {
    this.bars.style.opacity = v ? '1' : '0';
  }

  /**
   * Input-affordance hint line. `setHint(text)` from gameplay wins; with no
   * explicit hint, an unlocked pointer on keyboard/mouse shows "click to look"
   * on its own, because a mouse camera that silently does nothing is the
   * single most confusing state a web game can be in.
   */
  setHint(text) {
    this.explicitHint = text || null;
  }

  #renderHint() {
    const lockHint = this.device === 'kbm' && this.input && !this.input.pointerLocked && this.visible
      ? 'click to look around'
      : null;
    const text = this.explicitHint ?? lockHint;
    if (text) {
      if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
      this.hintEl.classList.add('on');
    } else {
      this.hintEl.classList.remove('on');
    }
  }

  update(dt) {
    const st = this.player.stamina;
    const pct = st.normalized * 100;
    this.staminaFill.style.width = `${pct}%`;
    this.staminaBar.classList.toggle('exhausted', st.exhausted);

    // Fade the stamina bar out once it has been full for a moment.
    if (st.normalized > 0.999) this.staminaHideTimer += dt;
    else this.staminaHideTimer = 0;
    this.staminaBar.classList.toggle('idle', this.staminaHideTimer > 1.1);

    const hp = this.player.health;
    if (hp) {
      this.healthFill.style.width = `${(hp.current / hp.max) * 100}%`;
      // The ghost bar drains behind the real one, so you can see how much a
      // hit actually took rather than just that it happened.
      const ghost = parseFloat(this.healthGhost.style.width) || 100;
      const target = (hp.current / hp.max) * 100;
      this.healthGhost.style.width = `${ghost > target ? Math.max(target, ghost - dt * 26) : target}%`;
    }

    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.remove('on');
    }

    this.#renderHint();
  }

  #styles() {
    if (document.getElementById('hud-styles')) return;
    const s = document.createElement('style');
    s.id = 'hud-styles';
    s.textContent = `
      .hud { position:absolute; inset:0; transition:opacity .5s ease; }
      .hud-bars { position:absolute; left:38px; top:34px; width:296px; }
      .hud-bar {
        position:relative; height:11px; margin-bottom:7px;
        background:rgba(6,7,9,.72); border:1px solid rgba(0,0,0,.6);
        box-shadow:inset 0 1px 2px rgba(0,0,0,.7), 0 0 0 1px rgba(190,200,215,.07);
        transition:opacity .55s ease;
      }
      .hud-bar > i, .hud-bar > em {
        position:absolute; inset:0 auto 0 0; display:block; width:100%;
      }
      .hud-health > em { background:#6b2f2a; z-index:0; }
      .hud-health > i {
        z-index:1;
        background:linear-gradient(180deg,#a8433c 0%,#8a3029 55%,#6d241f 100%);
        transition:width .18s ease-out;
      }
      .hud-stamina { width:74%; height:8px; }
      .hud-stamina > i {
        background:linear-gradient(180deg,#7d8a5f 0%,#606b47 60%,#4a5336 100%);
      }
      .hud-stamina.idle { opacity:.24; }
      .hud-stamina.exhausted > i { background:linear-gradient(180deg,#8a6a3a 0%,#5e4726 100%); }

      .hud-subtitle {
        position:absolute; left:50%; bottom:12%; transform:translateX(-50%) translateY(6px);
        max-width:min(58ch,74vw); text-align:center; opacity:0;
        font:400 15px/1.75 ui-serif, Georgia, "Times New Roman", serif;
        color:#cdd3dc; letter-spacing:.012em; text-shadow:0 2px 14px rgba(0,0,0,.95);
        transition:opacity .55s ease, transform .55s ease; pointer-events:none;
      }
      .hud-subtitle.on { opacity:1; transform:translateX(-50%) translateY(0); }
      .hud-subtitle .who {
        display:block; font:400 10px/1 ui-monospace,monospace; letter-spacing:.34em;
        text-transform:uppercase; color:#6d7480; margin-bottom:9px;
      }
      .hud-prompt {
        position:absolute; left:50%; bottom:30%; transform:translateX(-50%);
        opacity:0; transition:opacity .3s ease;
        font:400 17px/1 ui-serif, Georgia, serif; letter-spacing:.14em;
        color:#e4e9f1; text-shadow:0 2px 14px #000, 0 0 24px rgba(0,0,0,.9);
        padding:10px 22px; background:rgba(5,7,10,.55);
        border:1px solid rgba(190,205,225,.22); border-radius:2px;
        white-space:nowrap;
      }
      .hud-prompt.on { opacity:1; }
      .hud-prompt kbd {
        display:inline-block; margin-left:12px; padding:2px 9px;
        font:600 12px/1.4 ui-monospace,monospace; letter-spacing:0;
        color:#0c0e12; background:#c8d0dc; border-radius:3px;
        box-shadow:0 2px 0 #7d8590; vertical-align:2px;
      }
      .hud-hint {
        position:absolute; left:50%; bottom:7%; transform:translateX(-50%);
        opacity:0; transition:opacity .6s ease;
        font:400 12px/1 ui-monospace,monospace; letter-spacing:.22em;
        text-transform:lowercase; color:#88909c; text-shadow:0 2px 10px #000;
        white-space:nowrap;
      }
      .hud-hint.on { opacity:.85; }
    `;
    document.head.appendChild(s);
  }

  dispose() {
    this.root.remove();
  }
}
