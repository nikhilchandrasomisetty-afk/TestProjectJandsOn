import { Blocks, BlockIds, getBlock } from './blocks.js';
import { Items, ItemIds, getItem, drawItemIcon, isBlockItem } from './items.js';
import { HOTBAR_SIZE, TOTAL_SLOTS } from './inventory.js';
import { Recipes } from './items.js';
import { canCraft, missingFor } from './crafting.js';

const $ = (id) => document.getElementById(id);

// Central UI controller: owns every screen, the HUD, and the item-icon cache.
export class UI {
  constructor(atlas) {
    this.atlas = atlas;
    this.iconCache = new Map();
    this.screens = {
      main: $('main-menu'),
      create: $('create-screen'),
      load: $('load-screen'),
      settings: $('settings-screen'),
      help: $('help-screen'),
      pause: $('pause-screen'),
      death: $('death-screen'),
      inventory: $('inventory-screen'),
      loading: $('loading-screen'),
      fatal: $('fatal-error'),
    };
    this.hud = $('hud');
    this.hotbarEl = $('hotbar');
    this.pickedSlot = null;
    this.backTarget = 'main';
    this.handlers = {};
    this._buildHotbar();
  }

  on(name, fn) { this.handlers[name] = fn; }
  fire(name, ...a) { if (this.handlers[name]) this.handlers[name](...a); }

  icon(id) {
    if (this.iconCache.has(id)) return this.iconCache.get(id);
    let url;
    if (isBlockItem(id)) url = this.atlas.blockIcon(id, 48);
    else url = drawItemIcon(Items[id] || { icon: 'lump', color: '#888' }, 48);
    this.iconCache.set(id, url);
    return url;
  }

  showScreen(name) {
    for (const [k, el] of Object.entries(this.screens)) {
      if (!el) continue;
      const overlayScreens = ['pause', 'death', 'inventory', 'loading', 'fatal'];
      if (overlayScreens.includes(k)) continue;
      el.classList.toggle('hidden', k !== name);
    }
    this.currentScreen = name;
  }

  hideAllScreens() {
    for (const el of Object.values(this.screens)) el?.classList.add('hidden');
  }

