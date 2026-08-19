import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Input } from "./input.js";
import { Inventory } from "./inventory.js";
import { Interaction } from "./interaction.js";
import { AudioEngine } from "./audio.js";
import { Sky } from "./sky.js";
import { HUD } from "./hud.js";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./chunk.js";
import { defOf } from "./blocks.js";

const RENDER_DISTANCE = 5;
const AUTOSAVE_SECONDS = 12;
const PLAYER_SAVE_KEY = "blockcraft.player.v1";

const refs = {
  loading: document.getElementById("loading"),
  start: document.getElementById("start"),
  startNote: document.getElementById("start-note"),
  play: document.getElementById("play"),
  crosshair: document.getElementById("crosshair"),
  status: document.getElementById("status"),
  debug: document.getElementById("debug"),
  health: document.getElementById("health"),
  breath: document.getElementById("breath"),
  hotbar: document.getElementById("hotbar"),
  heldName: document.getElementById("held-name"),
  toast: document.getElementById("toast"),
  damageFlash: document.getElementById("damage-flash"),
  underwater: document.getElementById("underwater"),
  inventory: document.getElementById("inventory"),
  invGrid: document.getElementById("inv-grid"),
  recipes: document.getElementById("recipes"),
  death: document.getElementById("death"),
  touch: document.getElementById("touch"),
};

// --- renderer -----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({
  antialias: window.devicePixelRatio < 2,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0f0);

const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.06,
  600
);

// --- game objects -------------------------------------------------------------

const saved = World.loadSave();
const seed = saved?.seed ?? Math.floor(Math.random() * 1_000_000);

const world = new World(scene, { seed, renderDistance: RENDER_DISTANCE });
if (saved) world.applySave(saved);

const sky = new Sky(scene, { renderDistance: RENDER_DISTANCE, chunkSize: CHUNK_SIZE });
const audio = new AudioEngine();
const inventory = new Inventory();
const player = new Player(world, camera);
const input = new Input(renderer.domElement);
const interaction = new Interaction(world, player, inventory, audio, scene);

const hud = new HUD(refs, { inventory, player, world, sky, audio });

// --- saved state --------------------------------------------------------------

