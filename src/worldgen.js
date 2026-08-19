import { Noise, mulberry32 } from "./noise.js";
import { BLOCKS } from "./blocks.js";
import { CHUNK_SIZE, WORLD_HEIGHT, idx } from "./chunk.js";

export const SEA_LEVEL = 26;

export const BIOME = {
  OCEAN: 0,
  BEACH: 1,
  PLAINS: 2,
  FOREST: 3,
  DESERT: 4,
  MOUNTAINS: 5,
  TUNDRA: 6,
};

export const BIOME_NAMES = {
  [BIOME.OCEAN]: "Ocean",
  [BIOME.BEACH]: "Beach",
  [BIOME.PLAINS]: "Plains",
  [BIOME.FOREST]: "Forest",
  [BIOME.DESERT]: "Desert",
  [BIOME.MOUNTAINS]: "Mountains",
  [BIOME.TUNDRA]: "Tundra",
};

export class WorldGen {
  constructor(seed = 1337) {
    this.seed = seed;
    this.elevation = new Noise(seed);
    this.roughness = new Noise(seed + 101);
    this.temperature = new Noise(seed + 202);
    this.humidity = new Noise(seed + 303);
    this.caves = new Noise(seed + 404);
    this.ores = new Noise(seed + 505);
    this.trees = new Noise(seed + 606);
  }

  // Biome fields run at a higher frequency than the terrain so a single view
  // distance usually spans more than one biome instead of one endless plain.
  temperatureAt(x, z) {
    return this.temperature.fbm2(x * 0.0075, z * 0.0075, 3);
  }

  humidityAt(x, z) {
    return this.humidity.fbm2(x * 0.0085, z * 0.0085, 3);
  }

