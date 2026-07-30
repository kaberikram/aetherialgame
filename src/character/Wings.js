import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeGlow } from '../render/procedural/textures.js';

const _one = new THREE.Vector3(1, 1, 1);

/**
 * The wings — the only slot Chapter 1 resolves.
 *
 * PROJECT.md is explicit that winged forms follow Garuda and Kinnara rather
 * than European angels: sharp feather structure, gold leaf over dark wood
 * tones. So the light wing is NOT a soft dove wing — the primaries are hard,
 * angular blades laid in a fan, and the coverts are gold over near-black.
 *
 * The dark wing is leathery and bat-like: a membrane stretched between four
 * splayed finger-bones, with the trailing edge notched.
 *
 * The mechanical difference is elsewhere (TUNING.alignment); this file only
 * builds the shapes and the light they emit or absorb.
 */

/** One angular primary feather: a tapered, slightly curved blade. */
function featherGeometry(length, width, curve) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(width * 0.55, length * 0.30, width * 0.42, length * 0.70);
  shape.quadraticCurveTo(width * 0.30, length * 0.94, 0, length);
  shape.quadraticCurveTo(-width * 0.22, length * 0.90, -width * 0.28, length * 0.62);
  shape.quadraticCurveTo(-width * 0.34, length * 0.26, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width * 0.10, bevelEnabled: true, bevelSize: width * 0.03,
    bevelThickness: width * 0.03, bevelSegments: 1, curveSegments: 4,
  });
  // A slight sweep along the length, so a fan of these reads as a wing rather
  // than a row of knives.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / length;
    pos.setZ(i, pos.getZ(i) + Math.sin(t * Math.PI * 0.5) * curve);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * LIGHT — broad, feathered, radiant. Throws real illumination.
 */
export function buildLightWings() {
  const group = new THREE.Group();

  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a55e, roughness: 0.34, metalness: 0.78,
    emissive: 0x6b4d18, emissiveIntensity: 0.30,
  });
  const darkWood = new THREE.MeshStandardMaterial({
    color: 0x241c14, roughness: 0.72, metalness: 0.12,
  });
  // Emissive kept low deliberately. These feathers are lit by a real lamp, and
  // a pale albedo plus a strong emissive plus that lamp plus bloom is four
  // ways of saying "bright" stacked on one surface — the result is a white
  // blob with no internal value, which is exactly the rubric's grayscale
  // failure. The layered feather structure has to survive the light.
  const pale = new THREE.MeshStandardMaterial({
    color: 0xf2ead8, roughness: 0.46, metalness: 0.06,
    emissive: 0xbfa877, emissiveIntensity: 0.20,
  });

  /**
   * Two pairs, not one. The concept board shows a four-winged Garuda-derived
   * form: a long primary pair and a shorter upper pair set behind and above.
   * The upper pair is what stops the silhouette reading as a generic angel.
   *
   * Both pairs are named `wing.L`/`wing.R` so Alignment's flap animation drives
   * them together; they fan from different origins, so they do not overlap.
   */
  const buildPair = ({ scale, offset, primaries, span }) => {
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.name = side < 0 ? 'wing.R' : 'wing.L';
      wing.position.copy(offset);
      wing.scale.setScalar(scale);

      // Arm bones of the wing: humerus out, radius forward, a hard elbow.
      const parts = [];
      const hum = new THREE.CylinderGeometry(0.055, 0.075, 0.62, 6);
      hum.rotateZ(Math.PI / 2);
      hum.translate(side * 0.31, 0, 0);
      parts.push(hum);
      const rad = new THREE.CylinderGeometry(0.038, 0.052, 0.72, 6);
      rad.rotateZ(Math.PI / 2);
      rad.rotateY(side * 0.45);
      rad.translate(side * 0.94, 0.16, -0.14);
      parts.push(rad);
      const boneMesh = new THREE.Mesh(mergeGeometries(parts, false), darkWood);
      boneMesh.castShadow = true;
      wing.add(boneMesh);

      // Feathers are baked into one geometry per material rather than kept as
      // separate meshes. Nothing articulates below the wing group — the whole
      // fan rotates together — so seventeen meshes per wing bought nothing and
      // cost sixty-odd draw calls at the exact moment the chapter is trying to
      // look its best.
      const goldParts = [];
      const paleParts = [];
      const bake = (geo, pos, rot) => {
        const m4 = new THREE.Matrix4().compose(
          pos, new THREE.Quaternion().setFromEuler(rot), _one
        );
        return geo.applyMatrix4(m4);
      };

      // Primaries in a fan. Angular, not soft.
      for (let i = 0; i < primaries; i++) {
        const t = i / (primaries - 1);
        const len = span - t * span * 0.36;
        const geo = bake(
          featherGeometry(len, 0.20 - t * 0.05, 0.10),
          new THREE.Vector3(side * (0.5 + t * 0.86), 0.06 + t * 0.16, -0.12 - t * 0.10),
          new THREE.Euler(-0.16 - t * 0.14, side * (0.12 + t * 0.30), side * (-0.30 - t * 0.95))
        );
        (i % 3 === 0 ? goldParts : paleParts).push(geo);
      }

      // Coverts: a shorter overlapping row that hides the roots.
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        goldParts.push(bake(
          featherGeometry(0.52 - t * 0.14, 0.13, 0.05),
          new THREE.Vector3(side * (0.36 + t * 0.52), 0.13, 0.02),
          new THREE.Euler(-0.42, 0, side * (-0.5 - t * 0.6))
        ));
      }

      for (const [parts, mat] of [[goldParts, gold], [paleParts, pale]]) {
        if (!parts.length) continue;
        const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
        mesh.castShadow = true;
        wing.add(mesh);
      }

      group.add(wing);
    }
  };

  buildPair({ scale: 1, offset: new THREE.Vector3(0, 0, 0), primaries: 10, span: 1.72 });
  buildPair({ scale: 0.62, offset: new THREE.Vector3(0, 0.42, -0.26), primaries: 7, span: 1.5 });

  // Real illumination. PROJECT.md says the light wings brighten the chamber,
  // so this is an actual light source, not an emissive texture.
  //
  // It sits BEHIND and ABOVE the feathers rather than inside them. At the old
  // position it was ~0.2m from the primaries, and inverse-square at that range
  // blew them to flat white while barely reaching the room it is supposed to
  // brighten. Back here it rim-lights the feathers and the falloff has enough
  // distance to do its actual job.
  const glow = new THREE.PointLight(0xffe6b0, 9, 24, 1.35);
  glow.position.set(0, 0.55, -0.85);
  group.add(glow);
  group.add(makeGlow({ color: 0xffdca0, scale: 3.4, opacity: 0.18, power: 3.0 }));

  group.userData.light = glow;
  group.userData.variant = 'light';
  return group;
}

