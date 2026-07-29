import * as THREE from 'three';
import { Engine, STAGE } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { Renderer } from './render/Renderer.js';
import { DebugSystem } from './debug/DebugSystem.js';
import { StatsOverlay } from './debug/StatsOverlay.js';
import { FoundationScene } from './level/FoundationScene.js';

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
  boot.step(10, 'renderer');

  const engine = new Engine({ fixedHz: 60, maxSubSteps: 5 });
  window.__VESSEL = engine;

  const state = engine.provide('state', new GameState(engine.bus));
  state.load();

  const renderer = engine.provide('renderer', new Renderer(document.getElementById('viewport')));
  renderer.attach(engine);

  const debug = engine.provide('debug', new DebugSystem(engine, document.getElementById('debug-root')));
  engine.add(new StatsOverlay(engine, debug), STAGE.DEBUG);

  boot.step(45, 'world');
  const scene = new FoundationScene(engine);
  await scene.init();
  engine.add(scene, STAGE.WORLD);

  boot.step(85, 'first frame');
  // Draw one frame before dismissing the boot screen so the reveal is the
  // world, not a black gap while shaders compile.
  renderer.render();
  engine.add(renderer, STAGE.RENDER);

  boot.step(100, 'ready');
  await new Promise((r) => setTimeout(r, 120));
  boot.done();

  engine.start();
  window.__VESSEL_READY = true;
}

main().catch((err) => boot.fail(err));
