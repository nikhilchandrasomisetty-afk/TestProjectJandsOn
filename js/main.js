'use strict';

import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { BLOCKS, AIR, ID, block, tileDataURL, isSolid } from './blocks.js';
import { CHUNK_SIZE, SETTINGS } from './config.js';

const SAVE_KEY = 'voxelcraft.save.v1';
const DAY_LENGTH = 600; // seconds for a full day/night cycle
const BREAK_INTERVAL = 0.22;
const PLACE_INTERVAL = 0.2;

// ------------------------------------------------------------------ scene

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const viewDistance = SETTINGS.renderDistance * CHUNK_SIZE;
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, viewDistance + 64);

scene.fog = new THREE.Fog(0x8fc6f0, viewDistance * 0.55, viewDistance);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(sunLight);
scene.add(sunLight.target);
const skyLight = new THREE.HemisphereLight(0x9fd4ff, 0x4a4335, 0.65);
scene.add(skyLight);

const SKY_NIGHT = new THREE.Color(0x0a1024);
const SKY_DUSK = new THREE.Color(0xd97a3d);
const SKY_DAY = new THREE.Color(0x8fc6f0);
const UNDERWATER_FOG = new THREE.Color(0x1b4f9c);

// Wireframe cube drawn around whatever block the crosshair is on.
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
);
highlight.visible = false;
scene.add(highlight);

// ------------------------------------------------------------------ state

const ui = {
  menu: document.getElementById('menu'),
  inventory: document.getElementById('inventory'),
  hotbar: document.getElementById('hotbar'),
  palette: document.getElementById('palette'),
  stats: document.getElementById('stats'),
  loading: document.getElementById('loading'),
  heldName: document.getElementById('held-name'),
  underwater: document.getElementById('underwater'),
  seedInput: document.getElementById('seed-input'),
  saveInfo: document.getElementById('save-info'),
  targetSlot: document.getElementById('target-slot'),
  dragHint: document.getElementById('drag-hint'),
};

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sneak: false,
  sprint: false,
  breaking: false,
  placing: false,
  axisForward: 0,
  axisStrafe: 0,
};

// A locked pointer delivers every mouse event to the canvas, so on-screen
// controls and pointer lock cannot coexist — the page picks one mode.
const HAS_TOUCH = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

const state = {
  seed: 1337,
  hotbar: [ID.grass, ID.dirt, ID.stone, ID.cobblestone, ID.planks, ID.log, ID.glass, ID.brick, ID.glowstone],
  selected: 0,
  time: 0.28, // 0..1 through the day; starts mid-morning
  paused: true,
  breakCooldown: 0,
  placeCooldown: 0,
  dragLook: false,
  buttonMode: HAS_TOUCH,
};

let world = null;
let player = null;

function seedFromString(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return (Math.random() * 2 ** 31) | 0;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed) | 0;
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function startWorld(seed, save) {
  if (world) world.reload();
  state.seed = seed;
  world = new World(scene, seed);
  world.loadEdits(save?.edits);
  player = new Player(world, camera);

  if (save?.hotbar) state.hotbar = save.hotbar.slice(0, 9);
  if (typeof save?.time === 'number') state.time = save.time;
  state.selected = save?.selected ?? 0;

  // Terrain around spawn must exist before we can stand on it.
  const spawnCX = Math.floor((save?.player?.x ?? 0) / CHUNK_SIZE);
  const spawnCZ = Math.floor((save?.player?.z ?? 0) / CHUNK_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) world.ensureChunkData(spawnCX + dx, spawnCZ + dz);
  }

  if (!player.fromJSON(save?.player)) player.spawnAt(0, 0);
  player.applyToCamera();
  renderHotbar();
  updateSaveInfo();
}

// ------------------------------------------------------------ persistence

