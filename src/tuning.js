/**
 * tuning.js — every number that decides how the game FEELS lives here.
 *
 * The rule: if changing a value would change a player's opinion of the game,
 * it belongs in this file. If it is a structural constant (array sizes, texture
 * resolutions, module wiring) it does not.
 *
 * Frame counts assume the 60Hz fixed step in Engine. One frame is 16.667ms.
 * Combat is authored in frames, not seconds, because that is the unit the
 * player actually learns.
 */

const F = 1 / 60; // one simulation frame, in seconds

export const TUNING = {
  /** Debug conveniences. */
  debug: {
    startZone: null, // null = normal flow; set to a zone id to boot straight in
    invulnerable: false,
    showFpsOnBoot: true,
  },

  /** ---------------------------------------------------------------- MOVEMENT */
  movement: {
    walkSpeed: 2.1, // m/s — slow enough that geometry reads as architecture
    runSpeed: 4.4,
    sprintSpeed: 6.8,
    // Acceleration is deliberately low. A souls character has mass; the delay
    // between stick and motion is most of what "weight" means.
    groundAccel: 26,
    groundDecel: 34,
    airAccel: 6,
    airDrag: 0.6,
    // Turning is rate-limited rather than instant, so a 180 costs real time.
    turnRateWalk: 9.5, // rad/s
    turnRateRun: 6.4,
    turnRateSprint: 4.2,
    turnRateLocked: 14.0, // strafing while locked on turns faster
    jumpVelocity: 5.4,
    gravity: -22.0, // heavier than real gravity; real gravity feels floaty
    fallMultiplier: 1.35, // extra gravity past apex, kills the hang time
    maxFallSpeed: -32,
    coyoteFrames: 5,
    jumpBufferFrames: 8,
    jumpRecoveryFrames: 12, // cannot attack or roll during this, per CONTROLS.md
    landHardThreshold: 14, // m/s of impact that triggers a heavy landing
    landHardRecoveryFrames: 22,
    fallDamageThreshold: 19,
    fallDamagePerSpeed: 7,
    fallDeathSpeed: 30,
    stepOffset: 0.42,
    maxSlopeDegrees: 52,
    minSlideSlopeDegrees: 55,
    snapToGroundDistance: 0.35,
    capsuleRadius: 0.32,
    capsuleHalfHeight: 0.52, // total height ≈ 1.68m
  },

  /** Water changes the fight in the Star Chamber. Depth is the dial. */
  water: {
    shallowDepth: 0.35, // ankle — barely slows you
    deepDepth: 1.1, // thigh — the deep centre of the dais
    speedAtShallow: 0.88,
    speedAtDeep: 0.58,
    rollDistanceAtShallow: 0.92,
    rollDistanceAtDeep: 0.62,
    staminaMultiplierDeep: 1.25,
  },

  /** ------------------------------------------------------------------- ROLL */
  roll: {
    totalFrames: 54, // 0.90s
    invulnStartFrame: 3,
    invulnFrames: 24, // 0.40s
    // Recovery is the tail the player must respect. Rolls chain into rolls only.
    recoveryStartFrame: 40,
    distance: 4.05, // metres travelled by root motion
    backstepFrames: 34,
    backstepDistance: 2.3,
    backstepInvulnStartFrame: 2,
    backstepInvulnFrames: 12,
    staminaCost: 22,
    backstepStaminaCost: 14,
    // Direction is captured at the press, never re-read mid-animation.
    bufferFrames: 14,
  },

  /** ---------------------------------------------------------------- STAMINA */
  stamina: {
    max: 105,
    regenPerSecond: 46,
    // The delay after a spend is the whole reason stamina creates tension.
    regenDelayFrames: 38, // ≈0.63s
    regenDelayAfterEmptyFrames: 62,
    sprintDrainPerSecond: 13.5,
    blockDrainOnHitMultiplier: 1.0,
    // Attacks are allowed to start at low stamina and push you negative-ish:
    // you can always throw the swing you committed to, you just pay after.
    minToAct: 1,
  },

  /** ----------------------------------------------------------------- HEALTH */
  health: {
    playerMax: 320,
    flaskCharges: 4,
    flaskHealAmount: 150,
    flaskDrinkFrames: 62, // slow and punishable, cannot be cancelled
    flaskHealAtFrame: 34, // healing lands mid-animation, not at the end
    poiseMax: 45,
    poiseRegenPerSecond: 18,
    poiseRegenDelayFrames: 90,
    staggerFrames: 46,
  },

  /** ----------------------------------------------------------------- COMBAT */
  combat: {
    // Buffer window during recovery only. Never during active frames — that is
    // where commitment lives, per CONTROLS.md.
    inputBufferFrames: 16, // ≈266ms
    lightChainWindowFrames: 22,
    heavyChainWindowFrames: 26,
    // Deflect: a hard, fast trigger pull inside a narrow window.
    deflectWindowFrames: 7, // gamepad baseline; alignment can widen it
    deflectTriggerVelocity: 4.2, // units/s of analog travel that reads as a "pull"
    deflectTriggerDepth: 0.55,
    deflectDamageMultiplier: 1.85,
    deflectPoiseDamageMultiplier: 2.4,
    guardStaminaPerDamage: 0.62,
    guardDamageReduction: 0.78,
    guardBreakStaggerFrames: 58,
    criticalDamageMultiplier: 3.1,
    criticalFrames: 74,
    hitStopFrames: 5, // frames of freeze on a landed hit — cheap, huge feel win
    heavyHitStopFrames: 8,
    hitStopScale: 0.06, // time scale during hit stop, not a full freeze
  },

  /** ---------------------------------------------------------------- LOCK-ON */
  lockOn: {
    maxDistance: 22,
    breakDistance: 27,
    acquireConeDegrees: 62,
    cycleConeDegrees: 100,
    cycleCooldownFrames: 12,
    losCheckIntervalFrames: 6,
    // Souls framing: the target sits slightly off-centre, not FPS dead-centre.
    screenBiasX: 0.0,
    screenBiasY: 0.11,
  },

  /** ----------------------------------------------------------------- CAMERA */
  camera: {
    fov: 55,
    near: 0.1,
    far: 620,
    distance: 4.6,
    lockedDistance: 5.4,
    height: 1.52, // pivot height on the character
    shoulderOffset: 0.34,
    pitchMin: -0.62, // radians
    pitchMax: 1.02,
    // Follow lag is what makes a camera feel attached to a body rather than
    // welded to it. Position lags more than rotation.
    positionSmoothing: 12.0,
    rotationSmoothing: 18.0,
    lockedSmoothing: 9.0,
    autoRecenterDelay: 1.5, // seconds of no camera input, per CONTROLS.md
    autoRecenterSpeed: 2.4,
    collisionRadius: 0.26,
    collisionPullInSpeed: 30.0, // fast in
    collisionPushOutSpeed: 5.0, // slow out, so corners do not pop
    minCollisionDistance: 0.7,
    lookSensitivityGamepad: 2.9, // rad/s at full stick
    lookSensitivityMouse: 0.0026, // rad/px
    fovSprintBoost: 6,
    fovSmoothing: 4.5,
  },

  /** ------------------------------------------------------------------ INPUT */
  input: {
    gamepad: {
      innerDeadzone: 0.15, // radial, per CONTROLS.md
      outerDeadzone: 0.96,
      moveCurveExponent: 1.75, // in the 1.6–2.0 band the doc specifies
      lookCurveExponent: 2.1,
      triggerPressThreshold: 0.42,
      triggerReleaseThreshold: 0.28,
      // The pad's own setting. It used to read the keyboard's, which meant a
      // player could not invert one scheme without inverting the other.
      invertY: false,
    },
    kbm: {
      // Keyboard has no analog magnitude, so walk is a modifier rather than a
      // stick tilt, and deflect is a keypress freshness test rather than a
      // trigger velocity. Tuned on its own terms, not scaled from the pad.
      deflectWindowFrames: 8, // one frame of grace over the pad
      mouseSmoothing: 0.0,
      invertY: false,
    },
  },

  /** ------------------------------------------------------------ PROGRESSION */
  progression: {
    currencyOnBossKill: 1200,
    currencyLostOnSecondDeath: true,
    respawnFadeSeconds: 1.4,
  },

  /** ------------------------------------------------------------------ WINGS */
  alignment: {
    light: {
      deflectWindowBonusFrames: 3,
      healOnDeflect: 22,
      damageMultiplier: 0.94,
      defenceMultiplier: 1.0,
      attackSpeedMultiplier: 1.0,
    },
    dark: {
      deflectWindowBonusFrames: -1,
      lifestealFraction: 0.16,
      damageMultiplier: 1.12,
      defenceMultiplier: 0.84,
      attackSpeedMultiplier: 1.14,
      dashHealthCost: 26,
    },
  },

  /** ----------------------------------------------------------------- FLIGHT */
  flight: {
    takeoffImpulse: 7.2,
    flapImpulse: 5.0,
    flapCooldownFrames: 22,
    flapStaminaCost: 16,
    glideGravity: -3.4,
    glideForwardSpeed: 11.5,
    diveSpeed: 22.0,
    bankRate: 1.9,
    maxBankAngle: 0.72,
    landingRecoveryFrames: 26,
    light: { glideGravity: -2.6, turnRate: 1.35, flapImpulse: 4.6 },
    dark: { glideGravity: -4.2, turnRate: 2.5, flapImpulse: 6.0 },
  },

  /** ---------------------------------------------------------------- COMPANION */
  companion: {
    leadDistance: 7.5,
    waitDistance: 13.0,
    resumeDistance: 6.0,
    flySpeed: 4.6,
    hoverBobAmplitude: 0.13,
    hoverBobSpeed: 2.7,
    cameraAvoidRadius: 2.2, // never occupies the frame between camera and player
    starLightAvoidRadius: 7.0, // tell #2: it will not enter the star's pool
  },
};

export const FRAME = F;
export const frames = (n) => n * F;
export const seconds = (s) => Math.round(s * 60);
