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


---

## First-playtest fixes

### D34. The guidance layer must never be hidden with the HUD
The first playtest was unplayable because `hud.setVisible(false)` during the void hid the subtitles and the interact prompt along with the stat bars — every line and prompt fired into an invisible layer. The HUD now splits into stat bars (hidden when there is no body) and a narrative layer (subtitles, prompts, hints) that is always live. The smoke harness's `intro` script asserts this stays true.

### D35. Escape never skips content
The debug intro-skip sat on Escape — the most natural key for a confused player, and the browser's own pointer-lock-release key. Pressing it silently teleported past beat 1, which the playtester experienced as "suddenly I'm at the next scene." Skip now lives on backtick with the other debug keys; Escape opens a pause overlay listing the controls for the active device.

### D36. One scoped deviation from "no tutorial popups"
PROJECT.md forbids tutorial popups and is right about gameplay. But a web game cannot teach pointer lock through geometry: a mouse camera that silently does nothing is undiscoverable. One quiet hint line exists for input affordances only — "wasd — drift · click, then move mouse — look" in the void, gone permanently once the player has done both, plus "click to look around" whenever the pointer is unlocked on KB/M. Nothing about the game is ever taught this way.

### D37. The corpse announces itself
The body spawned 15m away after 5s, lit only by the player's falloff (~2% at that range) on a black screen. It now appears at 2.5s, 9m ahead, in the camera's snapped view direction, with its own pale gleam — and the pigeon hovers over it, per the beat sheet, so its opening line has a visible speaker. Same beat, now legible.

### D38. The pointer-capture click is spent
A mousedown while the pointer is unlocked only captures the pointer; it no longer also registers as an attack. Auto-recenter is likewise gamepad-only now — a mouse user parks the camera deliberately, and a camera that drifts back on its own reads as the game wrestling the mouse away.


---

## P7 — Art pass

### D39. The zones became separate files before any agent touched them
`Chapter1.js` held all three environment zones and the shared material table in
one 600-line file. Three art agents working in parallel on that file is the
merge collision the phase split exists to prevent, so the zones were split into
`level/zones/*.js` behind a `ZoneBuilder` context first, as a pure refactor with
identical draw calls and triangles. Ownership after the split is disjoint by
construction rather than by agreement.

### D40. The shared pipeline was built before the zones, not beside them
`PHASES.md` lists the rendering pipeline as a fourth parallel agent alongside
the three zones. That ordering is wrong: the zones consume the pipeline, so if
it lands after them every zone re-authors its lighting against an API that moved
underneath it. It was built serially and its API frozen before the fan-out.

### D41. Materials project their UVs from world space
Generated geometry gets 0..1 UVs regardless of size, so a 64m floor slab and a
0.6m step block sampled the same texture across the same range — masonry on the
large one read as corrugation. Texel density is now a property of the world, not
of the mesh. Dominant-axis projection rather than full triplanar: one texture
fetch per map instead of three, with a seam only where a surface passes through
45°, which on boxes and cylinders almost never lands on screen.

The normal map's tangent frame is rebuilt from the same projected expression it
samples with. Deriving the frame from the mesh's original UVs while sampling
with another is the subtle version of this bug and shows up as lighting sliding
across the surface rather than as anything obviously wrong.

### D42. Volumetric occlusion is a bake, not the light's shadow map
The daylight shaft needs light-space occlusion so the candi carves a real
silhouette out of the beam. Three binds a directional light's shadow map as a
`sampler2DShadow` with a compare function attached, which is a different type
from the `sampler2D` a custom shader can read. Rather than fight that, the shaft
renders the scene's depth from the light once at boot into its own RGBA-packed
target. Every occluder in the well is static, so once is enough; the player and
the pigeon do not carve rays out of the beam, which is a loss nobody notices.

### D43. Volumetric ray bounds are analytic, not the proxy mesh's back face
Marching from the camera to the fragment's back face is the obvious
implementation and it fails twice. A closed cylinder's back face jumps from the
side wall to the top cap, which draws a hard seam straight across the sky disc.
A tapered proxy is smaller than the volume it stands for, so rays that pass
through the volume find no fragment to shade and the proxy's own silhouette
appears as a hard-edged cone across the frame. The proxy is now a bounding
cylinder that only decides which pixels to shade; entry and exit come from an
analytic ray-cylinder intersection, and the taper the player sees comes from the
radial falloff.

### D44. Scene depth is borrowed from the AO pass, one frame stale
The water's murk and the volumetrics' occlusion both need scene depth. The AO
pass already renders a normal-and-depth G-buffer every frame, so they sample
that instead of adding a depth pre-pass. It is one frame behind — the AO pass
runs after the scene containing the water — which is imperceptible on a soft
volume and a depth fade, and free. When the post chain is off the getter returns
null and both fall back to their non-depth path rather than failing.

### D45. The rubric captures at 1600×900, not 1440p
This container has no GPU. A software-rasterised 1440p frame in the Star Chamber
takes tens of seconds, and the fixed-step simulation — capped at five sub-steps
per rendered frame — then cannot finish a 3.4-second animation before the
harness times out. Composition, value structure, palette and silhouette all
survive the smaller frame, and the draw-call and triangle budgets it reports are
resolution-independent, so nothing measured is weakened. `--size 2560` restores
full resolution when there is time for it.

