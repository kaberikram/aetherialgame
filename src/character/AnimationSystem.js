import * as THREE from 'three';

/**
 * AnimationSystem — a small pose-keyframe player, because there are no
 * animation files and authoring clips as data is the only route.
 *
 * A clip is a set of bone tracks; a track is a list of keys at explicit FRAME
 * numbers. Frames, not seconds, because the same numbers are the combat frame
 * data. A move that says `active: [14, 18]` has its hitbox live on exactly the
 * frames its animation says the sword is out. The two cannot drift apart
 * because there is only one of them.
 *
 * Layers blend on top of the base: a hit reaction plays on the upper body while
 * the legs keep running. Masks are bone-name prefixes.
 *
 * Root motion is REPORTED, never applied. The controller decides whether the
 * character actually gets to move that far, because a wall might disagree.
 */

const EASINGS = {
  linear: (t) => t,
  ease: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  // `snap` holds the previous pose then jumps. Attack impacts want this: a
  // smoothly interpolated sword swing has no moment of contact.
  snap: (t) => (t < 0.92 ? 0 : 1),
  overshoot: (t) => {
    const c = 1.9;
    return 1 + c * Math.pow(t - 1, 3) + (c - 0.55) * Math.pow(t - 1, 2);
  },
};

/** Authoring helper: a keyframe. Rotations in DEGREES, positions in metres. */
export const k = (f, { r, p, e = 'ease' } = {}) => ({ f, r, p, e });

/** Authoring helper: build a clip. */
export function clip(id, frames, opts, tracks) {
  return {
    id,
    frames,
    loop: opts.loop ?? false,
    // Root motion curve: distance along local +Z (forward) and +Y, in metres.
    rootMotion: opts.rootMotion ?? null,
    // Events fire once when playback crosses their frame.
    events: opts.events ?? [],
    speed: opts.speed ?? 1,
    tracks,
  };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ea = new THREE.Euler();
const D2R = Math.PI / 180;

/** Sample one track at a fractional frame into out.{quat,pos}. */
function sampleTrack(keys, frame, restQuat, restPos, out) {
  if (!keys.length) {
    out.quat.copy(restQuat);
    out.pos.copy(restPos);
    return;
  }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].f <= frame) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];

  let t = 0;
  if (b !== a && b.f > a.f) t = (frame - a.f) / (b.f - a.f);
  t = Math.min(1, Math.max(0, t));
  const eased = (EASINGS[b.e] ?? EASINGS.ease)(t);

  if (a.r || b.r) {
    _qa.setFromEuler(_ea.set((a.r?.[0] ?? 0) * D2R, (a.r?.[1] ?? 0) * D2R, (a.r?.[2] ?? 0) * D2R));
    _qb.setFromEuler(_ea.set((b.r?.[0] ?? 0) * D2R, (b.r?.[1] ?? 0) * D2R, (b.r?.[2] ?? 0) * D2R));
    out.quat.copy(_qa).slerp(_qb, eased);
  } else {
    out.quat.copy(restQuat);
  }

  if (a.p || b.p) {
    const ap = a.p ?? [0, 0, 0];
    const bp = b.p ?? [0, 0, 0];
    out.pos.set(
      restPos.x + ap[0] + (bp[0] - ap[0]) * eased,
      restPos.y + ap[1] + (bp[1] - ap[1]) * eased,
      restPos.z + ap[2] + (bp[2] - ap[2]) * eased
    );
  } else {
    out.pos.copy(restPos);
  }
}

/** One playing clip instance. */
class Playback {
  constructor(clip, { weight = 1, layer = 'base', mask = null, speed = 1, fadeFrames = 6 } = {}) {
    this.clip = clip;
    this.frame = 0;
    this.layer = layer;
    this.mask = mask;
    this.speed = speed;
    this.targetWeight = weight;
    this.weight = fadeFrames > 0 ? 0 : weight;
    this.fadeRate = fadeFrames > 0 ? 1 / fadeFrames : 1;
    this.finished = false;
    this.firedEvents = new Set();
    this.rootMotionCursor = 0;
  }

