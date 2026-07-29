import { clip, k } from '../../character/AnimationSystem.js';

/**
 * THE DROWNED — animation clips.
 *
 * The whole readability requirement lives in these keys. Rule applied to every
 * attack: the wind-up pose must differ from every other wind-up pose in
 * SILHOUETTE, not in detail. So each move loads a different set of limbs and
 * moves the mask to a different height:
 *
 *   lunge     mask HIGH, body coiled straight back, all six legs braced
 *   sweep     mask LOW and turned, one limb drawn fully across the body
 *   delayed   starts identical to lunge, then FREEZES — the tell is the pause
 *   slam      mask CENTRE, both arms straight overhead — unmistakable
 *   skitter   body TIPPED, legs loaded on one side only
 *
 * The delayed strike is deliberately indistinguishable from the lunge for its
 * first 20 frames. That is the trap, and it is fair because the hold that
 * follows is 22 frames long — plenty of time to see it and stop rolling.
 */

const LEGS = ['legA.L', 'legA.R', 'legB.L', 'legB.R', 'legC.L', 'legC.R'];

/** Applies the same pose to a set of legs, so bracing reads as one gesture. */
function legPose(tracks, names, keys) {
  for (const n of names) {
    for (const [part, list] of Object.entries(keys)) {
      tracks[`${n}.${part}`] = list.map((key) => ({ ...key }));
    }
  }
  return tracks;
}

/** Idle: slow breathing swell, limbs drifting as if the water is moving them. */
export const bossIdle = (() => {
  const tracks = {};
  const samples = 16;
  const frames = 220;
  for (let s = 0; s <= samples; s++) {
    const f = (s / samples) * frames;
    const t = (s / samples) * Math.PI * 2;
    const e = 'linear';
    (tracks.core ??= []).push(k(f, { p: [0, Math.sin(t) * 0.06, 0], r: [Math.sin(t) * 2, Math.sin(t * 0.5) * 3, 0], e }));
    (tracks.torso ??= []).push(k(f, { r: [Math.sin(t + 1) * 3, 0, 0], e }));
    (tracks.chest ??= []).push(k(f, { r: [Math.sin(t + 2) * 2.5, Math.sin(t * 0.7) * 4, 0], e }));
    (tracks.head ??= []).push(k(f, { r: [Math.sin(t * 0.6) * 3, Math.sin(t * 0.45) * 6, Math.sin(t * 0.8) * 2], e }));
    for (const [i, n] of LEGS.entries()) {
      const off = i * 1.05;
      (tracks[`${n}.femur`] ??= []).push(k(f, { r: [Math.sin(t + off) * 4, 0, Math.cos(t + off) * 5], e }));
      (tracks[`${n}.tibia`] ??= []).push(k(f, { r: [Math.sin(t + off + 0.7) * 6, 0, 0], e }));
    }
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      (tracks[`arm.${side}`] ??= []).push(k(f, { r: [Math.sin(t + 0.4) * 5, 0, sg * (14 + Math.sin(t) * 4)], e }));
      (tracks[`forearm.${side}`] ??= []).push(k(f, { r: [-32 + Math.sin(t + 1.2) * 7, 0, 0], e }));
    }
  }
  return clip('bossIdle', frames, { loop: true }, tracks);
})();

