import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { STATE } from '../character/PlayerController.js';
import { ACTION } from '../input/Actions.js';
import { CorpseActor } from './CorpseActor.js';
import { makeGlow } from '../render/procedural/textures.js';

const _v = new THREE.Vector3();

/** The void is parked well clear of anything the level occupies. */
export const VOID_ALTITUDE = 600;

/**
 * Beats 1 and 2 — The Void, and Embodiment.
 *
 * This is the player's first sixty seconds and it is a feature, not a loading
 * screen. The whole sequence is built around one contrast:
 *
 *   In the void, input is weightless. No collision, no horizon, no floor, and
 *   heavy damping so the light glides long after you stop asking it to. It is
 *   pleasant and it is slightly untethered.
 *
 *   The moment the light enters the corpse, all of that is taken away. Gravity,
 *   a ground plane, rate-limited turning, a stand-up that costs three and a
 *   half seconds and includes a knee giving out.
 *
 * The unfamiliarity is the point, and it resolves on its own. There are no
 * tutorial popups anywhere in this file.
 */
export class VoidSequence {
  constructor(engine, player, camera) {
    this.engine = engine;
    this.bus = engine.bus;
    this.player = player;
    this.cameraRig = camera;
    this.input = engine.resolve('input');
    this.scene = engine.resolve('renderer').scene;

    this.phase = 'idle';
    this.timer = 0;
    this.group = new THREE.Group();
    this.onComplete = null;
    this.promptShown = false;

    /** Where the body is standing when the world resolves. Set by the caller. */
    this.landingPosition = new THREE.Vector3(0, 0, 0);
    this.landingFacing = 0;
  }

