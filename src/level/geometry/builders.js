import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from '../../render/procedural/textures.js';

/**
 * Procedural level geometry. Pure functions: parameters in, BufferGeometry out.
 * Nothing here touches the scene, lighting or materials.
 *
 * The architectural vocabulary is Southeast Asian and the builders are named
 * for the real things: candi tiers, stupa, kala face, naga balustrade, banyan
 * roots. That is deliberate — if the primitives are called "tower" and "arch"
 * the result drifts toward generic Western fantasy by default, which the rubric
 * explicitly fails.
 */

const _v = new THREE.Vector3();

/**
 * A cave tunnel: a tube swept along a path, with noise-displaced walls and an
 * open floor band so the player has somewhere flat to walk.
 *
 * @param {THREE.Curve} curve centreline
 * @param {(t:number)=>number} radiusAt
 */
export function caveTunnel(curve, radiusAt, {
  segments = 90,
  radial = 14,
  roughness = 0.30,
  floorFlatten = 0.62,
  seed = 7,
} = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const frames = curve.computeFrenetFrames(segments, false);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const N = frames.normals[Math.min(i, segments - 1)];
    const B = frames.binormals[Math.min(i, segments - 1)];
    const baseR = radiusAt(t);

    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);

      // Noise on the wall, but suppressed near the floor so footing is fair.
      const n = fbm(t * 6 + j * 0.31, j * 0.27, { octaves: 3, frequency: 2.4, seed });
      const down = Math.max(0, -Math.sin(a)); // 1 at the floor, 0 at the ceiling
      const wobble = 1 + (n - 0.5) * roughness * (1 - down * 0.8);

      let r = baseR * wobble;
      // Flatten the bottom of the tube into a walkable floor.
      const y = sin * r;
      const flatY = Math.max(y, -baseR * floorFlatten);

      _v.copy(point).addScaledVector(N, cos * r).addScaledVector(B, flatY);
      positions.push(_v.x, _v.y, _v.z);
      normals.push(-cos, -sin, 0);
      uvs.push(t * 8, j / radial);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A candi tier: the stepped, battered stone body of a Javanese temple level.
 * Each tier is a box with a recessed band and a projecting cornice, which is
 * what gives candi stonework its horizontal banding at a distance.
 */
export function candiTier({ width, depth, height, batter = 0.06, cornice = 0.16 }) {
  const parts = [];
  const topW = width * (1 - batter);
  const topD = depth * (1 - batter);

  const body = new THREE.CylinderGeometry(1, 1, height, 4, 1);
  body.rotateY(Math.PI / 4);
  body.scale(1, 1, 1);
  // Scale the top and bottom rings separately to get the batter.
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + height / 2) / height;
    const w = THREE.MathUtils.lerp(width, topW, t) / Math.SQRT2;
    const d = THREE.MathUtils.lerp(depth, topD, t) / Math.SQRT2;
    pos.setX(i, pos.getX(i) * w);
    pos.setZ(i, pos.getZ(i) * d);
  }
  body.computeVertexNormals();
  parts.push(body);

  const cor = new THREE.BoxGeometry(topW + cornice * 2, cornice, topD + cornice * 2);
  cor.translate(0, height / 2 + cornice / 2, 0);
  parts.push(cor);

  const base = new THREE.BoxGeometry(width + cornice * 2.2, cornice * 1.3, depth + cornice * 2.2);
  base.translate(0, -height / 2 - cornice * 0.65, 0);
  parts.push(base);

  return mergeGeometries(parts, false);
}

/**
 * The sunken candi from the concept board: a stepped tower of diminishing
 * tiers on a wide plinth, topped by a stupa.
 */
