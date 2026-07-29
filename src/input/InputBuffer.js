import { TUNING } from '../tuning.js';

/**
 * InputBuffer — holds a queued action across the recovery frames of the
 * current one, so a slightly early press executes cleanly instead of being
 * dropped.
 *
 * The rule that matters: **buffering is only permitted during recovery.**
 * Never during active frames. Active frames are where commitment lives, and a
 * buffer that swallows inputs there would quietly undo the whole design.
 *
 * The buffer also snapshots the movement vector at press time, because a roll's
 * direction is a deliberate read of the stick when you pressed, not wherever
 * the stick drifted to by the time the roll actually starts.
 */
export class InputBuffer {
  #entry = null;

  /** @param {string} action @param {{x:number,y:number}} moveVector */
  push(action, moveVector, frame) {
    this.#entry = {
      action,
      move: { x: moveVector.x, y: moveVector.y },
      frame,
    };
  }

  /** Returns the buffered entry if it is still fresh, else null. */
  peek(currentFrame) {
    if (!this.#entry) return null;
    if (currentFrame - this.#entry.frame > TUNING.combat.inputBufferFrames) {
      this.#entry = null;
      return null;
    }
    return this.#entry;
  }

  consume(currentFrame) {
    const e = this.peek(currentFrame);
    this.#entry = null;
    return e;
  }

  clear() {
    this.#entry = null;
  }

  get pending() {
    return this.#entry?.action ?? null;
  }

  get ageFrames() {
    return this.#entry ? this.#entry.frame : -1;
  }
}
