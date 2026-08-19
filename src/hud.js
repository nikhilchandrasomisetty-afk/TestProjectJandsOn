import { blockName, defOf, RECIPES } from "./blocks.js";
import { tileToDataURL } from "./textures.js";
import { HOTBAR_SLOTS } from "./inventory.js";
import { MAX_HEALTH, BREATH_SECONDS } from "./player.js";

const iconCache = new Map();

// Block icons are the atlas tile for the block's side face, scaled up with
// nearest-neighbour so they stay crisp.
export function blockIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const def = defOf(id);
  const tile = def.tiles ? def.tiles[4] : 0;
  const url = tileToDataURL(tile, 48);
  iconCache.set(id, url);
  return url;
}

export class HUD {
  constructor(refs, { inventory, player, world, sky, audio }) {
    this.refs = refs;
    this.inventory = inventory;
    this.player = player;
    this.world = world;
    this.sky = sky;
    this.audio = audio;

    this.debugVisible = false;
    this.inventoryOpen = false;
    this.toastTimer = null;
    this.dragFrom = null;

    this._buildHotbar();
    this._buildVitals();
    this._buildInventory();

    inventory.onChange = () => {
      this.renderHotbar();
      if (this.inventoryOpen) this.renderInventory();
    };
  }

  // --- construction ---------------------------------------------------------

