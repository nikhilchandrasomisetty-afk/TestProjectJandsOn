'use strict';

import { Noise, hash3 } from './noise.js';
import { ID, AIR } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, blockIndex } from './config.js';

export const BIOME = {
  PLAINS: 0,
  FOREST: 1,
  DESERT: 2,
  TUNDRA: 3,
  MOUNTAIN: 4,
};

export const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Tundra', 'Mountains'];

/**
 * Terrain generation. Everything here is a pure function of (seed, x, y, z),
 * which is what lets us regenerate the world from a seed and store only the
 * blocks the player actually changed.
 */
export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed;
    this.continent = new Noise(seed);
    this.hills = new Noise(seed + 101);
    this.mountains = new Noise(seed + 202);
    this.temperature = new Noise(seed + 303);
    this.humidity = new Noise(seed + 404);
    this.cave1 = new Noise(seed + 505);
    this.cave2 = new Noise(seed + 606);
    this.ore = new Noise(seed + 707);
    this._heightCache = new Map();
  }

  heightAt(x, z) {
    const key = x * 100003 + z;
    const cached = this._heightCache.get(key);
    if (cached !== undefined) return cached;

    const c = this.continent.fbm2(x * 0.0022, z * 0.0022, 4);
    const h = this.hills.fbm2(x * 0.009, z * 0.009, 5);
    const raw = this.mountains.fbm2(x * 0.0035, z * 0.0035, 4);
    const m = Math.max(0, raw) ** 2;

    let height = SEA_LEVEL + 2 + c * 11 + h * 6 + m * 36;
    height = Math.max(1, Math.min(WORLD_HEIGHT - 6, Math.round(height)));

    // Bounded cache: terrain queries are spatially local, so a periodic
    // flush keeps memory flat without hurting the hit rate much.
    if (this._heightCache.size > 200000) this._heightCache.clear();
    this._heightCache.set(key, height);
    return height;
  }

  biomeAt(x, z, height) {
    if (height > SEA_LEVEL + 26) return BIOME.MOUNTAIN;
    const temp = this.temperature.fbm2(x * 0.0016, z * 0.0016, 3);
    const humid = this.humidity.fbm2(x * 0.0016, z * 0.0016, 3);
    if (temp < -0.28) return BIOME.TUNDRA;
    if (temp > 0.22 && humid < 0.0) return BIOME.DESERT;
    if (humid > 0.12) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  isCave(x, y, z) {
    if (y < 2) return false;
    const a = this.cave1.fbm3(x * 0.028, y * 0.05, z * 0.028, 2);
    const b = this.cave2.fbm3(x * 0.028, y * 0.05, z * 0.028, 2);
    // Intersecting two noise fields near zero carves tunnels rather than blobs.
    return a * a + b * b < 0.0022;
  }

  oreAt(x, y, z, height) {
    if (y > height - 4) return AIR;
    const n = (ox) => this.ore.perlin3((x + ox) * 0.11, (y + ox) * 0.11, (z + ox) * 0.11);
    if (y < 14 && n(900) > 0.55) return ID.diamond_ore;
    if (y < 26 && n(600) > 0.52) return ID.gold_ore;
    if (y < 46 && n(300) > 0.46) return ID.iron_ore;
    if (n(0) > 0.44) return ID.coal_ore;
    return AIR;
  }

  surfaceBlocks(biome, height) {
    switch (biome) {
      case BIOME.DESERT:
        return { top: ID.sand, filler: ID.sandstone };
      case BIOME.TUNDRA:
        return { top: ID.snow, filler: ID.dirt };
      case BIOME.MOUNTAIN:
        return height > SEA_LEVEL + 34
          ? { top: ID.snow, filler: ID.stone }
          : { top: ID.stone, filler: ID.stone };
      default:
        return { top: ID.grass, filler: ID.dirt };
    }
  }

  /** Fills `blocks` (a chunk's flat array) for chunk coords (cx, cz). */
  generateChunk(cx, cz, blocks) {
    blocks.fill(AIR);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const height = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, height);
        const { top, filler } = this.surfaceBlocks(biome, height);
        const underwater = height < SEA_LEVEL;

        for (let y = 0; y <= height; y++) {
          let id;
          if (y === 0) {
            id = ID.bedrock;
          } else if (y === height) {
            id = underwater ? ID.sand : top;
          } else if (y > height - 4) {
            id = underwater ? ID.sand : filler;
          } else {
            id = ID.stone;
          }

          if (id === ID.stone) {
            const ore = this.oreAt(wx, y, wz, height);
            if (ore !== AIR) id = ore;
          }

          if (y > 0 && y < height && this.isCave(wx, y, wz)) id = AIR;
          blocks[blockIndex(lx, y, lz)] = id;
        }

        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          blocks[blockIndex(lx, y, lz)] = ID.water;
        }
      }
    }

    this.decorate(cx, cz, blocks);
  }

  /**
   * Trees and cacti. Scanned with a margin so features rooted in a
   * neighbouring chunk still drop their overhanging blocks into this one.
   */
  decorate(cx, cz, blocks) {
    const margin = 3;
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    for (let lz = -margin; lz < CHUNK_SIZE + margin; lz++) {
      for (let lx = -margin; lx < CHUNK_SIZE + margin; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const height = this.heightAt(wx, wz);
        if (height <= SEA_LEVEL) continue;

        const biome = this.biomeAt(wx, wz, height);
        const roll = hash3(wx, 0, wz);

        if (biome === BIOME.FOREST || biome === BIOME.PLAINS) {
          const chance = biome === BIOME.FOREST ? 0.035 : 0.006;
          if (roll < chance) this.placeTree(blocks, lx, height + 1, lz, wx, wz);
        } else if (biome === BIOME.DESERT && roll < 0.008) {
          this.placeCactus(blocks, lx, height + 1, lz, wx, wz);
        }
      }
    }
  }

  placeTree(blocks, lx, ly, lz, wx, wz) {
    const trunk = 4 + Math.floor(hash3(wx, 1, wz) * 3);
    const topY = ly + trunk;
    if (topY + 2 >= WORLD_HEIGHT) return;

    for (let y = topY - 2; y <= topY + 1; y++) {
      const radius = y >= topY ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && hash3(wx + dx, y, wz + dz) < 0.5) continue;
          this.setLocal(blocks, lx + dx, y, lz + dz, ID.leaves, false);
        }
      }
    }
    for (let y = ly; y < topY; y++) this.setLocal(blocks, lx, y, lz, ID.log, true);
  }

  placeCactus(blocks, lx, ly, lz, wx, wz) {
    const h = 2 + Math.floor(hash3(wx, 2, wz) * 3);
    for (let y = ly; y < ly + h && y < WORLD_HEIGHT; y++) {
      this.setLocal(blocks, lx, y, lz, ID.cactus, true);
    }
  }

  /** Writes a block only if it lands inside this chunk's own column range. */
  setLocal(blocks, lx, y, lz, id, overwrite) {
    if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = blockIndex(lx, y, lz);
    const existing = blocks[i];
    if (!overwrite && existing !== AIR && existing !== ID.water) return;
    if (overwrite && existing !== AIR && existing !== ID.water && existing !== ID.leaves) return;
    blocks[i] = id;
  }
}
