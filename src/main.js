import * as THREE from 'three';
import { Engine, STAGE } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { EVENTS } from './core/EventBus.js';
import { Renderer } from './render/Renderer.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { InputSystem } from './input/InputSystem.js';
import { PlayerController, STATE } from './character/PlayerController.js';
import { CameraRig } from './character/CameraRig.js';
import { LockOn } from './combat/LockOn.js';
import { HitboxSystem } from './combat/HitboxSystem.js';
import { DamageSystem } from './combat/DamageSystem.js';
import { TrainingDummy } from './combat/TrainingDummy.js';
import { TestRoom } from './level/TestRoom.js';
import { CheckpointSystem } from './level/Checkpoint.js';
import { VoidSequence } from './narrative/VoidSequence.js';
import { HUD } from './ui/HUD.js';
import { DebugSystem } from './debug/DebugSystem.js';
import { StatsOverlay } from './debug/StatsOverlay.js';
import { StateInspector } from './debug/StateInspector.js';
import { GamepadOverlay } from './debug/GamepadOverlay.js';
import { CombatInspector } from './debug/CombatInspector.js';
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
  boot.step(6, 'renderer');
  const engine = new Engine({ fixedHz: 60, maxSubSteps: 5 });
  window.__VESSEL = engine;

  const state = engine.provide('state', new GameState(engine.bus));
  state.load();

  const viewport = document.getElementById('viewport');
  const renderer = engine.provide('renderer', new Renderer(viewport));
  renderer.attach(engine);

  const debug = engine.provide('debug', new DebugSystem(engine, document.getElementById('debug-root')));

  boot.step(20, 'physics');
  const physics = engine.provide('physics', await PhysicsWorld.create(engine));

  boot.step(34, 'input');
  const input = engine.provide('input', new InputSystem(engine, renderer.renderer.domElement));

  boot.step(48, 'world');
  const room = new TestRoom(engine).build();

  boot.step(62, 'body');
  const player = engine.provide('player', new PlayerController(engine));
  const cameraRig = engine.provide('camera', new CameraRig(engine, player));
  const lockOn = engine.provide('lockOn', new LockOn(engine, player));

  boot.step(74, 'combat');
  const hitboxes = engine.provide('hitboxes', new HitboxSystem(engine));
  const damage = engine.provide('damage', new DamageSystem(engine));
  player.attachCombat({ hitboxes, damage, lockOn });
  // Phase 2 is a combat proving ground, so the sword starts in hand. In the
  // real chapter it is found in the mud beside a dead warrior at beat 5.
  player.giveWeapon();

  const dummies = [
    new TrainingDummy(engine, new THREE.Vector3(0, 0, -3), { name: 'Training Dummy' }),
    new TrainingDummy(engine, new THREE.Vector3(6.5, 0, -1), { name: 'Dummy B', maxPoise: 34 }),
    new TrainingDummy(engine, new THREE.Vector3(-6.5, 0, -1), { name: 'Dummy C', maxPoise: 120 }),
  ];
  for (const d of dummies) d.register(hitboxes, lockOn);

  const checkpoints = engine.provide('checkpoints', new CheckpointSystem(engine, player));
  checkpoints.add({ id: 'testroom', position: new THREE.Vector3(-3.5, 0, 7), facing: Math.PI });
  state.addCurrency(340); // something to lose, so the bloodstain loop is testable

  const hud = new HUD(engine, player);

  // Damage lands on the player through events, so the controller never needs a
  // reference to whatever hit it.
  engine.bus.on(EVENTS.HIT_LANDED, (e) => {
    if (e.victim === player) player.onDamaged(e);
  });

  boot.step(84, 'the void');
  const intro = new VoidSequence(engine, player, cameraRig).build();
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
  for (const d of dummies) engine.add(d, STAGE.AI);
  engine.add(lockOn, STAGE.COMBAT);
  engine.add(hitboxes, STAGE.COMBAT + 10);
  engine.add(damage, STAGE.COMBAT + 20);
  engine.add(physics, STAGE.PHYSICS);
  engine.add(cameraRig, STAGE.CAMERA);
  engine.add(checkpoints, STAGE.WORLD);
  engine.add(hud, STAGE.UI);
  engine.add(new StatsOverlay(engine, debug), STAGE.DEBUG);
  engine.add(new StateInspector(engine, debug, player, lockOn), STAGE.DEBUG);
  engine.add(new GamepadOverlay(engine, debug, input, player), STAGE.DEBUG);
  engine.add(new CombatInspector(engine, debug, player, dummies), STAGE.DEBUG);

  // Debug keys that need gameplay references.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !intro.finished) intro.skip();
    if (e.key === '0') TUNING.debug.invulnerable = !TUNING.debug.invulnerable;
    if (e.key === '-') player.vitals.applyDamage(9999, 0, 'debug') && player.die();
    if (e.key === '=') player.refillFlask();
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
  window.__VESSEL_API = {
    engine, player, intro, lockOn, cameraRig, checkpoints, dummies, hitboxes, damage, state, STATE,
  };
}

main().catch((err) => boot.fail(err));
