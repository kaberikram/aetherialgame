import * as THREE from 'three';
import { Engine, STAGE } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { EVENTS } from './core/EventBus.js';
import { Renderer } from './render/Renderer.js';
import { PostChain } from './render/PostChain.js';
import { MaterialLibrary } from './render/MaterialLibrary.js';
import { resolveQuality } from './render/quality.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { InputSystem } from './input/InputSystem.js';
import { PlayerController, STATE } from './character/PlayerController.js';
import { CameraRig } from './character/CameraRig.js';
import { LockOn } from './combat/LockOn.js';
import { HitboxSystem } from './combat/HitboxSystem.js';
import { DamageSystem } from './combat/DamageSystem.js';
import { TrainingDummy } from './combat/TrainingDummy.js';
import { Chapter1, WAYPOINTS } from './level/Chapter1.js';
import { ZoneManager } from './level/ZoneManager.js';
import { CheckpointSystem } from './level/Checkpoint.js';
import { BossEncounter } from './level/BossEncounter.js';
import { BossBar } from './ui/BossBar.js';
import { VoidSequence } from './narrative/VoidSequence.js';
import { Pigeon } from './companion/Pigeon.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { HUD } from './ui/HUD.js';
import { PauseMenu } from './ui/PauseMenu.js';
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
  const quality = engine.provide('quality', resolveQuality());
  const renderer = engine.provide('renderer', new Renderer(viewport));
  renderer.attach(engine);

  boot.step(11, 'post chain');
  const post = engine.provide('post', new PostChain(engine, quality));
  if (post.enabled) renderer.composer = post;

  boot.step(15, 'surfaces');
  const materials = engine.provide('materials', new MaterialLibrary(quality));

  const debug = engine.provide('debug', new DebugSystem(engine, document.getElementById('debug-root')));

  boot.step(20, 'physics');
  const physics = engine.provide('physics', await PhysicsWorld.create(engine));

  boot.step(34, 'input');
  const input = engine.provide('input', new InputSystem(engine, renderer.renderer.domElement));

  boot.step(62, 'body');
  const player = engine.provide('player', new PlayerController(engine));
  const cameraRig = engine.provide('camera', new CameraRig(engine, player));
  const lockOn = engine.provide('lockOn', new LockOn(engine, player));

  boot.step(74, 'combat');
  const hitboxes = engine.provide('hitboxes', new HitboxSystem(engine));
  const damage = engine.provide('damage', new DamageSystem(engine));
  player.attachCombat({ hitboxes, damage, lockOn });
  const alignment = engine.provide('alignment', player.attachAlignment());
  // No weapon at the start. It is found in the mud beside a dead warrior at
  // beat 5, and combat is genuinely unavailable until then.

  // The chapter needs the player and combat services, so it is constructed
  // after them and before the encounter that sits inside it.
  boot.step(78, 'world');
  const chapter = engine.provide('chapter', new Chapter1(engine)).build();

  const dummies = [];

  boot.step(80, 'the pool');
  const encounter = engine.provide('encounter', new BossEncounter(engine, {
    center: WAYPOINTS.starChamber.clone(),
    radius: 15,
  }));

  const checkpoints = engine.provide('checkpoints', new CheckpointSystem(engine, player));
  checkpoints.add({ id: 'descent', position: WAYPOINTS.descentBottom.clone().setY(-13.6), facing: Math.PI });
  checkpoints.add({ id: 'greenVein', position: new THREE.Vector3(0, -18.9, -34), facing: Math.PI });
  checkpoints.add({ id: 'poolEdge', position: WAYPOINTS.poolApproach.clone().setY(-22.2), facing: Math.PI });

  const zones = engine.provide('zones', new ZoneManager(engine));
  zones.post = post; // the grade rides the zone crossfade
  const bounds = (minX, minY, minZ, maxX, maxY, maxZ) => ({
    min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ),
  });
  zones.register('descent', bounds(-30, -20, 0, 30, 12, 46));
  zones.register('greenVein', bounds(-30, -26, -52, 30, -6, 0));
  zones.register('starChamber', bounds(-40, -34, -98, 40, -8, -52));
  zones.register('pagodaWell', bounds(-40, -34, -150, 40, 40, -98));
  zones.snapTo('void');

  boot.step(82, 'the companion');
  const pigeon = engine.provide('pigeon', new Pigeon(engine, { player, chapter }));
  pigeon.setPath([
    WAYPOINTS.embodiment, WAYPOINTS.descentTop, WAYPOINTS.descentBottom,
    WAYPOINTS.greenVein, WAYPOINTS.sword, WAYPOINTS.poolApproach,
    WAYPOINTS.starChamber, WAYPOINTS.pagodaGate, WAYPOINTS.pagodaFloor,
  ]);
  // Tell #2 needs to know where the star's light pools.
  pigeon.setStarRepulsor(encounter.arena.starGroup.position);

  boot.step(86, 'sound');
  const audio = engine.provide('audio', new AudioSystem(engine));

  const hud = new HUD(engine, player);

  // Damage lands on the player through events, so the controller never needs a
  // reference to whatever hit it.
  engine.bus.on(EVENTS.HIT_LANDED, (e) => {
    if (e.victim === player) player.onDamaged(e);
  });

  boot.step(84, 'the void');
  const intro = new VoidSequence(engine, player, cameraRig).build();
  intro.landingPosition = WAYPOINTS.embodiment.clone();
  intro.landingFacing = Math.PI;
  intro.hud = hud;
  intro.pigeon = pigeon;
  intro.onComplete = () => {
    cameraRig.snap({ yaw: intro.landingFacing + Math.PI });
    zones.snapTo('descent');
    hud.setBarsVisible(true);
  };

  // --- module registration, ordered by STAGE ------------------------------
  engine.add(input, STAGE.INPUT);
  engine.add(intro, STAGE.NARRATIVE);
  engine.add(player, STAGE.CHARACTER);
  engine.add(lockOn, STAGE.COMBAT);
  engine.add(hitboxes, STAGE.COMBAT + 10);
  engine.add(damage, STAGE.COMBAT + 20);
  engine.add(physics, STAGE.PHYSICS);
  engine.add(cameraRig, STAGE.CAMERA);
  engine.add(pigeon, STAGE.AI + 5);
  engine.add(chapter, STAGE.WORLD - 10);
  engine.add(zones, STAGE.WORLD - 5);
  engine.add(encounter, STAGE.AI + 10);
  engine.add(checkpoints, STAGE.WORLD);
  engine.add(audio, STAGE.AUDIO);
  engine.add(hud, STAGE.UI);
  engine.add(new BossBar(engine), STAGE.UI);
  engine.add(new PauseMenu(engine), STAGE.UI + 5);
  engine.add(new StatsOverlay(engine, debug), STAGE.DEBUG);
  engine.add(new StateInspector(engine, debug, player, lockOn), STAGE.DEBUG);
  engine.add(new GamepadOverlay(engine, debug, input, player), STAGE.DEBUG);
  engine.add(new CombatInspector(engine, debug, player, dummies), STAGE.DEBUG);

  // Debug keys that need gameplay references. The intro skip lives on
  // backtick, NOT Escape — Escape is the most natural key for a confused
  // player (and the browser's pointer-lock release), and having it silently
  // skip the opening is how the first playtest teleported past beat 1.
  window.addEventListener('keydown', (e) => {
    if (e.key === '\`' && !intro.finished) intro.skip();
    if (e.key === '0') TUNING.debug.invulnerable = !TUNING.debug.invulnerable;
    if (e.key === '-') player.vitals.applyDamage(9999, 0, 'debug') && player.die();
    if (e.key === '=') player.refillFlask();
    if (e.key === '9') encounter.forceStart();
    if (e.key === '8') encounter.forceWingChoice();
    // Debug zone warps. Each carries a facing, because arriving pointed at a
    // wall makes a zone look broken when it is only badly oriented.
    const warps = {
      1: ['embodiment', Math.PI], 2: ['descentBottom', Math.PI], 3: ['greenVein', Math.PI],
      4: ['poolApproach', Math.PI], 5: ['pagodaFloor', -Math.PI / 2],
    };
    if (warps[e.key]) {
      const [name, facing] = warps[e.key];
      const wp = WAYPOINTS[name];
      player.respawn(wp.clone().setY(wp.y + 0.5), facing);
      cameraRig.snap({ yaw: facing + Math.PI });
      intro.finished || intro.skip();
    }
  });

  if (TUNING.debug.startZone) {
    intro.skip();
  } else {
    // Bars only — subtitles, prompts and hints MUST stay live in the void.
    // Hiding the whole HUD here is the bug that made the opening unplayable.
    hud.setBarsVisible(false);
    intro.start(chapter.group);
  }

  boot.step(92, 'daylight');
  chapter.bakeVolumetrics();

  boot.step(94, 'first frame');
  renderer.render();
  engine.add(renderer, STAGE.RENDER);

  boot.step(100, 'ready');
  await new Promise((r) => setTimeout(r, 140));
  boot.done();

  engine.start();
  window.__VESSEL_READY = true;
  window.__VESSEL_API = {
    engine, player, intro, lockOn, cameraRig, checkpoints, hitboxes, damage, state, chapter, zones,
    encounter, boss: encounter.boss, arena: encounter.arena, alignment, pigeon, STATE,
    renderer, post, materials, quality, audio,
  };
}

main().catch((err) => boot.fail(err));
