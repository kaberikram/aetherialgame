# VESSEL — Chapter 1

A third-person souls-like built in Three.js, in the lineage of Elden Ring and
Black Myth: Wukong, rooted in Southeast Asian mythology. Chapter 1 is a
complete opening arc — void to sky — with a movement system, a seven-slot
alignment architecture resolved by an irreversible wing choice, and a companion
with a betrayal hiding in plain sight.

**The current build is a cel-shaded grey-box blockout.** The whole chapter is
there at true scale and the flow runs end to end, but the art pass has been
rolled back and combat is out while the controls are tuned. See
**[STATUS.md](STATUS.md)** for exactly what runs and what does not.

Rendering is non-photorealistic throughout: anime cel shading with hard-banded
diffuse ramps, a Fresnel rim in place of specular, and ink line work on
silhouettes and interior creases. There is no post-processing chain and no tone
mapping. Zero PBR — that is a mechanical gate, not an aspiration:
`grep -rn 'MeshStandardMaterial\|MeshPhysicalMaterial' src/` must come back
empty.

Every mesh, texture, animation clip and sound effect is generated in code.
There are no binary art assets in this repo — see [DECISIONS.md](DECISIONS.md)
D4 for why that's the direction rather than a limitation.

Full design brief: [PROJECT.md](PROJECT.md). Build order and gates:
[PHASES.md](PHASES.md). Gamepad mapping: [CONTROLS.md](CONTROLS.md). Current
build status and what's left: **[STATUS.md](STATUS.md)**.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL. Click the canvas once to capture the mouse.

## Controls

**Keyboard / mouse** (tuned as its own scheme, not derived from the gamepad):

| Input | Action |
|---|---|
| WASD | Move (hold **Alt** to creep) |
| Mouse | Camera — click once to capture the pointer |
| Space | Dodge / roll — direction read from WASD at the press |
| Shift | Sprint |
| F | Jump; once wings resolve, takeoff and hold to flap-climb |
| R | Use flask |
| E | Interact |
| Esc | Pause + controls + look settings |

Attack, guard and lock-on are unbound: there is no combat in this build.

**Gamepad** follows the Xbox-style Elden Ring layout in
[CONTROLS.md](CONTROLS.md) for everything that still exists. The combat half of
that mapping is dormant along with combat itself.

**Debug overlay:** F1 stats · F3 state inspector · F4 gamepad overlay ·
**F5 physics colliders** · **F7 freecam** · F8 pause (`.` steps one frame) ·
F11 grayscale · `[` `]` time scale · 1–5 warp to zone · 8 wing choice ·
9 boss · `-` die · `=` refill flask · backtick skip intro.

## Verifying a build

```bash
npm run smoke        # headless boot, zero console errors, perf counters
npm run controls     # strafe/look, tap-vs-hold dodge, crouch, the crawl
npm run collision    # ground, continuity, spawns, grid sweep, wedges
npm run playthrough  # plays the chapter void → oculus, checks all 8 beats
node tools/perf.mjs  # scene passes, draw calls, triangles, pixels per frame
node tools/probe.mjs --skipIntro --keys "Digit3:80" "api.player.state"
```

`tools/smoke.mjs` drives the preinstalled Chromium headlessly, asserts zero
console errors, and reports draw calls / triangles / CPU frame time against
the budget in `PROJECT.md`. `tools/probe.mjs` boots the build and evaluates an
arbitrary expression against the live engine — see its header comment for the
full flag set (`--pre`, `--keys`, `--clicks`, `--hold`, `--shot`).

## Architecture

Module boundaries, ownership and the fixed-timestep contract are written up in
[docs/INTERFACES.md](docs/INTERFACES.md). The short version: `Engine` owns the
frame at a fixed 60Hz simulation step decoupled from render; everything else
communicates through a declared `EventBus` rather than reaching into each
other's internals.

```
src/
  core/        Engine, EventBus, GameState, Clock
  render/      Renderer, adaptive pixel ratio
  render/npr/  the cel material, the ink pass, banded glow sprites
  physics/     Rapier world, character controller, collision filters
  input/       Gamepad + keyboard/mouse, deadzone/curve handling, buffering
  character/   Rig, animation system, player controller, wings, flight
  combat/      Vitals (the rest is out — see STATUS.md)
  level/       Chapter geometry, zones, arena, checkpoints, fog gate
  companion/   The pigeon
  narrative/   Void sequence, wing choice
  ui/          HUD, pause menu
  debug/       Stats, state inspector, collider view, freecam, gamepad overlay
tools/         smoke.mjs, probe.mjs — headless verification harnesses
```

## Build status

Phases 0–8 landed and the Phase 7 art pass was then rolled back: it made the
game unplayable on the target machine, and the art direction changed to NPR
underneath it. The current build is a cel-shaded blockout with the flow intact
and combat stubbed.

See [STATUS.md](STATUS.md) for the full breakdown, the measured before/after,
what's explicitly missing, and which gates are feel-judgements reserved for a
human rather than verified automatically.

## Tech stack

Three.js (WebGL2, cel-shaded NPR, no post chain, no tone mapping) · Rapier
physics (kinematic capsule controller against analytic cuboids) · Vite ·
procedural geometry/animation/audio, no binary assets. Locked technical
decisions and reasoning: [DECISIONS.md](DECISIONS.md).
