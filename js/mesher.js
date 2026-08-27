import * as THREE from 'three';
import { BlockIds, isOpaque } from './blocks.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from './world.js';

// Greedy voxel meshing. For each of the 6 face directions we sweep slice by slice,
// build a mask of visible faces, then merge equal neighbouring entries into the
// largest possible rectangles. Merged quads tile the atlas via fract() in the shader,
// so one quad can cover many blocks and vertex counts stay low.

const FACE_LIGHT = { py: 1.0, ny: 0.55, px: 0.82, nx: 0.82, pz: 0.72, nz: 0.72 };
const DIR_NAMES = [['px', 'nx'], ['py', 'ny'], ['pz', 'nz']];

function quantize(v) { return Math.round(v * 8) / 8; }

export function buildChunkGeometry(world, chunk, getUV) {
  const ox = chunk.cx * CHUNK_X;
  const oz = chunk.cz * CHUNK_Z;
  const dims = [CHUNK_X, CHUNK_Y, CHUNK_Z];

  const positions = [];
  const normals = [];
  const uvs = [];
  const tileOffsets = [];
  const lights = [];

  const wPositions = [];
  const wNormals = [];
  const wUvs = [];
  const wTileOffsets = [];
  const wLights = [];

  const blockAt = (x, y, z) => {
    if (x >= 0 && x < CHUNK_X && z >= 0 && z < CHUNK_Z) {
      if (y < 0 || y >= CHUNK_Y) return BlockIds.AIR;
      return chunk.get(x, y, z);
    }
    return world.getBlock(ox + x, y, oz + z);
  };

  const skyLight = (x, y, z) => {
    const top = world.getSkyHeight(ox + x, oz + z);
    const depth = top - y;
    if (depth <= 0) return 1;
    return Math.max(0.10, 1 - depth / 14);
  };

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;
    const maskW = dims[u], maskH = dims[v];
    const mask = new Array(maskW * maskH);

    for (x[d] = -1; x[d] < dims[d];) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++, n++) {
          const a = blockAt(x[0], x[1], x[2]);
          const b = blockAt(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          mask[n] = faceBetween(a, b, d, x, q, skyLight);
        }
      }

      x[d]++;
      n = 0;
      for (let j = 0; j < maskH; j++) {
        for (let i = 0; i < maskW;) {
          const m = mask[n];
          if (!m) { i++; n++; continue; }
          // Grow width
          let w = 1;
          while (i + w < maskW && sameFace(mask[n + w], m)) w++;
          // Grow height
          let h = 1;
          outer:
          for (; j + h < maskH; h++) {
            for (let k = 0; k < w; k++) {
              if (!sameFace(mask[n + k + h * maskW], m)) break outer;
            }
          }

          emitQuad(m, d, u, v, x, i, j, w, h, ox, oz, getUV,
            m.water ? { positions: wPositions, normals: wNormals, uvs: wUvs, tileOffsets: wTileOffsets, lights: wLights }
                    : { positions, normals, uvs, tileOffsets, lights });

          for (let l = 0; l < h; l++) {
            for (let k = 0; k < w; k++) mask[n + k + l * maskW] = null;
          }
          i += w; n += w;
        }
      }
    }
  }

  return {
    opaque: toGeometry(positions, normals, uvs, tileOffsets, lights),
    water: toGeometry(wPositions, wNormals, wUvs, wTileOffsets, wLights),
  };

  function faceBetween(a, b, d, x, q, lightFn) {
    const aWater = a === BlockIds.WATER;
    const bWater = b === BlockIds.WATER;
    const aSolidish = a !== BlockIds.AIR;
    const bSolidish = b !== BlockIds.AIR;

    // Water surfaces: render only against air (or against nothing above)
    if (aWater && !bSolidish) {
      return makeFace(a, d, +1, x, q, lightFn, true);
    }
    if (bWater && !aSolidish) {
      return makeFace(b, d, -1, x, q, lightFn, true);
    }
    if (aWater || bWater) {
      // Solid vs water -> the solid block still needs a face so you can see the lake floor
      if (aWater && bSolidish && !isOpaque(a)) {
        if (isOpaque(b)) return makeFace(b, d, -1, x, q, lightFn, false);
        return null;
      }
      if (bWater && aSolidish) {
        if (isOpaque(a)) return makeFace(a, d, +1, x, q, lightFn, false);
        return null;
      }
      return null;
    }

    const aVisible = a !== BlockIds.AIR;
    const bVisible = b !== BlockIds.AIR;
    if (aVisible === bVisible && a === b) return null;
    if (aVisible && !isOpaque(b) && a !== b) return makeFace(a, d, +1, x, q, lightFn, false);
    if (bVisible && !isOpaque(a) && a !== b) return makeFace(b, d, -1, x, q, lightFn, false);
    return null;
  }

  function makeFace(id, d, sign, x, q, lightFn, water) {
    const faceName = sign > 0 ? DIR_NAMES[d][0] : DIR_NAMES[d][1];
    // Light sampled in the empty cell in front of the face
    const lx = sign > 0 ? x[0] + q[0] : x[0];
    const ly = sign > 0 ? x[1] + q[1] : x[1];
    const lz = sign > 0 ? x[2] + q[2] : x[2];
    const light = quantize(FACE_LIGHT[faceName] * lightFn(lx, ly, lz));
    return { id, sign, faceName, light, water };
  }

  function sameFace(m, ref) {
    return m && ref && m.id === ref.id && m.sign === ref.sign && m.light === ref.light && m.water === ref.water;
  }

  function emitQuad(m, d, u, v, x, i, j, w, h, ox, oz, getUV, out) {
    const du = [0, 0, 0]; du[u] = w;
    const dv = [0, 0, 0]; dv[v] = h;
    const base = [0, 0, 0];
    base[d] = x[d];
    base[u] = i;
    base[v] = j;

    // world-space corners
    const c = (arr) => [arr[0] + ox, arr[1], arr[2] + oz];
    const v0 = c([base[0], base[1], base[2]]);
    const v1 = c([base[0] + du[0], base[1] + du[1], base[2] + du[2]]);
    const v2 = c([base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]]);
    const v3 = c([base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]]);

    // water blocks sit slightly below a full cube so shorelines read nicely
    if (m.water && m.faceName === 'py') {
      v0[1] -= 0.12; v1[1] -= 0.12; v2[1] -= 0.12; v3[1] -= 0.12;
    }

    const nrm = [0, 0, 0];
    nrm[d] = m.sign;

    const uvRect = getUV(m.id, m.faceName);
    const tileU = uvRect[0], tileV = uvRect[1];

    // Repeat counts follow the merged quad size along its two axes
    const repU = w, repV = h;
    let quad;
    if (m.sign > 0) quad = [v0, v1, v2, v3];
    else quad = [v0, v3, v2, v1];

    const uvSet = m.sign > 0
      ? [[0, 0], [repU, 0], [repU, repV], [0, repV]]
      : [[0, 0], [0, repV], [repU, repV], [repU, 0]];

    const tri = [0, 1, 2, 0, 2, 3];
    for (const t of tri) {
      const p = quad[t];
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(nrm[0], nrm[1], nrm[2]);
      out.uvs.push(uvSet[t][0], uvSet[t][1]);
      out.tileOffsets.push(tileU, tileV);
      out.lights.push(m.light);
    }
  }
}

