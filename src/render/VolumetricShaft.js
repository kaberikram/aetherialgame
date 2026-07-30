import * as THREE from 'three';

/**
 * Raymarched volumetric light. PROJECT.md rules out billboard fakes for the
 * Star Chamber and the Pagoda Well, so these march.
 *
 * Two forms, because the two lights are different problems:
 *
 *   shaft(light)  a cone of daylight through the oculus. Marches the volume
 *                 and samples the directional light's own shadow map at each
 *                 step, so the candi tower casts real god-rays down the well.
 *                 That shadowed shaft is the chapter's one daylight image.
 *
 *   glow(point)   in-scattering around the suspended star. No shadow sampling:
 *                 it hangs in open air over the dais with nothing between it
 *                 and the player, so marching a shadow cube would cost a lot
 *                 to prove there is nothing in the way.
 *
 * Both render additively with depth-write off, after the opaque pass. Optional
 * scene-depth occlusion (so the volume stops at the geometry in front of it)
 * comes from PostChain.depthTexture, which is the AO pass's G-buffer — one
 * frame stale, imperceptible on a soft volume, and free.
 */

const COMMON = /* glsl */`
  varying vec3 vWorld;
  varying vec4 vClip;

  // Verbatim from three's packing chunk. A raw ShaderMaterial does not get the
  // chunk, and the bake below writes with MeshDepthMaterial's RGBA packing, so
  // the two have to agree exactly.
  const float UnpackDownscale = 255. / 256.;
  const vec4 PackFactors_ = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
  const vec4 UnpackFactors_ = vec4( UnpackDownscale / PackFactors_.rgb, 1.0 / PackFactors_.a );
  float unpackDepth_(const in vec4 v) { return dot(v, UnpackFactors_); }

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // Depth-buffer occlusion. Returns the world-space distance from the camera
  // to whatever opaque geometry is already drawn at this pixel, or a huge
  // number when there is no depth texture bound.
  float sceneDistance(vec2 uv) {
    #ifdef USE_SCENE_DEPTH
      float d = texture2D(tSceneDepth, uv).x;
      if (d >= 1.0) return 1e6;
      float ndc = d * 2.0 - 1.0;
      float viewZ = (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
      return viewZ;
    #else
      return 1e6;
    #endif
  }
`;

const VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying vec4 vClip;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vClip = projectionMatrix * viewMatrix * world;
    gl_Position = vClip;
  }
