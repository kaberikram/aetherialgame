import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/**
 * The pigeon.
 *
 * It leads, waits, comments, and never helps in combat. That last one is
 * absolute: there is no code path in this file that damages, heals, blocks,
 * aggros, or assists. If it ever helps in a fight the character is broken.
 *
 * THE THREE TELLS. PROJECT.md forbids signposting the betrayal in dialogue, so
 * all three live in environment and animation:
 *
 *   1. ITS SHADOW IS WRONG. A separate caster — a tall armoured knight — is
 *      parented under the bird, invisible to the camera but casting into the
 *      shadow map. The shadow on the floor is human-sized and human-shaped.
 *   2. IT NEVER ENTERS THE STAR'S LIGHT. Its pathing has a hard repulsor
 *      around the star's pool of illumination. It will take a longer route,
 *      hover at the edge, and wait rather than cross it.
 *   3. IT FLINCHES FROM THE SWORD. On the pickup it recoils, hard, and its
 *      voice cuts off mid-line.
 *
 * All three are designed to be missed once and noticed on a second look.
 */
export class Pigeon {
  constructor(engine, { player, chapter }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.scene = engine.resolve('renderer').scene;
    this.state = engine.resolve('state');
    this.player = player;
    this.chapter = chapter;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.mode = 'lead';
    this.bobPhase = Math.random() * 10;
    this.flapPhase = 0;
    this.waypointIndex = 0;
    this.spokenBeats = new Set();
    this.flinchTimer = 0;
    this.starRepulsor = null;
    /** When set, the bird hovers here instead of leading the path. Beat 1
     *  uses this to stage it beside the corpse it just dropped. */
    this.holdPosition = null;

    this.#build();
    this.#bindBarks();
  }

  #build() {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8e9298, roughness: 0.72, metalness: 0.04 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x4c5158, roughness: 0.66, metalness: 0.10 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0x33322f, roughness: 0.55, metalness: 0.1 });