/** LUNGE — coil straight back with the mask lifted, then commit forward. */
export const bossLunge = clip('bossLunge', 96, {
  rootMotion: [
    { f: 0, z: 0 }, { f: 20, z: -0.9, e: 'out' }, { f: 34, z: -1.1 },
    { f: 44, z: 8.6, e: 'linear' }, { f: 56, z: 9.4, e: 'out' }, { f: 96, z: 9.4 },
  ],
  events: [{ frame: 6, type: 'tell', id: 'bossLungeTell' }, { frame: 44, type: 'shake', strength: 0.35 }],
}, legPose({
  core: [
    k(0, { p: [0, 0, 0], r: [0, 0, 0] }),
    k(22, { p: [0, 0.55, 0], r: [-22, 0, 0], e: 'out' }),   // reared, mask high
    k(34, { p: [0, 0.62, 0], r: [-26, 0, 0] }),
    k(42, { p: [0, -0.10, 0], r: [26, 0, 0], e: 'linear' }), // driven forward
    k(60, { p: [0, 0.05, 0], r: [8, 0, 0] }),
    k(96, { p: [0, 0, 0], r: [0, 0, 0], e: 'out' }),
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(22, { r: [-30, 0, 0], e: 'out' }), k(42, { r: [34, 0, 0], e: 'linear' }), k(96, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(22, { r: [-24, 0, 0], e: 'out' }), k(42, { r: [30, 0, 0], e: 'linear' }), k(96, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(22, { r: [-34, 0, 0], e: 'out' }), k(42, { r: [26, 0, 0], e: 'linear' }), k(96, { r: [0, 0, 0] })],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(22, { r: [-52, 0, 46], e: 'out' }), k(42, { r: [-88, 0, 12], e: 'linear' }), k(96, { r: [0, 0, 14] })],
  'arm.R': [k(0, { r: [0, 0, -14] }), k(22, { r: [-52, 0, -46], e: 'out' }), k(42, { r: [-88, 0, -12], e: 'linear' }), k(96, { r: [0, 0, -14] })],
  'forearm.L': [k(0, { r: [-32, 0, 0] }), k(22, { r: [-76, 0, 0] }), k(42, { r: [-10, 0, 0], e: 'linear' }), k(96, { r: [-32, 0, 0] })],
  'forearm.R': [k(0, { r: [-32, 0, 0] }), k(22, { r: [-76, 0, 0] }), k(42, { r: [-10, 0, 0], e: 'linear' }), k(96, { r: [-32, 0, 0] })],
}, LEGS, {
  // All six legs brace back and fold — the loading is visible from any angle.
  femur: [k(0, { r: [0, 0, 0] }), k(24, { r: [-34, 0, 22], e: 'out' }), k(42, { r: [30, 0, -8], e: 'linear' }), k(96, { r: [0, 0, 0] })],
  tibia: [k(0, { r: [0, 0, 0] }), k(24, { r: [48, 0, 0], e: 'out' }), k(42, { r: [-16, 0, 0], e: 'linear' }), k(96, { r: [0, 0, 0] })],
}));

/** SWEEP — one limb drawn fully across the body, low and wide. */
export const bossSweep = clip('bossSweep', 88, {
  rootMotion: [{ f: 0, z: 0 }, { f: 30, z: 0.3 }, { f: 46, z: 1.1, e: 'out' }, { f: 88, z: 1.1 }],
  events: [{ frame: 6, type: 'tell', id: 'bossSweepTell' }, { frame: 32, type: 'shake', strength: 0.25 }],
}, {
  core: [
    k(0, { r: [0, 0, 0], p: [0, 0, 0] }),
    k(26, { r: [4, 54, -8], p: [0, -0.30, 0], e: 'out' }),   // dropped low and turned
    k(38, { r: [2, -20, 4], p: [0, -0.34, 0], e: 'linear' }),
    k(46, { r: [0, -66, 8], p: [0, -0.28, 0], e: 'linear' }),
    k(88, { r: [0, 0, 0], p: [0, 0, 0], e: 'out' }),
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(26, { r: [8, 34, 0], e: 'out' }), k(46, { r: [6, -40, 0], e: 'linear' }), k(88, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(26, { r: [16, 40, 0] }), k(46, { r: [10, -44, 0], e: 'linear' }), k(88, { r: [0, 0, 0] })],
  // The sweeping limbs are the LEFT front pair. They wind fully back, then travel.
  'legA.L.femur': [
    k(0, { r: [0, 0, 0] }), k(28, { r: [-14, 0, 74], e: 'out' }),
    k(38, { r: [-8, 0, 10], e: 'linear' }), k(46, { r: [-4, 0, -68], e: 'linear' }), k(88, { r: [0, 0, 0] }),
  ],
  'legA.L.tibia': [k(0, { r: [0, 0, 0] }), k(28, { r: [34, 0, 0] }), k(40, { r: [-22, 0, 0], e: 'linear' }), k(88, { r: [0, 0, 0] })],
  'legB.L.femur': [
    k(0, { r: [0, 0, 0] }), k(28, { r: [-18, 0, 82], e: 'out' }),
    k(38, { r: [-10, 0, 14], e: 'linear' }), k(46, { r: [-6, 0, -74], e: 'linear' }), k(88, { r: [0, 0, 0] }),
  ],
  'legB.L.tibia': [k(0, { r: [0, 0, 0] }), k(28, { r: [40, 0, 0] }), k(40, { r: [-26, 0, 0], e: 'linear' }), k(88, { r: [0, 0, 0] })],
  // The other four plant hard, which is what makes the sweep read as anchored.
  ...legPose({}, ['legA.R', 'legB.R', 'legC.R', 'legC.L'], {
    femur: [k(0, { r: [0, 0, 0] }), k(28, { r: [-26, 0, -18], e: 'out' }), k(88, { r: [0, 0, 0] })],
    tibia: [k(0, { r: [0, 0, 0] }), k(28, { r: [38, 0, 0] }), k(88, { r: [0, 0, 0] })],
  }),
});

/**
 * DELAYED — identical to the lunge until frame 20, then the hold.
 * The freeze is authored as two keys with the same value 22 frames apart, so
 * the pause is genuinely motionless rather than a slow drift.
 */
export const bossDelayed = clip('bossDelayed', 104, {
  rootMotion: [
    { f: 0, z: 0 }, { f: 20, z: -0.9, e: 'out' }, { f: 52, z: -1.0 },
    { f: 60, z: 4.6, e: 'linear' }, { f: 72, z: 5.1, e: 'out' }, { f: 104, z: 5.1 },
  ],
  events: [{ frame: 6, type: 'tell', id: 'bossDelayedTell' }, { frame: 30, type: 'tell', id: 'bossHold' }],
}, legPose({
  core: [
    k(0, { p: [0, 0, 0], r: [0, 0, 0] }),
    k(22, { p: [0, 0.55, 0], r: [-22, 0, 0], e: 'out' }),
    k(30, { p: [0, 0.60, 0], r: [-25, 0, 0] }),
    k(52, { p: [0, 0.60, 0], r: [-25, 0, 0], e: 'linear' }), // ← the hold
    k(58, { p: [0, -0.12, 0], r: [30, 0, 0], e: 'linear' }),
    k(76, { p: [0, 0.05, 0], r: [8, 0, 0] }),
    k(104, { p: [0, 0, 0], r: [0, 0, 0], e: 'out' }),
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(22, { r: [-30, 0, 0], e: 'out' }), k(52, { r: [-32, 0, 0], e: 'linear' }), k(58, { r: [36, 0, 0], e: 'linear' }), k(104, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(22, { r: [-24, 0, 0], e: 'out' }), k(52, { r: [-26, 0, 0], e: 'linear' }), k(58, { r: [32, 0, 0], e: 'linear' }), k(104, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(22, { r: [-34, 0, 0], e: 'out' }), k(52, { r: [-36, 0, 0], e: 'linear' }), k(58, { r: [28, 0, 0], e: 'linear' }), k(104, { r: [0, 0, 0] })],
  'arm.R': [
    k(0, { r: [0, 0, -14] }), k(22, { r: [-58, 0, -50], e: 'out' }),
    k(52, { r: [-62, 0, -52], e: 'linear' }), k(60, { r: [-96, 0, -6], e: 'linear' }), k(104, { r: [0, 0, -14] }),
  ],
  'forearm.R': [k(0, { r: [-32, 0, 0] }), k(22, { r: [-88, 0, 0] }), k(52, { r: [-90, 0, 0], e: 'linear' }), k(60, { r: [-6, 0, 0], e: 'linear' }), k(104, { r: [-32, 0, 0] })],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(22, { r: [-40, 0, 40], e: 'out' }), k(52, { r: [-42, 0, 42], e: 'linear' }), k(60, { r: [-70, 0, 16], e: 'linear' }), k(104, { r: [0, 0, 14] })],
  'forearm.L': [k(0, { r: [-32, 0, 0] }), k(22, { r: [-70, 0, 0] }), k(60, { r: [-18, 0, 0], e: 'linear' }), k(104, { r: [-32, 0, 0] })],
}, LEGS, {
  femur: [k(0, { r: [0, 0, 0] }), k(24, { r: [-36, 0, 24], e: 'out' }), k(52, { r: [-38, 0, 25], e: 'linear' }), k(58, { r: [32, 0, -8], e: 'linear' }), k(104, { r: [0, 0, 0] })],
  tibia: [k(0, { r: [0, 0, 0] }), k(24, { r: [50, 0, 0], e: 'out' }), k(52, { r: [52, 0, 0], e: 'linear' }), k(58, { r: [-18, 0, 0], e: 'linear' }), k(104, { r: [0, 0, 0] })],
}));

/** SUBMERGE — folds in and drops below the surface. */
export const bossSubmerge = clip('bossSubmerge', 120, {
  rootMotion: [{ f: 0, y: 0 }, { f: 34, y: -2.6, e: 'in' }, { f: 84, y: -2.6 }, { f: 118, y: 0, e: 'out' }],
  events: [{ frame: 30, type: 'submerged' }, { frame: 84, type: 'surfacing' }, { frame: 116, type: 'surfaced' }],
}, legPose({
  core: [k(0, { r: [0, 0, 0] }), k(28, { r: [16, 0, 0], e: 'in' }), k(84, { r: [16, 0, 0] }), k(118, { r: [0, 0, 0], e: 'out' })],
  torso: [k(0, { r: [0, 0, 0] }), k(28, { r: [40, 0, 0] }), k(84, { r: [40, 0, 0] }), k(118, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(28, { r: [30, 0, 0] }), k(84, { r: [30, 0, 0] }), k(118, { r: [0, 0, 0] })],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(28, { r: [-24, 0, 62] }), k(118, { r: [0, 0, 14] })],
  'arm.R': [k(0, { r: [0, 0, -14] }), k(28, { r: [-24, 0, -62] }), k(118, { r: [0, 0, -14] })],
}, LEGS, {
  femur: [k(0, { r: [0, 0, 0] }), k(30, { r: [-52, 0, 46], e: 'in' }), k(84, { r: [-52, 0, 46] }), k(118, { r: [0, 0, 0], e: 'out' })],
  tibia: [k(0, { r: [0, 0, 0] }), k(30, { r: [86, 0, 0], e: 'in' }), k(84, { r: [86, 0, 0] }), k(118, { r: [0, 0, 0], e: 'out' })],
}));

/** SLAM — phase two. Both arms straight overhead. Unmistakable. */
export const bossSlam = clip('bossSlam', 112, {
  rootMotion: [{ f: 0, z: 0 }, { f: 32, z: 0.4 }, { f: 46, z: 1.6, e: 'out' }, { f: 112, z: 1.6 }],
  events: [{ frame: 6, type: 'tell', id: 'bossSlamTell' }, { frame: 44, type: 'shake', strength: 0.9 }, { frame: 44, type: 'waterBurst' }],
}, legPose({
  core: [
    k(0, { p: [0, 0, 0], r: [0, 0, 0] }),
    k(32, { p: [0, 0.72, 0], r: [-30, 0, 0], e: 'out' }),  // reared to full height
    k(40, { p: [0, 0.76, 0], r: [-32, 0, 0] }),
    k(46, { p: [0, -0.40, 0], r: [40, 0, 0], e: 'linear' }),
    k(66, { p: [0, -0.20, 0], r: [22, 0, 0] }),
    k(112, { p: [0, 0, 0], r: [0, 0, 0], e: 'out' }),
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(32, { r: [-36, 0, 0], e: 'out' }), k(46, { r: [46, 0, 0], e: 'linear' }), k(112, { r: [0, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(32, { r: [-30, 0, 0], e: 'out' }), k(46, { r: [40, 0, 0], e: 'linear' }), k(112, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(32, { r: [-40, 0, 0], e: 'out' }), k(46, { r: [34, 0, 0], e: 'linear' }), k(112, { r: [0, 0, 0] })],
  'arm.L': [
    k(0, { r: [0, 0, 14] }), k(32, { r: [-172, 0, 16], e: 'out' }),
    k(40, { r: [-176, 0, 14] }), k(46, { r: [-44, 0, 8], e: 'linear' }), k(112, { r: [0, 0, 14] }),
  ],
  'arm.R': [
    k(0, { r: [0, 0, -14] }), k(32, { r: [-172, 0, -16], e: 'out' }),
    k(40, { r: [-176, 0, -14] }), k(46, { r: [-44, 0, -8], e: 'linear' }), k(112, { r: [0, 0, -14] }),
  ],
  'forearm.L': [k(0, { r: [-32, 0, 0] }), k(32, { r: [-16, 0, 0] }), k(46, { r: [-4, 0, 0], e: 'linear' }), k(112, { r: [-32, 0, 0] })],
  'forearm.R': [k(0, { r: [-32, 0, 0] }), k(32, { r: [-16, 0, 0] }), k(46, { r: [-4, 0, 0], e: 'linear' }), k(112, { r: [-32, 0, 0] })],
}, LEGS, {
  femur: [k(0, { r: [0, 0, 0] }), k(32, { r: [-44, 0, 30], e: 'out' }), k(46, { r: [26, 0, -10], e: 'linear' }), k(112, { r: [0, 0, 0] })],
  tibia: [k(0, { r: [0, 0, 0] }), k(32, { r: [58, 0, 0], e: 'out' }), k(46, { r: [-12, 0, 0], e: 'linear' }), k(112, { r: [0, 0, 0] })],
}));

/** SKITTER — phase two. The body tips, one side loads, then it scuttles. */
export const bossSkitter = clip('bossSkitter', 62, {
  rootMotion: [{ f: 0, x: 0 }, { f: 16, x: -0.3, e: 'out' }, { f: 34, x: 5.4, e: 'linear' }, { f: 44, x: 6.0, e: 'out' }, { f: 62, x: 6.0 }],
  events: [{ frame: 4, type: 'tell', id: 'bossSkitterTell' }],
}, {
  core: [
    k(0, { r: [0, 0, 0] }), k(14, { r: [0, 0, -22], e: 'out' }),
    k(30, { r: [0, 0, 16], e: 'linear' }), k(44, { r: [0, 0, 6] }), k(62, { r: [0, 0, 0], e: 'out' }),
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(14, { r: [0, 0, -14] }), k(34, { r: [0, 0, 10], e: 'linear' }), k(62, { r: [0, 0, 0] })],
  head: [k(0, { r: [0, 0, 0] }), k(14, { r: [0, -26, -10] }), k(34, { r: [0, 18, 8], e: 'linear' }), k(62, { r: [0, 0, 0] })],
  ...legPose({}, ['legA.R', 'legB.R', 'legC.R'], {
    femur: [k(0, { r: [0, 0, 0] }), k(14, { r: [-46, 0, -34], e: 'out' }), k(32, { r: [24, 0, 18], e: 'linear' }), k(62, { r: [0, 0, 0] })],
    tibia: [k(0, { r: [0, 0, 0] }), k(14, { r: [64, 0, 0], e: 'out' }), k(32, { r: [-14, 0, 0], e: 'linear' }), k(62, { r: [0, 0, 0] })],
  }),
  ...legPose({}, ['legA.L', 'legB.L', 'legC.L'], {
    femur: [k(0, { r: [0, 0, 0] }), k(14, { r: [18, 0, 26], e: 'out' }), k(32, { r: [-30, 0, -12], e: 'linear' }), k(62, { r: [0, 0, 0] })],
    tibia: [k(0, { r: [0, 0, 0] }), k(14, { r: [-12, 0, 0] }), k(32, { r: [40, 0, 0], e: 'linear' }), k(62, { r: [0, 0, 0] })],
  }),
});

/**
 * BEACH — the scripted phase transition.
 *
 * PHASES.md is specific that this is a scripted event and not a stat change at
 * a health threshold. So it is 210 frames of the thing hauling itself bodily
 * out of the water onto the dais, invulnerable throughout, ending in a pose it
 * holds for the rest of the fight: higher, more exposed, and faster.
 */
export const bossBeach = clip('bossBeach', 210, {
  rootMotion: [
    { f: 0, z: 0, y: 0 },
    { f: 40, z: -0.8, y: 0.5, e: 'out' },
    { f: 120, z: 2.4, y: 1.15, e: 'in' },
    { f: 160, z: 4.2, y: 0.85, e: 'out' },
    { f: 210, z: 4.4, y: 0.8 },
  ],
  events: [
    { frame: 24, type: 'sfx', id: 'bossRise' },
    { frame: 30, type: 'shake', strength: 0.5 },
    { frame: 118, type: 'waterBurst' },
    { frame: 126, type: 'shake', strength: 1.2 },
    { frame: 205, type: 'phase2' },
  ],
}, legPose({
  core: [
    k(0, { r: [0, 0, 0], p: [0, 0, 0] }),
    k(40, { r: [-40, 0, 0], p: [0, 0.9, 0], e: 'out' }),      // rears up out of the water
    k(90, { r: [-52, 0, 0], p: [0, 1.5, 0] }),
    k(126, { r: [24, 0, 0], p: [0, 0.4, 0], e: 'in' }),        // crashes down onto the dais
    k(150, { r: [10, 0, 0], p: [0, 0.25, 0] }),
    k(210, { r: [-6, 0, 0], p: [0, 0.30, 0], e: 'out' }),      // held for phase two
  ],
  torso: [k(0, { r: [0, 0, 0] }), k(40, { r: [-30, 0, 0], e: 'out' }), k(90, { r: [-20, 0, 0] }), k(126, { r: [30, 0, 0], e: 'in' }), k(210, { r: [-10, 0, 0] })],
  chest: [k(0, { r: [0, 0, 0] }), k(60, { r: [-16, 0, 0] }), k(126, { r: [24, 0, 0], e: 'in' }), k(210, { r: [-8, 0, 0] })],
  head: [
    k(0, { r: [30, 0, 0] }), k(46, { r: [-18, 0, 0], e: 'out' }), k(74, { r: [-24, 14, 0] }),
    k(96, { r: [-22, -12, 0] }), k(126, { r: [26, 0, 0], e: 'in' }), k(210, { r: [-4, 0, 0] }),
  ],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(40, { r: [-120, 0, 48], e: 'out' }), k(96, { r: [-140, 0, 30] }), k(126, { r: [-30, 0, 20], e: 'in' }), k(210, { r: [-16, 0, 24] })],
  'arm.R': [k(0, { r: [0, 0, -14] }), k(40, { r: [-120, 0, -48], e: 'out' }), k(96, { r: [-140, 0, -30] }), k(126, { r: [-30, 0, -20], e: 'in' }), k(210, { r: [-16, 0, -24] })],
  'forearm.L': [k(0, { r: [-32, 0, 0] }), k(60, { r: [-70, 0, 0] }), k(126, { r: [-20, 0, 0], e: 'in' }), k(210, { r: [-40, 0, 0] })],
  'forearm.R': [k(0, { r: [-32, 0, 0] }), k(60, { r: [-70, 0, 0] }), k(126, { r: [-20, 0, 0], e: 'in' }), k(210, { r: [-40, 0, 0] })],
}, LEGS, {
  // The legs claw for purchase on the dais edge, then splay wide to hold it up.
  femur: [
    k(0, { r: [0, 0, 0] }), k(40, { r: [-64, 0, 40], e: 'out' }), k(88, { r: [-38, 0, 56] }),
    k(126, { r: [8, 0, 30], e: 'in' }), k(210, { r: [-14, 0, 38], e: 'out' }),
  ],
  tibia: [
    k(0, { r: [0, 0, 0] }), k(40, { r: [78, 0, 0], e: 'out' }), k(88, { r: [52, 0, 0] }),
    k(126, { r: [18, 0, 0], e: 'in' }), k(210, { r: [34, 0, 0], e: 'out' }),
  ],
}));

/** Hit reaction on the upper layer, so a limb mid-swing keeps swinging. */
export const bossHit = clip('bossHit', 18, {}, {
  torso: [k(0, { r: [0, 0, 0] }), k(3, { r: [-10, 6, 4], e: 'snap' }), k(18, { r: [0, 0, 0], e: 'out' })],
  chest: [k(0, { r: [0, 0, 0] }), k(3, { r: [-12, 8, 5], e: 'snap' }), k(18, { r: [0, 0, 0], e: 'out' })],
  head: [k(0, { r: [0, 0, 0] }), k(3, { r: [-16, 10, 6], e: 'snap' }), k(18, { r: [0, 0, 0], e: 'out' })],
});

/** Stagger — the body collapses forward and the mask drops to player height. */
export const bossStagger = clip('bossStagger', 190, {
  events: [{ frame: 2, type: 'sfx', id: 'bossStagger' }],
}, legPose({
  core: [k(0, { r: [0, 0, 0], p: [0, 0, 0] }), k(14, { r: [34, 0, 6], p: [0, -0.75, 0], e: 'out' }),
    k(150, { r: [34, 0, 6], p: [0, -0.78, 0] }), k(190, { r: [0, 0, 0], p: [0, 0, 0], e: 'out' })],
  torso: [k(0, { r: [0, 0, 0] }), k(14, { r: [46, 0, 0], e: 'out' }), k(150, { r: [48, 0, 0] }), k(190, { r: [0, 0, 0], e: 'out' })],
  chest: [k(0, { r: [0, 0, 0] }), k(14, { r: [30, 0, 0] }), k(190, { r: [0, 0, 0], e: 'out' })],
  head: [k(0, { r: [0, 0, 0] }), k(14, { r: [40, 0, 0] }), k(150, { r: [42, 0, 0] }), k(190, { r: [0, 0, 0], e: 'out' })],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(16, { r: [-16, 0, 54] }), k(190, { r: [0, 0, 14], e: 'out' })],
  'arm.R': [k(0, { r: [0, 0, -14] }), k(16, { r: [-16, 0, -54] }), k(190, { r: [0, 0, -14], e: 'out' })],
}, LEGS, {
  femur: [k(0, { r: [0, 0, 0] }), k(16, { r: [-30, 0, 62], e: 'out' }), k(150, { r: [-32, 0, 64] }), k(190, { r: [0, 0, 0], e: 'out' })],
  tibia: [k(0, { r: [0, 0, 0] }), k(16, { r: [70, 0, 0], e: 'out' }), k(150, { r: [72, 0, 0] }), k(190, { r: [0, 0, 0], e: 'out' })],
}));

/** Death — it goes back into the water. */
export const bossDeath = clip('bossDeath', 220, {
  rootMotion: [{ f: 0, y: 0 }, { f: 80, y: -0.5, e: 'in' }, { f: 200, y: -2.9, e: 'in' }, { f: 220, y: -3.1 }],
  events: [{ frame: 4, type: 'sfx', id: 'bossDeath' }, { frame: 90, type: 'shake', strength: 0.6 }],
}, legPose({
  core: [k(0, { r: [0, 0, 0] }), k(30, { r: [-26, 8, 12], e: 'out' }), k(90, { r: [40, 14, 22], e: 'in' }), k(220, { r: [52, 16, 26] })],
  torso: [k(0, { r: [0, 0, 0] }), k(30, { r: [-20, 0, 0] }), k(96, { r: [44, 0, 8] }), k(220, { r: [50, 0, 10] })],
  head: [k(0, { r: [0, 0, 0] }), k(26, { r: [-40, 0, 0] }), k(100, { r: [38, 12, 6] }), k(220, { r: [44, 16, 8] })],
  'arm.L': [k(0, { r: [0, 0, 14] }), k(30, { r: [-70, 0, 40] }), k(120, { r: [10, 0, 64] }), k(220, { r: [16, 0, 70] })],
  'arm.R': [k(0, { r: [0, 0, -14] }), k(30, { r: [-70, 0, -40] }), k(120, { r: [10, 0, -64] }), k(220, { r: [16, 0, -70] })],
}, LEGS, {
  femur: [k(0, { r: [0, 0, 0] }), k(34, { r: [-52, 0, 30] }), k(110, { r: [-18, 0, 74], e: 'in' }), k(220, { r: [-10, 0, 82] })],
  tibia: [k(0, { r: [0, 0, 0] }), k(34, { r: [62, 0, 0] }), k(110, { r: [96, 0, 0], e: 'in' }), k(220, { r: [104, 0, 0] })],
}));

export function buildBossClips() {
  return [
    bossIdle, bossLunge, bossSweep, bossDelayed, bossSubmerge,
    bossSlam, bossSkitter, bossBeach, bossHit, bossStagger, bossDeath,
  ];
}
