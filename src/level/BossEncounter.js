import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { StarChamberArena } from './StarChamberArena.js';
import { FogGate } from './FogGate.js';
import { BossController } from '../ai/BossController.js';
import { WingChoice } from '../narrative/WingChoice.js';

/**
 * BossEncounter — ties the arena, the gate, the boss and the retry loop
 * together, and owns the rules about when the fight starts and resets.
 *
 * The retry loop is the important part. Dying re-opens the gate, resets the
 * boss to full, and puts the player back at the checkpoint with charges
 * restored — so a second attempt costs the walk back and nothing else. Souls
 * runs back are tense because of what you might lose on the way, not because
 * the retry itself is fiddly.
 */
export class BossEncounter {
  constructor(engine, { center = new THREE.Vector3(0, 0, -30), radius = 15 } = {}) {
    this.engine = engine;
    this.bus = engine.bus;
    this.player = engine.resolve('player');
    this.center = center.clone();

    this.arena = new StarChamberArena(engine, { center, radius }).build();

    this.boss = new BossController(engine, {
      // Seated slightly below the surface line: it is a thing that lives in
      // the pool, and legs ending exactly at the water plane read as hovering.
      position: center.clone().setY(center.y - 0.34),
      arena: this.arena,
    });
    this.boss.register(engine.resolve('hitboxes'), engine.resolve('lockOn'));

    this.gate = new FogGate(engine, {
      position: center.clone().add(new THREE.Vector3(0, 0, radius + 2.6)),
      facing: 0,
      onEnter: () => this.#startFight(),
    });

    this.active = false;
    this.wingChoice = null;
    this.choiceDelay = 0;

    this.bus.on(EVENTS.PLAYER_DIED, () => this.#onPlayerDied());
    this.bus.on(EVENTS.BOSS_DEFEATED, () => this.#onBossDefeated());
  }

  #startFight() {
    this.active = true;
    this.boss.engage();
    // Confine the camera to the arena for the duration. The dais rim is
    // stonework the camera must not end up behind.
    this.engine.resolve('camera').bounds = {
      center: this.arena.center,
      radius: this.arena.radius + 2.2,
    };
  }

  #releaseCamera() {
    this.engine.resolve('camera').bounds = null;
  }

  #onPlayerDied() {
    if (!this.active) return;
    this.active = false;
    this.#releaseCamera();
    // The reset is deferred so it does not land during the death animation.
    setTimeout(() => {
      this.boss.reset();
      this.gate.reset();
    }, 1600);
  }

  #onBossDefeated() {
    this.active = false;
    this.#releaseCamera();
    this.gate.dissolve();
    this.engine.resolve('state').addCurrency(1200);
    this.engine.resolve('state').setFlag('bossDefeated');
    // A pause before the wings. The player has just won and needs a beat to
    // register it before the chapter asks them for anything.
    this.choiceDelay = 5.0;
  }

  /** Beat 7. Built lazily so the alignment system is guaranteed to exist. */
  #beginWingChoice() {
    if (this.wingChoice) return;
    this.wingChoice = new WingChoice(this.engine, {
      arena: this.arena,
      player: this.player,
      alignment: this.player.alignment,
    });
    this.wingChoice.onResolved = (variant) => {
      this.player.flight?.unlock();
      this.engine.resolve('state').setFlag('wingsResolved');
      this.onWingsResolved?.(variant);
    };
    this.wingChoice.begin();
  }

  fixedUpdate(dt) {
    // Depth is read every step, because it gates movement speed and dodge
    // distance. This is the line that makes the arena a mechanic.
    this.arena.applyWaterTo(this.player);
    this.boss.fixedUpdate(dt);

    if (this.choiceDelay > 0) {
      this.choiceDelay -= dt;
      if (this.choiceDelay <= 0) this.#beginWingChoice();
    }
    this.wingChoice?.fixedUpdate(dt);
  }

  update(dt) {
    this.arena.update(dt);
    this.gate.update(dt);
  }

  /** Debug: skip straight to the wing choice. */
  forceWingChoice() {
    this.player.respawn(this.center.clone().setY(this.center.y + 0.4), Math.PI);
    this.boss.alive = false;
    this.boss.state = 'dead';
    this.boss.mesh.visible = false;
    this.#beginWingChoice();
  }

  /** Debug: warp to the pool's edge and start the fight. */
  forceStart() {
    this.player.respawn(
      this.center.clone().add(new THREE.Vector3(0, 0.4, this.arena.radius - 2)),
      Math.PI
    );
    this.gate.enter();
  }

  dispose() {
    this.wingChoice?.dispose();
    this.boss.dispose();
    this.gate.dispose();
    this.arena.dispose();
  }
}