function saveGame() {
  if (!world || !player) return;
  const payload = {
    seed: state.seed,
    edits: world.serializeEdits(),
    player: player.toJSON(),
    hotbar: state.hotbar,
    selected: state.selected,
    time: state.time,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    updateSaveInfo();
    return true;
  } catch (err) {
    console.warn('Could not save world:', err);
    ui.saveInfo.textContent = 'Save failed (storage full or blocked).';
    return false;
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storageAvailable() {
  try {
    localStorage.getItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

function updateSaveInfo() {
  if (!storageAvailable()) {
    ui.saveInfo.textContent =
      'Saving is unavailable here — this page can’t use browser storage, so your world lasts only until you close the tab.';
    return;
  }
  const save = loadSave();
  const edits = save ? Object.values(save.edits ?? {}).reduce((n, arr) => n + arr.length / 2, 0) : 0;
  ui.saveInfo.textContent = save
    ? `Saved world: seed ${save.seed}, ${edits} block change${edits === 1 ? '' : 's'}, ` +
      `last saved ${new Date(save.savedAt).toLocaleString()}.`
    : 'No saved world yet — your changes are saved automatically while you play.';
}

// ---------------------------------------------------------------- hotbar

function renderHotbar() {
  ui.hotbar.innerHTML = '';
  state.hotbar.forEach((id, index) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (index === state.selected ? ' active' : '');
    slot.title = id === AIR ? 'Empty' : block(id).label;

    const number = document.createElement('span');
    number.textContent = String(index + 1);
    slot.appendChild(number);

    if (id !== AIR) {
      const img = document.createElement('img');
      img.src = tileDataURL(block(id).iconTile);
      img.alt = block(id).label;
      slot.appendChild(img);
    }

    slot.addEventListener('click', (event) => {
      event.stopPropagation();
      selectSlot(index);
    });
    ui.hotbar.appendChild(slot);
  });
}

function selectSlot(index) {
  state.selected = (index + 9) % 9;
  ui.targetSlot.textContent = String(state.selected + 1);
  renderHotbar();
  const id = state.hotbar[state.selected];
  ui.heldName.textContent = id === AIR ? 'Empty' : block(id).label;
  ui.heldName.classList.add('show');
  clearTimeout(selectSlot.timer);
  selectSlot.timer = setTimeout(() => ui.heldName.classList.remove('show'), 1200);
}

function renderPalette() {
  ui.palette.innerHTML = '';
  for (const spec of BLOCKS) {
    if (!spec) continue;
    const item = document.createElement('div');
    item.className = 'palette-item';

    const img = document.createElement('img');
    img.src = tileDataURL(spec.iconTile);
    img.alt = spec.label;
    item.appendChild(img);

    const label = document.createElement('div');
    label.textContent = spec.label;
    item.appendChild(label);

    item.addEventListener('click', () => {
      state.hotbar[state.selected] = spec.id;
      renderHotbar();
      toggleInventory(false);
    });
    ui.palette.appendChild(item);
  }
}

// ------------------------------------------------------------ interaction

function currentTarget() {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return world.raycast(player.eyePosition, direction, SETTINGS.reach);
}

function breakBlock() {
  const hit = currentTarget();
  if (!hit) return;
  if (hit.block.id === ID.bedrock) return; // world floor stays put
  world.setBlock(hit.block.x, hit.block.y, hit.block.z, AIR);
}

function placeBlock() {
  const id = state.hotbar[state.selected];
  if (id === AIR) return;
  const hit = currentTarget();
  if (!hit) return;

  const { x, y, z } = hit.place;
  const existing = world.getBlock(x, y, z);
  if (existing !== AIR && !block(existing).liquid) return;
  if (isSolid(id) && player.intersectsBlock(x, y, z)) return; // don't trap yourself
  world.setBlock(x, y, z, id);
}

function pickBlock() {
  const hit = currentTarget();
  if (!hit) return;
  state.hotbar[state.selected] = hit.block.id;
  renderHotbar();
}

function updateHighlight() {
  const hit = currentTarget();
  if (!hit) {
    highlight.visible = false;
    return;
  }
  highlight.visible = true;
  highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
}

// ------------------------------------------------------------------ input

const canvas = renderer.domElement;

function isPointerLocked() {
  return document.pointerLockElement === canvas;
}

function requestPlay() {
  ui.menu.hidden = true;
  ui.inventory.hidden = true;
  state.paused = false;
  grabPointer();
}

function pause() {
  state.paused = true;
  for (const key of Object.keys(input)) input[key] = typeof input[key] === 'number' ? 0 : false;
  for (const button of document.querySelectorAll('.action.held')) button.classList.remove('held');
  document.getElementById('stick')?.classList.remove('active');
  const knob = document.getElementById('stick-knob');
  if (knob) knob.style.transform = '';
  ui.menu.hidden = false;
  updateSaveInfo();
  if (isPointerLocked()) document.exitPointerLock();
}

function toggleInventory(force) {
  const open = force ?? ui.inventory.hidden;
  ui.inventory.hidden = !open;
  if (open) {
    if (isPointerLocked()) document.exitPointerLock();
  } else if (!state.paused && !state.dragLook) {
    grabPointer();
  }
}

document.addEventListener('pointerlockchange', () => {
  if (isPointerLocked()) state.dragLook = false;
  // Losing the pointer (Esc) pauses, unless a UI panel deliberately took it.
  else if (!state.paused && ui.inventory.hidden && !state.dragLook) pause();
});

/**
 * Embedded pages (an iframe without allow="pointer-lock") can be refused the
 * pointer. Rather than leaving the player unable to look around, fall back to
 * dragging the mouse to look, where a click without drag is break/place.
 */
function grabPointer() {
  if (state.buttonMode) {
    enableDragLook();
    return;
  }
  const result = canvas.requestPointerLock?.();
  if (result && typeof result.catch === 'function') result.catch(() => enableDragLook());
  setTimeout(() => {
    if (!isPointerLocked() && !state.paused) enableDragLook();
  }, 350);
}

function enableDragLook() {
  if (state.dragLook) return;
  state.dragLook = true;
  ui.dragHint.hidden = false;
  // The hint has done its job once you've read it; don't leave it on screen.
  clearTimeout(enableDragLook.timer);
  enableDragLook.timer = setTimeout(() => {
    ui.dragHint.hidden = true;
  }, 7000);
}

let dragging = false;
let dragDistance = 0;

canvas.addEventListener('mousedown', (event) => {
  if (state.paused) return;

  if (state.dragLook) {
    dragging = true;
    dragDistance = 0;
    return; // the action happens on release, once we know it wasn't a drag
  }
  if (!isPointerLocked()) {
    grabPointer();
    return;
  }
  if (event.button === 0) {
    input.breaking = true;
    state.breakCooldown = 0;
    breakBlock();
  } else if (event.button === 2) {
    input.placing = true;
    state.placeCooldown = 0;
    placeBlock();
  } else if (event.button === 1) {
    pickBlock();
  }
});

window.addEventListener('mouseup', (event) => {
  if (state.dragLook && dragging) {
    dragging = false;
    if (dragDistance < 6 && !state.paused) {
      if (event.button === 0) breakBlock();
      else if (event.button === 2) placeBlock();
      else if (event.button === 1) pickBlock();
    }
    return;
  }
  if (event.button === 0) input.breaking = false;
  if (event.button === 2) input.placing = false;
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// Touch look: drag anywhere on the world to turn. Touches don't carry usable
// movement deltas, so track the finger position ourselves. preventDefault
// suppresses the synthetic mouse events that would otherwise break a block.
let touchPointer = null;
let touchLast = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || state.paused) return;
  event.preventDefault();
  touchPointer = event.pointerId;
  touchLast = { x: event.clientX, y: event.clientY };
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Capture is an optimisation; window-level tracking below still works.
  }
});

window.addEventListener('pointermove', (event) => {
  if (event.pointerId !== touchPointer || state.paused) return;
  event.preventDefault();
  player.look(event.clientX - touchLast.x, event.clientY - touchLast.y, 0.004);
  touchLast = { x: event.clientX, y: event.clientY };
});

const endTouchLook = (event) => {
  if (event.pointerId === touchPointer) touchPointer = null;
};
window.addEventListener('pointerup', endTouchLook);
window.addEventListener('pointercancel', endTouchLook);

document.addEventListener('mousemove', (event) => {
  if (state.paused) return;
  if (state.dragLook) {
    if (!dragging) return;
    dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
    player.look(event.movementX, event.movementY);
    return;
  }
  if (!isPointerLocked()) return;
  player.look(event.movementX, event.movementY);
});

window.addEventListener(
  'wheel',
  (event) => {
    if (state.paused || (!isPointerLocked() && !state.dragLook)) return;
    selectSlot(state.selected + (event.deltaY > 0 ? 1 : -1));
  },
  { passive: true }
);

// ---------------------------------------------------- on-screen controls

/**
 * A movement stick and action buttons, driven by pointer events so they work
 * for touch and mouse alike. The stick feeds analog axes into the same input
 * object the keyboard writes to, so both can be used at once.
 */
let applyControlMode = () => {};

function setupOnScreenControls() {
  const controls = document.getElementById('touch-controls');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const flyButton = document.getElementById('btn-fly');
  const downButton = document.getElementById('btn-down');

  const RADIUS = 46; // how far the knob travels, in pixels
  let stickPointer = null;

  const setAxes = (dx, dy) => {
    input.axisStrafe = dx;
    input.axisForward = -dy; // screen down is backwards
    knob.style.transform = `translate(${dx * RADIUS}px, ${dy * RADIUS}px)`;
  };

  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    stickPointer = event.pointerId;
    stick.classList.add('active');
  });

  // Move and release are tracked on the window, so sliding a finger off the
  // stick — or off a button — still steers and still releases cleanly.
  window.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stickPointer) return;
    const box = stick.getBoundingClientRect();
    let dx = (event.clientX - (box.left + box.width / 2)) / RADIUS;
    let dy = (event.clientY - (box.top + box.height / 2)) / RADIUS;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    setAxes(dx, dy);
  });

  const releaseStick = (event) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    stick.classList.remove('active');
    setAxes(0, 0);
  };
  window.addEventListener('pointerup', releaseStick);
  window.addEventListener('pointercancel', releaseStick);

  /** Wires a button that acts while held down. */
  const holdButton = (id, onPress, onRelease) => {
    const button = document.getElementById(id);
    let heldBy = null;

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      heldBy = event.pointerId;
      button.classList.add('held');
      onPress();
    });

    const release = (event) => {
      if (heldBy === null || (event && event.pointerId !== heldBy)) return;
      heldBy = null;
      button.classList.remove('held');
      onRelease?.();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return button;
  };

  holdButton(
    'btn-break',
    () => {
      input.breaking = true;
      state.breakCooldown = 0;
      breakBlock();
    },
    () => {
      input.breaking = false;
    }
  );

  holdButton(
    'btn-place',
    () => {
      input.placing = true;
      state.placeCooldown = 0;
      placeBlock();
    },
    () => {
      input.placing = false;
    }
  );

  holdButton(
    'btn-jump',
    () => {
      input.jump = true;
    },
    () => {
      input.jump = false;
    }
  );

  holdButton(
    'btn-down',
    () => {
      input.sneak = true;
    },
    () => {
      input.sneak = false;
    }
  );

  flyButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    player.flying = !player.flying;
    player.velocity.y = 0;
    refreshFlyButton();
  });

  function refreshFlyButton() {
    const flying = Boolean(player?.flying);
    flyButton.classList.toggle('on', flying);
    // Jump doubles as "ascend" in flight, so descending needs its own button.
    downButton.hidden = !flying;
    if (!flying) {
      input.sneak = false;
      downButton.classList.remove('held');
    }
  }

  applyControlMode = (buttonMode) => {
    controls.hidden = !buttonMode;
    if (!buttonMode) {
      input.axisForward = 0;
      input.axisStrafe = 0;
      knob.style.transform = '';
    }
  };
  applyControlMode(state.buttonMode);
  return refreshFlyButton;
}