    // A grey pigeon. Ordinary on purpose — nothing about its silhouette should
    // read as important until the shadow does the work.
    const parts = [];
    const body = new THREE.SphereGeometry(0.115, 10, 8);
    body.scale(1, 0.92, 1.45);
    parts.push(body);
    const neck = new THREE.SphereGeometry(0.062, 8, 6);
    neck.translate(0, 0.075, 0.105);
    parts.push(neck);
    const tail = new THREE.BoxGeometry(0.10, 0.018, 0.16);
    tail.translate(0, -0.01, -0.20);
    parts.push(tail);
    const bodyMesh = new THREE.Mesh(mergeGeometries(parts, false), bodyMat);
    bodyMesh.castShadow = false; // the knight casts instead — tell #1
    group.add(bodyMesh);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), darkMat);
    head.position.set(0, 0.125, 0.145);
    group.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.055, 5), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.118, 0.195);
    group.add(beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xd8a13c }));
      eye.position.set(s * 0.030, 0.138, 0.168);
      group.add(eye);
    }

    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.014, 0.13), darkMat);
      wing.position.set(s * 0.115, 0.03, -0.01);
      wing.geometry.translate(s * 0.10, 0, 0);
      group.add(wing);
      this.wings.push({ mesh: wing, side: s });
    }

    // --- TELL 1: the shadow ------------------------------------------------
    // A knight, roughly a person and a half tall, parented under the bird and
    // scaled to the shadow it should throw. Invisible to the camera; visible
    // only in the shadow map. It hangs below so the shadow lands under the
    // bird rather than beside it.
    const knight = new THREE.Group();
    const kParts = [];
    const torso = new THREE.BoxGeometry(0.62, 1.05, 0.36);
    torso.translate(0, 1.35, 0);
    kParts.push(torso);
    const pauldronL = new THREE.BoxGeometry(0.30, 0.26, 0.34);
    pauldronL.translate(-0.44, 1.72, 0);
    kParts.push(pauldronL);
    const pauldronR = pauldronL.clone();
    pauldronR.translate(0.88, 0, 0);
    kParts.push(pauldronR);
    const helm = new THREE.BoxGeometry(0.30, 0.36, 0.32);
    helm.translate(0, 2.06, 0.02);
    kParts.push(helm);
    const crest = new THREE.ConeGeometry(0.10, 0.34, 4);
    crest.translate(0, 2.36, 0);
    kParts.push(crest);
    // A long blade held point-down — the shape that should make a player
    // look twice at a bird's shadow.
    const blade = new THREE.BoxGeometry(0.09, 1.30, 0.05);
    blade.translate(0.52, 0.72, 0.10);
    kParts.push(blade);
    const cross = new THREE.BoxGeometry(0.34, 0.07, 0.07);
    cross.translate(0.52, 1.40, 0.10);
    kParts.push(cross);
    for (const [i, s] of [-1, 1].entries()) {
      const leg = new THREE.BoxGeometry(0.22, 0.86, 0.24);
      leg.translate(s * 0.17, 0.44, 0);
      kParts.push(leg);
    }
    const knightMesh = new THREE.Mesh(
      mergeGeometries(kParts, false),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    knightMesh.castShadow = true;
    // Invisible to the camera, but three.js still renders it into the shadow
    // map. Layer 1 is excluded from the main camera's layer mask.
    knightMesh.layers.set(1);
    knight.add(knightMesh);
    knight.position.y = -1.1;
    knight.scale.setScalar(1.15);
    group.add(knight);
    this.knightShadow = knight;

    this.group = group;
    this.scene.add(group);
  }

  /**
   * Barks fire on progression state, never on timers. A companion that talks
   * on a clock is filling silence; one that talks when something happened is
   * reacting to you.
   */
  #bindBarks() {
    this.bus.on(EVENTS.BEAT_ENTERED, ({ id }) => this.#speakBeat(id));
    this.bus.on(EVENTS.PLAYER_EMBODIED, () => this.#speakBeat(2));
    this.bus.on(EVENTS.ZONE_ENTERED, ({ id }) => {
      if (id === 'starChamber') this.#speakBeat(4);
    });
    this.bus.on(EVENTS.ITEM_PICKED_UP, ({ id }) => {
      if (id === 'sword') this.#onSwordTaken();
    });
    this.bus.on(EVENTS.ALIGNMENT_CHOSEN, () => this.#speakBeat(7));
    this.bus.on(EVENTS.BOSS_DEFEATED, () => this.#speakBeat(6));
  }

  /**
   * The dialogue for beats 1, 2, 4, 5, 7 and 8.
   *
   * Calm, helpful, and subtly incorrect. It never says anything false that can
   * be checked, and never says anything true that costs it. Note how often it
   * says "we".
   */
  #speakBeat(id) {
    if (this.spokenBeats.has(id)) return;
    const lines = {
      1: 'There you are. I have been looking for a long time.',
      2: 'It will not fit well at first. Nothing borrowed ever does.',
      3: 'Down. Everything worth having in this place is down.',
      4: 'Not yet. Whatever is under that water was old when the temple was new.',
      5: 'Someone left that behind. They will not be needing it.',
      6: 'You did that. Remember that you did that.',
      7: 'Take it. It was always yours — I only kept it safe.',
      8: 'Seven trials. You have one. I can wait.',
    };
    const text = lines[id];
    if (!text) return;
    this.spokenBeats.add(id);

    // Speech is deliberately NON-POSITIONAL while the wing-flaps are
    // positional. That mismatch is a tell, not a bug. Do not fix it.
    this.bus.emit(EVENTS.DIALOGUE_LINE, { speaker: 'the pigeon', text, duration: 5.2 });
    this.bus.emit(EVENTS.SFX, { id: 'pigeonVoice', positional: false });
  }

  /** TELL 3: it flinches from the sword, and the line cuts off. */
  #onSwordTaken() {
    this.flinchTimer = 1.5;
    this.velocity.addScaledVector(
      _v.copy(this.position).sub(this.player.position).setY(0.4).normalize(),
      7.5
    );
    this.bus.emit(EVENTS.SFX, { id: 'pigeonFlinch', position: this.position });
    // Beat 5's line starts and is cut short by the recoil.
    this.spokenBeats.add(5);
    this.bus.emit(EVENTS.DIALOGUE_LINE, { speaker: 'the pigeon', text: 'Someone left that be—', duration: 1.6 });
  }

  /** Where the star's illumination pools. TELL 2 keeps the bird out of it. */
  setStarRepulsor(position, radius = TUNING.companion.starLightAvoidRadius) {
    this.starRepulsor = { position: position.clone(), radius };
  }

  /** Park the bird at a fixed point (it still bobs and faces the player). */
  holdAt(position, { visible = true } = {}) {
    this.holdPosition = position.clone();
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.group.position.copy(position);
    this.group.visible = visible;
  }

  /** Return to path-leading. Optionally teleport to rejoin the path — the
   *  void sits 600m above the level, and flying down is not a good scene. */
  release(atPosition = null) {
    this.holdPosition = null;
    if (atPosition) {
      this.position.copy(atPosition);
      this.velocity.set(0, 0, 0);
      this.group.position.copy(this.position);
    }
    this.group.visible = true;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  setPath(waypoints) {
    this.path = waypoints;
    this.waypointIndex = 0;
    if (waypoints.length) {
      this.position.copy(waypoints[0]).setY(waypoints[0].y + 2.2);
      this.group.position.copy(this.position);
    }
  }

  fixedUpdate(dt) {
    const c = TUNING.companion;
    if (this.flinchTimer > 0) this.flinchTimer -= dt;

    const target = this.#leadTarget();
    const dist = this.player.position.distanceTo(this.position);

    // Waits when the player falls behind, resumes when they close. It never
    // drags the player forward and never gets left behind permanently.
    if (dist > c.waitDistance) this.mode = 'wait';
    else if (dist < c.resumeDistance) this.mode = 'lead';

    if (this.flinchTimer <= 0) {
      const speed = this.mode === 'wait' ? 0.5 : c.flySpeed;
      _v.copy(target).sub(this.position);
      const d = _v.length();
      if (d > 0.4) {
        _v.divideScalar(d).multiplyScalar(speed);
        this.velocity.lerp(_v, Math.min(1, dt * 2.6));
      } else {
        this.velocity.multiplyScalar(Math.pow(0.2, dt));
      }
    }

    this.#applyRepulsors(dt);

    this.velocity.multiplyScalar(Math.pow(0.55, dt));
    this.position.addScaledVector(this.velocity, dt);

    // Hover bob, and a flap rate that rises with effort.
    this.bobPhase += dt * c.hoverBobSpeed;
    const speed2 = this.velocity.length();
    this.flapPhase += dt * (6 + speed2 * 2.4);

    this.group.position.copy(this.position);
    this.group.position.y += Math.sin(this.bobPhase) * c.hoverBobAmplitude;

    if (speed2 > 0.25) {
      this.facing = Math.atan2(this.velocity.x, this.velocity.z);
    }
    this.group.rotation.y = this.facing;
    this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, -speed2 * 0.045, 5, dt);

    const flap = Math.sin(this.flapPhase) * (0.35 + Math.min(0.7, speed2 * 0.12));
    for (const w of this.wings) w.mesh.rotation.z = w.side * (0.15 + flap);

    // Positional wing-flaps, on the downbeat only.
    if (Math.sin(this.flapPhase) > 0.985 && speed2 > 0.6) {
      this.bus.emit(EVENTS.SFX, { id: 'pigeonFlap', position: this.position });
    }

    // The knight shadow always hangs plumb, whatever the bird is doing. A
    // shadow that banks with the bird would read as the bird's own.
    this.knightShadow.rotation.set(0, -this.group.rotation.y * 0.35, 0);
  }

  /** Stays ahead of the player, and out of the camera's line to them. */
  #leadTarget() {
    const c = TUNING.companion;
    if (this.holdPosition) return this.holdPosition;
    if (!this.path?.length) return this.position;

    // Track the waypoint nearest the player, then lead from the one after it.
    // Scanning rather than incrementing means the bird recovers from a warp,
    // a death respawn, or the player backtracking — all of which left a
    // purely incremental index stranded at the start of the chapter.
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const d = this.player.position.distanceTo(this.path[i]);
      if (d < best) { best = d; nearest = i; }
    }
    this.waypointIndex = Math.min(this.path.length - 1, nearest + 1);
    _v2.copy(this.path[this.waypointIndex]);
    _v2.y += 2.4;
    return _v2;
  }

  #applyRepulsors(dt) {
    // Never block the camera's view of the player.
    const cam = this.engine.resolve('renderer').camera;
    _toCam.copy(this.player.position).sub(cam.position);
    const len = _toCam.length();
    if (len > 0.01) {
      _toCam.divideScalar(len);
      _v.copy(this.position).sub(cam.position);
      const along = _v.dot(_toCam);
      if (along > 0 && along < len) {
        _v.sub(_v2.copy(_toCam).multiplyScalar(along));
        const lateral = _v.length();
        if (lateral < TUNING.companion.cameraAvoidRadius && lateral > 0.001) {
          this.velocity.addScaledVector(
            _v.divideScalar(lateral),
            (TUNING.companion.cameraAvoidRadius - lateral) * 9 * dt
          );
        }
      }
    }

    // TELL 2: it will not enter the star's light. A hard repulsor, strong
    // enough that it visibly takes the long way round rather than crossing.
    if (this.starRepulsor) {
      _v.copy(this.position).sub(this.starRepulsor.position);
      _v.y = 0;
      const d = _v.length();
      if (d < this.starRepulsor.radius && d > 0.001) {
        const push = (this.starRepulsor.radius - d) / this.starRepulsor.radius;
        this.velocity.addScaledVector(_v.divideScalar(d), push * 22 * dt);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
