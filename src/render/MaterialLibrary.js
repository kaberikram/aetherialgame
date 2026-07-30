import * as THREE from 'three';
import { fbm, materialSet } from './procedural/textures.js';

/**
 * MaterialLibrary — every surface in the chapter, generated from noise.
 *
 * Owns: the named surface set, its noise parameters, and the shared textures.
 * Exposes: get(name, overrides).
 * Forbidden: knowing which zone asked. Three zone agents work in parallel, and
 * the palette only stays coherent if they are drawing from one table rather
 * than each authoring their own stone.
 *
 * Sharing matters twice over: two zones asking for `laterite` get the same
 * THREE.Material instance, which is one program and one texture upload instead
 * of two, and it is the cheapest draw-call saving available before instancing.
 *
 * The surfaces are Southeast Asian by construction, not by tint. Laterite is
 * the porous iron-rich block the candi are actually built from — it wants
 * pitting, not the smooth ashlar of a European cathedral. Andesite is volcanic
 * and fine-grained. Where a surface would read as generic fantasy masonry, the
 * noise is wrong rather than the colour.
 */

/** Stretches noise along one axis. Bark runs vertically; silt runs flat. */
const aniso = (u, v, sx, sy, opts) => fbm(u * sx, v * sy, opts);

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Deterministic per-block variation. Same block, same value, every build. */
function blockHash(col, row) {
  let h = col * 374761393 + row * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Masonry courses.
 *
 * `joint` is 0 on the face of a block and 1 in the mortar gap; `id` is a
 * stable per-block random. Both matter: the joint alone gives moulded brick,
 * and it is the per-block variation in height and tone that makes a wall read
 * as individually cut stones stacked by someone. Every other course is offset
 * by half a block, which is how the candi are actually laid.
 */
function courses(u, v, rows, cols, gap = 0.06) {
  const rowF = v * rows;
  const row = Math.floor(rowF);
  const uu = (u + (row % 2) * 0.5) * cols;
  const col = Math.floor(uu);

  const fu = uu - col;
  const fv = rowF - row;
  // Horizontal joints read wider than vertical ones on real masonry because
  // the bed joint carries the load and the perpend does not.
  const nearU = smoothstep(0, gap, Math.min(fu, 1 - fu));
  const nearV = smoothstep(0, gap * 1.5, Math.min(fv, 1 - fv));
  return { joint: 1 - Math.min(nearU, nearV), id: blockHash(col, row) };
}

/**
 * World-space UV projection.
 *
 * Every mesh in this project is generated, and generated geometry gets 0..1
 * UVs regardless of its size — so a 64m floor slab and a 1m step block sample
 * the same texture across the same UV range, and the masonry on the big one
 * reads as corrugation. Projecting the UV from world position instead makes
 * texel density a property of the world, which is the only thing that behaves
 * correctly when the geometry is procedural.
 *
 * Dominant-axis rather than full triplanar: one sample per map instead of
 * three, with a seam only where a surface passes through 45°. The architecture
 * here is boxes and cylinders, so that seam almost never lands on screen, and
 * three texture fetches per map on every stone surface is not worth buying it
 * back.
 *
 * The projection happens per fragment, and the normal map's tangent frame is
 * rebuilt from the same expression — deriving the frame from the mesh's
 * original UVs while sampling with a different one is the subtle version of
 * this bug, and it shows up as lighting that slides across the surface.
 */
function applyWorldUv(material, metresPerTile) {
  const uniforms = { uWorldUvScale: { value: 1 / metresPerTile } };
  const prev = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPosition_;
        varying vec3 vWorldNormal_;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWorldPosition_ = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal_ = normalize(mat3(modelMatrix) * objectNormal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPosition_;
        varying vec3 vWorldNormal_;
        uniform float uWorldUvScale;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec3 aN_ = abs(vWorldNormal_);
        vec2 wUv_ = (aN_.x > aN_.y && aN_.x > aN_.z)
          ? vec2(vWorldPosition_.z, vWorldPosition_.y)
          : (aN_.y > aN_.z)
            ? vec2(vWorldPosition_.x, vWorldPosition_.z)
            : vec2(vWorldPosition_.x, vWorldPosition_.y);
        wUv_ *= uWorldUvScale;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          diffuseColor *= texture2D( map, wUv_ );
        #endif`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D( roughnessMap, wUv_ ).g;
        #endif`)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN_ = texture2D( normalMap, wUv_ ).xyz * 2.0 - 1.0;
          mapN_.xy *= normalScale;
          mat3 tbn_ = getTangentFrame( - vViewPosition, normal, wUv_ );
          #ifdef DOUBLE_SIDED
            tbn_[0] *= faceDirection;
            tbn_[1] *= faceDirection;
          #endif
          normal = normalize( tbn_ * mapN_ );
        #endif`);
  };

  // Without a distinct key three hands this material the cached program of any
  // other MeshStandardMaterial with the same feature flags, injections and all.
  material.customProgramCacheKey = () => `vessel-worlduv:${metresPerTile}`;
  return material;
}

const mix = (a, b, t) => a + (b - a) * t;
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const tint = (base, shade, t) => [
  mix(base[0], shade[0], t), mix(base[1], shade[1], t), mix(base[2], shade[2], t),
];

/**
 * Each entry: the sample function materialSet() rasterises, plus the material
 * parameters and how many times the map tiles across a unit of geometry.
 *
 * Sample functions return `{ h, color, rough }` — h is the height field the
 * normal map is Sobel'd out of, so it carries the silhouette-scale structure
 * and the colour carries the value.
 */
const SURFACES = {
  /** Volcanic andesite. The cave's bones. Coarse, dark, slightly green. */
  rock: {
    metresPerTile: 3.0,
    params: { roughness: 0.97, metalness: 0 },
    sample: (u, v) => {
      const base = fbm(u, v, { octaves: 5, frequency: 5, seed: 3, period: 5 });
      const grit = fbm(u, v, { octaves: 3, frequency: 22, seed: 11, period: 22 });
      const h = base * 0.75 + grit * 0.25;
      const value = 0.62 + h * 0.62;
      return {
        h,
        color: tint(rgb(0x2d332c), rgb(0x4b5148), h).map((c) => c * value),
        rough: 0.90 + grit * 0.09,
      };
    },
  },

  /** The same stone under water for a thousand years. Darker, slicker, mottled. */
  wetRock: {
    metresPerTile: 3.0,
    params: { roughness: 0.55, metalness: 0.06 },
    sample: (u, v) => {
      const base = fbm(u, v, { octaves: 5, frequency: 4, seed: 7, period: 4 });
      const wet = fbm(u, v, { octaves: 3, frequency: 9, seed: 19, period: 9 });
      const h = base * 0.8 + wet * 0.2;
      // Standing damp pools in the low spots, so roughness follows the height
      // field inversely — that inversion is most of what "wet" reads as.
      const damp = Math.pow(1 - h, 2.2);
      return {
        h,
        color: tint(rgb(0x22272c), rgb(0x3c444c), h).map((c) => c * (0.85 + h * 0.4)),
        rough: mix(0.78, 0.16, damp),
      };
    },
  },

  /**
   * Laterite. Iron-rich, porous, cut into blocks while soft and hardened in
   * air — the actual material of candi plinths. The pitting IS the identity;
   * without it this is just brown stone.
   */
  laterite: {
    metresPerTile: 2.2,
    normalStrength: 1.0,
    params: { roughness: 0.95, metalness: 0 },
    sample: (u, v) => {
      const { joint, id } = courses(u, v, 6, 4, 0.055);
      const body = fbm(u, v, { octaves: 4, frequency: 6, seed: 23, period: 6 });
      // Pits: sparse deep holes, not uniform noise. Thresholding a high
      // frequency field is what makes them read as holes rather than grain.
      const pitField = fbm(u, v, { octaves: 2, frequency: 26, seed: 31, period: 26 });
      const pit = Math.max(0, pitField - 0.58) * 2.4;
      // Each block sits a little proud or shy of its neighbours, and carries
      // its own tone. Laterite is cut soft and hardens in air, so no two
      // blocks in a course ever match.
      const proud = (id - 0.5) * 0.22;
      const h = Math.max(0, 0.45 + body * 0.45 + proud - pit - joint * 0.75);
      const iron = 0.30 + body * 0.45 + (id - 0.5) * 0.3;
      return {
        h,
        color: tint(rgb(0x4a3a2c), rgb(0x7d6a56), iron)
          .map((c) => c * (1 - pit * 0.55) * (1 - joint * 0.42)),
        rough: 0.88 + pit * 0.1,
      };
    },
  },

  /** Andesite ashlar — the dressed stone of the tower itself. Finer courses. */
  candi: {
    metresPerTile: 2.6,
    normalStrength: 0.85,
    params: { roughness: 0.86, metalness: 0 },
    sample: (u, v) => {
      const { joint, id } = courses(u, v, 8, 5, 0.045);
      const face = fbm(u, v, { octaves: 4, frequency: 9, seed: 41, period: 9 });
      const weather = fbm(u, v, { octaves: 3, frequency: 3, seed: 47, period: 3 });
      const proud = (id - 0.5) * 0.13;
      const h = Math.max(0, 0.5 + face * 0.32 + proud - joint * 0.62);
      // Weathering runs down the face and pools in the joints. Chapter 1's
      // candi has been underground and wet for a very long time.
      const stain = weather * 0.5 + joint * 0.35 + (1 - id) * 0.12;
      return {
        h,
        color: tint(rgb(0x847e70), rgb(0x4d4a44), stain).map((c) => c * (0.86 + face * 0.28)),
        rough: mix(0.80, 0.94, stain),
      };
    },
  },

  /** Moss over stone. Clumped, never uniform — uniform moss reads as paint. */
  moss: {
    metresPerTile: 1.6,
    params: { roughness: 0.98, metalness: 0 },
    sample: (u, v) => {
      const clump = fbm(u, v, { octaves: 4, frequency: 7, seed: 53, period: 7 });
      const fine = fbm(u, v, { octaves: 3, frequency: 30, seed: 59, period: 30 });
      const cover = Math.max(0, clump - 0.36) * 1.6;
      const h = clump * 0.6 + fine * 0.4;
      return {
        h,
        color: tint(rgb(0x27301f), rgb(0x4a6134), Math.min(1, cover)).map((c) => c * (0.78 + fine * 0.42)),
        rough: 0.96,
      };
    },
  },

  /** Banyan bark. Stretched vertically, because a tree's grain runs up it. */
  bark: {
    metresPerTile: 1.2,
    params: { roughness: 0.93, metalness: 0 },
    sample: (u, v) => {
      const grain = aniso(u, v, 7, 1.2, { octaves: 4, frequency: 4, seed: 61, period: 4 });
      const rough = aniso(u, v, 14, 2, { octaves: 3, frequency: 12, seed: 67, period: 12 });
      const h = grain * 0.72 + rough * 0.28;
      return {
        h,
        color: tint(rgb(0x2c241c), rgb(0x584a3a), h).map((c) => c * (0.82 + h * 0.36)),
        rough: 0.88 + h * 0.1,
      };
    },
  },

  /** Bone. Pale, smooth, fine-cracked. The one bright value in two dark zones. */
  bone: {
    metresPerTile: 0.35,
    params: { roughness: 0.72, metalness: 0 },
    sample: (u, v) => {
      const porous = fbm(u, v, { octaves: 4, frequency: 14, seed: 71, period: 14 });
      const crack = Math.max(0, fbm(u, v, { octaves: 3, frequency: 8, seed: 73, period: 8 }) - 0.62) * 2.8;
      const h = porous * 0.5 - crack;
      const stain = fbm(u, v, { octaves: 3, frequency: 3, seed: 79, period: 3 });
      return {
        h,
        color: tint(rgb(0xb9b0a0), rgb(0x8a7f6c), stain * 0.8).map((c) => c * (1 - crack * 0.5)),
        rough: mix(0.62, 0.88, porous),
      };
    },
  },

  /** Silt. The floor under the pool: soft, flat, almost featureless. */
  silt: {
    metresPerTile: 6.0,
    params: { roughness: 0.99, metalness: 0 },
    sample: (u, v) => {
      const drift = aniso(u, v, 1, 3.2, { octaves: 4, frequency: 5, seed: 83, period: 5 });
      const h = drift * 0.4;
      return {
        h,
        color: tint(rgb(0x1b2126), rgb(0x2e3941), drift).map((c) => c * (0.9 + drift * 0.2)),
        rough: 0.99,
      };
    },
  },
};

export class MaterialLibrary {
  /** @param {{textureSize:number}} quality */
  constructor(quality) {
    this.size = quality.textureSize;
    this.cache = new Map();
    this.generatedMs = 0;
  }

  /**
   * @param {string} name a key of SURFACES
   * @param {object} [overrides] merged into the material parameters. Use for
   *   per-zone deviation — a tint, an emissive — never to replace the maps.
   */
  get(name, overrides = null) {
    const surface = SURFACES[name];
    if (!surface) throw new Error(`MaterialLibrary: no surface "${name}"`);

    const key = overrides ? `${name}:${JSON.stringify(overrides)}` : name;
    if (this.cache.has(key)) return this.cache.get(key);

    const t0 = performance.now();
    // repeat stays 1: the tiling is done by the world-space projection below,
    // which is the only thing that gives consistent texel density across
    // geometry that ranges from a 0.6m step to a 64m floor slab.
    const maps = materialSet(name, this.size, surface.sample, {
      repeat: 1,
      normalStrength: surface.normalStrength ?? 1.6,
    });
    this.generatedMs += performance.now() - t0;

    const mat = applyWorldUv(
      new THREE.MeshStandardMaterial({ ...maps, ...surface.params, ...overrides }),
      surface.metresPerTile
    );
    mat.name = key;
    this.cache.set(key, mat);
    return mat;
  }

  /** The whole named set, for a zone that just wants the table. */
  all() {
    const out = {};
    for (const name of Object.keys(SURFACES)) out[name] = this.get(name);
    return out;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

export const SURFACE_NAMES = Object.keys(SURFACES);
