'use strict';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 30;

export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;

/** Index into a chunk's flat block array. x/z are 0..15, y is 0..WORLD_HEIGHT-1. */
export function blockIndex(x, y, z) {
  return y * CHUNK_AREA + z * CHUNK_SIZE + x;
}

export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export const SETTINGS = {
  renderDistance: 6,
  reach: 6,
  // Milliseconds per frame the loader may spend generating/meshing chunks.
  chunkBudgetMs: 8,
};
