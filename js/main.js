import * as THREE from 'three';
import { buildAtlas } from './textures.js';
import { ChunkManager } from './chunkmanager.js';
import { Player } from './player.js';
import { InputManager } from './input.js';
import { Inventory, HOTBAR_SIZE, TOTAL_SLOTS } from './inventory.js';
import { UI } from './ui.js';
import { Sky } from './sky.js';
import { CreatureManager, Species } from './creatures.js';
import { Audio } from './audio.js';
import { BlockIds, Blocks, getBlock, isSolid } from './blocks.js';
import { ItemIds, getItem, isBlockItem, Recipes } from './items.js';
import { craft as doCraft, canCraft } from './crafting.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL } from './world.js';
import * as Storage from './storage.js';

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = $('game-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance', alpha: false,
    });
    this.renderer.setClearColor(0x8fc0e8);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.settings = Object.assign({
      renderDistance: 6, fov: 75, sensitivity: 100, dayLength: 10,
      invertY: false, forceTouch: false, sound: true,
    }, Storage.loadSettings());

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfe0f7, 40, 150);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 1000);

    this.atlas = buildAtlas();
    this.ui = new UI(this.atlas);
    this.audio = new Audio();
    this.audio.enabled = this.settings.sound;

    this.input = new InputManager(this.canvas, this.ui);
    this.input.sensitivity = 0.0022 * (this.settings.sensitivity / 100);
    this.input.touchSensitivity = 0.0042 * (this.settings.sensitivity / 100);
    this.input.invertY = this.settings.invertY;

    this.inventory = new Inventory();
    this.world = null;
    this.player = null;
    this.creatures = null;
    this.sky = null;

    this.state = 'menu';          // menu | playing | paused | dead
    this.worldMeta = null;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.lastTime = performance.now();
    this.frameTimes = [];
    this.autosaveTimer = 0;
    this.stepTimer = 0;
    this.torchVectors = Array.from({ length: 12 }, () => new THREE.Vector3(0, -999, 0));
    this.pendingSpawnFocus = null;

    this._buildHighlight();
    this._bindUI();
    this._bindInputActions();
    this._applySettingsToUI();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.inventory.onChange(() => {
      this.ui.renderHotbar(this.inventory);
      if (this.ui.isOverlayOpen('inventory')) this.refreshInventoryScreen();
    });
    this.ui.renderHotbar(this.inventory);
    this.ui.showScreen('main');
    this.ui.setTouchVisible(false);

    requestAnimationFrame(() => this.loop());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x0d1420, transparent: true, opacity: 0.85 }));
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);

    // Crack overlay: a translucent box that darkens as the player mines
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false })
    );
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  // ---------------- UI wiring ----------------
  _bindUI() {
    $('menu-play').addEventListener('click', () => this.quickPlay());
    $('menu-create').addEventListener('click', () => { this.audio.click(); this.ui.backTarget = 'main'; this.ui.showScreen('create'); this.prefillCreate(); });
    $('menu-load').addEventListener('click', async () => { this.audio.click(); this.ui.backTarget = 'main'; this.ui.showScreen('load'); this.ui.renderWorldList(await Storage.listWorlds()); });
    $('menu-settings').addEventListener('click', () => { this.audio.click(); this.ui.backTarget = 'main'; this.ui.showScreen('settings'); });
    $('menu-help').addEventListener('click', () => { this.audio.click(); this.ui.backTarget = 'main'; this.ui.showScreen('help'); });

    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', () => {
        this.audio.click();
        if (this.ui.backTarget === 'pause') {
          this.ui.hideAllScreens();
          this.ui.toggleOverlay('pause', true);
        } else {
          this.ui.showScreen('main');
        }
      });
    }

    // Create world screen
    for (const seg of document.querySelectorAll('#create-mode .seg')) {
      seg.addEventListener('click', () => {
        document.querySelectorAll('#create-mode .seg').forEach((s) => s.classList.remove('active'));
        seg.classList.add('active');
        $('mode-hint').textContent = seg.dataset.mode === 'creative'
          ? 'Unlimited blocks, flight, and instant breaking. No health or hunger.'
          : 'Gather resources, craft tools, fend off night creatures.';
        this.audio.click();
      });
    }
    for (const seg of document.querySelectorAll('#create-size .seg')) {
      seg.addEventListener('click', () => {
        document.querySelectorAll('#create-size .seg').forEach((s) => s.classList.remove('active'));
        seg.classList.add('active');
        this.audio.click();
      });
    }
    $('create-start').addEventListener('click', () => this.createWorldFromForm());
    $('load-refresh').addEventListener('click', async () => this.ui.renderWorldList(await Storage.listWorlds()));

    // Settings
    const bind = (id, valId, fmt = (v) => v) => {
      const el = $(id);
      el.addEventListener('input', () => { $(valId).textContent = fmt(el.value); });
    };
    bind('set-render', 'val-render');
    bind('set-fov', 'val-fov');
    bind('set-sens', 'val-sens');
    bind('set-day', 'val-day');
    $('settings-save').addEventListener('click', () => this.saveSettingsFromForm());

    // Pause
    $('pause-resume').addEventListener('click', () => this.resume());
    $('pause-save').addEventListener('click', async () => {
      const ok = await this.saveWorld();
      this.ui.toast(ok ? 'World saved' : 'Could not save world', ok ? '' : 'bad');
    });
    $('pause-settings').addEventListener('click', () => { this.ui.backTarget = 'pause'; this.ui.toggleOverlay('pause', false); this.ui.showScreen('settings'); });
    $('pause-help').addEventListener('click', () => { this.ui.backTarget = 'pause'; this.ui.toggleOverlay('pause', false); this.ui.showScreen('help'); });
    $('pause-quit').addEventListener('click', () => this.quitToMenu(true));

    // Death
    $('death-respawn').addEventListener('click', () => this.respawn());
    $('death-quit').addEventListener('click', () => this.quitToMenu(true));

    // Inventory
    $('inv-close').addEventListener('click', () => this.closeInventory());
    for (const tab of document.querySelectorAll('.inv-tabs .tab')) {
      tab.addEventListener('click', () => {
        this.audio.click();
        this.ui.setInventoryTab(tab.dataset.tab);
        this.refreshInventoryScreen();
      });
    }

    $('fatal-reload').addEventListener('click', () => location.reload());

    // Touch menu buttons
    $('btn-inv')?.addEventListener('click', () => this.toggleInventory('inventory'));
    $('btn-craft')?.addEventListener('click', () => this.toggleInventory('crafting'));
    $('btn-pause')?.addEventListener('click', () => this.pause());

    this.ui.on('selectSlot', (i) => { this.inventory.select(i); this.audio.click(); });
    this.ui.on('slotClick', (i) => this.handleSlotClick(i));
    this.ui.on('paletteClick', (id) => this.handlePaletteClick(id));
    this.ui.on('craft', (r) => this.handleCraft(r));
    this.ui.on('loadWorld', (id) => this.loadWorldById(id));
    this.ui.on('deleteWorld', async (id, name) => {
      if (!confirm(`Delete world "${name}"? This cannot be undone.`)) return;
      await Storage.deleteWorld(id);
      this.ui.renderWorldList(await Storage.listWorlds());
    });
  }

  _bindInputActions() {
    this.input.on('escape', () => {
      if (this.ui.isOverlayOpen('inventory')) { this.closeInventory(); return; }
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && this.ui.isOverlayOpen('pause')) this.resume();
    });
    this.input.on('toggleInventory', () => this.toggleInventory('inventory'));
    this.input.on('toggleCrafting', () => this.toggleInventory('crafting'));
    this.input.on('selectSlot', (i) => this.inventory.select(i));
    this.input.on('scrollSlot', (d) => this.inventory.scrollSelect(d));
    this.input.on('place', () => this.tryPlace());
    this.input.on('tapBreak', () => this.tapBreak());
    this.input.on('pickBlock', () => this.pickBlock());
    this.input.on('dropItem', () => this.dropHeld());
    this.input.on('toggleFly', () => this.toggleFly());
    this.input.on('toggleMode', () => this.toggleMode());
    this.input.on('toggleDebug', () => this.ui.toggleDebug());
    this.input.on('pointerLockChange', (locked) => {
      if (!locked && this.state === 'playing' && !this.ui.isOverlayOpen('inventory')) this.pause();
    });
  }

  _applySettingsToUI() {
    $('set-render').value = this.settings.renderDistance;
    $('val-render').textContent = this.settings.renderDistance;
    $('set-fov').value = this.settings.fov;
    $('val-fov').textContent = this.settings.fov;
    $('set-sens').value = this.settings.sensitivity;
    $('val-sens').textContent = this.settings.sensitivity;
    $('set-day').value = this.settings.dayLength;
    $('val-day').textContent = this.settings.dayLength;
    $('set-invert').checked = this.settings.invertY;
    $('set-touch').checked = this.settings.forceTouch;
    $('set-sound').checked = this.settings.sound;
  }

  saveSettingsFromForm() {
    this.settings.renderDistance = Number($('set-render').value);
    this.settings.fov = Number($('set-fov').value);
    this.settings.sensitivity = Number($('set-sens').value);
    this.settings.dayLength = Number($('set-day').value);
    this.settings.invertY = $('set-invert').checked;
    this.settings.forceTouch = $('set-touch').checked;
    this.settings.sound = $('set-sound').checked;
    Storage.saveSettings(this.settings);

    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.input.sensitivity = 0.0022 * (this.settings.sensitivity / 100);
    this.input.touchSensitivity = 0.0042 * (this.settings.sensitivity / 100);
    this.input.invertY = this.settings.invertY;
    this.audio.enabled = this.settings.sound;
    if (this.sky) this.sky.dayLength = this.settings.dayLength * 60;
    if (this.world) this.updateFogRange();
    this.ui.setTouchVisible(this.state === 'playing' && this.useTouch());

    this.audio.click();
    this.ui.toast('Settings saved');
    if (this.ui.backTarget === 'pause') {
      this.ui.hideAllScreens();
      this.ui.toggleOverlay('pause', true);
    } else {
      this.ui.showScreen('main');
    }
  }

  useTouch() { return this.input.isTouch || this.settings.forceTouch; }

  updateFogRange() {
    const far = this.settings.renderDistance * CHUNK_X * 1.05;
    this.scene.fog.near = far * 0.55;
    this.scene.fog.far = far;
    for (const m of [this.world.material, this.world.waterMaterial]) {
      m.uniforms.uFogNear.value = this.scene.fog.near;
      m.uniforms.uFogFar.value = this.scene.fog.far;
    }
    // The sky dome sits at radius 480, so the far plane must clear it comfortably
    this.camera.far = 700;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- World lifecycle ----------------
  prefillCreate() {
    if (!$('create-name').value) $('create-name').value = randomWorldName();
  }

  async quickPlay() {
    this.audio.init();
    this.audio.click();
    const worlds = await Storage.listWorlds();
    if (worlds.length) {
      this.loadWorldById(worlds[0].id);
    } else {
      this.ui.backTarget = 'main';
      this.ui.showScreen('create');
      this.prefillCreate();
    }
  }

  createWorldFromForm() {
    this.audio.init();
    const name = ($('create-name').value || '').trim() || randomWorldName();
    const seedInput = ($('create-seed').value || '').trim();
    const seed = seedInput || Math.random().toString(36).slice(2, 10);
    const mode = document.querySelector('#create-mode .seg.active')?.dataset.mode || 'survival';
    const radius = Number(document.querySelector('#create-size .seg.active')?.dataset.radius || 6);
    this.settings.renderDistance = radius;
    Storage.saveSettings(this.settings);
    this._applySettingsToUI();

    const meta = {
      id: Storage.newWorldId(), name, seed, mode,
      createdAt: Date.now(), updatedAt: Date.now(),
      time: 0.30, player: null, inventory: null, modifications: null,
    };
    this.startWorld(meta, true);
  }

  async loadWorldById(id) {
    this.audio.init();
    this.ui.showLoading('Loading world…', 'Reading save data');
    const meta = await Storage.loadWorld(id);
    if (!meta) {
      this.ui.hideLoading();
      this.ui.toast('That world could not be loaded', 'bad');
      return;
    }
    this.startWorld(meta, false);
  }

  startWorld(meta, isNew) {
    this.teardownWorld();
    this.worldMeta = meta;
    this.ui.showLoading(isNew ? 'Forging the world…' : 'Loading world…', 'Generating terrain');
    this.ui.hideAllScreens();
    this.ui.toggleOverlay('loading', true);

    this.world = new ChunkManager(this.scene, meta.seed, this.atlas, this.settings);
    this.world.loadModifications(meta.modifications);

    this.sky = new Sky(this.scene, this.renderer);
    this.sky.dayLength = this.settings.dayLength * 60;
    this.sky.setTime(meta.time ?? 0.30);

    this.player = new Player(this.world, this.camera);
    this.player.setMode(meta.mode || 'survival');
    this.creatures = new CreatureManager(this.scene, this.world, this.player);

    this.inventory.clear();
    if (meta.inventory) this.inventory.load(meta.inventory);
    else if (meta.mode === 'creative') this.giveCreativeStarter();

    const startPos = meta.player?.position
      ? new THREE.Vector3().fromArray(meta.player.position)
      : new THREE.Vector3(8.5, SEA_LEVEL + 30, 8.5);
    this.player.position.copy(startPos);
    if (meta.player) this.player.load(meta.player);

    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.updateFogRange();

    this.needsSpawnSnap = !meta.player;
    this.state = 'loading';
    this.loadingChunksTarget = 9;
    $('pause-world-name').textContent = meta.name;
  }

  giveCreativeStarter() {
    for (const id of [BlockIds.GRASS, BlockIds.STONE, BlockIds.PLANKS, BlockIds.GLASS,
                      BlockIds.SAND, BlockIds.WOOD_LOG, BlockIds.LEAVES, BlockIds.TORCH, BlockIds.COBBLESTONE]) {
      this.inventory.add(id, 64);
    }
  }

  finishLoading() {
    if (this.needsSpawnSnap) {
      const spawn = this.world.findSpawn(Math.floor(this.player.position.x), Math.floor(this.player.position.z));
      this.player.position.copy(spawn);
      this.needsSpawnSnap = false;
      this.spawnPoint = spawn.clone();
    } else {
      this.spawnPoint = this.player.position.clone();
    }
    this.ui.hideLoading();
    this.ui.setHudVisible(true);
    this.ui.setTouchVisible(this.useTouch());
    this.state = 'playing';
    this.input.setEnabled(true);
    if (!this.useTouch()) this.input.requestLock();
    this.audio.resume();
    this.ui.renderHotbar(this.inventory);
    this.ui.toast(`Welcome to ${this.worldMeta.name}`);
  }

  teardownWorld() {
    if (this.creatures) { this.creatures.dispose(); this.creatures = null; }
    if (this.world) { this.world.dispose(); this.world = null; }
    if (this.sky) { this.sky.dispose(); this.sky = null; }
    this.player = null;
    this.highlight.visible = false;
    this.crack.visible = false;
  }

  async saveWorld() {
    if (!this.worldMeta || !this.world) return false;
    this.worldMeta.time = this.sky.time;
    this.worldMeta.player = this.player.serialize();
    this.worldMeta.inventory = this.inventory.serialize();
    this.worldMeta.modifications = this.world.serializeModifications();
    this.worldMeta.mode = this.player.mode;
    return Storage.saveWorld(this.worldMeta);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setEnabled(false);
    this.input.exitLock();
    this.ui.toggleOverlay('pause', true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.click();
    this.ui.toggleOverlay('pause', false);
    this.ui.hideAllScreens();
    this.ui.toggleOverlay('pause', false);
    this.state = 'playing';
    this.input.setEnabled(true);
    if (!this.useTouch()) this.input.requestLock();
    this.audio.resume();
  }

  async quitToMenu(save) {
    if (save) await this.saveWorld();
    this.state = 'menu';
    this.input.setEnabled(false);
    this.input.exitLock();
    this.teardownWorld();
    this.ui.toggleOverlay('pause', false);
    this.ui.toggleOverlay('death', false);
    this.ui.toggleOverlay('inventory', false);
    this.ui.setHudVisible(false);
    this.ui.setTouchVisible(false);
    this.ui.showScreen('main');
  }

  die() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.audio.die();
    this.input.setEnabled(false);
    this.input.exitLock();
    this.ui.toggleOverlay('death', true);
  }

  respawn() {
    this.audio.click();
    const spawn = this.spawnPoint || this.world.findSpawn(0, 0);
    this.player.respawn(this.world.findSpawn(Math.floor(spawn.x), Math.floor(spawn.z)));
    if (this.player.mode === 'survival') {
      // Losing half your stack on death keeps survival tense but not punishing
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const s = this.inventory.slots[i];
        if (s && s.count > 1 && Math.random() < 0.5) s.count = Math.max(1, Math.floor(s.count / 2));
      }
      this.inventory.emit();
    }
    this.ui.toggleOverlay('death', false);
    this.state = 'playing';
    this.input.setEnabled(true);
    if (!this.useTouch()) this.input.requestLock();
  }

  // ---------------- Inventory / crafting interactions ----------------
  toggleInventory(tab) {
    if (this.state !== 'playing' && !this.ui.isOverlayOpen('inventory')) return;
    const open = this.ui.isOverlayOpen('inventory');
    if (open) { this.closeInventory(); return; }
    this.audio.click();
    this.ui.setInventoryTab(tab || 'inventory');
    this.ui.toggleOverlay('inventory', true);
    this.refreshInventoryScreen();
    this.input.setEnabled(false);
    this.input.exitLock();
  }

  closeInventory() {
    this.ui.pickedSlot = null;
    this.ui.toggleOverlay('inventory', false);
    if (this.state === 'playing') {
      this.input.setEnabled(true);
      if (!this.useTouch()) this.input.requestLock();
    }
  }

  craftContext() {
    const creative = this.player?.mode === 'creative';
    return {
      creative,
      nearWorkbench: creative || this.blockNearby(BlockIds.WORKBENCH),
      nearFurnace: creative || this.blockNearby(BlockIds.FURNACE),
    };
  }

  blockNearby(id, radius = 4) {
    if (!this.player || !this.world) return false;
    const p = this.player.position;
    const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
    for (let x = cx - radius; x <= cx + radius; x++)
      for (let y = Math.max(0, cy - 3); y <= Math.min(CHUNK_Y - 1, cy + 3); y++)
        for (let z = cz - radius; z <= cz + radius; z++)
          if (this.world.getBlock(x, y, z) === id) return true;
    return false;
  }

  refreshInventoryScreen() {
    const ctx = this.craftContext();
    this.ui.renderInventory(this.inventory, ctx);
    this.ui.renderCrafting(this.inventory, ctx);
  }

  handleSlotClick(index) {
    this.audio.click();
    if (this.ui.pickedSlot === null) {
      if (!this.inventory.slots[index]) return;
      this.ui.pickedSlot = index;
    } else if (this.ui.pickedSlot === index) {
      this.ui.pickedSlot = null;
    } else {
      this.inventory.moveOrMerge(this.ui.pickedSlot, index);
      this.ui.pickedSlot = null;
    }
    this.refreshInventoryScreen();
  }

  handlePaletteClick(id) {
    const item = getItem(id);
    this.inventory.add(id, item?.stack > 1 ? 64 : 1);
    this.audio.pickup();
    this.refreshInventoryScreen();
  }

  handleCraft(recipe) {
    const ok = doCraft(recipe, this.inventory, this.craftContext());
    if (ok) {
      this.audio.craft();
      this.ui.toast(`Crafted ${getItem(recipe.out.id)?.name}`);
    } else {
      this.ui.toast('Missing ingredients', 'warn');
    }
    this.refreshInventoryScreen();
  }

  dropHeld() {
    const held = this.inventory.held;
    if (!held) return;
    const name = getItem(held.id)?.name;
    this.inventory.consumeHeld(1);
    this.ui.toast(`Dropped ${name}`, 'warn');
  }

  pickBlock() {
    const hit = this.player.raycast(7);
    if (!hit.hit) return;
    const id = hit.id;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.inventory.slots[i]?.id === id) { this.inventory.select(i); return; }
    }
    if (this.player.mode === 'creative') {
      const empty = this.inventory.slots.findIndex((s, i) => i < HOTBAR_SIZE && !s);
      const target = empty >= 0 ? empty : this.inventory.selected;
      this.inventory.slots[target] = { id, count: 64 };
      this.inventory.select(target);
      this.inventory.emit();
    }
  }

  toggleFly() {
    if (!this.player) return;
    if (this.player.mode !== 'creative') {
      this.ui.toast('Flight is creative-mode only', 'warn');
      return;
    }
    this.player.flying = !this.player.flying;
    if (this.player.flying) this.player.velocity.y = 0;
    this.ui.toast(this.player.flying ? 'Flight enabled' : 'Flight disabled');
    this.audio.click();
  }

  toggleMode() {
    if (!this.player) return;
    const next = this.player.mode === 'creative' ? 'survival' : 'creative';
    this.player.setMode(next);
    if (next === 'creative' && this.inventory.slots.every((s) => !s)) this.giveCreativeStarter();
    this.ui.toast(`Switched to ${next} mode`);
    this.audio.click();
  }

  // ---------------- Block interaction ----------------
  tapBreak() {
    // Touch tap: mine instantly if creative, otherwise start a short break burst
    const hit = this.player.raycast(6);
    if (!hit.hit) return;
    if (this.player.mode === 'creative') this.breakBlockAt(hit);
    else {
      this.breakTarget = `${hit.x},${hit.y},${hit.z}`;
      this.breakProgress = Math.min(1, this.breakProgress + 0.34);
      if (this.breakProgress >= 1) this.breakBlockAt(hit);
      this.audio.crunch(0.07, 0.18, 800);
    }
  }

  breakBlockAt(hit) {
    const block = getBlock(hit.id);
    const dropId = block.drop !== undefined ? block.drop : hit.id;
    this.world.setBlock(hit.x, hit.y, hit.z, BlockIds.AIR);
    this.audio.breakBlock(hit.id);
    this.breakProgress = 0;
    this.breakTarget = null;

    if (this.player.mode === 'survival') {
      if (block.collectible) {
        const left = this.inventory.add(dropId, 1);
        if (left > 0) this.ui.toast('Inventory full', 'warn');
        else this.audio.pickup();
      }
      const held = this.inventory.held;
      if (held && getItem(held.id)?.tool) this.inventory.damageHeld(1);
    }
    // Foliage above a broken log falls away so trees don't float
    if (hit.id === BlockIds.WOOD_LOG) this.decayLeavesAround(hit.x, hit.y, hit.z);
  }

  decayLeavesAround(x, y, z) {
    for (let dy = 0; dy <= 5; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (this.world.getBlock(x + dx, y + dy, z + dz) === BlockIds.LEAVES && Math.random() < 0.35) {
            this.world.setBlock(x + dx, y + dy, z + dz, BlockIds.AIR);
          }
        }
      }
    }
  }

  tryPlace() {
    if (this.state !== 'playing') return;
    const held = this.inventory.held;
    if (!held) return;

    // Right-click food = eat
    const item = getItem(held.id);
    if (item?.food) {
      if (this.player.hunger >= this.player.maxHunger) { this.ui.toast('Not hungry', 'warn'); return; }
      this.player.eat(item.food);
      if (this.player.mode === 'survival') this.inventory.consumeHeld(1);
      this.audio.blip(420, 0.14, 0.2);
      this.ui.toast(`Ate ${item.name}`);
      return;
    }
    if (!isBlockItem(held.id)) return;

    const hit = this.player.raycast(6);
    if (!hit.hit) return;
    const nx = hit.x + hit.normal[0];
    const ny = hit.y + hit.normal[1];
    const nz = hit.z + hit.normal[2];
    if (ny < 0 || ny >= CHUNK_Y) return;

    const existing = this.world.getBlock(nx, ny, nz);
    if (existing !== BlockIds.AIR && existing !== BlockIds.WATER) return;
    if (this.blockIntersectsPlayer(nx, ny, nz) && Blocks[held.id].solid) {
      this.ui.toast("You're standing there", 'warn');
      return;
    }

    if (this.world.setBlock(nx, ny, nz, held.id)) {
      this.audio.placeBlock();
      if (this.player.mode === 'survival') this.inventory.consumeHeld(1);
    }
  }

  blockIntersectsPlayer(x, y, z) {
    const p = this.player.position;
    const half = 0.3;
    return (x + 1 > p.x - half && x < p.x + half &&
            y + 1 > p.y && y < p.y + this.player.height &&
            z + 1 > p.z - half && z < p.z + half);
  }

  attackCreature(creature) {
    const held = this.inventory.held;
    const item = held ? getItem(held.id) : null;
    const damage = item?.damage || 1;
    const drops = this.creatures.hurt(creature, damage, this.player.position);
    this.audio.hit();
    if (item?.tool === 'sword') this.inventory.damageHeld(1);
    if (drops) {
      for (const d of drops) {
        if (this.player.mode === 'survival') this.inventory.add(d.id, d.count);
      }
      this.ui.toast(`Defeated ${creature.species.name}`);
    }
    this.player.attackCooldown = 0.32;
  }

  // ---------------- Main loop ----------------
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.1); // clamp so tab-switches don't teleport the player

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    try {
      if (this.state === 'loading') this.updateLoading(dt);
      else if (this.state === 'playing') this.updatePlaying(dt);
      else if (this.world) {
        // Keep the world ticking gently while paused so the scene stays warm
        this.world.update(2);
        this.sky.update(0, this.camera.position);
      }
      if (this.world) this.renderer.render(this.scene, this.camera);
      else this.renderMenuBackdrop();
    } catch (err) {
      console.error(err);
      this.ui.fatal(String(err?.stack || err));
      this.state = 'menu';
    }
  }

  renderMenuBackdrop() {
    this.renderer.clear();
  }

  updateLoading(dt) {
    const r = this.settings.renderDistance;
    this.world.requestArea(this.player.position.x, this.player.position.z, Math.min(r, 3));
    this.world.update(12);
    this.sky.update(dt, this.camera.position);
    const ready = this.world.chunks.size;
    this.ui.updateLoading(`Generated ${ready} chunks`);
    if (ready >= this.loadingChunksTarget && this.world.meshQueue.length === 0) {
      this.finishLoading();
    }
  }

  updatePlaying(dt) {
    const input = this.input;
    input.tick();

    // Look
    const look = input.consumeLook();
    this.player.yaw -= look.x;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this.player.pitch - look.y));

    const wasHealth = this.player.health;
    this.player.update(dt, input.state);
    this.player.applyToCamera();

    if (this.player.health < wasHealth) { this.ui.flashDamage(); this.audio.hurt(); }
    if (this.player.dead) { this.die(); return; }

    // Footstep audio
    if (this.player.onGround && Math.hypot(this.player.velocity.x, this.player.velocity.z) > 1.4) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = this.player.sprinting ? 0.28 : 0.42;
        this.audio.step();
      }
    }

    // Stream chunks around the player
    this.world.requestArea(this.player.position.x, this.player.position.z, this.settings.renderDistance);
    this.world.update(6);

    // Sky + shader uniforms
    this.sky.update(dt, this.camera.position);
    this.sky.applyTo([this.world.material, this.world.waterMaterial]);
    const torchCount = this.world.collectTorches(this.player.position, this.torchVectors);
    const underwater = this.player.isHeadUnderwater() ? 1 : 0;
    for (const m of [this.world.material, this.world.waterMaterial]) {
      m.uniforms.uTorchCount.value = torchCount;
      m.uniforms.uTorchPos.value = this.torchVectors;
      m.uniforms.uUnderwater.value = underwater;
      m.uniforms.uTime.value += dt;
    }
    this.renderer.setClearColor(this.sky.horizonColor);

    // Creatures
    this.creatures.update(dt, this.sky.isNight, () => { this.ui.flashDamage(); this.audio.hurt(); });

    this.updateTargeting(dt);

    this.ui.updateStats(this.player, this.sky);

    // Autosave every 45 seconds of play
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 45) {
      this.autosaveTimer = 0;
      this.saveWorld().then((ok) => { if (ok) this.ui.toast('Autosaved'); });
    }

    if (!$('debug-panel').classList.contains('hidden')) this.updateDebug();
  }

  updateTargeting(dt) {
    const hit = this.player.raycast(6);
    const eye = this.player.eyePosition;
    const dir = new THREE.Vector3(
      -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
    ).normalize();
    const creature = this.creatures.raycast(eye, dir, hit.hit ? hit.distance : 4.2);

    this.ui.setCrosshairTarget(hit.hit || !!creature);

    if (hit.hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    if (!this.input.state.breaking) {
      this.breakProgress = 0;
      this.breakTarget = null;
      this.crack.visible = false;
      this.ui.setBreakProgress(0);
      return;
    }

    // Attacking a creature takes priority over mining
    if (creature && this.player.attackCooldown <= 0) {
      this.attackCreature(creature);
      return;
    }

    if (!hit.hit) { this.breakProgress = 0; this.crack.visible = false; this.ui.setBreakProgress(0); return; }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.breakTarget !== key) { this.breakTarget = key; this.breakProgress = 0; }

    const time = this.player.breakTime(hit.id, this.inventory.held);
    if (time === Infinity) {
      this.crack.visible = false;
      this.ui.setBreakProgress(0);
      if (!this._toolWarned || performance.now() - this._toolWarned > 2500) {
        this._toolWarned = performance.now();
        this.ui.toast(`Need a stronger pickaxe for ${getBlock(hit.id).name}`, 'warn');
      }
      return;
    }

    this.breakProgress += dt / Math.max(0.05, time);
    if (this.breakProgress >= 1) {
      this.breakBlockAt(hit);
      this.ui.setBreakProgress(0);
      this.crack.visible = false;
      return;
    }

    this.crack.visible = true;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.material.opacity = this.breakProgress * 0.62;
    this.ui.setBreakProgress(this.breakProgress);

    // Mining sound ticks
    this._mineTick = (this._mineTick || 0) - dt;
    if (this._mineTick <= 0) { this._mineTick = 0.22; this.audio.crunch(0.06, 0.14, 700); }
  }

  updateDebug() {
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const p = this.player.position;
    let tris = 0;
    for (const c of this.world.chunks.values()) {
      if (c.mesh) tris += c.mesh.geometry.attributes.position.count / 3;
    }
    this.ui.setDebug([
      `FPS ${(1 / avg).toFixed(0)}  (${(avg * 1000).toFixed(1)} ms)`,
      `XYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
      `Chunk ${Math.floor(p.x / CHUNK_X)}, ${Math.floor(p.z / CHUNK_Z)}`,
      `Chunks ${this.world.chunks.size}  queue ${this.world.genQueue.length}/${this.world.meshQueue.length}`,
      `Tris ${(tris / 1000).toFixed(1)}k  draws ${this.renderer.info.render.calls}`,
      `Creatures ${this.creatures.creatures.length}`,
      `Time ${this.sky.clockLabel}  ${this.sky.isNight ? 'night' : 'day'}`,
      `Mode ${this.player.mode}${this.player.flying ? ' (flying)' : ''}`,
      `Seed ${this.worldMeta.seed}`,
    ]);
  }
}

const WORLD_NAME_PARTS_A = ['Amber', 'Hollow', 'Quiet', 'Iron', 'Verdant', 'Frost', 'Sunken', 'Bright', 'Wandering', 'Elder'];
const WORLD_NAME_PARTS_B = ['Basin', 'Ridge', 'Expanse', 'Hollow', 'Reach', 'Vale', 'Shore', 'Peaks', 'Meadows', 'Deep'];
function randomWorldName() {
  const a = WORLD_NAME_PARTS_A[Math.floor(Math.random() * WORLD_NAME_PARTS_A.length)];
  const b = WORLD_NAME_PARTS_B[Math.floor(Math.random() * WORLD_NAME_PARTS_B.length)];
  return `${a} ${b}`;
}

window.addEventListener('error', (e) => {
  const el = document.getElementById('fatal-msg');
  if (el && !el.textContent) {
    el.textContent = String(e.message || e.error);
    document.getElementById('fatal-error')?.classList.remove('hidden');
  }
});

try {
  window.game = new Game();
  // Debug/modding handle: lets you poke at the registries from the browser console.
  window.Blockforge = { THREE, Blocks, BlockIds, Items: getItem, Recipes, canCraft, Species, ItemIds };
} catch (err) {
  document.getElementById('fatal-msg').textContent = String(err?.stack || err);
  document.getElementById('fatal-error').classList.remove('hidden');
}