export function candiTower({ tiers = 5, baseWidth = 14, totalHeight = 26, seed = 3 } = {}) {
  const parts = [];
  let y = 0;

  // Plinth: wide, low, with steps up the front face.
  const plinth = new THREE.BoxGeometry(baseWidth * 1.55, 1.5, baseWidth * 1.55);
  plinth.translate(0, 0.75, 0);
  parts.push(plinth);
  y = 1.5;

  for (let i = 0; i < 4; i++) {
    const s = new THREE.BoxGeometry(baseWidth * 0.34, 0.30, 0.9);
    s.translate(0, 1.5 - i * 0.30 - 0.15, baseWidth * 0.78 + i * 0.9);
    parts.push(s);
  }

  const tierHeight = (totalHeight - 1.5) / (tiers + 1.4);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const w = baseWidth * (1 - t * 0.62);
    const h = tierHeight * (1 - t * 0.16);
    const tier = candiTier({ width: w, depth: w, height: h });
    tier.translate(0, y + h / 2, 0);
    parts.push(tier);

    // Recessed niches on each face, the shadow slots that read as windows.
    if (i < tiers - 1) {
      for (let f = 0; f < 4; f++) {
        const a = (f / 4) * Math.PI * 2;
        const niche = new THREE.BoxGeometry(w * 0.20, h * 0.46, 0.5);
        niche.translate(0, y + h * 0.52, w * 0.5 - 0.1);
        niche.rotateY(a);
        parts.push(niche);
      }
    }
    y += h + 0.21;
  }

  // Stupa finial: bell then a squared harmika, per Borobudur-family profiles.
  const bell = new THREE.SphereGeometry(baseWidth * 0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bell.translate(0, y + baseWidth * 0.03, 0);
  parts.push(bell);
  const harmika = new THREE.BoxGeometry(baseWidth * 0.14, baseWidth * 0.07, baseWidth * 0.14);
  harmika.translate(0, y + baseWidth * 0.10, 0);
  parts.push(harmika);

  return mergeGeometries(parts, false);
}

/**
 * A kala face — the guardian mask set over a doorway. Bulging brow, no lower
 * jaw, splayed hands at the corners. This one shape does more to place the
 * architecture geographically than anything else in the kit.
 */
export function kalaFace({ width = 2.4, height = 1.8 } = {}) {
  const parts = [];

  const brow = new THREE.BoxGeometry(width, height * 0.30, 0.55);
  brow.translate(0, height * 0.35, 0);
  parts.push(brow);

  // Bulging eyes.
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(width * 0.11, 10, 8);
    eye.translate(s * width * 0.26, height * 0.14, 0.28);
    parts.push(eye);
    const bulge = new THREE.BoxGeometry(width * 0.28, height * 0.16, 0.42);
    bulge.translate(s * width * 0.26, height * 0.34, 0.10);
    parts.push(bulge);
  }

  // Upper teeth only. The absent lower jaw is the defining feature.
  for (let i = 0; i < 7; i++) {
    const t = (i / 6 - 0.5) * width * 0.82;
    const tooth = new THREE.ConeGeometry(width * 0.05, height * 0.20, 4);
    tooth.rotateX(Math.PI);
    tooth.translate(t, -height * 0.10, 0.24);
    parts.push(tooth);
  }

  // Splayed hands at the lower corners.
  for (const s of [-1, 1]) {
    const hand = new THREE.BoxGeometry(width * 0.16, height * 0.30, 0.34);
    hand.translate(s * width * 0.46, -height * 0.14, 0.16);
    parts.push(hand);
  }

  const crown = new THREE.BoxGeometry(width * 1.08, height * 0.14, 0.6);
  crown.translate(0, height * 0.55, 0);
  parts.push(crown);

  return mergeGeometries(parts, false);
}

/**
 * A naga balustrade: the serpent whose body forms the handrail of a temple
 * stair, head reared at the bottom step.
 */
