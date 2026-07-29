import * as THREE from 'three';
import { buildSkeleton, buildSkinnedGeometry } from '../character/Rig.js';

/**
 * THE DROWNED — the thing in the pool.
 *
 * Reconciles PROJECT.md ("scales like oil, teeth catching star-light") with
 * the concept board (a masked, long-haired figure whose many long limbs unfold
 * from cave water). See DECISIONS.md D10.
 *
 * Six long limbs radiating from a low body, a human torso rising out of the
 * middle, a porcelain mask. The silhouette rule that drives the proportions:
 * every limb has to be separately readable, because the telegraphs are limb
 * positions. So the limbs are long, thin, and widely spaced rather than a
 * dense mass — pause any wind-up and you can count which legs are loaded.
 *
 * Scale: the body sits ~2.4m tall with a ~7m limb span. Against a 1.68m
 * player that reads as large without leaving the frame during the fight.
 */

const legChain = (name, root, spread, forward, splay) => ({
  name: `${name}.coxa`,
  pos: [spread, 0.05, forward],
  children: [{
    // Femur rises OUT and UP, so the joint sits above the body — the raised
    // knee is what makes a spider limb read as a spider limb.
    name: `${name}.femur`,
    pos: [splay * 0.55, 0.95, forward * 0.30],
    children: [{
      name: `${name}.tibia`,
      pos: [splay * 0.75, -0.30, forward * 0.42],
      children: [{ name: `${name}.foot`, pos: [splay * 0.62, -1.45, forward * 0.28] }],
    }],
  }],
});

export const DROWNED_SPEC = {
  name: 'root',
  pos: [0, 0, 0],
  children: [
    {
      name: 'core',
      pos: [0, 1.05, 0],
      children: [
        {
          name: 'torso',
          pos: [0, 0.52, 0],
          children: [
            {
              name: 'chest',
              pos: [0, 0.62, 0],
              children: [
                { name: 'neck', pos: [0, 0.42, 0], children: [{ name: 'head', pos: [0, 0.24, 0] }] },
                {
                  name: 'shoulder.L', pos: [0.30, 0.22, 0],
                  children: [{
                    name: 'arm.L', pos: [0.26, -0.08, 0],
                    children: [{
                      name: 'forearm.L', pos: [0, -0.72, 0],
                      children: [{ name: 'claw.L', pos: [0, -0.68, 0] }],
                    }],
                  }],
                },
                {
                  name: 'shoulder.R', pos: [-0.30, 0.22, 0],
                  children: [{
                    name: 'arm.R', pos: [-0.26, -0.08, 0],
                    children: [{
                      name: 'forearm.R', pos: [0, -0.72, 0],
                      children: [{ name: 'claw.R', pos: [0, -0.68, 0] }],
                    }],
                  }],
                },
              ],
            },
          ],
        },
        // Six limbs: front pair reaching forward, middle pair wide, rear pair back.
        legChain('legA.L', 'core', 0.52, 0.85, 1.0),
        legChain('legA.R', 'core', -0.52, 0.85, -1.0),
        legChain('legB.L', 'core', 0.62, 0.0, 1.15),
        legChain('legB.R', 'core', -0.62, 0.0, -1.15),
        legChain('legC.L', 'core', 0.50, -0.85, 0.95),
        legChain('legC.R', 'core', -0.50, -0.85, -0.95),
      ],
    },
  ],
};

/** Grey box segments. Phase 7 swaps these; the skeleton and clips do not change. */
export const DROWNED_SEGMENTS = (() => {
  const segs = [
    { bone: 'core', to: 'torso', shape: 'box', width: 1.55, depth: 1.95 },
    { bone: 'torso', to: 'chest', shape: 'box', width: 0.72, depth: 0.52 },
    { bone: 'chest', to: 'neck', shape: 'box', width: 0.86, depth: 0.56 },
    { bone: 'neck', to: 'head', shape: 'capsule', radius: 0.11 },
    // The mask: a flat plate, deliberately wider than the skull behind it.
    { bone: 'head', shape: 'box', width: 0.42, depth: 0.14, length: 0.52, offset: [0, 0.18, 0.06] },
  ];
  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1;
    segs.push(
      { bone: `shoulder.${side}`, to: `arm.${side}`, shape: 'capsule', radius: 0.13 },
      { bone: `arm.${side}`, to: `forearm.${side}`, shape: 'capsule', radius: 0.10 },
      { bone: `forearm.${side}`, to: `claw.${side}`, shape: 'capsule', radius: 0.075 },
      { bone: `claw.${side}`, shape: 'cone', radius: 0.07, radiusTop: 0.005, length: 0.30, offset: [0, -0.13, 0] },
    );
    for (const grp of ['legA', 'legB', 'legC']) {
      segs.push(
        { bone: `${grp}.${side}.coxa`, to: `${grp}.${side}.femur`, shape: 'capsule', radius: 0.15 },
        { bone: `${grp}.${side}.femur`, to: `${grp}.${side}.tibia`, shape: 'capsule', radius: 0.115 },
        { bone: `${grp}.${side}.tibia`, to: `${grp}.${side}.foot`, shape: 'cone', radius: 0.10, radiusTop: 0.022 },
      );
    }
  }
  return segs;
})();

/** Long hair: separate strips so it silhouettes as strands, not as a helmet. */
function buildHair(rig, group) {
  const head = rig.byName.get('head');
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14120f,
    roughness: 0.42,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const strands = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const len = 1.5 + Math.sin(i * 2.3) * 0.55;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.10, len, 1, 4), mat);
    strip.position.set(Math.cos(a) * 0.17, 0.10 - len / 2, Math.sin(a) * 0.13 - 0.02);
    strip.rotation.y = -a + Math.PI / 2;
    strip.rotation.x = 0.10 + Math.sin(i) * 0.06;
    strip.castShadow = true;
    strands.add(strip);
  }
  head.add(strands);
  return strands;
}

export function buildDrowned() {
  const rig = buildSkeleton(DROWNED_SPEC);
  const geometry = buildSkinnedGeometry(rig, DROWNED_SEGMENTS);

  const material = new THREE.MeshStandardMaterial({
    color: 0x3a3d42,
    roughness: 0.34,
    metalness: 0.22,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(rig.root);
  mesh.bind(rig.skeleton);

  const group = new THREE.Group();
  group.add(mesh);

  const hair = buildHair(rig, group);

  // The mask is the only bright value on the whole creature — it is what
  // catches the star, and it is where the player's eye goes for the telegraph.
  const mask = new THREE.Mesh(
    new THREE.BoxGeometry(0.40, 0.50, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.28, metalness: 0.0 })
  );
  mask.position.set(0, 0.18, 0.11);
  mask.castShadow = true;
  rig.byName.get('head').add(mask);

  return { mesh, rig, group, hair, mask, material };
}
