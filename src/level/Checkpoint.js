import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import { ACTION } from '../input/Actions.js';
import { makeGlow } from '../render/procedural/textures.js';

const _v = new THREE.Vector3();

/**
 * Checkpoints and the death loop.
 *
 * Resting restores flask charges, respawns enemies, and holds progress. Death
 * drops your currency where you fell; you may recover it once. Dying again
 * before you do loses the first stain permanently.
 *
 * The bloodstain rule is the one piece of souls design that most needs to be
 * exactly right, because it is what makes a run back tense rather than tedious:
 * the loss has to be real, and it has to be your fault.
 */
export class CheckpointSystem {
  constructor(engine, player) {
    this.engine = engine;
    this.bus = engine.bus;
    this.state = engine.resolve('state');
    this.input = engine.resolve('input');
    this.player = player;
    this.scene = engine.resolve('renderer').scene;

    /** @type {Map<string, {id, position, facing, mesh}>} */
    this.checkpoints = new Map();
    this.active = null;
    this.nearby = null;
    this.bloodstain = null;

    this.respawnTimer = 0;
    this.dying = false;
    this.onRespawn = null;

    this.bus.on(EVENTS.PLAYER_DIED, ({ position }) => this.#onDeath(position));
    this.#buildFade();
  }

  add({ id, position, facing = 0 }) {
    const group = new THREE.Group();
    group.position.copy(position);

    // A low stone marker with a small flame. Nothing grand — it is a place to
    // stop, not a monument.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.52, 0.26, 8),
      new THREE.MeshStandardMaterial({ color: 0x54585e, roughness: 0.95 })
    );
    base.position.y = 0.13;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const spike = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.06, 0.72, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f2c29, roughness: 0.7, metalness: 0.4 })
    );
    spike.position.y = 0.62;
    spike.castShadow = true;
    group.add(spike);

    const flame = makeGlow({ color: 0xffb964, scale: 0.9, opacity: 0.85, power: 2.2 });
    flame.position.y = 1.02;
    group.add(flame);

    const light = new THREE.PointLight(0xffa554, 2.2, 7, 2);
    light.position.y = 1.0;
    group.add(light);

    this.scene.add(group);
    const cp = { id, position: position.clone(), facing, group, flame, light };
    this.checkpoints.set(id, cp);
    return cp;
  }

  fixedUpdate(dt) {
    // Flicker: two out-of-phase sines beat a random walk, which reads as noise.
    const t = performance.now() * 0.001;
    for (const cp of this.checkpoints.values()) {
      const f = 0.82 + Math.sin(t * 7.3) * 0.09 + Math.sin(t * 3.1) * 0.06;
      cp.flame.material.opacity = f;
      cp.flame.scale.setScalar(0.85 + f * 0.16);
      cp.light.intensity = 1.7 + f * 1.1;
    }

    if (this.dying) {
      this.respawnTimer -= dt;
      const t01 = 1 - Math.max(0, this.respawnTimer) / TUNING.progression.respawnFadeSeconds;
      this.fade.style.opacity = String(Math.min(1, t01 * 1.6));
      if (this.respawnTimer <= 0) this.#respawn();
      return;
    }
    if (this.fade.style.opacity !== '0') {
      const cur = parseFloat(this.fade.style.opacity || '0');
      this.fade.style.opacity = String(Math.max(0, cur - dt * 1.4));
    }

    this.#updateProximity();
    this.#updateBloodstain();
  }

  #updateProximity() {
    let found = null;
    for (const cp of this.checkpoints.values()) {
      if (this.player.position.distanceTo(cp.position) < 2.4) { found = cp; break; }
    }
    if (found !== this.nearby) {
      this.nearby = found;
      this.bus.emit(EVENTS.INTERACT_AVAILABLE, found ? { id: found.id, label: 'rest' } : null);
    }
    if (found && this.input.actions[ACTION.INTERACT].pressed && this.player.canAct()) {
      this.rest(found);
    }
  }

  rest(cp) {
    this.active = cp;
    this.state.setCheckpoint(cp.id);
    this.player.vitals.refill();
    this.player.stamina.refill();
    this.player.refillFlask();
    this.bus.emit(EVENTS.CHECKPOINT_RESTED, { id: cp.id });
    this.bus.emit(EVENTS.SFX, { id: 'rest', position: cp.position });
  }

  #onDeath(position) {
    this.dying = true;
    this.respawnTimer = TUNING.progression.respawnFadeSeconds;
    const lost = this.state.dropCurrency(position.toArray(), this.state.zone);
    if (lost) this.#clearBloodstain();
    if (this.state.droppedCurrency) this.#spawnBloodstain(position);
  }

  #respawn() {
    this.dying = false;
    const cp = this.active ?? this.checkpoints.values().next().value;
    const pos = cp ? cp.position : new THREE.Vector3(0, 1, 0);
    this.player.respawn(pos.clone().setY(pos.y + 0.05), cp?.facing ?? 0);
    this.onRespawn?.(cp);
    this.bus.emit(EVENTS.MUSIC_CUE, { id: 'respawn' });
  }

  #spawnBloodstain(position) {
    this.#clearBloodstain();
    const g = new THREE.Group();
    g.position.copy(position).setY(position.y + 0.05);
    const glow = makeGlow({ color: 0xd9c98a, scale: 1.5, opacity: 0.5, power: 2.8 });
    g.add(glow);
    this.scene.add(g);
    this.bloodstain = { group: g, glow, position: g.position };
  }

  #clearBloodstain() {
    if (!this.bloodstain) return;
    this.scene.remove(this.bloodstain.group);
    this.bloodstain = null;
  }

  #updateBloodstain() {
    if (!this.bloodstain || !this.state.droppedCurrency) return;
    const t = performance.now() * 0.001;
    this.bloodstain.glow.material.opacity = 0.38 + Math.sin(t * 1.9) * 0.14;
    this.bloodstain.group.position.y = this.bloodstain.position.y;

    if (this.player.position.distanceTo(this.bloodstain.position) < 1.6) {
      const amount = this.state.recoverCurrency();
      this.#clearBloodstain();
      this.bus.emit(EVENTS.SFX, { id: 'recover' });
      this.bus.emit(EVENTS.DIALOGUE_LINE, { speaker: '', text: `${amount} recovered`, duration: 2.2 });
    }
  }

  #buildFade() {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:30;transition:opacity .1s linear';
    document.getElementById('ui-root').appendChild(el);
    this.fade = el;

    const label = document.createElement('div');
    label.textContent = 'YOU DIED';
    label.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:400 34px/1 ui-serif,Georgia,serif;letter-spacing:.42em;text-indent:.42em;' +
      'color:#8c2f28;opacity:0;pointer-events:none;z-index:31;transition:opacity .8s ease';
    document.getElementById('ui-root').appendChild(label);
    this.deathLabel = label;

    this.bus.on(EVENTS.PLAYER_DIED, () => {
      label.style.opacity = '1';
      setTimeout(() => { label.style.opacity = '0'; }, 2600);
    });
  }

  dispose() {
    this.fade.remove();
    this.deathLabel.remove();
    for (const cp of this.checkpoints.values()) this.scene.remove(cp.group);
    this.#clearBloodstain();
  }
}