`;

const SHAFT_FRAGMENT = /* glsl */`
  uniform vec3 lightColor;
  uniform vec3 lightDir;        // normalised, pointing FROM the light
  uniform float intensity;
  uniform float density;
  uniform int steps;
  uniform float topY;
  uniform float bottomY;
  uniform float radius;        // bounding radius — the analytic volume
  uniform float topRadius;     // the beam's own width where it enters
  uniform float bottomRadius;  // and where it lands
  uniform float time;
  uniform float cameraNear;
  uniform float cameraFar;
  #ifdef USE_SCENE_DEPTH
    uniform sampler2D tSceneDepth;
  #endif
  #ifdef USE_SHADOW
    uniform sampler2D tOcclusion;
    uniform mat4 lightMatrix;
    uniform vec2 occlusionTexel;
    uniform float occlusionBias;
  #endif
  uniform vec3 axis;            // world xz centre of the shaft

  ${COMMON}

  // Slow drifting noise so the shaft has motes in it rather than being a
  // clean cone. Three octaves is enough; this is atmosphere, not a cloud.
  float dust(vec3 p) {
    float n = hash13(floor(p * 1.7 + vec3(0.0, time * 0.35, 0.0)));
    float m = hash13(floor(p * 4.3 - vec3(time * 0.2, 0.0, time * 0.1)));
    return 0.65 + n * 0.25 + m * 0.10;
  }

  float shadowAt(vec3 world) {
    #ifdef USE_SHADOW
      vec4 lp = lightMatrix * vec4(world, 1.0);
      vec3 uv = lp.xyz / lp.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || uv.z > 1.0) return 1.0;
      // Four taps in a rotated cross. A single tap aliases into hard banding
      // along the tower's edges, which reads as a rendering fault rather than
      // as a shadow in the light.
      float lit = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 o = vec2(
          (i == 0 || i == 3) ? occlusionTexel.x : -occlusionTexel.x,
          (i < 2) ? occlusionTexel.y : -occlusionTexel.y
        );
        lit += step(uv.z - occlusionBias, unpackDepth_(texture2D(tOcclusion, uv.xy + o)));
      }
      return lit * 0.25;
    #else
      return 1.0;
    #endif
  }

  /**
   * Ray against the infinite cylinder around the shaft axis, then clipped to
   * the height slab. Analytic, rather than marching from the camera to this
   * fragment's back face: the back face of a closed cylinder jumps from the
   * side wall to the top cap, and that jump draws a hard horizontal seam
   * straight across the sky disc. The mesh is only a proxy for which pixels
   * to shade; these two numbers are the actual volume.
   */
  vec2 volumeSpan(vec3 ro, vec3 rd) {
    vec2 oc = ro.xz - axis.xz;
    float a = dot(rd.xz, rd.xz);
    float t0 = -1e6, t1 = 1e6;
    if (a > 1e-6) {
      float b = 2.0 * dot(oc, rd.xz);
      float c = dot(oc, oc) - radius * radius;
      float disc = b * b - 4.0 * a * c;
      if (disc < 0.0) return vec2(1.0, -1.0);
      float s = sqrt(disc);
      t0 = (-b - s) / (2.0 * a);
      t1 = (-b + s) / (2.0 * a);
    } else if (dot(oc, oc) > radius * radius) {
      return vec2(1.0, -1.0);
    }
    if (abs(rd.y) > 1e-6) {
      float ta = (bottomY - ro.y) / rd.y;
      float tb = (topY - ro.y) / rd.y;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    } else if (ro.y < bottomY || ro.y > topY) {
      return vec2(1.0, -1.0);
    }
    return vec2(max(t0, 0.0), t1);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    vec2 screen = (vClip.xy / vClip.w) * 0.5 + 0.5;
    float opaque = sceneDistance(screen);

    vec2 span = volumeSpan(ro, rd);
    float near = span.x;
    float far = min(span.y, opaque);
    if (far <= near) discard;

    float stepLen = (far - near) / float(steps);
    // Jitter the start by a per-pixel hash. Without it the fixed step count
    // shows as concentric shells wherever the volume is thick.
    float t = near + stepLen * hash13(vec3(gl_FragCoord.xy, time));

    float acc = 0.0;
    for (int i = 0; i < 64; i++) {
      if (i >= steps) break;
      vec3 p = ro + rd * t;

      // The beam widens as it falls, so the radius it is measured against has
      // to widen with it — a constant radius makes the light broader at the
      // oculus than the hole it comes through.
      float hy = clamp((p.y - bottomY) / (topY - bottomY), 0.0, 1.0);
      float beamR = mix(bottomRadius, topRadius, hy);
      float r = length(p.xz - axis.xz) / beamR;
      float radial = max(0.0, 1.0 - r * r);
      radial *= radial;
      // Vertical fade, so the light dissipates on the way down rather than
      // ending in a disc on the floor.
      float height = smoothstep(bottomY, bottomY + (topY - bottomY) * 0.5, p.y);

      if (radial > 0.001 && height > 0.001) {
        acc += radial * height * dust(p) * shadowAt(p) * stepLen;
      }
      t += stepLen;
    }

    float a = 1.0 - exp(-acc * density);
    gl_FragColor = vec4(lightColor * intensity * a, a);
  }
