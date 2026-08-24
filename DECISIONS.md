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

---

## P-Blockout — the reset

Chapter 1 shipped its art pass and became unplayable on the target machine. The
pass below is a deliberate step backwards in fidelity to get the frame and the
character controller onto ground that can be measured.

### D53. The renderer is NPR, and the post chain is gone
The brief changed: the game is anime cel-shaded, "if any surface reads as
physically based, you have failed." That reverses D41's world-space PBR
projection, D44's borrowed depth, and most of D49's tuning — but it is not a
reversal that costs anything, because the post chain was also the frame's
largest single expense.

Measured, at the old default: **17 full-screen quads, ~22 megapixels of
fragment work per frame** through ~150 MB of HalfFloat targets, plus a GTAO
pass that re-submitted the entire scene through `scene.overrideMaterial` — so
821 draw calls became ~1,640 submissions. Bloom alone was twelve of those quads
and ran at every preset except `off`.

None of it survives. `Renderer` draws the scene to the canvas once. Tone mapping
is `NoToneMapping`: ACES exists to compress a high dynamic range into a display,
which is exactly the wrong operation on a hard-banded ramp — it smears the steps
back into the gradient the shading model was built to avoid.

The per-zone grade went with the chain. That is the right home for it anyway: a
grade is a photographic correction pulled over the top of a finished render, and
under cel shading the palette belongs in the key light, the fill, the ambient
hemisphere and the fog, where an animator would put it.

### D54. The god rays were free to delete, because they were already free
`VolumetricShaft` was the most expensive object in the game: 20 raymarch steps ×
4 dependent texture taps, over a radius-30 × 58m cylinder with
`frustumCulled = false`, and `depthTest` forced **off** whenever scene depth was
bound — so it marched behind solid stone. Standing in the well, roughly **200
million texture fetches per frame**.

It was also sampling a blank map. `intro.start()` hides the entire chapter group
for the void sequence; `bakeVolumetrics()` ran immediately after and baked
occlusion against that hidden scene. `shadowAt()` returned 1.0 for every tap for
the whole run. The shadow bake beside it got the ordering right (`main.js` hooks
it to `intro.onComplete`) and this one did not — the same hazard, thirty lines
apart, caught once.

Nothing replaces it yet. A god ray in ink-and-paint is a hard-edged drawn shape,
not a density integral, so its replacement is geometry and belongs to the art
pass.

### D55. Cuboids, not trimeshes — a controller decision, not a rendering one
`ZoneBuilder.solid()` fed the visual `BufferGeometry` straight into Rapier as a
trimesh, so every walkable surface in the chapter was whatever triangles a sweep
happened to emit. `box()` and the new `ramp()` register analytic cuboids
instead, and `solid()` is now the exception — two surfaces keep it: the well
shaft (flown up, so contact happens at arbitrary angles) and the pool basin
(a continuous depth gradient that is a mechanic).

The payoff is immediate and measurable. `GREEN_VEIN_FLOOR` is **linear in z**, so
a single ramp between its endpoints is not an approximation of the function — it
is the same plane. `tools/collision.mjs` measured the old floor at **0.55m** of
divergence from the function it was generated from, a defect STATUS.md documented
as known and worked around. It now measures **0.01m**, and the workaround the
water needed is deleted rather than maintained.

### D56. A key and a fill, and the ceiling does not cast
The scene carried **~25 unculled point lights**. Three.js builds one global light
list, so every stone fragment in the Descent ran a 25-iteration loop for lights
in a room 100m away, plus a point-shadow-cube lookup and a directional one. No
quality preset reduced it. That was almost certainly the largest fragment cost in
the game and it was invisible in every draw-call number the project had recorded.

It is now one directional key, one directional fill, one hemisphere ambient.
Three lights, everywhere, for the whole chapter.

Two things about that setup are load-bearing and were both got wrong first:

- **The key is low (~35°), not overhead.** A banded ramp has no falloff: a
  surface is in a band or in the one below it. With the key near-vertical, every
  horizontal surface sat in the top band and every vertical one — walls,
  characters, anything with a silhouette — sat in the bottom. Bright floor,
  black everything else.
