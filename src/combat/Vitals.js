import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';

/**
 * Vitals — health, poise and stagger for any entity, player or enemy.
 *
 * Poise is the interesting half. It regenerates, but only after a long delay,
 * so a flurry of light attacks that individually do nothing will break a target
 * that a single heavy would not. That is the mechanic that makes light attack
 * strings worth throwing at something that out-damages you.
 *
 * A staggered entity does not regain poise until it recovers, which is what
 * makes a break a real opening rather than a flinch.
 */
export class Vitals {
  constructor(bus, entity, { maxHealth, maxPoise, staggerFrames = TUNING.health.staggerFrames } = {}) {
    this.bus = bus;
    this.entity = entity;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.maxPoise = maxPoise;
    this.poise = maxPoise;
    this.staggerFrames = staggerFrames;

    this.poiseDelay = 0;
    this.staggerTimer = 0;
    this.alive = true;
    this.invulnerable = false;
    /** Set while a hyper-armor window is open: damage lands, poise does not. */
    this.hyperArmor = false;
  }

  get staggered() {
    return this.staggerTimer > 0;
  }

  get healthNormalized() {
    return this.health / this.maxHealth;
  }

  get poiseNormalized() {
    return this.poise / this.maxPoise;
  }

  /**
   * @returns {{ died: boolean, staggered: boolean, damage: number }}
   */
  applyDamage(amount, poiseDamage = 0, source = null) {
    if (!this.alive || this.invulnerable) return { died: false, staggered: false, damage: 0 };

    this.health = Math.max(0, this.health - amount);
    this.bus?.emit(EVENTS.HEALTH_CHANGED, {
      entity: this.entity,
      current: this.health,
      max: this.maxHealth,
      delta: -amount,
      source,
    });

    let staggered = false;
    // Hyper-armor absorbs the poise damage but not the health damage. You
    // finish your swing; you still bleed for it.
    if (poiseDamage > 0 && !this.hyperArmor) {
      this.poise = Math.max(0, this.poise - poiseDamage);
      this.poiseDelay = TUNING.health.poiseRegenDelayFrames;
      if (this.poise <= 0 && !this.staggered) {
        staggered = true;
        this.staggerTimer = this.staggerFrames;
        this.bus?.emit(EVENTS.STAGGERED, { entity: this.entity, duration: this.staggerFrames });
        this.bus?.emit(EVENTS.POISE_BROKEN, { entity: this.entity });
      }
    }

    if (this.health <= 0) {
      this.alive = false;
      this.bus?.emit(EVENTS.ENTITY_DIED, { entity: this.entity });
      return { died: true, staggered, damage: amount };
    }
    return { died: false, staggered, damage: amount };
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    const gained = this.health - before;
    if (gained > 0) {
      this.bus?.emit(EVENTS.HEALTH_CHANGED, {
        entity: this.entity,
        current: this.health,
        max: this.maxHealth,
        delta: gained,
        source: 'heal',
      });
    }
    return gained;
  }

  refill() {
    this.health = this.maxHealth;
    this.poise = this.maxPoise;
    this.staggerTimer = 0;
    this.poiseDelay = 0;
    this.alive = true;
  }

  fixedUpdate(dt) {
    if (this.staggerTimer > 0) {
      this.staggerTimer--;
      // Poise stays broken through the whole stagger. Recovering it mid-stagger
      // would let a target "wake up" out of the opening it just gave you.
      if (this.staggerTimer === 0) this.poise = this.maxPoise * 0.5;
      return;
    }
    if (this.poiseDelay > 0) {
      this.poiseDelay--;
      return;
    }
    if (this.poise < this.maxPoise) {
      this.poise = Math.min(this.maxPoise, this.poise + TUNING.health.poiseRegenPerSecond * dt);
    }
  }
}
