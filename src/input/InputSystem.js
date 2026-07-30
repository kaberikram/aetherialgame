import * as THREE from 'three';
import { EVENTS } from '../core/EventBus.js';
import { TUNING } from '../tuning.js';
import {
  ACTION, ALL_ACTIONS, MOVE_KEYS,
  DEFAULT_GAMEPAD_BINDINGS, DEFAULT_KBM_BINDINGS,
} from './Actions.js';

/**
 * Radial deadzone, per CONTROLS.md. Axial deadzones let a stick held straight
 * up read as a slight diagonal, which shows up as the character drifting off
 * a ledge you were walking parallel to.
 */
function applyRadialDeadzone(x, y, inner, outer, exponent) {
  const mag = Math.hypot(x, y);
  if (mag < inner) return { x: 0, y: 0, magnitude: 0 };
  const nx = x / mag;
  const ny = y / mag;
  let t = (mag - inner) / (outer - inner);
  t = Math.min(1, Math.max(0, t));
  // The response curve makes low tilt genuinely usable for creeping near a
  // ledge while full tilt still reaches full speed quickly.
  const curved = Math.pow(t, exponent);
  return { x: nx * curved, y: ny * curved, magnitude: curved };
}

class ActionState {
  held = false;
  pressed = false;   // rising edge this frame
  released = false;  // falling edge this frame
  value = 0;         // analog depth, 0..1
  prevValue = 0;
  heldFrames = 0;
  /** Analog travel per second — the signal a deflect is read from. */
  velocity = 0;
}

/**
 * InputSystem — samples devices inside the fixed step.
 *
 * Polling on a separate timer leaves gamepad state one frame behind physics,
 * and that lag reads to the player as "floaty", which is the exact opposite of
 * the target feel. So this runs at STAGE.INPUT in fixedUpdate and nowhere else.
 *
 * Publishes intent. Never consequence: it does not know what a dodge is.
 */
export class InputSystem {
  constructor(engine, domElement) {
    this.engine = engine;
    this.bus = engine.bus;
    this.dom = domElement;

    this.device = 'kbm';
    this.gamepadIndex = null;
    this.gamepadMappingWarned = false;

    this.bindings = {
      gamepad: { ...DEFAULT_GAMEPAD_BINDINGS },
      kbm: { ...DEFAULT_KBM_BINDINGS },
    };

    /** @type {Record<string, ActionState>} */
    this.actions = {};
    for (const a of ALL_ACTIONS) this.actions[a] = new ActionState();

    this.move = new THREE.Vector2();      // camera-relative intent, deadzoned & curved
    this.moveRaw = new THREE.Vector2();    // pre-deadzone, for the debug overlay
    this.moveMagnitude = 0;
    this.look = new THREE.Vector2();
    this.walkModifier = false;

    this.enabled = true;
    this.pointerLocked = false;

    this.#keys = new Set();
    this.#mouseButtons = new Set();
    this.#mouseDelta = new THREE.Vector2();
    this.#keyPressedThisStep = new Set();
    this.#mousePressedThisStep = new Set();

    this.#bindDom();
  }

  #keys; #mouseButtons; #mouseDelta; #keyPressedThisStep; #mousePressedThisStep;

  #bindDom() {
    const stop = (e) => {
      // Tab and the function keys would otherwise leave the page or trigger
      // browser UI mid-fight.
      if (e.code === 'Tab' || (e.code.startsWith('F') && e.code.length <= 3)) e.preventDefault();
    };

