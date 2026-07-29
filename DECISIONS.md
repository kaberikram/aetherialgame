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

---

## P2 — Combat framework

### D12. Frame data and animation share one source
A move's `startup / active / recovery` in `combat/data/playerMoves.js` uses the same frame numbers as the keys in `character/clips/attacks.js`. The hitbox opens on the frame the pose says the blade is out because there is exactly one number, not two that have to be kept in agreement. Any other arrangement drifts the first time someone retimes a swing.

### D13. Buffering during recovery only, never during active frames
`InputBuffer` holds one queued action for ~266ms, and `PlayerController` only ever pushes to it from `#inRecovery()`. Buffering during active frames would let the player retroactively take back a committed swing, which is precisely the thing `PROJECT.md` says must not be possible.

Chaining is deliberately *not* implemented as cancelling. A queued chain input is remembered and the next move starts when the current move's `chainWindow` opens inside recovery — so a string is a decision made after seeing the swing land.

### D14. Hitboxes are fatter than the blade
`SWORD_HITBOX` has a 0.25m radius against a 0.05m-thick blade mesh. A hitbox that matches the geometry whiffs on swings the player watched connect, and that reads as the game cheating. Measured with `tools/probe.mjs`: the tuned swing clears the target hurtbox by ~0.12m rather than the 0.05m the exact-fit version managed, which is the difference between reliable and intermittent.

### D15. Arm poses must stay below horizontal during active frames
The blade runs along the hand bone's local −Y, the same axis the arm hangs along, so the only thing that puts the blade in front of the character is raising the upper arm. Past −90° on `upperArm.x` the arm points *upward* and the blade sails over everything at head height. Every active frame in `attacks.js` keeps that value between roughly −44° and −78°. This was found by measurement, not by eye: the first pass looked like a correct swing and connected with nothing.

### D16. Input edge detection survives dropped frames
A press that begins and ends between two sampled steps used to be lost entirely, because `pressed` was derived only from `held && !wasHeld`. On a frame hitch that silently eats a click. `InputSystem` now also treats a key or button recorded in the current step's fresh-press set as a press. Found because the headless harness runs at ~10fps under software GL, which turned a rare real-world bug into a constant one.

### D17. Hit stop as a time scale, not a freeze
`DamageSystem.timeScale` drops to 0.06 for 5–8 frames on contact and the player controller multiplies its animation and frame counters by it. Physics still steps normally so nothing tunnels. This is the cheapest large win in the whole combat system — it is most of what makes a sword feel like it has mass.

### D18. Poise regenerates on a delay; hyper-armor suppresses poise damage only
Light strings exist to break poise; heavies exist to trade. Hyper-armor during a heavy's wind-up absorbs *poise* damage but not health damage, so committing to a heavy means you finish the swing and you still bleed for it. A staggered target holds poise at zero for the whole stagger, so a break is a real opening rather than a flinch.

---

## P3 — The boss, grey box

### D19. The boss runs on the player's frame-data schema
`ai/data/bossMoves.js` uses the same `startup / active / recovery` shape, the same `HitboxSystem`, and the same `Vitals` as the player. "Readable and fair" is therefore structural rather than a promise: recovery is a real punish window measured in the same units the player's is.

### D20. Attacks stop tracking at `trackUntil`
Every move declares the frame after which it no longer turns toward the player. Without that, dodging a homing attack is a coin flip rather than a read, and the entire dodge-timing skill the genre is built on evaporates.

### D21. Wind-ups differ in silhouette, not detail
Each attack loads a different set of limbs and puts the mask at a different height — lunge high and coiled, sweep low and turned, slam with both arms straight overhead, skitter tipped onto one side. The rubric asks whether a paused wind-up is nameable; that is only achievable if the poses differ at silhouette scale, so the clips are authored against that constraint rather than against realism.

The delayed strike is deliberately identical to the lunge for its first 20 frames. It is fair because the hold that follows is 22 frames of genuine stillness (authored as two identical keys, so it does not drift), which is ample time to see it and stop.

