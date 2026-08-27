import { BlockIds, Blocks } from './blocks.js';

// Items are either placeable blocks (id < 1000) or tools/materials (id >= 1000).
// All recipes and tool names below are original to this project.

export const ItemIds = {
  STICK: 1000,
  COAL: 1001,
  IRON_INGOT: 1002,
  GOLD_INGOT: 1003,
  CRYSTAL_SHARD: 1004,
  WOOD_PICKAXE: 1010,
  WOOD_AXE: 1011,
  WOOD_SHOVEL: 1012,
  WOOD_SWORD: 1013,
  STONE_PICKAXE: 1020,
  STONE_AXE: 1021,
  STONE_SHOVEL: 1022,
  STONE_SWORD: 1023,
  IRON_PICKAXE: 1030,
  IRON_AXE: 1031,
  IRON_SHOVEL: 1032,
  IRON_SWORD: 1033,
  CRYSTAL_PICKAXE: 1040,
  BREAD_ROOT: 1050,
  RAW_MEAT: 1051,
  COOKED_MEAT: 1052,
};

export const Items = {
  [ItemIds.STICK]: { id: ItemIds.STICK, name: 'Stick', icon: 'stick', stack: 64 },
  [ItemIds.COAL]: { id: ItemIds.COAL, name: 'Coal', icon: 'lump', color: '#232323', stack: 64, fuel: 8 },
  [ItemIds.IRON_INGOT]: { id: ItemIds.IRON_INGOT, name: 'Iron Ingot', icon: 'ingot', color: '#d9d9de', stack: 64 },
  [ItemIds.GOLD_INGOT]: { id: ItemIds.GOLD_INGOT, name: 'Gold Ingot', icon: 'ingot', color: '#f2cf4a', stack: 64 },
  [ItemIds.CRYSTAL_SHARD]: { id: ItemIds.CRYSTAL_SHARD, name: 'Crystal Shard', icon: 'shard', color: '#c98cff', stack: 64 },

  [ItemIds.WOOD_PICKAXE]: { id: ItemIds.WOOD_PICKAXE, name: 'Timber Pickaxe', icon: 'pickaxe', color: '#b08a52', stack: 1, tool: 'pickaxe', tier: 1, speed: 2.2, damage: 2, durability: 60 },
  [ItemIds.WOOD_AXE]: { id: ItemIds.WOOD_AXE, name: 'Timber Axe', icon: 'axe', color: '#b08a52', stack: 1, tool: 'axe', tier: 1, speed: 2.2, damage: 3, durability: 60 },
  [ItemIds.WOOD_SHOVEL]: { id: ItemIds.WOOD_SHOVEL, name: 'Timber Spade', icon: 'shovel', color: '#b08a52', stack: 1, tool: 'shovel', tier: 1, speed: 2.2, damage: 2, durability: 60 },
  [ItemIds.WOOD_SWORD]: { id: ItemIds.WOOD_SWORD, name: 'Timber Blade', icon: 'sword', color: '#b08a52', stack: 1, tool: 'sword', tier: 1, speed: 1, damage: 4, durability: 60 },

  [ItemIds.STONE_PICKAXE]: { id: ItemIds.STONE_PICKAXE, name: 'Stone Pickaxe', icon: 'pickaxe', color: '#9a9a9f', stack: 1, tool: 'pickaxe', tier: 2, speed: 4, damage: 3, durability: 140 },
  [ItemIds.STONE_AXE]: { id: ItemIds.STONE_AXE, name: 'Stone Axe', icon: 'axe', color: '#9a9a9f', stack: 1, tool: 'axe', tier: 2, speed: 4, damage: 4, durability: 140 },
  [ItemIds.STONE_SHOVEL]: { id: ItemIds.STONE_SHOVEL, name: 'Stone Spade', icon: 'shovel', color: '#9a9a9f', stack: 1, tool: 'shovel', tier: 2, speed: 4, damage: 3, durability: 140 },
  [ItemIds.STONE_SWORD]: { id: ItemIds.STONE_SWORD, name: 'Stone Blade', icon: 'sword', color: '#9a9a9f', stack: 1, tool: 'sword', tier: 2, speed: 1, damage: 6, durability: 140 },

  [ItemIds.IRON_PICKAXE]: { id: ItemIds.IRON_PICKAXE, name: 'Iron Pickaxe', icon: 'pickaxe', color: '#d9d9de', stack: 1, tool: 'pickaxe', tier: 3, speed: 7, damage: 4, durability: 320 },
  [ItemIds.IRON_AXE]: { id: ItemIds.IRON_AXE, name: 'Iron Axe', icon: 'axe', color: '#d9d9de', stack: 1, tool: 'axe', tier: 3, speed: 7, damage: 5, durability: 320 },
  [ItemIds.IRON_SHOVEL]: { id: ItemIds.IRON_SHOVEL, name: 'Iron Spade', icon: 'shovel', color: '#d9d9de', stack: 1, tool: 'shovel', tier: 3, speed: 7, damage: 4, durability: 320 },
  [ItemIds.IRON_SWORD]: { id: ItemIds.IRON_SWORD, name: 'Iron Blade', icon: 'sword', color: '#d9d9de', stack: 1, tool: 'sword', tier: 3, speed: 1, damage: 8, durability: 320 },

  [ItemIds.CRYSTAL_PICKAXE]: { id: ItemIds.CRYSTAL_PICKAXE, name: 'Crystal Pickaxe', icon: 'pickaxe', color: '#c98cff', stack: 1, tool: 'pickaxe', tier: 4, speed: 11, damage: 6, durability: 780 },

  [ItemIds.BREAD_ROOT]: { id: ItemIds.BREAD_ROOT, name: 'Bread Root', icon: 'food', color: '#d9a05b', stack: 16, food: 4 },
  [ItemIds.RAW_MEAT]: { id: ItemIds.RAW_MEAT, name: 'Raw Cut', icon: 'food', color: '#d1685f', stack: 16, food: 2 },
  [ItemIds.COOKED_MEAT]: { id: ItemIds.COOKED_MEAT, name: 'Cooked Cut', icon: 'food', color: '#a3622f', stack: 16, food: 7 },
};

