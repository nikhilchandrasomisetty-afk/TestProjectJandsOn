import * as THREE from "three";
import { BLOCKS, defOf, isOpaque } from "./blocks.js";
import { tileUV } from "./textures.js";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
const AREA = CHUNK_SIZE * CHUNK_SIZE;
const VOLUME = AREA * WORLD_HEIGHT;

export function idx(lx, y, lz) {
  return y * AREA + lz * CHUNK_SIZE + lx;
}

// Face table: for each of the six directions, the outward normal, the quad's
// origin corner, and the two in-plane axes. Corner (su, sv) walks the quad
// counter-clockwise as seen from outside, which is what makes back-face
// culling work without per-face winding fixes.
const FACES = [
  { // +X
    dir: [1, 0, 0], origin: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.72,
  },
  { // -X
    dir: [-1, 0, 0], origin: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.72,
  },
  { // +Y
    dir: [0, 1, 0], origin: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0,
  },
  { // -Y
    dir: [0, -1, 0], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.45,
  },
  { // +Z
    dir: [0, 0, 1], origin: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.86,
  },
  { // -Z
    dir: [0, 0, -1], origin: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.86,
  },
];

const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const AO_LEVELS = [0.52, 0.68, 0.84, 1.0];

function vertexAO(side1, side2, corner) {
  // Two solid sides fully enclose the corner, so the diagonal cannot lighten it.
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

// Decides whether the face of `id` touching `neighbor` is visible.
function faceVisible(id, neighbor) {
  if (neighbor === BLOCKS.AIR) return true;
  if (isOpaque(neighbor)) return false;
  // Like blocks with see-through rendering merge into one surface rather than
  // stacking interior faces (water bodies, glass panes, leaf canopies).
  if (neighbor === id) return false;
  const nd = defOf(neighbor);
  const d = defOf(id);
  // A liquid never draws the face it shares with a solid neighbor.
  if (d.liquid && !nd.liquid && nd.solid) return false;
  return true;
}

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
  }

  get isEmpty() {
    return this.indices.length === 0;
  }

  quad(corners, normal, uvRect, light) {
    const base = this.positions.length / 3;

    for (let i = 0; i < 4; i++) {
      const [x, y, z] = corners[i];
      this.positions.push(x, y, z);
      this.normals.push(normal[0], normal[1], normal[2]);
      const l = light[i];
      this.colors.push(l, l, l);
    }

    const { u0, v0, u1, v1 } = uvRect;
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);

    // Split the quad along the darker diagonal; the naive split makes AO
    // gradients bend visibly across the seam.
    if (light[0] + light[2] > light[1] + light[3]) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(VOLUME);
    this.dirty = true;
    this.generated = false;
    // Set when the player edits this chunk, so saving only stores real changes.
    this.modified = false;
    this.opaqueMesh = null;
    this.transparentMesh = null;
  }

  get(lx, y, lz) {
    if (y < 0 || y >= WORLD_HEIGHT) return BLOCKS.AIR;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return BLOCKS.AIR;
    return this.blocks[idx(lx, y, lz)];
  }

  set(lx, y, lz, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[idx(lx, y, lz)] = id;
    this.dirty = true;
  }

  // Highest non-air block, used for spawn placement and sky checks.
  columnTop(lx, lz) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.blocks[idx(lx, y, lz)] !== BLOCKS.AIR) return y;
    }
    return 0;
  }

  // `sample(worldX, worldY, worldZ)` must reach across chunk borders, otherwise
  // seams get lit and culled as though the world ended at the chunk edge.
  build(sample) {
    const opaque = new MeshBuilder();
    const transparent = new MeshBuilder();
    const baseX = this.cx * CHUNK_SIZE;
    const baseZ = this.cz * CHUNK_SIZE;

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const id = this.blocks[idx(lx, y, lz)];
          if (id === BLOCKS.AIR) continue;

          const def = defOf(id);
          const wx = baseX + lx;
          const wz = baseZ + lz;
          const target = def.liquid || def.transparent ? transparent : opaque;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = wx + face.dir[0];
            const ny = y + face.dir[1];
            const nz = wz + face.dir[2];

            if (!faceVisible(id, sample(nx, ny, nz))) continue;

            const corners = [];
            const light = [];

            for (let c = 0; c < 4; c++) {
              const [su, sv] = CORNERS[c];
              corners.push([
                wx + face.origin[0] + su * face.u[0] + sv * face.v[0],
                y + face.origin[1] + su * face.u[1] + sv * face.v[1],
                wz + face.origin[2] + su * face.u[2] + sv * face.v[2],
              ]);

              // Ambient occlusion samples the three blocks meeting at this
              // corner on the outward side of the face.
              const du = su === 1 ? 1 : -1;
              const dv = sv === 1 ? 1 : -1;
              const s1 = isOpaque(sample(
                nx + du * face.u[0], ny + du * face.u[1], nz + du * face.u[2]
              )) ? 1 : 0;
              const s2 = isOpaque(sample(
                nx + dv * face.v[0], ny + dv * face.v[1], nz + dv * face.v[2]
              )) ? 1 : 0;
              const cn = isOpaque(sample(
                nx + du * face.u[0] + dv * face.v[0],
                ny + du * face.u[1] + dv * face.v[1],
                nz + du * face.u[2] + dv * face.v[2]
              )) ? 1 : 0;

              light.push(face.shade * AO_LEVELS[vertexAO(s1, s2, cn)]);
            }

            target.quad(corners, face.dir, tileUV(def.tiles[f]), light);
          }
        }
      }
    }

    this.dirty = false;
    return {
      opaque: opaque.isEmpty ? null : opaque.toGeometry(),
      transparent: transparent.isEmpty ? null : transparent.toGeometry(),
    };
  }

  dispose() {
    if (this.opaqueMesh) {
      this.opaqueMesh.geometry.dispose();
      this.opaqueMesh = null;
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.transparentMesh = null;
    }
  }
}