  advance(dtFrames) {
    this.frame += dtFrames * this.speed * this.clip.speed;
    if (this.frame >= this.clip.frames) {
      if (this.clip.loop) {
        this.frame %= this.clip.frames;
        this.firedEvents.clear();
        this.rootMotionCursor = 0;
      } else {
        this.frame = this.clip.frames;
        this.finished = true;
      }
    }
    this.weight += Math.sign(this.targetWeight - this.weight) * this.fadeRate * dtFrames;
    if (Math.abs(this.targetWeight - this.weight) < this.fadeRate * dtFrames) this.weight = this.targetWeight;
    this.weight = Math.min(1, Math.max(0, this.weight));
  }
}

export class AnimationSystem {
  static LAYERS = ['base', 'upper', 'override'];

  constructor(rig, bus) {
    this.rig = rig;
    this.bus = bus;
    this.clips = new Map();
    /** @type {Playback[]} */
    this.playing = [];

    // Rest pose snapshot: everything blends from and back to this.
    this.rest = rig.bones.map((b) => ({
      quat: b.quaternion.clone(),
      pos: b.position.clone(),
    }));

    // Scratch pose buffers, allocated once.
    this.pose = rig.bones.map(() => ({ quat: new THREE.Quaternion(), pos: new THREE.Vector3() }));
    this.scratch = { quat: new THREE.Quaternion(), pos: new THREE.Vector3() };
    this.accum = rig.bones.map(() => ({ quat: new THREE.Quaternion(), pos: new THREE.Vector3(), weight: 0 }));

    this.rootMotionDelta = new THREE.Vector3();
    this.onEvent = null;
  }

  register(...clips) {
    for (const c of clips) this.clips.set(c.id, c);
    return this;
  }

  get(id) {
    const c = this.clips.get(id);
    if (!c) throw new Error(`AnimationSystem: no clip "${id}"`);
    return c;
  }

  has(id) {
    return this.clips.has(id);
  }

  /** Replaces everything on the target layer. */
  play(id, opts = {}) {
    const clip = this.get(id);
    const layer = opts.layer ?? 'base';
    for (const p of this.playing) {
      if (p.layer === layer) {
        p.targetWeight = 0;
        p.fadeRate = opts.fadeFrames > 0 ? 1 / opts.fadeFrames : 1;
      }
    }
    const pb = new Playback(clip, opts);
    this.playing.push(pb);
    return pb;
  }

  /** Cross-faded set for blend trees: same layer, weights sum to 1. */
  setBlend(entries, { layer = 'base', fadeFrames = 4 } = {}) {
    const wanted = new Map(entries.map((e) => [e.id, e.weight]));
    for (const p of this.playing) {
      if (p.layer !== layer) continue;
      if (wanted.has(p.clip.id)) {
        p.targetWeight = wanted.get(p.clip.id);
        wanted.delete(p.clip.id);
      } else {
        p.targetWeight = 0;
      }
    }
    for (const [id, weight] of wanted) {
      if (weight <= 0.001) continue;
      const pb = new Playback(this.get(id), { weight, layer, fadeFrames });
      pb.frame = this.#syncFrameFor(layer, this.get(id));
      this.playing.push(pb);
    }
  }

