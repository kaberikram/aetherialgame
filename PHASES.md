# PHASES.md — VESSEL Chapter 1 build order

Ten phases. Each ends in a playable build and a gate. Nothing starts until the previous gate passes.

Every phase prompt assumes the agent has read `PROJECT.md` first. Do not paste the art direction or beat sheet again.

| # | Phase | Agents | Gate judged by |
|---|-------|--------|----------------|
| 0 | Foundation | 1 | You |
| 1 | Movement | 1 | You (feel) |
| 2 | Combat framework | 1 | You (feel) |
| 3 | The boss, grey box | 1 | You (fun) |
| 4 | Level blockout | 1 | You (pacing, scale) |
| 5 | Wings and flight | 2 | You |
| 6 | The companion | 1 | You |
| 7 | Art pass | 4 | Critic agent |
| 8 | Motion and sound | 3 | Critic agent |
| 9 | Critic loop and perf | 1 + owners | Critic agent, then you |

**Where fan-out actually helps.** Phases 0 to 6 are one agent because gameplay systems are deeply interdependent and parallel agents will produce merge conflicts faster than code. Phase 7 is where parallelism pays off: the three zones do not touch each other. Do not fan out earlier just because you can.

**Feel gates are yours alone.** A critic agent can judge whether a frame reads in grayscale. It cannot judge whether a roll feels good. Phases 1 through 4 end with you playing the build, and no agent gets to tell you it passed.

---

## Phase 0 — Foundation

```
Read PROJECT.md.

Set up the project foundation. One agent, no sub-agents, no gameplay code yet.

Deliver:
- Repo structure with clear module boundaries for: core loop, rendering, physics,
  input, character, combat, AI, level, audio, UI, debug.
- Written interface contracts between those modules. What each one owns, what it
  exposes, what it is forbidden from touching. This is the document that lets
  parallel agents work later without collisions.
- Locked tech choices with reasoning in DECISIONS.md: build tooling, Rapier
  integration approach, asset pipeline, animation format, state management.
- A running scene: empty world, grey ground plane, orbit debug camera, stats
  overlay showing FPS, draw calls, triangles, and CPU frame time.
- A debug key layout, documented, with slots reserved for hitbox visualization,
  free camera, and state inspection.

Do not write character, combat, or level code in this phase.

Stop when this is running and present the architecture for review.
```

**Gate:** you read the interface contracts and agree with them. If the module boundaries are wrong, fixing it now costs an hour. Fixing it at Phase 7 costs the project.

---

## Phase 1 — Movement

```
Read PROJECT.md and the Phase 0 interface contracts.

Build the character controller and camera in grey box. No textures, no art.

Deliver:
- Rapier capsule controller: walk, run, sprint, jump, step offset, slope handling.
- Third-person camera: collision-aware, smooth follow, adjustable distance,
  no clipping through geometry.
- Roll: directional, ~0.9s animation, ~0.4s invincibility window, cancels only
  into itself. i-frames visualized in debug.
- Stamina: gates sprint and roll, drains and regens with a delay after spend.
  Visible debug bar.
- Lock-on: acquire, cycle targets, break on distance or line of sight, camera
  behavior while locked.
- A grey box test room with slopes, steps, ledges, narrow gaps, and a static
  dummy to lock onto.
- The void-to-body transition from beat 1 and 2: drifting light with weightless
  input and no collision, then the handoff to weighted movement. This transition
  is the player's first impression, treat it as a feature not a loading screen.

Placeholder animations are fine. Timing and weight are not placeholder.
Report performance numbers.
```

**Gate:** you play it for ten minutes. Does moving around an empty grey room feel good on its own? If the answer is anything other than yes, do not proceed. Every later phase inherits this feel and none of them can fix it.

---

## Phase 2 — Combat framework

```
Read PROJECT.md and the Phase 0 interface contracts.

Build the combat system in grey box against a training dummy.

Deliver:
- Light and heavy attacks with explicit startup / active / recovery frame counts,
  authored in data not hardcoded. Attacks commit. No cancelling out of recovery.
- Attack chaining with defined windows.
- Animation-driven hitbox and hurtbox capsules. Debug visualization on a key,
  showing active frames in a distinct color.
- Poise, hyper-armor, stagger states for player and enemies. Critical attack
  on a staggered target.
- Block, and a tight deflect window inside it that rewards a damage multiplier.
- Healing item: limited charges, slow punishable drink animation, cannot be
  cancelled once started.
- Damage, health, death, and respawn.
- Checkpoint: restores charges, respawns enemies, holds progress.
- Currency: dropped on death, recoverable once, lost on second death.
- A training dummy that reacts, staggers, and reports the frame data of what hit it.

Report performance numbers.
```

