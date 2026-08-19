import * as THREE from "three";
import { Chunk, CHUNK_SIZE, WORLD_HEIGHT } from "./chunk.js";
import { WorldGen, SEA_LEVEL, BIOME_NAMES, BIOME } from "./worldgen.js";
import { BLOCKS, defOf, isSolid, isLiquid } from "./blocks.js";
import { buildAtlasOnce } from "./textures.js";

const SAVE_KEY = "blockcraft.save.v1";

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export class World {
  constructor(scene, { seed = 1337, renderDistance = 5 } = {}) {
    this.scene = scene;
    this.seed = seed;
    this.renderDistance = renderDistance;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();

    // Player edits, keyed by world position. Kept separate from chunk data so
    // a save is just the diff against what generation would produce.
    this.edits = new Map();
    this.editIndex = new Map();
    // Decoration blocks (tree canopies) that spill into not-yet-generated chunks.
    this.pending = new Map();

    this.group = new THREE.Group();
    scene.add(this.group);

    const { texture } = buildAtlasOnce();
    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      vertexColors: true,
    });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.generateQueue = [];
    this.meshQueue = [];
    this.stats = { chunks: 0, generated: 0, meshed: 0 };

    // Bound once — this is called millions of times during meshing.
    this.sample = (x, y, z) => this.getBlock(x, y, z);
  }

  // --- chunk access ---------------------------------------------------------

  chunkAt(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return BLOCKS.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return BLOCKS.AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  // `record` is false for generation-time writes so they do not enter the save.
  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);

    if (!chunk || !chunk.generated) {
      // Target chunk is not around yet; stash the write until it appears.
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push([x, y, z, id]);
      if (record) {
        this.edits.set(`${x},${y},${z}`, id);
        this.indexEdit(x, y, z, id);
      }
      return false;
    }

    chunk.set(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE, id);
    if (record) {
      this.edits.set(`${x},${y},${z}`, id);
      this.indexEdit(x, y, z, id);
      chunk.modified = true;
    }

    this.markDirtyAround(x, y, z, cx, cz);
    return true;
  }

  // A block on a chunk border changes how its neighbor is lit and culled.
  markDirtyAround(x, y, z, cx, cz) {
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const touch = (dx, dz) => {
      const c = this.chunkAt(cx + dx, cz + dz);
      if (c && c.generated) c.dirty = true;
    };
    if (lx <= 1) touch(-1, 0);
    if (lx >= CHUNK_SIZE - 2) touch(1, 0);
    if (lz <= 1) touch(0, -1);
    if (lz >= CHUNK_SIZE - 2) touch(0, 1);
    if (lx <= 1 && lz <= 1) touch(-1, -1);
    if (lx >= CHUNK_SIZE - 2 && lz <= 1) touch(1, -1);
    if (lx <= 1 && lz >= CHUNK_SIZE - 2) touch(-1, 1);
    if (lx >= CHUNK_SIZE - 2 && lz >= CHUNK_SIZE - 2) touch(1, 1);
  }

  heightAt(x, z) {
    return this.gen.heightAt(x, z);
  }

  // Spirals out from the origin looking for dry, walkable land, so a seed
  // whose origin lands mid-ocean does not drop the player on the seabed.
  findSpawnPoint(maxRadius = 512) {
    // Two passes: first insist on temperate, treed ground worth starting in,
    // then settle for any dry land rather than searching forever.
    const PREFERRED = new Set([BIOME.PLAINS, BIOME.FOREST]);

    const check = (x, z, preferredOnly) => {
      const h = this.gen.heightAt(x, z);
      if (h < SEA_LEVEL + 3) return null;
      const biome = this.gen.biomeFor(x, z, h);
      if (biome === BIOME.OCEAN || biome === BIOME.BEACH) return null;
      if (preferredOnly && !PREFERRED.has(biome)) return null;
      // Reject cliff tops so the player does not spawn on a one-block spire.
      const neighbors = [
        this.gen.heightAt(x + 2, z), this.gen.heightAt(x - 2, z),
        this.gen.heightAt(x, z + 2), this.gen.heightAt(x, z - 2),
      ];
      if (neighbors.some((n) => Math.abs(n - h) > 4)) return null;
      return { x, z, y: h, biome };
    };

    for (const preferredOnly of [true, false]) {
      const origin = check(0, 0, preferredOnly);
      if (origin) return origin;

      for (let r = 6; r <= maxRadius; r += 6) {
        const samples = Math.max(8, Math.round(r / 2));
        for (let i = 0; i < samples; i++) {
          const angle = (i / samples) * Math.PI * 2;
          const x = Math.round(Math.cos(angle) * r);
          const z = Math.round(Math.sin(angle) * r);
          const found = check(x, z, preferredOnly);
          if (found) return found;
        }
      }
    }
    return { x: 0, z: 0, y: this.gen.heightAt(0, 0) };
  }

  biomeNameAt(x, z) {
    return BIOME_NAMES[this.gen.biomeAt(x, z)] ?? "—";
  }

  // Topmost non-air block in a column, searching live chunk data.
  surfaceY(x, z) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== BLOCKS.AIR && !isLiquid(id)) return y;
    }
    return SEA_LEVEL;
  }

  // --- generation -----------------------------------------------------------

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
      this.generateQueue.push(chunk);
    }
    return chunk;
  }

  generateChunk(chunk) {
    const decorations = this.gen.generateChunk(chunk.cx, chunk.cz, chunk.blocks);
    chunk.generated = true;
    this.stats.generated++;

    // Trees are emitted after the terrain so canopies can overwrite air only.
    for (const dec of decorations) {
      for (const [x, y, z, id] of this.gen.decorationBlocks(dec)) {
        this.placeDecorationBlock(x, y, z, id);
      }
    }

    const key = chunkKey(chunk.cx, chunk.cz);
    const queued = this.pending.get(key);
    if (queued) {
      for (const [x, y, z, id] of queued) {
        const lx = x - chunk.cx * CHUNK_SIZE;
        const lz = z - chunk.cz * CHUNK_SIZE;
        if (id === BLOCKS.AIR || chunk.get(lx, y, lz) === BLOCKS.AIR) {
          chunk.set(lx, y, lz, id);
        }
      }
      this.pending.delete(key);
    }

    this.applyEditsTo(chunk);
    chunk.dirty = true;
    this.meshQueue.push(chunk);
  }

  placeDecorationBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);

    if (!chunk || !chunk.generated) {
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key).push([x, y, z, id]);
      return;
    }
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    // Never let a canopy eat terrain — only air gives way.
    if (chunk.get(lx, y, lz) === BLOCKS.AIR) {
      chunk.set(lx, y, lz, id);
      chunk.dirty = true;
    }
  }

  // Edits are indexed by chunk so regenerating a chunk costs only the edits
  // inside it, not a scan of every edit ever made.
  indexEdit(x, y, z, id) {
    const key = chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    let list = this.editIndex.get(key);
    if (!list) {
      list = [];
      this.editIndex.set(key, list);
    }
    const existing = list.findIndex((e) => e[0] === x && e[1] === y && e[2] === z);
    if (existing >= 0) list[existing][3] = id;
    else list.push([x, y, z, id]);
  }

  applyEditsTo(chunk) {
    const list = this.editIndex.get(chunkKey(chunk.cx, chunk.cz));
    if (!list || list.length === 0) return;
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    for (const [x, y, z, id] of list) {
      chunk.set(x - minX, y, z - minZ, id);
    }
    chunk.modified = true;
  }

  // --- meshing --------------------------------------------------------------

  meshChunk(chunk) {
    const { opaque, transparent } = chunk.build(this.sample);

    if (chunk.opaqueMesh) {
      this.group.remove(chunk.opaqueMesh);
      chunk.opaqueMesh.geometry.dispose();
      chunk.opaqueMesh = null;
    }
    if (chunk.transparentMesh) {
      this.group.remove(chunk.transparentMesh);
      chunk.transparentMesh.geometry.dispose();
      chunk.transparentMesh = null;
    }

    if (opaque) {
      chunk.opaqueMesh = new THREE.Mesh(opaque, this.opaqueMaterial);
      chunk.opaqueMesh.frustumCulled = true;
      this.group.add(chunk.opaqueMesh);
    }
    if (transparent) {
      chunk.transparentMesh = new THREE.Mesh(transparent, this.transparentMaterial);
      chunk.transparentMesh.renderOrder = 1;
      chunk.transparentMesh.frustumCulled = true;
      this.group.add(chunk.transparentMesh);
    }
    this.stats.meshed++;
  }

  unloadChunk(chunk) {
    if (chunk.opaqueMesh) this.group.remove(chunk.opaqueMesh);
    if (chunk.transparentMesh) this.group.remove(chunk.transparentMesh);
    chunk.dispose();
    this.chunks.delete(chunkKey(chunk.cx, chunk.cz));
  }

  // Streams chunks around the player within a per-frame time budget so that
  // world loading never blocks the render loop long enough to drop frames.
  update(playerPos, budgetMs = 8) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const r = this.renderDistance;

    // Request chunks nearest-first so the world fills outward from the player.
    const wanted = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = dx * dx + dz * dz;
        if (dist > r * r + r) continue;
        wanted.push([dist, pcx + dx, pcz + dz]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of wanted) this.ensureChunk(cx, cz);

    const start = performance.now();

    this.generateQueue.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });

    while (this.generateQueue.length && performance.now() - start < budgetMs) {
      const chunk = this.generateQueue.shift();
      if (!chunk.generated) this.generateChunk(chunk);
    }

    // Re-mesh anything marked dirty, nearest first.
    const dirty = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.generated && chunk.dirty) {
        // Meshing needs neighbors present or the chunk's borders come out wrong.
        if (this.neighborsReady(chunk.cx, chunk.cz)) dirty.push(chunk);
      }
    }
    dirty.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });

    for (const chunk of dirty) {
      if (performance.now() - start >= budgetMs * 2) break;
      this.meshChunk(chunk);
    }

    // Drop chunks well outside the view so memory stays bounded.
    const limit = r + 2;
    for (const chunk of [...this.chunks.values()]) {
      if (Math.abs(chunk.cx - pcx) > limit || Math.abs(chunk.cz - pcz) > limit) {
        this.unloadChunk(chunk);
      }
    }

    this.stats.chunks = this.chunks.size;
  }

  neighborsReady(cx, cz) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.chunkAt(cx + dx, cz + dz);
        if (!c || !c.generated) return false;
      }
    }
    return true;
  }

  isReadyAround(pos) {
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    return this.neighborsReady(cx, cz);
  }

  // --- interaction ----------------------------------------------------------

  // Amanatides & Woo voxel traversal: walks the exact grid cells the ray
  // crosses, which is both faster and more precise than mesh raycasting.
  raycast(origin, direction, maxDistance = 7, includeLiquid = false) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = Math.sign(direction.x);
    const stepY = Math.sign(direction.y);
    const stepZ = Math.sign(direction.z);

    const tDeltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity;

    let tMaxX = stepX !== 0
      ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX
      : Infinity;
    let tMaxY = stepY !== 0
      ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY
      : Infinity;
    let tMaxZ = stepZ !== 0
      ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ
      : Infinity;

    let normal = [0, 0, 0];
    let t = 0;

    while (t <= maxDistance) {
      const id = this.getBlock(x, y, z);
      if (id !== BLOCKS.AIR && (includeLiquid || !defOf(id).liquid)) {
        return { x, y, z, id, normal, distance: t };
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        normal = [0, -stepY, 0];
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        normal = [0, 0, -stepZ];
      }
    }
    return null;
  }

  // Sand and gravel fall into any air below them, cascading upward from the
  // block that was just removed.
  settleGravity(x, y, z) {
    for (let cy = y; cy < WORLD_HEIGHT; cy++) {
      const id = this.getBlock(x, cy, z);
      if (id === BLOCKS.AIR) continue;
      if (!defOf(id).gravity) break;

      let dest = cy;
      while (dest > 0) {
        const below = this.getBlock(x, dest - 1, z);
        if (below !== BLOCKS.AIR && !isLiquid(below)) break;
        dest--;
      }
      if (dest !== cy) {
        this.setBlock(x, cy, z, BLOCKS.AIR);
        this.setBlock(x, dest, z, id);
      }
    }
  }

  // --- persistence ----------------------------------------------------------

  save() {
    const edits = [];
    for (const [key, id] of this.edits) edits.push(`${key},${id}`);
    const payload = { seed: this.seed, edits };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  static loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.seed !== "number" || !Array.isArray(parsed.edits)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  }

  applySave(parsed) {
    this.edits.clear();
    this.editIndex.clear();
    for (const entry of parsed.edits) {
      const parts = entry.split(",").map(Number);
      if (parts.length !== 4 || parts.some(Number.isNaN)) continue;
      const [x, y, z, id] = parts;
      this.edits.set(`${x},${y},${z}`, id);
      this.indexEdit(x, y, z, id);
    }
  }

  isSolidAt(x, y, z) {
    return isSolid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  isLiquidAt(x, y, z) {
    return isLiquid(this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }
}

export { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL };
