# STATUS — where the build actually is

The chapter shipped its art pass in Phase 7 and became unplayable on the target
machine. This build is the reset: **a cel-shaded grey-box blockout of the whole
chapter, with the flow intact and combat stubbed**, rebuilt so that controls and
navigation can be judged against geometry that is honest about what it is.

Read `DECISIONS.md` D53–D61 for why each thing went. This document is the
honest handover of what runs today.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

`?quality=off|low|medium|high` selects the render preset (default `high`).
`?bench` runs the fixed route through every zone and reports p50/p95 frame time.
`?capture` enables `preserveDrawingBuffer` for the screenshot harnesses — it is
off in normal play because it costs a back-buffer copy every frame.

## Controls

| | |
|---|---|
| **WASD** | move (hold **Alt** to creep) |
| **Mouse** | camera — click once to capture the pointer |
| **Space** | dodge / roll — direction from WASD at the press |
| **Shift** | sprint |
| **F** | jump; once wings resolve, takeoff and hold to flap-climb |
| **C** | crouch (a toggle, like Elden Ring's L3) |
| **LMB / RMB** | light / strong attack · **Q** guard · **V** weapon art · **Tab** lock-on |
| **R** | flask · **E** interact · **X** alignment ability · **Esc** pause |

On a pad the layout is Elden Ring's, verified button by button — see
`CONTROLS.md`. **Tap B rolls, hold B sprints**; L3 crouches. Player-side combat
is back (attacks, guard, deflect, lock-on, hitboxes); the boss AI is not.

Debug: **F1** stats · **F3** state inspector · **F4** gamepad overlay ·
**F5** physics colliders · **F7** freecam · **F8** pause (**.** steps one frame) ·
**F11** grayscale · **1–5** warp to zone · **8** wing choice · **9** boss ·
**-** die · **=** refill flask · **[** **]** time scale · **`** skip the intro.

## What this build is

| | |
|---|---|
| Renderer | NPR only. One cel material, one ink pass, no post chain, no tone mapping. `grep -rn 'MeshStandardMaterial\|MeshPhysicalMaterial' src/` is empty and that is the art-direction gate. |
| Level | The full chapter at true scale, in grey boxes. Every waypoint, distance and pacing beat is the number it was. |
| Flow | Intact end to end: void → embodiment → descent → sword → fog gate → boss → wings → flight → oculus. Beats 1–8 are a real enum (`narrative/Beats.js`) and all eight fire. |
| Combat | **Player side only.** Attacks with real frame data, guard, deflect, lock-on, hitboxes and damage. The boss AI is still out. |
| Boss | A stub with vitals and a hurtbox that you kill with R1. It keeps the chain from the fog gate to the wing choice unbroken; it does not fight back. |
| Kept | Movement, camera, physics, stamina, vitals and the death/respawn loop, the alignment system, wings, flight, the pigeon, synthesised audio, the HUD. |

## Measured

Hardware-independent, from `node tools/perf.mjs`, against the previous build:

| | before | after |
|---|---|---|
| scene passes / frame | 2 (10 at `ultra`) | **1** |
| full-screen quads | 17 | **0** |
| point lights | ~25 | **0** (one key, one fill, one hemisphere) |
| draw calls, worst vantage | 821 | **105** |
| triangles, worst vantage | ~350k | **3.6k** |
| Green Vein collider vs its own height function | 0.55m | **0.01m** |
| standable grid samples audited | 0 (centreline only) | **8,216** |
| collider-vs-mesh disagreement, whole chapter | unmeasured | **none above 5cm** |
| edges you can walk off the world from | unmeasured, 416 when first measured | **47** |

Draw calls are 14× inside the 1,500 budget and triangles are ~100× down, so
neither is the limit any more. **Frame time is still unmeasured on the target
machine** — this container renders through SwiftShader, so every millisecond it
reports is a fact about a software rasteriser (D51). `?bench` on the M1 is the
number that settles the original complaint, and it has not been run.

## Holes — where the level still is not solid

Every route used to state its width twice: once building its floor, again
building the walls meant to keep you on it, with nothing reconciling the two.
`ZoneBuilder.path()` now takes the width once and emits both. The Green Vein,
the pool approach and the pagoda corridor are rebuilt on it; the Star Chamber's
dais and balustrade are built to the same rule by hand. See DECISIONS D67–D68.

**416 unguarded edges → 47.** What is left, with coordinates, from
`npm run collision` check 7:

| where | count | what |
|---|---|---|
| Descent | 45 | x −9…6.8, z 6…25.5. Its shell walls sit 5.8m off the spine; the floors that pass over the lower route cannot be widened to match without sealing the crawl. |
| Green Vein | 2 | x 11.3–12.0, z −54.7, at the handover to the pool stairs. |

Plus an 8-cell slot (x 0.8–5.3, z 6.8–19.5) where the Descent's two routes
converge and their walls interleave — check 8 confirms it by driving the real
controller, so it is real.

**The Descent is the hard one and it is hard for a reason.** It is two stacked
routes sharing one shell: the main line, and the lower route you land on by
missing the jump. A `ramp` hangs its thickness BELOW its surface, so widening a
floor that passes over another one drags a slab across the corridor beneath —
and because a ramp is a rotated box, widening also spreads its footprint along
its own axis, so a corner reaches back over the crawl and its extrapolated plane
sits 0.6m above the route below. Both were found by the headroom profile
(`COLLISION_DEBUG=1 npm run collision`), which is now the tool for this corner
of the level and is worth reaching for before touching any of its numbers.

What is in: the segments above the lower route are widened to the shell's clear
width, the one passing over it is thinned to 0.35m so its underside clears, and
the crawl's pinch is owned by one slab that exists to be a pinch. The lower
route is now crouch-passable end to end — `controls` reports the crouched
capsule reaching z3.65 where it used to stop at z7.66.

What is not: the last 45 edges need floors and walls off ONE spine and width,
and neither can move to meet the other — moving the floor re-seals the crawl
(the ramp's start sets its slope), and moving the spine takes the walls off the
ledges. Joint overlaps were tried and reverted: they closed wedges but collapsed
the audit's reachable set from 7,807 cells to 635, and an improvement that
cannot be measured is not one. The real fix is one enclosure sized to both
routes' union rather than a spine and a width each — a rewrite, not a number.

**There is no fall backstop.** No kill plane, no respawn-on-fall — by choice, so
the geometry gets trusted. Until the 47 are gone, those are the places that
choice costs you.

## What is NOT done

1. **Frame time on real hardware.** The whole point of the pass. Run `?bench`.
2. **Controls tuning.** The defects found by audit are fixed (see D59, D60) and
   the ground normal is now real, but the *feel* judgements are still open —
   they are the human gates below.
3. **The boss AI and the fight.** Player-side combat is back; the boss is still
   a stub with a health pool and no moves.
4. **The art pass.** Everything visible is a grey box with an ink line on it.
   The cel pipeline is established; nothing has been designed with it yet.
5. **God rays.** Deleted (D54). Under cel shading their replacement is drawn
   geometry, which is art-pass work.
6. **Cast shadows from anything but the key**, and no contact shadow under the
   character. `Renderer.freezeShadows()` is in place for when casters return.
7. **Rebinding.** `CONTROLS.md` has promised it since Phase 2 and it still does
   not exist — no `Bindings` module, no rebind screen. The map is correct now
   but it is not yet changeable.
8. **Sprint attack, jump attack, roll-into-sprint.** Named in the Elden Ring
   feel pass and not built. The bindings are the easy half; these are the half
   that makes it read as Souls.
9. **The beat sheet and the level disagree about the pool.** PROJECT.md puts the
   Still Pool (beat 4) before the Sword (beat 5) — you are meant to be scared
   while unarmed. The level puts the sword at z−30 and the pool at z−55, so
   walking the chapter fires 5 before 4. `npm run playthrough` reports the order
   every run. This is a design call, not a defect, and it is yours: either move
   the sword past the pool approach, or renumber the beats.

## Verification

```bash
npm run smoke        # headless boot, zero console errors, perf counters
npm run controls     # strafe/look, tap-vs-hold dodge, crouch, the crawl
npm run collision    # ground, continuity, spawns, grid sweep, edges, pits, wedges
npm run playthrough  # plays the chapter void → oculus and checks all 8 beats
node tools/perf.mjs  # scene passes, draw calls, triangles, pixels per frame
npm run build        # production build
```

`smoke`, `controls`, `playthrough`, `perf` and `build` all pass.
**`collision` does not, and that is the honest state of the level** — see
"Holes" below. `tools/rubric.mjs`
still runs but has nothing to judge yet — it captured against concept boards, and
there is no art in frame.

**`npm run playthrough` is the one that matters most**, because it is the only
one that plays the game. It found six bugs nothing else could have: a beat with
no emitter, a fog gate that re-sealed with the player locked outside it, an open
pit around the boss arena, a containment ring that both leaked and blocked the
only way in, a final room that could not be entered on foot, and temple steps
too tall to climb. See DECISIONS D62–D66.

## Gates that are yours, not mine

`PHASES.md` reserves the feel gates for a human and it is right to. Every
constant they bear on is in `src/tuning.js`, so notes turn into single-number
edits.

- **P1** — does moving around the blockout feel good on its own? Specifically:
  the Green Vein slope, the Descent step-ups, and the 2.6m jump.
- **P4** — is the pacing right? Is the descent too long? Does the Star Chamber
  feel big? This is easier to answer now than it was: nothing in frame is
  distracting from the shape of the space.

Two things worth doing on the first run: press **F5** and walk the whole
chapter — every surface you can stand on should have a collider under it and
none should float. Then press **F11** and check the frame still reads in
grayscale, which is the rubric line the blockout is most at risk of failing.

## One design note that is not a defect

The Descent's 2.6m gap has a **second, lower path underneath it**. Missing the
jump drops you 3.8m onto a longer, gentler route that rejoins the main line at
the bottom — it costs the walk, not health. That is deliberate: it is the first
jump the game asks for, and the lesson should be "jumps are a thing you do", not
"jumps are a thing you die to". It also means the critical path has ground
beneath it everywhere, which the collision audit requires.
