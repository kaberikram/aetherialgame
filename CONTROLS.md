# CONTROLS.md — Gamepad Mapping

Reference layout is Xbox-style (the Gamepad API's standard mapping). PlayStation equivalents in brackets. This is the Elden Ring layout: attacks live on the shoulder buttons, face buttons handle jump/dodge/item/utility. This doc is the contract for Phase 1 (movement) and Phase 2 (combat) — implement against this, not ad hoc bindings.

---

## Layout

| Input | Action | Notes |
|---|---|---|
| **Left stick** | Move | Camera-relative. Deadzone below, see Analog section. |
| **Right stick** | Camera orbit | Invert-Y as a settings toggle, default off. |
| **Left stick click (L3)** | Sprint (hold) | Draining stamina while held and moving. |
| **Right stick click (R3)** | Lock-on toggle | Tap to acquire nearest target in view cone. Tap again to release. Flick right stick while locked to cycle targets. |
| **A** [Cross] | Jump | Also confirms context prompts (climb, mount, interact) when one is on screen. |
| **B** [Circle] | Dodge / Roll / Backstep | Direction from left stick at press time. Neutral stick = backstep. Also cancels menus. |
| **X** [Square] | Use item (quick slot) | Healing flask by default. Slow, punishable animation, cannot be cancelled once started. |
| **Y** [Triangle] | Weapon art / skill toggle | Contextual: alignment ability once wings resolve, or a stance/two-hand-equivalent toggle before that. |
| **RB** [R1] | Light attack | Chainable. |
| **RT** [R2] | Heavy attack | Chainable, slower, higher poise damage. |
| **LB** [L1] | Alignment ability (secondary) / off-hand light action | Light/dark branch skill once wings resolve. |
| **LT** [L2] | Block (hold) / Deflect (sharp pull) | Analog: light held pull = guard, hard fast press = deflect. See Deflect Window. |
| **D-pad up/down** | Cycle quick item | Changes what X uses. |
| **D-pad left/right** | Cycle equipped skill / arts | Changes what Y or LB triggers. |
| **Menu / Start** | Pause | |
| **View / Select [Share]** | Map / journal | |

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
- **Jump (A):** has its own short recovery before it can chain into an attack or roll, matching the weightier jump-attack timing Souls games use rather than a twitch-platformer instant-cancel.
- **Roll direction (B):** captured at the moment B is pressed, not continuously updated during the roll animation, so a roll's direction is a deliberate read of stick position at input time.
- **Deflect window (LT):** LT crossing a depth/velocity threshold within a narrow frame window (tune against Phase 2's frame data) counts as deflect rather than guard. A hard, fast pull registers deflect; a held, gradual pull registers guard. This is the single hardest input to get feeling right — expect to spend real tuning time on the trigger-velocity threshold specifically, since both Elden Ring's guard-counter and Wukong's parry-adjacent mechanic live or die on this exact feel.
- **Y / LB contextual:** always in the same physical location so muscle memory holds across the whole game, even as what they trigger changes per weapon or per alignment branch.

## Context actions (A button)

- **Grounded, no prompt:** A is jump.
- **Grounded, near a ledge/vault-able geometry:** A still jumps, but geometry-flagged ledges auto-assist the jump into a climb/vault rather than requiring a separate button — jump is the single verb, the geometry decides the outcome.
- **Airborne (post-wings unlock):** A is initiate flight from a fall, converting fall velocity into glide. Held A while airborne sustains flap-climb per the Phase 5 flight controller.
- Do not overload A with more than these. If a genuinely distinct action is needed later, it goes on a bumper, not stacked onto A.

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
