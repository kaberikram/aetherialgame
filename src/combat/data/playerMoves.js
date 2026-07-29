/**
 * Player frame data.
 *
 * Every move is authored HERE, in data. Adding or retuning a move must never
 * require editing a system file — that is the contract in docs/INTERFACES.md,
 * and it is what makes the numbers below arguable rather than buried.
 *
 * All counts are simulation frames at 60Hz. The three-part shape:
 *
 *   startup   frames before the hitbox opens. This is the telegraph.
 *   active    [first, last] inclusive. The blade is out. NOT cancellable,
 *             NOT bufferable — this is where commitment lives.
 *   recovery  everything after `active[1]`. The cost of having swung.
 *
 * `chainWindow` is the span in which the next input in a string is accepted.
 * It opens inside recovery, never during active frames, so a string is a
 * decision made after you have seen the swing land, not before.
 *
 * Hitboxes are capsules bound to a bone. `offset`/`length` are along the bone's
 * local −Y (the direction limbs extend), so the blade capsule genuinely tracks
 * the hand that is holding it.
 */

/**
 * Hitboxes are deliberately fatter than the blade mesh. A hitbox that exactly
 * matches the geometry whiffs on swings the player watched connect, and that
 * reads as the game cheating. Erring generous on the attacker's side is the
 * standard trade and it is the right one.
 */
const SWORD_HITBOX = { bone: 'hand.R', offset: [0, -0.10, 0], radius: 0.25, length: 1.15 };
const SWORD_WIDE = { bone: 'hand.R', offset: [0, -0.10, 0], radius: 0.34, length: 1.25 };

export const PLAYER_MOVES = {
  light1: {
    id: 'light1',
    clip: 'attackLight1',
    frames: 44,
    startup: 12,
    active: [12, 17],
    damage: 44,
    poiseDamage: 16,
    staminaCost: 17,
    hitbox: SWORD_HITBOX,
    hyperArmor: false,
    chainWindow: [18, 40],
    chainInto: { light: 'light2', heavy: 'heavy1' },
    hitStopFrames: 5,
    sfx: 'swingLight',
  },

  light2: {
    id: 'light2',
    clip: 'attackLight2',
    frames: 40,
    startup: 10,
    active: [10, 15],
    damage: 40,
    poiseDamage: 15,
    staminaCost: 15,
    hitbox: SWORD_HITBOX,
    hyperArmor: false,
    chainWindow: [16, 36],
    chainInto: { light: 'light3', heavy: 'heavy1' },
    hitStopFrames: 5,
    sfx: 'swingLight',
  },

  // The finisher costs more than it gains in raw damage. What it buys is poise
  // damage — it is the move that opens a stagger, not the one that kills.
  light3: {
    id: 'light3',
    clip: 'attackLight3',
    frames: 56,
    startup: 16,
    active: [16, 22],
    damage: 62,
    poiseDamage: 30,
    staminaCost: 24,
    hitbox: SWORD_WIDE,
    hyperArmor: false,
    chainWindow: [24, 46],
    chainInto: { heavy: 'heavy1' },
    hitStopFrames: 8,
    sfx: 'swingHeavy',
  },

  // 26 frames of wind-up. Long enough to be punished on reaction, which is the
  // entire trade: hyper-armor means you will not be interrupted, but you will
  // be hit, and you chose that.
  heavy1: {
    id: 'heavy1',
    clip: 'attackHeavy1',
    frames: 72,
    startup: 26,
    active: [26, 33],
    damage: 96,
    poiseDamage: 48,
    staminaCost: 32,
    hitbox: SWORD_WIDE,
    hyperArmor: true,
    hyperArmorFrames: [14, 33],
    chainWindow: [36, 58],
    chainInto: { heavy: 'heavy2' },
    hitStopFrames: 8,
    sfx: 'swingHeavy',
  },

  heavy2: {
    id: 'heavy2',
    clip: 'attackHeavy2',
    frames: 78,
    startup: 24,
    active: [24, 38],
    damage: 84,
    poiseDamage: 52,
    staminaCost: 34,
    hitbox: SWORD_WIDE,
    hyperArmor: true,
    hyperArmorFrames: [12, 38],
    // Sweeps a full circle, so it may hit each target once but several targets.
    multiTarget: true,
    chainWindow: [],
    chainInto: {},
    hitStopFrames: 8,
    sfx: 'swingHeavy',
  },

  critical: {
    id: 'critical',
    clip: 'critical',
    frames: 74,
    startup: 32,
    active: [32, 34],
    damage: 0, // resolved by DamageSystem as a multiplier on the target's max
    poiseDamage: 0,
    staminaCost: 20,
    hitbox: SWORD_HITBOX,
    hyperArmor: true,
    hyperArmorFrames: [0, 40],
    invulnerable: [4, 40],
    chainWindow: [],
    chainInto: {},
    hitStopFrames: 12,
    sfx: 'critical',
  },
};

/** Which move opens a string, per input. */
export const OPENERS = { light: 'light1', heavy: 'heavy1' };

export function getMove(id) {
  const m = PLAYER_MOVES[id];
  if (!m) throw new Error(`playerMoves: no move "${id}"`);
  return m;
}
