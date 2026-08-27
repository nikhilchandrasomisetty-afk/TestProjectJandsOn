import { Noise2D, Noise3D, hashInt } from './noise.js';
import { BlockIds } from './blocks.js';

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 80;
export const SEA_LEVEL = 32;

export function idx(x, y, z) {
  return x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z;
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    this.mesh = null;
    this.waterMesh = null;
    this.dirty = true;
    this.entities = []; // mobs spawned for this chunk (for pooling/cleanup)
  }
  get(x, y, z) {
    if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return BlockIds.AIR;
    return this.blocks[idx(x, y, z)];
  }
  set(x, y, z, id) {
    this.blocks[idx(x, y, z)] = id;
  }
}

const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, MOUNTAIN: 3 };

export class WorldGenerator {
  constructor(seed) {
    this.seed = seed;
    this.height = new Noise2D(seed + '-height');
    this.mountain = new Noise2D(seed + '-mountain');
    this.temperature = new Noise2D(seed + '-temp');
    this.humidity = new Noise2D(seed + '-humid');
    this.river = new Noise2D(seed + '-river');
    this.caves = new Noise3D(seed + '-caves');
    this.ore = new Noise3D(seed + '-ore');
    this.seedInt = hashSeedToInt(seed);
  }

  columnInfo(wx, wz) {
    // Tuned so roughly 7% of the surface sits below sea level (lakes and coasts)
    // while mountain ridges reach the snow line around y=52.
    const base = this.height.fbm(wx * 0.012, wz * 0.012, 4) * 30;
    const mtn = Math.max(0, this.mountain.fbm(wx * 0.005, wz * 0.005, 3));
    const elevation = 38 + base + mtn * mtn * 110;
    const temp = this.temperature.fbm(wx * 0.004, wz * 0.004, 2);
    const humid = this.humidity.fbm(wx * 0.004 + 500, wz * 0.004 + 500, 2);
    const riverN = this.river.fbm(wx * 0.01 + 1000, wz * 0.01 + 1000, 2);
    let biome = BIOME.PLAINS;
    if (mtn > 0.30) biome = BIOME.MOUNTAIN;
    else if (temp > 0.15 && humid < -0.05) biome = BIOME.DESERT;
    else if (humid > 0.05) biome = BIOME.FOREST;

    let surface = Math.floor(elevation);
    let isRiver = false;
    if (Math.abs(riverN) < 0.035 && biome !== BIOME.MOUNTAIN) {
      surface = SEA_LEVEL - 1;
      isRiver = true;
    }
    return { surface, biome, isRiver };
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const ox = cx * CHUNK_X, oz = cz * CHUNK_Z;
    const infoCache = new Map();
    const info = (x, z) => {
      const key = x * 100000 + z;
      let v = infoCache.get(key);
      if (!v) { v = this.columnInfo(x, z); infoCache.set(key, v); }
      return v;
    };

    for (let x = 0; x < CHUNK_X; x++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        const wx = ox + x, wz = oz + z;
        const { surface, biome, isRiver } = info(wx, wz);
        const topBlock = biome === BIOME.DESERT ? BlockIds.SAND
          : biome === BIOME.MOUNTAIN && surface > 52 ? BlockIds.SNOW
          : surface <= SEA_LEVEL + 1 ? BlockIds.SAND   // beaches and lake shores
          : BlockIds.GRASS;
        for (let y = 0; y < CHUNK_Y; y++) {
          if (y > surface && y > SEA_LEVEL) { chunk.set(x, y, z, BlockIds.AIR); continue; }
          if (y > surface) { chunk.set(x, y, z, BlockIds.WATER); continue; }

          let id;
          if (y === surface) id = topBlock;
          else if (y > surface - 4) id = biome === BIOME.DESERT ? BlockIds.SAND : BlockIds.DIRT;
          else id = BlockIds.STONE;

          // Carve caves (never breach very close to surface, never below y=2 to keep a floor)
          if (id === BlockIds.STONE && y > 2 && y < surface - 3) {
            const cn = this.caves.fbm(wx * 0.09, y * 0.09, wz * 0.09, 3);
            if (Math.abs(cn) < 0.045) id = BlockIds.AIR;
          }

          // Ore veins replace stone. Thresholds are picked from the measured noise
          // distribution: coal is common near the surface, rarer ores sit deeper.
          if (id === BlockIds.STONE) {
            const on = this.ore.fbm(wx * 0.12, y * 0.12, wz * 0.12, 2);
            if (on > 0.42 && y < 12) id = BlockIds.CRYSTAL_ORE;
            else if (on > 0.38 && y < 20) id = BlockIds.GOLD_ORE;
            else if (on > 0.32 && y < 30) id = BlockIds.IRON_ORE;
            else if (on > 0.26) id = BlockIds.COAL_ORE;
          }

          chunk.set(x, y, z, id);
        }
        if (isRiver) {
          chunk.set(x, SEA_LEVEL - 1, z, BlockIds.SAND);
        }
      }
    }

    // Trees: scan a margin so canopies can spill across chunk borders.
    const MARGIN = 3;
    for (let x = -MARGIN; x < CHUNK_X + MARGIN; x++) {
      for (let z = -MARGIN; z < CHUNK_Z + MARGIN; z++) {
        const wx = ox + x, wz = oz + z;
        const { surface, biome, isRiver } = info(wx, wz);
        if (isRiver || surface <= SEA_LEVEL) continue;
        if (biome === BIOME.DESERT || biome === BIOME.MOUNTAIN) continue;
        const density = biome === BIOME.FOREST ? 0.045 : 0.008;
        const r = hashInt(wx, 0, wz, this.seedInt);
        if (r < density) {
          this.stampTree(chunk, x, surface + 1, z, hashInt(wx, 1, wz, this.seedInt));
        }
      }
    }

    chunk.dirty = true;
    return chunk;
  }

  stampTree(chunk, x, baseY, z, rand) {
    const trunkH = 4 + Math.floor(rand * 3);
    for (let i = 0; i < trunkH; i++) {
      this.trySet(chunk, x, baseY + i, z, BlockIds.WOOD_LOG);
    }
    const topY = baseY + trunkH;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy >= 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && r === 2) continue;
          this.trySet(chunk, x + dx, topY + dy, z + dz, BlockIds.LEAVES, true);
        }
      }
    }
  }

  trySet(chunk, x, y, z, id, onlyAir = false) {
    if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return;
    if (onlyAir && chunk.get(x, y, z) !== BlockIds.AIR) return;
    chunk.set(x, y, z, id);
  }
}

function hashSeedToInt(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
