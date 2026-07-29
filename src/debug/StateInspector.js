import { TUNING } from '../tuning.js';
import { STATE } from '../character/PlayerController.js';

/**
 * F3 — character state inspector. This is the panel you actually stare at
 * while tuning: state, frame count within the state, i-frame window, stamina,
 * grounded, speed, and what is sitting in the input buffer.
 *
 * The i-frame readout is the important one. "Does the roll feel good" usually
 * decomposes into "are the i-frames where I think they are", and that is only
 * answerable if you can see them.
 */
export class StateInspector {
  updateWhilePaused = true;

  constructor(engine, debug, player, lockOn) {
    this.engine = engine;
    this.player = player;
    this.lockOn = lockOn;
    this.debug = debug;
    this.el = debug.registerPanel('state', { corner: 'bl' });
    this.accum = 0;
  }

  update(dt) {
    this.accum += dt;
    if (this.accum < 0.05 || !this.debug.isOn('state')) return;
    this.accum = 0;

    const p = this.player;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    const st = p.stamina;

    const bar = (v, max, width = 18, cls = '') => {
      const filled = Math.round((v / max) * width);
      return `<span class="${cls}">${'█'.repeat(Math.max(0, filled))}</span>` +
        `<span class="dim">${'░'.repeat(Math.max(0, width - filled))}</span>`;
    };

    let iframeLine = '';
    if (p.state === STATE.ROLL) {
      const R = TUNING.roll;
      const f = Math.floor(p.stateFrame);
      const cells = [];
      for (let i = 0; i < R.totalFrames; i += 2) {
        const inv = i >= R.invulnStartFrame && i < R.invulnStartFrame + R.invulnFrames;
        const rec = i >= R.recoveryStartFrame;
        const here = Math.abs(i - f) <= 1;
        const ch = here ? '▮' : inv ? '▪' : rec ? '·' : '─';
        const cls = here ? '' : inv ? 'ok' : rec ? 'warn' : 'dim';
        cells.push(`<span class="${cls}">${ch}</span>`);
      }
      iframeLine = `\niframe ${cells.join('')}  <span class="${p.invulnerable ? 'ok' : 'dim'}">${p.invulnerable ? 'INVULN' : '—'}</span>`;
    }

    this.el.innerHTML =
      `<b>state</b>  ${p.state.padEnd(10)} <span class="dim">f${String(Math.floor(p.stateFrame)).padStart(3)}</span>` +
      `  ${p.canAct() ? '<span class="ok">can act</span>' : '<span class="warn">committed</span>'}` +
      iframeLine +
      `\nstam   ${bar(st.current, st.max, 18, st.exhausted ? 'bad' : 'ok')} ${st.current.toFixed(0).padStart(3)}/${st.max}` +
      (st.delayFrames > 0 ? ` <span class="warn">delay ${st.delayFrames}</span>` : '') +
      `\nspeed  ${speed.toFixed(2).padStart(5)} m/s   ${p.grounded ? '<span class="ok">grounded</span>' : `<span class="warn">air ${p.velocity.y.toFixed(1)}</span>`}` +
      `\npos    ${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)}` +
      `\nfacing ${((p.facing * 180) / Math.PI).toFixed(0)}°` +
      (p.waterDepth > 0.01 ? `  <span class="warn">water ${p.waterDepth.toFixed(2)}m</span>` : '') +
      `\nlock   ${this.lockOn?.target ? `<span class="ok">${this.lockOn.target.name ?? 'target'}</span>` : '<span class="dim">none</span>'}` +
      `\nbuffer ${p.buffer.pending ? `<span class="ok">${p.buffer.pending}</span>` : '<span class="dim">—</span>'}` +
      `\nanim   <span class="dim">${p.anim.playing.filter((x) => x.weight > 0.02).map((x) => `${x.clip.id}:${x.weight.toFixed(2)}`).join(' ') || '—'}</span>`;
  }
}
