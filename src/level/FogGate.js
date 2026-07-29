import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { ACTION } from '../input/Actions.js';
import { FILTERS } from '../physics/PhysicsWorld.js';

/**
 * The fog gate.
 *
 * Its job is the moment before the fight: a wall you can see through but not
 * pass without choosing to. It is the last point at which the player can turn
 * around, and making that choice explicit is most of what makes walking
 * through it feel like a commitment.
 *
 * Once through, it seals behind you until the boss is dead.
 */
export class FogGate {
  constructor(engine, { position, width = 5.0, height = 4.2, facing = 0, onEnter }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.input = engine.resolve('input');
    this.player = engine.resolve('player');
    this.scene = engine.resolve('renderer').scene;
    this.position = position.clone();
    this.facing = facing;
    this.onEnter = onEnter;
    this.open = false;
    this.sealed = false;
    this.promptShown = false;

    this.#build(width, height);
  }

  #build(width, height) {
    const geo = new THREE.PlaneGeometry(width, height, 12, 12);

    // A soft, slowly churning wall. Vertical gradient so it reads as fog
    // standing in a doorway rather than as a flat quad.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xc8d4e8) },
        uOpacity: { value: 0.62 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }

        void main() {
          vec2 p = vUv * vec2(3.0, 2.0);
          float n = noise(p + vec2(0.0, -uTime * 0.14));
          n = mix(n, noise(p * 2.3 + vec2(uTime * 0.07, -uTime * 0.21)), 0.5);
          // Rises and thins toward the top; fades at the jambs so it does not
          // read as a rectangle pasted into the doorway.
          float vertical = smoothstep(1.0, 0.15, vUv.y);
          float edges = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          float a = (0.35 + n * 0.75) * vertical * edges * uOpacity;
          gl_FragColor = vec4(uColor * (0.7 + n * 0.5), a);
        }
      `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.position).setY(this.position.y + height / 2);
    mesh.rotation.y = this.facing;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.material = mat;

    // A physical barrier that is removed the moment the player commits.
    const { body } = this.engine.resolve('physics').addStaticBox(
      new THREE.Vector3(width, height, 0.6),
      new THREE.Vector3(this.position.x, this.position.y + height / 2, this.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.facing, 0)),
      { group: FILTERS.world }
    );
    this.barrierBody = body;
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
    if (this.open || this.sealed) return;

    const dist = this.player.position.distanceTo(this.position);
    const near = dist < 3.0;
    if (near !== this.promptShown) {
      this.promptShown = near;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, near ? { id: 'fogGate', label: 'enter' } : null);
    }
    if (near && this.input.actions[ACTION.INTERACT].pressed && this.player.canAct()) {
      this.enter();
    }
  }

  enter() {
    this.open = true;
    this.promptShown = false;
    this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
    this.bus.emit(EVENTS.SFX, { id: 'fogGate', position: this.position });
    this.engine.resolve('physics').removeBody(this.barrierBody);
    this.barrierBody = null;

    // Push the player through, then seal behind them.
    this.onEnter?.();
    setTimeout(() => this.seal(), 900);
  }

  seal() {
    if (!this.open) return;
    this.sealed = true;
    const { body } = this.engine.resolve('physics').addStaticBox(
      new THREE.Vector3(5.0, 4.2, 0.6),
      new THREE.Vector3(this.position.x, this.position.y + 2.1, this.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.facing, 0)),
      { group: FILTERS.world }
    );
    this.barrierBody = body;
    this.material.uniforms.uOpacity.value = 0.78;
  }

  /** Boss dead, or player dead — the gate opens for good. */
  dissolve() {
    this.sealed = false;
    this.open = true;
    if (this.barrierBody) {
      this.engine.resolve('physics').removeBody(this.barrierBody);
      this.barrierBody = null;
    }
    this.mesh.visible = false;
  }

  reset() {
    this.open = false;
    this.sealed = false;
    this.mesh.visible = true;
    this.material.uniforms.uOpacity.value = 0.62;
    if (!this.barrierBody) {
      const { body } = this.engine.resolve('physics').addStaticBox(
        new THREE.Vector3(5.0, 4.2, 0.6),
        new THREE.Vector3(this.position.x, this.position.y + 2.1, this.position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.facing, 0)),
        { group: FILTERS.world }
      );
      this.barrierBody = body;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
