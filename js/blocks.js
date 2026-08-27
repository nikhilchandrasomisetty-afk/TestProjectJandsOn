// Original block definitions for the voxel sandbox. All names, ids, and stats are
// original to this project — nothing here references or copies Minecraft data.

export const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export const BlockIds = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_LOG: 5,
  LEAVES: 6,
  WATER: 7,
  COAL_ORE: 8,
  IRON_ORE: 9,
  GOLD_ORE: 10,
  CRYSTAL_ORE: 11, // original ore type unique to this game
  PLANKS: 12,
  COBBLESTONE: 13,
  TORCH: 14,
  WORKBENCH: 15,
  FURNACE: 16,
  SNOW: 17,
  GLASS: 18,
};

// Each entry: id, name, hardness (seconds to break bare-handed baseline),
// solid (collision), transparent (render-wise / light passes), collectible,
// tool preference for faster mining, and a color recipe used to procedurally
// paint the texture atlas swatch for each face group.
export const Blocks = {
  [BlockIds.AIR]: { id: BlockIds.AIR, name: 'Air', solid: false, transparent: true, collectible: false, hardness: 0 },
  [BlockIds.GRASS]: {
    id: BlockIds.GRASS, name: 'Grass Block', solid: true, transparent: false, collectible: true,
    hardness: 0.6, tool: 'shovel', drop: BlockIds.DIRT,
    colors: { top: '#5fb64c', side: '#8a6a44', sideTop: '#5fb64c', bottom: '#6b4a2c' },
  },
  [BlockIds.DIRT]: {
    id: BlockIds.DIRT, name: 'Dirt', solid: true, transparent: false, collectible: true,
    hardness: 0.5, tool: 'shovel', colors: { all: '#7a5636' },
  },
  [BlockIds.STONE]: {
    id: BlockIds.STONE, name: 'Stone', solid: true, transparent: false, collectible: true,
    hardness: 1.5, tool: 'pickaxe', drop: BlockIds.COBBLESTONE, colors: { all: '#8b8f95' },
  },
  [BlockIds.SAND]: {
    id: BlockIds.SAND, name: 'Sand', solid: true, transparent: false, collectible: true,
    hardness: 0.5, tool: 'shovel', colors: { all: '#dfd08a' },
  },
  [BlockIds.WOOD_LOG]: {
    id: BlockIds.WOOD_LOG, name: 'Timber Log', solid: true, transparent: false, collectible: true,
    hardness: 1.0, tool: 'axe', colors: { top: '#9c7a4d', side: '#6e5230', sideTop: '#9c7a4d', bottom: '#9c7a4d' },
  },
  [BlockIds.LEAVES]: {
    id: BlockIds.LEAVES, name: 'Foliage', solid: true, transparent: true, collectible: true,
    hardness: 0.2, colors: { all: '#3f9e42' }, leafy: true,
  },
  [BlockIds.WATER]: {
    id: BlockIds.WATER, name: 'Water', solid: false, transparent: true, collectible: false,
    hardness: 0, colors: { all: '#2b6ea8' }, liquid: true,
  },
  [BlockIds.COAL_ORE]: {
    id: BlockIds.COAL_ORE, name: 'Coal Ore', solid: true, transparent: false, collectible: true,
    hardness: 1.5, tool: 'pickaxe', colors: { all: '#4a4c50', speck: '#161616' },
  },
  [BlockIds.IRON_ORE]: {
    id: BlockIds.IRON_ORE, name: 'Iron Ore', solid: true, transparent: false, collectible: true,
    hardness: 2.2, tool: 'pickaxe', tier: 1, colors: { all: '#8b8f95', speck: '#d8b892' },
  },
  [BlockIds.GOLD_ORE]: {
    id: BlockIds.GOLD_ORE, name: 'Gold Ore', solid: true, transparent: false, collectible: true,
    hardness: 2.5, tool: 'pickaxe', tier: 2, colors: { all: '#8b8f95', speck: '#f2cf4a' },
  },
  [BlockIds.CRYSTAL_ORE]: {
    id: BlockIds.CRYSTAL_ORE, name: 'Glowing Crystal Ore', solid: true, transparent: false, collectible: true,
    hardness: 3.0, tool: 'pickaxe', tier: 3, colors: { all: '#5c4a7a', speck: '#c98cff' }, glow: true,
  },
  [BlockIds.PLANKS]: {
    id: BlockIds.PLANKS, name: 'Timber Planks', solid: true, transparent: false, collectible: true,
    hardness: 0.8, tool: 'axe', colors: { all: '#b08a52' },
  },
  [BlockIds.COBBLESTONE]: {
    id: BlockIds.COBBLESTONE, name: 'Cobblestone', solid: true, transparent: false, collectible: true,
    hardness: 1.8, tool: 'pickaxe', colors: { all: '#79787c' },
  },
  [BlockIds.TORCH]: {
    id: BlockIds.TORCH, name: 'Torch', solid: false, transparent: true, collectible: true,
    hardness: 0.1, colors: { all: '#ffcf6b' }, light: 14,
  },
  [BlockIds.WORKBENCH]: {
    id: BlockIds.WORKBENCH, name: 'Workbench', solid: true, transparent: false, collectible: true,
    hardness: 1.0, tool: 'axe', colors: { top: '#c99a58', side: '#8a6533', sideTop: '#c99a58', bottom: '#6e5230' },
  },
  [BlockIds.FURNACE]: {
    id: BlockIds.FURNACE, name: 'Furnace', solid: true, transparent: false, collectible: true,
    hardness: 2.0, tool: 'pickaxe', colors: { all: '#6d6d6d', speck: '#ff8a3d' },
  },
  [BlockIds.SNOW]: {
    id: BlockIds.SNOW, name: 'Snow', solid: true, transparent: false, collectible: true,
    hardness: 0.3, tool: 'shovel', colors: { all: '#eef4fb' },
  },
  [BlockIds.GLASS]: {
    id: BlockIds.GLASS, name: 'Glass', solid: true, transparent: true, collectible: true,
    hardness: 0.5, colors: { all: '#bfe6f0' },
  },
};

export function getBlock(id) {
  return Blocks[id] || Blocks[BlockIds.AIR];
}

export function isSolid(id) {
  const b = Blocks[id];
  return !!b && b.solid;
}

export function isOpaque(id) {
  const b = Blocks[id];
  return !!b && !b.transparent;
}
