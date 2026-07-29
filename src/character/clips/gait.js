import { clip, k } from '../AnimationSystem.js';

/**
 * Gait cycles are generated, not hand-keyed.
 *
 * A walk cycle is a set of smooth periodic functions of one phase variable.
 * Typing out 16 keyframes × 20 bones by hand produces a worse cycle than
 * sampling those functions, and makes "the run has too much bounce" a
 * twenty-edit change instead of a one-number change.
 *
 * Joint sign conventions for this rig (limbs extend along local −Y):
 *   thigh.x negative  → leg swings FORWARD
 *   shin.x  positive  → knee FLEXES (heel toward hips)
 *   upperArm.x positive → arm swings BACKWARD
 *   lowerArm.x negative → elbow FLEXES (hand forward)
 *   spine.x positive → torso leans FORWARD
 */

const TAU = Math.PI * 2;
const deg = (rad) => (rad * 180) / Math.PI;

/**
 * @param {object} p tuning for one gait
 * @returns a clip with `samples` keys per cycle
 */
export function makeGait(id, frames, p) {
  const {
    samples = 16,
    stride = 26,        // thigh swing amplitude, degrees
    kneeSwing = 46,     // peak knee flex during swing
    kneeStance = 7,     // residual bend under load
    ankle = 0.5,        // how much the ankle counter-rotates to keep the foot level
    armSwing = 18,
    armOut = 6,         // abduction so arms clear the ribs
    elbow = 22,
    elbowSwing = 10,
    lean = 4,           // forward torso lean
    bob = 0.035,        // vertical hip travel, metres
    sway = 3,           // hip roll toward the stance leg
    twist = 5,          // hip yaw
    counterTwist = 1.5, // chest counter-rotation multiplier
    headStabilise = 0.55,
    direction = 1,      // -1 walks the cycle backward
    lateral = 0,        // abduction for strafing
    pelvisYaw = 0,      // pelvis turned away from facing, for strafe
    footPlant = 0,      // toe-down at contact
  } = p;

  const tracks = {};
  const push = (bone, key) => (tracks[bone] ??= []).push(key);

  for (let s = 0; s <= samples; s++) {
    const f = (s / samples) * frames;
    const phase = (s / samples) * TAU;
    const e = 'linear'; // densely sampled, so linear between keys is smooth

    for (const side of ['L', 'R']) {
      // Right leg runs half a cycle behind the left.
      const th = side === 'L' ? phase : phase + Math.PI;
      const sgn = side === 'L' ? 1 : -1;

      const thigh = -stride * Math.sin(th) * direction;
      // Knee flexes hardest just after toe-off, which is where cos peaks.
      const knee = kneeStance + kneeSwing * Math.pow(Math.max(0, Math.cos(th)), 1.3);
      const foot = -(thigh + knee) * ankle + footPlant * Math.max(0, Math.sin(th));

      push(`thigh.${side}`, k(f, { r: [thigh, 0, lateral * Math.sin(th) * sgn], e }));
      push(`shin.${side}`, k(f, { r: [knee, 0, 0], e }));
      push(`foot.${side}`, k(f, { r: [foot, 0, 0], e }));

      // Arms swing opposite their same-side leg.
      const arm = armSwing * Math.sin(th) * direction;
      push(`upperArm.${side}`, k(f, { r: [arm, 0, armOut * sgn], e }));
      push(`lowerArm.${side}`, k(f, { r: [-elbow - elbowSwing * Math.max(0, -Math.sin(th)), 0, 0], e }));
    }

    const bobY = -bob * (0.5 - 0.5 * Math.cos(phase * 2));
    push('hips', k(f, {
      r: [0, twist * Math.sin(phase) + pelvisYaw, sway * Math.sin(phase)],
      p: [0, bobY, 0],
      e,
    }));
    push('spine', k(f, { r: [lean * 0.5, -twist * counterTwist * 0.5 * Math.sin(phase), 0], e }));
    push('chest', k(f, { r: [lean * 0.5, -twist * counterTwist * Math.sin(phase) - pelvisYaw, 0], e }));
    push('head', k(f, { r: [-lean * headStabilise, 0, 0], e }));
  }

  return clip(id, frames, { loop: true }, tracks);
}

