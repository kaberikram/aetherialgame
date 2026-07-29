import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { VARIANT } from '../core/GameState.js';
import { makeGlow } from '../render/procedural/textures.js';

const _v = new THREE.Vector3();

/**
 * Beat 7. The wings.
 *
 * PROJECT.md is unambiguous: no UI labels, no "good" or "evil" framing,
 * irreversible. So the choice is not a menu. Two forms rise out of the water
 * on opposite sides of the dais and the player walks into one. There is no
 * prompt, no cursor, no confirm step — the commitment is a movement, and the
 * only description the game ever offers is the shape itself.
 *
 * Then the chamber changes. Light raises the illumination and the star burns
 * harder; dark dims the star and deepens the shadows until the far wall is
 * gone. Same room, two rooms.
 */
export class WingChoice {
  constructor(engine, { arena, player, alignment }) {
    this.engine = engine;
    this.bus = engine.bus;
    this.scene = engine.resolve('renderer').scene;
    this.state = engine.resolve('state');
    this.zones = engine.resolve('zones');
    this.arena = arena;
    this.player = player;
    this.alignment = alignment;

    this.phase = 'idle';
    this.timer = 0;
    this.chosen = null;
    this.onResolved = null;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // The chamber's baseline, captured so the reaction is a real delta from
    // whatever the lighting happened to be rather than an absolute reset.
    this.baseStarIntensity = arena.star.intensity;
    this.starTarget = this.baseStarIntensity;
    this.ambientScale = 1;
    this.ambientTarget = 1;
  }

  /** Called once the boss is dead and the player has had a moment. */
  begin() {
    if (this.phase !== 'idle') return;
    this.phase = 'rising';
    this.timer = 0;

    const c = this.arena.center;
    const offset = this.arena.radius * 0.52;

    this.forms = [
      this.#buildForm('light', new THREE.Vector3(c.x - offset, c.y + 1.1, c.z)),
      this.#buildForm('dark', new THREE.Vector3(c.x + offset, c.y + 1.1, c.z)),
    ];

    this.bus.emit(EVENTS.ALIGNMENT_CHOICE_OFFERED, { slot: 'wings' });
    this.bus.emit(EVENTS.MUSIC_CUE, { id: 'wingChoice' });
    // The only line, and it names nothing.
    this.bus.emit(EVENTS.DIALOGUE_LINE, {
      speaker: '', text: 'Warmth, in your back. Something wants out.', duration: 5.0,
    });
  }

  /**
   * A form is a silhouette of the wings it will become, made of light, hanging
   * above the water. Deliberately no pedestal, no rune circle, no colour-coded
   * aura — the only information is the shape.
   */
  #buildForm(variant, position) {
    const g = new THREE.Group();
    g.position.copy(position);
    g.position.y -= 2.2; // rises into place