    this._onKeyDown = (e) => {
      stop(e);
      if (e.repeat) return;
      this.#keys.add(e.code);
      this.#keyPressedThisStep.add(e.code);
      this.#setDevice('kbm');
    };
    this._onKeyUp = (e) => this.#keys.delete(e.code);
    this._onMouseDown = (e) => {
      if (e.target.closest?.('button, a, input, select')) return;
      this.#setDevice('kbm');
      if (e.button === 1) e.preventDefault();
      // The click that captures the pointer is spent on capturing the pointer.
      // Without this, the first click of the session also swings the sword,
      // which reads as the game firing an attack the player never asked for.
      if (!this.pointerLocked) {
        this.requestPointerLock();
        return;
      }
      this.#mouseButtons.add(e.button);
      this.#mousePressedThisStep.add(e.button);
    };
    this._onMouseUp = (e) => this.#mouseButtons.delete(e.button);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.#mouseDelta.x += e.movementX;
      this.#mouseDelta.y += e.movementY;
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      // Losing the pointer must not leave keys stuck down.
      if (!this.pointerLocked) this.#releaseAll();
    };
    this._onBlur = () => this.#releaseAll();

    this._onGamepadConnected = (e) => {
      this.gamepadIndex = e.gamepad.index;
      if (e.gamepad.mapping !== 'standard' && !this.gamepadMappingWarned) {
        this.gamepadMappingWarned = true;
        console.warn(
          `Gamepad "${e.gamepad.id}" reports mapping "${e.gamepad.mapping}". ` +
          `Falling back to a best-effort standard index map; rebinding may be needed.`
        );
      }
      this.#setDevice('gamepad');
    };
    this._onGamepadDisconnected = (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        // Do not let the character keep running on the last-held stick value.
        this.#releaseAll();
        this.#setDevice('kbm');
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', this._onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }

  requestPointerLock() {
    if (!this.pointerLocked && this.dom.requestPointerLock) {
      this.dom.requestPointerLock().catch(() => {});
    }
  }

  #releaseAll() {
    this.#keys.clear();
    this.#mouseButtons.clear();
    this.#mouseDelta.set(0, 0);
    for (const a of ALL_ACTIONS) {
      const s = this.actions[a];
      s.released = s.held;
      s.held = false;
      s.value = 0;
      s.heldFrames = 0;
    }
    this.move.set(0, 0);
    this.moveMagnitude = 0;
  }

  #setDevice(device) {
    if (this.device === device) return;
    this.device = device;
    this.bus.emit(EVENTS.INPUT_DEVICE_CHANGED, { device });
  }

  get gamepad() {
    if (this.gamepadIndex === null) return null;
    const pads = navigator.getGamepads?.() ?? [];
    return pads[this.gamepadIndex] ?? null;
  }

  fixedUpdate(dt) {
    if (!this.enabled) return;
    // Poll here, in the fixed step, not on a timer. See the class comment.
    const pad = this.gamepad;
    if (pad && this.#padHasActivity(pad)) this.#setDevice('gamepad');

    for (const a of ALL_ACTIONS) {
      const s = this.actions[a];
      s.prevValue = s.value;
      s.pressed = false;
      s.released = false;
    }

    if (this.device === 'gamepad' && pad) this.#sampleGamepad(pad, dt);
    else this.#sampleKbm(dt);

    for (const a of ALL_ACTIONS) {
      const s = this.actions[a];
      s.velocity = (s.value - s.prevValue) / dt;
      s.heldFrames = s.held ? s.heldFrames + 1 : 0;
      if (s.pressed) this.bus.emit(EVENTS.INPUT_ACTION, { action: a, phase: 'pressed', value: s.value });
      if (s.released) this.bus.emit(EVENTS.INPUT_ACTION, { action: a, phase: 'released', value: s.value });
    }

    this.#keyPressedThisStep.clear();
    this.#mousePressedThisStep.clear();
    this.#mouseDelta.set(0, 0);
  }

  #padHasActivity(pad) {
    for (const b of pad.buttons) if (b.value > 0.2) return true;
    for (let i = 0; i < 4; i++) if (Math.abs(pad.axes[i] ?? 0) > 0.3) return true;
    return false;
  }

  #sampleGamepad(pad, dt) {
    const cfg = TUNING.input.gamepad;

    const mv = applyRadialDeadzone(
      pad.axes[0] ?? 0, pad.axes[1] ?? 0,
      cfg.innerDeadzone, cfg.outerDeadzone, cfg.moveCurveExponent
    );
    this.moveRaw.set(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0));
    // Screen-space y is inverted relative to forward.
    this.move.set(mv.x, -mv.y);
    this.moveMagnitude = mv.magnitude;
    this.walkModifier = false;

    const lk = applyRadialDeadzone(
      pad.axes[2] ?? 0, pad.axes[3] ?? 0,
      cfg.innerDeadzone, cfg.outerDeadzone, cfg.lookCurveExponent
    );
    const sens = TUNING.camera.lookSensitivityGamepad;
    this.look.set(lk.x * sens * dt, lk.y * sens * dt * (TUNING.input.kbm.invertY ? -1 : 1));

    for (const [action, bind] of Object.entries(this.bindings.gamepad)) {
      const btn = pad.buttons[bind.button];
      if (!btn) continue;
      const s = this.actions[action];
      // Analog buttons report a 0..1 value; digital ones report 0 or 1.
      const value = bind.analog ? btn.value : (btn.pressed ? 1 : 0);
      const wasHeld = s.held;
      const held = bind.analog
        ? (wasHeld ? value > cfg.triggerReleaseThreshold : value > cfg.triggerPressThreshold)
        : btn.pressed;
      s.value = value;
      s.held = held;
      s.pressed = held && !wasHeld;
      s.released = !held && wasHeld;
    }
  }

  #sampleKbm(dt) {
    const down = (codes) => codes?.some((c) => this.#keys.has(c)) ?? false;
    const freshKey = (codes) => codes?.some((c) => this.#keyPressedThisStep.has(c)) ?? false;

    let x = 0;
    let z = 0;
    if (down(MOVE_KEYS.forward)) z += 1;
    if (down(MOVE_KEYS.back)) z -= 1;
    if (down(MOVE_KEYS.right)) x += 1;
    if (down(MOVE_KEYS.left)) x -= 1;
    this.moveRaw.set(x, z);
    this.walkModifier = down(MOVE_KEYS.walk);
    if (x !== 0 || z !== 0) {
      // Normalise so diagonals are not faster, then apply the walk modifier.
      // A keyboard has no analog magnitude, so creeping is a held key rather
      // than a stick tilt — the KB/M profile is tuned on its own terms.
      const len = Math.hypot(x, z);
      const mag = this.walkModifier ? 0.42 : 1;
      this.move.set((x / len) * mag, (z / len) * mag);
      this.moveMagnitude = mag;
    } else {
      this.move.set(0, 0);
      this.moveMagnitude = 0;
    }

    const sens = TUNING.camera.lookSensitivityMouse;
    this.look.set(
      this.#mouseDelta.x * sens,
      this.#mouseDelta.y * sens * (TUNING.input.kbm.invertY ? -1 : 1)
    );

    for (const [action, bind] of Object.entries(this.bindings.kbm)) {
      const s = this.actions[action];
      const keyHeld = down(bind.keys);
      const mouseHeld = bind.mouse?.some((b) => this.#mouseButtons.has(b)) ?? false;
      let held = keyHeld || mouseHeld;

      // Sprint shares Shift with dodge: a tap rolls, holding past the delay
      // sprints. That is the standard souls keyboard compromise and it works
      // because a roll's input is instantaneous and a sprint's is sustained.
      if (bind.hold) {
        const raw = held;
        held = raw && s.heldFrames >= (bind.holdDelayFrames ?? 10);
        if (raw) s.heldFrames++;
        else s.heldFrames = 0;
        s.value = held ? 1 : 0;
        const wasHeld = s.held;
        s.held = held;
        s.pressed = held && !wasHeld;
        s.released = !held && wasHeld;
        continue;
      }
      if (bind.tap) {
        const fresh = freshKey(bind.keys) || (bind.mouse?.some((b) => this.#mousePressedThisStep.has(b)) ?? false);
        s.value = fresh ? 1 : 0;
        s.pressed = fresh;
        s.released = s.held && !held;
        s.held = held;
        continue;
      }

      const wasHeld = s.held;
      const fresh = freshKey(bind.keys)
        || (bind.mouse?.some((b) => this.#mousePressedThisStep.has(b)) ?? false);
      s.value = held ? 1 : 0;
      s.held = held;
      // A press that began AND ended between two sampled steps is still a
      // press. Without the `fresh` term, a fast click during a frame hitch is
      // silently dropped — which reads to the player as the game ignoring them.
      s.pressed = (held && !wasHeld) || (fresh && !wasHeld);
      s.released = !held && wasHeld;
    }
  }

  /**
   * Deflect test. On a pad this is a hard, fast trigger pull: depth crossed
   * with enough velocity. On a keyboard there is no velocity to read, so a
   * fresh press inside its own window counts and a sustained hold does not.
   * Both are "a deliberate stab, not a lean".
   */
  isDeflectInput() {
    const s = this.actions[ACTION.GUARD];
    if (this.device === 'gamepad') {
      const cfg = TUNING.combat;
      return s.value >= cfg.deflectTriggerDepth && s.velocity >= cfg.deflectTriggerVelocity;
    }
    return s.pressed;
  }

  /** True while guarding but not deflecting. */
  isGuarding() {
    return this.actions[ACTION.GUARD].held;
  }

  consumePress(action) {
    const s = this.actions[action];
    if (!s.pressed) return false;
    s.pressed = false;
    return true;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('gamepadconnected', this._onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }
}