function loadPlayerState() {
  try {
    const raw = localStorage.getItem(PLAYER_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePlayerState() {
  try {
    localStorage.setItem(PLAYER_SAVE_KEY, JSON.stringify({
      player: player.serialize(),
      inventory: inventory.serialize(),
      time: sky.time,
    }));
  } catch {
    /* storage full or blocked — the world save is the important one */
  }
}

const savedPlayer = loadPlayerState();
if (savedPlayer?.inventory) inventory.restore(savedPlayer.inventory);
else inventory.fillStarter();
if (typeof savedPlayer?.time === "number") sky.setTime(savedPlayer.time);

// --- player callbacks ---------------------------------------------------------

player.onFootstep = (blockId) => audio.playStep(defOf(blockId).sound);
player.onHurt = () => {
  audio.playHurt();
  hud.flashDamage();
};
player.onDeath = () => {
  audio.playDeath();
  hud.showDeath(true);
  input.deactivate();
};

interaction.onDenied = (message) => hud.toast(message);

inventory.onChange = () => {
  hud.renderHotbar();
  if (hud.inventoryOpen) hud.renderInventory();
};

// --- input wiring -------------------------------------------------------------

input.onLook = (dx, dy, sensitivity) => {
  if (hud.inventoryOpen || player.dead) return;
  player.addLook(dx, dy, sensitivity);
};

input.onAttackStart = () => {
  audio.ensure();
  if (hud.inventoryOpen || player.dead) return;
  interaction.tryQuickBreak();
};

input.onUseStart = () => {
  audio.ensure();
  if (hud.inventoryOpen || player.dead) return;
  interaction.tryPlace();
};

input.onActivate = (fallbackMode, touchMode) => {
  audio.ensure();
  refs.start.classList.add("is-hidden");
  refs.crosshair.classList.remove("is-hidden");
  if (touchMode) refs.touch.classList.remove("is-hidden");
  if (fallbackMode) {
    hud.toast("Drag to look — pointer lock unavailable here");
  }
};

input.onDeactivate = () => {
  if (!player.dead) refs.start.classList.remove("is-hidden");
  refs.crosshair.classList.add("is-hidden");
};

input.onCommand = (command) => {
  if (command.startsWith("slot:")) {
    inventory.select(Number(command.slice(5)));
    return;
  }

  switch (command) {
    case "slotNext": inventory.cycle(1); break;
    case "slotPrev": inventory.cycle(-1); break;
    case "fly":
      hud.toast(player.toggleFly() ? "Flying on" : "Flying off");
      break;
    case "inventory":
      if (hud.inventoryOpen) {
        hud.closeInventory();
        input.activate();
      } else {
        hud.openInventory();
        input.deactivate();
        refs.start.classList.add("is-hidden");
      }
      break;
    case "respawn":
      if (player.dead) {
        player.respawn();
        hud.showDeath(false);
        input.activate();
      }
      break;
    case "debug": hud.toggleDebug(); break;
    case "pause":
      if (hud.inventoryOpen) {
        hud.closeInventory();
        input.activate();
      } else {
        input.deactivate();
      }
      break;
  }
};

refs.play.addEventListener("click", (e) => {
  e.stopPropagation();
  input.activate();
});
refs.start.addEventListener("click", () => input.activate());

input.bindButton(document.getElementById("btn-jump"), "jump");
input.bindButton(document.getElementById("btn-place"), "place");
input.bindButton(document.getElementById("btn-mine"), "mine");
input.bindButton(document.getElementById("btn-fly"), "fly");

// --- spawn --------------------------------------------------------------------

let spawned = false;

// Chunk streaming follows player.position, so parking it over the intended
// spawn makes the world load there rather than at the origin.
const spawnPoint = savedPlayer?.player
  ? { x: savedPlayer.player.x, z: savedPlayer.player.z }
  : world.findSpawnPoint();
player.position.set(spawnPoint.x + 0.5, WORLD_HEIGHT, spawnPoint.z + 0.5);

function trySpawn() {
  if (spawned) return;
  if (!world.isReadyAround(player.position)) return;

  spawned = true;
  if (savedPlayer?.player) {
    player.restore(savedPlayer.player);
    // Guard against a save that would drop the player inside terrain.
    if (player.collides(player.position.x, player.position.y, player.position.z)) {
      player.respawn(player.position.x, player.position.z);
    }
  } else {
    player.respawn(spawnPoint.x + 0.5, spawnPoint.z + 0.5);
  }
  player.spawn.copy(player.position);

  refs.loading.classList.add("is-hidden");
  refs.start.classList.remove("is-hidden");

  if (input.isTouchDevice) {
    refs.startNote.textContent =
      "Touch controls: drag the left half to move, the right half to look, and tap to mine. Your world saves to this browser.";
  } else if (saved) {
    refs.startNote.textContent = "Continuing your saved world in this browser.";
  }

  hud.renderHotbar();
  hud.renderInventory();
}

// --- loop ---------------------------------------------------------------------

const clock = new THREE.Clock();
let fps = 60;
let hudTimer = 0;
let autosaveTimer = 0;
let wasUnderwater = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  world.update(player.position, spawned ? 6 : 14);
  trySpawn();

  if (spawned && input.active && !hud.inventoryOpen) {
    player.update(dt, input);
    interaction.update(dt, input);
  } else if (spawned) {
    player.syncCamera();
  }

  sky.update(dt, player.position);

  // Underwater treatment is driven by the camera, not the body, so it kicks
  // in exactly when the view goes below the surface.
  const underwater = player.headInWater;
  if (underwater !== wasUnderwater) {
    wasUnderwater = underwater;
    sky.applyUnderwaterFog(underwater);
    hud.setUnderwater(underwater);
    if (underwater) audio.playSplash();
  }

  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;

  hudTimer += dt;
  if (hudTimer > 0.12) {
    hudTimer = 0;
    hud.renderVitals();
    hud.renderDebug(fps, interaction.target);
    updateStatus();
  }

  if (spawned) {
    autosaveTimer += dt;
    if (autosaveTimer > AUTOSAVE_SECONDS) {
      autosaveTimer = 0;
      world.save();
      savePlayerState();
    }
  }

  renderer.render(scene, camera);
}

function updateStatus() {
  const p = player.position;
  const biome = world.biomeNameAt(Math.floor(p.x), Math.floor(p.z));
  const parts = [
    biome,
    sky.clockLabel,
    `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`,
  ];
  if (player.flying) parts.push("flying");
  hud.setStatus(parts.join("  ·  "));
}

// --- lifecycle ----------------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("beforeunload", () => {
  if (!spawned) return;
  world.save();
  savePlayerState();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && spawned) {
    world.save();
    savePlayerState();
  }
});

// Debug handle: lets you inspect or drive the game from the browser console,
// and is what the automated browser tests hook into.
window.__game = {
  renderer, scene, camera, world, player, inventory, interaction, sky, audio, input, hud,
  get spawned() { return spawned; },
};

frame();
