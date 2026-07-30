/**
 * Render quality presets.
 *
 * Deliberately NOT in tuning.js. That file's rule is "if changing a value
 * would change a player's opinion of the game it belongs here, structural
 * constants like texture resolutions do not" — these are the structural
 * constants.
 *
 * The level is chosen by `?quality=` on the URL so the headless harness can
 * ask for a cheap build when it is testing gameplay and an expensive one when
 * it is capturing frames for the rubric. Software GL cannot afford the full
 * chain, and a smoke test that takes four minutes stops being run.
 */

export const QUALITY = {
  /** No post chain at all. The renderer draws straight to the canvas. */
  off: {
    post: false,
    ao: false,
    bloom: false,
    grade: false,
    smaa: false,
    textureSize: 128,
    volumetricSteps: 0,
    waterDepth: false,
    shadowMap: 1024,
  },
  /** Grading and AA only — keeps the palette right at a fraction of the cost. */
  low: {
    post: true,
    ao: false,
    bloom: true,
    bloomStrength: 0.5,
    grade: true,
    smaa: false,
    textureSize: 128,
    volumetricSteps: 10,
    waterDepth: false,
    shadowMap: 1024,
  },
  medium: {
    post: true,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    bloomStrength: 0.62,
    grade: true,
    smaa: true,
    textureSize: 256,
    volumetricSteps: 20,
    waterDepth: true,
    shadowMap: 2048,
  },
  high: {
    post: true,
    ao: true,
    aoScale: 1.0,
    bloom: true,
    bloomStrength: 0.7,
    grade: true,
    smaa: true,
    textureSize: 256,
    volumetricSteps: 32,
    waterDepth: true,
    shadowMap: 2048,
  },
};

/** Reads `?quality=` off the URL. Defaults to high. */
export function resolveQuality() {
  let name = 'high';
  try {
    name = new URLSearchParams(location.search).get('quality') ?? 'high';
  } catch {
    /* no location in a worker/test context */
  }
  return QUALITY[name] ? { name, ...QUALITY[name] } : { name: 'high', ...QUALITY.high };
}