    const isLight = variant === 'light';
    const mat = new THREE.MeshBasicMaterial({
      color: isLight ? 0xffe2ab : 0x6b4b8f,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    // Feathered fan versus membrane web, at silhouette scale.
    for (const side of [-1, 1]) {
      if (isLight) {
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const len = 2.5 - t * 0.9;
          const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.19 - t * 0.05, len), mat);
          blade.position.set(side * (0.32 + t * 1.35), 0.4 + t * 0.55, 0);
          blade.rotation.z = side * (-0.34 - t * 0.85);
          g.add(blade);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          const len = 2.7 - t * 0.75;
          const finger = new THREE.Mesh(new THREE.PlaneGeometry(0.075, len), mat);
          finger.position.set(side * (0.28 + t * 1.5), 0.3 - t * 0.75, 0);
          finger.rotation.z = side * (-0.22 - t * 1.05);
          g.add(finger);
          if (i < 3) {
            const web = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.5 - t * 0.4), mat);
            web.position.set(side * (0.85 + t * 1.2), 0.05 - t * 0.7, 0);
            web.rotation.z = side * (-0.5 - t * 0.7);
            g.add(web);
          }
        }
      }
    }

    const halo = makeGlow({
      color: isLight ? 0xffdca0 : 0x7a4fa8,
      scale: 4.6, opacity: 0, power: 3.0,
    });
    g.add(halo);

    const light = new THREE.PointLight(isLight ? 0xffd79a : 0x8258b8, 0, 20, 1.7);
    g.add(light);

    this.group.add(g);
    return { variant, group: g, material: mat, halo, light, home: position.clone() };
  }

  fixedUpdate(dt) {
    switch (this.phase) {
      case 'rising': this.#updateRising(dt); break;
      case 'offered': this.#updateOffered(dt); break;
      case 'taking': this.#updateTaking(dt); break;
    }
    this.#updateChamber(dt);
  }

  #updateRising(dt) {
    this.timer += dt;
    const t = Math.min(1, this.timer / 3.4);
    const eased = t * t * (3 - 2 * t);
    for (const f of this.forms) {
      f.group.position.y = THREE.MathUtils.lerp(f.home.y - 2.2, f.home.y, eased);
      f.material.opacity = eased * 0.62;
      f.halo.material.opacity = eased * 0.30;
      f.light.intensity = eased * 7;
      if (this.timer < 0.1) this.arena.burst(f.home, 0.5);
    }
    if (t >= 1) {
      this.phase = 'offered';
      this.timer = 0;
    }
  }

  #updateOffered(dt) {
    this.timer += dt;
    const t = performance.now() * 0.001;

    for (const f of this.forms) {
      f.group.position.y = f.home.y + Math.sin(t * 0.8 + (f.variant === 'dark' ? 2.1 : 0)) * 0.16;
      f.group.rotation.y += dt * (f.variant === 'light' ? 0.18 : -0.24);

      // Each brightens as the player nears it, so approach reads as intent
      // before the commitment lands. Still nothing named.
      const d = this.player.position.distanceTo(f.home);
      const near = THREE.MathUtils.clamp(1 - (d - 2.2) / 9, 0, 1);
      f.material.opacity = 0.46 + near * 0.46;
      f.halo.material.opacity = 0.22 + near * 0.42;
      f.light.intensity = 5 + near * 16;

      if (d < 2.3) this.#take(f);
    }
  }

  #take(form) {
    this.phase = 'taking';
    this.timer = 0;
    this.chosen = form;

    // Irreversible. GameState refuses a second resolution of the same slot.
    this.state.resolveSlot('wings', form.variant === 'light' ? VARIANT.LIGHT : VARIANT.DARK);

    for (const f of this.forms) {
      if (f !== form) f.group.visible = false;
    }

    this.starTarget = form.variant === 'light'
      ? this.baseStarIntensity * 1.85
      : this.baseStarIntensity * 0.24;
    this.ambientTarget = form.variant === 'light' ? 2.1 : 0.35;

    this.engine.resolve('camera').addShake(0.9);
    this.arena.burst(this.player.position, 1.4);
    this.bus.emit(EVENTS.SFX, { id: 'wingBurst' });
    this.bus.emit(EVENTS.MUSIC_CUE, { id: form.variant === 'light' ? 'wingsLight' : 'wingsDark' });
  }

  #updateTaking(dt) {
    this.timer += dt;
    const t = Math.min(1, this.timer / 1.5);

    // The form collapses into the player's back.
    _v.copy(this.player.position).setY(this.player.position.y + 1.35);
    this.chosen.group.position.lerp(_v, Math.min(1, dt * 5));
    this.chosen.group.scale.setScalar(Math.max(0.01, 1 - t));
    this.chosen.material.opacity = (1 - t) * 0.9;
    this.chosen.halo.material.opacity = (1 - t) * 0.6;
    this.chosen.light.intensity = (1 - t) * 22;

    if (t >= 1) {
      this.phase = 'done';
      this.chosen.group.visible = false;
      this.alignment.assemble('wings');
      this.bus.emit(EVENTS.DIALOGUE_LINE, {
        speaker: '', text: 'Seven trials remain.', duration: 4.5,
      });
      this.onResolved?.(this.chosen.variant);
    }
  }

  /**
   * The chamber's reaction. This is the line PROJECT.md cares most about:
   * "Same room, two different rooms." So it is not a tint — the star's actual
   * output changes, which moves every shadow in the space, and the ambient
   * scale moves with it.
   */
  #updateChamber(dt) {
    const star = this.arena.star;
    if (!star) return;
    star.userData.reactTarget = this.starTarget;

    this.ambientScale = THREE.MathUtils.damp(this.ambientScale, this.ambientTarget, 0.85, dt);
    if (this.zones) this.zones.reactionScale = this.ambientScale;
  }

  get resolved() {
    return this.phase === 'done';
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
