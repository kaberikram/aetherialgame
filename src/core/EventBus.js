/**
 * EventBus — the only sanctioned channel between modules.
 *
 * Modules never import each other's internals. When character needs to tell
 * combat that an animation reached its active frames, it emits; combat listens.
 * That indirection is what lets zones, art and audio be worked on in parallel
 * later without every file touching every other file.
 *
 * Events are declared in EVENTS below. Emitting or subscribing to an
 * undeclared name throws in dev — a typo'd event that silently never fires is
 * the worst class of bug in a system like this.
 */

export const EVENTS = Object.freeze({
  // --- engine lifecycle ---
  ENGINE_READY: 'engine:ready',
  ENGINE_PAUSE: 'engine:pause',
  ENGINE_RESUME: 'engine:resume',
  ENGINE_RESIZE: 'engine:resize',

  // --- input ---
  INPUT_ACTION: 'input:action', // { action, phase: 'pressed'|'released', value }
  INPUT_DEVICE_CHANGED: 'input:deviceChanged', // { device: 'gamepad'|'kbm' }

  // --- character ---
  PLAYER_SPAWNED: 'player:spawned',
  PLAYER_STATE_CHANGED: 'player:stateChanged', // { from, to }
  PLAYER_LANDED: 'player:landed', // { impactSpeed, surface }
  PLAYER_FOOTSTEP: 'player:footstep', // { foot, surface, position }
  PLAYER_DIED: 'player:died',
  PLAYER_RESPAWNED: 'player:respawned',
  PLAYER_EMBODIED: 'player:embodied',

  // --- stats ---
  STAMINA_SPENT: 'stat:staminaSpent', // { amount, reason }
  HEALTH_CHANGED: 'stat:healthChanged', // { current, max, delta, source }
  POISE_BROKEN: 'stat:poiseBroken', // { entity }

  // --- combat ---
  ATTACK_STARTED: 'combat:attackStarted', // { entity, moveId }
  ATTACK_ACTIVE: 'combat:attackActive', // { entity, moveId, hitboxIds }
  ATTACK_RECOVERED: 'combat:attackRecovered', // { entity, moveId }
  HIT_LANDED: 'combat:hitLanded', // { attacker, victim, damage, poiseDamage, point }
  HIT_BLOCKED: 'combat:hitBlocked', // { attacker, victim, staminaCost }
  DEFLECT_SUCCESS: 'combat:deflect', // { attacker, victim }
  STAGGERED: 'combat:staggered', // { entity, duration }
  CRITICAL_READY: 'combat:criticalReady', // { entity }
  CRITICAL_EXECUTED: 'combat:criticalExecuted', // { attacker, victim }
  LOCKON_CHANGED: 'combat:lockOnChanged', // { target|null }
  FLASK_USED: 'combat:flaskUsed', // { charges }
  ENTITY_DIED: 'combat:entityDied', // { entity }

  // --- boss ---
  BOSS_ENCOUNTER_START: 'boss:start', // { id, name }
  BOSS_PHASE_CHANGED: 'boss:phase', // { id, phase }
  BOSS_WINDUP: 'boss:windup', // { id, moveId }
  BOSS_DEFEATED: 'boss:defeated', // { id }
  BOSS_HEALTH_CHANGED: 'boss:health', // { id, current, max }

  // --- world / progression ---
  ZONE_ENTERED: 'zone:entered', // { id }
  ZONE_EXITED: 'zone:exited', // { id }
  CHECKPOINT_REACHED: 'world:checkpoint', // { id }
  CHECKPOINT_RESTED: 'world:rested', // { id }
  ITEM_PICKED_UP: 'world:pickup', // { id }
  CURRENCY_CHANGED: 'world:currency', // { amount, delta }
  CURRENCY_DROPPED: 'world:currencyDropped', // { amount, position }
  CURRENCY_RECOVERED: 'world:currencyRecovered', // { amount }
  INTERACT_AVAILABLE: 'world:interactAvailable', // { id, label }|null

  // --- narrative ---
  BEAT_ENTERED: 'story:beat', // { id }
  DIALOGUE_LINE: 'story:line', // { speaker, text, duration }
  ALIGNMENT_CHOICE_OFFERED: 'story:alignmentOffer', // { slot }
  ALIGNMENT_CHOSEN: 'story:alignmentChosen', // { slot, variant, alignment }

  // --- flight ---
  FLIGHT_TAKEOFF: 'flight:takeoff',
  FLIGHT_LANDED: 'flight:landed',
  FLIGHT_FLAP: 'flight:flap',

  // --- audio ---
  SFX: 'audio:sfx', // { id, position?, gain?, pitch? }
  MUSIC_CUE: 'audio:music', // { id }

  // --- debug ---
  DEBUG_TOGGLE: 'debug:toggle', // { feature, enabled }
});

const DECLARED = new Set(Object.values(EVENTS));

export class EventBus {
  #listeners = new Map();
  #strict;

  constructor({ strict = true } = {}) {
    this.#strict = strict;
  }

  #assertDeclared(name) {
    if (this.#strict && !DECLARED.has(name)) {
      throw new Error(`EventBus: "${name}" is not declared in EVENTS.`);
    }
  }

  /** @returns {() => void} unsubscribe */
  on(name, fn) {
    this.#assertDeclared(name);
    let set = this.#listeners.get(name);
    if (!set) this.#listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  emit(name, payload) {
    this.#assertDeclared(name);
    const set = this.#listeners.get(name);
    if (!set || set.size === 0) return;
    // Copy so a handler that unsubscribes mid-dispatch cannot corrupt iteration.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`EventBus: listener for "${name}" threw`, err);
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}
