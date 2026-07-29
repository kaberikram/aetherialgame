import * as THREE from 'three';
import { Engine, STAGE } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { Renderer } from './render/Renderer.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { InputSystem } from './input/InputSystem.js';
import { PlayerController, STATE } from './character/PlayerController.js';
import { CameraRig } from './character/CameraRig.js';
import { LockOn } from './combat/LockOn.js';
import { TestRoom } from './level/TestRoom.js';
import { VoidSequence } from './narrative/VoidSequence.js';
import { HUD } from './ui/HUD.js';
import { DebugSystem } from './debug/DebugSystem.js';
import { StatsOverlay } from './debug/StatsOverlay.js';
import { StateInspector } from './debug/StateInspector.js';
import { GamepadOverlay } from './debug/GamepadOverlay.js';
import { TUNING } from './tuning.js';

const boot = {
  el: document.getElementById('boot'),
  bar: document.getElementById('boot-bar'),
  status: document.getElementById('boot-status'),
  step(pct, text) {
    this.bar.style.width = `${pct}%`;
    this.status.textContent = text;
  },
  fail(err) {
    console.error(err);
    this.bar.style.width = '100%';
    this.bar.style.background = '#b4564f';
    this.status.className = 'error';
    this.status.textContent = String(err?.message ?? err);
  },
  done() {
    this.el.classList.add('hidden');
    setTimeout(() => this.el.remove(), 800);
  },
};

async function main() {
  boot.step(8, 'renderer');
  const engine = new Engine({ fixedHz: 60, maxSubSteps: 5 });
  window.__VESSEL = engine;

  const state = engine.provide('state', new GameState(engine.bus));
  state.load();

  const viewport = document.getElementById('viewport');
  const renderer = engine.provide('renderer', new Renderer(viewport));
  renderer.attach(engine);

  const debug = engine.provide('debug', new DebugSystem(engine, document.getElementById('debug-root')));

  boot.step(24, 'physics');
  const physics = engine.provide('physics', await PhysicsWorld.create(engine));

  boot.step(40, 'input');
  const input = engine.provide('input', new InputSystem(engine, renderer.renderer.domElement));

  boot.step(56, 'world');
  const room = new TestRoom(engine).build();

  boot.step(70, 'body');
  const player = engine.provide('player', new PlayerController(engine));
  const cameraRig = engine.provide('camera', new CameraRig(engine, player));
  const lockOn = engine.provide('lockOn', new LockOn(engine, player));
  lockOn.register(room.addDummy(new THREE.Vector3(0, 0, -2)));
  lockOn.register(room.addDummy(new THREE.Vector3(6, 0, 4)));
  lockOn.register(room.addDummy(new THREE.Vector3(-7, 0, 3)));

  const hud = new HUD(engine, player);

  boot.step(82, 'the void');
  const intro = new VoidSequence(engine, player, cameraRig).build();
  // Open ground, facing the nearest dummy, with nothing behind for the camera
  // to collide with. Where the body arrives is the first thing the player sees.
  intro.landingPosition = new THREE.Vector3(0, 0.05, 4);
  intro.landingFacing = Math.PI;
  intro.onComplete = () => {
    cameraRig.snap({ yaw: intro.landingFacing + Math.PI });
    hud.setVisible(true);
  };

  // --- module registration, ordered by STAGE ------------------------------
  engine.add(input, STAGE.INPUT);
  engine.add(intro, STAGE.NARRATIVE);
  engine.add(player, STAGE.CHARACTER);
  engine.add(lockOn, STAGE.COMBAT);
  engine.add(physics, STAGE.PHYSICS);
  engine.add(cameraRig, STAGE.CAMERA);
  engine.add(hud, STAGE.UI);
  engine.add(new StatsOverlay(engine, debug), STAGE.DEBUG);
  engine.add(new StateInspector(engine, debug, player, lockOn), STAGE.DEBUG);
  engine.add(new GamepadOverlay(engine, debug, input, player), STAGE.DEBUG);

  // Debug: skip the intro. Iterating on movement should not cost 25 seconds.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !intro.finished) intro.skip();
  });

  if (TUNING.debug.startZone === 'testroom') {
    intro.skip();
  } else {
    hud.setVisible(false);
    intro.start(room.group);
  }

  boot.step(94, 'first frame');
  renderer.render();
  engine.add(renderer, STAGE.RENDER);

  boot.step(100, 'ready');
  await new Promise((r) => setTimeout(r, 140));
  boot.done();

  engine.start();
  window.__VESSEL_READY = true;
  window.__VESSEL_API = { engine, player, intro, lockOn, cameraRig, STATE };
}

main().catch((err) => boot.fail(err));
