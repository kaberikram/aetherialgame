# CONTROLS.md — Gamepad Mapping

Reference layout is Xbox-style (the Gamepad API's standard mapping). PlayStation equivalents in brackets.

**This is the Elden Ring layout — the actual one.** Every binding below was checked against the published control tables, not reconstructed from memory. That distinction matters because the previous version of this document made the same claim and was wrong in four places, and the code was built from it:

| | this document used to say | Elden Ring |
|---|---|---|
| Sprint | a dedicated button on **L3** | **hold B** — the same button as roll |
| L3 | sprint | **crouch / stand** |
| Y | weapon art / skill | **event action (interact)** |
| Guard | LT | **LB** (LT is the skill) |

Elden Ring has no sprint button. You tap B to roll and hold B to sprint, and the two verbs competing for one finger is a deliberate design decision rather than an accident of button count — sprinting away and dodging are the same commitment, made at different lengths. Anything that gives sprint its own button is a different game's control scheme.

---

## Layout

| Input | Action | Notes |
|---|---|---|
| **Left stick** | Move | Camera-relative. Deadzone below, see Analog section. |
| **Right stick** | Camera orbit | Invert-Y as a settings toggle, default off. |
| **Left stick click (L3)** | Crouch / stand up | A toggle, not a hold. Genuinely resizes the collider — low geometry is low for the physics, not just the silhouette. Standing is refused when there is no headroom. |
| **Right stick click (R3)** | Lock-on / reset camera | Tap to acquire nearest target in view cone. Tap again to release. Flick right stick while locked to cycle targets. |
| **A** [Cross] | Jump | With wings resolved: takeoff from a fall, hold to flap-climb. |
| **B** [Circle] | **Tap:** dodge / roll / backstep · **Hold:** sprint | Direction from left stick at press time. Neutral stick = backstep. See Roll and sprint below. |
| **X** [Square] | Use item (quick slot) | Healing flask by default. Slow, punishable, cannot be cancelled. |
| **Y** [Triangle] | Event action | Interact, pick up, examine, open. |
| **RB** [R1] | Attack | Chainable. |
| **RT** [R2] | Strong attack | Chainable, slower, higher poise damage. Analog. |
| **LB** [L1] | Guard | |
| **LT** [L2] | Skill | Analog: a light held pull guards, a hard fast pull deflects. Carries the alignment ability once wings resolve. |
| **D-pad up/down** | Cycle quick item | Changes what X uses. |
| **D-pad left/right** | Cycle equipped skill | Changes what LT triggers. |
| **Menu / Start** | Pause | |
| **View / Select** [Share] | Map / journal | |

## Roll and sprint share a button

The rule, exactly:

- **Released before `TUNING.movement.sprintHoldFrames` (10 frames, ~165ms)** — that press was a roll. It fires on the **release**, not the press.
- **Held past the threshold** — that press is a sprint, and **no roll fires at all**. There is no unwanted roll at the start of a sprint.
- **A press that begins and ends inside a single simulation step** is unambiguously a tap and fires immediately, without waiting for a release edge that will never arrive. This case is not theoretical: on a frame hitch a keydown/keyup pair lands between two samples, and without special handling the roll is silently dropped.

The cost is real and worth stating: a roll that fires on release carries the duration of your own tap as latency. Elden Ring accepts that trade on a pad. **The keyboard therefore keeps a separate Shift-to-sprint as well**, so a mouse player who would rather have a press-instant roll can simply never hold Space.

## Keyboard / mouse

Tuned on its own terms, not scaled from the pad, and deliberately *not* a literal transcription of Elden Ring's PC defaults — the existing letters were kept where they already worked.

| Input | Action |
|---|---|
| WASD | Move (hold Alt to creep) |
| Mouse | Camera — click once to capture the pointer |
| Space | Tap: dodge / roll · Hold: sprint |
| Shift | Sprint (the alternative to holding Space) |
| F | Jump |
| C | Crouch / stand |
| Left / right click | Attack / strong attack |
| Q (hold) | Guard — a fresh tap as a hit lands deflects |
| V | Skill |
| R | Flask · E interact · Tab lock-on · X alignment ability · Esc pause |

## Camera

- Right stick controls yaw and pitch, camera-relative movement recalculates every frame off current camera forward, not a fixed world axis.
- Auto-recenter behind the player after ~1.5s of no right-stick input during traversal. Disable auto-recenter entirely while locked on.
- Lock-on frames the target and the player on screen with the target biased slightly off-center toward the far side, matching Souls framing, not FPS-style dead-center.
- Camera collision pulls in smoothly on geometry intersection, no hard snap-cut except as a last-resort fallback when collision would otherwise clip through a wall.

## Analog input handling

- **Deadzone:** radial, ~0.15 inner deadzone on both sticks, not axial (avoids diagonal drift). Radial dead-zone math: normalize magnitude, remap `(mag - deadzone) / (1 - deadzone)`, clamp 0 to 1, reapply to normalized direction.
- **Response curve:** movement speed is not linear off stick magnitude near center. Apply a slight curve so fine positioning at low tilt (creeping near a ledge) is achievable, while full tilt reaches full sprint speed quickly. Expose the curve exponent as a tunable, start around 1.6–2.0.
- **8-directional movement blending:** locomotion blend tree takes the raw 2D stick vector, not a snapped 8-way, so diagonal movement is smooth, not stepped.
- **Triggers:** read analog value (0–1), not just a digital press threshold. Both RT (heavy attack windup can scale with how deliberately it's pressed) and LT (block vs. deflect) depend on this.

## Combat mapping details

- **Attack chaining:** RB, RB, RB strings a light combo; RT, RT strings a heavier one. RB into RT or RT into RB are valid transitions inside the active/recovery windows defined in the combat framework (see PROJECT.md) — the input buffers into the next attack's startup, it does not cancel the current one.
- **Input buffering:** buffer the next queued input (attack, roll, or block) for roughly 200–300ms during the recovery frames of the current action, so a slightly early press still executes cleanly rather than getting dropped. Do not buffer during active frames — that's where commitment lives.
- **Jump (A):** has its own short recovery before it can chain into an attack or roll, matching the weightier jump-attack timing Souls games use rather than a twitch-platformer instant-cancel. `TUNING.movement.jumpRecoveryFrames`, and it is enforced — it spent several phases documented here and read by nothing.
- **Roll direction (B):** captured at the moment B is *released* — the moment the press resolves into a roll rather than a sprint — and not updated during the animation, so a roll's direction is a deliberate read of stick position at input time.
- **Deflect window (LT):** LT crossing a depth/velocity threshold within a narrow frame window (tune against Phase 2's frame data) counts as deflect rather than guard. A hard, fast pull registers deflect; a held, gradual pull registers guard. This is the single hardest input to get feeling right — expect to spend real tuning time on the trigger-velocity threshold specifically, since both Elden Ring's guard-counter and Wukong's parry-adjacent mechanic live or die on this exact feel.
- **Y / LB contextual:** always in the same physical location so muscle memory holds across the whole game, even as what they trigger changes per weapon or per alignment branch.

## Context actions (A button)

- **Grounded, no prompt:** A is jump.
- **Grounded, near a ledge/vault-able geometry:** A still jumps, but geometry-flagged ledges auto-assist the jump into a climb/vault rather than requiring a separate button — jump is the single verb, the geometry decides the outcome.
- **Airborne (post-wings unlock):** A is initiate flight from a fall, converting fall velocity into glide. Held A while airborne sustains flap-climb per the Phase 5 flight controller.
- **Interact is NOT on A.** It is on Y, where Elden Ring puts it. It used to share A with jump, with the ambiguity deferred to "resolved downstream" — which makes every interact next to a ledge a coin flip between vaulting and talking. One button, one verb.

## Vibration / haptics

Use the Gamepad API's `hapticActuators` (or `vibrationActuator` where implemented) for:
- Light rumble pulse on landing a hit, scaled by weapon weight.
- Sharp double-pulse on a successful deflect — this should feel distinct from a normal block, since the deflect window is the hardest input in the game and needs feedback that confirms it landed.
- Heavy sustained rumble during the boss's beach-transition (Phase 3, phase two of the fight) as a physical telegraph, not just visual.
- No constant ambient rumble. Reserve haptics for combat feedback events only, or they stop meaning anything.

## Implementation notes (Gamepad API specifics)

- Poll `navigator.getGamepads()` every frame inside the fixed-update loop, not on a separate timer — stale gamepad state one frame behind physics causes input lag that reads as "floaty" controls, which is the opposite of the target feel.
- Support both mapping `"standard"` and non-standard gamepads gracefully; if `gamepad.mapping !== "standard"`, fall back to a best-effort index map and surface a rebind screen rather than silently misbinding.
- Handle gamepad connect/disconnect mid-session (controller sleep, USB drop) without crashing input state — pause or show a reconnect prompt, don't let the character keep last-held input.
- Keyboard/mouse remains a supported fallback but is not the reference feel target. Build and tune for gamepad first; keyboard/mouse gets a separate, simpler pass afterward (WASD move, mouse camera, left/right click for light/heavy attack, space for jump, shift or a mouse button for dodge, etc.) — don't try to make one scheme serve both from the same tuning pass.
- Expose full rebinding in settings from Phase 2 onward, even if the default layout above is hardcoded first. Retrofit-cost on rebinding is much higher than building it in early.

## Debug overlay requirement

Per PROJECT.md's debug key layout: add a gamepad state overlay (raw stick vectors, both trigger analog values, deadzone-applied output, currently-buffered input) toggleable in debug mode. This is what you'll actually be looking at while tuning the deflect threshold above — do not skip it.
