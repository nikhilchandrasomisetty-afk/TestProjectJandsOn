import { BLOCKS, RECIPES, defOf } from "./blocks.js";

export const HOTBAR_SLOTS = 9;
export const STORAGE_SLOTS = 27;
export const STACK_MAX = 64;

// Slots 0..8 are the hotbar; the rest is backpack storage. Both share one
// array so stack merging and crafting can treat the inventory uniformly.
export class Inventory {
  constructor({ creative = false } = {}) {
    this.slots = new Array(HOTBAR_SLOTS + STORAGE_SLOTS).fill(null);
    this.selected = 0;
    this.creative = creative;
    this.onChange = null;
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  select(index) {
    if (index < 0 || index >= HOTBAR_SLOTS) return;
    this.selected = index;
    this.onChange?.();
  }

  cycle(direction) {
    this.selected = (this.selected + direction + HOTBAR_SLOTS) % HOTBAR_SLOTS;
    this.onChange?.();
  }

  count(id) {
    let total = 0;
    for (const slot of this.slots) if (slot && slot.id === id) total += slot.count;
    return total;
  }

  // Adds up to `count` items, returning how many did not fit.
  add(id, count = 1) {
    if (id === BLOCKS.AIR || count <= 0) return 0;
    let remaining = count;

    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot && slot.id === id && slot.count < STACK_MAX) {
        const room = STACK_MAX - slot.count;
        const moved = Math.min(room, remaining);
        slot.count += moved;
        remaining -= moved;
      }
    }

    // Prefer empty hotbar slots so picked-up blocks are immediately usable.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (this.slots[i] === null) {
        const moved = Math.min(STACK_MAX, remaining);
        this.slots[i] = { id, count: moved };
        remaining -= moved;
      }
    }

    if (remaining !== count) this.onChange?.();
    return remaining;
  }

  remove(id, count = 1) {
    if (this.creative) return true;
    if (this.count(id) < count) return false;
    let remaining = count;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== id) continue;
      const taken = Math.min(slot.count, remaining);
      slot.count -= taken;
      remaining -= taken;
      if (slot.count === 0) this.slots[i] = null;
    }
    this.onChange?.();
    return true;
  }

  // Consumes one of the selected stack; returns the block id placed, or null.
  consumeSelected() {
    const slot = this.selectedStack;
    if (!slot) return null;
    if (this.creative) return slot.id;

    slot.count -= 1;
    const id = slot.id;
    if (slot.count <= 0) this.slots[this.selected] = null;
    this.onChange?.();
    return id;
  }

  swap(a, b) {
    if (a === b) return;
    const tmp = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = tmp;
    this.onChange?.();
  }

  // --- crafting -------------------------------------------------------------

  canCraft(recipe) {
    if (this.creative) return true;
    for (const [id, need] of Object.entries(recipe.in)) {
      if (this.count(Number(id)) < need) return false;
    }
    return true;
  }

  craft(recipe) {
    if (!this.canCraft(recipe)) return false;
    if (!this.creative) {
      for (const [id, need] of Object.entries(recipe.in)) {
        this.remove(Number(id), need);
      }
    }
    this.add(recipe.out, recipe.count);
    return true;
  }

  availableRecipes() {
    return RECIPES.map((recipe) => ({ recipe, ok: this.canCraft(recipe) }));
  }

  // --- presets and persistence ---------------------------------------------

  fillStarter() {
    const starter = [
      [BLOCKS.GRASS, 64],
      [BLOCKS.DIRT, 64],
      [BLOCKS.STONE, 64],
      [BLOCKS.COBBLESTONE, 32],
      [BLOCKS.PLANKS, 32],
      [BLOCKS.SAND, 32],
      [BLOCKS.GLASS, 16],
      [BLOCKS.BRICK, 16],
      [BLOCKS.GLOWSTONE, 8],
    ];
    starter.forEach(([id, count], i) => {
      this.slots[i] = { id, count };
    });
    this.onChange?.();
  }

  serialize() {
    return {
      selected: this.selected,
      creative: this.creative,
      slots: this.slots.map((s) => (s ? [s.id, s.count] : null)),
    };
  }

  restore(state) {
    if (!state || !Array.isArray(state.slots)) return false;
    this.slots = new Array(HOTBAR_SLOTS + STORAGE_SLOTS).fill(null);
    state.slots.forEach((entry, i) => {
      if (!entry || i >= this.slots.length) return;
      const [id, count] = entry;
      if (!defOf(id) || id === BLOCKS.AIR || count <= 0) return;
      this.slots[i] = { id, count: Math.min(STACK_MAX, count) };
    });
    this.selected = Math.min(HOTBAR_SLOTS - 1, Math.max(0, state.selected ?? 0));
    this.creative = !!state.creative;
    this.onChange?.();
    return true;
  }
}
