/**
 * The action vocabulary. Input publishes intent in these terms and nothing
 * else; it never knows what any of them do.
 */
export const ACTION = Object.freeze({
  JUMP: 'jump',
  DODGE: 'dodge',
  USE_ITEM: 'useItem',
  WEAPON_ART: 'weaponArt',
  LIGHT_ATTACK: 'lightAttack',
  HEAVY_ATTACK: 'heavyAttack',
  ALIGNMENT_ABILITY: 'alignmentAbility',
  GUARD: 'guard', // analog: value is how far the trigger is pulled
  SPRINT: 'sprint',
  LOCK_ON: 'lockOn',
  INTERACT: 'interact',
  CYCLE_ITEM_NEXT: 'cycleItemNext',
  CYCLE_ITEM_PREV: 'cycleItemPrev',
  CYCLE_SKILL_NEXT: 'cycleSkillNext',
  CYCLE_SKILL_PREV: 'cycleSkillPrev',
  PAUSE: 'pause',
  MAP: 'map',
});

export const ALL_ACTIONS = Object.values(ACTION);

/**
 * Xbox-style standard mapping indices, per the Gamepad API spec.
 * PlayStation equivalents land on the same indices.
 */
export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9,
  L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  HOME: 16,
});

/**
 * Default gamepad layout — the Elden Ring layout specified in CONTROLS.md.
 * Attacks on the shoulders, utility on the face buttons.
 */
export const DEFAULT_GAMEPAD_BINDINGS = Object.freeze({
  [ACTION.JUMP]: { button: PAD.A },
  [ACTION.DODGE]: { button: PAD.B },
  [ACTION.USE_ITEM]: { button: PAD.X },
  [ACTION.WEAPON_ART]: { button: PAD.Y },
  [ACTION.LIGHT_ATTACK]: { button: PAD.RB },
  [ACTION.HEAVY_ATTACK]: { button: PAD.RT, analog: true },
  [ACTION.ALIGNMENT_ABILITY]: { button: PAD.LB },
  [ACTION.GUARD]: { button: PAD.LT, analog: true },
  [ACTION.SPRINT]: { button: PAD.L3 },
  [ACTION.LOCK_ON]: { button: PAD.R3 },
  [ACTION.INTERACT]: { button: PAD.A }, // context-sensitive, resolved downstream
  [ACTION.CYCLE_ITEM_NEXT]: { button: PAD.DPAD_UP },
  [ACTION.CYCLE_ITEM_PREV]: { button: PAD.DPAD_DOWN },
  [ACTION.CYCLE_SKILL_NEXT]: { button: PAD.DPAD_RIGHT },
  [ACTION.CYCLE_SKILL_PREV]: { button: PAD.DPAD_LEFT },
  [ACTION.PAUSE]: { button: PAD.MENU },
  [ACTION.MAP]: { button: PAD.VIEW },
});

/**
 * Default keyboard/mouse layout.
 *
 * CONTROLS.md names left/right click for light/heavy attack, space for jump,
 * WASD to move. Guard lands on Q rather than a mouse button because both mouse
 * buttons are already spoken for and Q is reachable without leaving WASD.
 *
 * Dodge and jump are separate keys here. On a pad they are separate buttons, and
 * collapsing them onto one key the way some ports do makes every ledge a coin flip.
 */
export const DEFAULT_KBM_BINDINGS = Object.freeze({
  // Dodge gets Space and jump gets F, which inverts what CONTROLS.md suggests
  // in passing. The reason: a roll is the most-pressed button in the genre and
  // it has to fire on the press, instantly. Sharing a key with sprint (tap to
  // roll, hold to sprint) forces the roll to wait for the release to
  // disambiguate, and every sprint then opens with an unwanted roll.
  [ACTION.DODGE]: { keys: ['Space'] },
  [ACTION.JUMP]: { keys: ['KeyF'] },
  [ACTION.SPRINT]: { keys: ['ShiftLeft', 'ShiftRight'] },
  [ACTION.USE_ITEM]: { keys: ['KeyR'] },
  [ACTION.WEAPON_ART]: { keys: ['KeyV'] },
  [ACTION.LIGHT_ATTACK]: { mouse: [0] },
  [ACTION.HEAVY_ATTACK]: { mouse: [2] },
  [ACTION.ALIGNMENT_ABILITY]: { keys: ['KeyC'] },
  [ACTION.GUARD]: { keys: ['KeyQ'], mouse: [1] },
  [ACTION.LOCK_ON]: { keys: ['Tab'] },
  [ACTION.INTERACT]: { keys: ['KeyE'] },
  [ACTION.CYCLE_ITEM_NEXT]: { keys: ['ArrowUp'] },
  [ACTION.CYCLE_ITEM_PREV]: { keys: ['ArrowDown'] },
  [ACTION.CYCLE_SKILL_NEXT]: { keys: ['ArrowRight'] },
  [ACTION.CYCLE_SKILL_PREV]: { keys: ['ArrowLeft'] },
  [ACTION.PAUSE]: { keys: ['Escape'] },
  [ACTION.MAP]: { keys: ['KeyM'] },
});

export const MOVE_KEYS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  walk: ['AltLeft', 'AltRight'], // hold to creep, the keyboard stand-in for low stick tilt
});