  /**
   * A new locomotion clip joins at the phase the current one is at, so
   * walk→run does not reset the stride and produce a visible foot stutter.
   */
  #syncFrameFor(layer, clip) {
    const ref = this.playing.find((p) => p.layer === layer && p.weight > 0.1 && p.clip.loop);
    if (!ref) return 0;
    return (ref.frame / ref.clip.frames) * clip.frames;
  }

  stopLayer(layer, fadeFrames = 6) {
    for (const p of this.playing) {
      if (p.layer === layer) {
        p.targetWeight = 0;
        p.fadeRate = fadeFrames > 0 ? 1 / fadeFrames : 1;
      }
    }
  }

  isPlaying(id) {
    return this.playing.some((p) => p.clip.id === id && p.weight > 0.01 && !p.finished);
  }

  /** Current frame of the dominant clip on a layer — what combat queries. */
  frameOf(id) {
    const p = this.playing.find((x) => x.clip.id === id);
    return p ? p.frame : -1;
  }

  get current() {
    let best = null;
    for (const p of this.playing) {
      if (p.layer !== 'base') continue;
      if (!best || p.weight > best.weight) best = p;
    }
    return best;
  }

  fixedUpdate(dt) {
    const dtFrames = dt * 60;
    this.rootMotionDelta.set(0, 0, 0);

    for (const p of this.playing) {
      const before = p.frame;
      p.advance(dtFrames);
      this.#fireEvents(p, before);
      this.#accumulateRootMotion(p, before);
    }
    // Retire fully faded, finished playbacks. A finished non-looping clip is
    // kept at weight while it holds its last pose, so nothing pops.
    this.playing = this.playing.filter((p) => !(p.weight <= 0.001 && p.targetWeight <= 0.001));

    this.#evaluate();
  }

  #fireEvents(p, beforeFrame) {
    if (!p.clip.events.length || p.weight < 0.5) return;
    for (const ev of p.clip.events) {
      if (p.firedEvents.has(ev.frame)) continue;
      if (beforeFrame <= ev.frame && p.frame >= ev.frame) {
        p.firedEvents.add(ev.frame);
        this.onEvent?.(ev, p.clip);
      }
    }
  }

  #accumulateRootMotion(p, beforeFrame) {
    const rm = p.clip.rootMotion;
    if (!rm || p.weight < 0.01) return;
    const at = (f) => {
      let i = 0;
      while (i < rm.length - 1 && rm[i + 1].f <= f) i++;
      const a = rm[i];
      const b = rm[Math.min(i + 1, rm.length - 1)];
      const t = b.f > a.f ? Math.min(1, Math.max(0, (f - a.f) / (b.f - a.f))) : 1;
      const eased = (EASINGS[b.e] ?? EASINGS.ease)(t);
      return {
        z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * eased,
        y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * eased,
        x: (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * eased,
      };
    };
    const from = at(beforeFrame);
    const to = at(p.frame);
    this.rootMotionDelta.x += (to.x - from.x) * p.weight;
    this.rootMotionDelta.y += (to.y - from.y) * p.weight;
    this.rootMotionDelta.z += (to.z - from.z) * p.weight;
  }

  /** Metres the animation asked to travel this step, in character-local space. */
  consumeRootMotion(out = new THREE.Vector3()) {
    out.copy(this.rootMotionDelta);
    this.rootMotionDelta.set(0, 0, 0);
    return out;
  }

  #maskAllows(mask, boneName) {
    if (!mask) return true;
    return mask.some((prefix) => boneName.startsWith(prefix));
  }

  #evaluate() {
    const bones = this.rig.bones;

    for (let i = 0; i < bones.length; i++) {
      this.accum[i].quat.copy(this.rest[i].quat);
      this.accum[i].pos.copy(this.rest[i].pos);
      this.accum[i].weight = 0;
    }

    // Base layer: normalised weighted blend, so partial weights during a
    // cross-fade do not collapse the pose toward rest.
    for (const layer of AnimationSystem.LAYERS) {
      const active = this.playing.filter((p) => p.layer === layer && p.weight > 0.001);
      if (!active.length) continue;

      const total = active.reduce((s, p) => s + p.weight, 0);
      if (total <= 0.001) continue;

      for (let i = 0; i < bones.length; i++) {
        const boneName = bones[i].name;
        let accumulated = 0;
        const target = this.pose[i];

        for (const p of active) {
          if (!this.#maskAllows(p.mask, boneName)) continue;
          const track = p.clip.tracks[boneName];
          sampleTrack(track ?? [], p.frame, this.rest[i].quat, this.rest[i].pos, this.scratch);
          const w = p.weight / total;
          if (accumulated === 0) {
            target.quat.copy(this.scratch.quat);
            target.pos.copy(this.scratch.pos);
            accumulated = w;
          } else {
            const t = w / (accumulated + w);
            target.quat.slerp(this.scratch.quat, t);
            target.pos.lerp(this.scratch.pos, t);
            accumulated += w;
          }
        }
        if (accumulated === 0) continue;

        // Layers above base override by their own summed weight.
        const layerWeight = layer === 'base' ? 1 : Math.min(1, total);
        if (layerWeight >= 0.999) {
          this.accum[i].quat.copy(target.quat);
          this.accum[i].pos.copy(target.pos);
        } else {
          this.accum[i].quat.slerp(target.quat, layerWeight);
          this.accum[i].pos.lerp(target.pos, layerWeight);
        }
      }
    }

    for (let i = 0; i < bones.length; i++) {
      bones[i].quaternion.copy(this.accum[i].quat);
      bones[i].position.copy(this.accum[i].pos);
    }
  }

  /** Post-pose bone adjustment, for foot IK and look-at. Applied after evaluate. */
  applyBoneOffset(boneName, quat, weight = 1) {
    const bone = this.rig.byName.get(boneName);
    if (!bone) return;
    bone.quaternion.slerp(quat, weight);
  }
}
