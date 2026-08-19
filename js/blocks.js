'use strict';

import * as THREE from 'three';

/**
 * Block registry + a procedurally generated texture atlas.
 * Every texture is painted onto a canvas at load time, so the game ships
 * with no image assets and works offline once three.js is cached.
 */

export const ATLAS_TILES = 16; // 16x16 grid of tiles
const TILE_PX = 16; // each tile is 16x16 pixels, Minecraft-style
const ATLAS_PX = ATLAS_TILES * TILE_PX;

const tileIndex = new Map();
let nextTile = 0;

const canvas = document.createElement('canvas');
canvas.width = ATLAS_PX;
canvas.height = ATLAS_PX;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Deterministic per-texture RNG so the atlas looks the same every run.
function rngFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    return ((h >>> 0) % 100000) / 100000;
  };
}

function shade(hex, amount) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (hex & 255) + amount));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Registers a tile and paints it via drawFn(px, py, rand). Returns the tile id. */
function tile(name, drawFn) {
  const id = nextTile++;
  const tx = (id % ATLAS_TILES) * TILE_PX;
  const ty = Math.floor(id / ATLAS_TILES) * TILE_PX;
  drawFn(tx, ty, rngFor(name));
  tileIndex.set(name, id);
  return id;
}

/** Fills a tile with a base colour plus per-pixel brightness noise. */
function grainy(x0, y0, base, variance, rand, alpha = 1) {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (rand() - 0.5) * 2 * variance;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = shade(base, d);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

/** Scatters small blobs of `color` across a tile — used for ores and detail. */
function specks(x0, y0, color, count, rand, size = 2) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * (TILE_PX - size));
    const y = Math.floor(rand() * (TILE_PX - size));
    ctx.fillRect(x0 + x, y0 + y, size, size);
    if (rand() > 0.5) ctx.fillRect(x0 + x + 1, y0 + y - 1, 1, 1);
  }
}

// ---------------------------------------------------------------- textures

