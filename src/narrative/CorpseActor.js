import * as THREE from 'three';
import { toonMaterial } from '../render/npr/ToonMaterial.js';
import { buildCharacter } from '../character/Rig.js';
import { AnimationSystem } from '../character/AnimationSystem.js';
import { corpseClip, standUpClip } from '../character/clips/actions.js';

/**
 * The body, as an object in the world rather than as the player.
 *
 * In beat 1 the player is the drifting light; the corpse is something the
 * pigeon drags in and drops. They are two different things, so the corpse gets
 * its own mesh and its own animation system. That separation is also what lets
 * the pigeon drag it in Phase 6 without the player controller being involved.
 *
 * It shares the rig builder and the clip data with the player, so the body the
 * player takes is literally the body they were looking at.
 */
export class CorpseActor {
  constructor(scene) {
    const { mesh, rig } = buildCharacter({
      // A shade warmer and duller than the player's own body, so the thing on
      // the ground and the thing that stands up out of it are distinguishable
      // in the same frame.
      material: toonMaterial({ color: 0x9a9186, bands: 3, rimStrength: 0.4 }),
    });
    this.mesh = mesh;
    this.rig = rig;
    this.anim = new AnimationSystem(rig, null);
    this.anim.register(corpseClip, standUpClip);
    this.anim.play('corpse', { fadeFrames: 0 });

    this.group = new THREE.Group();
    this.group.add(mesh);
    this.group.visible = false;
    scene.add(this.group);
    this.scene = scene;
  }

  place(position, facing = 0) {
    this.group.position.copy(position);
    this.group.rotation.y = facing;
    this.group.visible = true;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  fixedUpdate(dt) {
    if (this.group.visible) this.anim.fixedUpdate(dt);
  }

  dispose() {
    this.scene.remove(this.group);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
