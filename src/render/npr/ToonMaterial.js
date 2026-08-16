import * as THREE from 'three';

/**
 * ToonMaterial — the one surface shader in the game.
 *
 * Everything visible is cel shaded: a hard-stepped diffuse ramp plus a Fresnel
 * rim, and nothing else. No albedo maps, no normal maps, no roughness, no
 * metalness, no ambient occlusion. If a surface in a frame reads as physically
 * based, this file is where that went wrong.
 *
 * ## Why MeshToonMaterial and not a ShaderMaterial
 *
 * A from-scratch ShaderMaterial would have to reimplement shadow map sampling,
 * fog, skinning and instancing before it drew anything — several hundred lines
 * of work on things that are not the art direction, all of which three already
 * does correctly. `MeshToonMaterial` is a Lambert term indexed through a
 * gradient map, which is exactly the model we want, so we take it and inject
 * the one thing it lacks: a rim.
 *
 * ## Why the rim matters
 *
 * Two of the three zones are near-black by design. Previously an emissive-keyed
 * bloom pass was doing the work of separating a silhouette from its background,
 * at the cost of twelve fullscreen quads. A Fresnel rim does the same job in
 * the surface shader for the cost of a dot product, and it is also the read
 * that makes ink-and-paint rendering look drawn rather than lit.
 */

const rampCache = new Map();
const materialCache = new Map();

/**
 * A hard-stepped gradient map: `bands` equal steps from shadow to light.
 *
 * NearestFilter is the entire point. Any interpolation here turns the steps
 * back into the smooth ramp we are specifically trying not to have.
 */
export function toonRamp(bands = 3, { floor = 0.34, ceil = 1.0 } = {}) {
  const key = `${bands}:${floor}:${ceil}`;
  const hit = rampCache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = bands;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < bands; i++) {
    // The darkest band is lifted well off zero so unlit faces still carry
    // their hue and their albedo. A cel shadow that is pure black is a hole in
    // the frame rather than a shadow, and it is the first thing that fails the
    // grayscale check — an unlit wall has to stay a wall.
    const t = bands === 1 ? 1 : i / (bands - 1);
    const v = Math.round((floor + (ceil - floor) * t) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // NoColorSpace, emphatically. This is a lookup table, not an image: the
  // shader reads `.r` as a lighting multiplier. Tagging it sRGB makes three
  // decode it on sample, so a 0.22 darkest band arrives as linear 0.04 and
  // every unlit face in the game renders effectively black — which is exactly
  // the "flat shape with no internal value" the grayscale rubric fails on.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

/**
 * @param {object}  o
 * @param {number}  o.color      base colour, sRGB
 * @param {number}  o.rim        rim colour; falls back to a lifted base
 * @param {number}  o.rimStrength 0 disables the rim entirely
 * @param {number}  o.rimPower   higher = tighter band at the silhouette
 * @param {number}  o.bands      steps in the diffuse ramp
 * @returns {THREE.MeshToonMaterial}
 */
export function toonMaterial({
  color = 0x8a8f98,
  rim = null,
  rimStrength = 0.5,
  rimPower = 2.6,
  bands = 3,
  transparent = false,
  opacity = 1,
  side = THREE.FrontSide,
  fog = true,
} = {}) {
  // Keyed on the values that actually change the program or the uniforms, in a
  // fixed order. NOT on JSON.stringify of an options bag — the old material
  // library did that and shipped seven near-identical stone materials from a
  // single loop, because two callers spelled the same override differently.
  const key = `${color}:${rim}:${rimStrength}:${rimPower}:${bands}:${transparent}:${opacity}:${side}:${fog}`;
  const hit = materialCache.get(key);
  if (hit) return hit;

  const rimColor = new THREE.Color(rim ?? color).lerp(new THREE.Color(0xffffff), 0.55);

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp(bands),
    transparent,
    opacity,
    side,
    fog,
  });

  mat.userData.rim = { value: rimColor };
  mat.userData.rimStrength = { value: rimStrength };
  mat.userData.rimPower = { value: rimPower };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = mat.userData.rim;
    shader.uniforms.uRimStrength = mat.userData.rimStrength;
    shader.uniforms.uRimPower = mat.userData.rimPower;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3  uRim;
         uniform float uRimStrength;
         uniform float uRimPower;`
      )
      // Injected right after `outgoingLight` is assembled and before it is
      // packed, which is where <opaque_fragment> sits. `normal` rather than
      // `vNormal`: it is the view-space normal <normal_fragment_begin> already
      // resolved, so it stays correct under FLAT_SHADED, where vNormal does
      // not exist at all. vViewPosition is view-space too, so the rim costs
      // one normalize, one dot and one pow.
      .replace(
        '#include <opaque_fragment>',
        `float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
         rimF = pow(rimF, uRimPower) * uRimStrength;
         outgoingLight += uRim * rimF;
         #include <opaque_fragment>`
      );
  };

  // Two materials that differ only in a uniform still share one compiled
  // program; two that differ in the injected source must not. The rim source
  // is identical for every instance, so one key for all of them is correct.
  mat.customProgramCacheKey = () => 'vessel-toon-rim';

  materialCache.set(key, mat);
  return mat;
}

/** Frees the cached materials and ramps. Test/teardown only. */
export function disposeToonCache() {
  for (const m of materialCache.values()) m.dispose();
  for (const t of rampCache.values()) t.dispose();
  materialCache.clear();
  rampCache.clear();
}

/** How many distinct materials the cache has handed out. For the perf report. */
export function toonMaterialCount() {
  return materialCache.size;
}
