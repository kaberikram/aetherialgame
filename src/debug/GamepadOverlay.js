import { ACTION } from '../input/Actions.js';
import { TUNING } from '../tuning.js';

/**
 * F4 — gamepad state overlay, required by CONTROLS.md.
 *
 * Raw stick vectors, both trigger analog values, deadzone-applied output, and
 * the buffered input. This is the panel you tune the deflect trigger-velocity
 * threshold against; without it, "a hard fast pull" is guesswork.
 */
export class GamepadOverlay {
  updateWhilePaused = true;

  constructor(engine, debug, input, player) {
    this.debug = debug;
    this.input = input;
    this.player = player;
    this.el = debug.registerPanel('gamepad', { corner: 'br' });
    this.accum = 0;
    this.peakGuardVelocity = 0;
  }

  update(dt) {
    this.accum += dt;
    if (this.accum < 0.04 || !this.debug.isOn('gamepad')) return;
    this.accum = 0;

    const inp = this.input;
    const guard = inp.actions[ACTION.GUARD];
    const heavy = inp.actions[ACTION.HEAVY_ATTACK];
    this.peakGuardVelocity = Math.max(this.peakGuardVelocity * 0.97, guard.velocity);

    const meter = (v, width = 14) => {
      const filled = Math.round(Math.min(1, Math.max(0, v)) * width);
      return `<span class="ok">${'▰'.repeat(filled)}</span><span class="dim">${'▱'.repeat(width - filled)}</span>`;
    };
    const vec = (x, y) => `${x >= 0 ? ' ' : ''}${x.toFixed(3)}, ${y >= 0 ? ' ' : ''}${y.toFixed(3)}`;

    const deflectReady = inp.isDeflectInput();
    const cfg = TUNING.combat;

    const held = Object.entries(inp.actions)
      .filter(([, s]) => s.held)
      .map(([a]) => a)
      .join(' ') || '—';

    this.el.innerHTML =
      `<b>input</b> <span class="dim">${inp.device}${inp.device === 'gamepad' ? ` #${inp.gamepadIndex}` : (inp.pointerLocked ? ' locked' : ' click to lock')}</span>` +
      `\nstick raw  ${vec(inp.moveRaw.x, inp.moveRaw.y)}` +
      `\n  → curved ${vec(inp.move.x, inp.move.y)}  <span class="dim">|${inp.moveMagnitude.toFixed(2)}|</span>` +
      `\nlook       ${vec(inp.look.x, inp.look.y)}` +
      `\n` +
      `\nLT guard   ${meter(guard.value)} ${guard.value.toFixed(2)}` +
      `\n  velocity ${guard.velocity.toFixed(1).padStart(6)}  <span class="dim">peak ${this.peakGuardVelocity.toFixed(1)} / need ${cfg.deflectTriggerVelocity}</span>` +
      `\n  deflect  ${deflectReady ? '<span class="ok">▶ DEFLECT</span>' : '<span class="dim">guard</span>'}` +
      `\nRT heavy   ${meter(heavy.value)} ${heavy.value.toFixed(2)}` +
      `\n` +
      `\nheld     <span class="dim">${held}</span>` +
      `\nbuffered ${this.player.buffer.pending ? `<span class="ok">${this.player.buffer.pending}</span>` : '<span class="dim">—</span>'}`;
  }
}