- **The fill is not optional.** A surface facing away from the key does not fall
  off toward darkness, it lands in the bottom band and stays. Without a fill, a
  character walking away from the key is a flat cut-out, which fails the rubric's
  "readable at 10% screen height" outright.

And ceilings are `castShadow: false`. Every zone in this chapter is roofed, so a
shadow-casting roof means one directional key reaches nothing at all and the
interior is lit by ambient alone. Walls and floors still cast onto each other.

### D57. Ink is merged EdgesGeometry, not an inverted hull and not a post pass
The two standard answers both fail here. An **inverted hull** relies on averaged
vertex normals and a blockout is made of boxes, whose normals point three
different ways at every corner — the shell tears open exactly where a box is most
readable. A **depth/normal edge-detect post pass** works, but reintroduces the
fullscreen chain D53 just deleted, to redraw lines whose positions we already
know.

`EdgesGeometry` has the topology, so it gives the silhouette *and* the interior
architectural creases — the more ink-and-paint read anyway; hand-drawn line work
does not stop at the outline. Every mesh in a zone is merged into one buffer, so
the chapter's entire line work is four draw calls.

### D58. Combat is deleted at the seams, not disabled behind flags
`src/ai/`, the hitbox/damage/lock-on systems and the attack move set are gone
rather than switched off. The seams are the ones `docs/INTERFACES.md` already
declared — the `EventBus` contract, `ZoneBuilder`, `BossEncounter`'s fight hook —
so the fight drops back in without reopening the level or the renderer.

`BossStub` keeps the chain intact: fog gate → engage → `BOSS_DEFEATED` → the wing
choice → flight → the oculus. Cutting the boss entirely would have left half the
chapter unreachable while the question on the table is whether walking through it
feels good. The wing choice needed no stub at all — per D28 it is committed by
walking within 2.3m of a form, which is pure navigation.

`AnimationSystem` could not be removed and was never a candidate: jump apex fires
from a clip event, roll distance is root motion baked into `clips/actions.js`, and
roll i-frames come from clip events. Locomotion here is animation-driven by
design (D6, D12).

### D59. The dead constants are wired or deleted, not left ambiguous
An audit found five tuning constants that were declared, documented, and read by
nothing. Each was resolved rather than tidied:

| constant | resolution |
|---|---|
| `camera.rotationSmoothing` | **Implemented.** Rule 1 of CameraRig — "position lags more than rotation" — was half-built. Smoothing is on the look *target*, not on yaw/pitch: damping the orbit angles is the obvious reading and the wrong one, because it puts 50ms between the mouse and the view. |
| `movement.jumpRecoveryFrames` | **Enforced.** CONTROLS.md always claimed it was. |
| `movement.airDrag` | **Deleted.** `airAccel` already produces the deceleration; a second overlapping term is a feel regression dressed as a fix. |
| `roll.bufferFrames` | **Deleted.** A duplicate of `combat.inputBufferFrames`, and two numbers claiming to be the same window is how one of them stops being true. |
| `lockOn.screenBiasX` | **Deleted** with lock-on. |
| `DebugSystem.timeScale` | **Wired.** It scales the time fed to the accumulator, not the step — the fixed step must stay 1/60 or frame data means nothing. |

Plus one that was worse than dead: **`PlayerController.groundNormal` was declared
and never written or read**, so every slope in a chapter shaped entirely like a
descent walked exactly like flat ground. It is read back from Rapier's computed
collisions now and drives uphill speed.

### D60. The wall scrub needed a wall
`#integrate` cut an axis's velocity to 20% whenever the controller returned less
than half the requested motion. That fires on every legitimate step-up and every
slope climb — autostep and slope resolution both return less horizontal motion
than was asked for — so walking up stairs dropped the player to a fifth speed on
the frame each step cleared. It now requires an actual near-vertical contact,
using the same angle as the climb limit so "wall" and "cannot walk up this" are
one question answered once.

