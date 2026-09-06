import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------- Constants ----------
const WORLD_HALF = 20; // world spans [-WORLD_HALF, WORLD_HALF)
const MAX_INSTANCES = 30000;
const GRAVITY = 22;
const JUMP_SPEED = 8;
const WALK_SPEED = 6;
const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.6;
const REACH = 6;

const BLOCK_TYPES = {
  grass: { color: 0x4caf50, slot: 1 },
  dirt: { color: 0x8d6e43, slot: 2 },
  stone: { color: 0x8a8a8a, slot: 3 },
  wood: { color: 0xa1662f, slot: 4 },
};
const SLOT_TO_TYPE = { 1: 'grass', 2: 'dirt', 3: 'stone', 4: 'wood' };

// ---------- Renderer / scene / camera ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 70);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(30, 50, 10);
scene.add(sun);

// ---------- Terrain height function ----------
function heightAt(x, z) {
  const h =
    Math.sin(x * 0.15) * 2 +
    Math.cos(z * 0.18) * 2 +
    Math.sin((x + z) * 0.07) * 3;
  return Math.max(1, Math.round(h + 5));
}

// ---------- Voxel storage backed by InstancedMesh per block type ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

class BlockLayer {
  constructor(color) {
    this.mesh = new THREE.InstancedMesh(
      boxGeo,
      new THREE.MeshLambertMaterial({ color }),
      MAX_INSTANCES
    );
    this.mesh.count = 0;
    this.freeList = [];
    this.nextIndex = 0;
    this.indexToKey = new Map(); // instanceId -> voxel key
    scene.add(this.mesh);
  }

  add(x, y, z, key) {
    let id;
    if (this.freeList.length) {
      id = this.freeList.pop();
    } else {
      id = this.nextIndex++;
      if (this.mesh.count < this.nextIndex) this.mesh.count = this.nextIndex;
    }
    dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(id, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.indexToKey.set(id, key);
    return id;
  }

  remove(id) {
    this.mesh.setMatrixAt(id, HIDE);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.indexToKey.delete(id);
    this.freeList.push(id);
  }
}

const layers = {};
for (const [type, def] of Object.entries(BLOCK_TYPES)) {
  layers[type] = new BlockLayer(def.color);
}

// voxel key -> { type, id }
const voxels = new Map();
const key = (x, y, z) => `${x},${y},${z}`;

function setBlock(x, y, z, type) {
  const k = key(x, y, z);
  if (voxels.has(k)) return false;
  const id = layers[type].add(x, y, z, k);
  voxels.set(k, { type, id });
  return true;
}

function removeBlock(x, y, z) {
  const k = key(x, y, z);
  const v = voxels.get(k);
  if (!v) return false;
  layers[v.type].remove(v.id);
  voxels.delete(k);
  return true;
}

function isSolid(x, y, z) {
  return voxels.has(key(Math.floor(x), Math.floor(y), Math.floor(z)));
}

// ---------- World generation ----------
const DIG_DEPTH = 4; // layers generated below the surface
for (let x = -WORLD_HALF; x < WORLD_HALF; x++) {
  for (let z = -WORLD_HALF; z < WORLD_HALF; z++) {
    const h = heightAt(x, z);
    for (let y = Math.max(0, h - DIG_DEPTH); y <= h; y++) {
      const type = y === h ? 'grass' : y >= h - 1 ? 'dirt' : 'stone';
      setBlock(x, y, z, type);
    }
  }
}

// ---------- Player ----------
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const startX = 0;
const startZ = 0;
controls.getObject().position.set(startX + 0.5, heightAt(startX, startZ) + EYE_HEIGHT + 1, startZ + 0.5);

const velocity = new THREE.Vector3();
const move = { forward: false, back: false, left: false, right: false };
let onGround = false;
let selectedType = 'grass';

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': move.forward = true; break;
    case 'KeyS': move.back = true; break;
    case 'KeyA': move.left = true; break;
    case 'KeyD': move.right = true; break;
    case 'Space':
      if (onGround) { velocity.y = JUMP_SPEED; onGround = false; }
      break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
      const slot = Number(e.code.slice(-1));
      selectedType = SLOT_TO_TYPE[slot];
      document.querySelectorAll('.slot').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.slot) === slot);
      });
      break;
    }
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': move.forward = false; break;
    case 'KeyS': move.back = false; break;
    case 'KeyA': move.left = false; break;
    case 'KeyD': move.right = false; break;
  }
});

// ---------- Block interaction ----------
const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const centerNDC = new THREE.Vector2(0, 0);
const layerMeshes = () => Object.values(layers).map((l) => l.mesh);

