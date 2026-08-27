import * as THREE from 'three';
import { BlockIds, isSolid, getBlock } from './blocks.js';
import { getItem } from './items.js';
import { CHUNK_Y } from './world.js';

const WIDTH = 0.6;
const HEIGHT_STAND = 1.8;
const HEIGHT_CROUCH = 1.35;
const EYE_OFFSET = 0.28; // eye sits this far below the top of the hitbox

export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.position = new THREE.Vector3(0, 60, 0); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.height = HEIGHT_STAND;
    this.crouching = false;
    this.sprinting = false;
    this.flying = false;
    this.mode = 'survival';
    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.maxHunger = 20;
    this.stamina = 1;
    this.breathe = 10;
    this.hurtTimer = 0;
    this.fallStart = null;
    this.walkedDistance = 0;
    this.hungerTimer = 0;
    this.regenTimer = 0;
    this.dead = false;
    this.attackCooldown = 0;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + this.height - EYE_OFFSET, this.position.z);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'creative') {
      this.health = this.maxHealth;
      this.hunger = this.maxHunger;
    } else {
      this.flying = false;
    }
  }

  respawn(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.dead = false;
    this.fallStart = null;
  }

  damage(amount) {
    if (this.mode === 'creative' || this.dead) return;
    if (this.hurtTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.5;
    if (this.health <= 0) this.dead = true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  eat(amount) {
    this.hunger = Math.min(this.maxHunger, this.hunger + amount);
  }

  isInLiquid() {
    const b = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.4), Math.floor(this.position.z));
    return b === BlockIds.WATER;
  }

  isHeadUnderwater() {
    const e = this.eyePosition;
    return this.world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === BlockIds.WATER;
  }

  update(dt, input) {
    if (this.dead) { this.velocity.set(0, 0, 0); return; }
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const wantCrouch = input.crouch && !this.flying;
    const targetHeight = wantCrouch ? HEIGHT_CROUCH : HEIGHT_STAND;
    if (targetHeight > this.height) {
      // Only stand up if there's headroom
      if (!this.collidesAt(this.position.x, this.position.y, this.position.z, targetHeight)) {
        this.height = targetHeight;
        this.crouching = false;
      }
    } else {
      this.height = targetHeight;
      this.crouching = wantCrouch;
    }

    const inWater = this.isInLiquid();
    const canSprint = input.sprint && !this.crouching && this.stamina > 0.02 && input.forward > 0.2;
    this.sprinting = canSprint && this.mode === 'creative' ? true : canSprint && this.hunger > 3;

    let speed = this.crouching ? 2.0 : this.sprinting ? 7.2 : 4.6;
    if (this.flying) speed = this.sprinting ? 18 : 9;
    if (inWater && !this.flying) speed *= 0.62;

    // Stamina drains while sprinting, refills at rest
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.16);
    else this.stamina = Math.min(1, this.stamina + dt * 0.22);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = new THREE.Vector3(-sin, 0, -cos);
    const right = new THREE.Vector3(cos, 0, -sin);
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, input.forward)
      .addScaledVector(right, input.strafe);
    if (wish.lengthSq() > 1) wish.normalize();

    if (this.flying) {
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      let vy = 0;
      if (input.jump) vy += speed;
      if (input.crouch) vy -= speed;
      this.velocity.y = vy;
    } else {
      const accel = this.onGround ? 42 : 12;
      const targetX = wish.x * speed, targetZ = wish.z * speed;
      this.velocity.x += (targetX - this.velocity.x) * Math.min(1, accel * dt);
      this.velocity.z += (targetZ - this.velocity.z) * Math.min(1, accel * dt);

      const gravity = inWater ? 9 : 28;
      this.velocity.y -= gravity * dt;
      if (inWater) {
        this.velocity.y = Math.max(this.velocity.y, -3.2);
        if (input.jump) this.velocity.y = 4.0;
      } else if (input.jump && this.onGround) {
        this.velocity.y = 8.6;
        this.onGround = false;
      }
      this.velocity.y = Math.max(this.velocity.y, -55);
    }

    // Fall damage bookkeeping
    if (!this.flying && this.mode === 'survival') {
      if (!this.onGround && this.velocity.y < 0) {
        if (this.fallStart === null) this.fallStart = this.position.y;
      }
    } else {
      this.fallStart = null;
    }

    const before = this.position.clone();
    this.moveWithCollisions(this.velocity.clone().multiplyScalar(dt), input.crouch && this.onGround && !this.flying);

    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    this.walkedDistance += moved;

    if (this.onGround && this.fallStart !== null) {
      const drop = this.fallStart - this.position.y;
      if (drop > 3.5 && !inWater) this.damage(Math.floor((drop - 3.0) * 1.6));
      this.fallStart = null;
    }

    // Drowning
    if (this.isHeadUnderwater()) {
      this.breathe -= dt;
      if (this.breathe < 0) { this.damage(1); this.breathe = 1; }
    } else {
      this.breathe = Math.min(10, this.breathe + dt * 4);
    }

    if (this.mode === 'survival') this.updateSurvivalStats(dt);
    if (this.position.y < -8) this.damage(40);
  }

  updateSurvivalStats(dt) {
    const drain = 0.02 + (this.sprinting ? 0.05 : 0) + this.walkedDistance * 0.004;
    this.walkedDistance = 0;
    this.hungerTimer += dt * drain;
    if (this.hungerTimer > 1) {
      this.hungerTimer = 0;
      this.hunger = Math.max(0, this.hunger - 1);
    }
    if (this.hunger <= 0) {
      this.regenTimer += dt;
      if (this.regenTimer > 4) { this.regenTimer = 0; this.damage(1); }
    } else if (this.hunger > 14 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer > 3.5) { this.regenTimer = 0; this.heal(1); }
    }
  }

  // Swept AABB resolution, axis by axis. Also supports the "don't walk off a ledge
  // while crouching" behaviour when sneakGuard is true.
  moveWithCollisions(delta, sneakGuard) {
    const step = (axis, amount) => {
      if (amount === 0) return;
      const old = this.position[axis];
      this.position[axis] += amount;
      if (this.collidesAt(this.position.x, this.position.y, this.position.z, this.height)) {
        this.position[axis] = old;
        if (axis === 'y') {
          if (amount < 0) this.onGround = true;
          this.velocity.y = 0;
        } else {
          this.velocity[axis] = 0;
        }
      }
    };

    this.onGround = false;
    // Move Y first so landing is detected, then horizontal
    step('y', delta.y);

    if (sneakGuard) {
      const tryAxis = (axis, amount) => {
        const old = this.position[axis];
        this.position[axis] += amount;
        if (this.collidesAt(this.position.x, this.position.y, this.position.z, this.height)) {
          this.position[axis] = old;
          this.velocity[axis] = 0;
        } else if (!this.hasGroundBelow()) {
          this.position[axis] = old;
        }
      };
      tryAxis('x', delta.x);
      tryAxis('z', delta.z);
    } else {
      step('x', delta.x);
      step('z', delta.z);
    }

    // Auto step-up over single blocks so walking terrain feels smooth
    if (this.onGround === false && this.velocity.y <= 0) {
      // check ground contact just below feet
      if (this.collidesAt(this.position.x, this.position.y - 0.06, this.position.z, this.height)) {
        this.onGround = true;
      }
    }
  }

  hasGroundBelow() {
    const half = WIDTH / 2;
    const y = Math.floor(this.position.y - 0.12);
    for (const dx of [-half + 0.02, half - 0.02]) {
      for (const dz of [-half + 0.02, half - 0.02]) {
        if (isSolid(this.world.getBlock(Math.floor(this.position.x + dx), y, Math.floor(this.position.z + dz)))) return true;
      }
    }
    return false;
  }

  collidesAt(x, y, z, height) {
    if (this.mode === 'creative' && this.flying && this.noclip) return false;
    const half = WIDTH / 2;
    const minX = Math.floor(x - half), maxX = Math.floor(x + half);
    const minY = Math.floor(y + 0.001), maxY = Math.floor(y + height - 0.001);
    const minZ = Math.floor(z - half), maxZ = Math.floor(z + half);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (by < 0 || by >= CHUNK_Y) continue;
          if (isSolid(this.world.getBlock(bx, by, bz))) return true;
        }
      }
    }
    return false;
  }

  // Voxel DDA ray march from the eye along the view direction.
  raycast(maxDistance = 6) {
    const origin = this.eyePosition;
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    const boundary = (o, s) => (s > 0 ? Math.floor(o) + 1 - o : o - Math.floor(o));
    let tMaxX = stepX !== 0 ? boundary(origin.x, stepX) * tDeltaX : Infinity;
    let tMaxY = stepY !== 0 ? boundary(origin.y, stepY) * tDeltaY : Infinity;
    let tMaxZ = stepZ !== 0 ? boundary(origin.z, stepZ) * tDeltaZ : Infinity;

    let normal = [0, 0, 0];
    let t = 0;
    while (t <= maxDistance) {
      const id = this.world.getBlock(x, y, z);
      if (id !== BlockIds.AIR && id !== BlockIds.WATER) {
        return { hit: true, x, y, z, id, normal, distance: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
      }
    }
    return { hit: false };
  }

  // How long (seconds) breaking a block takes with the currently held item.
  breakTime(blockId, heldItem) {
    if (this.mode === 'creative') return 0;
    const b = getBlock(blockId);
    if (!b || b.hardness <= 0) return 0.05;
    let multiplier = 1;
    const item = heldItem ? getItem(heldItem.id) : null;
    if (item && item.tool) {
      if (item.tool === b.tool) multiplier = item.speed;
      else multiplier = 1.15;
    }
    // Ore tiers gate progress: you need a good enough pickaxe
    if (b.tier) {
      const tier = item && item.tool === 'pickaxe' ? item.tier : 0;
      if (tier < b.tier) return Infinity;
    }
    if (b.tool === 'pickaxe' && (!item || item.tool !== 'pickaxe') && b.hardness >= 1.5) {
      multiplier = 0.45; // bare-handed stone is very slow but possible
    }
    return Math.max(0.05, (b.hardness * 1.35) / multiplier);
  }

  applyToCamera() {
    const eye = this.eyePosition;
    this.camera.position.copy(eye);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  serialize() {
    return {
      position: this.position.toArray(),
      yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, mode: this.mode, flying: this.flying,
    };
  }

  load(data) {
    if (!data) return;
    this.position.fromArray(data.position);
    this.yaw = data.yaw || 0;
    this.pitch = data.pitch || 0;
    this.health = data.health ?? 20;
    this.hunger = data.hunger ?? 20;
    this.setMode(data.mode || 'survival');
    this.flying = !!data.flying && this.mode === 'creative';
  }
}
