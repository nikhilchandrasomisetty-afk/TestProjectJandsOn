'use strict';

import * as THREE from 'three';
import { AIR, atlasTexture, isSolid, isLiquid } from './blocks.js';
import { buildChunkGeometry } from './mesher.js';
import { TerrainGenerator, BIOME_NAMES } from './worldgen.js';
import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  WORLD_HEIGHT,
  SETTINGS,
  blockIndex,
  chunkKey,
} from './config.js';

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.generated = false;
    this.needsMesh = true;
    this.meshes = [];
  }

  get(x, y, z) {
    return this.blocks[blockIndex(x, y, z)];
  }

  set(x, y, z, id) {
    this.blocks[blockIndex(x, y, z)] = id;
  }
}

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {number} seed
   */
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map();
    /** chunkKey -> Map(blockIndex -> blockId): only player edits are persisted. */
    this.edits = new Map();

    this.materials = {
      opaque: new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true }),
      cutout: new THREE.MeshLambertMaterial({
        map: atlasTexture,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
      }),
      water: new THREE.MeshLambertMaterial({
        map: atlasTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };

    this.sample = (x, y, z) => this.getBlock(x, y, z);
    this.stats = { chunks: 0, pending: 0 };
  }

  // ------------------------------------------------------------- accessors

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Reads a block in world coordinates. Ungenerated or out-of-range is air. */
  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  isSolidAt(x, y, z) {
    return isSolid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  isLiquidAt(x, y, z) {
    return isLiquid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  biomeNameAt(x, z) {
    const h = this.generator.heightAt(Math.floor(x), Math.floor(z));
    return BIOME_NAMES[this.generator.biomeAt(Math.floor(x), Math.floor(z), h)];
  }

  /** Y of the first air block above the terrain — used for spawning. */
  surfaceY(x, z) {
    for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
      if (isSolid(this.getBlock(x, y, z))) return y + 1;
    }
    return WORLD_HEIGHT / 2;
  }

  // -------------------------------------------------------------- mutation

  /** Places or removes a block and re-meshes every chunk that can see it. */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return false;

    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    if (chunk.get(lx, y, lz) === id) return false;
    chunk.set(lx, y, lz, id);

    const key = chunkKey(cx, cz);
    let edits = this.edits.get(key);
    if (!edits) {
      edits = new Map();
      this.edits.set(key, edits);
    }
    edits.set(blockIndex(lx, y, lz), id);

    this.remesh(chunk);
    // Neighbouring chunks share faces and AO samples at the seams.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const touchesX = (dx === -1 && lx <= 1) || (dx === 1 && lx >= CHUNK_SIZE - 2);
        const touchesZ = (dz === -1 && lz <= 1) || (dz === 1 && lz >= CHUNK_SIZE - 2);
        const relevant = (dx === 0 || touchesX) && (dz === 0 || touchesZ);
        if (!relevant) continue;
        const neighbor = this.getChunk(cx + dx, cz + dz);
        if (neighbor && neighbor.generated) this.remesh(neighbor);
      }
    }
    return true;
  }

  // ------------------------------------------------------------- streaming

  ensureChunkData(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    if (chunk.generated) return chunk;

    this.generator.generateChunk(cx, cz, chunk.blocks);
    const edits = this.edits.get(key);
    if (edits) for (const [index, id] of edits) chunk.blocks[index] = id;
    chunk.generated = true;
    chunk.needsMesh = true;
    return chunk;
  }

  disposeMeshes(chunk) {
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    chunk.meshes.length = 0;
  }

  remesh(chunk) {
    // Neighbour data must exist (including diagonals) for seams and AO.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.ensureChunkData(chunk.cx + dx, chunk.cz + dz);
      }
    }

    this.disposeMeshes(chunk);
    const geometries = buildChunkGeometry(this.sample, chunk.cx, chunk.cz, chunk.blocks);

    for (const [pass, geometry] of Object.entries(geometries)) {
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.materials[pass]);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (pass === 'water') mesh.renderOrder = 1;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      chunk.meshes.push(mesh);
    }
    chunk.needsMesh = false;
  }

  /**
   * Streams chunks around the player within a time budget so frames stay
   * smooth while the world loads.
   * @returns {number} chunks still waiting to be built
   */
  update(playerX, playerZ, budgetMs = SETTINGS.chunkBudgetMs) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    const radius = SETTINGS.renderDistance;

    const wanted = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > radius * radius) continue;
        const chunk = this.getChunk(pcx + dx, pcz + dz);
        if (chunk && chunk.generated && !chunk.needsMesh) continue;
        wanted.push({ cx: pcx + dx, cz: pcz + dz, distSq });
      }
    }
    wanted.sort((a, b) => a.distSq - b.distSq);

    const deadline = performance.now() + budgetMs;
    let built = 0;
    for (const { cx, cz } of wanted) {
      const chunk = this.ensureChunkData(cx, cz);
      if (chunk.needsMesh) this.remesh(chunk);
      built++;
      if (performance.now() > deadline) break;
    }

    this.unloadDistant(pcx, pcz, radius + 2);
    this.stats.chunks = this.chunks.size;
    this.stats.pending = Math.max(0, wanted.length - built);
    return this.stats.pending;
  }

  unloadDistant(pcx, pcz, maxDistance) {
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz <= maxDistance * maxDistance) continue;
      this.disposeMeshes(chunk);
      this.chunks.delete(key);
    }
  }

  // ---------------------------------------------------------- persistence

  serializeEdits() {
    const out = {};
    for (const [key, edits] of this.edits) {
      const flat = new Array(edits.size * 2);
      let i = 0;
      for (const [index, id] of edits) {
        flat[i++] = index;
        flat[i++] = id;
      }
      out[key] = flat;
    }
    return out;
  }

  loadEdits(data) {
    this.edits.clear();
    if (!data) return;
    for (const [key, flat] of Object.entries(data)) {
      const edits = new Map();
      for (let i = 0; i < flat.length; i += 2) edits.set(flat[i], flat[i + 1]);
      this.edits.set(key, edits);
    }
  }

  /** Drops every loaded chunk so the next update() rebuilds from generator + edits. */
  reload() {
    for (const chunk of this.chunks.values()) this.disposeMeshes(chunk);
    this.chunks.clear();
  }

  /**
   * Voxel ray march (Amanatides & Woo). Returns the first non-air block hit
   * plus the adjacent empty cell, which is where a new block would go.
   */
  raycast(origin, direction, maxDistance = SETTINGS.reach, ignoreLiquid = true) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = Math.sign(direction.x);
    const stepY = Math.sign(direction.y);
    const stepZ = Math.sign(direction.z);

    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / direction.x);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / direction.y);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / direction.z);

    const boundary = (pos, step) => (step > 0 ? Math.floor(pos) + 1 - pos : pos - Math.floor(pos));
    let tMaxX = stepX === 0 ? Infinity : boundary(origin.x, stepX) * tDeltaX;
    let tMaxY = stepY === 0 ? Infinity : boundary(origin.y, stepY) * tDeltaY;
    let tMaxZ = stepZ === 0 ? Infinity : boundary(origin.z, stepZ) * tDeltaZ;

    let normal = [0, 0, 0];
    let travelled = 0;

    while (travelled <= maxDistance) {
      const id = this.getBlock(x, y, z);
      if (id !== AIR && !(ignoreLiquid && isLiquid(id))) {
        return {
          block: { x, y, z, id },
          place: { x: x + normal[0], y: y + normal[1], z: z + normal[2] },
          normal,
        };
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        travelled = tMaxX;
        tMaxX += tDeltaX;
        normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        travelled = tMaxY;
        tMaxY += tDeltaY;
        normal = [0, -stepY, 0];
      } else {
        z += stepZ;
        travelled = tMaxZ;
        tMaxZ += tDeltaZ;
        normal = [0, 0, -stepZ];
      }
      if (y < 0 || y >= WORLD_HEIGHT) return null;
    }
    return null;
  }
}
