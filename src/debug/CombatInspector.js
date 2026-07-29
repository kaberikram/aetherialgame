/**
 * F2 — hitbox visualisation and the frame-data readout.
 *
 * The frame ribbon is the useful part. It draws the current move as
 * startup / active / recovery cells with a cursor on the live frame, so
 * "attacks commit" stops being a claim and becomes something you can watch:
 * the cursor cannot leave the active band early, and the recovery band is
 * visibly longer than the startup band.
 */
export class CombatInspector {
  updateWhilePaused = true;

  constructor(engine, debug, player, dummies = []) {
    this.engine = engine;
    this.debug = debug;
    this.player = player;
    this.dummies = dummies;
    this.el = debug.registerPanel('hitboxes', { corner: 'tr', width: '360px' });
    this.hitboxes = engine.resolve('hitboxes');
    this.hitboxes.buildDebug(engine.resolve('renderer').scene);
    this.accum = 0;
  }

  update(dt) {
    const on = this.debug.isOn('hitboxes');
    this.hitboxes.updateDebug(on);
    this.accum += dt;
    if (this.accum < 0.05 || !on) return;
    this.accum = 0;

    const p = this.player;
    const move = p.currentMove;
    let ribbon = '<span class="dim">no move active</span>';

    if (move) {
      const f = Math.floor(p.moveFrame);
      const cells = [];
      const [a0, a1] = move.active;
      const [c0, c1] = move.chainWindow?.length ? move.chainWindow : [-1, -1];
      for (let i = 0; i < move.frames; i++) {
        const here = Math.abs(i - f) < 1;
        const active = i >= a0 && i <= a1;
        const chain = i >= c0 && i <= c1;
        const armor = move.hyperArmor && i >= move.hyperArmorFrames[0] && i <= move.hyperArmorFrames[1];
        const ch = here ? '▮' : active ? '█' : chain ? '▪' : armor ? '▒' : '─';
        const cls = here ? '' : active ? 'bad' : chain ? 'ok' : armor ? 'warn' : 'dim';
        cells.push(`<span class="${cls}">${ch}</span>`);
      }
      ribbon =
        `<b>${move.id}</b>  <span class="dim">frame ${f}/${move.frames}</span>\n` +
        cells.join('') +
        `\n<span class="dim">startup ${move.startup}  </span>` +
        `<span class="bad">active ${a0}-${a1}</span>` +
        `<span class="dim">  recovery ${move.frames - a1}</span>` +
        (move.hyperArmor ? '  <span class="warn">hyper-armor</span>' : '') +
        `\n<span class="dim">dmg ${move.damage}  poise ${move.poiseDamage}  stam ${move.staminaCost}</span>` +
        (p.chainQueued ? `\n<span class="ok">queued: ${p.chainQueued}</span>` : '');
    }

    const dummy = this.dummies[0];
    let log = '';
    if (dummy?.hitLog.length) {
      log = '\n\n<b>last hits</b>  <span class="dim">move  start/active/recov  dmg</span>\n' +
        dummy.hitLog.slice(0, 5).map((h) => {
          const stag = h.staggered ? ' <span class="bad">STAGGER</span>' : '';
          return `<span class="dim">${String(h.move).padEnd(8)}</span>` +
            `${String(h.startup ?? '').padStart(3)}/${String(h.active ?? '').padStart(6)}/${String(h.recovery ?? '').padStart(3)}` +
            `  ${String(h.damage).padStart(4)}${stag}`;
        }).join('\n');
    }

    const guard = p.guardState;
    const status =
      `\n\nguard  ${guard.active ? '<span class="ok">up</span>' : '<span class="dim">down</span>'}` +
      `  deflect window ${guard.deflectFramesLeft > 0 ? `<span class="ok">${guard.deflectFramesLeft}</span>` : '<span class="dim">—</span>'}` +
      `\nhp     ${Math.round(p.vitals.health)}/${p.vitals.maxHealth}` +
      `   poise ${Math.round(p.vitals.poise)}/${p.vitals.maxPoise}` +
      (p.vitals.hyperArmor ? ' <span class="warn">ARMOR</span>' : '') +
      `\nflask  ${p.flaskCharges}` +
      `   hitboxes live ${this.hitboxes.activeCount}` +
      (p.deflectBonusFrames > 0 ? `\n<span class="ok">deflect counter armed (${Math.round(p.deflectBonusFrames)}f)</span>` : '');

    this.el.innerHTML = ribbon + status + log;
  }
}
