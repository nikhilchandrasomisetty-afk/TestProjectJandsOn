import { TILE } from "./textures.js";

// Block ids are stored in a Uint8Array per chunk, so ids must stay under 256.
export const BLOCKS = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  BEDROCK: 8,
  SNOW: 9,
  COAL_ORE: 10,
  IRON_ORE: 11,
  GOLD_ORE: 12,
  DIAMOND_ORE: 13,
  PLANKS: 14,
  GLASS: 15,
  BRICK: 16,
  COBBLESTONE: 17,
  CACTUS: 18,
  GRAVEL: 19,
  GLOWSTONE: 20,
};

// tiles: [px, nx, py, ny, pz, nz] — the six faces in +X, -X, +Y, -Y, +Z, -Z order.
function uniform(tile) {
  return [tile, tile, tile, tile, tile, tile];
}

function columned(side, top, bottom = top) {
  return [side, side, top, bottom, side, side];
}

export const BLOCK_DEFS = {
  [BLOCKS.AIR]: {
    name: "Air",
    solid: false,
    opaque: false,
    tiles: null,
  },
  [BLOCKS.GRASS]: {
    name: "Grass",
    tiles: columned(TILE.GRASS_SIDE, TILE.GRASS_TOP, TILE.DIRT),
    hardness: 0.6,
    drop: BLOCKS.DIRT,
    sound: "soft",
  },
  [BLOCKS.DIRT]: {
    name: "Dirt",
    tiles: uniform(TILE.DIRT),
    hardness: 0.5,
    sound: "soft",
  },
  [BLOCKS.STONE]: {
    name: "Stone",
    tiles: uniform(TILE.STONE),
    hardness: 1.5,
    drop: BLOCKS.COBBLESTONE,
    sound: "hard",
  },
  [BLOCKS.COBBLESTONE]: {
    name: "Cobblestone",
    tiles: uniform(TILE.COBBLE),
    hardness: 2.0,
    sound: "hard",
  },
  [BLOCKS.SAND]: {
    name: "Sand",
    tiles: uniform(TILE.SAND),
    hardness: 0.5,
    gravity: true,
    sound: "soft",
  },
  [BLOCKS.GRAVEL]: {
    name: "Gravel",
    tiles: uniform(TILE.GRAVEL),
    hardness: 0.6,
    gravity: true,
    sound: "soft",
  },
  [BLOCKS.WOOD]: {
    name: "Wood",
    tiles: columned(TILE.WOOD_SIDE, TILE.WOOD_TOP),
    hardness: 2.0,
    sound: "wood",
  },
  [BLOCKS.PLANKS]: {
    name: "Planks",
    tiles: uniform(TILE.PLANKS),
    hardness: 2.0,
    sound: "wood",
  },
  [BLOCKS.LEAVES]: {
    name: "Leaves",
    tiles: uniform(TILE.LEAVES),
    hardness: 0.2,
    opaque: false,
    sound: "soft",
  },
  [BLOCKS.WATER]: {
    name: "Water",
    tiles: uniform(TILE.WATER),
    solid: false,
    opaque: false,
    liquid: true,
    unbreakable: true,
  },
  [BLOCKS.BEDROCK]: {
    name: "Bedrock",
    tiles: uniform(TILE.BEDROCK),
    unbreakable: true,
    sound: "hard",
  },
  [BLOCKS.SNOW]: {
    name: "Snow",
    tiles: columned(TILE.SNOW_SIDE, TILE.SNOW, TILE.DIRT),
    hardness: 0.4,
    sound: "soft",
  },
  [BLOCKS.COAL_ORE]: {
    name: "Coal Ore",
    tiles: uniform(TILE.COAL),
    hardness: 3.0,
    sound: "hard",
  },
  [BLOCKS.IRON_ORE]: {
    name: "Iron Ore",
    tiles: uniform(TILE.IRON),
    hardness: 3.5,
    sound: "hard",
  },
  [BLOCKS.GOLD_ORE]: {
    name: "Gold Ore",
    tiles: uniform(TILE.GOLD),
    hardness: 3.5,
    sound: "hard",
  },
  [BLOCKS.DIAMOND_ORE]: {
    name: "Diamond Ore",
    tiles: uniform(TILE.DIAMOND),
    hardness: 4.5,
    sound: "hard",
  },
  [BLOCKS.GLASS]: {
    name: "Glass",
    tiles: uniform(TILE.GLASS),
    hardness: 0.4,
    opaque: false,
    transparent: true,
    sound: "glass",
  },
  [BLOCKS.BRICK]: {
    name: "Brick",
    tiles: uniform(TILE.BRICK),
    hardness: 2.5,
    sound: "hard",
  },
  [BLOCKS.CACTUS]: {
    name: "Cactus",
    tiles: columned(TILE.CACTUS_SIDE, TILE.CACTUS_TOP),
    hardness: 0.5,
    sound: "soft",
  },
  [BLOCKS.GLOWSTONE]: {
    name: "Glowstone",
    tiles: uniform(TILE.GLOWSTONE),
    hardness: 0.6,
    light: 14,
    sound: "glass",
  },
};

