import { clip, k } from '../AnimationSystem.js';
import { TUNING } from '../../tuning.js';

/**
 * Hand-authored action clips. These are one-off poses rather than cycles, so
 * they are keyed directly.
 *
 * Frame counts come from TUNING, not from numbers typed here, so that a change
 * to the roll's i-frames and a change to the roll's animation cannot disagree.
 */

const R = TUNING.roll;

/**
 * Roll — 54 frames, 24 of them invincible starting at frame 3.
 *
 * The hips rotate a full turn. Euler keys are broken into sub-180° steps
 * because a slerp from 0° to −360° takes the short path and produces no
 * rotation at all.
 */
export const rollClip = clip('roll', R.totalFrames, {
  rootMotion: [
    { f: 0, z: 0 },
    { f: 6, z: 0.35, e: 'in' },
    { f: 20, z: 2.15, e: 'linear' },
    { f: 34, z: 3.55, e: 'out' },
    { f: 44, z: R.distance, e: 'out' },
    { f: R.totalFrames, z: R.distance },
  ],
  events: [
    { frame: 3, type: 'iframes-on' },
    { frame: 3 + R.invulnFrames, type: 'iframes-off' },
    { frame: 8, type: 'sfx', id: 'roll' },
    { frame: R.recoveryStartFrame, type: 'recovery' },
  ],
}, {
  hips: [
    k(0, { r: [0, 0, 0], p: [0, 0, 0] }),
    k(5, { r: [-38, 0, 0], p: [0, -0.30, 0], e: 'in' }),
    k(14, { r: [-130, 0, 0], p: [0, -0.44, 0], e: 'linear' }),
    k(24, { r: [-245, 0, 0], p: [0, -0.40, 0], e: 'linear' }),
    k(33, { r: [-330, 0, 0], p: [0, -0.26, 0], e: 'linear' }),
    k(40, { r: [-360, 0, 0], p: [0, -0.14, 0], e: 'out' }),
    k(48, { r: [-360, 0, 0], p: [0, -0.03, 0], e: 'out' }),
    k(R.totalFrames, { r: [-360, 0, 0], p: [0, 0, 0] }),
  ],
  spine: [
    k(0, { r: [0, 0, 0] }),
    k(6, { r: [42, 0, 0], e: 'in' }),
    k(22, { r: [55, 0, 0] }),
    k(36, { r: [30, 0, 0] }),
    k(46, { r: [-6, 0, 0], e: 'out' }),
    k(R.totalFrames, { r: [0, 0, 0] }),
  ],
  chest: [
    k(0, { r: [0, 0, 0] }),
    k(8, { r: [34, 0, 0] }),
    k(24, { r: [44, 0, 0] }),
    k(40, { r: [16, 0, 0] }),
    k(R.totalFrames, { r: [0, 0, 0] }),
  ],
  head: [
    k(0, { r: [0, 0, 0] }),
    k(8, { r: [26, 0, 0] }),
    k(26, { r: [34, 0, 0] }),
    k(44, { r: [-4, 0, 0] }),
    k(R.totalFrames, { r: [0, 0, 0] }),
  ],
  'upperArm.L': [
    k(0, { r: [0, 0, 5] }), k(6, { r: [-48, 0, 24], e: 'in' }),
    k(22, { r: [-64, 0, 30] }), k(40, { r: [-14, 0, 12] }),
    k(R.totalFrames, { r: [0, 0, 5] }),
  ],
  'upperArm.R': [
    k(0, { r: [0, 0, -5] }), k(6, { r: [-48, 0, -24], e: 'in' }),
    k(22, { r: [-64, 0, -30] }), k(40, { r: [-14, 0, -12] }),
    k(R.totalFrames, { r: [0, 0, -5] }),
  ],
  'lowerArm.L': [
    k(0, { r: [-15, 0, 0] }), k(8, { r: [-96, 0, 0] }),
    k(24, { r: [-112, 0, 0] }), k(42, { r: [-30, 0, 0] }),
    k(R.totalFrames, { r: [-15, 0, 0] }),
  ],
  'lowerArm.R': [
    k(0, { r: [-15, 0, 0] }), k(8, { r: [-96, 0, 0] }),
    k(24, { r: [-112, 0, 0] }), k(42, { r: [-30, 0, 0] }),
    k(R.totalFrames, { r: [-15, 0, 0] }),
  ],
  'thigh.L': [
    k(0, { r: [0, 0, 2] }), k(6, { r: [-64, 0, 8], e: 'in' }),
    k(20, { r: [-98, 0, 10] }), k(34, { r: [-62, 0, 6] }),
    k(46, { r: [-8, 0, 2], e: 'out' }), k(R.totalFrames, { r: [0, 0, 2] }),
  ],
  'thigh.R': [
    k(0, { r: [0, 0, -2] }), k(6, { r: [-58, 0, -8], e: 'in' }),
    k(20, { r: [-104, 0, -10] }), k(34, { r: [-54, 0, -6] }),
    k(46, { r: [-14, 0, -2], e: 'out' }), k(R.totalFrames, { r: [0, 0, -2] }),
  ],
  'shin.L': [
    k(0, { r: [4, 0, 0] }), k(8, { r: [104, 0, 0], e: 'in' }),
    k(22, { r: [128, 0, 0] }), k(38, { r: [64, 0, 0] }),
    k(48, { r: [10, 0, 0], e: 'out' }), k(R.totalFrames, { r: [4, 0, 0] }),
  ],
  'shin.R': [
    k(0, { r: [4, 0, 0] }), k(8, { r: [112, 0, 0], e: 'in' }),
    k(22, { r: [132, 0, 0] }), k(38, { r: [54, 0, 0] }),
    k(48, { r: [16, 0, 0], e: 'out' }), k(R.totalFrames, { r: [4, 0, 0] }),
  ],
  'foot.L': [k(0, { r: [-2, 0, 0] }), k(14, { r: [26, 0, 0] }), k(44, { r: [-6, 0, 0] }), k(R.totalFrames, { r: [-2, 0, 0] })],
  'foot.R': [k(0, { r: [-2, 0, 0] }), k(14, { r: [26, 0, 0] }), k(44, { r: [-6, 0, 0] }), k(R.totalFrames, { r: [-2, 0, 0] })],
});