const KEY_BINDINGS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sneak',
  ShiftRight: 'sneak',
  ControlLeft: 'sprint',
  ControlRight: 'sprint',
};

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    if (!ui.inventory.hidden) toggleInventory(false);
    else if (!state.paused) pause();
    return;
  }

  if (event.repeat) return;

  if (event.code === 'KeyE') {
    if (!state.paused) toggleInventory();
    return;
  }
  if (state.paused) return;

  if (KEY_BINDINGS[event.code]) {
    input[KEY_BINDINGS[event.code]] = true;
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    input.jump = true;
    player.tapJump(performance.now());
    return;
  }
  if (event.code === 'KeyF') {
    player.flying = !player.flying;
    player.velocity.y = 0;
    return;
  }
  if (event.code === 'KeyR') {
    player.spawnAt(Math.floor(player.position.x), Math.floor(player.position.z));
    return;
  }
  if (/^Digit[1-9]$/.test(event.code)) {
    selectSlot(Number(event.code.slice(5)) - 1);
  }
});

window.addEventListener('keyup', (event) => {
  if (KEY_BINDINGS[event.code]) input[KEY_BINDINGS[event.code]] = false;
  if (event.code === 'Space') input.jump = false;
});

window.addEventListener('blur', () => {
  for (const key of Object.keys(input)) input[key] = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', saveGame);

document.getElementById('btn-play').addEventListener('click', requestPlay);

const controlsButton = document.getElementById('btn-controls');
function refreshControlsButton() {
  controlsButton.textContent = `On-screen controls: ${state.buttonMode ? 'on' : 'off'}`;
  controlsButton.classList.toggle('primary', false);
}
controlsButton.addEventListener('click', () => {
  state.buttonMode = !state.buttonMode;
  applyControlMode(state.buttonMode);
  refreshControlsButton();
  // Switching modes changes how looking works, so drop any pointer lock.
  if (state.buttonMode && isPointerLocked()) document.exitPointerLock();
  if (!state.buttonMode) {
    state.dragLook = false;
    ui.dragHint.hidden = true;
  }
});
document.getElementById('btn-save').addEventListener('click', () => {
  if (saveGame()) ui.saveInfo.textContent = 'World saved.';
});
document.getElementById('btn-new').addEventListener('click', () => {
  const previous = loadSave();
  const hasEdits = previous && Object.keys(previous.edits ?? {}).length > 0;
  if (hasEdits && !confirm('Starting a new world replaces your saved one. Continue?')) return;

  const seed = seedFromString(ui.seedInput.value);
  ui.seedInput.value = String(seed);
  startWorld(seed, null);
  saveGame();
  requestPlay();
});
document.getElementById('btn-reset').addEventListener('click', () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be unavailable when the page is embedded; nothing to delete.
  }
  updateSaveInfo();
});

