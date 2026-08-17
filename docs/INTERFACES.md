# INTERFACES.md — module contracts

This is the document that lets later phases be worked on in parallel without collisions. Every module below states what it **owns**, what it **exposes**, and what it is **forbidden** from touching. The forbidden list is the important one.

Two global rules:

1. **Cross-module communication goes through `EventBus`.** A module may hold a reference to a service it resolved from the engine, but it may not reach into another module's internal state. If module A needs to know something happened in module B, B emits and A listens.
2. **`Engine` owns the frame.** Nothing else calls `requestAnimationFrame`, and nothing else decides when a fixed step happens. Modules implement `fixedUpdate(dt, ctx)` for simulation and `update(dt, alpha, ctx)` for presentation, and are told when to run.

## Update order

Registered by `STAGE` priority in `src/core/Engine.js`. Lower runs first. The order is not arbitrary — input must be sampled before the character reads it, physics must step before the camera resolves collision against the new position.

```
INPUT 100 → NARRATIVE 150 → AI 200 → CHARACTER 300 → COMBAT 400 → PHYSICS 500
  → ANIMATION 600 → CAMERA 700 → WORLD 800 → AUDIO 850 → UI 900 → RENDER 1000 → DEBUG 1100
```

A module that must run while the simulation is paused sets `updateWhilePaused = true`. Only presentation modules may do this — debug cameras, overlays, the renderer. Anything that mutates simulation state must not.

## Fixed timestep

Simulation runs at a fixed 60Hz with a maximum of 5 sub-steps per frame; backlog past that is discarded rather than deferred. **One frame is 16.667ms and combat is authored in frames, not seconds.** A move's frame data is only meaningful because the step never varies.

---

## Services

Resolved by name via `engine.resolve(name)`. Registered once at boot in `src/main.js`.

| Name | Class | Registered |
|---|---|---|
| `state` | `GameState` | P0 |
| `renderer` | `Renderer` | P0 |
| `debug` | `DebugSystem` | P0 |
| `physics` | `PhysicsWorld` | P1 |
| `input` | `InputSystem` | P1 |
| `player` | `PlayerController` | P1 |
| `camera` | `CameraRig` | P1 |
| `combat` | `CombatSystem` | P2 |
| `zones` | `ZoneManager` | P4 |
| `audio` | `AudioSystem` | P8 |

---

## `core/`

**Engine** — owns the frame, the module list, the service registry, the perf counters. Exposes `add/remove`, `provide/resolve`, `start/stop`, `setPaused`, `stepOnce`, `perf`, `frame`, `fixedDelta`. Forbidden: knowing any gameplay concept. It never imports from `character/`, `combat/`, `level/`.

**EventBus** — owns event dispatch. Every event name is declared in `EVENTS`; emitting an undeclared name throws. Forbidden: holding state. It is a pipe, not a store.

**Clock** — owns the fixed-timestep accumulator and the spiral-of-death guard.

**GameState** — owns progression truth: the seven slot variants, the alignment integer, flags, checkpoint, currency, the bloodstain, death count. Exposes read accessors, mutators that emit, `save`/`load`/`clear`. Forbidden: touching the scene graph, physics, or anything renderable. It is serialisable data and nothing else.

---

## `render/`

**Renderer** — owns the `WebGLRenderer`, the scene root, the active camera, colour management, tone mapping, shadow config, resize. Exposes `scene`, `camera`, `renderer`, `composer`, `setCamera`, `resize`. Forbidden: gameplay knowledge. It draws what it is given.

sRGB output is configured here **and nowhere else**, and tone mapping is off: a filmic curve smears the bands cel shading exists to produce. Every material authors colour in sRGB and is lit in linear.

**npr/ToonMaterial** — owns the one surface shader in the game: a banded gradient ramp plus an injected Fresnel rim. Exposes `toonMaterial(opts)` and `toonRamp(bands)`, both cached. Forbidden: adding anything to the scene, and — permanently — reintroducing any PBR term.

**npr/InkEdges** — owns the line work. `buildInkEdges(meshes)` merges world-space `EdgesGeometry` into one `LineSegments`. Forbidden: knowing which zone it is drawing.

**npr/Glow** — owns banded emissive sprites, for the three things that must read as *emitting* rather than as lit: the wisp, the star, the wing forms.

**adaptive** — owns the live pixel ratio. Judged on p95 frame time, with hysteresis, under the ceiling the quality preset sets. Forbidden: touching anything but `setPixelRatio`.

There is **no post-processing chain**, and adding one back is a decision that has to go through DECISIONS.md.

---

## `physics/`

**PhysicsWorld** — owns the Rapier world, the fixed step, the collider registry, the body↔object mapping. Exposes `step()`, `createStatic/createDynamic/createCharacter`, `raycast`, `shapecast`, `bodyFor`. Forbidden: deciding *why* something moves. It resolves motion; it does not author intent.

**CharacterController** — owns the Rapier kinematic capsule, step offset, slope handling, ground snapping. Exposes `move(desiredTranslation)`, `grounded`, `groundNormal`, `computedMovement`. Forbidden: reading input, or knowing what a roll is.

**Queries** — owns raycast/shapecast helpers used by the camera, lock-on line of sight, ground probes, interaction probes.

**Ragdoll** (P8) — owns the death-time articulated body.

---

## `input/`

**InputSystem** — owns gamepad polling (inside the fixed step, never on a separate timer), radial deadzone, response curves, analog trigger reads, keyboard/mouse, device switching, connect/disconnect. Exposes an immutable per-frame `actions` snapshot: `move` (Vec2), `look` (Vec2), and per-action `pressed`/`held`/`released`/`value`. Forbidden: knowing what any action *does*. It publishes intent, never consequence.

