import * as THREE from "three";
import { Noise2D } from "./noise.js";
import { BLOCKS, makeBoxGeometry, makeMaterial } from "./blocks.js";

const PER_TYPE_CAPACITY = 60000;
const NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function keyOf(x, y, z) {
  return `${x},${y},${z}`;
}

function parseKey(key) {
  const [x, y, z] = key.split(",").map(Number);
  return [x, y, z];
}

// Wraps one InstancedMesh per block type and supports O(1) add/remove of
// individual cube instances via a swap-with-last trick, since InstancedMesh
// itself has no notion of "removing" an instance, only a fixed capacity and
// an active `count`.
class BlockTypeMesh {
  constructor(type, scene) {
    this.type = type;
    this.capacity = PER_TYPE_CAPACITY;
    const geometry = makeBoxGeometry();
    const material = makeMaterial(type);
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.wrapper = this;
    scene.add(this.mesh);

    this.indexToKey = [];
    this.keyToIndex = new Map();
    this._m = new THREE.Matrix4();
  }

  add(x, y, z) {
    const key = keyOf(x, y, z);
    if (this.keyToIndex.has(key)) return;
    const idx = this.mesh.count;
    if (idx >= this.capacity) return;
    this._m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.setMatrixAt(idx, this._m);
    this.mesh.count = idx + 1;
    this.indexToKey[idx] = key;
    this.keyToIndex.set(key, idx);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  remove(x, y, z) {
    const key = keyOf(x, y, z);
    const idx = this.keyToIndex.get(key);
    if (idx === undefined) return;
    const lastIdx = this.mesh.count - 1;
    if (idx !== lastIdx) {
      this.mesh.getMatrixAt(lastIdx, this._m);
      this.mesh.setMatrixAt(idx, this._m);
      const lastKey = this.indexToKey[lastIdx];
      this.indexToKey[idx] = lastKey;
      this.keyToIndex.set(lastKey, idx);
    }
    this.mesh.count = lastIdx;
    this.indexToKey.pop();
    this.keyToIndex.delete(key);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  has(x, y, z) {
    return this.keyToIndex.has(keyOf(x, y, z));
  }

  keyForInstance(idx) {
    return this.indexToKey[idx];
  }
}

export class World {
  constructor(scene, { seed = 1337, radius = 40 } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.waterLevel = 4;
    this.data = new Map();
    this.heightNoise = new Noise2D(seed, 128);
    this.detailNoise = new Noise2D(seed + 7, 128);
    this.treeNoise = new Noise2D(seed + 42, 64);
    this.meshes = new Map();

    this._generate();
    this._buildInitialMeshes();
  }

  heightAt(x, z) {
    const continent = this.heightNoise.fbm(x * 0.015, z * 0.015, 4, 2.0, 0.5);
    const detail = this.detailNoise.fbm(x * 0.08, z * 0.08, 3, 2.0, 0.5);
    const h = continent * 16 + detail * 4;
    return Math.max(1, Math.floor(h));
  }

  _generate() {
    const r = this.radius;
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        const h = this.heightAt(x, z);
        const isBeach = h <= this.waterLevel + 1;
        const isSnowy = h >= 15;

        for (let y = 0; y <= h; y++) {
          let type;
          if (y === 0) type = BLOCKS.BEDROCK;
          else if (y === h) type = isBeach ? BLOCKS.SAND : isSnowy ? BLOCKS.SNOW : BLOCKS.GRASS;
          else if (y >= h - 3) type = isBeach ? BLOCKS.SAND : BLOCKS.DIRT;
          else type = BLOCKS.STONE;
          this.data.set(keyOf(x, y, z), type);
        }

        if (h < this.waterLevel) {
          for (let y = h + 1; y <= this.waterLevel; y++) {
            this.data.set(keyOf(x, y, z), BLOCKS.WATER);
          }
        }

        if (
          !isBeach && !isSnowy &&
          Math.abs(x) < r - 3 && Math.abs(z) < r - 3 &&
          this.treeNoise.sample(x * 0.5, z * 0.5) > 0.93
        ) {
          this._planTree(x, h + 1, z);
        }
      }
    }
  }