function toGeometry(positions, normals, uvs, tileOffsets, lights) {
  if (positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('tileOffset', new THREE.Float32BufferAttribute(tileOffsets, 2));
  g.setAttribute('light', new THREE.Float32BufferAttribute(lights, 1));
  g.computeBoundingSphere();
  return g;
}

export function createVoxelMaterial(texture, tileSize, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uTileSize: { value: new THREE.Vector2(tileSize[0], tileSize[1]) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunStrength: { value: 1.0 },
      uAmbient: { value: 0.25 },
      uFogColor: { value: new THREE.Color(0.6, 0.75, 0.95) },
      uFogNear: { value: 40 },
      uFogFar: { value: 140 },
      uTorchPos: { value: Array.from({ length: 12 }, () => new THREE.Vector3(0, -999, 0)) },
      uTorchCount: { value: 0 },
      uOpacity: { value: opts.opacity ?? 1.0 },
      uTime: { value: 0 },
      uWater: { value: opts.water ? 1 : 0 },
      uUnderwater: { value: 0 },
    },
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite !== false,
    side: opts.side ?? THREE.FrontSide,
    vertexShader: `
      attribute vec2 tileOffset;
      attribute float light;
      varying vec2 vUv;
      varying vec2 vTile;
      varying float vLight;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vTile = tileOffset;
        vLight = light;
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D map;
      uniform vec2 uTileSize;
      uniform vec3 uSunColor;
      uniform float uSunStrength;
      uniform float uAmbient;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uTorchPos[12];
      uniform int uTorchCount;
      uniform float uOpacity;
      uniform float uUnderwater;
      uniform float uTime;
      uniform float uWater;
      varying vec2 vUv;
      varying vec2 vTile;
      varying float vLight;
      varying vec3 vWorld;

      void main() {
        vec2 tileUv = vTile + fract(vUv) * uTileSize;
        vec4 texel = texture2D(map, tileUv);

        float sun = vLight * uSunStrength;
        vec3 lightSum = uSunColor * sun + vec3(uAmbient);

        for (int i = 0; i < 12; i++) {
          if (i >= uTorchCount) break;
          float dist = distance(vWorld, uTorchPos[i]);
          float atten = clamp(1.0 - dist / 11.0, 0.0, 1.0);
          lightSum += vec3(1.0, 0.72, 0.36) * atten * atten * 1.35;
        }

        vec3 color = texel.rgb * clamp(lightSum, 0.0, 1.9);

        // Rolling highlight bands read as moving water without displacing geometry
        if (uWater > 0.5) {
          float ripple = sin(vWorld.x * 0.8 + uTime * 1.5) * cos(vWorld.z * 0.7 - uTime * 1.1);
          color += vec3(0.05, 0.09, 0.11) * (ripple * 0.5 + 0.5);
        }
        float depth = length(vWorld - cameraPosition);
        float fogAmt = smoothstep(uFogNear, uFogFar, depth);
        vec3 fogC = mix(uFogColor, vec3(0.05, 0.2, 0.35), uUnderwater);
        color = mix(color, fogC, uUnderwater > 0.5 ? min(0.92, fogAmt + 0.25) : fogAmt);
        gl_FragColor = vec4(color, texel.a * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
}