function pick() {
  raycaster.setFromCamera(centerNDC, camera);
  const hits = raycaster.intersectObjects(layerMeshes(), false);
  return hits.length ? hits[0] : null;
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked) return;
  const hit = pick();
  if (!hit) return;
  const layer = Object.values(layers).find((l) => l.mesh === hit.object);
  const k = layer.indexToKey.get(hit.instanceId);
  if (!k) return;
  const [bx, by, bz] = k.split(',').map(Number);

  if (e.button === 0) {
    // break
    removeBlock(bx, by, bz);
  } else if (e.button === 2) {
    // place on the face that was hit
    const n = hit.face.normal;
    const nx = bx + Math.round(n.x);
    const ny = by + Math.round(n.y);
    const nz = bz + Math.round(n.z);
    if (!wouldCollidePlayer(nx, ny, nz)) {
      setBlock(nx, ny, nz, selectedType);
    }
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

function wouldCollidePlayer(bx, by, bz) {
  const p = controls.getObject().position;
  const feet = p.y - EYE_HEIGHT;
  const overlapsY = feet < by + 1 && feet + PLAYER_HEIGHT > by;
  const overlapsX = p.x + PLAYER_RADIUS > bx && p.x - PLAYER_RADIUS < bx + 1;
  const overlapsZ = p.z + PLAYER_RADIUS > bz && p.z - PLAYER_RADIUS < bz + 1;
  return overlapsX && overlapsY && overlapsZ;
}

// ---------- Collision-aware movement ----------
function boxSolid(cx, cz, feetY) {
  const samples = [
    [cx - PLAYER_RADIUS, cz - PLAYER_RADIUS],
    [cx + PLAYER_RADIUS, cz - PLAYER_RADIUS],
    [cx - PLAYER_RADIUS, cz + PLAYER_RADIUS],
    [cx + PLAYER_RADIUS, cz + PLAYER_RADIUS],
  ];
  const heights = [feetY + 0.1, feetY + PLAYER_HEIGHT * 0.5, feetY + PLAYER_HEIGHT - 0.1];
  for (const [sx, sz] of samples) {
    for (const sy of heights) {
      if (isSolid(sx, sy, sz)) return true;
    }
  }
  return false;
}

function updatePlayer(dt) {
  const obj = controls.getObject();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

  let dx = 0, dz = 0;
  if (move.forward) { dx += forward.x; dz += forward.z; }
  if (move.back) { dx -= forward.x; dz -= forward.z; }
  if (move.right) { dx += right.x; dz += right.z; }
  if (move.left) { dx -= right.x; dz -= right.z; }
  const len = Math.hypot(dx, dz);
  if (len > 0) { dx = (dx / len) * WALK_SPEED * dt; dz = (dz / len) * WALK_SPEED * dt; }

  const feetY = obj.position.y - EYE_HEIGHT;

  // horizontal, axis separated
  if (dx !== 0 && !boxSolid(obj.position.x + dx, obj.position.z, feetY)) {
    obj.position.x += dx;
  }
  if (dz !== 0 && !boxSolid(obj.position.x, obj.position.z + dz, feetY)) {
    obj.position.z += dz;
  }
  obj.position.x = THREE.MathUtils.clamp(obj.position.x, -WORLD_HALF + 0.5, WORLD_HALF - 0.5);
  obj.position.z = THREE.MathUtils.clamp(obj.position.z, -WORLD_HALF + 0.5, WORLD_HALF - 0.5);

  // vertical
  velocity.y -= GRAVITY * dt;
  let newFeetY = feetY + velocity.y * dt;

  if (velocity.y <= 0 && boxSolid(obj.position.x, obj.position.z, newFeetY)) {
    // snap to the top of the highest solid block under the player's feet
    let restY = Math.floor(feetY);
    for (let y = Math.ceil(feetY); y >= restY - DIG_DEPTH - 2; y--) {
      if (isSolidColumn(obj.position.x, y, obj.position.z)) { restY = y + 1; break; }
    }
    newFeetY = restY;
    velocity.y = 0;
    onGround = true;
  } else if (velocity.y > 0 && boxSolid(obj.position.x, obj.position.z, newFeetY + PLAYER_HEIGHT)) {
    velocity.y = 0;
    onGround = false;
  } else {
    onGround = false;
  }

  obj.position.y = newFeetY + EYE_HEIGHT;

  if (obj.position.y < -20) {
    // fell out of the world - respawn
    velocity.set(0, 0, 0);
    obj.position.set(0.5, heightAt(0, 0) + EYE_HEIGHT + 1, 0.5);
  }
}

function isSolidColumn(cx, y, cz) {
  const samples = [
    [cx - PLAYER_RADIUS, cz - PLAYER_RADIUS],
    [cx + PLAYER_RADIUS, cz - PLAYER_RADIUS],
    [cx - PLAYER_RADIUS, cz + PLAYER_RADIUS],
    [cx + PLAYER_RADIUS, cz + PLAYER_RADIUS],
  ];
  return samples.some(([sx, sz]) => isSolid(sx, y, sz));
}

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let fpsAccum = 0, fpsFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (controls.isLocked) {
    updatePlayer(dt);
  }

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0; fpsFrames = 0;
  }

  renderer.render(scene, camera);
}
animate();
