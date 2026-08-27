import * as THREE from 'three';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk, WorldGenerator, SEA_LEVEL } from './world.js';
import { buildChunkGeometry, createVoxelMaterial } from './mesher.js';
import { BlockIds, isOpaque, isSolid, getBlock } from './blocks.js';

export class ChunkManager {
  constructor(scene, seed, atlas, settings) {
    this.scene = scene;
    this.seed = seed;
    this.atlas = atlas;
    this.settings = settings;
    this.generator = new WorldGenerator(seed);
    this.chunks = new Map();          // "cx,cz" -> Chunk
    this.meshQueue = [];              // chunk keys waiting to be meshed
    this.genQueue = [];               // {cx, cz, dist}
    this.pendingGen = new Set();
    this.skyCache = new Map();        // "wx,wz" -> highest opaque y
    this.modifications = new Map();   // "cx,cz" -> Map("x,y,z" -> id) player edits, for saving

    const tileSize = atlas.tileSize;
    this.material = createVoxelMaterial(atlas.texture, tileSize, {});
    this.waterMaterial = createVoxelMaterial(atlas.texture, tileSize, {
      transparent: true, opacity: 0.72, depthWrite: false, water: true, side: THREE.DoubleSide,
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  key(cx, cz) { return cx + ',' + cz; }

  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  worldToChunk(wx, wz) {
    return [Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z)];
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_Y) return BlockIds.AIR;
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return BlockIds.AIR;
    return chunk.get(wx - cx * CHUNK_X, wy, wz - cz * CHUNK_Z);
  }

  isLoaded(wx, wz) {
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    return this.chunks.has(this.key(cx, cz));
  }

  setBlock(wx, wy, wz, id, record = true) {
    if (wy < 0 || wy >= CHUNK_Y) return false;
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) return false;
    const lx = wx - cx * CHUNK_X, lz = wz - cz * CHUNK_Z;
    if (chunk.get(lx, wy, lz) === id) return false;
    chunk.set(lx, wy, lz, id);

    if (record) {
      const k = this.key(cx, cz);
      let mods = this.modifications.get(k);
      if (!mods) { mods = new Map(); this.modifications.set(k, mods); }
      mods.set(`${lx},${wy},${lz}`, id);
    }

    this.skyCache.delete(wx + ',' + wz);
    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_X - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_Z - 1) this.markDirty(cx, cz + 1);
    return true;
  }

  markDirty(cx, cz) {
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;
    chunk.dirty = true;
    const k = this.key(cx, cz);
    if (!this.meshQueue.includes(k)) this.meshQueue.unshift(k);
  }

  getSkyHeight(wx, wz) {
    const k = wx + ',' + wz;
    const cached = this.skyCache.get(k);
    if (cached !== undefined) return cached;
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    const chunk = this.chunks.get(this.key(cx, cz));
    if (!chunk) {
      // Fall back to the generator's terrain height and don't cache it — once the
      // chunk loads the real column height replaces this estimate.
      return this.generator.columnInfo(wx, wz).surface;
    }
    const lx = wx - cx * CHUNK_X, lz = wz - cz * CHUNK_Z;
    let top = 0;
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      const id = chunk.get(lx, y, lz);
      if (id !== BlockIds.AIR && id !== BlockIds.WATER && isOpaque(id)) { top = y; break; }
    }
    this.skyCache.set(k, top);
    return top;
  }

  requestArea(centerX, centerZ, radius) {
    const [ccx, ccz] = this.worldToChunk(centerX, centerZ);
    const wanted = new Set();
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue;
        const cx = ccx + dx, cz = ccz + dz;
        const k = this.key(cx, cz);
        wanted.add(k);
        if (!this.chunks.has(k) && !this.pendingGen.has(k)) {
          this.pendingGen.add(k);
          this.genQueue.push({ cx, cz, dist: dx * dx + dz * dz, key: k });
        }
      }
    }
    this.genQueue.sort((a, b) => a.dist - b.dist);

    // Unload chunks well outside the radius (keeps memory + draw calls bounded)
    const unloadR = (radius + 3) * (radius + 3);
    for (const [k, chunk] of this.chunks) {
      const d = (chunk.cx - ccx) * (chunk.cx - ccx) + (chunk.cz - ccz) * (chunk.cz - ccz);
      if (d > unloadR) this.unloadChunk(k);
    }
    return wanted;
  }

  unloadChunk(k) {
    const chunk = this.chunks.get(k);
    if (!chunk) return;
    this.disposeMeshes(chunk);
    this.chunks.delete(k);
    const qi = this.meshQueue.indexOf(k);
    if (qi >= 0) this.meshQueue.splice(qi, 1);
  }

  disposeMeshes(chunk) {
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    if (chunk.waterMesh) {
      this.group.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }
  }

  // Amortised work: generate & mesh a bounded number of chunks per frame so the
  // frame rate stays stable while the world streams in.
  update(budgetMs = 6) {
    const start = performance.now();
    while (this.genQueue.length && performance.now() - start < budgetMs) {
      const job = this.genQueue.shift();
      this.pendingGen.delete(job.key);
      if (this.chunks.has(job.key)) continue;
      const chunk = this.generator.generateChunk(job.cx, job.cz);
      const mods = this.modifications.get(job.key);
      if (mods) {
        for (const [pos, id] of mods) {
          const [lx, ly, lz] = pos.split(',').map(Number);
          chunk.set(lx, ly, lz, id);
        }
      }
      this.chunks.set(job.key, chunk);
      this.meshQueue.push(job.key);
      // Neighbours need re-meshing so shared borders close up
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = this.key(job.cx + dx, job.cz + dz);
        if (this.chunks.has(nk) && !this.meshQueue.includes(nk)) this.meshQueue.push(nk);
      }
    }

    while (this.meshQueue.length && performance.now() - start < budgetMs + 6) {
      const k = this.meshQueue.shift();
      const chunk = this.chunks.get(k);
      if (!chunk) continue;
      this.meshChunk(chunk);
    }
  }

  meshChunk(chunk) {
    const { opaque, water } = buildChunkGeometry(this, chunk, this.atlas.getUV);
    this.disposeMeshes(chunk);
    if (opaque) {
      chunk.mesh = new THREE.Mesh(opaque, this.material);
      chunk.mesh.frustumCulled = true;
      chunk.mesh.matrixAutoUpdate = false;
      this.group.add(chunk.mesh);
    }
    if (water) {
      chunk.waterMesh = new THREE.Mesh(water, this.waterMaterial);
      chunk.waterMesh.frustumCulled = true;
      chunk.waterMesh.matrixAutoUpdate = false;
      chunk.waterMesh.renderOrder = 2;
      this.group.add(chunk.waterMesh);
    }
    chunk.dirty = false;
  }

  // Finds a safe standing spot: dry land above sea level with headroom, searched
  // outward in a square spiral from the requested column.
  findSpawn(wx = 8, wz = 8) {
    const tryColumn = (x, z) => {
      for (let y = CHUNK_Y - 3; y > SEA_LEVEL; y--) {
        const b = this.getBlock(x, y, z);
        if (!isSolid(b)) continue;
        if (this.getBlock(x, y + 1, z) !== BlockIds.AIR) return null;
        if (this.getBlock(x, y + 2, z) !== BlockIds.AIR) return null;
        return new THREE.Vector3(x + 0.5, y + 1.02, z + 0.5);
      }
      return null;
    };

    for (let r = 0; r < 64; r++) {
      for (let d = -r; d <= r; d++) {
        for (const [x, z] of [[wx + d, wz - r], [wx + d, wz + r], [wx - r, wz + d], [wx + r, wz + d]]) {
          const spot = tryColumn(x, z);
          if (spot) return spot;
        }
      }
    }
    // Nothing suitable is loaded yet — drop the player in above the water line
    return new THREE.Vector3(wx + 0.5, SEA_LEVEL + 20, wz + 0.5);
  }

  // Collect torch positions near the player for the shader's point-light array.
  collectTorches(center, out, max = 12) {
    let count = 0;
    const R = 12;
    const cx0 = Math.floor(center.x), cy0 = Math.floor(center.y), cz0 = Math.floor(center.z);
    for (let y = Math.max(0, cy0 - R); y < Math.min(CHUNK_Y, cy0 + R) && count < max; y++) {
      for (let x = cx0 - R; x <= cx0 + R && count < max; x++) {
        for (let z = cz0 - R; z <= cz0 + R && count < max; z++) {
          if (this.getBlock(x, y, z) === BlockIds.TORCH) {
            out[count].set(x + 0.5, y + 0.5, z + 0.5);
            count++;
          }
        }
      }
    }
    return count;
  }

  serializeModifications() {
    const out = {};
    for (const [k, mods] of this.modifications) {
      out[k] = Array.from(mods.entries());
    }
    return out;
  }

  loadModifications(data) {
    this.modifications.clear();
    if (!data) return;
    for (const k of Object.keys(data)) {
      this.modifications.set(k, new Map(data[k]));
    }
  }

  dispose() {
    for (const k of Array.from(this.chunks.keys())) this.unloadChunk(k);
    this.scene.remove(this.group);
    this.material.dispose();
    this.waterMaterial.dispose();
  }
}
