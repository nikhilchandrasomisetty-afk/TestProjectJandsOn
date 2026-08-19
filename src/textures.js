import * as THREE from "three";
import { mulberry32 } from "./noise.js";

// Every block texture is painted procedurally into a single atlas canvas at
// load time, so the game ships with no image assets at all.

export const TILE_PX = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

// Tile slots in the atlas, in row-major order.
export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_TOP: 5,
  WOOD_SIDE: 6,
  LEAVES: 7,
  WATER: 8,
  BEDROCK: 9,
  SNOW: 10,
  SNOW_SIDE: 11,
  COAL: 12,
  IRON: 13,
  GOLD: 14,
  DIAMOND: 15,
  PLANKS: 16,
  GLASS: 17,
  BRICK: 18,
  COBBLE: 19,
  CACTUS_TOP: 20,
  CACTUS_SIDE: 21,
  GRAVEL: 22,
  GLOWSTONE: 23,
};

function shade(hex, amount) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (hex & 255) + amount));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Fills a tile with a base color plus per-pixel value jitter, which is what
// gives these textures their characteristic grainy look.
function noiseFill(ctx, ox, oy, base, spread, rand) {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const jitter = Math.floor((rand() - 0.5) * spread);
      ctx.fillStyle = shade(base, jitter);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function speckle(ctx, ox, oy, color, count, rand, size = 1) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * (TILE_PX - size + 1));
    const y = Math.floor(rand() * (TILE_PX - size + 1));
    ctx.fillRect(ox + x, oy + y, size, size);
  }
}

// Draws an ore blob cluster over an existing stone tile.
function oreBlobs(ctx, ox, oy, color, dark, rand, blobs = 5) {
  for (let i = 0; i < blobs; i++) {
    const cx = 2 + Math.floor(rand() * (TILE_PX - 5));
    const cy = 2 + Math.floor(rand() * (TILE_PX - 5));
    const w = 2 + Math.floor(rand() * 2);
    const h = 2 + Math.floor(rand() * 2);
    ctx.fillStyle = dark;
    ctx.fillRect(ox + cx - 1, oy + cy - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(ox + cx, oy + cy, w, h);
  }
}

function brickPattern(ctx, ox, oy, base, mortar, rand) {
  noiseFill(ctx, ox, oy, base, 26, rand);
  ctx.fillStyle = mortar;
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    ctx.fillRect(ox, oy + y, TILE_PX, 1);
    const offset = row % 2 === 0 ? 0 : 8;
    ctx.fillRect(ox + ((offset + 7) % TILE_PX), oy + y, 1, 4);
    ctx.fillRect(ox + ((offset + 15) % TILE_PX), oy + y, 1, 4);
  }
}

function woodGrain(ctx, ox, oy, base, rand) {
  noiseFill(ctx, ox, oy, base, 18, rand);
  for (let x = 0; x < TILE_PX; x++) {
    if (rand() < 0.28) {
      ctx.fillStyle = shade(base, -22);
      ctx.fillRect(ox + x, oy, 1, TILE_PX);
    }
  }
}