export function getItem(id) {
  if (id >= 1000) return Items[id];
  const b = Blocks[id];
  if (!b) return null;
  return { id, name: b.name, stack: 64, block: true };
}

export function itemName(id) {
  const it = getItem(id);
  return it ? it.name : 'Unknown';
}

export function isBlockItem(id) { return id < 1000; }

// ---------- Crafting ----------
// Shaped recipes use a 3x3 grid pattern with a key map. Shapeless recipes just need
// the listed ingredients in any arrangement. Recipes marked `bench` need a Workbench
// nearby (a 3x3 grid); the 2x2 inventory grid handles the rest.

const B = BlockIds, I = ItemIds;

export const Recipes = [
  { id: 'planks', out: { id: B.PLANKS, count: 4 }, shapeless: [{ id: B.WOOD_LOG, count: 1 }], bench: false,
    desc: 'Split a log into four planks.' },
  { id: 'sticks', out: { id: I.STICK, count: 4 }, shapeless: [{ id: B.PLANKS, count: 2 }], bench: false,
    desc: 'Two planks make four sticks.' },
  { id: 'workbench', out: { id: B.WORKBENCH, count: 1 }, shapeless: [{ id: B.PLANKS, count: 4 }], bench: false,
    desc: 'Unlocks the full 3x3 crafting grid.' },
  { id: 'torch', out: { id: B.TORCH, count: 4 }, shapeless: [{ id: I.COAL, count: 1 }, { id: I.STICK, count: 1 }], bench: false,
    desc: 'Light for caves and night-time.' },
  { id: 'furnace', out: { id: B.FURNACE, count: 1 }, shapeless: [{ id: B.COBBLESTONE, count: 8 }], bench: true,
    desc: 'Smelts ore into ingots.' },
  { id: 'glass', out: { id: B.GLASS, count: 1 }, smelt: { id: B.SAND, count: 1 }, bench: false,
    desc: 'Smelt sand in a furnace.' },

  { id: 'wood_pick', out: { id: I.WOOD_PICKAXE, count: 1 }, shapeless: [{ id: B.PLANKS, count: 3 }, { id: I.STICK, count: 2 }], bench: false, desc: 'Mines stone and ore.' },
  { id: 'wood_axe', out: { id: I.WOOD_AXE, count: 1 }, shapeless: [{ id: B.PLANKS, count: 3 }, { id: I.STICK, count: 2 }], bench: false, desc: 'Chops wood faster.', variant: 'axe' },
  { id: 'wood_shovel', out: { id: I.WOOD_SHOVEL, count: 1 }, shapeless: [{ id: B.PLANKS, count: 1 }, { id: I.STICK, count: 2 }], bench: false, desc: 'Digs dirt and sand faster.' },
  { id: 'wood_sword', out: { id: I.WOOD_SWORD, count: 1 }, shapeless: [{ id: B.PLANKS, count: 2 }, { id: I.STICK, count: 1 }], bench: false, desc: 'Basic melee weapon.' },

  { id: 'stone_pick', out: { id: I.STONE_PICKAXE, count: 1 }, shapeless: [{ id: B.COBBLESTONE, count: 3 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Needed for iron ore.' },
  { id: 'stone_axe', out: { id: I.STONE_AXE, count: 1 }, shapeless: [{ id: B.COBBLESTONE, count: 3 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Sturdier axe.', variant: 'axe' },
  { id: 'stone_shovel', out: { id: I.STONE_SHOVEL, count: 1 }, shapeless: [{ id: B.COBBLESTONE, count: 1 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Sturdier spade.' },
  { id: 'stone_sword', out: { id: I.STONE_SWORD, count: 1 }, shapeless: [{ id: B.COBBLESTONE, count: 2 }, { id: I.STICK, count: 1 }], bench: true, desc: 'Sturdier blade.' },

  { id: 'iron_ingot', out: { id: I.IRON_INGOT, count: 1 }, smelt: { id: B.IRON_ORE, count: 1 }, bench: false, desc: 'Smelt iron ore in a furnace.' },
  { id: 'gold_ingot', out: { id: I.GOLD_INGOT, count: 1 }, smelt: { id: B.GOLD_ORE, count: 1 }, bench: false, desc: 'Smelt gold ore in a furnace.' },
  { id: 'crystal_shard', out: { id: I.CRYSTAL_SHARD, count: 2 }, smelt: { id: B.CRYSTAL_ORE, count: 1 }, bench: false, desc: 'Refine crystal ore.' },
  { id: 'cook_meat', out: { id: I.COOKED_MEAT, count: 1 }, smelt: { id: I.RAW_MEAT, count: 1 }, bench: false, desc: 'Cook raw meat for more food.' },

  { id: 'iron_pick', out: { id: I.IRON_PICKAXE, count: 1 }, shapeless: [{ id: I.IRON_INGOT, count: 3 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Fast mining, needed for crystal ore.' },
  { id: 'iron_axe', out: { id: I.IRON_AXE, count: 1 }, shapeless: [{ id: I.IRON_INGOT, count: 3 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Fast chopping.', variant: 'axe' },
  { id: 'iron_shovel', out: { id: I.IRON_SHOVEL, count: 1 }, shapeless: [{ id: I.IRON_INGOT, count: 1 }, { id: I.STICK, count: 2 }], bench: true, desc: 'Fast digging.' },
  { id: 'iron_sword', out: { id: I.IRON_SWORD, count: 1 }, shapeless: [{ id: I.IRON_INGOT, count: 2 }, { id: I.STICK, count: 1 }], bench: true, desc: 'Strong blade.' },
  { id: 'crystal_pick', out: { id: I.CRYSTAL_PICKAXE, count: 1 }, shapeless: [{ id: I.CRYSTAL_SHARD, count: 3 }, { id: I.STICK, count: 2 }], bench: true, desc: 'The finest pickaxe in the world.' },
];

// A couple of recipes produce different tools from identical ingredients; the
// `variant` flag keeps them distinguishable in the recipe list UI.
export function recipesFor(hasBench) {
  return Recipes.filter((r) => !r.bench || hasBench);
}

// ---------- Procedural item icons ----------
export function drawItemIcon(item, size = 48) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const s = size / 16;
  const color = item.color || '#cccccc';
  const dark = shadeHex(color, -45);
  const wood = '#8a6533';
  g.imageSmoothingEnabled = false;

  const px = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x * s, y * s, w * s, h * s); };

  switch (item.icon) {
    case 'stick':
      px(7, 3, 2, 10, wood); px(7, 3, 1, 10, shadeHex(wood, 25));
      break;
    case 'lump':
      px(5, 6, 6, 5, color); px(6, 5, 4, 1, color); px(5, 11, 5, 1, dark); px(6, 6, 2, 2, shadeHex(color, 45));
      break;
    case 'ingot':
      px(3, 7, 10, 4, color); px(4, 6, 8, 1, shadeHex(color, 35)); px(3, 11, 10, 1, dark);
      break;
    case 'shard':
      g.fillStyle = color;
      g.beginPath(); g.moveTo(8 * s, 2 * s); g.lineTo(12 * s, 9 * s); g.lineTo(8 * s, 14 * s); g.lineTo(4 * s, 9 * s); g.closePath(); g.fill();
      g.fillStyle = shadeHex(color, 55);
      g.beginPath(); g.moveTo(8 * s, 2 * s); g.lineTo(10 * s, 9 * s); g.lineTo(8 * s, 14 * s); g.closePath(); g.fill();
      break;
    case 'pickaxe':
      px(7, 6, 2, 8, wood);
      px(3, 3, 10, 2, color); px(3, 5, 2, 1, dark); px(11, 5, 2, 1, dark);
      break;
    case 'axe':
      px(7, 6, 2, 8, wood);
      px(4, 3, 5, 5, color); px(4, 3, 5, 1, shadeHex(color, 35)); px(4, 7, 5, 1, dark);
      break;
    case 'shovel':
      px(7, 6, 2, 8, wood);
      px(5, 2, 6, 5, color); px(5, 6, 6, 1, dark);
      break;
    case 'sword':
      px(7, 8, 2, 6, wood);
      px(5, 9, 6, 1, shadeHex(wood, -30));
      px(7, 2, 2, 7, color); px(7, 2, 1, 7, shadeHex(color, 40));
      break;
    case 'food':
      px(4, 5, 8, 7, color); px(5, 4, 6, 1, shadeHex(color, 25)); px(4, 12, 8, 1, dark);
      break;
    default:
      px(4, 4, 8, 8, color);
  }
  return c.toDataURL();
}

function shadeHex(hex, amt) {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}
