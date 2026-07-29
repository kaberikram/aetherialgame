import * as THREE from 'three';

/**
 * Procedural texture generation. There are no image files in this project, so
 * every map is drawn into a canvas at load time.
 *
 * Pure functions: noise parameters in, THREE.Texture out. Nothing here knows
 * about the scene, the camera, or gameplay.
 */

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d', { willReadFrequently: true }) };
}

/**
 * Radial falloff sprite. A uniformly-lit translucent sphere reads as a disc;
 * a radial gradient reads as a light source. `power` shapes the falloff —
 * higher is a tighter, hotter core.
 */
export function glowTexture({ size = 128, power = 2.6, inner = 0.0 } = {}) {
  return memo(`glow:${size}:${power}:${inner}`, () => {
    const { c, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const d = Math.min(1, Math.hypot(dx, dy));
        let a = Math.pow(Math.max(0, 1 - d), power);
        if (inner > 0 && d < inner) a = 1;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** A ready-made additive glow sprite. */
export function makeGlow({ color = 0xffffff, scale = 1, opacity = 1, power = 2.6 } = {}) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture({ power }),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    })
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

// ---------------------------------------------------------------- noise ---

/** Deterministic hash-based value noise. Seeded so builds are reproducible. */
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

/** Tiling fractal brownian motion. `period` keeps the noise seamless. */
export function fbm(x, y, { octaves = 5, frequency = 4, lacunarity = 2, gain = 0.5, seed = 1, period = 4 } = {}) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = frequency;
  let per = period;
  for (let o = 0; o < octaves; o++) {
    // Wrapping the sample coordinates by the period is what makes the result
    // tile — without it every stone texture shows a visible seam.
    const sx = ((x * freq) % per + per) % per;
    const sy = ((y * freq) % per + per) % per;
    sum += valueNoise(sx, sy, seed + o * 37) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    per *= lacunarity;
  }
  return sum / norm;
}

/**
 * Build a tiling material texture set from a height field.
 *
 * @param {(u:number,v:number)=>{h:number, color:[number,number,number], rough:number}} sample
 * @returns {{ map, normalMap, roughnessMap, aoMap }}
 */
export function materialSet(key, size, sample, { normalStrength = 1.6, repeat = 1 } = {}) {
  return memo(`mat:${key}:${size}:${normalStrength}`, () => {
    const albedo = canvas(size);
    const normal = canvas(size);
    const rough = canvas(size);

    const heights = new Float32Array(size * size);
    const aImg = albedo.ctx.createImageData(size, size);
    const rImg = rough.ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const s = sample(u, v);
        const i = y * size + x;
        heights[i] = s.h;
        aImg.data[i * 4] = Math.round(s.color[0] * 255);
        aImg.data[i * 4 + 1] = Math.round(s.color[1] * 255);
        aImg.data[i * 4 + 2] = Math.round(s.color[2] * 255);
        aImg.data[i * 4 + 3] = 255;
        const rv = Math.round(s.rough * 255);
        rImg.data[i * 4] = rImg.data[i * 4 + 1] = rImg.data[i * 4 + 2] = rv;
        rImg.data[i * 4 + 3] = 255;
      }
    }
    albedo.ctx.putImageData(aImg, 0, 0);
    rough.ctx.putImageData(rImg, 0, 0);

    // Sobel the height field into a tangent-space normal map, wrapping at the
    // edges so the normals tile with the albedo.
    const nImg = normal.ctx.createImageData(size, size);
    const at = (x, y) => heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nImg.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
        nImg.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
        nImg.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        nImg.data[i + 3] = 255;
      }
    }
    normal.ctx.putImageData(nImg, 0, 0);

    const tex = (c, srgb) => {
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.setScalar(repeat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    };

    return {
      map: tex(albedo.c, true),
      normalMap: tex(normal.c, false),
      roughnessMap: tex(rough.c, false),
    };
  });
}

export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v?.map) for (const t of Object.values(v)) t?.dispose?.();
  }
  cache.clear();
}