/** Backstep — short, low, and much less generous with i-frames than a roll. */
export const backstepClip = clip('backstep', R.backstepFrames, {
  rootMotion: [
    { f: 0, z: 0 },
    { f: 4, z: -0.30, e: 'in' },
    { f: 16, z: -1.85, e: 'linear' },
    { f: 26, z: -R.backstepDistance, e: 'out' },
    { f: R.backstepFrames, z: -R.backstepDistance },
  ],
  events: [
    { frame: R.backstepInvulnStartFrame, type: 'iframes-on' },
    { frame: R.backstepInvulnStartFrame + R.backstepInvulnFrames, type: 'iframes-off' },
    { frame: 22, type: 'recovery' },
  ],
}, {
  hips: [k(0, { p: [0, 0, 0] }), k(5, { r: [12, 0, 0], p: [0, -0.13, 0], e: 'in' }),
    k(16, { r: [6, 0, 0], p: [0, -0.05, 0] }), k(R.backstepFrames, { r: [0, 0, 0], p: [0, 0, 0] })],
  spine: [k(0, { r: [0, 0, 0] }), k(6, { r: [-14, 0, 0], e: 'in' }), k(20, { r: [7, 0, 0] }), k(R.backstepFrames, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(8, { r: [-10, 0, 0] }), k(R.backstepFrames, { r: [0, 0, 0] })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(7, { r: [24, 0, 20] }), k(R.backstepFrames, { r: [0, 0, 5] })],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(7, { r: [24, 0, -20] }), k(R.backstepFrames, { r: [0, 0, -5] })],
  'lowerArm.L': [k(0, { r: [-15, 0, 0] }), k(8, { r: [-52, 0, 0] }), k(R.backstepFrames, { r: [-15, 0, 0] })],
  'lowerArm.R': [k(0, { r: [-15, 0, 0] }), k(8, { r: [-52, 0, 0] }), k(R.backstepFrames, { r: [-15, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(6, { r: [24, 0, 4], e: 'in' }), k(18, { r: [-16, 0, 2] }), k(R.backstepFrames, { r: [0, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(6, { r: [-18, 0, -4], e: 'in' }), k(18, { r: [22, 0, -2] }), k(R.backstepFrames, { r: [0, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(8, { r: [42, 0, 0] }), k(22, { r: [14, 0, 0] }), k(R.backstepFrames, { r: [4, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(8, { r: [58, 0, 0] }), k(22, { r: [12, 0, 0] }), k(R.backstepFrames, { r: [4, 0, 0] })],
});

/** Jump — a crouch you can see, then a launch. Telegraphing your own jump matters. */
export const jumpStartClip = clip('jumpStart', 10, {
  events: [{ frame: 5, type: 'launch' }],
}, {
  hips: [k(0, { p: [0, 0, 0] }), k(4, { p: [0, -0.19, 0], r: [8, 0, 0], e: 'in' }), k(10, { p: [0, 0.04, 0], r: [-4, 0, 0], e: 'out' })],
  spine: [k(0, { r: [0, 0, 0] }), k(4, { r: [16, 0, 0] }), k(10, { r: [-6, 0, 0] })],
  'thigh.L': [k(0, { r: [0, 0, 2] }), k(4, { r: [46, 0, 2] }), k(10, { r: [-12, 0, 2] })],
  'thigh.R': [k(0, { r: [0, 0, -2] }), k(4, { r: [46, 0, -2] }), k(10, { r: [-12, 0, -2] })],
  'shin.L': [k(0, { r: [4, 0, 0] }), k(4, { r: [78, 0, 0] }), k(10, { r: [8, 0, 0] })],
  'shin.R': [k(0, { r: [4, 0, 0] }), k(4, { r: [78, 0, 0] }), k(10, { r: [8, 0, 0] })],
  'upperArm.L': [k(0, { r: [0, 0, 5] }), k(4, { r: [34, 0, 10] }), k(10, { r: [-42, 0, 16], e: 'out' })],
  'upperArm.R': [k(0, { r: [0, 0, -5] }), k(4, { r: [34, 0, -10] }), k(10, { r: [-42, 0, -16], e: 'out' })],
});

export const jumpAirClip = clip('jumpAir', 40, { loop: true }, {
  hips: [k(0, { r: [-6, 0, 0] }), k(20, { r: [2, 0, 0] }), k(40, { r: [-6, 0, 0] })],
  spine: [k(0, { r: [-4, 0, 0] }), k(20, { r: [6, 0, 0] }), k(40, { r: [-4, 0, 0] })],
  'thigh.L': [k(0, { r: [-30, 0, 3] }), k(20, { r: [-16, 0, 3] }), k(40, { r: [-30, 0, 3] })],
  'thigh.R': [k(0, { r: [-8, 0, -3] }), k(20, { r: [-24, 0, -3] }), k(40, { r: [-8, 0, -3] })],
  'shin.L': [k(0, { r: [56, 0, 0] }), k(20, { r: [34, 0, 0] }), k(40, { r: [56, 0, 0] })],
  'shin.R': [k(0, { r: [24, 0, 0] }), k(20, { r: [46, 0, 0] }), k(40, { r: [24, 0, 0] })],
  'upperArm.L': [k(0, { r: [-30, 0, 22] }), k(20, { r: [-18, 0, 26] }), k(40, { r: [-30, 0, 22] })],
  'upperArm.R': [k(0, { r: [-30, 0, -22] }), k(20, { r: [-18, 0, -26] }), k(40, { r: [-30, 0, -22] })],
  'lowerArm.L': [k(0, { r: [-40, 0, 0] }), k(20, { r: [-26, 0, 0] }), k(40, { r: [-40, 0, 0] })],
  'lowerArm.R': [k(0, { r: [-40, 0, 0] }), k(20, { r: [-26, 0, 0] }), k(40, { r: [-40, 0, 0] })],
});

/** Falling reads differently from jumping: arms up, legs trailing, no control. */
export const fallClip = clip('fall', 56, { loop: true }, {
  hips: [k(0, { r: [4, 0, 1] }), k(28, { r: [7, 0, -1] }), k(56, { r: [4, 0, 1] })],
  spine: [k(0, { r: [-8, 2, 0] }), k(28, { r: [-11, -2, 0] }), k(56, { r: [-8, 2, 0] })],
  chest: [k(0, { r: [-6, 0, 0] }), k(56, { r: [-6, 0, 0] })],
  head: [k(0, { r: [8, 0, 0] }), k(56, { r: [8, 0, 0] })],
  'thigh.L': [k(0, { r: [-18, 0, 6] }), k(28, { r: [-8, 0, 8] }), k(56, { r: [-18, 0, 6] })],
  'thigh.R': [k(0, { r: [-10, 0, -6] }), k(28, { r: [-22, 0, -8] }), k(56, { r: [-10, 0, -6] })],
  'shin.L': [k(0, { r: [34, 0, 0] }), k(28, { r: [22, 0, 0] }), k(56, { r: [34, 0, 0] })],
  'shin.R': [k(0, { r: [20, 0, 0] }), k(28, { r: [36, 0, 0] }), k(56, { r: [20, 0, 0] })],
  'upperArm.L': [k(0, { r: [-96, 0, 34] }), k(28, { r: [-108, 0, 40] }), k(56, { r: [-96, 0, 34] })],
  'upperArm.R': [k(0, { r: [-96, 0, -34] }), k(28, { r: [-108, 0, -40] }), k(56, { r: [-96, 0, -34] })],
  'lowerArm.L': [k(0, { r: [-24, 0, 0] }), k(28, { r: [-38, 0, 0] }), k(56, { r: [-24, 0, 0] })],
  'lowerArm.R': [k(0, { r: [-24, 0, 0] }), k(28, { r: [-38, 0, 0] }), k(56, { r: [-24, 0, 0] })],
});

export const landClip = clip('land', 18, {
  events: [{ frame: 1, type: 'sfx', id: 'land' }],
}, {
  hips: [k(0, { p: [0, -0.05, 0], r: [6, 0, 0] }), k(4, { p: [0, -0.22, 0], r: [14, 0, 0], e: 'in' }), k(18, { p: [0, 0, 0], r: [0, 0, 0], e: 'out' })],
  spine: [k(0, { r: [10, 0, 0] }), k(4, { r: [24, 0, 0] }), k(18, { r: [0, 0, 0], e: 'out' })],
  'thigh.L': [k(0, { r: [-14, 0, 3] }), k(4, { r: [50, 0, 4] }), k(18, { r: [0, 0, 2], e: 'out' })],
  'thigh.R': [k(0, { r: [-14, 0, -3] }), k(4, { r: [50, 0, -4] }), k(18, { r: [0, 0, -2], e: 'out' })],
  'shin.L': [k(0, { r: [26, 0, 0] }), k(4, { r: [86, 0, 0] }), k(18, { r: [4, 0, 0], e: 'out' })],
  'shin.R': [k(0, { r: [26, 0, 0] }), k(4, { r: [86, 0, 0] }), k(18, { r: [4, 0, 0], e: 'out' })],
  'upperArm.L': [k(0, { r: [-40, 0, 18] }), k(5, { r: [26, 0, 26] }), k(18, { r: [0, 0, 5], e: 'out' })],
  'upperArm.R': [k(0, { r: [-40, 0, -18] }), k(5, { r: [26, 0, -26] }), k(18, { r: [0, 0, -5], e: 'out' })],
});

/** A hard landing costs real time. It is the price of the drop you chose to take. */
export const landHardClip = clip('landHard', TUNING.movement.landHardRecoveryFrames, {
  events: [{ frame: 1, type: 'sfx', id: 'landHard' }, { frame: 2, type: 'camera-shake', strength: 0.5 }],
}, {
  hips: [k(0, { p: [0, -0.10, 0], r: [12, 0, 0] }), k(6, { p: [0, -0.52, 0], r: [46, 0, 0], e: 'in' }),
    k(13, { p: [0, -0.48, 0], r: [44, 0, 0] }), k(22, { p: [0, 0, 0], r: [0, 0, 0], e: 'out' })],
  spine: [k(0, { r: [16, 0, 0] }), k(6, { r: [48, 0, 0] }), k(22, { r: [0, 0, 0], e: 'out' })],
  chest: [k(0, { r: [10, 0, 0] }), k(6, { r: [30, 0, 0] }), k(22, { r: [0, 0, 0], e: 'out' })],
  head: [k(0, { r: [-8, 0, 0] }), k(6, { r: [-30, 0, 0] }), k(22, { r: [0, 0, 0], e: 'out' })],
  'thigh.L': [k(0, { r: [-10, 0, 3] }), k(6, { r: [84, 0, 8] }), k(22, { r: [0, 0, 2], e: 'out' })],
  'thigh.R': [k(0, { r: [-10, 0, -3] }), k(6, { r: [80, 0, -8] }), k(22, { r: [0, 0, -2], e: 'out' })],
  'shin.L': [k(0, { r: [22, 0, 0] }), k(6, { r: [116, 0, 0] }), k(22, { r: [4, 0, 0], e: 'out' })],
  'shin.R': [k(0, { r: [22, 0, 0] }), k(6, { r: [112, 0, 0] }), k(22, { r: [4, 0, 0], e: 'out' })],
  'upperArm.L': [k(0, { r: [-52, 0, 20] }), k(7, { r: [48, 0, 34] }), k(22, { r: [0, 0, 5], e: 'out' })],
  'upperArm.R': [k(0, { r: [-52, 0, -20] }), k(7, { r: [48, 0, -34] }), k(22, { r: [0, 0, -5], e: 'out' })],
  'lowerArm.L': [k(0, { r: [-20, 0, 0] }), k(7, { r: [-84, 0, 0] }), k(22, { r: [-15, 0, 0], e: 'out' })],
  'lowerArm.R': [k(0, { r: [-20, 0, 0] }), k(7, { r: [-84, 0, 0] }), k(22, { r: [-15, 0, 0], e: 'out' })],
});

/** The corpse, before the light enters it. Beat 1. Not quite still. */
export const corpseClip = clip('corpse', 200, { loop: true }, {
  hips: [k(0, { r: [-88, 12, 4], p: [0, -0.86, 0] }), k(200, { r: [-88, 12, 4], p: [0, -0.86, 0] })],
  spine: [k(0, { r: [10, -6, 3] }), k(100, { r: [11, -6, 3] }), k(200, { r: [10, -6, 3] })],
  chest: [k(0, { r: [6, -4, -2] }), k(200, { r: [6, -4, -2] })],
  neck: [k(0, { r: [-14, 8, 0] }), k(200, { r: [-14, 8, 0] })],
  head: [k(0, { r: [-22, 16, 6] }), k(200, { r: [-22, 16, 6] })],
  'upperArm.L': [k(0, { r: [-14, 0, 62] }), k(200, { r: [-14, 0, 62] })],
  'upperArm.R': [k(0, { r: [22, 0, -74] }), k(200, { r: [22, 0, -74] })],
  'lowerArm.L': [k(0, { r: [-34, 0, 0] }), k(200, { r: [-34, 0, 0] })],
  'lowerArm.R': [k(0, { r: [-58, 0, 0] }), k(200, { r: [-58, 0, 0] })],
  'thigh.L': [k(0, { r: [-24, 0, 14] }), k(200, { r: [-24, 0, 14] })],
  'thigh.R': [k(0, { r: [-8, 0, -22] }), k(200, { r: [-8, 0, -22] })],
  'shin.L': [k(0, { r: [46, 0, 0] }), k(200, { r: [46, 0, 0] })],
  'shin.R': [k(0, { r: [18, 0, 0] }), k(200, { r: [18, 0, 0] })],
});

/**
 * Embodiment. Beat 2 — the single most important animation in the chapter.
 *
 * 200 frames, deliberately too long. This is a body that does not want to
 * work being made to work: a hand finds the ground before the head lifts, a
 * knee gives out at frame 118 and has to be recovered. No tutorial popup can
 * do what a stand-up that costs three and a half seconds does.
 */
export const standUpClip = clip('standUp', 200, {
  events: [
    { frame: 22, type: 'sfx', id: 'breath' },
    { frame: 74, type: 'sfx', id: 'scrape' },
    { frame: 118, type: 'sfx', id: 'stumble' },
    { frame: 118, type: 'camera-shake', strength: 0.22 },
    { frame: 196, type: 'embodied' },
  ],
  rootMotion: [{ f: 0, z: 0 }, { f: 200, z: 0.22 }],
}, {
  hips: [
    k(0, { r: [-88, 12, 4], p: [0, -0.86, 0] }),
    k(30, { r: [-80, 10, 3], p: [0, -0.84, 0] }),
    k(62, { r: [-52, 8, 2], p: [0, -0.72, 0.04], e: 'in' }),
    k(96, { r: [-16, 5, 1], p: [0, -0.46, 0.06] }),
    k(118, { r: [-24, 4, -3], p: [0, -0.56, 0.05], e: 'in' }), // the knee gives
    k(140, { r: [-10, 2, 1], p: [0, -0.34, 0.04], e: 'out' }),
    k(178, { r: [2, 0, 0], p: [0, -0.04, 0] }),
    k(200, { r: [0, 0, 0], p: [0, 0, 0], e: 'out' }),
  ],
  spine: [
    k(0, { r: [10, -6, 3] }), k(40, { r: [26, -4, 2] }), k(70, { r: [40, -2, 1] }),
    k(100, { r: [30, 0, 0] }), k(120, { r: [42, 0, -2] }), k(150, { r: [16, 0, 0] }),
    k(200, { r: [0, 0, 0], e: 'out' }),
  ],
  chest: [
    k(0, { r: [6, -4, -2] }), k(48, { r: [16, -2, 0] }), k(90, { r: [22, 0, 0] }),
    k(130, { r: [14, 0, 0] }), k(200, { r: [0, 0, 0], e: 'out' }),
  ],
  neck: [k(0, { r: [-14, 8, 0] }), k(50, { r: [-6, 4, 0] }), k(110, { r: [4, 0, 0] }), k(200, { r: [0, 0, 0] })],
  head: [
    k(0, { r: [-22, 16, 6] }), k(24, { r: [-18, 12, 5] }), k(58, { r: [-4, 6, 2] }),
    k(96, { r: [10, 0, 0] }), k(124, { r: [-12, 0, 0] }), k(170, { r: [2, 0, 0] }),
    k(200, { r: [0, 0, 0] }),
  ],
  // The right hand finds the ground first and takes the weight.
  'upperArm.R': [
    k(0, { r: [22, 0, -74] }), k(26, { r: [-8, 0, -52], e: 'in' }), k(58, { r: [-34, 0, -30] }),
    k(90, { r: [-46, 0, -22] }), k(120, { r: [-30, 0, -26] }), k(160, { r: [-6, 0, -12] }),
    k(200, { r: [0, 0, -5], e: 'out' }),
  ],
  'lowerArm.R': [
    k(0, { r: [-58, 0, 0] }), k(30, { r: [-88, 0, 0] }), k(64, { r: [-64, 0, 0] }),
    k(100, { r: [-28, 0, 0] }), k(200, { r: [-15, 0, 0] }),
  ],
  'upperArm.L': [
    k(0, { r: [-14, 0, 62] }), k(44, { r: [-20, 0, 46] }), k(80, { r: [-30, 0, 30] }),
    k(118, { r: [-52, 0, 34] }), k(155, { r: [-14, 0, 14] }), k(200, { r: [0, 0, 5], e: 'out' }),
  ],
  'lowerArm.L': [
    k(0, { r: [-34, 0, 0] }), k(60, { r: [-70, 0, 0] }), k(118, { r: [-96, 0, 0] }),
    k(160, { r: [-34, 0, 0] }), k(200, { r: [-15, 0, 0] }),
  ],
  'thigh.L': [
    k(0, { r: [-24, 0, 14] }), k(56, { r: [-58, 0, 12] }), k(88, { r: [-72, 0, 8] }),
    k(118, { r: [-84, 0, 10] }), k(146, { r: [-40, 0, 5] }), k(200, { r: [0, 0, 2], e: 'out' }),
  ],
  'shin.L': [
    k(0, { r: [46, 0, 0] }), k(56, { r: [92, 0, 0] }), k(88, { r: [104, 0, 0] }),
    k(118, { r: [116, 0, 0] }), k(150, { r: [52, 0, 0] }), k(200, { r: [4, 0, 0], e: 'out' }),
  ],
  'thigh.R': [
    k(0, { r: [-8, 0, -22] }), k(64, { r: [-36, 0, -14] }), k(102, { r: [-52, 0, -8] }),
    k(126, { r: [-30, 0, -6] }), k(200, { r: [0, 0, -2], e: 'out' }),
  ],
  'shin.R': [
    k(0, { r: [18, 0, 0] }), k(64, { r: [66, 0, 0] }), k(102, { r: [78, 0, 0] }),
    k(140, { r: [30, 0, 0] }), k(200, { r: [4, 0, 0], e: 'out' }),
  ],
  'foot.L': [k(0, { r: [16, 0, 0] }), k(96, { r: [-4, 0, 0] }), k(200, { r: [-2, 0, 0] })],
  'foot.R': [k(0, { r: [-14, 0, 0] }), k(110, { r: [2, 0, 0] }), k(200, { r: [-2, 0, 0] })],
});

export function buildActionClips() {
  return [
    rollClip, backstepClip,
    jumpStartClip, jumpAirClip, fallClip, landClip, landHardClip,
    corpseClip, standUpClip,
  ];
}