### D61. The collider view renders physics, not a parallel list
`F5: 'colliders'` was declared in Phase 0 and read by nothing for the entire
project — while the repo simultaneously documented a bug where the walkable floor
and the function generating it disagreed by half a metre.

`ColliderView` drives `world.debugRender()` rather than tracking the boxes as
they are created. The obvious implementation draws *what we asked for*; this
draws what Rapier actually has, including the player capsule, the containment
ring, and anything registered by code that forgot to tell a debug list. A debug
view that can drift from the thing it debugs is worse than none, because it is
confidently wrong.

### D62. The audit that never looked at a floor
The grid sweep added to prove the level reported 307 collider-vs-mesh
mismatches. All 307 were the harness, and the reason took four separate bugs to
reach — the last of which meant the sweep had never once measured a floor.

Its descent-through-hits loop used Rapier's default `solid: true`. A ray whose
origin is inside a shape reports a hit at distance 0, so on ducking 5cm under a
ceiling's top face the probe was still inside the 1.2m slab, got distance 0
back, ducked another 5cm, and burned every attempt marching down through the
roof it started on. Every "surface sample" it ever reported was a ceiling.
`solid: false` reports the exit face, so one step leaves the slab.

Three others were hiding behind it:

- **`THREE.Intersection.normal` is object-local.** three does not transform it in
  `Mesh.raycast`. Every `ramp()` is rotated, and a box's local +Y reads (0,1,0)
  whichever way it actually points, so the mesh-side walkable filter accepted
  walls. Needs the normal matrix.
- **Non-colliding decoration was read as "the visual".** The Green Vein water
  planes sit 11cm over the floor *by design*; the harness called that authored
  lift collider drift. `ZoneBuilder` now sets `userData.noCollide` at the one
  place that knows whether a collider was registered, and `StarChamberArena` and
  `Checkpoint` — which build straight onto the scene — say so for themselves.
- **Probing from above the ceiling to find the floor is backwards.** Zones now
  declare the y band their floor occupies. That is check 1's own trick ("probe
  from just above the EXPECTED floor, not from high above") generalised from a
  centreline to a grid.

The check the sweep settled on is **standability**: an upward-facing face with
room for a body above it. Collider-vs-mesh agreement is *structural* under
`ZoneBuilder` — `box()` and `ramp()` register the collider from the same size,
position and quaternion as the mesh — so the subtraction is kept as the tripwire
for a hand-placed collider or a returning trimesh, not as the point.

Two findings were real and neither was level geometry: the arena basin (the one
remaining trimesh, and so the only surface where collider and mesh genuinely
*can* drift) was excluded from the comparison, and the training dummies wrap a
0.74m box collider around a 0.72m capsule visual — no box agrees with a dome, so
they are excluded as combat props rather than chapter.

### D63. Check 2 was looser than the controller
Continuity compared rises against 0.55m while `TUNING.movement.stepOffset` is
0.42. So it passed geometry the player cannot climb, and it did: the Pagoda
Well's temple steps rose 0.50m each and sailed through while being physically
unclimbable. The audit now reads the live tuning values — step offset, both
capsule heights, the slope limit — and fails loudly if its own constants drift
from the game's.

The general lesson is that a harness with its own copy of a gameplay constant is
a harness that will eventually certify a bug. Copies are fine; unasserted copies
are not.

### D64. A test that plays the game
`tools/playthrough.mjs` drives the real controller through the real level with
the real physics, void to oculus, and asserts all eight beats fire exactly once,
the player never leaves the world, position keeps advancing, and the console
stays clean.

Nothing else in `tools/` plays the game, and it turned out that nothing else
could have found what it found:

1. **Beat 2 had no emitter at all.** `BEAT.EMBODIMENT` was in the enum, in
   `BEAT_NAME` and in the pigeon's bark table, and nothing anywhere fired it.
2. **The fog gate re-sealed with the player still outside it**, on a 900ms
   wall-clock timer, under a comment describing a push that did not exist.
3. **The Star Chamber's dais was drawn and not solid** — an open pit between the
   basin and the containment ring.
4. **The containment ring had its box axes swapped**, which made it forty radial
   spokes instead of a wall: it leaked in every direction and simultaneously
   stood across the only way in.