  build() {
    // The void has no horizon and no fog. Fog implies distance; distance
    // implies a world. There isn't one yet.
    this.savedBackground = this.scene.background;
    this.savedFog = this.scene.fog;

    // The drifting light. It throws real illumination, so the corpse is lit by
    // the player rather than by a light the player cannot see.
    const wisp = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xf4f7ff, transparent: true, opacity: 0.95 })
    );
    // Radial-falloff sprites, not spheres. A uniformly-lit translucent sphere
    // reads as a flat disc; only a falloff reads as a light source. Bloom in
    // Phase 7 amplifies these rather than replacing them.
    this.halos = [
      makeGlow({ color: 0xbcd0f2, scale: 1.5, opacity: 0.85, power: 2.4 }),
      makeGlow({ color: 0x6f8dc4, scale: 4.6, opacity: 0.30, power: 3.4 }),
    ];
    for (const h of this.halos) wisp.add(h);
    // Slow decay and long range, so the corpse resolves out of the dark as the
    // player drifts toward it rather than appearing all at once.
    const wispLight = new THREE.PointLight(0xdce8ff, 9, 34, 1.5);
    wisp.add(wispLight);
    this.wisp = wisp;
    this.wispLight = wispLight;
    this.group.add(wisp);

    this.corpse = new CorpseActor(this.scene);

    this.scene.add(this.group);
    return this;
  }

  /**
   * The void is staged far above the level, not inside it. Beat 1 says "no
   * collision, no horizon" and the simplest way to mean that is for there to
   * genuinely be nothing within reach.
   *
   * @param {THREE.Object3D|null} worldGroup hidden for the duration, so the
   *        level's lights cannot leak into a space that has none
   */
  start(worldGroup = null) {
    this.worldGroup = worldGroup;
    if (worldGroup) {
      this.worldWasVisible = worldGroup.visible;
      worldGroup.visible = false;
    }

    this.corpsePosition = new THREE.Vector3(0, VOID_ALTITUDE, 0);
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = null;

    this.player.beginDrift(new THREE.Vector3(0, VOID_ALTITUDE + 2.4, 15));
    this.phase = 'drift';
    this.timer = 0;

    this.cameraRig.enabled = true;
    this.cameraRig.collisionEnabled = false;
    this.bus.emit(EVENTS.BEAT_ENTERED, { id: 1 });
    return this;
  }

  #restoreWorld() {
    this.cameraRig.collisionEnabled = true;
    if (this.worldGroup) this.worldGroup.visible = this.worldWasVisible ?? true;
  }

  /** The body, dropped. Lit only by the player, because nothing else is here. */
  placeCorpse() {
    this.corpse.place(this.corpsePosition, -0.4);
  }

  fixedUpdate(dt) {
    this.timer += dt;
    this.corpse?.fixedUpdate(dt);

    switch (this.phase) {
      case 'drift': this.#updateDrift(dt); break;
      case 'entering': this.#updateEntering(dt); break;
      case 'standing': this.#updateStanding(dt); break;
    }
  }

  #updateDrift(dt) {
    this.wisp.position.copy(this.player.position);
    // A slow pulse, off-tempo from a heartbeat. Not quite alive.
    const pulse = 0.86 + Math.sin(this.timer * 1.7) * 0.11 + Math.sin(this.timer * 0.41) * 0.05;
    this.wisp.material.opacity = pulse;
    this.wispLight.intensity = 7.4 + pulse * 3.2;
    this.wisp.scale.setScalar(0.9 + pulse * 0.16);
    this.halos[1].material.opacity = 0.22 + pulse * 0.14;

    // The corpse is only introduced once the player has had time to notice
    // there is nothing else. Roughly five seconds of pure void first.
    if (this.timer > 5.0 && !this.corpseShown) {
      this.corpseShown = true;
      this.placeCorpse();
      this.bus.emit(EVENTS.BEAT_ENTERED, { id: 2 });
    }

    if (!this.corpseShown) return;

    const dist = this.player.position.distanceTo(this.corpsePosition);

    // The body pulls at the light. It is gentle enough to read as a current
    // rather than as the game steering, and it means the player does not have
    // to solve a 3D docking problem to reach the one thing in the void.
    if (dist < 12) {
      _v.copy(this.corpsePosition).sub(this.player.position).normalize();
      this.player.velocity.addScaledVector(_v, (1 - dist / 12) * 5.5 * dt);
    }

    if (dist < 3.6) {
      if (!this.promptShown) {
        this.promptShown = true;
        this.bus.emit(EVENTS.INTERACT_AVAILABLE, { id: 'corpse', label: 'take it' });
      }
      if (this.input.actions[ACTION.INTERACT].pressed || this.input.actions[ACTION.JUMP].pressed) {
        this.#beginEntering();
      }
    } else if (this.promptShown) {
      this.promptShown = false;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
    }
  }

  #beginEntering() {
    this.phase = 'entering';
    this.timer = 0;
    this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
    this.enterStart = this.player.position.clone();
    this.player.velocity.set(0, 0, 0);
  }

  /** The light is drawn into the chest. It does not go willingly. */
  #updateEntering(dt) {
    const t = Math.min(1, this.timer / 1.9);
    const eased = t * t * (3 - 2 * t);
    _v.copy(this.corpsePosition).setY(this.corpsePosition.y + 0.5);
    this.wisp.position.lerpVectors(this.enterStart, _v, eased);

    // It contracts and brightens as it goes in — the light gets smaller and
    // harder rather than fading out.
    const squeeze = 1 - eased;
    this.wisp.scale.setScalar(0.25 + squeeze * 0.95);
    this.wispLight.intensity = 4.0 + (1 - squeeze) * 26;
    this.wisp.material.opacity = 0.35 + squeeze * 0.6;

    if (t >= 1) {
      this.wisp.visible = false;
      this.wispLight.intensity = 0;
      this.phase = 'standing';
      this.timer = 0;

      // The world arrives at the same instant the body does. The player body
      // takes over from the corpse actor mid-pose — both are the same rig
      // playing the same clip, so the handoff is invisible.
      this.corpse.setVisible(false);
      this.#restoreWorld();
      this.player.beginCorpse(this.landingPosition, this.landingFacing);
      this.player.beginStandUp();

      this.scene.background = new THREE.Color(0x151a21);
      this.scene.fog = new THREE.FogExp2(0x151a21, 0.055);
      this.bus.emit(EVENTS.SFX, { id: 'embodiment' });
      this.cameraRig.addShake(0.7);
    }
  }

  #updateStanding(dt) {
    // The fog lifts over the stand-up, so the space resolves at the same rate
    // the body does.
    const t = Math.min(1, this.timer / 4.2);
    if (this.scene.fog?.isFogExp2) {
      this.scene.fog.density = THREE.MathUtils.lerp(0.055, 0.0032, t);
    }
    if (this.player.state !== STATE.STAND_UP && this.timer > 1) {
      this.phase = 'done';
      this.bus.emit(EVENTS.BEAT_ENTERED, { id: 3 });
      this.onComplete?.();
    }
  }

  get finished() {
    return this.phase === 'done';
  }

  /** Debug skip, for iterating on anything after beat 2. */
  skip() {
    this.wisp.visible = false;
    this.wispLight.intensity = 0;
    this.phase = 'done';
    this.corpse.setVisible(false);
    this.#restoreWorld();
    this.scene.background = new THREE.Color(0x151a21);
    this.scene.fog = new THREE.FogExp2(0x151a21, 0.0032);
    this.player.facing = this.player.targetFacing = this.landingFacing;
    this.player.root.rotation.y = this.landingFacing;
    this.player.teleport(this.landingPosition);
    this.player.setState(STATE.IDLE, { force: true });
    this.player.mesh.visible = true;
    this.player.anim.play('idle', { fadeFrames: 0 });
    this.bus.emit(EVENTS.INTERACT_AVAILABLE, null);
    this.onComplete?.();
  }

  dispose() {
    this.scene.remove(this.group);
    this.wisp.geometry.dispose();
    this.wisp.material.dispose();
    this.corpse?.dispose();
  }
}
