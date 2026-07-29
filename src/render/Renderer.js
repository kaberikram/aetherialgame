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

  constructor(container, { antialias = true, pixelRatioCap = 2 } = {}) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      // Needed so the smoke harness and the single-file build can screenshot.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
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

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