// ------------------------------------------------------------- day cycle

function updateSky(dt) {
  state.time = (state.time + dt / DAY_LENGTH) % 1;
  const angle = state.time * Math.PI * 2;
  const sunHeight = Math.sin(angle);

  sunLight.position.set(Math.cos(angle) * 100, sunHeight * 100, 40).add(camera.position);
  sunLight.target.position.copy(camera.position);
  sunLight.intensity = 0.15 + Math.max(0, sunHeight) * 1.0;
  skyLight.intensity = 0.28 + Math.max(0, sunHeight) * 0.5;

  const duskMix = THREE.MathUtils.clamp((sunHeight + 0.18) / 0.3, 0, 1);
  const dayMix = THREE.MathUtils.clamp((sunHeight - 0.12) / 0.3, 0, 1);
  const sky = SKY_NIGHT.clone().lerp(SKY_DUSK, duskMix).lerp(SKY_DAY, dayMix);

  const submerged = world.isLiquidAt(camera.position.x, camera.position.y, camera.position.z);
  ui.underwater.classList.toggle('on', submerged);
  if (submerged) {
    scene.background = UNDERWATER_FOG;
    scene.fog.color.copy(UNDERWATER_FOG);
    scene.fog.near = 0.1;
    scene.fog.far = 18;
  } else {
    scene.background = sky;
    scene.fog.color.copy(sky);
    scene.fog.near = viewDistance * 0.55;
    scene.fog.far = viewDistance;
  }
}

