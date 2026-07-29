import { EVENTS } from './EventBus.js';

const SAVE_KEY = 'vessel.save.v1';

/**
 * The seven slots. Chapter 1 resolves `wings` only, but the architecture is
 * built in full: seven binary choices is 128 end-states, and the only sane way
 * to serve that is assembly from owned variants rather than authored characters.
 */
export const SLOTS = Object.freeze(['wings', 'head', 'chest', 'arms', 'legs', 'weapon', 'aura']);
export const VARIANT = Object.freeze({ NONE: 0, LIGHT: 1, DARK: -1 });

const emptySlots = () => Object.fromEntries(SLOTS.map((s) => [s, VARIANT.NONE]));

/**
 * GameState — the only mutable progression truth in the build.
 *
 * Owns: alignment, slot variants, checkpoint, currency, flags, death count.
 * Exposes: read accessors, mutators that emit, save/load.
 * Forbidden: touching the scene, physics, or any renderable thing.
 */
export class GameState {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.slots = emptySlots();
    this.flags = new Set();
    this.checkpointId = null;
    this.currency = 0;
    /** Bloodstain: dropped on death, recoverable once, lost on the second. */
    this.droppedCurrency = null; // { amount, position: [x,y,z], zone }
    this.deaths = 0;
    this.flaskCharges = null; // null = full, set by combat on init
    this.beat = 0;
    this.zone = null;
    this.playTime = 0;
  }

  /** −7 … +7. Drives appearance, mechanics and world reaction. */
  get alignment() {
    return SLOTS.reduce((sum, s) => sum + this.slots[s], 0);
  }

  /** The dominant branch, for material and VFX set selection. */
  get branch() {
    const a = this.alignment;
    if (a > 0) return 'light';
    if (a < 0) return 'dark';
    return 'neutral';
  }

  hasSlot(slot) {
    return this.slots[slot] !== VARIANT.NONE;
  }

  /** Irreversible within a run. There is no unset path by design. */
  resolveSlot(slot, variant) {
    if (!SLOTS.includes(slot)) throw new Error(`GameState: unknown slot "${slot}"`);
    if (this.slots[slot] !== VARIANT.NONE) {
      console.warn(`GameState: slot "${slot}" already resolved; ignoring.`);
      return;
    }
    this.slots[slot] = variant;
    this.bus.emit(EVENTS.ALIGNMENT_CHOSEN, { slot, variant, alignment: this.alignment });
    this.save();
  }

  setFlag(name) {
    if (this.flags.has(name)) return false;
    this.flags.add(name);
    this.save();
    return true;
  }

  hasFlag(name) {
    return this.flags.has(name);
  }

  addCurrency(delta) {
    this.currency = Math.max(0, this.currency + delta);
    this.bus.emit(EVENTS.CURRENCY_CHANGED, { amount: this.currency, delta });
  }

  /** Death drops everything at the point of death. */
  dropCurrency(position, zone) {
    const amount = this.currency;
    // A second death before recovery loses the first stain permanently.
    const lost = this.droppedCurrency;
    this.droppedCurrency = amount > 0 ? { amount, position: [...position], zone } : null;
    this.currency = 0;
    this.deaths++;
    if (amount > 0) this.bus.emit(EVENTS.CURRENCY_DROPPED, { amount, position });
    if (lost) this.bus.emit(EVENTS.CURRENCY_CHANGED, { amount: 0, delta: -lost.amount });
    this.save();
    return lost;
  }

  recoverCurrency() {
    if (!this.droppedCurrency) return 0;
    const { amount } = this.droppedCurrency;
    this.droppedCurrency = null;
    this.addCurrency(amount);
    this.bus.emit(EVENTS.CURRENCY_RECOVERED, { amount });
    this.save();
    return amount;
  }

  setCheckpoint(id) {
    this.checkpointId = id;
    this.save();
    this.bus.emit(EVENTS.CHECKPOINT_REACHED, { id });
  }

  save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          slots: this.slots,
          flags: [...this.flags],
          checkpointId: this.checkpointId,
          currency: this.currency,
          droppedCurrency: this.droppedCurrency,
          deaths: this.deaths,
          beat: this.beat,
          zone: this.zone,
          playTime: this.playTime,
        })
      );
    } catch {
      // Private browsing, quota, disabled storage — the game still plays.
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.slots = { ...emptySlots(), ...(d.slots ?? {}) };
      this.flags = new Set(d.flags ?? []);
      this.checkpointId = d.checkpointId ?? null;
      this.currency = d.currency ?? 0;
      this.droppedCurrency = d.droppedCurrency ?? null;
      this.deaths = d.deaths ?? 0;
      this.beat = d.beat ?? 0;
      this.zone = d.zone ?? null;
      this.playTime = d.playTime ?? 0;
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    this.reset();
  }
}
