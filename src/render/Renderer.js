import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { AdaptiveResolution } from './adaptive.js';

/**
 * Renderer — owns the WebGLRenderer, the scene graph root and the active camera.
 *
 * Owns: the canvas, colour management, shadow configuration, resize handling,
 * the adaptive pixel ratio, and the per-frame draw.
 * Exposes: scene, camera, renderer, setCamera(), renderStats().
 * Forbidden: knowing anything about gameplay. It draws what it is given.
 *
 * There is no post chain. The renderer draws the scene straight to the canvas,
 * once, and that is the whole frame — see DECISIONS D53.
 *
 * Tone mapping is OFF, and that is not an oversight. ACES exists to compress a
 * high dynamic range into a display, which is exactly the wrong operation for
 * cel shading: the point of a banded ramp is that the colour you authored is
 * the colour that ships. Running the bands through a filmic curve smears the
 * steps back into a gradient and undoes the shading model. Output is still
 * sRGB, so materials author in sRGB and are lit in linear as before.
 */
export class Renderer {
  updateWhilePaused = true;

  constructor(container, quality = {}) {
    this.container = container;
    this.quality = quality;

    // MSAA is worth having now that nothing renders through an intermediate
    // target: it is the only antialiasing in the build, and the ink edges are
    // thin dark lines against flat fields — the exact case aliasing is most
    // visible in. On the Apple GPUs this targets, MSAA resolves in tile memory
    // and is close to free.
    //
    // preserveDrawingBuffer forces the browser to copy the back buffer every
    // frame instead of swapping it, and disables compositor fast paths. It
    // exists purely so the harnesses can screenshot, so it is behind a flag
    // rather than shipping in every frame the player sees.
    let capture = false;
    try {
      capture = new URLSearchParams(location.search).has('capture');
    } catch { /* no location in a worker/test context */ }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      preserveDrawingBuffer: capture,
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = quality.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = false;

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      TUNING.camera.fov,
      window.innerWidth / window.innerHeight,
      TUNING.camera.near,
      TUNING.camera.far
    );
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 1, 0);
    // Layer 1 is "shadow-caster only": objects on it are rendered into shadow
    // maps but never by the main camera. The pigeon's knight silhouette lives
    // there, which is how its shadow can be the wrong shape.
    this.camera.layers.disable(1);

    // Device pixel ratio is the single largest lever on a retina display. An
    // M1 reports DPR 2, so an uncapped renderer draws FOUR times the pixels.
    // The quality preset sets the ceiling; this lowers the live ratio under it
    // when measured frame time says to.
    this.adaptive = new AdaptiveResolution(this.engine, this.renderer, quality);
    this.renderer.setPixelRatio(this.adaptive.pixelRatio);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  attach(engine) {
    this.engine = engine;
    this.bus = engine.bus;
    this.adaptive.engine = engine;
  }

  setCamera(camera) {
    this.camera = camera;
    this.resize();
  }

  get size() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.bus?.emit(EVENTS.ENGINE_RESIZE, { width: w, height: h });
  }

  render() {
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.adaptive.update();

    const info = this.renderer.info;
    const perf = this.engine.perf;
    perf.drawCalls = info.render.calls;
    perf.triangles = info.render.triangles;
    perf.programs = info.programs?.length ?? 0;
    perf.pixelRatio = this.renderer.getPixelRatio();
  }

  /**
   * Render every shadow map once, then stop.
   *
   * Every occluder that matters in this chapter is static stonework, so the
   * maps are identical on frame two as on frame one. The cost is that moving
   * things stop casting into them, which is a real loss taken deliberately.
   *
   * Call once, after everything that casts a shadow exists — and after the
   * world is *visible*. Baking while the void sequence has the chapter group
   * hidden bakes an empty map and freezes it that way.
   */
  freezeShadows() {
    let frozen = 0;
    this.scene.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      // needsUpdate survives autoUpdate:false for exactly one pass, which is
      // what bakes the map; three clears the flag itself afterwards.
      o.shadow.needsUpdate = true;
      o.shadow.autoUpdate = false;
      frozen++;
    });
    return frozen;
  }

  /**
   * What this frame actually costs, in the terms that decide frame time.
   *
   * Frame time itself cannot be measured in the build container — there is no
   * GPU — but these are hardware-independent and they are what frame time is
   * made of. Use `?bench` on real hardware for milliseconds.
   */
  renderStats() {
    const pr = this.renderer.getPixelRatio();
    const w = Math.round(window.innerWidth * pr);
    const h = Math.round(window.innerHeight * pr);

    let scenePasses = 1; // the beauty pass, and in this build that is all
    const shadows = [];
    let lights = 0;
    this.scene.traverse((o) => {
      if (!o.isLight || !o.visible) return;
      lights++;
      if (!o.castShadow || !o.shadow) return;
      const live = o.shadow.autoUpdate !== false;
      const faces = o.isPointLight ? 6 : 1;
      shadows.push({ type: o.type, faces, live });
      if (live) scenePasses += faces;
    });

    return {
      pixelRatio: pr,
      resolution: `${w}x${h}`,
      pixelsPerFrame: w * h,
      scenePasses,
      shadowLights: shadows,
      lights,
      transmissive: 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
