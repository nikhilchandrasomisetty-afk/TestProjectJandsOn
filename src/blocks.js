import * as THREE from "three";

// Block type registry. id 0 is always "air" / empty.
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
};

export const BLOCK_INFO = {
  [BLOCKS.GRASS]: { name: "Grass", color: 0x5da130, transparent: false },
  [BLOCKS.DIRT]: { name: "Dirt", color: 0x8a5a34, transparent: false },
  [BLOCKS.STONE]: { name: "Stone", color: 0x8a8a8a, transparent: false },
  [BLOCKS.SAND]: { name: "Sand", color: 0xdccd7a, transparent: false },
  [BLOCKS.WOOD]: { name: "Wood", color: 0x6b4423, transparent: false },
  [BLOCKS.LEAVES]: { name: "Leaves", color: 0x3f7d33, transparent: true },
  [BLOCKS.WATER]: { name: "Water", color: 0x3a6fd8, transparent: true },
  [BLOCKS.BEDROCK]: { name: "Bedrock", color: 0x2b2b2b, transparent: false },
  [BLOCKS.SNOW]: { name: "Snow", color: 0xf2f6ff, transparent: false },
};

// The set of blocks the player can place, in hotbar order.
export const HOTBAR = [
  BLOCKS.GRASS,
  BLOCKS.DIRT,
  BLOCKS.STONE,
  BLOCKS.SAND,
  BLOCKS.WOOD,
  BLOCKS.LEAVES,
];

export function makeBoxGeometry() {
  return new THREE.BoxGeometry(1, 1, 1);
}

export function makeMaterial(id) {
  const info = BLOCK_INFO[id];
  return new THREE.MeshLambertMaterial({
    color: info.color,
    transparent: info.transparent,
    opacity: info.transparent ? 0.75 : 1,
  });
}
