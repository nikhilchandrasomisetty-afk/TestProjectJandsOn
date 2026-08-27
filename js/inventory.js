import { getItem } from './items.js';

export const HOTBAR_SIZE = 9;
export const MAIN_ROWS = 3;
export const MAIN_SIZE = HOTBAR_SIZE * MAIN_ROWS;
export const TOTAL_SLOTS = HOTBAR_SIZE + MAIN_SIZE;

// Slot layout: indices 0..8 are the hotbar, 9..35 the backpack grid.
export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null); // {id, count, durability?}
    this.selected = 0;
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  get held() { return this.slots[this.selected]; }

  select(i) {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.emit();
  }

  scrollSelect(delta) {
    this.select(this.selected + delta);
  }

  countOf(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // Returns leftover count that did not fit.
  add(id, count = 1) {
    const item = getItem(id);
    if (!item) return count;
    const max = item.stack || 64;
    let remaining = count;
    if (max > 1) {
      for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) {
          const put = Math.min(max - s.count, remaining);
          s.count += put; remaining -= put;
        }
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(max, remaining);
        const slot = { id, count: put };
        if (item.durability) slot.durability = item.durability;
        this.slots[i] = slot;
        remaining -= put;
      }
    }
    this.emit();
    return remaining;
  }

  remove(id, count = 1) {
    let remaining = count;
    for (let i = TOTAL_SLOTS - 1; i >= 0 && remaining > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, remaining);
        s.count -= take; remaining -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.emit();
    return count - remaining;
  }

  consumeHeld(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.emit();
    return true;
  }

  // Tools lose a point of durability per use and break when exhausted.
  damageHeld(amount = 1) {
    const s = this.slots[this.selected];
    if (!s || s.durability === undefined) return;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
    }
    this.emit();
  }

  swap(a, b) {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    this.emit();
  }

  // Merge b into a if the same stackable item, otherwise swap.
  moveOrMerge(from, to) {
    const src = this.slots[from], dst = this.slots[to];
    if (!src) return;
    if (dst && dst.id === src.id) {
      const max = getItem(src.id)?.stack || 64;
      if (max > 1 && dst.count < max) {
        const put = Math.min(max - dst.count, src.count);
        dst.count += put;
        src.count -= put;
        if (src.count <= 0) this.slots[from] = null;
        this.emit();
        return;
      }
    }
    this.swap(from, to);
  }

  clear() {
    this.slots.fill(null);
    this.emit();
  }

  serialize() {
    return { slots: this.slots, selected: this.selected };
  }

  load(data) {
    if (!data) return;
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    (data.slots || []).forEach((s, i) => { if (i < TOTAL_SLOTS) this.slots[i] = s ? { ...s } : null; });
    this.selected = data.selected || 0;
    this.emit();
  }
}
