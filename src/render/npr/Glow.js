import * as THREE from 'three';

/**
 * Banded glow sprites — the NPR answer to a soft halo.
 *
 * The player is a formless light for the whole opening beat, the star is the
 * Star Chamber's only light source, and the wing forms are made of light. All
 * three need to read as *emitting* rather than as lit surfaces, which is the
 * one thing a cel-shaded material cannot do.
 *
 * A photoreal glow is a smooth radial falloff. That is exactly wrong here: it
 * is the visual signature of a bloom pass, and this renderer does not have one.
 * Ink-and-paint animation draws a glow as a small number of hard-edged
 * concentric shapes — a bright core, one or two haloes, each a flat value with
 * a crisp boundary. That is what this draws, and it is cheaper besides: a
 * 64px texture with three fills instead of a 128px per-pixel `pow`.
 */

const cache = new Map();

function bandedTexture(bands, size = 64) {
  const key = `${bands}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = size / 2;

  // Drawn outermost first so each ring paints over the one outside it. Alpha
  // steps down by a fixed ratio per band, which is what gives the stack its
  // read: distinct rings, not a gradient approximated in stairs.
  for (let i = bands; i >= 1; i--) {
    const t = i / bands;
    g.globalAlpha = Math.pow(1 - t, 1.4) * 0.85 + (i === 1 ? 0.15 : 0);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(mid, mid, mid * t * 0.98, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
}

/**
 * @param {object} o
 * @param {number} o.color
 * @param {number} o.scale   world-space diameter
 * @param {number} o.opacity
 * @param {number} o.bands   concentric rings; 2 is a core and a halo
 * @returns {THREE.Sprite}
 */
export function makeGlow({ color = 0xffffff, scale = 1, opacity = 1, bands = 3 } = {}) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bandedTexture(bands),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  sprite.scale.setScalar(scale);
  return sprite;
}

/** Frees the cached textures. Test/teardown only. */
export function disposeGlowCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