`;

const GLOW_FRAGMENT = /* glsl */`
  uniform vec3 lightColor;
  uniform vec3 center;
  uniform float intensity;
  uniform float density;
  uniform float radius;
  uniform int steps;
  uniform float time;
  uniform float cameraNear;
  uniform float cameraFar;
  #ifdef USE_SCENE_DEPTH
    uniform sampler2D tSceneDepth;
  #endif

  ${COMMON}

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec2 screen = (vClip.xy / vClip.w) * 0.5 + 0.5;
    float opaque = sceneDistance(screen);

    float far = length(vWorld - ro);
    float stepLen = far / float(steps);
    float t = stepLen * hash13(vec3(gl_FragCoord.xy, time));

    float acc = 0.0;
    for (int i = 0; i < 64; i++) {
      if (i >= steps) break;
      if (t > opaque) break;
      vec3 p = ro + rd * t;
      float d = length(p - center) / radius;
      // Inverse-square-ish, clamped near the core so the centre does not
      // blow out into a white disc — the star has to keep internal value.
      float f = 1.0 / (1.0 + d * d * 5.0);
      acc += f * stepLen;
      t += stepLen;
    }

    float a = 1.0 - exp(-acc * density);
    gl_FragColor = vec4(lightColor * intensity * a, a);
  }
