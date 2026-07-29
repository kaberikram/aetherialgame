# PROJECT.md — VESSEL, Chapter 1

Drop this in the repo root. Rename to `CLAUDE.md` if using Claude Code. Every phase prompt begins by reading this file. Do not restate it in phase prompts.

---

## What this is

Chapter 1 of a third-person souls-like in Three.js, in the lineage of Elden Ring and Black Myth: Wukong, rooted in Southeast Asian mythology. A complete shippable opening: void to sky, 25 to 40 minutes of play, with a tutorial, a boss, an irreversible choice, and an ending beat.

## Premise

The player is a formless light stripped of body, memory, and power. A grey pigeon with a voice too smooth for its body drags a corpse into the void and offers it as a vessel. Seven trials lie ahead, each guarded, each returning a fragment of what the player used to be. Every fragment comes with a choice: light or dark. The pigeon is lying about why it is helping. It is a knight, and when the player is whole it intends to take everything back.

## Tone

Something is wrong and the player should feel it before they can name it. The guide is calm, helpful, and subtly incorrect. Never signpost the betrayal in dialogue. Plant it in environment and animation only.

## Beat sheet

1. **The Void.** No body. Drifting point of light, weightless input, no collision, no horizon. The pigeon appears dragging a pale corpse by the arm. Drops it, straightens, speaks. Voice has no spatial falloff.
2. **Embodiment.** Light enters the corpse. Cut to weight: heavy limbs, sluggish stand, camera drift. First sixty seconds feel unfamiliar on purpose, then resolve. No tutorial popups. Teach with framing and geometry.
3. **The Descent.** Follow the pigeon. Traversal tutorial. Bones, abandoned camps, carvings the player cannot read yet. Green Vein zone.
4. **The Still Pool.** Star Chamber zone. Flooded ritual dais, one suspended star. Something large under unnaturally still water. The pigeon says the player is not ready. Let them get close enough to be scared.
5. **The Sword.** Half-buried in mud beside a dead warrior's bones. Unlocks combat. Simple hilt, cold steel, no glow, no rarity color. A tool, not a reward.
6. **The Boss.** The thing in the pool. Scales like oil, teeth catching star-light.
7. **The Wings.** Warmth in the back. Wings tear out. The choice, no UI labels, no "good" or "evil":
   - **Light:** broad, feathered, radiant. Throws real illumination. The chamber brightens.
   - **Dark:** leathery, sharp, bat-like. Absorbs light. The chamber darkens and the star dims.
   Same room, two different rooms.
8. **The Exit.** Pagoda Well zone. Sunken candi under an oculus of open sky, the only daylight in the chapter. Flight tutorial. Break through into daylight. "Seven trials remain." Cut.

## Art direction

**Zones.**
- *Green Vein:* deep olive and black, emissive jade from the water, near-zero ambient.
- *Star Chamber:* desaturated indigo and slate, one white point light doing all the work, hard falloff into black.
- *Pagoda Well:* warm daylight shaft into cool wet stone. Only sky in the chapter.

**Rendering language.** Painterly, not photoreal. Value structure over surface detail. If a frame does not read in grayscale, it fails.

**Scale.** Player silhouette reads small against architecture and bosses. The concept board of the pagoda sets the ratio: a person is a few pixels tall against the temple.

**Mythology.** Southeast Asian, not Western high fantasy. Candi and stupa stonework, laterite and volcanic rock, banyan roots breaking masonry, kala faces over doorways, naga balustrades. Winged forms follow Garuda and Kinnara, not European angels: sharp feather structure, gold leaf over dark wood tones, batik and songket in drapery instead of chainmail. If a frame could be from a generic Western fantasy game, it fails.

## Alignment architecture

Seven trials times a binary choice is 128 end-states. Do not author 128 characters.

Seven slots: **wings, head, chest, arms, legs, weapon, aura.** Each has a light and a dark variant. The character is assembled at runtime from owned variants. One shared skeleton, swappable meshes, two material sets, two VFX sets. Fourteen assets, not 128.

A single `alignment` integer from -7 to +7 drives appearance, mechanics, and world reaction.

**Mechanical divergence is required.** Light leans defensive and rhythmic: longer parry windows, heal on successful deflect, ranged option. Dark leans aggressive and risky: lifesteal on hit, faster attacks, lower defense, a dash that costs health.

Choices are irreversible within a run. Chapter 1 resolves the **wings** slot only. Build the whole system, populate one slot.

## Combat rules

- Stamina gates attack, dodge, sprint, block. Regen delay after spend.
- Roll: ~0.4s invincibility inside a ~0.9s animation, directional, cancels into itself only.
- Light and heavy attacks with explicit startup / active / recovery frames. Attacks commit. No cancelling out of recovery.
- Poise, hyper-armor, stagger on both sides, critical on stagger.
- Tight deflect window on block, rewards a damage multiplier.
- Lock-on with target cycling, camera respects geometry.
- Hitboxes and hurtboxes are animation-driven capsules, never per-frame guesses. Debug visualization behind a key.
- One healing item, limited charges, slow punishable drink animation.
- Checkpoint restores charges, respawns enemies, holds progress. Currency drops on death, recoverable once, lost on second death.

## Technical stack

- **Renderer:** Three.js. PBR throughout: albedo, normal, roughness, metalness, AO. No default-material surfaces ship.
- **Physics:** Rapier. Capsule character controller with step offset and slope handling. Ragdoll on death.
- **Shadows:** cascaded shadow maps on the key light, tuned to kill peter-panning and acne.
- **Post:** TAA or FXAA, emissive-keyed bloom, ACES tone mapping, per-zone LUT grading, SSAO, subtle vignette.
- **Volumetrics:** raymarched shafts in Star Chamber and Pagoda Well. No billboard fakes.
- **Indirect:** baked or probe-based. Real-time GI is out of budget.
- **Water:** screen-space reflection, refraction, depth-based murk, dynamic displacement on boss breach. The pool is a character, budget for it.
- **Animation:** locomotion blend trees, root motion on attacks, foot IK on uneven ground, layered upper-body hit reactions.
- **Scene:** instancing for foliage and props, LODs above ~5k tris, frustum and occlusion culling.
- **Audio:** positional with per-zone reverb, surface-typed footsteps, distinct cue per boss wind-up.

## Performance budget

Locked 60fps at 1440p on a mid-range discrete GPU. Under 1,500 draw calls per frame. Under 4ms CPU per frame. These numbers are reported at the end of every phase. Regressions block the gate.

## Critic rubric

Applied from Phase 7 onward, and on every visual deliverable before then.

- Does the frame match its concept board in composition, value, and palette? Side by side.
- Does the frame read in grayscale? Convert and check.
- Is every character silhouette readable at 10% screen height?
- Paused mid-wind-up, can you name the incoming attack?
- Any flat-lit or default-material surface visible?
- Does combat commit, or can the player cancel out of everything?
- Does the Star Chamber visibly become a different room after the wing choice?
- Does the world read as Southeast Asian rather than generic Western fantasy?
- Are the performance numbers within budget?

## Working rules

- No phase begins until the previous gate passes.
- Ship a playable build at the end of every phase. Never leave the repo in a state that does not run.
- Grey box until Phase 7. Art comes after the game is fun, not before.
- When blocked, stop and surface the blocker with a proposed tradeoff. Do not loop indefinitely.
- Update `DECISIONS.md` whenever a design or tech choice is locked, with the reasoning.
