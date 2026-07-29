import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';

/**
 * Stamina — the resource that turns every action into a decision.
 *
 * The regen DELAY is the mechanic, not the drain. Spending is cheap; the
 * seconds afterwards where you have nothing left are what create the tension
 * of "one more swing or back off". So the delay after emptying the bar is
 * substantially longer than the delay after a normal spend: running yourself
 * dry is punished more than spending carefully.
 *
 * Actions may start at low stamina and drive it to zero. You can always throw
 * the swing you committed to; you just pay for it afterwards.
 */
export class Stamina {
  constructor(bus, { max = TUNING.stamina.max } = {}) {
    this.bus = bus;
    this.max = max;
    this.current = max;
    this.delayFrames = 0;
    this.exhausted = false;
  }

  get normalized() {
    return this.current / this.max;
  }

  get canAct() {
    return this.current >= TUNING.stamina.minToAct;
  }

  /** @returns {boolean} whether the spend was permitted */
  spend(amount, reason = 'action') {
    if (!this.canAct) return false;
    this.current = Math.max(0, this.current - amount);
    this.delayFrames = this.current <= 0
      ? TUNING.stamina.regenDelayAfterEmptyFrames
      : TUNING.stamina.regenDelayFrames;
    if (this.current <= 0) this.exhausted = true;
    this.bus.emit(EVENTS.STAMINA_SPENT, { amount, reason, current: this.current });
    return true;
  }

  /** Continuous drain (sprint, guard-hold). Does not reset the delay timer. */
  drain(perSecond, dt) {
    this.current = Math.max(0, this.current - perSecond * dt);
    this.delayFrames = Math.max(this.delayFrames, TUNING.stamina.regenDelayFrames);
    if (this.current <= 0) this.exhausted = true;
    return this.current > 0;
  }

  restore(amount) {
    this.current = Math.min(this.max, this.current + amount);
  }

  refill() {
    this.current = this.max;
    this.delayFrames = 0;
    this.exhausted = false;
  }

  fixedUpdate(dt) {
    if (this.delayFrames > 0) {
      this.delayFrames--;
      return;
    }
    if (this.current < this.max) {
      this.current = Math.min(this.max, this.current + TUNING.stamina.regenPerSecond * dt);
    }
    // Exhaustion only clears once the bar has meaningfully recovered, so the
    // player cannot flicker in and out of the penalty at zero.
    if (this.exhausted && this.current > this.max * 0.22) this.exhausted = false;
  }
}