5. **The well shaft was a closed cylinder** with the exit corridor running
   straight into it, so the chapter's last room was unreachable.
6. **The candi's steps** were both too tall and measured from the wrong datum.

Steering writes `input.move` directly with `input.enabled = false`, the pattern
`collision.mjs`'s wedge check arrived at, because a keyboard bot has to solve
"which way is the camera facing" every frame and reports its own failures as
level bugs. The simulation is pumped with `stepOnce()` rather than waited on —
this container has no GPU, so wall-clock and simulation time diverge by more
than an order of magnitude.

**One segment cannot be pumped.** `Engine.stepOnce()` runs `#fixedStep` and
nothing else, and `FogGate` does its proximity-and-interact check in `update(dt)`
— the variable-rate stage — so under a pumped simulation the gate is never asked
whether the player is standing in front of it. That segment drives an in-page rAF
loop with the engine unpaused instead. Worth recording as a smell: an
interaction that only exists on the render tick is an interaction whose timing
depends on frame rate.

### D65. The rule that keeps colliders honest, applied to the dais
The Star Chamber dais was first fixed by drawing each tread as a flat
`RingGeometry` annulus over a ring of box colliders. That leaves collider and
visual as two different shapes — a chord approximating an arc against a true arc
— and they cannot agree at a band boundary however the chords are sized, because
a chord's inner edge bows away from the centre between its ends. The audit found
the seam; covering the sagitta moved it.

So the dais follows the rule `ZoneBuilder` states for the rest of the chapter:
**one transform produces both.** Every box is registered as a collider and
appended to one merged buffer, so the mesh is the exact union of the colliders.
Ninety-six boxes, one draw call, nothing left to diverge.

The containment ring is now also a *fight* fixture rather than permanent
scenery. Closing its circle correctly would have sealed the player into the
arena with the Pagoda Well on the far side — the leak had been doing that job by
accident. It goes up with the room and comes down when the boss dies, which is
what a Souls arena does anyway.

### D66. Crouch needed somewhere to crouch, and the somewhere needed walls
The crawl on the Descent's lower route exists so crouch is not a button that
changes nothing. Getting it to work took three corrections, and the third was
the serious one:

- **1.25m of clearance is not enough** even though the arithmetic says it is
  (1.16m crouched capsule, 9cm spare). The character controller carries a 0.02m
  skin offset at each end, snap-to-ground pulls the capsule into the floor, and
  autostep tries to lift it over what it is brushing. 1.45m leaves ~0.25m either
  way — and a ceiling you have to be pixel-perfect under reads as a bug even
  when it is passable.
- **The slab has to overhang the floor it roofs.** At width 7 over a route of
  width 8 it left 0.5m of open floor down each side, and a standing capsule
  scraped along the edge and walked the whole crawl upright.
- **And then the overhang became a trap.** Walking into the slab scrubs a
  standing player sideways along it, and the lower route had no side walls —
  `buildShell` follows the *main* spine, which the lower route diverges from by
  up to 5m. The scrub slid the player off the edge and out of the chapter: y
  −13.8 to −166 and still falling. The route has walls now.

The wider point is that the wall scrub is a *mechanism for moving the player
somewhere they did not ask to go*, so every surface it can push them along needs
something at the far end of the push.

### D67. A route states its width once
You were falling through holes while `npm run collision` reported clean. Both
were true, and the cause was identical in every zone: **each route declared its
walkable width twice** — once building its floor, again building the walls meant
to keep you on that floor — and nothing reconciled the two numbers. Wherever the
wall number was the larger one there was an open strip between the floor's edge
and the wall's inner face:

| route | floor half-width | wall inner face | gap each side |
|---|---|---|---|
| Descent main line | 4.0–4.5 | 5.8 | 1.3–1.8m |
| Green Vein | 11.6 constant | 10.5–15.5, per segment | up to 3.9m |
| Pool approach | 6.0–7.5 | none — `collide: false` | unbounded |
| Pagoda corridor | 4.5 | positioned off an unrelated lerp | walls floated 1.2m above the floor |

