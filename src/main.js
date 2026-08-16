import * as THREE from 'three';
import { Engine, STAGE } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { EVENTS } from './core/EventBus.js';
import { Renderer } from './render/Renderer.js';
import { resolveQuality } from './render/quality.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { InputSystem } from './input/InputSystem.js';
import { PlayerController, STATE } from './character/PlayerController.js';
import { CameraRig } from './character/CameraRig.js';
import { Chapter1, WAYPOINTS } from './level/Chapter1.js';
import { ZoneManager } from './level/ZoneManager.js';
import { CheckpointSystem } from './level/Checkpoint.js';
import { BossEncounter } from './level/BossEncounter.js';
import { VoidSequence } from './narrative/VoidSequence.js';
import { BEAT } from './narrative/Beats.js';
import { Pigeon } from './companion/Pigeon.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { HUD } from './ui/HUD.js';
import { PauseMenu } from './ui/PauseMenu.js';
import { DebugSystem } from './debug/DebugSystem.js';
import { StatsOverlay } from './debug/StatsOverlay.js';
import { StateInspector } from './debug/StateInspector.js';
import { GamepadOverlay } from './debug/GamepadOverlay.js';
import { ColliderView } from './debug/ColliderView.js';
import { FreeCam } from './debug/FreeCam.js';
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
  const quality = engine.provide('quality', resolveQuality());
  const renderer = engine.provide('renderer', new Renderer(viewport, quality));
  renderer.attach(engine);

  const debug = engine.provide('debug', new DebugSystem(engine, document.getElementById('debug-root')));

  boot.step(22, 'physics');
  const physics = engine.provide('physics', await PhysicsWorld.create(engine));

  boot.step(38, 'input');
  const input = engine.provide('input', new InputSystem(engine, renderer.renderer.domElement));

  boot.step(58, 'body');
  const player = engine.provide('player', new PlayerController(engine));
  const cameraRig = engine.provide('camera', new CameraRig(engine, player));
  engine.provide('alignment', player.attachAlignment());

  // The chapter needs the player, so it is constructed after it and before the
  // encounter that sits inside it.
  boot.step(72, 'world');
  const chapter = engine.provide('chapter', new Chapter1(engine)).build();

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
  chapter.registerZoneGroups(zones);
  const bounds = (minX, minY, minZ, maxX, maxY, maxZ) => ({
    min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ),
  });
  zones.register('descent', bounds(-30, -20, 0, 30, 12, 46));
  zones.register('greenVein', bounds(-30, -26, -52, 30, -6, 0));
  zones.register('starChamber', bounds(-40, -34, -98, 40, -8, -52));
  zones.register('pagodaWell', bounds(-40, -34, -150, 40, 40, -98));
  zones.snapTo('void');

  // The arena's per-frame work is chamber-local. It used to run from every
  // zone in the chapter, rewriting the pool's vertex buffer while the player
  // was a hundred metres away in the Descent.
  let sawPool = false;
  engine.bus.on(EVENTS.ZONE_ENTERED, ({ id }) => {
    encounter.setArenaActive(id === 'starChamber');
    // Beat 4 — the still pool, seen from the steps. Fires the first time the
    // player is in the room, which is the moment the beat describes.
    if (id === 'starChamber' && !sawPool) {
      sawPool = true;
      engine.bus.emit(EVENTS.BEAT_ENTERED, { id: BEAT.STILL_POOL });
    }
  });

  boot.step(84, 'the companion');
  const pigeon = engine.provide('pigeon', new Pigeon(engine, { player, chapter }));
  pigeon.setPath([
    WAYPOINTS.embodiment, WAYPOINTS.descentTop, WAYPOINTS.descentBottom,
    WAYPOINTS.greenVein, WAYPOINTS.sword, WAYPOINTS.poolApproach,
    WAYPOINTS.starChamber, WAYPOINTS.pagodaGate, WAYPOINTS.pagodaFloor,
  ]);
  // Tell #2 needs to know where the star's light pools.
  pigeon.setStarRepulsor(encounter.arena.starGroup.position);

  boot.step(88, 'sound');
  engine.provide('audio', new AudioSystem(engine));

  const hud = new HUD(engine, player);

  boot.step(90, 'the void');
  const intro = new VoidSequence(engine, player, cameraRig).build();
  intro.landingPosition = WAYPOINTS.embodiment.clone();
  intro.landingFacing = Math.PI;
  intro.hud = hud;
  intro.pigeon = pigeon;
  intro.onComplete = () => {
    cameraRig.snap({ yaw: intro.landingFacing + Math.PI });
    zones.snapTo('descent');
    hud.setBarsVisible(true);
    engine.bus.emit(EVENTS.BEAT_ENTERED, { id: BEAT.DESCENT });
    bakeShadows();
  };

  // Beat 8 fires when the wings resolve. `onWingsResolved` was assigned by
  // nothing before, so the chapter's own ending had no listener.
  encounter.onWingsResolved = (variant) => {
    engine.bus.emit(EVENTS.DIALOGUE_LINE, {
      speaker: 'the pigeon', text: 'Seven trials remain.', duration: 4.5,
    });
    void variant;
  };

  // One directional shadow map, rendered once and then frozen. Every occluder
  // in this chapter is static blockout, so the map is identical on frame two.
  //
  // Timing matters and is easy to get wrong: `intro.start()` hides the whole
  // chapter group for the duration of the void, so baking at boot bakes an
  // empty map and freezes it that way. That is precisely how the old
  // volumetric occlusion bake ended up sampling a blank texture for the entire
  // run — the shadow bake got the ordering right and the one beside it did not.
  let shadowsBaked = false;
  function bakeShadows() {
    if (shadowsBaked || quality.shadows === false) return;
    shadowsBaked = true;
    renderer.freezeShadows();
  }

  // --- module registration, ordered by STAGE ------------------------------
  engine.add(input, STAGE.INPUT);
  engine.add(intro, STAGE.NARRATIVE);
  engine.add(player, STAGE.CHARACTER);
  engine.add(physics, STAGE.PHYSICS);
  engine.add(cameraRig, STAGE.CAMERA);
  engine.add(pigeon, STAGE.AI + 5);
  engine.add(chapter, STAGE.WORLD - 10);
  engine.add(zones, STAGE.WORLD - 5);
  engine.add(encounter, STAGE.AI + 10);
  engine.add(checkpoints, STAGE.WORLD);
  engine.add(engine.resolve('audio'), STAGE.AUDIO);
  engine.add(hud, STAGE.UI);
  engine.add(new PauseMenu(engine), STAGE.UI + 5);
  engine.add(new StatsOverlay(engine, debug), STAGE.DEBUG);
  engine.add(new StateInspector(engine, debug, player), STAGE.DEBUG);
  engine.add(new GamepadOverlay(engine, debug, input, player), STAGE.DEBUG);
  engine.add(new ColliderView(engine, debug), STAGE.DEBUG);
  // After the camera rig, so entering freecam overwrites the rig's transform
  // for the frame rather than being overwritten by it.
  engine.add(new FreeCam(engine, debug), STAGE.DEBUG + 5);

  // Debug keys that need gameplay references. The intro skip lives on
  // backtick, NOT Escape — Escape is the most natural key for a confused
  // player (and the browser's pointer-lock release), and having it silently
  // skip the opening is how the first playtest teleported past beat 1.
  window.addEventListener('keydown', (e) => {
    if (e.key === '`' && !intro.finished) intro.skip();
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

  // The ink pass, once, after every zone AND the arena exist. Merging per zone
  // rather than per mesh is what keeps the line work to four draw calls.
  boot.step(94, 'ink');
  chapter.bakeInk();

  boot.step(96, 'first frame');
  renderer.render();
  engine.add(renderer, STAGE.RENDER);

  boot.step(100, 'ready');
  await new Promise((r) => setTimeout(r, 140));
  boot.done();

  engine.start();

  // ?bench — the one number this repo cannot measure for itself. Costs the
  // shipping build a URLSearchParams read and a branch.
  if (new URLSearchParams(location.search).has('bench')) {
    const { Bench } = await import('./debug/Bench.js');
    const bench = new Bench(engine, {
      player, cameraRig, intro, waypoints: WAYPOINTS, renderer, quality,
    });
    engine.add(bench, STAGE.DEBUG + 10);
    bench.start();
    window.__VESSEL_BENCH_RUN = bench;
  }

  window.__VESSEL_READY = true;
  // The chapter's coordinate truth, for tools/collision.mjs — every spawn,
  // checkpoint and debug warp resolves from this table, so auditing it is
  // auditing the real thing.
  window.__VESSEL_WAYPOINTS = WAYPOINTS;
  window.__VESSEL_API = {
    engine, player, intro, cameraRig, checkpoints, state, chapter, zones,
    encounter, boss: encounter.boss, arena: encounter.arena,
    alignment: engine.resolve('alignment'), pigeon, STATE,
    renderer, quality, audio: engine.resolve('audio'), debug,
  };
}

main().catch((err) => boot.fail(err));
