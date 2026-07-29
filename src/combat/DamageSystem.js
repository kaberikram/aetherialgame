import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { SLOTS, VARIANT } from '../core/GameState.js';

const _v = new THREE.Vector3();

/**
 * DamageSystem — resolves what a reported overlap actually means.
 *
 * Consumes overlaps from HitboxSystem and decides: absorbed by i-frames,
 * guarded, deflected, or landed. Then applies the alignment modifiers, the hit
 * stop, and the events everything else listens to.
 *
 * Hit stop is the cheapest big win in the whole combat system. Freezing time
 * for five frames on contact is what makes a sword feel like it has mass, and
 * it costs one timescale multiplier.
 */
export class DamageSystem {
  constructor(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');

    this.hitStopFrames = 0;
    this.hitStopScale = 1;
  }

  get timeScale() {
    return this.hitStopFrames > 0 ? this.hitStopScale : 1;
  }

  /** Multipliers from the resolved alignment slots. Neutral until wings resolve. */
  #alignmentMods() {
    const branch = this.state.branch;
    if (branch === 'light') return TUNING.alignment.light;
    if (branch === 'dark') return TUNING.alignment.dark;
    return { damageMultiplier: 1, defenceMultiplier: 1, attackSpeedMultiplier: 1 };
  }

  get attackSpeedMultiplier() {
    return this.#alignmentMods().attackSpeedMultiplier ?? 1;
  }

  /** How many extra frames the deflect window gets from the active branch. */
  get deflectWindowFrames() {
    const base = this.engine.resolve('input').device === 'gamepad'
      ? TUNING.combat.deflectWindowFrames
      : TUNING.input.kbm.deflectWindowFrames;
    return Math.max(2, base + (this.#alignmentMods().deflectWindowBonusFrames ?? 0));
  }

  /**
   * @param {object} attacker entity dealing the hit (has .vitals, .faction)
   * @param {object} victim   entity receiving it
   * @param {object} move     frame data
   * @param {THREE.Vector3} point impact position
   */
  resolve(attacker, victim, move, point) {
    const vitals = victim.vitals;
    if (!vitals?.alive) return null;

    // 1. Invincibility. A roll's i-frames beat everything.
    if (vitals.invulnerable || victim.invulnerable) {
      this.bus.emit(EVENTS.SFX, { id: 'whiff', position: point });
      return { outcome: 'iframe' };
    }

    const isPlayerVictim = victim.faction === 'player';
    const mods = isPlayerVictim ? this.#alignmentMods() : { defenceMultiplier: 1 };

    // 2. Guard, and the deflect window inside it.
    if (victim.guardState?.active && this.#facingAttacker(victim, attacker)) {
      if (victim.guardState.deflectFramesLeft > 0) return this.#resolveDeflect(attacker, victim, move, point);
      return this.#resolveGuard(attacker, victim, move, point);
    }

    // 3. A clean hit.
    const damage = move.damage
      * (attacker.damageMultiplier ?? 1)
      * (isPlayerVictim ? 1 / (mods.defenceMultiplier ?? 1) : (this.#alignmentMods().damageMultiplier ?? 1));

    const result = vitals.applyDamage(damage, move.poiseDamage ?? 0, attacker);

    this.#applyHitStop(move.hitStopFrames ?? TUNING.combat.hitStopFrames);
    this.bus.emit(EVENTS.HIT_LANDED, {
      attacker, victim, damage: result.damage,
      poiseDamage: move.poiseDamage ?? 0,
      point: point.clone(), staggered: result.staggered, died: result.died,
    });
    this.bus.emit(EVENTS.SFX, { id: result.staggered ? 'hitHeavy' : 'hit', position: point });

    // Dark lifesteal: the aggressive branch pays for its lower defence by
    // sustaining off contact, which pushes it toward staying in range.
    if (attacker.faction === 'player' && this.state.branch === 'dark' && attacker.vitals) {
      const steal = result.damage * (TUNING.alignment.dark.lifestealFraction ?? 0);
      if (steal > 0) attacker.vitals.heal(steal);
    }

    if (result.staggered) this.bus.emit(EVENTS.CRITICAL_READY, { entity: victim });
    return { outcome: 'hit', ...result };
  }

  #resolveGuard(attacker, victim, move, point) {
    const c = TUNING.combat;
    const chip = move.damage * (1 - c.guardDamageReduction);
    const staminaCost = move.damage * c.guardStaminaPerDamage;

    const stamina = victim.stamina;
    const broke = stamina ? !stamina.spend(staminaCost, 'guard') || stamina.current <= 0 : false;

    victim.vitals.applyDamage(chip, 0, attacker);
    this.#applyHitStop(4);
    this.bus.emit(EVENTS.HIT_BLOCKED, { attacker, victim, staminaCost, point: point.clone() });
    this.bus.emit(EVENTS.SFX, { id: 'guard', position: point });

    if (broke) {
      // Guard break: the guard held, the arms did not.
      victim.vitals.staggerTimer = c.guardBreakStaggerFrames;
      victim.vitals.poise = 0;
      this.bus.emit(EVENTS.STAGGERED, { entity: victim, duration: c.guardBreakStaggerFrames });
      this.bus.emit(EVENTS.SFX, { id: 'guardBreak', position: point });
    }
    return { outcome: broke ? 'guardBreak' : 'guard' };
  }

  /**
   * A deflect costs no stamina, deals no damage to the defender, and hands
   * back a damage multiplier plus doubled poise damage on the counter. It is
   * the highest-value action in the game and the hardest input to hit.
   */
  #resolveDeflect(attacker, victim, move, point) {
    const c = TUNING.combat;
    victim.deflectBonusFrames = 120; // window in which the counter is buffed
    victim.deflectMultiplier = c.deflectDamageMultiplier;

    // The attacker eats poise damage from having their swing turned aside.
    if (attacker.vitals) {
      const poise = (move.poiseDamage ?? 12) * c.deflectPoiseDamageMultiplier;
      const res = attacker.vitals.applyDamage(0, poise, victim);
      if (res.staggered) this.bus.emit(EVENTS.CRITICAL_READY, { entity: attacker });
    }

    if (victim.faction === 'player' && this.state.branch === 'light') {
      victim.vitals.heal(TUNING.alignment.light.healOnDeflect ?? 0);
    }

    this.#applyHitStop(10, 0.02);
    this.bus.emit(EVENTS.DEFLECT_SUCCESS, { attacker, victim, point: point.clone() });
    this.bus.emit(EVENTS.SFX, { id: 'deflect', position: point });
    return { outcome: 'deflect' };
  }

  /** Critical damage scales off the victim's max health, not the weapon. */
  resolveCritical(attacker, victim) {
    const vitals = victim.vitals;
    if (!vitals?.alive) return null;
    const damage = vitals.maxHealth * 0.28 * TUNING.combat.criticalDamageMultiplier * 0.35;
    const result = vitals.applyDamage(damage, vitals.maxPoise, attacker);
    this.#applyHitStop(TUNING.combat.hitStopFrames * 2.5);
    victim.position && this.bus.emit(EVENTS.SFX, { id: 'critical', position: victim.position });
    this.bus.emit(EVENTS.CRITICAL_EXECUTED, { attacker, victim, damage: result.damage });
    return result;
  }

  #facingAttacker(victim, attacker) {
    if (!victim.facing && victim.facing !== 0) return true;
    _v.copy(attacker.position ?? attacker.mesh?.position ?? _v).sub(victim.position);
    const angle = Math.atan2(_v.x, _v.z);
    let delta = angle - victim.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // A shield protects a 150° arc in front. Being flanked is a real failure.
    return Math.abs(delta) < THREE.MathUtils.degToRad(75);
  }

  #applyHitStop(frames, scale = TUNING.combat.hitStopScale) {
    this.hitStopFrames = Math.max(this.hitStopFrames, frames);
    this.hitStopScale = scale;
  }

  fixedUpdate() {
    if (this.hitStopFrames > 0) this.hitStopFrames--;
  }
}