  // Surface height in blocks. Combines a broad continental shape with a
  // roughness field so mountains are jagged while plains stay smooth.
  heightAt(x, z) {
    const continent = this.elevation.fbm2(x * 0.0042, z * 0.0042, 5);
    const rough = this.roughness.fbm2(x * 0.02, z * 0.02, 4);

    // Push the continent field away from the middle so coastlines are
    // decisive rather than a wide band of near-sea-level mush.
    const shaped = Math.pow(Math.abs(continent - 0.5) * 2, 1.25) * Math.sign(continent - 0.5);
    const base = SEA_LEVEL + shaped * 26;

    const mountainMask = Math.max(0, continent - 0.62) / 0.38;
    const detail = (rough - 0.5) * (5 + mountainMask * 40);

    return Math.max(1, Math.min(WORLD_HEIGHT - 6, Math.round(base + detail)));
  }

  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    return this.biomeFor(x, z, h);
  }

  biomeFor(x, z, height) {
    if (height < SEA_LEVEL - 1) return BIOME.OCEAN;
    if (height <= SEA_LEVEL + 1) return BIOME.BEACH;

    const temp = this.temperatureAt(x, z);
    const humid = this.humidityAt(x, z);

    if (height > SEA_LEVEL + 26) return temp < 0.4 ? BIOME.TUNDRA : BIOME.MOUNTAINS;
    if (temp < 0.32) return BIOME.TUNDRA;
    if (temp > 0.62 && humid < 0.42) return BIOME.DESERT;
    if (humid > 0.55) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  surfaceBlock(biome, height) {
    switch (biome) {
      case BIOME.OCEAN: return BLOCKS.GRAVEL;
      case BIOME.BEACH: return BLOCKS.SAND;
      case BIOME.DESERT: return BLOCKS.SAND;
      case BIOME.TUNDRA: return BLOCKS.SNOW;
      case BIOME.MOUNTAINS: return height > SEA_LEVEL + 34 ? BLOCKS.SNOW : BLOCKS.STONE;
      default: return BLOCKS.GRASS;
    }
  }

  subsurfaceBlock(biome) {
    switch (biome) {
      case BIOME.OCEAN: return BLOCKS.GRAVEL;
      case BIOME.BEACH:
      case BIOME.DESERT: return BLOCKS.SAND;
      case BIOME.MOUNTAINS: return BLOCKS.STONE;
      default: return BLOCKS.DIRT;
    }
  }

  // Carves tunnels. Ridged noise gives long connected passages rather than
  // the isolated bubbles plain fBm produces.
  isCave(x, y, z) {
    if (y <= 2 || y > SEA_LEVEL + 18) return false;
    const n = this.caves.ridged3(x * 0.035, y * 0.055, z * 0.035, 3);
    const depthBias = Math.min(1, (SEA_LEVEL + 18 - y) / 30) * 0.06;
    return n > 0.82 - depthBias;
  }

  oreAt(x, y, z) {
    const n = this.ores.noise3(x * 0.14, y * 0.14, z * 0.14);
    if (n < 0.86) return null;
    // Rarer, more valuable ores sit deeper.
    if (y < 12 && n > 0.965) return BLOCKS.DIAMOND_ORE;
    if (y < 22 && n > 0.945) return BLOCKS.GOLD_ORE;
    if (y < 34 && n > 0.915) return BLOCKS.IRON_ORE;
    return BLOCKS.COAL_ORE;
  }

  // Trees are placed by the chunk that owns their trunk, but their canopies
  // may spill into neighbors — the caller handles cross-chunk writes.
  treeAt(x, z, biome) {
    if (biome !== BIOME.FOREST && biome !== BIOME.PLAINS && biome !== BIOME.DESERT) return null;
    const n = this.trees.noise2(x * 1.7, z * 1.7);
    const threshold = biome === BIOME.FOREST ? 0.955 : biome === BIOME.DESERT ? 0.986 : 0.98;
    if (n < threshold) return null;
    return biome === BIOME.DESERT ? "cactus" : "tree";
  }

  generateChunk(cx, cz, blocks) {
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    const decorations = [];

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = baseZ + lz;
        const height = this.heightAt(wx, wz);
        const biome = this.biomeFor(wx, wz, height);
        const surface = this.surfaceBlock(biome, height);
        const sub = this.subsurfaceBlock(biome);

        for (let y = 0; y <= height; y++) {
          let block;
          if (y === 0) {
            block = BLOCKS.BEDROCK;
          } else if (y <= 2 && this.ores.noise3(wx * 0.5, y * 0.5, wz * 0.5) > 0.5) {
            block = BLOCKS.BEDROCK;
          } else if (y === height) {
            block = surface;
          } else if (y >= height - 3) {
            block = sub;
          } else {
            block = this.oreAt(wx, y, wz) ?? BLOCKS.STONE;
          }

          // Caves cut through everything except the bedrock floor, and are
          // sealed under the sea so oceans do not drain into them.
          if (block !== BLOCKS.BEDROCK && y < height && this.isCave(wx, y, wz)) {
            if (!(height < SEA_LEVEL && y > height - 3)) {
              blocks[idx(lx, y, lz)] = BLOCKS.AIR;
              continue;
            }
          }

          blocks[idx(lx, y, lz)] = block;
        }

        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          blocks[idx(lx, y, lz)] = BLOCKS.WATER;
        }

        if (height > SEA_LEVEL + 1) {
          const kind = this.treeAt(wx, wz, biome);
          if (kind) decorations.push({ kind, x: wx, y: height + 1, z: wz });
        }
      }
    }

    return decorations;
  }

  // Returns the list of (worldX, worldY, worldZ, block) writes a decoration
  // needs. Keeping this pure lets the world apply spillover into neighbors.
  decorationBlocks(dec) {
    const rand = mulberry32((dec.x * 73856093) ^ (dec.z * 19349663) ^ this.seed);
    const out = [];

    if (dec.kind === "cactus") {
      const height = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < height; i++) {
        out.push([dec.x, dec.y + i, dec.z, BLOCKS.CACTUS]);
      }
      return out;
    }

    const trunk = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < trunk; i++) {
      out.push([dec.x, dec.y + i, dec.z, BLOCKS.WOOD]);
    }

    const topY = dec.y + trunk;
    for (let dy = -2; dy <= 1; dy++) {
      const radius = dy >= 0 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          // Trim the corners so canopies read as round, not cubic.
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && rand() < 0.6) continue;
          out.push([dec.x + dx, topY + dy, dec.z + dz, BLOCKS.LEAVES]);
        }
      }
    }
    return out;
  }
}