// Fill in defaults once so the hot paths can read fields without guarding.
for (const def of Object.values(BLOCK_DEFS)) {
  if (def.solid === undefined) def.solid = true;
  if (def.opaque === undefined) def.opaque = true;
  if (def.transparent === undefined) def.transparent = false;
  if (def.liquid === undefined) def.liquid = false;
  if (def.gravity === undefined) def.gravity = false;
  if (def.unbreakable === undefined) def.unbreakable = false;
  if (def.hardness === undefined) def.hardness = 1;
  if (def.light === undefined) def.light = 0;
  if (def.sound === undefined) def.sound = "hard";
}

const DEFS_BY_ID = [];
for (const [id, def] of Object.entries(BLOCK_DEFS)) DEFS_BY_ID[Number(id)] = def;

export function defOf(id) {
  return DEFS_BY_ID[id] ?? BLOCK_DEFS[BLOCKS.AIR];
}

export function isOpaque(id) {
  return id !== BLOCKS.AIR && DEFS_BY_ID[id].opaque;
}

export function isSolid(id) {
  return id !== BLOCKS.AIR && DEFS_BY_ID[id].solid;
}

export function isLiquid(id) {
  return id !== BLOCKS.AIR && DEFS_BY_ID[id].liquid;
}

export function blockName(id) {
  return defOf(id).name;
}

// Ordered list of everything the player can hold, used by the inventory UI.
export const PLACEABLE = [
  BLOCKS.GRASS,
  BLOCKS.DIRT,
  BLOCKS.STONE,
  BLOCKS.COBBLESTONE,
  BLOCKS.SAND,
  BLOCKS.GRAVEL,
  BLOCKS.WOOD,
  BLOCKS.PLANKS,
  BLOCKS.LEAVES,
  BLOCKS.GLASS,
  BLOCKS.BRICK,
  BLOCKS.CACTUS,
  BLOCKS.SNOW,
  BLOCKS.COAL_ORE,
  BLOCKS.IRON_ORE,
  BLOCKS.GOLD_ORE,
  BLOCKS.DIAMOND_ORE,
  BLOCKS.GLOWSTONE,
];

// Recipes are order-independent: a map of ingredient id -> count required.
export const RECIPES = [
  { out: BLOCKS.PLANKS, count: 4, in: { [BLOCKS.WOOD]: 1 } },
  { out: BLOCKS.COBBLESTONE, count: 1, in: { [BLOCKS.STONE]: 1 } },
  { out: BLOCKS.BRICK, count: 2, in: { [BLOCKS.COBBLESTONE]: 2, [BLOCKS.SAND]: 1 } },
  { out: BLOCKS.GLASS, count: 2, in: { [BLOCKS.SAND]: 2 } },
  { out: BLOCKS.GLOWSTONE, count: 1, in: { [BLOCKS.GOLD_ORE]: 1, [BLOCKS.SAND]: 2 } },
  { out: BLOCKS.GRAVEL, count: 2, in: { [BLOCKS.COBBLESTONE]: 1 } },
];