export function nagaBalustrade({ length = 8, height = 1.0, drop = 3.2 } = {}) {
  const parts = [];
  const segs = 16;

  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const r = THREE.MathUtils.lerp(0.20, 0.32, t);
    const seg = new THREE.CylinderGeometry(r, r * 1.05, length / segs + 0.06, 6);
    seg.rotateX(Math.PI / 2);
    seg.translate(0, height + Math.sin(t * Math.PI) * 0.12 - t * drop, (t - 0.5) * length);
    parts.push(seg);
  }

  // The reared head: a wedge with a fanned hood behind it.
  const head = new THREE.ConeGeometry(0.42, 1.1, 5);
  head.rotateX(-Math.PI * 0.35);
  head.translate(0, height - drop + 0.55, length * 0.5 + 0.5);
  parts.push(head);

  const hood = new THREE.BoxGeometry(1.5, 1.35, 0.20);
  hood.translate(0, height - drop + 0.85, length * 0.5 + 0.16);
  parts.push(hood);

  return mergeGeometries(parts, false);
}

/**
 * Banyan roots breaking masonry: tapering tubes that hang from an anchor
 * point, kink partway down, and splay where they meet the ground.
 */
export function banyanRoots({ count = 7, height = 6, spread = 2.4, seed = 11 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + fbm(i, 0, { seed }) * 1.4;
    const r = spread * (0.35 + fbm(i * 3.1, 1, { seed }) * 0.9);
    const h = height * (0.55 + fbm(i * 1.7, 2, { seed }) * 0.7);
    const kink = 0.35 + fbm(i * 2.3, 3, { seed }) * 0.3;

    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * r * 0.25, -h * kink, Math.sin(a) * r * 0.25),
      new THREE.Vector3(Math.cos(a) * r * 0.8, -h * 0.78, Math.sin(a) * r * 0.8),
      new THREE.Vector3(Math.cos(a) * r, -h, Math.sin(a) * r),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 10, 0.16 + fbm(i, 4, { seed }) * 0.12, 5, false);
    parts.push(tube);

    // A splayed foot where the root meets the stone.
    const foot = new THREE.ConeGeometry(0.42, 0.7, 5);
    foot.rotateX(Math.PI);
    foot.translate(Math.cos(a) * r, -h + 0.30, Math.sin(a) * r);
    parts.push(foot);
  }
  return mergeGeometries(parts, false);
}

/**
 * A broken laterite block wall — the porous, pitted stone SEA temples sit on.
 * Blocks are individually jittered so the coursing reads as hand-cut.
 */
export function ruinedWall({ length = 12, height = 3, blockH = 0.6, seed = 5 } = {}) {
  const parts = [];
  const rows = Math.max(1, Math.round(height / blockH));
  for (let r = 0; r < rows; r++) {
    const y = r * blockH + blockH / 2;
    // Rows shorten toward the top, so the wall reads as collapsing.
    const rowLen = length * (1 - (r / rows) * fbm(r, 9, { seed }) * 0.55);
    const offset = (r % 2) * 0.5;
    const cols = Math.max(1, Math.round(rowLen / 1.1));
    for (let c = 0; c < cols; c++) {
      const n = fbm(c * 1.3 + r * 5.1, r, { seed });
      if (n < 0.18) continue; // missing block
      const w = 1.0 + n * 0.22;
      const b = new THREE.BoxGeometry(w, blockH * (0.92 + n * 0.1), 0.85 + n * 0.25);
      b.translate(
        (c + offset - cols / 2) * 1.1 + (n - 0.5) * 0.1,
        y + (n - 0.5) * 0.05,
        (n - 0.5) * 0.14
      );
      b.rotateY((n - 0.5) * 0.09);
      parts.push(b);
    }
  }
  return parts.length ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
}

/** Scattered rubble and fallen blocks, for the floor of a ruin. */
export function rubbleField({ count = 30, radius = 8, seed = 13 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const n1 = fbm(i * 1.7, 0, { seed });
    const n2 = fbm(i * 2.9, 1, { seed });
    const a = n1 * Math.PI * 2;
    const r = Math.sqrt(n2) * radius;
    const s = 0.25 + n1 * 0.8;
    const b = new THREE.BoxGeometry(s, s * (0.4 + n2 * 0.5), s * (0.7 + n1 * 0.6));
    b.rotateY(n2 * Math.PI);
    b.rotateX((n1 - 0.5) * 0.6);
    b.translate(Math.cos(a) * r, s * 0.2, Math.sin(a) * r);
    parts.push(b);
  }
  return mergeGeometries(parts, false);
}