  toggleOverlay(name, show) {
    const el = this.screens[name];
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  isOverlayOpen(name) {
    return this.screens[name] && !this.screens[name].classList.contains('hidden');
  }

  setHudVisible(v) { this.hud.classList.toggle('hidden', !v); }

  setTouchVisible(v) { $('touch-controls').classList.toggle('hidden', !v); }

  // ---------------- HUD ----------------
  _buildHotbar() {
    this.hotbarEl.innerHTML = '';
    this.hotSlots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'hotslot';
      el.innerHTML = `<span class="idx">${i + 1}</span><div class="break-ring"></div>`;
      el.addEventListener('click', () => this.fire('selectSlot', i));
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.fire('selectSlot', i); }, { passive: false });
      this.hotbarEl.appendChild(el);
      this.hotSlots.push(el);
    }
  }

  renderHotbar(inventory) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.hotSlots[i];
      const slot = inventory.slots[i];
      el.classList.toggle('selected', i === inventory.selected);
      const keep = el.querySelector('.break-ring');
      el.innerHTML = `<span class="idx">${i + 1}</span>`;
      el.appendChild(keep);
      if (slot) {
        const img = document.createElement('img');
        img.src = this.icon(slot.id);
        img.alt = '';
        el.appendChild(img);
        if (slot.count > 1) {
          const c = document.createElement('span');
          c.className = 'count'; c.textContent = slot.count;
          el.appendChild(c);
        }
        if (slot.durability !== undefined) {
          const max = getItem(slot.id)?.durability || 1;
          const d = document.createElement('div');
          d.className = 'dura';
          d.innerHTML = `<i style="width:${Math.max(0, (slot.durability / max) * 100)}%"></i>`;
          el.appendChild(d);
        }
      }
    }
    const held = inventory.held;
    const nameEl = $('held-name');
    const name = held ? getItem(held.id)?.name || '' : '';
    if (name !== this._lastHeldName) {
      nameEl.textContent = name;
      nameEl.classList.add('show');
      clearTimeout(this._heldTimer);
      this._heldTimer = setTimeout(() => nameEl.classList.remove('show'), 1600);
      this._lastHeldName = name;
    }
  }

  setBreakProgress(p) {
    for (const el of this.hotSlots) {
      const ring = el.querySelector('.break-ring');
      if (ring) ring.style.setProperty('--p', el.classList.contains('selected') ? `${p * 100}%` : '0%');
    }
  }

  updateStats(player, sky) {
    $('health-fill').style.width = `${(player.health / player.maxHealth) * 100}%`;
    $('hunger-fill').style.width = `${(player.hunger / player.maxHunger) * 100}%`;
    $('stamina-fill').style.width = `${player.stamina * 100}%`;
    const breathRow = $('breath-row');
    const underwater = player.breathe < 9.9;
    breathRow.classList.toggle('hidden', !underwater);
    if (underwater) $('breath-fill').style.width = `${(player.breathe / 10) * 100}%`;

    const survival = player.mode === 'survival';
    $('health-row').classList.toggle('hidden', !survival);
    $('hunger-row').classList.toggle('hidden', !survival);

    $('clock-time').textContent = sky.clockLabel;
    $('clock-icon').textContent = sky.isNight ? '☾' : '☀';
    const chip = $('mode-chip');
    chip.textContent = player.mode.toUpperCase();
    chip.classList.toggle('creative', player.mode === 'creative');
  }

  setCrosshairTarget(on) {
    $('crosshair').classList.toggle('on-target', on);
  }

  flashDamage() {
    const el = $('damage-flash');
    el.classList.add('show');
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => el.classList.remove('show'), 180);
  }

  toast(text, kind = '') {
    const stack = $('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    while (stack.children.length > 4) stack.firstChild.remove();
  }

  setDebug(lines) {
    const el = $('debug-panel');
    el.textContent = lines.join('\n');
  }

  toggleDebug() {
    $('debug-panel').classList.toggle('hidden');
  }

  showLoading(title, sub) {
    $('loading-title').textContent = title;
    $('loading-sub').textContent = sub || '';
    this.toggleOverlay('loading', true);
  }
  updateLoading(sub) { $('loading-sub').textContent = sub; }
  hideLoading() { this.toggleOverlay('loading', false); }

  fatal(msg) {
    $('fatal-msg').textContent = msg;
    this.toggleOverlay('fatal', true);
  }

  // ---------------- Inventory ----------------
  renderInventory(inventory, ctx) {
    const grid = $('inv-grid');
    const hot = $('inv-hotbar');
    grid.innerHTML = '';
    hot.innerHTML = '';

    const makeSlot = (index) => {
      const slot = inventory.slots[index];
      const el = document.createElement('div');
      el.className = 'slot';
      if (this.pickedSlot === index) el.classList.add('picked');
      if (slot) {
        const item = getItem(slot.id);
        el.title = item?.name || '';
        el.innerHTML = `<img src="${this.icon(slot.id)}" alt="">`;
        if (slot.count > 1) el.insertAdjacentHTML('beforeend', `<span class="count">${slot.count}</span>`);
        if (slot.durability !== undefined) {
          const max = item?.durability || 1;
          el.insertAdjacentHTML('beforeend', `<div class="dura"><i style="width:${(slot.durability / max) * 100}%"></i></div>`);
        }
      }
      el.addEventListener('click', () => this.fire('slotClick', index));
      return el;
    };

    for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) grid.appendChild(makeSlot(i));
    for (let i = 0; i < HOTBAR_SIZE; i++) hot.appendChild(makeSlot(i));

    const section = $('creative-palette-section');
    section.classList.toggle('hidden', !ctx.creative);
    if (ctx.creative) this.renderCreativePalette();
  }

  renderCreativePalette() {
    const pal = $('creative-palette');
    if (pal.dataset.built === '1') return;
    pal.dataset.built = '1';
    pal.innerHTML = '';
    const ids = Object.keys(Blocks).map(Number).filter((id) => id !== BlockIds.AIR && id !== BlockIds.WATER);
    const itemIds = Object.values(ItemIds);
    for (const id of [...ids, ...itemIds]) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.title = getItem(id)?.name || '';
      el.innerHTML = `<img src="${this.icon(id)}" alt="">`;
      el.addEventListener('click', () => this.fire('paletteClick', id));
      pal.appendChild(el);
    }
  }

  // ---------------- Crafting ----------------
  renderCrafting(inventory, ctx) {
    const list = $('recipe-list');
    list.innerHTML = '';
    const status = $('craft-status');
    const bits = [];
    if (ctx.creative) bits.push('Creative mode — everything is craftable.');
    else {
      bits.push(ctx.nearWorkbench ? 'Workbench nearby: full recipe list unlocked.' : 'Place a Workbench nearby to unlock advanced recipes.');
      if (ctx.nearFurnace) bits.push('Furnace nearby: smelting available.');
    }
    status.textContent = bits.join(' ');
    status.classList.toggle('ready', ctx.creative || ctx.nearWorkbench);

    for (const r of Recipes) {
      const ok = canCraft(r, inventory, ctx);
      const locked = r.bench && !ctx.nearWorkbench;
      const row = document.createElement('div');
      row.className = 'recipe' + (ok ? ' craftable' : '') + (locked ? ' locked' : '');
      const outItem = getItem(r.out.id);

      const ingList = r.smelt
        ? [r.smelt, { id: ItemIds.COAL, count: 1 }]
        : r.shapeless;
      const missing = missingFor(r, inventory);
      const missingIds = new Set(missing.map((m) => m.id));
      const ingText = ingList.map((ing) => {
        const nm = getItem(ing.id)?.name || '?';
        const have = inventory.countOf(ing.id);
        const cls = !ctx.creative && missingIds.has(ing.id) ? 'miss' : '';
        return `<span class="${cls}">${ing.count}× ${nm} (${have})</span>`;
      }).join(', ');

      const needsNote = r.smelt && !ctx.nearFurnace ? ' — needs a Furnace nearby'
        : locked ? ' — needs a Workbench' : '';

      row.innerHTML = `
        <img class="rimg" src="${this.icon(r.out.id)}" alt="">
        <div class="rinfo">
          <div class="rname">${outItem?.name || '?'} ×${r.out.count}</div>
          <div class="ring">${ingText}${needsNote}</div>
        </div>`;
      const btn = document.createElement('button');
      btn.className = 'rbtn';
      btn.textContent = r.smelt ? 'SMELT' : 'CRAFT';
      btn.disabled = !ok;
      btn.addEventListener('click', () => this.fire('craft', r));
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  setInventoryTab(tab) {
    for (const el of document.querySelectorAll('.inv-tabs .tab')) {
      el.classList.toggle('active', el.dataset.tab === tab);
    }
    $('tab-inventory').classList.toggle('hidden', tab !== 'inventory');
    $('tab-crafting').classList.toggle('hidden', tab !== 'crafting');
  }

  // ---------------- World list ----------------
  renderWorldList(worlds) {
    const list = $('world-list');
    list.innerHTML = '';
    if (!worlds.length) {
      list.innerHTML = '<p class="empty-note">No saved worlds yet.<br>Use <b>CREATE WORLD</b> to start one.</p>';
      return;
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const when = w.updatedAt ? new Date(w.updatedAt).toLocaleString() : 'never saved';
      row.innerHTML = `
        <div class="info">
          <div class="wname"></div>
          <div class="wmeta">${w.mode || 'survival'} · seed ${escapeHtml(String(w.seed))} · saved ${escapeHtml(when)}</div>
        </div>`;
      row.querySelector('.wname').textContent = w.name;
      const play = document.createElement('button');
      play.className = 'btn primary';
      play.textContent = 'PLAY';
      play.addEventListener('click', () => this.fire('loadWorld', w.id));
      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'DELETE';
      del.addEventListener('click', () => this.fire('deleteWorld', w.id, w.name));
      row.appendChild(play);
      row.appendChild(del);
      list.appendChild(row);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