The Green Vein is the clearest. Its floor was one ramp of constant width
`max(FLOOR_WIDTH(2), FLOOR_WIDTH(−54))` = 23.19, while its walls were placed per
segment at `FLOOR_WIDTH(zm)/2 + 2` — and `FLOOR_WIDTH` peaks at 27 where
`sin(z·0.12) = 1`, which happens at **z ≈ −39.3, inside the zone.** Wall 15.5m
out, floor stopping at 11.6m.

`ZoneBuilder.path(points, { width })` takes the width once and emits the floor
segments and both walls from it. This is D57's move — one ramp *is* the height
function — in the other axis. It also handles the two things that turn a
correct width into a hole anyway:

- **Joints overlap** rather than meeting at a line. Two ramps sharing an endpoint
  share their top edge, but at a change of heading those edges are perpendicular
  to different axes and the outside of every turn is a wedge of missing floor.
- **Shoulders** close width changes. Where a route narrows, the wider segment's
  floor runs out past the narrower one's wall; a short wall across the step
  closes it.
- **Wall bases sit under the segment's lowest floor**, not its midpoint. A
  vertical wall on a sloping floor otherwise leaves its bottom edge above the
  floor at the low end by half the segment's fall.

**The Descent is deliberately not on it.** It is two stacked routes — the main
line and the lower route you land on by missing the jump — sharing one shell,
and every attempt to reconcile its numbers pushed the main line's floor slab
down onto the crawl below and sealed it. `npm run controls`'s crawl case caught
all three attempts. Its numbers are reconciled by hand instead, through
`SHELL_WIDTH`, and only for the segments above the lower route.

### D68. The audit could not see holes, by construction
Check 5 walked a grid and did `if (py === null) continue` — **a column with no
floor was skipped, not failed.** Check 1 sampled the centreline and ±60% of
half-width, so it never looked at the edges, which is exactly where a player
walks off. Check 6 probed 174 points at 5m×6m spacing and asked "can the capsule
move", not "did it fall". Three checks, none of which could report a hole.

**Check 7** asks the missing question: for every reachable cell, every
horizontal neighbour must be standable, walled off, or a drop onto something.
0.75m lattice, because a 0.5m gap cannot swallow a 0.64m capsule but a 1m one
can. Three things it needs to be true rather than noisy:

- It runs over the **reachable** set. Without that gate it asks the question of
  ceiling tops and wall caps, which have real open air beside them.
- Columns hold **every** standable surface, not the topmost. The Descent is two
  levels, and with one surface per column the walk crossed the jump gap, landed
  on the lower route, and found every column ahead occupied by the main line
  overhead: 547 of 8,887 cells reachable.
- Zone footprints **overlap**. A band of z that no zone samples is a wall to the
  walk, and the first version left two — so the chapter came back as four
  disconnected islands.

**Check 8** flood-fills forward from the spawn and backward from the exit;
anything in the first set and not the second is somewhere you get into and not
out of. With no fall backstop in this build that is a soft-lock rather than an
inconvenience.

Its verdict is then **confirmed by driving the real controller** out of each
cluster, which is the move check 6 already makes for wedges. The graph is a
model — one step rule, four directions — and where two floors converge within a
step of each other it decided the Descent's lower route was sealed, which the
capsule walks out of in one go, 43m into the Green Vein. Geometry proposes;
simulation disposes.

Two smaller lessons worth keeping:

- `blocked()` must test for a **wall**, not for anything the ray touches. Without
  the normal check it fired on the main line's floor slab passing overhead and
  reported the corridor beneath it as sealed.
- Angle wraparound: `d = |a − door|; if (d > π) d = 2π − d` is not the same as an
  angle difference. With `door = −π/2` and `a` running 0…2π the raw difference
  reaches 7.85, and `2π − 7.85` is **negative** — less than any threshold — so a
  whole quadrant of the Star Chamber's balustrade counted as "inside the
  doorway" and silently never got built. `atan2(sin Δ, cos Δ)` is right for
  every pair.

  416 unguarded edges → 47.
