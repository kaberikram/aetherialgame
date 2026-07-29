import { clip, k } from '../AnimationSystem.js';

/**
 * Attack, guard and reaction clips.
 *
 * Every attack has the same three-part shape, and it is visible in the keys:
 *
 *   WIND-UP   the torso coils away from the swing. This is the readable part —
 *             pause here and the incoming attack should be nameable.
 *   ACTIVE    two or three frames of fast travel, eased 'linear' or 'snap' so
 *             there is a real moment of contact rather than a smooth arc.
 *   RECOVERY  the torso unwinds slowly. This is the cost, and it is long.
 *
 * The frame numbers here and the frame data in combat/data/playerMoves.js are
 * the same numbers. That is deliberate: the hitbox opens on the frame the pose
 * says the blade is out, because there is only one source for both.
 *
 * ---------------------------------------------------------------------------
 * ARM CONVENTIONS. The blade runs along the hand bone's local −Y, which is the
 * same axis the arm hangs along. So the ONLY thing that puts the blade out in
 * front of the character is raising the upper arm:
 *
 *   upperArm.x    0 = hanging down    −90 = pointing straight forward
 *                                    −180 = straight up
 *   upperArm.z    negative = away from the body (out to that side)
 *                 positive = across the body
 *   lowerArm.x    negative = elbow flexes, bringing the hand forward
 *
 * A swing authored with the arm near 0 on x sweeps a blade around the
 * character's own hips and connects with nothing. Every active frame below
 * keeps upperArm.x between roughly −80 and −110.
 * ---------------------------------------------------------------------------
 */

