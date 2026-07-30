# VESSEL — Chapter 1

A third-person souls-like built in Three.js, in the lineage of Elden Ring and
Black Myth: Wukong, rooted in Southeast Asian mythology. Chapter 1 is a
complete opening arc — void to sky, 25–40 minutes — with a movement system, a
full combat framework, a two-phase boss, a seven-slot alignment architecture
resolved by an irreversible wing choice, and a companion with a betrayal
hiding in plain sight.

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
| Left / Right click | Light / heavy attack |
| Q (hold) | Guard — a fresh press inside the window is a deflect |
| R | Use flask |
| E | Interact |
| Tab | Lock on / cycle target |
| C | Alignment ability |
| Esc | Pause + controls reference |

**Gamepad** follows the Xbox-style Elden Ring layout in
[CONTROLS.md](CONTROLS.md) exactly, including analog-trigger deflect.

**Debug overlay:** F1 stats · F2 hitboxes & frame data · F3 state inspector ·
F4 gamepad overlay · F8 pause (`.` steps one frame) · 1–5 warp to zone ·
8 wing choice · 9 boss fight · `-` die · `=` refill flask · backtick skip intro.

## Verifying a build

```bash
npm run smoke                          # headless boot + perf check
node tools/smoke.mjs --script walk --shot frame   # drives movement, captures a frame
node tools/probe.mjs --skipIntro --keys "Digit3:80" "api.player.state"  # ad-hoc inspection
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
  render/      Renderer, procedural texture/glow generation
  physics/     Rapier world, character controller, collision filters
  input/       Gamepad + keyboard/mouse, deadzone/curve handling, buffering
  character/   Rig, animation system, player controller, wings, flight
  combat/      Frame data, hitboxes, damage, vitals, lock-on
  ai/          Boss controller, boss rig and clips, frame data
  level/       Chapter geometry, zones, arena, checkpoints, fog gate
  companion/   The pigeon
  narrative/   Void sequence, wing choice
  ui/          HUD, boss bar
  debug/       Stats, hitbox viz, state inspector, gamepad overlay
tools/         smoke.mjs, probe.mjs — headless verification harnesses
```

## Build status

Phases 0–6 of the ten-phase plan in `PHASES.md` are complete: foundation,
movement, combat, the boss encounter, the full level blockout, the alignment
system with flight, and the companion with its three tells. Phases 7–10 (art
pass, motion & sound, performance pass, packaged build) have not started.

See [STATUS.md](STATUS.md) for the full breakdown, what's explicitly missing,
and which gates are feel-judgements reserved for a human rather than verified
automatically.

## Tech stack

Three.js (WebGL2, ACES tone mapping) · Rapier physics (kinematic capsule
controller) · Vite · procedural geometry/texture/animation, no binary assets.
Locked technical decisions and reasoning: [DECISIONS.md](DECISIONS.md).
