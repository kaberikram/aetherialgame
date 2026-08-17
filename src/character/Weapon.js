import * as THREE from 'three';
import { toonMaterial } from '../render/npr/ToonMaterial.js';

/**
 * The sword from beat 5.
 *
 * PROJECT.md is specific about this: "Simple hilt, cold steel, no glow, no
 * rarity color. A tool, not a reward." So it is deliberately plain — a
 * straight blade, a plain crossguard, a wrapped grip. Nothing about it says
 * loot. The player should register it as something a dead warrior was using,
 * not something the game is giving them.
 *
 * Built as a child of hand.R, oriented so the blade runs down the −Y the hand
 * bone already points along, which is also the axis the hitbox capsule uses.
 */
export function buildSword() {
  const group = new THREE.Group();

  // "Cold steel, no glow, no rarity colour" under cel shading means a tight,
  // bright rim and nothing else. There is no specular highlight in this
  // renderer to carry "metal", so the rim does that job: four bands and a
  // high rimPower reads as a hard edge catching light, which is what a blade
  // is. Emissive would read as a magic weapon, which PROJECT.md forbids here.
  const steel = toonMaterial({ color: 0x8f959c, bands: 4, rim: 0xdfe6ee, rimStrength: 0.85, rimPower: 3.6 });
  const dark = toonMaterial({ color: 0x2e2b28, bands: 3, rimStrength: 0.45 });
  const leather = toonMaterial({ color: 0x4a3d33, bands: 3, rimStrength: 0.3 });

  // Blade: 0.92m, tapering, with a shallow fuller implied by the flat section.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.86, 0.014), steel);
  blade.position.set(0, -0.56, 0);
  group.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.031, 0.13, 4), steel);
  tip.position.set(0, -1.045, 0);
  tip.rotation.y = Math.PI / 4;
  tip.rotation.x = Math.PI;
  group.add(tip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.030, 0.038), dark);
  guard.position.set(0, -0.125, 0);
  group.add(guard);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.19, 6), leather);
  grip.position.set(0, -0.03, 0);
  group.add(grip);

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), dark);
  pommel.position.set(0, 0.075, 0);
  group.add(pommel);

  for (const child of group.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }

  // The hand bone's −Y already points down the arm; rotating slightly forward
  // sets the blade at the angle a hand actually holds a sword at rest.
  group.rotation.x = -0.22;
  group.position.set(0, -0.11, 0.02);
  return group;
}
