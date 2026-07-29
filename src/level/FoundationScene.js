import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * FoundationScene — Phase 0 only.
 *
 * An empty world, a grey ground plane, an orbit debug camera. Its job is to
 * prove the loop, the renderer, the resize path and the stats overlay all work
 * before a single line of gameplay code exists. Phase 1 replaces it with the
 * grey box test room and the player controller.
 */
export class FoundationScene {
  updateWhilePaused = true;

  constructor(engine) {
    this.engine = engine;
    this.renderer = engine.resolve('renderer');
    this.scene = this.renderer.scene;
  }

  async init() {
    const { scene } = this;
    scene.background = new THREE.Color(0x0b0d10);
    scene.fog = new THREE.Fog(0x0b0d10, 40, 180);

    // Grey box lighting: one key with shadows, one weak fill. Deliberately
    // unglamorous — Phase 0 is not allowed to make anything look good.
    const key = new THREE.DirectionalLight(0xdfe6f2, 2.2);
    key.position.set(24, 34, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    const s = 45;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.03;
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x5a6472, 0x14171c, 0.55));

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x6e7378, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // A one-metre grid, because "correct real-world scale" is a Phase 4 gate
    // and the only way to hold it is to be able to see the metre.
    const grid = new THREE.GridHelper(200, 200, 0x2c3138, 0x1a1e23);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);

    // A 1.68m reference capsule: the player's real height. Everything built
    // later gets sanity-checked against this silhouette.
    const ref = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 1.04, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 })
    );
    ref.position.set(0, 0.84, 0);
    ref.castShadow = true;
    scene.add(ref);
    this.reference = ref;

    this.controls = new OrbitControls(this.renderer.camera, this.renderer.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.renderer.camera.position.set(6, 3.4, 7.5);
    this.controls.update();
  }

  update(dt) {
    this.controls.update();
  }

  dispose() {
    this.controls.dispose();
  }
}