  _buildHotbar() {
    const bar = this.refs.hotbar;
    bar.innerHTML = "";
    this.hotbarSlots = [];

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = document.createElement("button");
      slot.className = "slot";
      slot.type = "button";
      slot.setAttribute("aria-label", `Hotbar slot ${i + 1}`);

      const img = document.createElement("img");
      img.className = "slot-icon";
      img.alt = "";
      slot.appendChild(img);

      const count = document.createElement("span");
      count.className = "slot-count";
      slot.appendChild(count);

      const key = document.createElement("span");
      key.className = "slot-key";
      key.textContent = i + 1;
      slot.appendChild(key);

      slot.addEventListener("click", () => this.inventory.select(i));
      bar.appendChild(slot);
      this.hotbarSlots.push({ slot, img, count });
    }
    this.renderHotbar();
  }

  _buildVitals() {
    this.healthPips = [];
    this.breathPips = [];

    for (let i = 0; i < 10; i++) {
      const pip = document.createElement("i");
      pip.className = "pip pip-health";
      this.refs.health.appendChild(pip);
      this.healthPips.push(pip);
    }
    for (let i = 0; i < 10; i++) {
      const pip = document.createElement("i");
      pip.className = "pip pip-breath";
      this.refs.breath.appendChild(pip);
      this.breathPips.push(pip);
    }
  }

  _buildInventory() {
    const grid = this.refs.invGrid;
    grid.innerHTML = "";
    this.invSlots = [];

    for (let i = 0; i < this.inventory.slots.length; i++) {
      const slot = document.createElement("button");
      slot.className = "slot inv-slot" + (i < HOTBAR_SLOTS ? " inv-slot-hotbar" : "");
      slot.type = "button";

      const img = document.createElement("img");
      img.className = "slot-icon";
      img.alt = "";
      slot.appendChild(img);

      const count = document.createElement("span");
      count.className = "slot-count";
      slot.appendChild(count);

      slot.addEventListener("click", () => this._onInventorySlotClick(i));
      grid.appendChild(slot);
      this.invSlots.push({ slot, img, count });
    }

    this._buildRecipes();
  }

  _buildRecipes() {
    const list = this.refs.recipes;
    list.innerHTML = "";
    this.recipeRows = [];

    RECIPES.forEach((recipe, i) => {
      const row = document.createElement("button");
      row.className = "recipe";
      row.type = "button";

      const out = document.createElement("img");
      out.className = "recipe-out";
      out.src = blockIcon(recipe.out);
      out.alt = "";
      row.appendChild(out);

      const text = document.createElement("div");
      text.className = "recipe-text";

      const title = document.createElement("strong");
      title.textContent = `${recipe.count}× ${blockName(recipe.out)}`;
      text.appendChild(title);

      const cost = document.createElement("small");
      cost.textContent = Object.entries(recipe.in)
        .map(([id, n]) => `${n}× ${blockName(Number(id))}`)
        .join(" + ");
      text.appendChild(cost);

      row.appendChild(text);
      row.addEventListener("click", () => this._onCraft(i));
      list.appendChild(row);
      this.recipeRows.push(row);
    });
  }

  // --- interaction ----------------------------------------------------------

  _onInventorySlotClick(index) {
    if (this.dragFrom === null) {
      if (this.inventory.slots[index]) {
        this.dragFrom = index;
        this.renderInventory();
      }
      return;
    }
    this.inventory.swap(this.dragFrom, index);
    this.dragFrom = null;
    this.renderInventory();
  }

  _onCraft(index) {
    const recipe = RECIPES[index];
    if (this.inventory.craft(recipe)) {
      this.audio.playCraft();
      this.toast(`Crafted ${recipe.count}× ${blockName(recipe.out)}`);
    } else {
      this.toast("Not enough materials");
    }
    this.renderInventory();
  }

  // --- rendering ------------------------------------------------------------

  renderHotbar() {
    for (let i = 0; i < this.hotbarSlots.length; i++) {
      const { slot, img, count } = this.hotbarSlots[i];
      const stack = this.inventory.slots[i];
      slot.classList.toggle("is-selected", i === this.inventory.selected);

      if (stack) {
        img.src = blockIcon(stack.id);
        img.style.visibility = "visible";
        count.textContent = this.inventory.creative ? "" : stack.count;
      } else {
        img.style.visibility = "hidden";
        count.textContent = "";
      }
    }

    const stack = this.inventory.selectedStack;
    this.refs.heldName.textContent = stack ? blockName(stack.id) : "Empty hand";
    this.refs.heldName.classList.toggle("is-empty", !stack);
  }

  renderInventory() {
    for (let i = 0; i < this.invSlots.length; i++) {
      const { slot, img, count } = this.invSlots[i];
      const stack = this.inventory.slots[i];
      slot.classList.toggle("is-picked", this.dragFrom === i);

      if (stack) {
        img.src = blockIcon(stack.id);
        img.style.visibility = "visible";
        count.textContent = stack.count;
        slot.title = blockName(stack.id);
      } else {
        img.style.visibility = "hidden";
        count.textContent = "";
        slot.title = "";
      }
    }

    RECIPES.forEach((recipe, i) => {
      this.recipeRows[i].classList.toggle("is-ready", this.inventory.canCraft(recipe));
    });
  }

  renderVitals() {
    const health = this.player.health;
    for (let i = 0; i < this.healthPips.length; i++) {
      const value = health - i * 2;
      this.healthPips[i].dataset.state = value >= 2 ? "full" : value >= 1 ? "half" : "empty";
    }

    const showBreath = this.player.headInWater || this.player.breath < BREATH_SECONDS - 0.1;
    this.refs.breath.classList.toggle("is-hidden", !showBreath);
    if (showBreath) {
      const ratio = this.player.breath / BREATH_SECONDS;
      for (let i = 0; i < this.breathPips.length; i++) {
        this.breathPips[i].dataset.state = ratio * 10 > i ? "full" : "empty";
      }
    }
  }

  renderDebug(fps, target) {
    if (!this.debugVisible) return;
    const p = this.player.position;
    const lines = [
      `${fps.toFixed(0)} fps`,
      `xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
      `biome ${this.world.biomeNameAt(Math.floor(p.x), Math.floor(p.z))}`,
      `time ${this.sky.clockLabel}`,
      `chunks ${this.world.stats.chunks} loaded`,
      `looking at ${target ? `${blockName(target.id)} (${target.x} ${target.y} ${target.z})` : "—"}`,
      `mode ${this.inventory.creative ? "creative" : "survival"}${this.player.flying ? " · flying" : ""}`,
    ];
    this.refs.debug.textContent = lines.join("\n");
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.refs.debug.classList.toggle("is-hidden", !this.debugVisible);
    return this.debugVisible;
  }

  openInventory() {
    this.inventoryOpen = true;
    this.dragFrom = null;
    this.renderInventory();
    this.refs.inventory.classList.remove("is-hidden");
  }

  closeInventory() {
    this.inventoryOpen = false;
    this.dragFrom = null;
    this.refs.inventory.classList.add("is-hidden");
  }

  toast(message) {
    const el = this.refs.toast;
    el.textContent = message;
    el.classList.remove("is-hidden");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add("is-hidden"), 1800);
  }

  flashDamage() {
    const el = this.refs.damageFlash;
    el.classList.remove("is-active");
    // Force a reflow so the animation restarts on rapid consecutive hits.
    void el.offsetWidth;
    el.classList.add("is-active");
  }

  showDeath(show) {
    this.refs.death.classList.toggle("is-hidden", !show);
  }

  setUnderwater(active) {
    this.refs.underwater.classList.toggle("is-active", active);
  }

  setStatus(text) {
    this.refs.status.textContent = text;
  }
}