function ringsPattern(ctx, ox, oy, base, rand) {
  noiseFill(ctx, ox, oy, base, 16, rand);
  const cx = TILE_PX / 2;
  const cy = TILE_PX / 2;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      if (Math.floor(d) % 3 === 0) {
        ctx.fillStyle = shade(base, -20);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

const PAINTERS = {
  [TILE.GRASS_TOP]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x5da130, 40, rand);
    speckle(ctx, ox, oy, shade(0x5da130, 26), 24, rand);
    speckle(ctx, ox, oy, shade(0x5da130, -26), 18, rand);
  },
  [TILE.GRASS_SIDE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a5a34, 30, rand);
    // Grass overhang along the top edge, with a ragged lower boundary.
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) {
        ctx.fillStyle = shade(0x5da130, Math.floor((rand() - 0.5) * 34));
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  [TILE.DIRT]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a5a34, 34, rand);
    speckle(ctx, ox, oy, shade(0x8a5a34, -30), 20, rand);
  },
  [TILE.STONE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a8a8a, 26, rand);
    speckle(ctx, ox, oy, shade(0x8a8a8a, -28), 14, rand, 2);
  },
  [TILE.COBBLE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x7e7e7e, 40, rand);
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(rand() * (TILE_PX - 4));
      const y = Math.floor(rand() * (TILE_PX - 4));
      ctx.fillStyle = shade(0x7e7e7e, 20);
      ctx.fillRect(ox + x, oy + y, 3, 3);
      ctx.fillStyle = shade(0x7e7e7e, -34);
      ctx.fillRect(ox + x, oy + y + 3, 3, 1);
    }
  },
  [TILE.SAND]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0xdccd7a, 22, rand);
    speckle(ctx, ox, oy, shade(0xdccd7a, -20), 16, rand);
  },
  [TILE.GRAVEL]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8f8880, 44, rand);
    speckle(ctx, ox, oy, shade(0x8f8880, -36), 22, rand, 2);
  },
  [TILE.WOOD_SIDE]: (ctx, ox, oy, rand) => woodGrain(ctx, ox, oy, 0x6b4423, rand),
  [TILE.WOOD_TOP]: (ctx, ox, oy, rand) => ringsPattern(ctx, ox, oy, 0x9c7042, rand),
  [TILE.PLANKS]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0xa9793f, 20, rand);
    ctx.fillStyle = shade(0xa9793f, -34);
    for (let y = 0; y < TILE_PX; y += 4) ctx.fillRect(ox, oy + y, TILE_PX, 1);
  },
  [TILE.LEAVES]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x3f7d33, 46, rand);
    speckle(ctx, ox, oy, shade(0x3f7d33, -40), 30, rand);
    speckle(ctx, ox, oy, shade(0x3f7d33, 30), 18, rand);
  },
  [TILE.WATER]: (ctx, ox, oy, rand) => {
    // Painted with alpha so the transparent pass shows the seabed through it.
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const j = Math.floor((rand() - 0.5) * 22);
        ctx.fillStyle = `rgba(${58 + j},${111 + j},${216 + j},0.72)`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    ctx.fillStyle = "rgba(150,200,255,0.30)";
    for (let y = 0; y < TILE_PX; y += 4) ctx.fillRect(ox, oy + y, TILE_PX, 1);
  },
  [TILE.BEDROCK]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x3a3a3a, 52, rand);
    speckle(ctx, ox, oy, "#101010", 26, rand, 2);
  },
  [TILE.SNOW]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0xf2f6ff, 14, rand);
  },
  [TILE.SNOW_SIDE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a5a34, 30, rand);
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 4 + Math.floor(rand() * 2);
      for (let y = 0; y < depth; y++) {
        ctx.fillStyle = shade(0xf2f6ff, Math.floor((rand() - 0.5) * 12));
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  [TILE.COAL]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a8a8a, 26, rand);
    oreBlobs(ctx, ox, oy, "#1e1e1e", "#3a3a3a", rand);
  },
  [TILE.IRON]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a8a8a, 26, rand);
    oreBlobs(ctx, ox, oy, "#d8a27a", "#a87450", rand);
  },
  [TILE.GOLD]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a8a8a, 26, rand);
    oreBlobs(ctx, ox, oy, "#f5d14a", "#b89412", rand);
  },
  [TILE.DIAMOND]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x8a8a8a, 26, rand);
    oreBlobs(ctx, ox, oy, "#5ff0e0", "#2aa8a0", rand);
  },
  [TILE.GLASS]: (ctx, ox, oy, rand) => {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = "rgba(210,238,255,0.22)";
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = "rgba(235,250,255,0.85)";
    ctx.fillRect(ox, oy, TILE_PX, 1);
    ctx.fillRect(ox, oy + TILE_PX - 1, TILE_PX, 1);
    ctx.fillRect(ox, oy, 1, TILE_PX);
    ctx.fillRect(ox + TILE_PX - 1, oy, 1, TILE_PX);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(ox + 3, oy + 3, 3, 1);
    ctx.fillRect(ox + 3, oy + 3, 1, 3);
  },
  [TILE.BRICK]: (ctx, ox, oy, rand) => brickPattern(ctx, ox, oy, 0xa2503c, "#c9bfb4", rand),
  [TILE.CACTUS_TOP]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x2f7d3a, 22, rand);
    ctx.fillStyle = shade(0x2f7d3a, -30);
    ctx.fillRect(ox + 3, oy + 3, TILE_PX - 6, TILE_PX - 6);
  },
  [TILE.CACTUS_SIDE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0x2f7d3a, 22, rand);
    ctx.fillStyle = shade(0x2f7d3a, -34);
    ctx.fillRect(ox + 1, oy, 1, TILE_PX);
    ctx.fillRect(ox + TILE_PX - 2, oy, 1, TILE_PX);
    speckle(ctx, ox, oy, "#dff5c8", 8, rand);
  },
  [TILE.GLOWSTONE]: (ctx, ox, oy, rand) => {
    noiseFill(ctx, ox, oy, 0xd9b25a, 34, rand);
    speckle(ctx, ox, oy, "#fff3c4", 22, rand, 2);
  },
};

export function buildAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (const [tileIndex, paint] of Object.entries(PAINTERS)) {
    const index = Number(tileIndex);
    const ox = (index % ATLAS_COLS) * TILE_PX;
    const oy = Math.floor(index / ATLAS_COLS) * TILE_PX;
    // Each tile gets its own deterministic RNG so textures are stable
    // across reloads regardless of paint order.
    paint(ctx, ox, oy, mulberry32(0xc0ffee + index * 7919));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  // Mipmaps would average neighbouring atlas tiles together at distance and
  // paint a visible grid of seams across every flat surface, so this atlas is
  // sampled at full resolution only. The nearest filter also keeps the
  // deliberately pixelated look intact.
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 1;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return { texture, canvas };
}

// Inset by a quarter texel on each axis so floating-point error at a quad's
// edge can never sample the neighbouring tile. The two axes have different
// texel sizes because the atlas is not square.
const INSET_U = 0.25 / (ATLAS_COLS * TILE_PX);
const INSET_V = 0.25 / (ATLAS_ROWS * TILE_PX);

export function tileUV(index) {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + INSET_U;
  const u1 = (col + 1) / ATLAS_COLS - INSET_U;
  // Canvas rows run top-down while UV runs bottom-up.
  const v1 = 1 - row / ATLAS_ROWS - INSET_V;
  const v0 = 1 - (row + 1) / ATLAS_ROWS + INSET_V;
  return { u0, v0, u1, v1 };
}

// Renders a single tile to a small data URL, used for inventory icons.
export function tileToDataURL(index, size = 32) {
  const { canvas } = buildAtlasOnce();
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  ctx.drawImage(canvas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, size, size);
  return out.toDataURL();
}

let cachedAtlas = null;
export function buildAtlasOnce() {
  if (!cachedAtlas) cachedAtlas = buildAtlas();
  return cachedAtlas;
}
