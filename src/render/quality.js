/**
 * Render quality presets.
 *
 * Deliberately NOT in tuning.js. That file's rule is "if changing a value
 * would change a player's opinion of the game it belongs here, structural
 * constants like texture resolutions do not" — these are the structural
 * constants.
 *
 * `high` is the DEFAULT and it means "60fps on an M1 MacBook Pro", not
 * "everything on". `ultra` is what `high` used to be: it holds everything the
 * art pass built, and it is what `tools/rubric.mjs` captures at, so the critic
 * keeps judging the art at full quality and performance work cannot quietly
 * launder itself as a visual regression.
 *
 * The three levers that actually decide frame time, in order:
 *
 *   pixelRatioCap   an M1 reports DPR 2, so uncapped is FOUR times the pixels
 *   liveShadows     a shadow-casting PointLight is six scene renders a frame
 *   ao              GTAO adds a full scene normal pre-pass on top of that
 *   refractWater    transmission renders the scene again into a backdrop
 *
 * `volumetricSteps` is the fifth. There is deliberately no half-res
 * volumetric option: the shafts and the star glow are raymarched in-scene
 * meshes (`VolumetricShaft`, `VolumetricGlow`), not post passes, so there is
 * no intermediate target to render them small into. Step count is the lever
 * that exists, and it is the one that moves.
 *
 * The level is chosen by `?quality=` on the URL so the headless harness can
 * ask for a cheap build when it is testing gameplay and an expensive one when
 * it is capturing frames. Software GL cannot afford the full chain, and a
 * smoke test that takes four minutes stops being run.
 */

export const QUALITY = {
  /** No post chain at all. The renderer draws straight to the canvas. */
  off: {
    post: false,
    pixelRatioCap: 1,
    ao: false,
    bloom: false,
    grade: false,
    smaa: false,
    liveShadows: false,
    textureSize: 128,
    volumetricSteps: 0,
    waterDepth: false,
    refractWater: false,
    shadowMap: 1024,
  },
  /** Grading and AA only — keeps the palette right at a fraction of the cost. */
  low: {
    post: true,
    pixelRatioCap: 1,
    ao: false,
    bloom: true,
    bloomStrength: 0.5,
    grade: true,
    smaa: false,
    liveShadows: false,
    textureSize: 128,
    volumetricSteps: 10,
    waterDepth: false,
    refractWater: false,
    shadowMap: 1024,
  },
  medium: {
    post: true,
    pixelRatioCap: 1.25,
    ao: false,
    bloom: true,
    bloomStrength: 0.62,
    grade: true,
    smaa: true,
    liveShadows: false,
    textureSize: 256,
    volumetricSteps: 16,
    waterDepth: true,
    refractWater: false,
    shadowMap: 1024,
  },
  /** The default. Tuned to hold 60 on an M1. */
  high: {
    post: true,
    pixelRatioCap: 1.4,
    ao: true,
    aoScale: 0.5,
    bloom: true,
    bloomStrength: 0.7,
    grade: true,
    smaa: true,
    // Shadow maps are baked once rather than re-rendered every frame. See
    // Renderer.freezeShadows() for what that costs.
    liveShadows: false,
    textureSize: 256,
    volumetricSteps: 20,
    waterDepth: true,
    refractWater: false,
    shadowMap: 2048,
  },
  /** Everything the art pass built. Screenshots, the rubric, big GPUs. */
  ultra: {
    post: true,
    pixelRatioCap: 2,
    ao: true,
    aoScale: 1.0,
    bloom: true,
    bloomStrength: 0.7,
    grade: true,
    smaa: true,
    liveShadows: true,
    textureSize: 256,
    volumetricSteps: 32,
    waterDepth: true,
    refractWater: true,
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
