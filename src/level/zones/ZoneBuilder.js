import * as THREE from 'three';
import { FILTERS } from '../../physics/PhysicsWorld.js';

/**
 * ZoneBuilder — the construction context every zone module receives.
 *
 * Zones are separate files so that the art pass can run three agents in
 * parallel without them writing the same source. That only works if the zones
 * share no mutable state beyond this object, so everything a zone is allowed
 * to touch is reachable from here and nothing else is.
 *
 * Owns: the scene group, static collider registration, and the registries the
 * chapter reads back (lights, animated emissives, pickups).
 * Forbidden: knowing which zone is calling it, or what any zone looks like.
 */
export class ZoneBuilder {
  constructor(engine, group, materials) {
    this.engine = engine;
    this.bus = engine.bus;
    this.physics = engine.resolve('physics');
    this.player = engine.resolve('player');
    this.state = engine.resolve('state');
    this.group = group;
    this.materials = materials;

    /** Point lights a zone wants animated by the chapter's update. */
    this.lights = [];
    /** Meshes whose emissiveIntensity breathes. `{ mesh, phase }`. */
    this.emissives = [];
    /** Interactables. `{ id, position, radius, label, onPick }`. */
    this.pickups = [];
  }

  /** Parents an object into the chapter group without collision. */
  add(object) {
    this.group.add(object);
    return object;
  }

  /** Mesh + trimesh collider in one call. Static level geometry only. */
  solid(geometry, material, position, { collide = true, rotation = null, group = FILTERS.world } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    this.group.add(mesh);
    if (collide) this.physics.addStaticGeometry(geometry, mesh.matrixWorld.clone(), { group });
    return mesh;
  }

  box(size, position, material, opts = {}) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(position);
    if (opts.rotation) mesh.rotation.copy(opts.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (opts.collide !== false) {
      this.physics.addStaticBox(size, position,
        opts.rotation ? new THREE.Quaternion().setFromEuler(opts.rotation) : null,
        { group: opts.group ?? FILTERS.world });
    }
    return mesh;
  }

  light(color, intensity, distance, position, { decay = 1.8, shadow = false, animate = true } = {}) {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.position.copy(position);
    if (shadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(512, 512);
      l.shadow.camera.far = distance;
      l.shadow.bias = -0.004;
    }
    this.group.add(l);
    if (animate) this.lights.push(l);
    return l;
  }

  /** Registers a mesh for the chapter's emissive breathing pass. */
  emissive(mesh, phase) {
    this.emissives.push({ mesh, phase, base: mesh.material.emissiveIntensity ?? 1 });
    return mesh;
  }

  pickup(def) {
    this.pickups.push(def);
    return def;
  }
}
