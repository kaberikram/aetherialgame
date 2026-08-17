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
  SPRINT: 'sprint', // keyboard only — the pad derives it from a held DODGE
  CROUCH: 'crouch',
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
 * Default gamepad layout — **the actual Elden Ring layout**, verified against
 * the published control tables rather than reconstructed from memory.
 *
 * The previous version of this table claimed to be that layout and was not.
 * Four things were wrong, and each one was load-bearing:
 *
 *   - **Sprint was on L3.** Elden Ring has no dedicated sprint button. You tap
 *     B to roll and hold B to sprint, and the two competing for the same
 *     finger is a design decision, not an accident of button count.
 *   - **L3 was therefore not crouch**, which is what it is in Elden Ring.
 *   - **Y was the weapon art.** In Elden Ring Y is Event Action — interact.
 *     The skill lives on LT and guard on LB.
 *   - **INTERACT was bound to A, the same button as JUMP.** Two actions on one
 *     button, with the ambiguity deferred to "resolved downstream". That makes
 *     every interact next to a ledge a coin flip, which is precisely the
 *     failure the keyboard table below warns about for a different pair.
 *     Moving interact to Y fixes the bug and matches Elden Ring in one edit.
 */
export const DEFAULT_GAMEPAD_BINDINGS = Object.freeze({
  [ACTION.JUMP]: { button: PAD.A },
  // Tap rolls, hold sprints. See InputSystem.isSprinting().
  [ACTION.DODGE]: { button: PAD.B },
  [ACTION.USE_ITEM]: { button: PAD.X },
  [ACTION.INTERACT]: { button: PAD.Y },
  [ACTION.LIGHT_ATTACK]: { button: PAD.RB },
  [ACTION.HEAVY_ATTACK]: { button: PAD.RT, analog: true },
  [ACTION.GUARD]: { button: PAD.LB },
  [ACTION.WEAPON_ART]: { button: PAD.LT, analog: true },
  [ACTION.CROUCH]: { button: PAD.L3 },
  [ACTION.LOCK_ON]: { button: PAD.R3 },
  [ACTION.CYCLE_ITEM_NEXT]: { button: PAD.DPAD_UP },
  [ACTION.CYCLE_ITEM_PREV]: { button: PAD.DPAD_DOWN },
  [ACTION.CYCLE_SKILL_NEXT]: { button: PAD.DPAD_RIGHT },
  [ACTION.CYCLE_SKILL_PREV]: { button: PAD.DPAD_LEFT },
  [ACTION.PAUSE]: { button: PAD.MENU },
  [ACTION.MAP]: { button: PAD.VIEW },
  // ALIGNMENT_ABILITY has no Elden Ring equivalent — it is this game's own
  // verb. It rides the skill button, which is where a weapon art would live.
  [ACTION.ALIGNMENT_ABILITY]: { button: PAD.LT, analog: true },
  // SPRINT is deliberately unbound on the pad. It is derived from a held
  // DODGE, which is the whole point.
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
  // Space both rolls (tap) and sprints (hold), matching the pad — but Shift
  // ALSO sprints, and that redundancy is deliberate.
  //
  // The original comment here objected to sharing the key at all: "a roll has
  // to fire on the press, instantly … every sprint then opens with an unwanted
  // roll." The second half is answered by firing the roll on RELEASE, and only
  // when released before the hold threshold — hold past it and you sprint with
  // no roll at all. The first half stands: a tap-released roll carries the
  // duration of your own tap as latency. Elden Ring accepts that on the pad.
  //
  // Keeping Shift means a mouse player who wants the zero-latency roll can
  // still have it: press Space and never hold it, sprint with Shift.
  [ACTION.DODGE]: { keys: ['Space'] },
  [ACTION.JUMP]: { keys: ['KeyF'] },
  [ACTION.SPRINT]: { keys: ['ShiftLeft', 'ShiftRight'] },
  [ACTION.CROUCH]: { keys: ['KeyC'] },
  [ACTION.USE_ITEM]: { keys: ['KeyR'] },
  [ACTION.WEAPON_ART]: { keys: ['KeyV'] },
  [ACTION.LIGHT_ATTACK]: { mouse: [0] },
  [ACTION.HEAVY_ATTACK]: { mouse: [2] },
  // Was KeyC, which crouch now owns. The alignment ability is this game's own
  // verb and has no Elden Ring key to match, so it takes the free one.
  [ACTION.ALIGNMENT_ABILITY]: { keys: ['KeyX'] },
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
