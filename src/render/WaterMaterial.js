import * as THREE from 'three';
import { materialSet, fbm } from './procedural/textures.js';

/**
 * Water. Shared by the Star Chamber pool and the Pagoda Well moat.
 *
 * PROJECT.md: "the pool is a character, budget for it." So the high-quality
 * path is a MeshPhysicalMaterial with real transmission — three renders the
 * backdrop into a transmission target and refracts it through the surface,
 * which is genuine refraction rather than a screen-space smear. The cheap path
 * drops to MeshStandardMaterial and keeps everything else.
 *
 * Both paths get the thing that actually sells still water: depth-based murk.
 * The colour and opacity are driven by the thickness of the water column at
 * each pixel — the distance between the surface and whatever is under it —
 * so the shallow ring reads as ankle-deep and the centre reads as bottomless.
 * That gradient is what makes the dais legible as a safety-versus-reach
 * decision before the player has taken a single step into it.
 *
 * The scene depth comes from PostChain (the AO pass's G-buffer). Without it,
 * the murk term falls back to a constant and the water stays flat but valid.
 */

/** Tiling ripple normals. Two scrolling layers is the whole trick. */
function rippleMaps(size) {
  return materialSet('water-ripple', size, (u, v) => {
    const a = fbm(u, v, { octaves: 4, frequency: 6, seed: 101, period: 6 });
    const b = fbm(u + 0.37, v - 0.21, { octaves: 3, frequency: 13, seed: 103, period: 13 });
    const h = a * 0.7 + b * 0.3;
    return { h, color: [h, h, h], rough: 0.02 + h * 0.05 };
  }, { normalStrength: 0.9, repeat: 3 });
}

const MURK_PARS = /* glsl */`
  uniform sampler2D tSceneDepth;
  uniform vec2 uResolution;
  uniform vec2 uCameraRange;   // near, far
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uMurkDistance;
  uniform float uMinOpacity;
  uniform float uMaxOpacity;
  uniform float uHasDepth;
`;

const MURK_BODY = /* glsl */`
  float waterColumn = uMurkDistance;
  if (uHasDepth > 0.5) {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float raw = texture2D(tSceneDepth, screenUv).x;
    float near = uCameraRange.x;
    float far = uCameraRange.y;
    float ndc = raw * 2.0 - 1.0;
    float floorDist = (2.0 * near * far) / (far + near - ndc * (far - near));
    float surfaceDist = -vViewPosition.z;
    waterColumn = max(0.0, floorDist - surfaceDist);
  }
  float murk = 1.0 - exp(-waterColumn / uMurkDistance);
  diffuseColor.rgb = mix(uShallowColor, uDeepColor, murk);
  diffuseColor.a *= mix(uMinOpacity, uMaxOpacity, murk);
`;

/**
 * @param {object} opts
 * @param {{waterDepth:boolean, textureSize:number}} opts.quality
 * @param {number} [opts.shallow] hex — the colour of an inch of water
 * @param {number} [opts.deep]    hex — the colour of water with no bottom
 * @param {number} [opts.murkDistance] metres to full murk
 * @param {boolean} [opts.refract] use transmission. Costs a backdrop pass.
 */
export function createWater({
  quality,
  shallow = 0x1d3a44,
  deep = 0x050b12,
  murkDistance = 2.6,
  minOpacity = 0.42,
  maxOpacity = 0.97,
  roughness = 0.06,
  refract = false,
  scrollSpeed = new THREE.Vector2(0.014, 0.023),
} = {}) {
  const maps = rippleMaps(Math.max(128, quality.textureSize));
  const useTransmission = refract && quality.waterDepth;

  const params = {
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: maps.roughnessMap,
    color: new THREE.Color(shallow),
    roughness,
    metalness: 0.02,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  };

  const material = useTransmission
    ? new THREE.MeshPhysicalMaterial({
      ...params,
      // Transmission wants an opaque material; three handles the blending in
      // its own backdrop pass, and leaving `transparent` on here makes the
      // surface disappear behind itself at grazing angles.
      transparent: false,
      transmission: 0.86,
      thickness: 1.6,
      ior: 1.333,
      attenuationColor: new THREE.Color(deep),
      attenuationDistance: murkDistance * 1.4,
    })
    : new THREE.MeshStandardMaterial(params);

  const uniforms = {
    tSceneDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCameraRange: { value: new THREE.Vector2(0.1, 1000) },
    uShallowColor: { value: new THREE.Color(shallow) },
    uDeepColor: { value: new THREE.Color(deep) },
    uMurkDistance: { value: murkDistance },
    uMinOpacity: { value: minOpacity },
    uMaxOpacity: { value: useTransmission ? 1.0 : maxOpacity },
    uHasDepth: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MURK_PARS}`)
      // color_fragment is where diffuseColor is finalised from the vertex
      // colours, which is the last point before lighting reads it.
      .replace('#include <color_fragment>', `#include <color_fragment>\n${MURK_BODY}`);
  };
  // Distinct key: without it three reuses the un-injected program from any
  // other MeshStandardMaterial with the same feature set.
  material.customProgramCacheKey = () => `vessel-water:${useTransmission}`;

  material.userData.water = {
    uniforms,
    maps,
    scrollSpeed,
    /** Call once per frame from the zone that owns the surface. */
    update(dt, camera, renderer, depthTexture = null) {
      maps.normalMap.offset.x += scrollSpeed.x * dt;
      maps.normalMap.offset.y += scrollSpeed.y * dt;
      uniforms.uCameraRange.value.set(camera.near, camera.far);
      const size = renderer.getDrawingBufferSize(_v2);
      uniforms.uResolution.value.copy(size);
      uniforms.tSceneDepth.value = depthTexture;
      uniforms.uHasDepth.value = depthTexture ? 1 : 0;
    },
  };

  return material;
}

const _v2 = new THREE.Vector2();
