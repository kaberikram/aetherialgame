import { EVENTS } from '../core/EventBus.js';

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
    `;
    this.healthFill = this.root.querySelector('.hud-health i');
    this.healthGhost = this.root.querySelector('.hud-health em');
    this.staminaBar = this.root.querySelector('.hud-stamina');
    this.staminaFill = this.root.querySelector('.hud-stamina i');
    this.subtitle = this.root.querySelector('.hud-subtitle');
    this.prompt = this.root.querySelector('.hud-prompt');

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
        this.prompt.textContent = payload.label;
        this.prompt.classList.add('on');
      }
    });
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.opacity = v ? '1' : '0';
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
        position:absolute; left:50%; bottom:26%; transform:translateX(-50%);
        opacity:0; transition:opacity .3s ease;
        font:400 12px/1 ui-monospace,monospace; letter-spacing:.2em;
        text-transform:uppercase; color:#aeb6c2; text-shadow:0 2px 10px #000;
      }
      .hud-prompt.on { opacity:.92; }
    `;
    document.head.appendChild(s);
  }

  dispose() {
    this.root.remove();
  }
}
