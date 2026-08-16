import * as THREE from 'three';

/**
 * InkEdges — the black line work over the cel shading.
 *
 * ## Why merged EdgesGeometry, and not the two usual answers
 *
 * **Inverted hull** (a back-faced copy pushed out along the normal) is the
 * standard trick and it is wrong for this game. It relies on shared, averaged
 * vertex normals, and a blockout is made of boxes — whose normals are per-face
 * and point in three different directions at every corner. The shell tears
 * open at exactly the places a box is most readable. It is also one extra
 * draw call and a full extra vertex load per object.
 *
 * **A depth/normal edge-detect post pass** works, but it means reintroducing
 * a fullscreen chain and its render targets, which is the thing the frame was
 * drowning in. Paying for a G-buffer to redraw lines we already know the
 * position of is backwards.
 *
 * `EdgesGeometry` knows where the creases are because it has the topology.
 * It gives us the silhouette *and* the interior architectural lines — which is
 * the more ink-and-paint read anyway; hand-drawn line work does not stop at
 * the outline. And because every line in a zone can be merged into one buffer,
 * a whole zone's ink is a single draw call.
 */

/**
 * Merges the edge lines of many meshes into one LineSegments.
 *
 * Vertices are baked into world space, so the result is parented at the origin
 * and never needs to track its sources. Blockout geometry is static; if that
 * ever stops being true, the moving object should be left out of the merge and
 * given its own.
 *
 * @param {THREE.Object3D[]} meshes
 * @param {object} [opts]
 * @param {number} [opts.color]     line colour
 * @param {number} [opts.threshold] crease angle in degrees; edges flatter than
 *                                  this are not drawn
 * @returns {THREE.LineSegments|null} null when there is nothing to draw
 */
export function buildInkEdges(meshes, { color = 0x0a0a0c, threshold = 24 } = {}) {
  const positions = [];
  const v = new THREE.Vector3();

  for (const mesh of meshes) {
    if (!mesh?.isMesh || !mesh.geometry) continue;
    if (mesh.userData.noInk) continue;

    mesh.updateMatrixWorld(true);
    const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
    const attr = edges.getAttribute('position');
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    // EdgesGeometry is a throwaway: it exists to be read once and merged.
    edges.dispose();
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, fog: true })
  );
  lines.name = 'inkEdges';
  // Depth-tested, so lines behind stone are correctly hidden. Ink that draws
  // through the walls reads as a wireframe debug view, not as line art.
  lines.material.depthTest = true;
  lines.castShadow = false;
  lines.receiveShadow = false;
  lines.matrixAutoUpdate = false;
  return lines;
}

/**
 * Collects the meshes under a root that should carry ink, in one traversal.
 * Skips lines, sprites, anything flagged `noInk`, and anything already ink.
 */
export function inkable(root) {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noInk && o.name !== 'inkEdges') out.push(o);
  });
  return out;
}