**Gate:** you play it. Does an attack feel like a decision you are committed to, or like something you can take back? Can you deflect on reaction? If the deflect window is not satisfying, tune it before moving on.

---

## Phase 3 — The boss, grey box

```
Read PROJECT.md and the Phase 0 interface contracts.

Build the Chapter 1 boss encounter entirely in grey box primitives. No art.

The boss is the thing in the pool. It is the first boss in the game, so it
teaches the grammar: readable, fair, and still frightening.

Deliver:
- Arena: the flooded dais. Water depth affects movement speed and dodge distance.
  Shallow safe ring at the edge, deep center. Safety versus reach is the player's
  standing decision throughout the fight.
- Phase one: mostly submerged, strikes and retreats, teaches patience and punish
  windows.
- Phase two: beaches itself on the dais, fully visible, faster. Scripted
  transition, not a health threshold with a stat change.
- Moveset: a telegraphed lunge, a tail sweep demanding a roll-through, a
  submerge-and-reposition that teaches camera management, and one delayed strike
  that punishes panic-rolling.
- Every wind-up readable in silhouette. Pause any frame of any attack and it
  should be nameable.
- Boss health bar, name plate, fog gate, death and retry loop wired to the
  Phase 2 checkpoint.

Use capsules and boxes. The fight has to be good before it is pretty.
Report performance numbers.
```

**Gate:** you fight it until you win. Was it fun while made of grey boxes? This is the single most important gate in the build. Art multiplies a good fight and cannot rescue a bad one.

---

## Phase 4 — Level blockout

```
Read PROJECT.md and the Phase 0 interface contracts.

Block out the entire Chapter 1 path in grey geometry. Playable start to finish.

Deliver:
- The Void: boundless black, no horizon, the corpse, the drift space.
- The Descent: the route from embodiment down into the cave. Traversal tutorial
  built into geometry, not into text prompts.
- Green Vein: the bioluminescent stretch. Blocked for sightlines and pacing.
- Star Chamber: the flooded dais and the approach to it. The player must be able
  to walk to the water's edge before the fight and feel the scale of what is
  under it.
- Pagoda Well: the temple, the oculus, the vertical space the player will fly up
  through.
- The sword pickup placement, beside the dead warrior.
- Correct real-world scale throughout. Use the concept board ratio: a person is
  tiny against the temple.
- Playable straight through: void, embodiment, descent, pool, sword, boss, exit
  space. The wing choice and flight are stubbed for now.

Grey geometry only. Lighting is placeholder, but volume, sightlines, and scale
are final. Report performance numbers.
```

**Gate:** you walk the whole thing. Is the pacing right? Does the Star Chamber feel big? Is the descent too long? Fixing level volume after the art pass is expensive, fixing it now is free.

---

## Phase 5 — Wings and flight

```
Read PROJECT.md and the Phase 0 interface contracts.

Two agents. Agent A owns the alignment system, agent B owns flight. They share
the character rig, so define the rig contract between them before either starts.

AGENT A — Alignment system:
- The seven-slot architecture from PROJECT.md, built in full even though only
  wings resolve in Chapter 1.
- Runtime mesh and material swapping on a shared skeleton.
- The alignment integer, persisted, driving appearance and mechanics.
- Mechanical divergence wired up: light gets longer parry windows and heal on
  deflect, dark gets lifesteal, faster attacks, lower defense, a health-cost dash.
- The choice moment: presented with no UI labels, no good or evil framing,
  irreversible.
- The Star Chamber lighting reaction. Light wings raise chamber illumination,
  dark wings dim the star and deepen shadows. Same room, two rooms.

AGENT B — Flight controller:
- Takeoff from ground, flap-to-climb with a stamina-like cost, glide, banking
  turns tied to camera, landing with a recovery animation.
- Light and dark share the controller but handle differently: light glides
  longer and turns wide, dark climbs faster and turns sharp.
- The Pagoda Well exit sequence: climb the vertical space, break through the
  oculus, transition to daylight.

Report performance numbers.
```

**Gate:** you take both branches. Does the choice feel weighty? Does the chamber actually become a different room? Is flight controllable enough that the exit is a triumph rather than a fight with the camera?

---

## Phase 6 — The companion

