import * as THREE from "three";
import { BLOCKS, defOf, isLiquid } from "./blocks.js";
import { WORLD_HEIGHT } from "./chunk.js";

const REACH = 6.5;
const BASE_BREAK_SECONDS = 0.42;
const PLACE_COOLDOWN = 0.18;
const CREATIVE_BREAK_COOLDOWN = 0.12;

// Owns the block the player is aiming at: the selection outline, mining
// progress, and the rules for placing and breaking.
export class Interaction {
  constructor(world, player, inventory, audio, scene) {
    this.world = world;
    this.player = player;
    this.inventory = inventory;
    this.audio = audio;

    this.target = null;
    this.progress = 0;
    this.placeTimer = 0;
    this.breakTimer = 0;
    this.lastTickAt = 0;

    this.onBreak = null;
    this.onPlace = null;
    this.onDenied = null;

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x0d0d0d, transparent: true, opacity: 0.55 })
    );
    this.outline.visible = false;
    this.outline.renderOrder = 2;
    scene.add(this.outline);

    // Darkens as mining progresses, standing in for a crack texture.
    this.damageBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.damageBox.visible = false;
    this.damageBox.renderOrder = 3;
    scene.add(this.damageBox);

    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  breakSeconds(id) {
    if (this.inventory.creative) return CREATIVE_BREAK_COOLDOWN;
    return Math.max(0.08, defOf(id).hardness * BASE_BREAK_SECONDS);
  }

  // The player's box must not intersect the cell a block would occupy.
  blockedByPlayer(x, y, z) {
    const p = this.player.position;
    const overlapX = p.x + 0.3 > x && p.x - 0.3 < x + 1;
    const overlapZ = p.z + 0.3 > z && p.z - 0.3 < z + 1;
    const overlapY = p.y + 1.8 > y && p.y < y + 1;
    return overlapX && overlapY && overlapZ;
  }

  update(dt, input) {
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    this.breakTimer = Math.max(0, this.breakTimer - dt);

    this.player.eyePosition(this._origin);
    this.player.lookDirection(this._dir);
    const hit = this.world.raycast(this._origin, this._dir, REACH);

    // Losing or changing the target cancels any mining in progress.
    if (!hit || !this.target || hit.x !== this.target.x || hit.y !== this.target.y || hit.z !== this.target.z) {
      this.progress = 0;
    }
    this.target = hit;

    if (!hit) {
      this.outline.visible = false;
      this.damageBox.visible = false;
      return;
    }

    this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.outline.visible = true;

    if (input.attacking && !this.player.dead) this.mine(dt, hit);
    else this.progress = 0;

    if (this.progress > 0.02) {
      this.damageBox.position.copy(this.outline.position);
      this.damageBox.material.opacity = this.progress * 0.55;
      this.damageBox.visible = true;
    } else {
      this.damageBox.visible = false;
    }
  }

  mine(dt, hit) {
    const def = defOf(hit.id);
    if (def.unbreakable) {
      this.progress = 0;
      return;
    }

    this.progress += dt / this.breakSeconds(hit.id);

    // A soft tick while mining gives the action some feedback before it completes.
    const now = performance.now();
    if (now - this.lastTickAt > 190) {
      this.lastTickAt = now;
      this.audio.playMineTick(def.sound);
    }

    if (this.progress < 1) return;

    this.progress = 0;
    this.breakBlock(hit);
  }

  breakBlock(hit) {
    const def = defOf(hit.id);
    if (def.unbreakable) return false;

    this.world.setBlock(hit.x, hit.y, hit.z, BLOCKS.AIR);
    this.world.settleGravity(hit.x, hit.y + 1, hit.z);

    if (!this.inventory.creative) {
      const drop = def.drop ?? hit.id;
      this.inventory.add(drop, 1);
    }

    this.audio.playBreak(def.sound);
    this.onBreak?.(hit);
    return true;
  }

  // Instant break used by the click-to-mine path in creative mode.
  tryQuickBreak() {
    if (!this.target || this.player.dead) return false;
    if (!this.inventory.creative) return false;
    if (this.breakTimer > 0) return false;
    this.breakTimer = CREATIVE_BREAK_COOLDOWN;
    return this.breakBlock(this.target);
  }

  tryPlace() {
    if (this.player.dead) return false;
    if (this.placeTimer > 0) return false;

    this.player.eyePosition(this._origin);
    this.player.lookDirection(this._dir);
    const hit = this.world.raycast(this._origin, this._dir, REACH, true);
    if (!hit) return false;

    const x = hit.x + hit.normal[0];
    const y = hit.y + hit.normal[1];
    const z = hit.z + hit.normal[2];

    if (y < 0 || y >= WORLD_HEIGHT) return false;

    const existing = this.world.getBlock(x, y, z);
    // Water can be displaced by a placed block; anything else blocks placement.
    if (existing !== BLOCKS.AIR && !isLiquid(existing)) return false;
    if (this.blockedByPlayer(x, y, z)) {
      this.onDenied?.("You are standing there");
      return false;
    }

    const stack = this.inventory.selectedStack;
    if (!stack) {
      this.onDenied?.("Nothing selected");
      return false;
    }

    const id = this.inventory.consumeSelected();
    if (id === null) return false;

    this.world.setBlock(x, y, z, id);
    this.world.settleGravity(x, y, z);
    this.placeTimer = PLACE_COOLDOWN;
    this.audio.playPlace(defOf(id).sound);
    this.onPlace?.({ x, y, z, id });
    return true;
  }

  dispose() {
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.damageBox.geometry.dispose();
    this.damageBox.material.dispose();
  }
}

export { REACH };