/**
 * DARK — leathery, sharp, bat-like. Absorbs light.
 */
export function buildDarkWings() {
  const group = new THREE.Group();

  const membrane = new THREE.MeshStandardMaterial({
    color: 0x14100f, roughness: 0.58, metalness: 0.06,
    side: THREE.DoubleSide, transparent: true, opacity: 0.94,
  });
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0x2b2420, roughness: 0.52, metalness: 0.22,
  });

  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side < 0 ? 'wing.R' : 'wing.L';

    // Four splayed finger-bones. The membrane is stretched between them.
    const tips = [];
    const parts = [];
    for (let f = 0; f < 4; f++) {
      const t = f / 3;
      const len = 1.95 - t * 0.55;
      const spread = -0.20 - t * 1.02;
      const rise = 0.42 - t * 0.86;

      const dir = new THREE.Vector3(side * Math.cos(spread), Math.sin(spread) + rise * 0.5, -0.22 - t * 0.36).normalize();
      const tip = dir.clone().multiplyScalar(len).add(new THREE.Vector3(side * 0.26, 0.08, 0));
      tips.push(tip);

      const seg = new THREE.CylinderGeometry(0.028, 0.052, len, 5);
      const mid = tip.clone().multiplyScalar(0.5).add(new THREE.Vector3(side * 0.13, 0.04, 0));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      seg.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      parts.push(seg);

      // A hooked claw at each finger tip — the sharp part of "sharp".
      const claw = new THREE.ConeGeometry(0.030, 0.16, 4);
      claw.applyMatrix4(new THREE.Matrix4().compose(tip, q, new THREE.Vector3(1, 1, 1)));
      parts.push(claw);
    }
    const boneMesh = new THREE.Mesh(mergeGeometries(parts, false), boneMat);
    boneMesh.castShadow = true;
    wing.add(boneMesh);

    // Membrane panels between consecutive fingers, with a notched trailing edge.
    const root = new THREE.Vector3(side * 0.22, 0.04, 0.04);
    for (let f = 0; f < tips.length - 1; f++) {
      const a = tips[f];
      const b = tips[f + 1];
      const sag = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.20, 0.08));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([
        root.x, root.y, root.z, a.x, a.y, a.z, sag.x, sag.y, sag.z,
        root.x, root.y, root.z, sag.x, sag.y, sag.z, b.x, b.y, b.z,
      ], 3));
      geo.computeVertexNormals();
      const panel = new THREE.Mesh(geo, membrane);
      panel.castShadow = true;
      wing.add(panel);
    }

    group.add(wing);
  }

  // Absorbs light. Three.js has no negative light, so the effect is delivered
  // by ZoneManager dimming the chamber and by the membrane being near-black —
  // see WingChoice, which drives the star down when this branch is taken.
  group.add(makeGlow({ color: 0x1a0f22, scale: 3.0, opacity: 0.42, power: 2.4 }));

  group.userData.variant = 'dark';
  return group;
}

export function buildWings(variant) {
  return variant === 'light' ? buildLightWings() : buildDarkWings();
}