/** Stalactites / stalagmites for cave interiors. */
export function speleothems({ count = 24, radius = 14, length = 4, up = false, seed = 17 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const n1 = fbm(i * 1.3, 0, { seed });
    const n2 = fbm(i * 3.7, 1, { seed });
    const a = n1 * Math.PI * 2;
    const r = (0.25 + n2 * 0.75) * radius;
    const len = length * (0.4 + n1 * 1.1);
    const c = new THREE.ConeGeometry(0.18 + n2 * 0.42, len, 6);
    if (!up) c.rotateX(Math.PI);
    c.translate(Math.cos(a) * r, up ? len / 2 : -len / 2, Math.sin(a) * r);
    parts.push(c);
  }
  return mergeGeometries(parts, false);
}

/**
 * A votive stupa: a squat plinth, tapering drum, bell and harmika — the same
 * finial vocabulary as `candiTower`'s crown, at corner-marker scale. Built for
 * the Star Chamber's dais rim, whose grey-boxed corners were a bare cone on a
 * box and read as placeholder rather than temple furniture.
 *
 * `seed` nudges proportions a little so eight of them in a ring do not read
 * as eight copies of one asset.
 */
export function votiveStupa({ height = 1.6, baseWidth = 0.6, seed = 1 } = {}) {
  const n = fbm(seed * 1.7 + 4, seed * 0.6 + 1, { octaves: 2, frequency: 2, seed: 211 });
  const h = height * (0.92 + n * 0.16);
  const w = baseWidth * (0.9 + n * 0.2);
  const parts = [];

  const plinth = new THREE.BoxGeometry(w * 1.6, h * 0.14, w * 1.6);
  plinth.translate(0, h * 0.07, 0);
  parts.push(plinth);

  const step = new THREE.BoxGeometry(w * 1.25, h * 0.10, w * 1.25);
  step.translate(0, h * 0.14 + h * 0.05, 0);
  parts.push(step);

  const drum = new THREE.CylinderGeometry(w * 0.32, w * 0.46, h * 0.38, 8);
  drum.translate(0, h * 0.19 + h * 0.19, 0);
  parts.push(drum);

  const bell = new THREE.SphereGeometry(w * 0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  bell.translate(0, h * 0.57 + w * 0.10, 0);
  parts.push(bell);

  const harmika = new THREE.BoxGeometry(w * 0.30, h * 0.09, w * 0.30);
  harmika.translate(0, h * 0.57 + w * 0.24, 0);
  parts.push(harmika);

  const spire = new THREE.ConeGeometry(w * 0.07, h * 0.16, 6);
  spire.translate(0, h * 0.57 + w * 0.24 + h * 0.13, 0);
  parts.push(spire);

  return mergeGeometries(parts, false);
}

/**
 * A broad, winding body of still water — a jade lake threading a cave floor,
 * not a rectangular channel. Each bank is jittered independently so the
 * waterline reads as an irregular natural edge rather than a straight quad;
 * width is keyframed per anchor so the body can taper narrow and open into a
 * lake, the way the Green Vein concept board does; the cross-section dips
 * gently toward the centre so the surface is never a dead-flat card.
 *
 * UVs: `u` runs 0..1 across the width — 0 and 1 are the two banks, 0.5 the
 * centreline — so a material can key a rim/edge gradient directly off it.
 * `v` is real arc length in metres, for tiling detail at a scale that means
 * something regardless of how long the body runs.
 *
 * @param {{x:number,z:number,width:number}[]} anchors centreline keyframes
 * @param {(z:number)=>number} floorY the floor height function this body sits
 *   on. If the actual walkable floor is a run of flat, stepped segments
 *   rather than a smooth ramp, pass a function that mirrors those steps, not
 *   the continuous slope — sampling the smooth version per vertex will drift
 *   away from the real floor by however much the steps and the slope
 *   disagree, and this body is broad enough that the drift is visible: parts
 *   of it float, parts of it sink under the opaque floor and vanish. Height
 *   is resampled from this function at every vertex's ACTUAL x/z, not
 *   inherited from the centreline curve, so it stays correct regardless of
 *   how the curve smooths the path in between.
 */
export function waterBody({
  anchors,
  floorY,
  lift = 0.1,
  dip = 0.05,
  segments = 100,
  radial = 8,
  edgeNoise = 0.45,
  waveHeight = 0.04,
  seed = 5,
} = {}) {
  // The centreline curve only shapes X/Z. Baking the real (possibly stepped)
  // floor height into its anchors would hand computeFrenetFrames a jagged
  // vertical path with a hard step at every anchor, which is exactly the
  // kind of shape that destabilises a Frenet frame; flat and let the floor
  // function supply Y per vertex, independently, below.
  const pts = anchors.map((a) => new THREE.Vector3(a.x, 0, a.z));
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(segments, false);
  const totalLen = curve.getLength();

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const B = frames.binormals[Math.min(i, segments - 1)];
    const arc = t * totalLen;

    // Width is keyframed per anchor and lerped by the same proportion the
    // centreline curve advances through its control points.
    const fIdx = t * (anchors.length - 1);
    const ia = Math.min(anchors.length - 2, Math.floor(fIdx));
    const lt = fIdx - ia;
    const width = THREE.MathUtils.lerp(anchors[ia].width, anchors[ia + 1].width, lt);

    // Independent noise per bank: the two edges wander out of phase with
    // each other, which is what keeps the width from reading as a uniform
    // taper and makes it read as an eroded, natural edge instead.
    const nL = fbm(t * 11, 1.7, { seed, octaves: 3, frequency: 3.4, period: 4 });
    const nR = fbm(t * 11, 6.3, { seed: seed + 17, octaves: 3, frequency: 3.4, period: 4 });
    const halfL = (width / 2) * (0.7 + nL * edgeNoise);
    const halfR = (width / 2) * (0.7 + nR * edgeNoise);
    const wob = (fbm(t * 15, 3.1, { seed: seed + 5, octaves: 2, frequency: 5, period: 5 }) - 0.5) * waveHeight;

    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const side = u * 2 - 1;
      const off = THREE.MathUtils.lerp(-halfL, halfR, u);
      const cross = 1 - side * side; // 1 at the centreline, 0 at both banks

      const x = p.x + B.x * off;
      const z = p.z + B.z * off;
      const y = floorY(z) + lift + wob - dip * cross;
      positions.push(x, y, z);
      uvs.push(u, arc);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A clumped mass of foliage: several overlapping subdivided icospheres,
 * flattened and jittered, so the silhouette reads as a rounded mound of leaves
 * rather than a single faceted shard. Subdivision level 1 (not 0) is what
 * keeps individual lumps from reading as gemstones at close range.
 */
export function mossClump({ count = 9, radius = 1.5, spread = 1.1, flatten = 0.6, seed = 90 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const n1 = fbm(i * 1.9, 0, { seed });
    const n2 = fbm(i * 2.7, 1, { seed });
    const n3 = fbm(i * 3.3, 2, { seed });
    const a = n1 * Math.PI * 2;
    const r = Math.sqrt(n2) * spread;
    const s = radius * (0.42 + n3 * 0.75);
    const lump = new THREE.IcosahedronGeometry(s, 1);
    // Irregularise each lump so the cluster doesn't read as identical balls.
    const pos = lump.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const nn = fbm(pos.getX(v) * 1.3 + i, pos.getY(v) * 1.3 + pos.getZ(v), { seed: seed + 5, octaves: 2 });
      const k = 1 + (nn - 0.5) * 0.30;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k, pos.getZ(v) * k);
    }
    lump.scale(1, flatten + n2 * 0.3, 1);
    lump.computeVertexNormals();
    lump.translate(Math.cos(a) * r, s * flatten * 0.35 + (n1 - 0.5) * 0.25, Math.sin(a) * r);
    parts.push(lump);
  }
  return mergeGeometries(parts, false);
}

