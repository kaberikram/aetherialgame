/**
 * Render quality presets.
 *
 * Deliberately NOT in tuning.js. That file's rule is "if changing a value
 * would change a player's opinion of the game it belongs here, structural
 * constants like texture resolutions do not" — these are the structural
 * constants.
 *
 * The whole ladder used to be about post-processing: AO scale, bloom strength,
 * SMAA, volumetric step counts, water transmission. None of that exists any
 * more. The renderer is non-photorealistic — banded cel shading, ink edges,
 * one key light and one ambient — and it draws straight to the canvas.
 *
 * So there are three levers left, and they are the only three that still move
 * frame time:
 *
 *   pixelRatioCap   an M1 reports DPR 2, so uncapped is FOUR times the pixels.
 *                   This is the ceiling; `render/adaptive.js` lowers the live
 *                   ratio below it when frame time says to.
 *   shadows         one directional map, baked once (see Renderer.freezeShadows)
 *   outlines        the merged EdgesGeometry ink pass, one draw call per zone
 *
 * `high` is the default and means "hold 60 on an M1 MacBook Pro".
 *
 * The level is chosen by `?quality=` on the URL so the headless harnesses can
 * ask for a cheap build. Software GL cannot afford much, and a smoke test that
 * takes four minutes stops being run.
 */

export const QUALITY = {
  /** Flat-lit, no shadows, no ink. What the collision audit runs at. */
  off: {
    pixelRatioCap: 1,
    shadows: false,
    outlines: false,
    shadowMap: 1024,
    adaptive: false,
  },
  /** Ink but no shadows. The gameplay smoke harness. */
  low: {
    pixelRatioCap: 1,
    shadows: false,
    outlines: true,
    shadowMap: 1024,
    adaptive: false,
  },
  medium: {
    pixelRatioCap: 1.25,
    shadows: true,
    outlines: true,
    shadowMap: 1024,
    adaptive: true,
  },
  /** The default. */
  high: {
    pixelRatioCap: 1.5,
    shadows: true,
    outlines: true,
    shadowMap: 2048,
    adaptive: true,
  },
};

/** The rungs `render/adaptive.js` steps between, coarse to fine. */
export const PIXEL_RATIO_RUNGS = [1.0, 1.25, 1.5];

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