  _planTree(x, baseY, z) {
    const trunkHeight = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < trunkHeight; i++) {
      this.data.set(keyOf(x, baseY + i, z), BLOCKS.WOOD);
    }
    const canopyY = baseY + trunkHeight;
    for (let dy = -1; dy <= 1; dy++) {
      const ringRadius = dy === 1 ? 1 : 2;
      for (let dx = -ringRadius; dx <= ringRadius; dx++) {
        for (let dz = -ringRadius; dz <= ringRadius; dz++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (Math.abs(dx) === ringRadius && Math.abs(dz) === ringRadius && Math.random() < 0.5) continue;
          const key = keyOf(x + dx, canopyY + dy, z + dz);
          if (!this.data.has(key)) this.data.set(key, BLOCKS.LEAVES);
        }
      }
    }
    this.data.set(keyOf(x, canopyY + 2, z), BLOCKS.LEAVES);
  }

  get(x, y, z) {
    return this.data.get(keyOf(x, y, z)) ?? BLOCKS.AIR;
  }

  isOccluder(type) {
    return type !== BLOCKS.AIR && type !== BLOCKS.WATER && type !== BLOCKS.LEAVES;
  }

  isSolidForCollision(type) {
    return type !== BLOCKS.AIR && type !== BLOCKS.WATER;
  }

  isExposed(x, y, z) {
    const type = this.get(x, y, z);
    if (type === BLOCKS.AIR) return false;
    if (!this.isOccluder(type)) return true;
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (!this.isOccluder(this.get(x + dx, y + dy, z + dz))) return true;
    }
    return false;
  }

  _ensureMesh(type) {
    let m = this.meshes.get(type);
    if (!m) {
      m = new BlockTypeMesh(type, this.scene);
      this.meshes.set(type, m);
    }
    return m;
  }

  _buildInitialMeshes() {
    for (const key of this.data.keys()) {
      const [x, y, z] = parseKey(key);
      const type = this.data.get(key);
      if (this.isExposed(x, y, z)) {
        this._ensureMesh(type).add(x, y, z);
      }
    }
  }

  _refreshRender(x, y, z) {
    const type = this.get(x, y, z);
    if (type === BLOCKS.AIR) return;
    const mesh = this._ensureMesh(type);
    const shouldRender = this.isExposed(x, y, z);
    const isRendered = mesh.has(x, y, z);
    if (shouldRender && !isRendered) mesh.add(x, y, z);
    else if (!shouldRender && isRendered) mesh.remove(x, y, z);
  }

  // Sets a block, updating world data and the render instances for this
  // cell and its 6 neighbors (whose exposure may have just changed).
  setBlock(x, y, z, type) {
    const key = keyOf(x, y, z);
    const old = this.data.get(key) ?? BLOCKS.AIR;
    if (old === type) return;

    if (old !== BLOCKS.AIR) {
      const oldMesh = this.meshes.get(old);
      if (oldMesh && oldMesh.has(x, y, z)) oldMesh.remove(x, y, z);
    }

    if (type === BLOCKS.AIR) this.data.delete(key);
    else this.data.set(key, type);

    if (type !== BLOCKS.AIR && this.isExposed(x, y, z)) {
      this._ensureMesh(type).add(x, y, z);
    }

    for (const [dx, dy, dz] of NEIGHBORS) {
      this._refreshRender(x + dx, y + dy, z + dz);
    }
  }

  getRaycastTargets() {
    return [...this.meshes.values()].map((m) => m.mesh);
  }

  resolveHit(object, instanceId) {
    const wrapper = object.userData.wrapper;
    const key = wrapper.keyForInstance(instanceId);
    return parseKey(key);
  }
}

export { keyOf, parseKey };
