// Original implementation of classic Perlin-style gradient noise (public-domain algorithm
// reimplemented from scratch) plus a small value-noise helper for biome/cave fields.
// No third-party noise library or copyrighted asset is used here.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export class Noise2D {
  constructor(seed) {
    const rand = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + t * (b - a); }

  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  raw(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = Noise2D.fade(xf), v = Noise2D.fade(yf);
    const perm = this.perm;
    const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]];
    const ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
    const x1 = Noise2D.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = Noise2D.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
    return Noise2D.lerp(x1, x2, v) * 0.5;
  }

  // Fractal Brownian Motion: multiple octaves for natural-looking terrain.
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.raw(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

export class Noise3D {
  constructor(seed) {
    const rand = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + t * (b - a); }

  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  raw(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
    const u = Noise3D.fade(xf), v = Noise3D.fade(yf), w = Noise3D.fade(zf);
    const perm = this.perm;
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const lerp = Noise3D.lerp;
    return lerp(
      lerp(
        lerp(this.grad(perm[AA], xf, yf, zf), this.grad(perm[BA], xf - 1, yf, zf), u),
        lerp(this.grad(perm[AB], xf, yf - 1, zf), this.grad(perm[BB], xf - 1, yf - 1, zf), u), v),
      lerp(
        lerp(this.grad(perm[AA + 1], xf, yf, zf - 1), this.grad(perm[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(this.grad(perm[AB + 1], xf, yf - 1, zf - 1), this.grad(perm[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
      w);
  }

  fbm(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.raw(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

export function hashInt(x, y, z, seed) {
  let h = seed | 0;
  h = Math.imul(h ^ x, 374761393);
  h = Math.imul(h ^ y, 668265263);
  h = Math.imul(h ^ z, 2147483647);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
