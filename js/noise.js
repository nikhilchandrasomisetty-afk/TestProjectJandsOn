'use strict';

/**
 * Seeded Perlin noise (2D + 3D) with fBm helpers.
 * Deterministic for a given seed, so terrain regenerates identically
 * and only player edits need to be persisted.
 */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function grad3(hash, x, y, z) {
  switch (hash & 15) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x + z;
    case 5: return -x + z;
    case 6: return x - z;
    case 7: return -x - z;
    case 8: return y + z;
    case 9: return -y + z;
    case 10: return y - z;
    case 11: return -y - z;
    case 12: return x + y;
    case 13: return -y + z;
    case 14: return -x + y;
    default: return -y - z;
  }
}

export class Noise {
  constructor(seed = 0) {
    const rand = mulberry32(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  perlin3(x, y, z) {
    const perm = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const A = perm[X] + Y;
    const AA = perm[A & 255] + Z;
    const AB = perm[(A + 1) & 255] + Z;
    const B = perm[(X + 1) & 255] + Y;
    const BA = perm[B & 255] + Z;
    const BB = perm[(B + 1) & 255] + Z;

    return lerp(
      lerp(
        lerp(grad3(perm[AA & 255], x, y, z), grad3(perm[BA & 255], x - 1, y, z), u),
        lerp(grad3(perm[AB & 255], x, y - 1, z), grad3(perm[BB & 255], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad3(perm[(AA + 1) & 255], x, y, z - 1), grad3(perm[(BA + 1) & 255], x - 1, y, z - 1), u),
        lerp(grad3(perm[(AB + 1) & 255], x, y - 1, z - 1), grad3(perm[(BB + 1) & 255], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  perlin2(x, y) {
    return this.perlin3(x, y, 0.137);
  }

  /** Fractal Brownian motion in 2D. Returns roughly -1..1. */
  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.perlin2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Fractal Brownian motion in 3D. Returns roughly -1..1. */
  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.perlin3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Stable hash of three integers -> float in [0,1). Used for scattered features. */
export function hash3(x, y, z) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
