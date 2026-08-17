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
| standable grid samples audited | 0 (centreline only) | **1,737** |
| collider-vs-mesh disagreement, whole chapter | unmeasured | **none above 5cm** |

Draw calls are 14× inside the 1,500 budget and triangles are ~100× down, so
neither is the limit any more. **Frame time is still unmeasured on the target
machine** — this container renders through SwiftShader, so every millisecond it
reports is a fact about a software rasteriser (D51). `?bench` on the M1 is the
number that settles the original complaint, and it has not been run.

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
npm run collision    # ground, continuity, spawns, grid sweep, wedges
npm run playthrough  # plays the chapter void → oculus and checks all 8 beats
node tools/perf.mjs  # scene passes, draw calls, triangles, pixels per frame
npm run build        # production build
```

All five pass on this build, and `npm run build` succeeds. `tools/rubric.mjs`
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