`;

function baseMaterial(fragmentShader, uniforms, { depthTexture, shadow }) {
  const defines = {};
  if (depthTexture) defines.USE_SCENE_DEPTH = '';
  if (shadow) defines.USE_SHADOW = '';
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: VERTEX,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    // Back faces: the fragment position is then the FAR side of the volume,
    // which is the end of the march. Front faces would clip the whole effect
    // the moment the camera entered the volume.
    side: THREE.BackSide,
    fog: false,
  });
}

/**
 * A cone of light from a directional source, shadowed by the scene.
 *
 * @param {THREE.DirectionalLight} light must have castShadow enabled — its
 *   shadow map is what puts the tower's silhouette into the beam.
 */
export class VolumetricShaft {
  constructor({ light, top, bottom, topRadius, bottomRadius, center, steps = 32, density = 0.05, intensity = 1, color = null }) {
    this.light = light;
    this.steps = steps;

    const height = top - bottom;
    const bound = Math.max(topRadius, bottomRadius);
    // The proxy is a closed cylinder at the BOUNDING radius, not the beam's
    // tapered shape. Two reasons, both learned the hard way:
    //
    //   closed — an open cylinder has no back face for a ray that exits
    //     through the top, which is every ray cast when the player looks up
    //     the well, the exact shot this shaft exists for.
    //   bounding radius — the proxy only decides which pixels get shaded, and
    //     it must contain the whole analytic volume. A tapered proxy leaves
    //     rays that pass through the volume with no fragment to shade, and its
    //     silhouette shows up as a hard-edged cone drawn across the frame.
    //
    // The taper the player actually sees comes from the radial falloff.
    const geo = new THREE.CylinderGeometry(bound, bound, height, 28, 1, false);
    this.uniforms = {
      lightColor: { value: new THREE.Color(color ?? light.color.getHex()) },
      lightDir: { value: new THREE.Vector3(0, -1, 0) },
      intensity: { value: intensity },
      density: { value: density },
      steps: { value: steps },
      topY: { value: top },
      bottomY: { value: bottom },
      radius: { value: bound },
      topRadius: { value: topRadius },
      bottomRadius: { value: bottomRadius },
      axis: { value: center.clone() },
      time: { value: 0 },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      tSceneDepth: { value: null },
      tOcclusion: { value: null },
      lightMatrix: { value: new THREE.Matrix4() },
      occlusionTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      occlusionBias: { value: 0.0016 },
    };

    this.material = baseMaterial(SHAFT_FRAGMENT, this.uniforms, {
      depthTexture: false, shadow: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(center.x, (top + bottom) / 2, center.z);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /**
   * Renders the scene's depth from the light's point of view, once.
   *
   * This is what puts the candi's silhouette into the beam. It is a bake
   * rather than a per-frame pass because every occluder in the well — the
   * tower, the oculus lip, the shaft wall — is static, so the map is the same
   * on frame two as on frame one. The player and the pigeon do not cast rays
   * out of the beam, which is a loss nobody has ever noticed in a shipped game.
   *
   * The light's own shadow map cannot be sampled here: three binds it as a
   * sampler2DShadow with a compare function attached, which is a different
   * type from the sampler2D this shader reads.
   *
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   */
  bake(renderer, scene, { size = 1024 } = {}) {
    const cam = this.light.shadow.camera;
    this.light.updateMatrixWorld(true);
    this.light.target.updateMatrixWorld(true);
    this.light.shadow.updateMatrices(this.light);
    cam.updateMatrixWorld(true);

    const target = new THREE.WebGLRenderTarget(size, size);
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const wasVisible = this.mesh.visible;

    // Clear to white: packed white is depth 1.0, the far plane. Clearing to
    // the default black would pack as depth 0 and shadow the entire volume.
    this.mesh.visible = false;
    scene.overrideMaterial = depthMat;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.overrideMaterial = prevOverride;
    this.mesh.visible = wasVisible;
    depthMat.dispose();

    this.occlusionTarget?.dispose();
    this.occlusionTarget = target;
    this.uniforms.tOcclusion.value = target.texture;
    this.uniforms.occlusionTexel.value.set(1 / size, 1 / size);
    this.uniforms.lightMatrix.value
      .copy(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse);

    this.material.defines.USE_SHADOW = '';
    this.material.needsUpdate = true;
    this.baked = true;
    return this;
  }

  /** Called once per frame by whatever owns the zone. */
  update(dt, camera, depthTexture = null) {
    const u = this.uniforms;
    u.time.value += dt;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    this.#bindDepth(depthTexture);
  }

  #bindDepth(depthTexture) {
    const want = depthTexture ?? null;
    if (this.uniforms.tSceneDepth.value === want) return;
    this.uniforms.tSceneDepth.value = want;
    const on = !!want;
    // With scene depth the march is bounded by the real geometry, so the proxy
    // must NOT be depth-tested — otherwise there is no light in front of the
    // tower, only behind it. Without scene depth, the depth test is the only
    // occlusion there is, so it goes back on.
    this.material.depthTest = !on;
    if (on === ('USE_SCENE_DEPTH' in this.material.defines)) return;
    if (on) this.material.defines.USE_SCENE_DEPTH = '';
    else delete this.material.defines.USE_SCENE_DEPTH;
    this.material.needsUpdate = true;
  }

  dispose() {
    this.occlusionTarget?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Radial in-scattering around a point light. Used by the suspended star. */
export class VolumetricGlow {
  constructor({ center, radius, steps = 24, density = 0.35, intensity = 1, color = 0xffffff }) {
    const geo = new THREE.SphereGeometry(radius * 1.6, 20, 14);
    this.uniforms = {
      lightColor: { value: new THREE.Color(color) },
      center: { value: center.clone() },
      intensity: { value: intensity },
      density: { value: density },
      radius: { value: radius },
      steps: { value: steps },
      time: { value: 0 },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      tSceneDepth: { value: null },
    };
    this.material = baseMaterial(GLOW_FRAGMENT, this.uniforms, {
      depthTexture: false, shadow: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.copy(center);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** Follows its light: the star drifts, and the glow has to go with it. */
  setCenter(v) {
    this.uniforms.center.value.copy(v);
    this.mesh.position.copy(v);
  }

  update(dt, camera, depthTexture = null) {
    const u = this.uniforms;
    u.time.value += dt;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    if (u.tSceneDepth.value !== depthTexture) {
      u.tSceneDepth.value = depthTexture ?? null;
      const on = !!depthTexture;
      if (on !== ('USE_SCENE_DEPTH' in this.material.defines)) {
        if (on) this.material.defines.USE_SCENE_DEPTH = '';
        else delete this.material.defines.USE_SCENE_DEPTH;
        this.material.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