### D22. The arena is a mechanic, expressed only in geometry
Depth rises from a shallow rim to a deep centre, and `TUNING.water` makes depth cost movement speed and dodge distance. Safety versus reach becomes a standing decision with no UI and no tutorial. The profile is a plateau then a bowl rather than a smooth cone, so "am I in the deep part" is something the player can feel rather than estimate.

### D23. Containment walls are not camera blockers
A new `FILTERS.containment` group stops the player leaving an arena while being invisible to camera sweeps. Sharing one group meant the camera collided with a wall the player could not see and shoved itself into the back of their head at exactly the moment the boss was doing something worth looking at.

### D24. Tall targets raise the pivot; they do not pitch the camera down
Framing a 2.4m creature at 3m range by pitching down and looking up drives the camera into the floor. Instead the lock-on pivot lifts toward the target's lock point and pitch is clamped to stay at or above the pivot. A hard floor guard backs it up, because a camera under the ground plane produces a black frame — worse than any framing compromise.

### D25. The camera is confined to the arena circle
`CameraRig.bounds` keeps the camera inside the dais rather than letting it drift behind the dais rim stonework. Solved analytically against the circle rather than with a collider ring, because a collider ring would also stop the camera backing off from a large target — and backing off is exactly what a large target needs.

### D26. Boss hitboxes sized by measurement, not by eye
The first pass opened hitboxes correctly and still never touched the player: the closest approach across a full attack was 1.18m of clear air. Limb capsules were widened (0.4→0.85 on the femur, body 1.15→1.75), the lunge's travel extended from 5.4m to 8.6m, and engagement bands pulled in to match actual reach. Verified by instrumenting the fixed step and recording the minimum capsule gap across every active frame.

---

## P5 — Alignment and flight

### D27. Seven slots registered, one populated
`Alignment` holds a registry of all seven slots with their attach bones; six have `null` variant factories. That is a normal state, not an error — the assembly path skips them. Populating `head` later is one registry entry and zero changes anywhere else, which is the entire point of building the architecture before it is needed.

### D28. The choice is a movement, not a menu
Two forms rise from the water and the player walks into one. No prompt, no cursor, no confirm step, no labels. The forms brighten as the player nears them, so approach reads as intent before the commitment lands, and the only description the game ever offers is the shape itself — a fan of hard primaries versus a membrane on splayed fingers.

### D29. The chamber reaction changes the star, not a tint
Light drives the star from 46 to 80 and the ambient scale to 2.06×; dark drives the star to 11 and the ambient to 0.37×. Because it is the light's actual output, every shadow in the chamber moves. A colour grade would have been cheaper and would have failed the "same room, two rooms" line.

`ZoneManager.reactionScale` is a separate multiplier on top of the zone profile rather than an overwrite, so the chamber keeps its own identity through the change.

### D30. Flight heading follows the camera
PHASES.md asks for an exit that is "a triumph rather than a fight with the camera", so flight is deliberately not a free six-axis controller. Heading comes from the camera, the player controls throttle and climb, and banking is a consequence of turning rather than an input. That leaves one thing to be good at — altitude against a stamina cost — which is enough for one ascent and not enough to be fiddly.

---

## P6 — The companion

### D31. The three tells are structural, never dialogue
1. **The shadow.** A knight silhouette — helm, pauldrons, a long blade held point-down — is parented under the bird on render layer 1. The main camera has layer 1 disabled, so it is invisible; shadow-map rendering ignores the camera's layer mask, so it still casts. The bird's own body has `castShadow = false`. The shadow on the floor is a person's, and it is holding a sword.
2. **The star.** A hard repulsor around the star's pool of illumination, strong enough that the bird visibly takes the long way round rather than crossing it.
3. **The sword.** On pickup it recoils hard and its line is cut off mid-word.

### D32. Positional flaps, non-positional voice
`PROJECT.md` calls the mismatch deliberate, so the wing-flap SFX carries a position and the speech does not. It is the fourth tell, and the one most likely to be felt rather than noticed.

### D33. Companion pathing scans rather than increments
The first version advanced a waypoint index forward only, which left the bird stranded at the start of the chapter after any warp, death respawn, or backtrack. It now finds the waypoint nearest the player each step and leads from the next one.
