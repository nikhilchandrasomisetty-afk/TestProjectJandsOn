import * as THREE from 'three';
import { Blocks, BlockIds } from './blocks.js';

// Builds a procedurally-painted texture atlas (canvas 2D) — every swatch is generated
// with simple original noise/pattern code at runtime, no external image assets at all.

const TILE = 16; // px per tile, kept small & blocky on purpose for the low-fi voxel look
const COLS = 8;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, amt) {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

function paintTile(ctx, tx, ty, baseColor, opts = {}) {
  const px = tx * TILE, py = ty * TILE;
  const rand = mulberry32((tx * 131 + ty * 977 + 17) >>> 0);
  ctx.fillStyle = baseColor;
  ctx.fillRect(px, py, TILE, TILE);
  // Speckled grain for stone-like / dirt-like blocks
  const grains = opts.grains ?? 26;
  for (let i = 0; i < grains; i++) {
    const x = px + Math.floor(rand() * TILE);
    const y = py + Math.floor(rand() * TILE);
    const amt = (rand() - 0.5) * (opts.contrast ?? 30);
    ctx.fillStyle = shade(baseColor, amt);
    ctx.fillRect(x, y, 1, 1);
  }
  if (opts.speck) {
    const count = opts.speckCount ?? 5;
    for (let i = 0; i < count; i++) {
      const x = px + 1 + Math.floor(rand() * (TILE - 2));
      const y = py + 1 + Math.floor(rand() * (TILE - 2));
      ctx.fillStyle = opts.speck;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  if (opts.grid) {
    ctx.strokeStyle = shade(baseColor, -40);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  }
  if (opts.rings) {
    ctx.strokeStyle = shade(baseColor, -35);
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (opts.blades) {
    ctx.strokeStyle = shade(baseColor, -25);
    for (let i = 0; i < 8; i++) {
      const x = px + Math.floor(rand() * TILE);
      ctx.beginPath();
      ctx.moveTo(x, py + TILE);
      ctx.lineTo(x + (rand() - 0.5) * 3, py + TILE - 5 - rand() * 5);
      ctx.stroke();
    }
  }
  if (opts.flame) {
    ctx.fillStyle = shade(baseColor, 60);
    ctx.beginPath();
    ctx.moveTo(px + TILE / 2, py + 1);
    ctx.lineTo(px + TILE / 2 - 3, py + TILE - 2);
    ctx.lineTo(px + TILE / 2 + 3, py + TILE - 2);
    ctx.closePath();
    ctx.fill();
  }
}

// Layout: each block gets up to 3 tile "roles" (top/side/bottom) at fixed atlas slots.
const layout = {}; // id -> { top:[u,v], side:[u,v], bottom:[u,v] }
let nextSlot = 0;
function allot() { const s = nextSlot++; return [s % COLS, Math.floor(s / COLS)]; }

export function buildAtlas() {
  const ids = Object.keys(Blocks).map(Number).filter((id) => id !== BlockIds.AIR);
  const rows = Math.ceil((ids.length * 3) / COLS) + 1;
  const size = COLS * TILE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (const id of ids) {
    const b = Blocks[id];
    const c = b.colors || { all: '#ff00ff' };
    const topColor = c.top || c.all;
    const sideColor = c.side || c.all;
    const bottomColor = c.bottom || c.all;

    const topSlot = allot();
    paintTile(ctx, topSlot[0], topSlot[1], topColor, {
      grains: b.leafy ? 40 : 24,
      contrast: b.leafy ? 45 : 28,
      speck: c.speck, speckCount: 6,
      grid: id === BlockIds.WORKBENCH || id === BlockIds.FURNACE || id === BlockIds.PLANKS,
      rings: id === BlockIds.WOOD_LOG,
      blades: id === BlockIds.GRASS,
    });

    let sideSlot = topSlot;
    if (c.side && c.side !== c.top) {
      sideSlot = allot();
      paintTile(ctx, sideSlot[0], sideSlot[1], sideColor, {
        grains: 24, contrast: 26, speck: c.speck, speckCount: 6,
        flame: id === BlockIds.FURNACE,
        grid: id === BlockIds.WOOD_LOG || id === BlockIds.WORKBENCH,
      });
    }

    let bottomSlot = topSlot;
    if (c.bottom && c.bottom !== c.top) {
      bottomSlot = allot();
      paintTile(ctx, bottomSlot[0], bottomSlot[1], bottomColor, { grains: 20, contrast: 24 });
    }

    layout[id] = { top: topSlot, side: sideSlot, bottom: bottomSlot };
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const atlasRows = canvas.height / TILE;
  const uvSize = 1 / COLS;
  const vSize = 1 / atlasRows;

  function slotUV([sx, sy]) {
    const u0 = sx * uvSize, v0 = 1 - (sy + 1) * vSize;
    return [u0, v0, u0 + uvSize, v0 + vSize];
  }

  // faceRole: 'py' top, 'ny' bottom, everything else = side
  function getUV(id, faceRole) {
    const slot = layout[id];
    if (!slot) return slotUV([0, 0]);
    if (faceRole === 'py') return slotUV(slot.top);
    if (faceRole === 'ny') return slotUV(slot.bottom);
    return slotUV(slot.side);
  }

  // Draws a small isometric-ish cube icon for a block, used by the inventory UI.
  function blockIcon(id, size = 48) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const slot = layout[id];
    if (!slot) return c.toDataURL();
    const drawFace = (s, dx, dy, dw, dh, bright) => {
      g.save();
      g.globalAlpha = 1;
      g.drawImage(canvas, s[0] * TILE, s[1] * TILE, TILE, TILE, dx, dy, dw, dh);
      g.fillStyle = bright > 0 ? `rgba(255,255,255,${bright})` : `rgba(0,0,0,${-bright})`;
      g.fillRect(dx, dy, dw, dh);
      g.restore();
    };
    const s = size;
    // Simple stacked-face pseudo-3D: top band, then front, then right shade.
    drawFace(slot.top, s * 0.12, s * 0.10, s * 0.76, s * 0.28, 0.10);
    drawFace(slot.side, s * 0.12, s * 0.38, s * 0.44, s * 0.52, -0.02);
    drawFace(slot.side, s * 0.56, s * 0.38, s * 0.32, s * 0.52, -0.22);
    return c.toDataURL();
  }

  return { texture, getUV, tileSize: [uvSize, vSize], canvas, tilePx: TILE, cols: COLS, rows: atlasRows, layout, blockIcon };
}