function clockText() {
  const minutes = Math.floor(state.time * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// -------------------------------------------------------------- game loop

let lastFrame = performance.now();
let fps = 0;
let hudTimer = 0;
let autosaveTimer = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  if (!world || !player) return;

  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;

  if (!state.paused) {
    player.update(dt, input);

    state.breakCooldown -= dt;
    state.placeCooldown -= dt;
    if (input.breaking && state.breakCooldown <= 0) {
      breakBlock();
      state.breakCooldown = BREAK_INTERVAL;
    }
    if (input.placing && state.placeCooldown <= 0) {
      placeBlock();
      state.placeCooldown = PLACE_INTERVAL;
    }

    autosaveTimer += dt;
    if (autosaveTimer > 30) {
      autosaveTimer = 0;
      saveGame();
    }
  }

  const pending = world.update(player.position.x, player.position.z);
  updateSky(dt);
  updateHighlight();

  // Only announce a real backlog — small counts are normal while walking.
  ui.loading.hidden = pending < 24;
  if (!ui.loading.hidden) ui.loading.textContent = `Generating world… ${pending} chunks left`;

  hudTimer += dt;
  if (hudTimer > 0.15) {
    hudTimer = 0;
    const p = player.position;
    const mode = player.flying ? 'Fly' : player.inWater ? 'Swim' : player.onGround ? 'Walk' : 'Air';
    refreshFlyControls?.();
    ui.stats.innerHTML =
      `<b>XYZ</b>  ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
      `<b>Biome</b> ${world.biomeNameAt(p.x, p.z)}\n` +
      `<b>Mode</b>  ${mode}\n` +
      `<b>Time</b>  ${clockText()}\n` +
      `<b>FPS</b>   ${fps.toFixed(0)}  ·  chunks ${world.stats.chunks}`;
  }

  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ start

const existingSave = loadSave();
const initialSeed = existingSave?.seed ?? seedFromString('');
ui.seedInput.value = String(initialSeed);
renderPalette();
startWorld(initialSeed, existingSave);
const refreshFlyControls = setupOnScreenControls();
refreshFlyControls();
refreshControlsButton();
selectSlot(state.selected);
requestAnimationFrame(animate);

// Exposed for quick tinkering from the browser console.
window.game = { world: () => world, player: () => player, state, saveGame, THREE };