**Bindings** — owns the action→physical-input map and rebinding. Two independent profiles, gamepad and keyboard/mouse, each tuned on its own terms rather than one scaled from the other.

**Buffer** — owns the ~266ms input buffer. Buffers during recovery frames only; **never during active frames**, because that is where commitment lives.

---

## `character/`

**Rig** — owns the shared skeleton and the runtime assembly of slot variant meshes onto it. Exposes `bones`, `attach(slot, mesh)`, `setVariant(slot, variant)`. Forbidden: playing animation, or knowing about alignment rules.

**AnimationSystem** — owns clip playback, blend trees, layer masks, root motion extraction, foot IK. Exposes `play(clipId, opts)`, `blendLocomotion(vec2, speed)`, `currentFrame`, `sampleRootMotion(dt)`, and emits animation events. Forbidden: applying root motion to the world itself — it *reports* delta, the controller applies it.

**PlayerController** — owns the player state machine, which state may transition to which, and the translation of input intent into motion requests. Exposes `state`, `position`, `facing`, `canAct()`. Forbidden: writing directly to the physics body (goes through `CharacterController`) and computing damage (goes through `combat/`).

**Alignment** — owns the seven slots' mechanical divergence and the material/VFX set for the active branch. Reads `GameState`, never writes progression except through `resolveSlot`.

---

## `combat/`

**MoveSet + data/** — owns frame data. Every move declares `startup`/`active`/`recovery` in frames, hitbox bindings, damage, poise damage, stamina cost, cancel windows. **Authored in data, never hardcoded in logic.** Adding a move must never require editing a system file.

**HitboxSystem** — owns hitbox/hurtbox capsules bound to bones, activation by animation frame, overlap resolution, once-per-swing hit registration. Exposes `activeHitboxes`, debug geometry. Forbidden: applying damage — it reports overlaps.

**DamageSystem** — owns damage, poise, stagger, criticals, deflect resolution, hit stop. Consumes overlap reports, emits `HIT_LANDED`/`DEFLECT_SUCCESS`/`STAGGERED`.

**LockOn** — owns target acquisition, cycling, distance and line-of-sight break. Emits `LOCKON_CHANGED`. Forbidden: moving the camera — the camera rig listens.

---

## `ai/`

**BossController** — owns the boss state machine, move selection, phase transitions, telegraph timing. Consumes the same `MoveSet` frame data the player does, so "readable and fair" is structural rather than a promise. Forbidden: reading player input, or bypassing `DamageSystem`.

---

## `level/`

**ZoneManager** — owns zone activation, per-zone atmosphere profiles, the chapter's three lights (key, fill, hemisphere ambient), and zone visibility gating. Emits `ZONE_ENTERED`/`ZONE_EXITED`. Forbidden: owning gameplay entities that outlive a zone.

The lights live here rather than in the zones for the same reason the profiles do: eight zone-authored point lights is how the scene ended up with twenty-five of them and a 25-iteration light loop on every fragment in the game.

**zones/** — each zone owns its own geometry, lights, props, colliders and teardown. Zones **never** reference each other. This is what makes the Phase 7 art fan-out safe.

**ZoneBuilder** — owns the construction context. `box()` and `ramp()` register **analytic cuboid** colliders and are the blockout primitives; `solid()` registers a trimesh and is the exception, for genuinely curved walkable surfaces only. A zone reaching for `solid()` by default is the bug this API exists to prevent — see DECISIONS D55.

**Water** — owns the water surface, depth query and the displacement written on boss breach. Exposes `depthAt(x, z)`, which movement reads to scale speed and dodge distance.

**Checkpoint** — owns rest state: restores flask charges, respawns enemies, holds progress.

---

## `companion/`

**Pigeon** — owns its own pathing, barks, and the three environmental tells. Forbidden, permanently and by design: touching combat. It never damages, heals, blocks, aggros, or assists. If it ever helps in a fight the character is broken.

---

## `audio/`

**AudioSystem** — owns the Web Audio graph, per-zone reverb, positional panning, the synthesis voices. Everything is synthesised at runtime; there are no audio files. Exposes `play(id, opts)`, `setZoneProfile(id)`. Forbidden: gameplay decisions.

The pigeon's speech is deliberately **non-positional** while its wing-flaps are positional. That mismatch is a tell, not a bug. Do not fix it.

---

## `ui/`

**HUD** — owns health, stamina, flask, boss bar, interaction prompts. Reads via events only; it never polls gameplay objects. Forbidden: influencing gameplay. No UI element is ever load-bearing.

---

## `debug/`

**DebugSystem** — owns the key layout (documented in `src/debug/DebugSystem.js`, with slots reserved through Phase 7), feature toggles, DOM panel registration. Exposes `isOn(feature)`, `registerPanel`.

**StatsOverlay** — owns the numbers reported at every phase gate and publishes `window.__VESSEL_PERF` for the smoke harness.

Debug code may read anything. It may never write gameplay state outside of the explicit cheat keys.

---

## Where the boundaries will be tested

Three places, called out now so they are decisions rather than accidents:

- **Animation ↔ combat.** The temptation is to let the animation system apply damage on a keyframe. It must not. Animation reports which frame it is on; `HitboxSystem` decides what is active; `DamageSystem` decides what that means.
- **Input ↔ character.** The temptation is to let input directly trigger a roll. It must not. Input publishes "dodge was pressed with the stick at this vector"; the player state machine decides whether a roll is legal right now.
- **Zones ↔ everything.** The temptation during the art pass is for a zone to reach into the post chain or the player. Zones declare a profile; `ZoneManager` applies it. A zone that imports from `character/` has broken the contract.