/**
 * The irregular, foliage-broken rim of an oculus opening: a ring of chunky,
 * noise-jittered boulder lumps at a radius that wobbles around the mean, not
 * a lathed torus. The concept board's opening is a ragged ellipse eaten into
 * by clumped growth, not an engineered porthole — a perfect ring reads as the
 * latter no matter how it is lit.
 *
 * `radius` is the MEAN radius. Individual lumps land at `radius * (1 +/- jag)`,
 * so the opening the sky is glimpsed through stays the same size on average
 * while its outline stops being a circle.
 */
export function oculusRim({ radius = 21, thickness = 3.2, segments = 26, jaggedness = 0.30, droop = 2.0, seed = 15 } = {}) {
  const parts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const n = fbm(Math.cos(a) * 2 + 4, Math.sin(a) * 2 + 4, { seed, octaves: 3, frequency: 2.1, period: 8 });
    const rr = radius * (1 + (n - 0.5) * jaggedness);
    const dip = (fbm(Math.cos(a) * 3 + 1, Math.sin(a) * 3 + 1, { seed: seed + 3, period: 8 }) - 0.5) * droop;
    const s = thickness * (0.55 + n * 0.6);
    const chunk = new THREE.IcosahedronGeometry(s, 1);
    chunk.scale(1.35, 0.62, 1.35);
    chunk.rotateY(a * 2.7);
    chunk.translate(Math.cos(a) * rr, dip, Math.sin(a) * rr);
    parts.push(chunk);
  }
  return mergeGeometries(parts, false);
}