### D46. Gameplay smoke scripts run at quality=low
The smoke scripts assert that the game runs and that its states are reachable,
which is not a rendering question. Under the full post chain on software GL the
simulation falls far behind wall-clock, so a drive script waiting on an
animation times out for reasons unrelated to the game. Frame quality is the
rubric harness's job; the smoke harness now runs cheap and waits on conditions
rather than sleeping for fixed durations.

### D47. Every sound is synthesised, for the same reason every mesh is
There are no audio files, consistent with D4. Each sound is a small graph of
oscillators and filtered noise, which is less limiting than it sounds: a sword
whiff IS a band of noise sweeping downward, and a stone footstep IS a short
burst through a resonant filter. Per-zone reverb comes from generated impulse
responses whose high end decays faster than the low, which is most of what makes
a large stone room sound like stone rather than like a plate.

The boss wind-up cues are distinguished by pitch DIRECTION, not timbre — rising
for the lunge, falling for the sweep, rising-then-holding for the delayed strike
that punishes panic-rolling. A player learns a direction far faster than a
texture, and the delayed strike's cue tells the same lie its animation does.

### D48. Footstep events are derived from gait phase, not authored per clip
The gait cycles are generated from periodic functions of one phase variable, so
the contacts are already known: the left thigh's swing is `sin(phase)`, which
plants the left foot where phase crosses zero and the right half a cycle later.
Placing the events by hand per clip is how they end up out of sync with the pose
they are supposed to accompany.

### D49. `high` means "60fps on an M1", and `ultra` holds the art
The quality ladder used to have `high` at the top, and it was tuned for looks:
uncapped pixel ratio, live shadows, full-rate GTAO, water transmission, 32-step
volumetrics. Measured against the target machine, that costs **ten full-scene
geometry passes per frame** in the Star Chamber — six of them the star
PointLight's shadow cube, one the sun, one GTAO's normal pre-pass, one the
transmission backdrop, one the beauty pass — over 5.2 million pixels, because a
13" M1 MacBook Pro reports 1440×900 at devicePixelRatio 2.

`high` is now the shipping default and means "hold 60 on that machine":
`pixelRatioCap 1.4`, baked shadows, AO at half resolution, no water
transmission, 20 volumetric steps. `ultra` is byte-for-byte what `high` used to
be, so `node tools/perf.mjs` running both levels IS the before/after for the
whole pass. Measured: **10 scene passes → 2, fill 10.2× lower, 831 → 313 draw
calls, 367k → 113k triangles.**

`tools/rubric.mjs` moves to `ultra`. If the critic judged the art at the same
level the performance work cuts, every cut would read as a visual regression it
demands be undone — and worse, a future cut could quietly launder itself past a
critic that had already been lowered to meet it.

### D50. Shadow maps are baked once, not re-rendered every frame
A shadow-casting PointLight is six full scene renders per frame, and there is
exactly one in the game — in the room that also holds the boss fight. Every
occluder that matters in this chapter is static stonework, so the maps are
identical on frame two as on frame one. `Renderer.freezeShadows()` renders each
one once and then sets `autoUpdate = false`.

The cost is real and taken deliberately: dynamic casters stop writing into the
maps, so the boss no longer casts a shadow on the dais. `ultra` keeps them live.
If that reads as floating, the fix is a cheap projected contact shadow under the
character, not six scene passes a frame.

Timing is the part that is easy to get wrong. `VoidSequence.start()` hides the
entire chapter group for the duration of the opening, so baking at boot would
bake six empty cube faces and freeze them that way. The bake is hooked to
`intro.onComplete`, which fires after `#restoreWorld()` on both the played and
the skipped path.

### D51. Frame time is measured on the target, not in the container
Everything else in the performance pass is measured headlessly and exactly:
scene passes, pixels per frame, draw calls, triangles — all hardware-
independent. Frame time is not. This container renders through SwiftShader,
where a single Star Chamber frame takes most of a second, so any millisecond
figure it produces is a fact about the software rasteriser.

So `tools/perf.mjs` reports the countable costs and refuses to report frame
time, and `?bench` ships in the game itself: a fixed route through every zone
with a fixed dwell, discarding the first 1.25s at each stop for shader
compiles, reporting p50/p95 wall-clock frame time per zone. Judged on p95, not
p50 — a game that averages 60 and dips to 40 four times a second does not feel
like 60. It is a dynamic import, so it costs the shipping bundle nothing.

### D52. Instancing is deferred, because the measurement says it is not the cost
PROJECT.md budgets 1,500 draw calls. At `high` the heaviest vantage in the
chapter submits **313**, and the busiest zone 113k triangles. Converting the
repeated props to `InstancedMesh` would be optimising the one number that is
already five times inside its budget, at the cost of touching every zone
builder immediately after an art pass. The cut that mattered was fill, and it
has been made. This stays queued for P9 and gets done if — and only if — `?bench`
on real hardware says CPU submission, not fill, is the limit.
