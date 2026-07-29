/**
 * THE DROWNED — frame data.
 *
 * Same schema as the player's, deliberately. "Readable and fair" is structural
 * here rather than a promise: the boss is subject to the same startup /
 * active / recovery contract, the same hitbox system, and the same poise rules
 * the player is.
 *
 * Every move's `tell` is the one-word answer to the rubric's question, "paused
 * mid-wind-up, can you name the incoming attack?" If a pose cannot be
 * summarised in one word from its silhouette, it is not readable enough.
 */

/**
 * Boss hitboxes are generous, for the same reason the player's are (D14) and
 * one more: this creature's reach is its limbs, and a limb capsule that hugs
 * the mesh means a swing that visibly passes through you does nothing. The
 * sizes below were set by measuring the actual gap at the distances the AI
 * chooses to attack from, not by eye.
 */
const CLAW = (side) => ({ bone: `claw.${side}`, offset: [0, 0.15, 0], radius: 0.72, length: 1.35 });
const LEG = (grp, side) => ({ bone: `${grp}.${side}.femur`, offset: [0, 0.1, 0], radius: 0.85, length: 3.0 });
const BODY = { bone: 'core', offset: [0, 0.6, 0], radius: 1.75, length: 2.6 };

export const BOSS_MOVES = {
  /**
   * LUNGE — the teaching move. 34 frames of wind-up, the body pulling back and
   * the mask rising, then a straight-line commit. Long enough to roll on
   * reaction the first time you see it; short enough to punish standing still.
   */
  lunge: {
    id: 'lunge',
    clip: 'bossLunge',
    tell: 'the mask lifts and the body coils straight back',
    frames: 96,
    startup: 34,
    active: [34, 44],
    damage: 62,
    poiseDamage: 40,
    hitbox: BODY,
    trackUntil: 26,      // stops turning toward the player at this frame
    range: [4.0, 9.5],
    cooldown: 40,
    phase: [1, 2],
    weight: 1.0,
    windupSfx: 'bossLungeTell',
  },

  /**
   * SWEEP — demands a roll THROUGH, not away. The arc is wide enough that
   * backing off does not clear it; the only clean answer is to roll into the
   * gap the swinging limb leaves behind.
   */
  sweep: {
    id: 'sweep',
    clip: 'bossSweep',
    tell: 'one limb draws back across the body, low',
    frames: 88,
    startup: 30,
    active: [30, 46],
    damage: 54,
    poiseDamage: 46,
    hitbox: LEG('legB', 'L'),
    extraHitboxes: [LEG('legA', 'L'), { bone: 'legB.L.tibia', offset: [0, 0, 0], radius: 0.7, length: 1.8 }],
    trackUntil: 22,
    range: [1.5, 5.0],
    cooldown: 46,
    phase: [1, 2],
    weight: 1.1,
    windupSfx: 'bossSweepTell',
  },

  /**
   * DELAYED STRIKE — the punish for panic-rolling. The wind-up reads exactly
   * like the lunge for 20 frames, then HOLDS for 22 more before committing.
   * Roll on the rhythm you learned from the lunge and it lands on you as you
   * finish recovering.
   */
  delayed: {
    id: 'delayed',
    clip: 'bossDelayed',
    tell: 'the same coil as the lunge — but it stops, and waits',
    frames: 104,
    startup: 52,
    active: [52, 60],
    damage: 76,
    poiseDamage: 52,
    hitbox: CLAW('R'),
    trackUntil: 44,
    range: [2.0, 6.0],
    cooldown: 68,
    phase: [1, 2],
    weight: 0.75,
    windupSfx: 'bossDelayedTell',
  },

  /**
   * SUBMERGE — no damage. Teaches camera management: it goes under, crosses
   * the pool, and surfaces somewhere else. If you have not learned to unlock
   * and look around, you lose it.
   */
  submerge: {
    id: 'submerge',
    clip: 'bossSubmerge',
    tell: 'the limbs fold inward and the body drops',
    frames: 120,
    startup: 120,
    active: [-1, -1],
    damage: 0,
    poiseDamage: 0,
    hitbox: null,
    trackUntil: 0,
    range: [0, 30],
    cooldown: 150,
    phase: [1],
    weight: 0.55,
    reposition: true,
    windupSfx: 'bossSubmerge',
  },

  /**
   * SLAM — phase two only. Both arms overhead, then down. The heaviest poise
   * damage in the fight and the longest recovery: this is the punish window
   * the whole second phase is built around.
   */
  slam: {
    id: 'slam',
    clip: 'bossSlam',
    tell: 'both arms raised straight overhead',
    frames: 112,
    startup: 40,
    active: [40, 48],
    damage: 92,
    poiseDamage: 70,
    hitbox: CLAW('L'),
    extraHitboxes: [CLAW('R')],
    trackUntil: 30,
    range: [1.5, 5.0],
    cooldown: 54,
    phase: [2],
    weight: 1.15,
    shake: 0.8,
    windupSfx: 'bossSlamTell',
  },

  /**
   * SKITTER — phase two. Fast lateral repositioning with a trailing limb that
   * clips you if you chase in a straight line.
   */
  skitter: {
    id: 'skitter',
    clip: 'bossSkitter',
    tell: 'legs on one side load and the body tips',
    frames: 62,
    startup: 16,
    active: [22, 34],
    damage: 40,
    poiseDamage: 24,
    hitbox: LEG('legC', 'R'),
    trackUntil: 12,
    range: [2.5, 12.0],
    cooldown: 30,
    phase: [2],
    weight: 0.9,
    windupSfx: 'bossSkitterTell',
  },
};

/** The scripted phase transition. Not a stat change on a health threshold. */
export const BEACH_TRANSITION = {
  id: 'beach',
  clip: 'bossBeach',
  frames: 210,
  invulnerable: true,
  events: [
    { frame: 30, type: 'sfx', id: 'bossRise' },
    { frame: 30, type: 'shake', strength: 0.5 },
    { frame: 120, type: 'waterBurst' },
    { frame: 128, type: 'shake', strength: 1.2 },
    { frame: 205, type: 'phase2' },
  ],
};

export const BOSS_STATS = {
  name: 'The Drowned',
  maxHealth: 2600,
  maxPoise: 190,
  staggerFrames: 190,
  phaseTwoAt: 0.55,
  /** Damage taken while submerged is reduced — you cannot cheese phase one. */
  submergedDefence: 0.35,
};

export function bossMovesForPhase(phase) {
  return Object.values(BOSS_MOVES).filter((m) => m.phase.includes(phase));
}
