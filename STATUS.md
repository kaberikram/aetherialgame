# STATUS — where the build actually is

Phases 0 through 6 of `PHASES.md` are built, verified and pushed. Phases 7
through 10 are not started. This document is the honest handover.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run smoke        # headless boot + perf check
node tools/smoke.mjs --script walk --shot frame
node tools/probe.mjs --skipIntro --keys "Digit3:80" "api.player.state"
```

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
| **R** | flask · **E** interact · **Tab** lock-on · **C** alignment ability |

Gamepad follows `CONTROLS.md` exactly, including analog trigger deflect.

Debug: **F1** stats · **F2** hitboxes and frame data · **F3** state inspector ·
**F4** gamepad overlay · **F8** pause (**.** steps one frame) ·
**1–5** warp to zone · **8** wing choice · **9** boss fight · **-** die ·
**=** refill flask · **Esc** skip the intro.

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
| 7 Art pass | **not started** | |
| 8 Motion & sound | **not started** | |
| 9 Rubric & perf | **not started** | |
| 10 Playable link | **not started** | |

## What is NOT done, in priority order

1. **Post-processing chain (Phase 7).** There is no `EffectComposer` at all —
   no bloom, SSAO, tone-mapped grading beyond the renderer's ACES, no
   volumetrics, no per-zone LUT. `render/PostChain.js` is named in
   `docs/INTERFACES.md` and does not exist yet. This is the single biggest
   visual gap: the emissive water, the star and the daylight shaft are all
   authored expecting bloom, and currently read flatter than intended.
2. **Procedural material textures (Phase 7).** `render/procedural/textures.js`
   has a working `materialSet()` that generates tiling albedo/normal/roughness
   from FBM, and nothing calls it. Every surface is currently flat-coloured
   `MeshStandardMaterial`, which fails the rubric's "no default-material
   surfaces" line.
3. **Audio (Phase 8).** `EVENTS.SFX` is emitted from roughly forty places with
   correct ids and positions, and nothing listens. `audio/AudioSystem.js` does
   not exist. The wiring is done; the synthesis is not.
4. **Water rendering (Phase 7).** The Star Chamber pool is a vertex-displaced
   translucent plane with ripple propagation on boss breach. No SSR, no
   refraction, no depth-based murk.
5. **Foot IK, ragdoll, root-motion polish (Phase 8).**
6. **Performance (Phase 9).** No instancing, no LODs, no atlasing. 324 draw
   calls and 88k triangles — inside the 1,500 draw-call budget, but the CPU
   frame time has not been measured on real hardware.

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
