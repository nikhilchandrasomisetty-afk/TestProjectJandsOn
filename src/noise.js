// Seeded, dependency-free noise used by every part of world generation.
// Provides 2D and 3D value noise plus fBm helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
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

const MASK = 255;

export class Noise {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
    const rand = mulberry32(this.seed);

    // A classic permutation table, doubled so lookups never need a modulo.
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & MASK];
      this.values[i] = rand();
    }
  }

  _hash2(xi, yi) {
    return this.values[(this.perm[(xi & MASK) + this.perm[yi & MASK]] + 0) & 511];
  }

  _hash3(xi, yi, zi) {
    const h = this.perm[(xi & MASK) + this.perm[(yi & MASK) + this.perm[zi & MASK]]];
    return this.values[(h + zi) & 511];
  }

  // Smooth 2D value noise in [0, 1].
  noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);

    const v00 = this._hash2(xi, yi);
    const v10 = this._hash2(xi + 1, yi);
    const v01 = this._hash2(xi, yi + 1);
    const v11 = this._hash2(xi + 1, yi + 1);

    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  }

  // Smooth 3D value noise in [0, 1]. Used for caves and ore pockets.
  noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const c000 = this._hash3(xi, yi, zi);
    const c100 = this._hash3(xi + 1, yi, zi);
    const c010 = this._hash3(xi, yi + 1, zi);
    const c110 = this._hash3(xi + 1, yi + 1, zi);
    const c001 = this._hash3(xi, yi, zi + 1);
    const c101 = this._hash3(xi + 1, yi, zi + 1);
    const c011 = this._hash3(xi, yi + 1, zi + 1);
    const c111 = this._hash3(xi + 1, yi + 1, zi + 1);

    const x00 = lerp(c000, c100, u);
    const x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u);
    const x11 = lerp(c011, c111, u);

    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  // Layered 2D noise. Higher octaves add finer detail at lower amplitude.
  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise3(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged noise produces sharp valleys — good for cave tunnels.
  ridged3(x, y, z, octaves = 3) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise3(x * freq, y * freq, z * freq) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