```
Read PROJECT.md and the Phase 0 interface contracts.

Build the pigeon. It leads, waits, comments, and never helps in combat.

Deliver:
- Pathing that stays ahead of the player without blocking the camera, waits at
  chokepoints, and never gets stuck.
- Positional audio for wing-flaps. Non-positional for speech. That mismatch is
  deliberate, do not fix it.
- Barks triggered by progression state, never by timers.
- The dialogue for beats 1, 2, 4, 5, 7, and 8 from PROJECT.md.
- Three environmental tells that foreshadow the betrayal. None of them in
  dialogue. Suggestions: its shadow is larger than its body and the wrong shape,
  it never enters the light of the star, it flinches from the sword at pickup.
  Pick three, implement them subtly enough that most players miss them once.

Report performance numbers.
```

**Gate:** you play through. Does the bird feel helpful and slightly wrong at the same time? Ask someone who has not read the design doc to play it and tell you what they noticed.

---

## Phase 7 — Art pass

```
Read PROJECT.md and the Phase 0 interface contracts. Attach the concept boards.

Now fan out. Four agents in parallel plus one critic.

AGENT 1 — Green Vein: materials, lighting, props, emissive water.
AGENT 2 — Star Chamber: materials, lighting, the suspended star, volumetrics,
  water rendering, the wing-choice lighting reaction.
AGENT 3 — Pagoda Well: candi stonework, banyan roots, the oculus shaft, daylight.
AGENT 4 — Rendering pipeline: PBR setup, cascaded shadows, post chain, per-zone
  LUT grading, SSAO, tone mapping. Owns the shared pipeline that 1 to 3 consume.

CRITIC AGENT: owns no code, writes none. Its only job is to reject work. It
reviews rendered frames against the concept boards and applies the PROJECT.md
rubric line by line, pass or fail.

On any fail the critic writes a specific actionable defect. Not "make it better."
Something like: "the Star Chamber key light has no falloff, the back wall reads
the same value as the foreground dais, drop the ambient and push the contrast
ratio to at least 4:1."

Cap at 5 iterations per item. On a fifth failure, stop, write down what is
blocking it and a proposed tradeoff, and surface it to me. Do not loop forever.

Report performance numbers every iteration. Regressions are failures.
```

**Gate:** the critic passes every rubric line for all three zones, and the budget holds.

---

## Phase 8 — Motion and sound

```
Read PROJECT.md and the Phase 0 interface contracts.

Three agents plus the critic from Phase 7.

AGENT 1 — Animation: replace all placeholders. Locomotion blend trees, root
  motion on attacks, foot IK on uneven ground, layered upper-body hit reactions,
  the embodiment stand-up, the wing burst, ragdoll on death.
AGENT 2 — VFX: the wing burst for both branches, water displacement on boss
  breach, impact and stagger effects, the star, the oculus shaft interaction.
AGENT 3 — Audio: positional with per-zone reverb, surface-typed footsteps, a
  distinct cue per boss wind-up, the pigeon's voice treatment, the silence of
  the void.

Critic rules from Phase 7 apply, with one addition: paused mid-wind-up, every
boss attack must still be nameable from the pose alone.
```

**Gate:** critic passes, then you play the whole chapter with sound on.

---

## Phase 9 — Critic loop and performance

```
Read PROJECT.md.

Full-build pass. No new features.

- Run the complete rubric against the entire chapter, every zone, every beat.
- Profile and hit the budget: 60fps at 1440p on a mid-range discrete GPU, under
  1,500 draw calls, under 4ms CPU frame time.
- Optimize: instancing, LODs, texture atlasing, draw call batching, culling.
  Do not sacrifice the art direction to hit numbers. If a target is unreachable
  without visual compromise, surface the tradeoff to me rather than deciding.
- Fix every defect the critic has logged and deferred across all phases.
- Verify the definition of done below end to end.
```

**Definition of done:** a player who has never seen the game starts in the void, takes the body, learns to move, finds the sword, dies to the thing in the pool at least once, comes back, wins, chooses their wings, flies out through the oculus into daylight, and feels like something is off about the bird. Every frame along that path passes the rubric.

---

## If you need to cut

In this order, cheapest loss first:

1. Phase 8 VFX polish beyond the wing burst.
2. The Green Vein as a full zone. It can compress into a corridor.
3. Boss phase two. A single-phase fight still teaches the grammar.
4. Flight as a controller. The exit can be a cinematic.

Do not cut: the wing choice, the chamber's reaction to it, or the three tells. Those three things are what make this your game rather than a souls-like template.