/** Light 1 — a horizontal slash, right to left at chest height. Opens the string. */
export const attackLight1 = clip('attackLight1', 44, {
  rootMotion: [{ f: 0, z: 0 }, { f: 10, z: 0.10 }, { f: 17, z: 0.62, e: 'out' }, { f: 44, z: 0.62 }],
  events: [{ frame: 12, type: 'swing', id: 'swingLight' }],
}, {
  hips: [
    k(0, { r: [0, 0, 0] }), k(8, { r: [0, 26, 0], e: 'out' }),
    k(13, { r: [0, 4, 0], e: 'linear' }), k(17, { r: [0, -24, 0], e: 'linear' }),
    k(28, { r: [0, -14, 0] }), k(44, { r: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [0, 0, 0] }), k(8, { r: [-4, 24, 3], e: 'out' }),
    k(13, { r: [2, 2, 0], e: 'linear' }), k(17, { r: [8, -28, -4], e: 'linear' }),
    k(30, { r: [4, -16, -2] }), k(44, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [0, 0, 0] }), k(8, { r: [-6, 32, 4], e: 'out' }),
    k(13, { r: [0, 0, 0], e: 'linear' }), k(17, { r: [10, -36, -6], e: 'linear' }),
    k(32, { r: [4, -18, -3] }), k(44, { r: [0, 0, 0] }),
  ],
  head: [k(0, { r: [0, 0, 0] }), k(8, { r: [0, -14, 0] }), k(17, { r: [4, 18, 0] }), k(44, { r: [0, 0, 0] })],

  // Cocked over the right shoulder, then swept flat across the body.
  // The active frames sit at −72°…−78°: forward and just BELOW horizontal, so
  // the blade tracks through chest height. Past −90° the arm points upward and
  // the blade sails over everything.
  'upperArm.R': [
    k(0, { r: [0, 0, -5] }),
    k(8, { r: [-30, 0, -84], e: 'out' }),
    k(12, { r: [-44, 0, -62], e: 'linear' }),
    k(15, { r: [-54, 0, -20], e: 'linear' }),
    k(17, { r: [-52, 0, 20], e: 'linear' }),
    k(30, { r: [-30, 0, 12] }),
    k(44, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(8, { r: [-96, 0, 0], e: 'out' }),
    k(12, { r: [-46, 0, 0], e: 'linear' }), k(17, { r: [-8, 0, 0], e: 'linear' }),
    k(30, { r: [-42, 0, 0] }), k(44, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [
    k(0, { r: [0, 0, 5] }), k(8, { r: [-20, 0, 46] }), k(17, { r: [-46, 0, 20] }),
    k(44, { r: [0, 0, 5] }),
  ],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(8, { r: [-62, 0, 0] }), k(44, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(10, { r: [-18, 0, 3] }), k(22, { r: [-6, 0, 2] }), k(44, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(10, { r: [14, 0, -3] }), k(22, { r: [4, 0, -2] }), k(44, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(10, { r: [24, 0, 0] }), k(44, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(10, { r: [18, 0, 0] }), k(44, { r: [4, 0, 0] })],
});

/** Light 2 — the return, left to right. Faster, because the blade is already moving. */
export const attackLight2 = clip('attackLight2', 40, {
  rootMotion: [{ f: 0, z: 0 }, { f: 8, z: 0.12 }, { f: 15, z: 0.58, e: 'out' }, { f: 40, z: 0.58 }],
  events: [{ frame: 10, type: 'swing', id: 'swingLight' }],
}, {
  hips: [
    k(0, { r: [0, -16, 0] }), k(7, { r: [0, -30, 0], e: 'out' }),
    k(11, { r: [0, -4, 0], e: 'linear' }), k(15, { r: [0, 26, 0], e: 'linear' }),
    k(40, { r: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [4, -16, 0] }), k(7, { r: [-2, -28, -3], e: 'out' }),
    k(11, { r: [2, -2, 0], e: 'linear' }), k(15, { r: [8, 30, 5], e: 'linear' }),
    k(28, { r: [4, 16, 2] }), k(40, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [4, -18, 0] }), k(7, { r: [-4, -34, -4], e: 'out' }),
    k(11, { r: [0, 0, 0], e: 'linear' }), k(15, { r: [10, 38, 6], e: 'linear' }),
    k(30, { r: [4, 20, 3] }), k(40, { r: [0, 0, 0] }),
  ],
  head: [k(0, { r: [0, 16, 0] }), k(7, { r: [0, 18, 0] }), k(15, { r: [4, -20, 0] }), k(40, { r: [0, 0, 0] })],

  // Mirror of light1: cocked across the body, swept back out to the right.
  'upperArm.R': [
    k(0, { r: [-40, 0, 16] }),
    k(7, { r: [-62, 0, 60], e: 'out' }),
    k(10, { r: [-72, 0, 34], e: 'linear' }),
    k(13, { r: [-78, 0, -12], e: 'linear' }),
    k(15, { r: [-72, 0, -60], e: 'linear' }),
    k(28, { r: [-38, 0, -30] }),
    k(40, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(7, { r: [-92, 0, 0], e: 'out' }),
    k(10, { r: [-44, 0, 0], e: 'linear' }), k(15, { r: [-8, 0, 0], e: 'linear' }),
    k(40, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(7, { r: [-38, 0, 52] }), k(15, { r: [-14, 0, 18] }), k(40, { r: [0, 0, 5] })],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(7, { r: [-70, 0, 0] }), k(40, { r: [-15, 0, 0] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(9, { r: [-20, 0, -3] }), k(40, { r: [0, 0, -2] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(9, { r: [16, 0, 3] }), k(40, { r: [0, 0, 2] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(9, { r: [26, 0, 0] }), k(40, { r: [4, 0, 0] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(9, { r: [20, 0, 0] }), k(40, { r: [4, 0, 0] })],
});

/** Light 3 — overhead finisher. Slower, longer recovery, the string's price. */
export const attackLight3 = clip('attackLight3', 56, {
  rootMotion: [{ f: 0, z: 0 }, { f: 12, z: 0.18 }, { f: 22, z: 0.95, e: 'out' }, { f: 56, z: 0.95 }],
  events: [{ frame: 16, type: 'swing', id: 'swingHeavy' }],
}, {
  hips: [
    k(0, { r: [0, 10, 0], p: [0, 0, 0] }), k(11, { r: [-8, 14, 0], p: [0, 0.05, 0], e: 'out' }),
    k(20, { r: [12, 0, 0], p: [0, -0.13, 0], e: 'linear' }),
    k(32, { r: [7, 0, 0], p: [0, -0.06, 0] }), k(56, { r: [0, 0, 0], p: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [0, 8, 0] }), k(11, { r: [-24, 10, 0], e: 'out' }),
    k(20, { r: [32, 0, 0], e: 'linear' }), k(36, { r: [18, 0, 0] }), k(56, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [0, 10, 0] }), k(11, { r: [-28, 12, 0], e: 'out' }),
    k(20, { r: [36, 0, 0], e: 'linear' }), k(36, { r: [20, 0, 0] }), k(56, { r: [0, 0, 0] }),
  ],
  head: [k(0, { r: [0, 0, 0] }), k(11, { r: [-18, 0, 0] }), k(20, { r: [24, 0, 0] }), k(56, { r: [0, 0, 0] })],

  // Straight up, then straight down through the target.
  'upperArm.R': [
    k(0, { r: [-48, 0, 12] }),
    k(11, { r: [-176, 0, -18], e: 'out' }),
    k(16, { r: [-148, 0, -14], e: 'linear' }),
    k(20, { r: [-76, 0, -8], e: 'linear' }),
    k(23, { r: [-52, 0, -6], e: 'linear' }),
    k(36, { r: [-24, 0, -6] }), k(56, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(11, { r: [-72, 0, 0], e: 'out' }),
    k(20, { r: [-8, 0, 0], e: 'linear' }), k(56, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [
    k(0, { r: [0, 0, 5] }), k(11, { r: [-150, 0, 26], e: 'out' }),
    k(20, { r: [-64, 0, 14], e: 'linear' }), k(56, { r: [0, 0, 5] }),
  ],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(11, { r: [-74, 0, 0] }), k(20, { r: [-20, 0, 0] }), k(56, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(12, { r: [-8, 0, 3] }), k(24, { r: [-36, 0, 4] }), k(56, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(12, { r: [6, 0, -3] }), k(24, { r: [28, 0, -4] }), k(56, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(24, { r: [42, 0, 0] }), k(56, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(24, { r: [36, 0, 0] }), k(56, { r: [4, 0, 0] })],
});

/**
 * Heavy 1 — a committed overhead. 26 frames of wind-up: long enough that an
 * enemy can punish it, which is exactly the trade the player is making.
 */
export const attackHeavy1 = clip('attackHeavy1', 72, {
  rootMotion: [{ f: 0, z: 0 }, { f: 20, z: -0.12 }, { f: 33, z: 1.35, e: 'out' }, { f: 72, z: 1.35 }],
  events: [{ frame: 26, type: 'swing', id: 'swingHeavy' }, { frame: 30, type: 'camera-shake', strength: 0.18 }],
}, {
  hips: [
    k(0, { r: [0, 0, 0], p: [0, 0, 0] }), k(20, { r: [-12, 32, 0], p: [0, 0.08, 0], e: 'out' }),
    k(31, { r: [18, -8, 0], p: [0, -0.22, 0], e: 'linear' }),
    k(46, { r: [10, -4, 0], p: [0, -0.12, 0] }), k(72, { r: [0, 0, 0], p: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [0, 0, 0] }), k(20, { r: [-34, 26, 0], e: 'out' }),
    k(31, { r: [44, -6, 0], e: 'linear' }), k(50, { r: [26, 0, 0] }), k(72, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [0, 0, 0] }), k(20, { r: [-36, 30, 0], e: 'out' }),
    k(31, { r: [46, -8, 0], e: 'linear' }), k(50, { r: [28, 0, 0] }), k(72, { r: [0, 0, 0] }),
  ],
  head: [k(0, { r: [0, 0, 0] }), k(20, { r: [-26, -12, 0] }), k(31, { r: [32, 0, 0] }), k(72, { r: [0, 0, 0] })],

  // Wound all the way back over the shoulder, then driven down and through.
  'upperArm.R': [
    k(0, { r: [0, 0, -5] }),
    k(20, { r: [-192, 0, -30], e: 'out' }),
    k(26, { r: [-162, 0, -22], e: 'linear' }),
    k(30, { r: [-96, 0, -12], e: 'linear' }),
    k(33, { r: [-58, 0, -8], e: 'linear' }),
    k(50, { r: [-22, 0, -8] }), k(72, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(20, { r: [-104, 0, 0], e: 'out' }),
    k(30, { r: [-6, 0, 0], e: 'linear' }), k(72, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [
    k(0, { r: [0, 0, 5] }), k(20, { r: [-168, 0, 34], e: 'out' }),
    k(31, { r: [-56, 0, 18], e: 'linear' }), k(72, { r: [0, 0, 5] }),
  ],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(20, { r: [-92, 0, 0] }), k(31, { r: [-16, 0, 0] }), k(72, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(20, { r: [16, 0, 4] }), k(34, { r: [-48, 0, 5] }), k(72, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(20, { r: [-12, 0, -4] }), k(34, { r: [40, 0, -5] }), k(72, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(20, { r: [32, 0, 0] }), k(34, { r: [60, 0, 0] }), k(72, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(20, { r: [28, 0, 0] }), k(34, { r: [48, 0, 0] }), k(72, { r: [4, 0, 0] })],
});

/**
 * Heavy 2 — a full-body horizontal sweep through 180°. The arm holds one
 * extended pose and the HIPS do the work, which is what makes it read as a
 * whole-body commitment rather than an arm swing.
 */
export const attackHeavy2 = clip('attackHeavy2', 78, {
  rootMotion: [{ f: 0, z: 0 }, { f: 22, z: -0.08 }, { f: 38, z: 0.9, e: 'out' }, { f: 78, z: 0.9 }],
  events: [{ frame: 24, type: 'swing', id: 'swingHeavy' }],
}, {
  hips: [
    k(0, { r: [0, 0, 0] }), k(22, { r: [0, 68, 0], e: 'out' }),
    k(30, { r: [0, -20, 0], e: 'linear' }), k(38, { r: [0, -108, 0], e: 'linear' }),
    k(54, { r: [0, -84, 0] }), k(78, { r: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [0, 0, 0] }), k(22, { r: [-10, 30, 6], e: 'out' }),
    k(30, { r: [8, -10, -4], e: 'linear' }), k(38, { r: [14, -34, -10], e: 'linear' }),
    k(78, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [0, 0, 0] }), k(22, { r: [-12, 34, 8], e: 'out' }),
    k(30, { r: [6, -12, -6], e: 'linear' }), k(38, { r: [16, -38, -12], e: 'linear' }),
    k(78, { r: [0, 0, 0] }),
  ],
  // Arm locks out and stays out; the sweep comes from the hips above.
  'upperArm.R': [
    k(0, { r: [0, 0, -5] }),
    k(22, { r: [-96, 0, -66], e: 'out' }),
    k(24, { r: [-98, 0, -58], e: 'linear' }),
    k(38, { r: [-96, 0, -40], e: 'linear' }),
    k(58, { r: [-50, 0, -22] }),
    k(78, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(22, { r: [-30, 0, 0] }), k(30, { r: [-8, 0, 0], e: 'linear' }),
    k(78, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(22, { r: [-40, 0, 58] }), k(38, { r: [-56, 0, 34] }), k(78, { r: [0, 0, 5] })],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(22, { r: [-66, 0, 0] }), k(78, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(22, { r: [-22, 0, 6] }), k(40, { r: [-32, 0, 8] }), k(78, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(22, { r: [20, 0, -6] }), k(40, { r: [26, 0, -8] }), k(78, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(30, { r: [38, 0, 0] }), k(78, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(30, { r: [44, 0, 0] }), k(78, { r: [4, 0, 0] })],
});

/** Guard — a held pose, so it loops on a single key. Blade across the body. */
export const guardClip = clip('guard', 24, { loop: true }, {
  hips: [k(0, { r: [0, 18, 0] }), k(24, { r: [0, 18, 0] })],
  spine: [k(0, { r: [8, 14, 0] }), k(12, { r: [9, 14, 0] }), k(24, { r: [8, 14, 0] })],
  chest: [k(0, { r: [6, 16, 0] }), k(24, { r: [6, 16, 0] })],
  head: [k(0, { r: [-4, -14, 0] }), k(24, { r: [-4, -14, 0] })],
  'upperArm.R': [k(0, { r: [-84, 0, -12] }), k(24, { r: [-84, 0, -12] })],
  'lowerArm.R': [k(0, { r: [-78, 0, 0] }), k(24, { r: [-78, 0, 0] })],
  'upperArm.L': [k(0, { r: [-62, 0, 40] }), k(24, { r: [-62, 0, 40] })],
  'lowerArm.L': [k(0, { r: [-84, 0, 0] }), k(24, { r: [-84, 0, 0] })],
  'thigh.L': [k(0, { r: [-14, 0, 4] }), k(24, { r: [-14, 0, 4] })],
  'thigh.R': [k(0, { r: [12, 0, -4] }), k(24, { r: [12, 0, -4] })],
  'shin.L': [k(0, { r: [24, 0, 0] }), k(24, { r: [24, 0, 0] })],
  'shin.R': [k(0, { r: [28, 0, 0] }), k(24, { r: [28, 0, 0] })],
});

/** Deflect — a short, sharp push into the incoming blade. */
export const deflectClip = clip('deflect', 26, {
  events: [{ frame: 2, type: 'sfx', id: 'deflect' }],
}, {
  hips: [k(0, { r: [0, 18, 0] }), k(4, { r: [0, -8, 0], e: 'snap' }), k(26, { r: [0, 18, 0] })],
  spine: [k(0, { r: [8, 14, 0] }), k(4, { r: [-8, -12, 0], e: 'snap' }), k(26, { r: [8, 14, 0] })],
  chest: [k(0, { r: [6, 16, 0] }), k(4, { r: [-10, -16, 0], e: 'snap' }), k(26, { r: [6, 16, 0] })],
  'upperArm.R': [k(0, { r: [-84, 0, -12] }), k(4, { r: [-104, 0, 26], e: 'snap' }), k(26, { r: [-84, 0, -12] })],
  'lowerArm.R': [k(0, { r: [-78, 0, 0] }), k(4, { r: [-22, 0, 0], e: 'snap' }), k(26, { r: [-78, 0, 0] })],
  'upperArm.L': [k(0, { r: [-62, 0, 40] }), k(4, { r: [-88, 0, 22], e: 'snap' }), k(26, { r: [-62, 0, 40] })],
  'lowerArm.L': [k(0, { r: [-84, 0, 0] }), k(4, { r: [-28, 0, 0], e: 'snap' }), k(26, { r: [-84, 0, 0] })],
});

/**
 * Drinking. 62 frames and no cancel. The whole design of a healing item is
 * that using it is a bet on having read the enemy correctly.
 */
export const drinkClip = clip('drink', 62, {
  events: [{ frame: 34, type: 'heal' }, { frame: 10, type: 'sfx', id: 'uncork' }],
}, {
  hips: [k(0, { p: [0, 0, 0] }), k(20, { p: [0, -0.06, 0], r: [4, -8, 0] }), k(62, { p: [0, 0, 0], r: [0, 0, 0] })],
  spine: [k(0, { r: [0, 0, 0] }), k(18, { r: [-6, -6, 0] }), k(40, { r: [-10, -4, 0] }), k(62, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(18, { r: [-4, -8, 0] }), k(62, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(22, { r: [-8, 6, 0] }), k(38, { r: [-26, 4, 0] }), k(52, { r: [-4, 0, 0] }), k(62, { r: [0, 0, 0] })],
  'upperArm.L': [
    k(0, { r: [0, 0, 5] }), k(14, { r: [-64, 0, 26], e: 'out' }),
    k(30, { r: [-112, 0, 14] }), k(44, { r: [-108, 0, 12] }), k(62, { r: [0, 0, 5] }),
  ],
  'lowerArm.L': [
    k(0, { r: [-15, 0, 0] }), k(14, { r: [-78, 0, 0] }), k(30, { r: [-132, 0, 0] }),
    k(44, { r: [-134, 0, 0] }), k(62, { r: [-15, 0, 0] }),
  ],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(20, { r: [-24, 0, -20] }), k(62, { r: [0, 0, -5] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(20, { r: [-10, 0, 3] }), k(62, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(20, { r: [8, 0, -3] }), k(62, { r: [0, 0, -2] })],
});

/**
 * Hit reactions play on the UPPER layer, so the legs keep running. A full-body
 * flinch stops the character dead and makes chip damage feel like a stun.
 */
export const hitLightClip = clip('hitLight', 20, {}, {
  spine: [k(0, { r: [0, 0, 0] }), k(3, { r: [-14, 8, 4], e: 'snap' }), k(20, { r: [0, 0, 0], e: 'out' })],
  chest: [k(0, { r: [0, 0, 0] }), k(3, { r: [-18, 12, 6], e: 'snap' }), k(20, { r: [0, 0, 0], e: 'out' })],
  head: [k(0, { r: [0, 0, 0] }), k(3, { r: [-22, 16, 8], e: 'snap' }), k(20, { r: [0, 0, 0], e: 'out' })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(3, { r: [-28, 0, 24], e: 'snap' }), k(20, { r: [0, 0, 5], e: 'out' })],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(3, { r: [-22, 0, -20], e: 'snap' }), k(20, { r: [0, 0, -5], e: 'out' })],
});

/** Stagger — full body, poise broken, and you are open. */
export const staggerClip = clip('stagger', 46, {
  rootMotion: [{ f: 0, z: 0 }, { f: 8, z: -0.55, e: 'out' }, { f: 46, z: -0.62 }],
  events: [{ frame: 1, type: 'sfx', id: 'stagger' }],
}, {
  hips: [k(0, { r: [0, 0, 0], p: [0, 0, 0] }), k(7, { r: [-22, 10, 6], p: [0, -0.16, 0], e: 'snap' }),
    k(20, { r: [-10, 6, 3], p: [0, -0.10, 0] }), k(46, { r: [0, 0, 0], p: [0, 0, 0], e: 'out' })],
  spine: [k(0, { r: [0, 0, 0] }), k(7, { r: [-30, 14, 8], e: 'snap' }), k(24, { r: [-12, 6, 3] }), k(46, { r: [0, 0, 0], e: 'out' })],
  chest: [k(0, { r: [0, 0, 0] }), k(7, { r: [-34, 18, 10], e: 'snap' }), k(46, { r: [0, 0, 0], e: 'out' })],
  head: [k(0, { r: [0, 0, 0] }), k(7, { r: [-40, 22, 12], e: 'snap' }), k(46, { r: [0, 0, 0], e: 'out' })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(7, { r: [-48, 0, 44], e: 'snap' }), k(46, { r: [0, 0, 5], e: 'out' })],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(7, { r: [-42, 0, -38], e: 'snap' }), k(46, { r: [0, 0, -5], e: 'out' })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(9, { r: [26, 0, 5] }), k(46, { r: [0, 0, 2], e: 'out' })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(9, { r: [-18, 0, -5] }), k(46, { r: [0, 0, -2], e: 'out' })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(9, { r: [48, 0, 0] }), k(46, { r: [4, 0, 0], e: 'out' })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(9, { r: [30, 0, 0] }), k(46, { r: [4, 0, 0], e: 'out' })],
});

/** The critical: a slow, deliberate thrust into a staggered target. */
export const criticalClip = clip('critical', 74, {
  rootMotion: [{ f: 0, z: 0 }, { f: 20, z: 0.5 }, { f: 34, z: 1.1, e: 'out' }, { f: 74, z: 1.1 }],
  events: [{ frame: 32, type: 'criticalHit' }, { frame: 32, type: 'camera-shake', strength: 0.5 }],
}, {
  hips: [k(0, { r: [0, 0, 0], p: [0, 0, 0] }), k(18, { r: [-4, 24, 0], p: [0, -0.10, 0] }),
    k(34, { r: [14, -8, 0], p: [0, -0.22, 0], e: 'linear' }), k(74, { r: [0, 0, 0], p: [0, 0, 0] })],
  spine: [k(0, { r: [0, 0, 0] }), k(18, { r: [-14, 20, 0] }), k(34, { r: [34, -6, 0], e: 'linear' }), k(74, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(18, { r: [-16, 24, 0] }), k(34, { r: [36, -8, 0], e: 'linear' }), k(74, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(18, { r: [4, -14, 0] }), k(34, { r: [28, 0, 0] }), k(74, { r: [0, 0, 0] })],

  // Drawn back to the hip, then driven straight forward. The blade points at
  // the target for the whole thrust, which is what makes it read as a thrust.
  'upperArm.R': [
    k(0, { r: [0, 0, -5] }),
    k(18, { r: [-64, 0, -46], e: 'out' }),
    k(30, { r: [-78, 0, -26], e: 'linear' }),
    k(34, { r: [-102, 0, -6], e: 'linear' }),
    k(48, { r: [-88, 0, -8] }),
    k(74, { r: [0, 0, -5] }),
  ],
  'lowerArm.R': [k(0, { r: [-15, 0, 0] }), k(18, { r: [-112, 0, 0] }), k(34, { r: [-6, 0, 0], e: 'linear' }), k(74, { r: [-15, 0, 0] })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(18, { r: [-72, 0, 34] }), k(34, { r: [-46, 0, 16] }), k(74, { r: [0, 0, 5] })],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(18, { r: [-96, 0, 0] }), k(74, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(20, { r: [-14, 0, 3] }), k(36, { r: [-46, 0, 5] }), k(74, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(20, { r: [12, 0, -3] }), k(36, { r: [34, 0, -5] }), k(74, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(36, { r: [54, 0, 0] }), k(74, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(36, { r: [42, 0, 0] }), k(74, { r: [4, 0, 0] })],
});

/** Death. Holds its final pose; ragdoll takes over in Phase 8. */
export const deathClip = clip('death', 90, {
  events: [{ frame: 1, type: 'sfx', id: 'death' }],
}, {
  hips: [k(0, { r: [0, 0, 0], p: [0, 0, 0] }), k(14, { r: [-18, 8, 10], p: [0, -0.28, 0], e: 'out' }),
    k(38, { r: [-58, 14, 16], p: [0, -0.68, 0] }), k(62, { r: [-84, 16, 8], p: [0, -0.88, 0.1], e: 'out' }),
    k(90, { r: [-86, 16, 6], p: [0, -0.90, 0.12] })],
  spine: [k(0, { r: [0, 0, 0] }), k(20, { r: [16, -6, 0] }), k(50, { r: [10, -8, 4] }), k(90, { r: [8, -8, 4] })],
  chest: [k(0, { r: [0, 0, 0] }), k(24, { r: [12, -4, 0] }), k(90, { r: [6, -6, 2] })],
  head: [k(0, { r: [0, 0, 0] }), k(16, { r: [-14, 0, 0] }), k(46, { r: [-22, 12, 6] }), k(90, { r: [-24, 14, 8] })],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(18, { r: [-30, 0, -34] }), k(56, { r: [18, 0, -66] }), k(90, { r: [22, 0, -72] })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(18, { r: [-24, 0, 30] }), k(56, { r: [-12, 0, 56] }), k(90, { r: [-14, 0, 60] })],
  'lowerArm.R': [k(0, { r: [-15, 0, 0] }), k(40, { r: [-52, 0, 0] }), k(90, { r: [-56, 0, 0] })],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(40, { r: [-38, 0, 0] }), k(90, { r: [-34, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(24, { r: [24, 0, 6] }), k(64, { r: [-22, 0, 14] }), k(90, { r: [-24, 0, 14] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(24, { r: [14, 0, -6] }), k(64, { r: [-8, 0, -22] }), k(90, { r: [-8, 0, -22] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(30, { r: [58, 0, 0] }), k(90, { r: [46, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(30, { r: [40, 0, 0] }), k(90, { r: [18, 0, 0] })],
});

export function buildAttackClips() {
  return [
    attackLight1, attackLight2, attackLight3,
    attackHeavy1, attackHeavy2,
    guardClip, deflectClip, drinkClip,
    hitLightClip, staggerClip, criticalClip, deathClip,
  ];
}
