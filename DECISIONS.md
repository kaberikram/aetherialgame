# DECISIONS.md

Every locked design or tech choice, with the reasoning. Appended to as phases land. Reversing something here means editing the entry with why, not deleting it.

---

## P0 — Foundation

### D1. Build tooling: Vite, vanilla ES modules, no framework
The game loop owns the frame. A UI framework wants to own it instead, and reconciling the two costs more than the ergonomics are worth. HUD is plain DOM driven by events — a health bar is a `style.width` write, not a component tree. Vite gives module HMR during tuning, which matters when you are adjusting a roll's i-frames twenty times in a row.

### D2. Physics: Rapier via `@dimforge/rapier3d-compat`
Specified by `PROJECT.md`, and the right call independently. Rapier's `KinematicCharacterController` gives autostep and snap-to-ground natively, which is precisely the souls capsule — the alternative is hand-rolling capsule-vs-trimesh sweeps and rediscovering every stair-clipping bug the last decade already solved. The `-compat` build inlines its WASM as base64, so there is no second network fetch and the single-file web build stays possible.

### D3. Fixed 60Hz simulation, decoupled render
Combat is authored in frames. "14 startup, 4 active, 22 recovery" is a contract with the player's muscle memory, and it is meaningless if a step can be 8ms on one machine and 30ms on another. Rendering interpolates so high-refresh displays still get smooth motion.

Backlog past 5 sub-steps is **discarded, not deferred**. Trying to catch up after a hitch produces a second, longer hitch.

### D4. Everything procedural — no binary assets
There are no art assets and no way to make them here. Rather than treat that as a limitation, it is the direction: every mesh, texture, animation clip and sound is generated in code.

This is a better fit than it sounds. The concept boards are painterly value-blocking — the Star Chamber board is three values of indigo, one white star, and hard falloff to black. Flat value structure is what procedural generation does well; it is scanned-surface micro-detail that it does badly, and the boards do not ask for any. It also means the repo has no binary bloat and every visual is tunable by editing a number.

### D5. Character: procedural `SkinnedMesh` on a code-built rig
A ~22-bone humanoid skeleton constructed in code, with body geometry built from primitives and rigidly weighted one segment per bone. Rigid weighting is normally a downgrade; here it is the point — it produces hard, unambiguous silhouettes, which is exactly what the rubric's "readable at 10% screen height" line demands.

### D6. Animation: keyframe pose data in JS, sharing a source with frame data
Clips are authored as arrays of bone poses at explicit frame numbers, in the same data files as the combat frame data. So a move's startup/active/recovery **is** the animation rather than a parallel description of it that can drift out of sync. Hitboxes activate on the frame the pose says they should, by construction.

### D7. Module boundaries enforced by a declared event registry
`EventBus` throws on an undeclared event name. A typo'd event that silently never fires is the hardest bug class to find in a system this size, and one `Object.freeze` block eliminates it. Full contracts in `docs/INTERFACES.md`.

### D8. All feel constants in one file
`src/tuning.js` holds every number that changes a player's opinion of the game. The Phase 1–4 gates are feel judgements that will produce notes like "the roll recovers too fast" — those need to be one-number edits, not refactors.

### D9. Verification: Playwright against the preinstalled Chromium
`tools/smoke.mjs` boots the build, drives it, asserts zero console errors and reports the budget numbers. It launches with an explicit `executablePath` because the environment's preinstalled Chromium revision does not match the playwright package's expectation — downloading a second browser is wasteful and, in a locked-down environment, unreliable.

Headless runs on SwiftShader (software GL), so **reported FPS is a floor, not the real number**. CPU frame time and draw calls are the meaningful signals from this harness; FPS is judged on real hardware.

### D10. Boss design: reconciling the doc with the concept board
`PROJECT.md` describes "the thing in the pool — scales like oil, teeth catching star-light." The concept board shows something different: a masked, long-haired figure whose many long limbs unfold from cave water.

The rubric makes the board authoritative ("does the frame match its concept board"), so the two merge rather than one winning. The boss is a drowned masked thing: a porcelain mask catching the star, oil-black hair and limb-plates, six long limbs that unfold out of the pool. This reads as Southeast Asian folk-horror rather than a Western dragon, satisfies "teeth catching star-light" through the mask, and every limb is a separately readable silhouette element for telegraphing.

### D11. Keyboard/mouse tuned separately, not derived from the gamepad
`CONTROLS.md` is gamepad-first and correct to be. But a keyboard has no analog magnitude and no trigger velocity, so deriving its feel by rescaling gamepad curves produces a scheme that is bad in a specific, hard-to-diagnose way. Two independent tuning profiles under `TUNING.input`. Practically: the build must be judgeable in a browser with nothing plugged in.
