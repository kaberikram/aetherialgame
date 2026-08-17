/**
 * The eight beats of Chapter 1.
 *
 * These are the spine of the chapter and they have, until now, existed only as
 * prose in PROJECT.md and as a lookup table of pigeon barks. `BEAT_ENTERED`
 * was emitted with bare integers, so "does the flow still work" was a question
 * you answered by playing rather than by asserting.
 *
 * Naming them here makes the flow something the code states rather than
 * implies — which matters most exactly now, while everything the beats hang on
 * is being rebuilt underneath them.
 */
export const BEAT = Object.freeze({
  VOID: 1,          // a drifting light; the pigeon arrives dragging a corpse
  EMBODIMENT: 2,    // the light enters the body, and the body has weight
  DESCENT: 3,       // follow the pigeon down; the traversal tutorial
  STILL_POOL: 4,    // the Star Chamber, seen from the steps. Not ready yet
  SWORD: 5,         // half-buried beside a dead warrior
  BOSS: 6,          // the thing in the pool
  WINGS: 7,         // the choice — light or dark, no labels
  EXIT: 8,          // out through the oculus. Seven trials remain
});

/** Human-readable, for debug overlays and logs. Never shown to the player. */
export const BEAT_NAME = Object.freeze({
  [BEAT.VOID]: 'the void',
  [BEAT.EMBODIMENT]: 'embodiment',
  [BEAT.DESCENT]: 'the descent',
  [BEAT.STILL_POOL]: 'the still pool',
  [BEAT.SWORD]: 'the sword',
  [BEAT.BOSS]: 'the boss',
  [BEAT.WINGS]: 'the wings',
  [BEAT.EXIT]: 'the exit',
});
