'use strict';

import * as THREE from 'three';
import { AIR, BLOCKS, isOpaque, tileUV } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, blockIndex } from './config.js';

/**
 * Turns a chunk's block array into renderable geometry.
 *
 * Only faces touching a non-opaque neighbour are emitted, and each vertex gets
 * a baked ambient-occlusion value so corners and overhangs read as 3D without
 * any real-time lighting cost.
 */

// Face order must match `faceTiles` in blocks.js: -x, +x, -y, +y, -z, +z
const FACES = [
  {
    dir: [-1, 0, 0],
    shade: 0.72,
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  {
    dir: [1, 0, 0],
    shade: 0.72,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] },
      { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  {
    dir: [0, -1, 0],
    shade: 0.5,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] },
      { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  {
    dir: [0, 1, 0],
    shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
      { pos: [0, 1, 0], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 0] },
    ],
  },
  {
    dir: [0, 0, -1],
    shade: 0.62,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    dir: [0, 0, 1],
    shade: 0.86,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

const AO_LEVELS = [0.5, 0.68, 0.85, 1.0];

function shouldDrawFace(self, neighbor) {
  if (neighbor === AIR) return true;
  if (isOpaque(neighbor)) return false;
  // Transparent blocks don't draw interior faces against their own kind.
  return neighbor !== self;
}

function newBuffers() {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function toGeometry(buf) {
  if (buf.indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geometry.setIndex(buf.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {(x:number,y:number,z:number)=>number} sample world-space block getter
 * @returns {{opaque:THREE.BufferGeometry|null, cutout:..., water:...}}
 */
export function buildChunkGeometry(sample, cx, cz, blocks) {
  const passes = { opaque: newBuffers(), cutout: newBuffers(), water: newBuffers() };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  // Chunks are mostly empty sky above the terrain — find the ceiling once
  // instead of walking every one of the WORLD_HEIGHT layers.
  let topY = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i] !== AIR) {
      topY = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      break;
    }
  }

  for (let y = 0; y <= topY; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = blocks[blockIndex(x, y, z)];
        if (id === AIR) continue;

        const spec = BLOCKS[id];
        const buf =
          spec.render === 'liquid' ? passes.water : spec.render === 'cutout' ? passes.cutout : passes.opaque;
        const wx = baseX + x;
        const wz = baseZ + z;
        const applyAO = spec.render === 'opaque';

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = wx + face.dir[0];
          const ny = y + face.dir[1];
          const nz = wz + face.dir[2];

          if (ny < 0) continue; // world floor: never draw downward faces
          const neighbor = ny >= WORLD_HEIGHT ? AIR : sample(nx, ny, nz);
          if (!shouldDrawFace(id, neighbor)) continue;

          const [u0, v0, u1, v1] = tileUV(spec.faceTiles[f]);
          const start = buf.positions.length / 3;

          for (const corner of face.corners) {
            buf.positions.push(x + corner.pos[0], y + corner.pos[1], z + corner.pos[2]);
            buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            buf.uvs.push(corner.uv[0] ? u1 : u0, corner.uv[1] ? v1 : v0);

            let light = face.shade;
            if (applyAO) light *= vertexAO(sample, wx, y, wz, face, corner);
            buf.colors.push(light, light, light);
          }

          buf.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
        }
      }
    }
  }

  return {
    opaque: toGeometry(passes.opaque),
    cutout: toGeometry(passes.cutout),
    water: toGeometry(passes.water),
  };
}

/**
 * Classic three-sample ambient occlusion: a vertex darkens with each solid
 * block touching it in the plane of the face.
 */
function vertexAO(sample, wx, wy, wz, face, corner) {
  const normalAxis = face.dir[0] !== 0 ? 0 : face.dir[1] !== 0 ? 1 : 2;
  const axisA = (normalAxis + 1) % 3;
  const axisB = (normalAxis + 2) % 3;
  const signA = corner.pos[axisA] * 2 - 1;
  const signB = corner.pos[axisB] * 2 - 1;

  const base = [wx + face.dir[0], wy + face.dir[1], wz + face.dir[2]];
  const at = (da, db) => {
    const p = [base[0], base[1], base[2]];
    p[axisA] += da;
    p[axisB] += db;
    if (p[1] < 0 || p[1] >= WORLD_HEIGHT) return false;
    return isOpaque(sample(p[0], p[1], p[2]));
  };

  const side1 = at(signA, 0);
  const side2 = at(0, signB);
  if (side1 && side2) return AO_LEVELS[0];
  const cornerBlock = at(signA, signB);
  return AO_LEVELS[3 - (side1 ? 1 : 0) - (side2 ? 1 : 0) - (cornerBlock ? 1 : 0)];
}