tile('dirt', (x, y, r) => grainy(x, y, 0x8b6144, 22, r));
tile('grass_top', (x, y, r) => {
  grainy(x, y, 0x5a9c3a, 26, r);
  specks(x, y, shade(0x5a9c3a, 18), 12, r, 1);
});
tile('grass_side', (x, y, r) => {
  grainy(x, y, 0x8b6144, 22, r);
  // grass fringe hanging over the dirt
  for (let px = 0; px < TILE_PX; px++) {
    const depth = 3 + Math.floor(r() * 3);
    for (let py = 0; py < depth; py++) {
      ctx.fillStyle = shade(0x5a9c3a, (r() - 0.5) * 40);
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
});
tile('stone', (x, y, r) => grainy(x, y, 0x8a8a8a, 20, r));
tile('cobblestone', (x, y, r) => {
  grainy(x, y, 0x7d7d7d, 16, r);
  ctx.fillStyle = 'rgba(60,60,60,0.9)';
  for (let i = 0; i < 5; i++) {
    const w = 4 + Math.floor(r() * 5);
    const h = 3 + Math.floor(r() * 4);
    ctx.strokeStyle = 'rgba(55,55,55,0.9)';
    ctx.strokeRect(x + Math.floor(r() * 12) + 0.5, y + Math.floor(r() * 12) + 0.5, w, h);
  }
});
tile('sand', (x, y, r) => grainy(x, y, 0xe0d3a0, 14, r));
tile('sandstone', (x, y, r) => {
  grainy(x, y, 0xd8c88f, 10, r);
  ctx.fillStyle = 'rgba(160,140,90,0.5)';
  ctx.fillRect(x, y + 4, TILE_PX, 1);
  ctx.fillRect(x, y + 11, TILE_PX, 1);
});
tile('gravel', (x, y, r) => {
  grainy(x, y, 0x8d8681, 26, r);
  specks(x, y, shade(0x5c5651, 0), 10, r, 2);
});
tile('log_side', (x, y, r) => {
  grainy(x, y, 0x6b4f2a, 14, r);
  ctx.fillStyle = 'rgba(60,42,22,0.55)';
  for (let px = 1; px < TILE_PX; px += 4) ctx.fillRect(x + px, y, 1, TILE_PX);
});
tile('log_top', (x, y, r) => {
  grainy(x, y, 0xa5824a, 12, r);
  ctx.strokeStyle = 'rgba(90,66,36,0.8)';
  for (let ring = 2; ring < 8; ring += 2) {
    ctx.beginPath();
    ctx.arc(x + 8, y + 8, ring, 0, Math.PI * 2);
    ctx.stroke();
  }
});
tile('leaves', (x, y, r) => {
  ctx.clearRect(x, y, TILE_PX, TILE_PX);
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      if (r() < 0.14) continue; // gaps you can see through
      ctx.fillStyle = shade(0x3f7d2a, (r() - 0.5) * 55);
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
});
tile('planks', (x, y, r) => {
  grainy(x, y, 0xb08a4f, 12, r);
  ctx.fillStyle = 'rgba(90,66,36,0.7)';
  ctx.fillRect(x, y + 3, TILE_PX, 1);
  ctx.fillRect(x, y + 8, TILE_PX, 1);
  ctx.fillRect(x, y + 13, TILE_PX, 1);
});
tile('water', (x, y, r) => grainy(x, y, 0x2a5cc4, 12, r, 1));
tile('glass', (x, y) => {
  ctx.clearRect(x, y, TILE_PX, TILE_PX);
  ctx.strokeStyle = 'rgba(220,240,255,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PX - 1);
  ctx.fillStyle = 'rgba(200,230,255,0.16)';
  ctx.fillRect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x + 3, y + 3, 3, 1);
});
tile('bedrock', (x, y, r) => {
  grainy(x, y, 0x4a4a4a, 34, r);
  specks(x, y, '#1c1c1c', 8, r, 3);
});
tile('coal_ore', (x, y, r) => {
  grainy(x, y, 0x8a8a8a, 18, r);
  specks(x, y, '#1d1d1d', 6, r, 3);
});
tile('iron_ore', (x, y, r) => {
  grainy(x, y, 0x8a8a8a, 18, r);
  specks(x, y, '#c9a07a', 6, r, 3);
});
tile('gold_ore', (x, y, r) => {
  grainy(x, y, 0x8a8a8a, 18, r);
  specks(x, y, '#f0c33a', 6, r, 3);
});
tile('diamond_ore', (x, y, r) => {
  grainy(x, y, 0x8a8a8a, 18, r);
  specks(x, y, '#4ee6e0', 6, r, 3);
});
tile('snow_top', (x, y, r) => grainy(x, y, 0xf2f6fb, 8, r));
tile('snow_side', (x, y, r) => {
  grainy(x, y, 0x8b6144, 22, r);
  ctx.fillStyle = '#f2f6fb';
  ctx.fillRect(x, y, TILE_PX, 4);
});
tile('brick', (x, y, r) => {
  grainy(x, y, 0xa4533f, 10, r);
  ctx.fillStyle = '#c9c0b4';
  for (let row = 0; row < 4; row++) {
    ctx.fillRect(x, y + row * 4 + 3, TILE_PX, 1);
    const off = row % 2 === 0 ? 0 : 8;
    ctx.fillRect(x + off + 7, y + row * 4, 1, 4);
  }
});
tile('cactus_top', (x, y, r) => {
  grainy(x, y, 0x3f7a35, 12, r);
  ctx.strokeStyle = 'rgba(30,60,25,0.8)';
  ctx.strokeRect(x + 1.5, y + 1.5, TILE_PX - 3, TILE_PX - 3);
});
tile('cactus_side', (x, y, r) => {
  grainy(x, y, 0x357030, 12, r);
  ctx.fillStyle = 'rgba(25,55,20,0.85)';
  ctx.fillRect(x + 1, y, 1, TILE_PX);
  ctx.fillRect(x + TILE_PX - 2, y, 1, TILE_PX);
  ctx.fillStyle = 'rgba(200,235,190,0.5)';
  for (let py = 1; py < TILE_PX; py += 4) ctx.fillRect(x + 7, y + py, 1, 1);
});
tile('obsidian', (x, y, r) => {
  grainy(x, y, 0x1a1426, 12, r);
  specks(x, y, '#5a3f8a', 4, r, 1);
});
tile('glowstone', (x, y, r) => {
  grainy(x, y, 0xd8a94a, 22, r);
  specks(x, y, '#ffe9a8', 8, r, 2);
});
tile('wool_white', (x, y, r) => grainy(x, y, 0xeeeeee, 10, r));
tile('wool_red', (x, y, r) => grainy(x, y, 0xb02b2b, 14, r));
tile('wool_blue', (x, y, r) => grainy(x, y, 0x2b52b0, 14, r));
tile('wool_yellow', (x, y, r) => grainy(x, y, 0xd8c02b, 14, r));
tile('wool_green', (x, y, r) => grainy(x, y, 0x3b8b3b, 14, r));

export const atlasTexture = new THREE.CanvasTexture(canvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.generateMipmaps = false;

/** Data URL of one tile, used to draw hotbar/inventory icons in the DOM. */
export function tileDataURL(name) {
  const id = tileIndex.get(name);
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const cc = c.getContext('2d');
  cc.imageSmoothingEnabled = false;
  cc.drawImage(
    canvas,
    (id % ATLAS_TILES) * TILE_PX,
    Math.floor(id / ATLAS_TILES) * TILE_PX,
    TILE_PX,
    TILE_PX,
    0,
    0,
    TILE_PX,
    TILE_PX
  );
  return c.toDataURL();
}

// ----------------------------------------------------------------- blocks

export const AIR = 0;

/**
 * render: 'opaque' hides neighbouring faces, 'cutout' is alpha-tested
 * (leaves, glass), 'liquid' is the translucent water pass.
 */
function def(id, name, label, tiles, opts = {}) {
  const t = typeof tiles === 'string' ? { all: tiles } : tiles;
  const top = tileIndex.get(t.top ?? t.all);
  const bottom = tileIndex.get(t.bottom ?? t.all ?? t.top);
  const side = tileIndex.get(t.side ?? t.all);
  return {
    id,
    name,
    label,
    // face order matches FACES in mesher.js: -x, +x, -y, +y, -z, +z
    faceTiles: [side, side, bottom, top, side, side],
    iconTile: t.side ?? t.all ?? t.top,
    render: opts.render ?? 'opaque',
    solid: opts.solid ?? true,
    opaque: (opts.render ?? 'opaque') === 'opaque',
    liquid: opts.render === 'liquid',
    light: opts.light ?? 0,
  };
}

export const BLOCKS = [null];
function register(...args) {
  const block = def(BLOCKS.length, ...args);
  BLOCKS.push(block);
  return block;
}

register('grass', 'Grass', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' });
register('dirt', 'Dirt', 'dirt');
register('stone', 'Stone', 'stone');
register('cobblestone', 'Cobblestone', 'cobblestone');
register('sand', 'Sand', 'sand');
register('sandstone', 'Sandstone', 'sandstone');
register('gravel', 'Gravel', 'gravel');
register('log', 'Oak Log', { top: 'log_top', side: 'log_side' });
register('leaves', 'Leaves', 'leaves', { render: 'cutout' });
register('planks', 'Planks', 'planks');
register('glass', 'Glass', 'glass', { render: 'cutout' });
register('water', 'Water', 'water', { render: 'liquid', solid: false });
register('bedrock', 'Bedrock', 'bedrock');
register('coal_ore', 'Coal Ore', 'coal_ore');
register('iron_ore', 'Iron Ore', 'iron_ore');
register('gold_ore', 'Gold Ore', 'gold_ore');
register('diamond_ore', 'Diamond Ore', 'diamond_ore');
register('snow', 'Snow', { top: 'snow_top', side: 'snow_side', bottom: 'dirt' });
register('brick', 'Bricks', 'brick');
register('cactus', 'Cactus', { top: 'cactus_top', side: 'cactus_side' });
register('obsidian', 'Obsidian', 'obsidian');
register('glowstone', 'Glowstone', 'glowstone', { light: 14 });
register('wool_white', 'White Wool', 'wool_white');
register('wool_red', 'Red Wool', 'wool_red');
register('wool_blue', 'Blue Wool', 'wool_blue');
register('wool_yellow', 'Yellow Wool', 'wool_yellow');
register('wool_green', 'Green Wool', 'wool_green');

/** Block id lookup by name, e.g. ID.grass */
export const ID = {};
for (const b of BLOCKS) if (b) ID[b.name] = b.id;

export function block(id) {
  return BLOCKS[id];
}

export function isOpaque(id) {
  return id !== AIR && BLOCKS[id].opaque;
}

export function isSolid(id) {
  return id !== AIR && BLOCKS[id].solid;
}

export function isLiquid(id) {
  return id !== AIR && BLOCKS[id].liquid;
}

/** Tile rectangle in atlas UV space, inset slightly to avoid texture bleed. */
export function tileUV(tileId) {
  const inset = 0.02 / ATLAS_TILES;
  const tx = tileId % ATLAS_TILES;
  const ty = Math.floor(tileId / ATLAS_TILES);
  const u0 = tx / ATLAS_TILES + inset;
  const u1 = (tx + 1) / ATLAS_TILES - inset;
  // Canvas y grows downward, texture v grows upward.
  const v1 = 1 - ty / ATLAS_TILES - inset;
  const v0 = 1 - (ty + 1) / ATLAS_TILES + inset;
  return [u0, v0, u1, v1];
}