/**
 * Idle is not a static pose. A character standing perfectly still reads as a
 * paused game; breath and a slow weight shift read as alive. It is also where
 * the player spends more time than any other state, so it does real work.
 */
export function makeIdle(id = 'idle', frames = 150) {
  const tracks = {};
  const push = (bone, key) => (tracks[bone] ??= []).push(key);
  const samples = 20;

  for (let s = 0; s <= samples; s++) {
    const f = (s / samples) * frames;
    const t = (s / samples) * TAU;
    const breath = Math.sin(t);
    const shift = Math.sin(t * 0.5); // slow weight transfer, half the breath rate
    const e = 'linear';

    push('hips', k(f, { r: [0, 0, 1.4 * shift], p: [0.012 * shift, -0.008 - 0.006 * breath, 0], e }));
    push('spine', k(f, { r: [2.2 + 0.8 * breath, 0, -0.7 * shift], e }));
    push('chest', k(f, { r: [1.4 - 1.1 * breath, 0, -0.6 * shift], e }));
    push('neck', k(f, { r: [1.5 + 0.5 * breath, 0, 0], e }));
    push('head', k(f, { r: [-2.5, 1.8 * shift, 0], e }));

    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? 1 : -1;
      push(`upperArm.${side}`, k(f, { r: [2 + 0.9 * breath, 0, 5.5 * sgn + 0.8 * shift * sgn], e }));
      push(`lowerArm.${side}`, k(f, { r: [-15 - 1.4 * breath, 0, 0], e }));
      push(`thigh.${side}`, k(f, { r: [-1.5, 0, 2.2 * sgn], e }));
      push(`shin.${side}`, k(f, { r: [4 + 1.2 * shift * sgn, 0, 0], e }));
      push(`foot.${side}`, k(f, { r: [-2, 0, 0], e }));
    }
  }
  return clip(id, frames, { loop: true }, tracks);
}

/** The eight locomotion clips the blend tree selects between. */
export function buildLocomotionClips() {
  return [
    makeIdle('idle'),

    makeGait('walkF', 52, {
      stride: 21, kneeSwing: 38, armSwing: 13, lean: 3.5, bob: 0.030, sway: 3.4, twist: 4.5,
    }),
    makeGait('runF', 34, {
      stride: 32, kneeSwing: 62, kneeStance: 10, armSwing: 30, elbow: 62, elbowSwing: 16,
      lean: 10, bob: 0.055, sway: 3.0, twist: 7, footPlant: 6,
    }),
    makeGait('sprintF', 26, {
      stride: 41, kneeSwing: 82, kneeStance: 13, armSwing: 44, elbow: 82, elbowSwing: 22,
      lean: 19, bob: 0.075, sway: 2.4, twist: 9, footPlant: 12, headStabilise: 0.35,
    }),

    // Backward: short, cautious steps and a slight backward lean. Reusing the
    // forward cycle reversed reads as moonwalking, so the parameters differ.
    makeGait('walkB', 58, {
      stride: 14, kneeSwing: 30, armSwing: 8, lean: -3, bob: 0.020, sway: 2.6, twist: 2.5,
      direction: -1, ankle: 0.35,
    }),
    makeGait('runB', 40, {
      stride: 20, kneeSwing: 44, armSwing: 16, lean: -6, bob: 0.032, sway: 2.4, twist: 4,
      direction: -1, ankle: 0.35,
    }),

    // Strafe: the pelvis turns into the direction of travel while the chest
    // stays squared at the lock-on target. That counter-rotation is most of
    // what makes locked-on movement read as "circling" rather than "sliding".
    makeGait('strafeL', 46, {
      stride: 15, kneeSwing: 34, armSwing: 9, lean: 3, bob: 0.026, sway: 4.5, twist: 2,
      lateral: 11, pelvisYaw: -34, ankle: 0.4,
    }),
    makeGait('strafeR', 46, {
      stride: 15, kneeSwing: 34, armSwing: 9, lean: 3, bob: 0.026, sway: 4.5, twist: 2,
      lateral: 11, pelvisYaw: 34, ankle: 0.4,
    }),
  ];
}
