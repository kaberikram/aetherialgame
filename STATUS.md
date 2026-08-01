# STATUS — where the build actually is

Phases 0 through 6 of `PHASES.md` are built, verified and pushed. Phase 7 (the
art pass) and the audio half of Phase 8 are in progress. Phases 9 and 10 are
not started. This document is the honest handover.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run smoke        # headless boot + perf check (runs at quality=low)
npm run rubric       # deterministic 1600x900 capture set for the critic pass
node tools/smoke.mjs --script walk --shot frame
node tools/rubric.mjs --only greenVein --port 5301   # one zone, for a tight loop
node tools/probe.mjs --skipIntro --keys "Digit3:80" "api.player.state"
```

`?quality=off|low|medium|high` on the URL selects the render preset. The smoke
harness uses `low` because it is testing whether the game runs, not how it
looks; the rubric harness uses `high`. See `src/render/quality.js`.

## Controls

Keyboard/mouse (tuned as a first-class scheme, not derived from the pad):

| | |
|---|---|
| **WASD** | move (hold **Alt** to creep) |
| **Mouse** | camera — click once to capture the pointer |
| **Space** | dodge / roll — direction from WASD at the press |
| **Shift** | sprint |
| **F** | jump; once wings resolve, takeoff and hold to flap-climb |
| **LMB / RMB** | light / heavy attack |
| **Q** | guard (hold) — a fresh press inside the window is a deflect |
| **R** | flask · **E** interact · **Tab** lock-on · **C** alignment ability · **Esc** pause/controls |

Gamepad follows `CONTROLS.md` exactly, including analog trigger deflect.

Debug: **F1** stats · **F2** hitboxes and frame data · **F3** state inspector ·
**F4** gamepad overlay · **F8** pause (**.** steps one frame) ·
**1–5** warp to zone · **8** wing choice · **9** boss fight · **-** die ·
**=** refill flask · **Esc** pause / controls · **`** (backtick) skip the intro.

## What is done

| Phase | State | Notes |
|---|---|---|
| 0 Foundation | done | Engine, fixed 60Hz step, EventBus, contracts, debug layout |
| 1 Movement | done | Capsule, camera, roll, stamina, lock-on, void→body |
| 2 Combat | done | Frame data, hitboxes, poise, deflect, flask, death loop |
| 3 Boss | done | The Drowned, two phases, arena, fog gate, retry |
| 4 Blockout | done | Whole chapter, void to oculus, SEA architecture kit |
| 5 Wings | done | Seven-slot alignment, the choice, chamber reaction, flight |
| 6 Companion | done | Pigeon, barks, and the three tells |
| 7 Art pass | **first pass done** | Pipeline, materials, volumetrics, water, three zones |
| 8 Motion & sound | **audio done** | Synthesis + reverb + footsteps; IK, ragdoll, VFX outstanding |
| 9 Rubric & perf | **not started** | |
| 10 Playable link | **not started** | |

## What is NOT done, in priority order

1. **The critic's outstanding defects (Phase 7, second loop).** One critic pass
   has run against the concept boards. The chapter is not finished until its
   ranked failures are closed — the loop is capped at five passes per zone and
   has used one.
2. **Foot IK, ragdoll, root-motion polish, VFX (Phase 8).** The audio half of
   Phase 8 is done; the motion half is not. Wing-burst VFX, water displacement
   beyond the existing boss breach, and impact effects are outstanding.
3. **Performance (Phase 9).** No instancing, no LODs, no atlasing. Draw calls
   peak at 821 of the 1,500 budget, which is fine — but triangles roughly
   doubled during the art pass, to ~350k at the heaviest vantage, and that is
   the number to watch. Nothing has been measured on hardware with a GPU.
4. **Packaged playable build (Phase 10).**
5. **The character himself.** The player mesh is still an untextured grey-white
   mannequin in every frame. It is the most conspicuous unfinished thing in the
   captures, and it belongs to the alignment system's seven slots rather than
   to any zone, so no zone agent owned it.

## Known structural issue, worked around rather than fixed

The Green Vein's walkable floor is built from 8m boxes that each sample
`GREEN_VEIN_FLOOR(z)` at their own centre, so the boxes and the continuous
function disagree by up to ~0.55m away from those centres. Anything that
derives its height from the function rather than from the boxes will float or
sink. The water ribbon works around this with a local helper that mirrors the
box selection. Fixing it properly means rebuilding collision geometry that has
already passed its pacing gate, so it was deliberately left alone.

## Performance caveat

All numbers in the commit messages come from headless Chromium on SwiftShader
(software GL). **Reported FPS is a floor and CPU frame time is inflated** —
render *dispatch* dominates there in a way it will not on a real GPU. Draw
calls and triangle counts are accurate. The budget in `PROJECT.md` (60fps at
1440p, <1,500 draw calls, <4ms CPU) has not been measured on the hardware it
describes.

## Gates that are yours, not mine

`PHASES.md` reserves the Phase 1–4 gates for a human, and it is right to. I can
verify frame data, silhouette readability, draw calls and grayscale value
structure. I cannot tell you whether the roll feels good or whether the grey-box
boss was fun. Those four gates are **passed provisionally on my judgement only**:

- **P1** — does moving around an empty grey room feel good on its own?
- **P2** — does an attack feel like a decision you are committed to? Can you
  deflect on reaction?
- **P3** — was the fight fun while made of grey boxes?
- **P4** — is the pacing right? Is the descent too long? Does the Star Chamber
  feel big?

Every constant those questions bear on is in `src/tuning.js`, so notes turn
into single-number edits rather than refactors.

## Two things worth knowing before you tune

- Combat frame data and animation keys are the **same numbers** — a move's
  `active: [12, 17]` in `combat/data/playerMoves.js` refers to the same frames
  as the keys in `character/clips/attacks.js`. Retiming a swing means editing
  both, and they cannot silently disagree.
- Attack arcs are constrained by rig geometry in a way that is easy to get
  wrong by eye. `upperArm.x` past −90° points the arm *upward* and the blade
  sails over everything. See DECISIONS.md D15; `tools/probe.mjs --pre` can
  instrument the fixed step to measure real capsule gaps.
