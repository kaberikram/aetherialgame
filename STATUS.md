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
| **R** | flask · **E** interact · **Esc** pause / controls / settings |

Attack, guard and lock-on are unbound: **there is no combat in this build.**

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
| Combat | **Gone.** So are the boss AI, hitboxes, damage, lock-on and the move set. |
| Boss | A stub you walk up to and interact with, which emits `BOSS_DEFEATED`. It exists to keep the chain from the fog gate to the wing choice unbroken. |
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
3. **Combat, the boss, and the fight.** Deleted at declared seams, to come back.
4. **The art pass.** Everything visible is a grey box with an ink line on it.
   The cel pipeline is established; nothing has been designed with it yet.
5. **God rays.** Deleted (D54). Under cel shading their replacement is drawn
   geometry, which is art-pass work.
6. **Cast shadows from anything but the key**, and no contact shadow under the
   character. `Renderer.freezeShadows()` is in place for when casters return.

## Verification

```bash
npm run smoke        # headless boot, zero console errors, perf counters
npm run controls     # 8 strafe/look assertions at 4 camera yaws
npm run collision    # ground / continuity / spawn / height-function audit
node tools/perf.mjs  # scene passes, draw calls, triangles, pixels per frame
```

All four pass on this build. `tools/rubric.mjs` still runs but has nothing to
judge yet — it captured against concept boards, and there is no art in frame.

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
