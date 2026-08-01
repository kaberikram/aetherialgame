import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';

/**
 * Renderer — owns the WebGLRenderer, the scene graph root and the active camera.
 *
 * Owns: the canvas, colour management, tone mapping, shadow configuration,
 * resize handling, and the per-frame draw.
 * Exposes: scene, camera, renderer, setCamera(), stats snapshot.
 * Forbidden: knowing anything about gameplay. It draws what it is given.
 *
 * ACES tone mapping and linear-to-sRGB output are set here and nowhere else.
 * Every material in the project authors colour in sRGB and is lit in linear.
 */
export class Renderer {
  updateWhilePaused = true;

  constructor(container, quality = {}) {
    this.container = container;
    this.quality = quality;

    // MSAA on the canvas is pure waste whenever the post chain is on: the
    // composer renders into its own targets and the canvas only ever receives
    // a fullscreen quad, so the multisampled buffer is allocated, paid for,
    // and never resolved against any geometry. SMAA in the chain does the
    // antialiasing instead.
    const antialias = quality.post === false;

    this.renderer = new THREE.WebGLRenderer({
      antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      // Needed so the smoke harness and the single-file build can screenshot.
      preserveDrawingBuffer: true,
    });

    // Device pixel ratio is the single largest lever on a retina display and
    // the easiest one to get wrong. An M1 reports DPR 2, so an uncapped
    // renderer draws FOUR times the pixels — through a bloom mip chain, an AO
    // pass and a volumetric raymarch. Capping near 1.4 and letting SMAA carry
    // the edges costs far less than it looks like it should.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap ?? 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
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

    /** Post chain plugs in here. When null, we draw straight to the canvas. */
    this.composer = null;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  attach(engine) {
    this.engine = engine;
    this.bus = engine.bus;
  }

  setCamera(camera) {
    this.camera = camera;
    // The post chain holds its own reference in RenderPass and the AO pass;
    // swapping the camera here without telling it renders the old view.
    this.composer?.setCamera?.(camera);
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
    this.composer?.setSize(w, h);
    this.bus?.emit(EVENTS.ENGINE_RESIZE, { width: w, height: h });
  }

  render() {
    this.renderer.info.reset();
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    const info = this.renderer.info;
    const perf = this.engine.perf;
    perf.drawCalls = info.render.calls;
    perf.triangles = info.render.triangles;
    perf.programs = info.programs?.length ?? 0;
  }

  /**
   * Render every shadow map once, then stop.
   *
   * A shadow-casting PointLight is six full scene renders per frame — the
   * suspended star was costing six of the ten scene passes in the room that
   * also holds the boss fight. Every occluder that matters here is static
   * stonework, so the maps are identical on frame two as on frame one.
   *
   * The cost is that moving things no longer cast into them: the boss's
   * shadow on the dais is gone. That is a real loss, taken deliberately —
   * a contact shadow under a character is cheap to add back, and six scene
   * passes a frame is not cheap to keep.
   *
   * Call once, after everything that casts a shadow exists.
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
   * GPU — but these are hardware-independent and they are what the frame time
   * is made of.
   */
  renderStats() {
    const pr = this.renderer.getPixelRatio();
    const w = Math.round(window.innerWidth * pr);
    const h = Math.round(window.innerHeight * pr);

    let scenePasses = 1; // the beauty pass
    const shadows = [];
    let transmissive = 0;
    this.scene.traverse((o) => {
      // Every transmissive material makes three render the scene again into a
      // backdrop target before it can refract through it. One pool = one pass.
      if (o.isMesh && o.visible && o.material?.transmission > 0) transmissive++;
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      const live = o.shadow.autoUpdate !== false;
      const faces = o.isPointLight ? 6 : 1;
      shadows.push({ type: o.type, faces, live });
      if (live) scenePasses += faces;
    });
    scenePasses += transmissive;
    if (this.composer?.passes?.gtao) scenePasses += 1;  // normal pre-pass

    return {
      pixelRatio: pr,
      resolution: `${w}x${h}`,
      pixelsPerFrame: w * h,
      scenePasses,
      shadowLights: shadows,
      transmissive,
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