/**
 * A walkable ribbon whose surface follows a height FUNCTION exactly.
 *
 * The Green Vein's floor used to be a run of 8m boxes, each sampling its
 * height once at its own centre — a staircase standing in for a slope. The
 * collider and `GREEN_VEIN_FLOOR` therefore disagreed by up to half a metre
 * away from those centres, so anything that derived its height from the
 * function (the water, the stalagmites at the waterline) either floated above
 * the floor or sank through it, and the zone carried a local workaround to
 * paper over the difference. This samples the function per vertex instead, so
 * there is nothing to disagree with.
 *
 * A skirt hangs from the edges so the banks read as rock with thickness rather
 * than as a sheet of paper seen edge-on.
 *
 * @param {(z:number)=>number} floorY   surface height at a given z
 * @param {(z:number)=>number} widthAt  full width at a given z
 * @param {(z:number)=>number} offsetAt centre x at a given z
 */
export function slopedFloor({
  fromZ, toZ, floorY, widthAt, offsetAt = () => 0,
  segments = 56, skirt = 1.6,
}) {
  const positions = [];
  const indices = [];
  const uvs = [];

  const rows = segments + 1;
  const cols = 2; // one quad across; the surface is flat side to side
  for (let i = 0; i < rows; i++) {
    const t = i / segments;
    const z = fromZ + (toZ - fromZ) * t;
    const y = floorY(z);
    const half = widthAt(z) / 2;
    const cx = offsetAt(z);
    positions.push(cx - half, y, z, cx + half, y, z);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * cols;
    const b = a + 1;
    const c = a + cols;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  // Skirts: two vertical strips hanging from the outer edges.
  const base = positions.length / 3;
  for (let i = 0; i < rows; i++) {
    const t = i / segments;
    const z = fromZ + (toZ - fromZ) * t;
    const y = floorY(z);
    const half = widthAt(z) / 2;
    const cx = offsetAt(z);
    positions.push(cx - half, y, z, cx - half, y - skirt, z);
    positions.push(cx + half, y, z, cx + half, y - skirt, z);
    uvs.push(0, t, 0.1, t, 1, t, 0.9, t);
  }
  for (let i = 0; i < segments; i++) {
    const l = base + i * 4;
    indices.push(l, l + 1, l + 4, l + 1, l + 5, l + 4);         // left skirt
    const r = l + 2;
    indices.push(r, r + 4, r + 1, r + 1, r + 4, r + 5);         // right skirt
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
