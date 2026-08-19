// Deterministic 2D value noise (no external dependencies).
// Good enough for terrain height maps at voxel-game scale.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  constructor(seed = 1337, size = 256) {
    this.size = size;
    this.mask = size - 1;
    const rand = mulberry32(seed);
    this.perm = new Float32Array(size * size);
    for (let i = 0; i < this.perm.length; i++) this.perm[i] = rand();
  }

  _lattice(xi, yi) {
    const x = xi & this.mask;
    const y = yi & this.mask;
    return this.perm[y * this.size + x];
  }

  static _fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  static _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Smooth value noise in range [0, 1]
  sample(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const v00 = this._lattice(xi, yi);
    const v10 = this._lattice(xi + 1, yi);
    const v01 = this._lattice(xi, yi + 1);
    const v11 = this._lattice(xi + 1, yi + 1);

    const u = Noise2D._fade(xf);
    const v = Noise2D._fade(yf);

    const top = Noise2D._lerp(v00, v10, u);
    const bottom = Noise2D._lerp(v01, v11, u);
    return Noise2D._lerp(top, bottom, v);
  }

  // Fractal Brownian Motion: layered noise for more natural terrain.
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / max;
  }
}
