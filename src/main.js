import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { BLOCKS, BLOCK_INFO, HOTBAR } from "./blocks.js";

const REACH = 6;

const loadingEl = document.getElementById("loading");
const overlayEl = document.getElementById("overlay");
const posEl = document.getElementById("pos");
const lookEl = document.getElementById("lookblock");
const hotbarEl = document.getElementById("hotbar");

// --- Renderer / scene / camera -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0f0);
scene.fog = new THREE.Fog(0x8fd0f0, 40, 110);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.05,
  400
);

const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
sun.position.set(60, 90, 30);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

// --- World / player --------------------------------------------------------

const world = new World(scene, { seed: Math.floor(Math.random() * 100000), radius: 40 });
const player = new Player(camera, renderer.domElement, world);
player.spawnAt(0, 0);
camera.position.set(player.position.x, player.position.y + 1.55, player.position.z);

// --- Pointer lock overlay ---------------------------------------------------

loadingEl.classList.add("hidden");
overlayEl.classList.remove("hidden");

overlayEl.addEventListener("click", () => player.controls.lock());
player.controls.addEventListener("lock", () => overlayEl.classList.add("hidden"));
player.controls.addEventListener("unlock", () => overlayEl.classList.remove("hidden"));

// --- Hotbar ------------------------------------------------------------------

let selected = 0;

function renderHotbar() {
  hotbarEl.innerHTML = "";
  HOTBAR.forEach((blockId, i) => {
    const info = BLOCK_INFO[blockId];
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " active" : "");
    slot.style.background = `#${info.color.toString(16).padStart(6, "0")}`;
    slot.title = info.name;
    const label = document.createElement("span");
    label.textContent = i + 1;
    slot.appendChild(label);
    hotbarEl.appendChild(slot);
  });
}
renderHotbar();

window.addEventListener("keydown", (e) => {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= HOTBAR.length) {
    selected = n - 1;
    renderHotbar();
  }
});
window.addEventListener("wheel", (e) => {
  if (!player.controls.isLocked) return;
  selected = (selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
  renderHotbar();
});

// --- Block interaction -------------------------------------------------------

const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const centerNDC = new THREE.Vector2(0, 0);

function raycastBlock() {
  raycaster.setFromCamera(centerNDC, camera);
  const targets = world.getRaycastTargets();
  if (targets.length === 0) return null;
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const hit = hits[0];
  const [x, y, z] = world.resolveHit(hit.object, hit.instanceId);
  return { x, y, z, normal: hit.face.normal, point: hit.point };
}

renderer.domElement.addEventListener("mousedown", (e) => {
  if (!player.controls.isLocked) return;
  const hit = raycastBlock();
  if (!hit) return;

  if (e.button === 0) {
    // Left click: break block.
    world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
  } else if (e.button === 2) {
    // Right click: place block adjacent to the hit face.
    const px = hit.x + Math.round(hit.normal.x);
    const py = hit.y + Math.round(hit.normal.y);
    const pz = hit.z + Math.round(hit.normal.z);
    if (world.get(px, py, pz) === BLOCKS.AIR) {
      const dx = player.position.x - (px + 0.5);
      const dy = (player.position.y + 1.55) - (py + 0.5);
      const dz = player.position.z - (pz + 0.5);
      if (dx * dx + dy * dy + dz * dz > 0.6) {
        world.setBlock(px, py, pz, HOTBAR[selected]);
      }
    }
  }
});
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// --- Resize ------------------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Main loop -----------------------------------------------------------------

const clock = new THREE.Clock();
let hudTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (player.controls.isLocked) {
    player.update(dt);
  }

  hudTimer += dt;
  if (hudTimer > 0.15) {
    hudTimer = 0;
    const p = player.position;
    posEl.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    const hit = player.controls.isLocked ? raycastBlock() : null;
    lookEl.textContent = hit ? BLOCK_INFO[world.get(hit.x, hit.y, hit.z)]?.name ?? "-" : "-";
  }

  renderer.render(scene, camera);
}

animate();
