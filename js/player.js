'use strict';

import * as THREE from 'three';
import { WORLD_HEIGHT } from './config.js';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const EPS = 1e-3;

const GRAVITY = 32;
const JUMP_SPEED = 9.0;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 7.5;
const SNEAK_SPEED = 1.8;
const FLY_SPEED = 12;
const SWIM_SPEED = 3.2;
const TERMINAL_VELOCITY = 55;

/**
 * First-person player: AABB physics against the voxel grid, walking /
 * swimming / flying modes, and mouse-look that drives the camera.
 */
export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.position = new THREE.Vector3(0.5, 80, 0.5);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.lastJumpTap = 0;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
  }

  spawnAt(x, z) {
    const y = this.world.surfaceY(Math.floor(x), Math.floor(z));
    this.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.velocity.set(0, 0, 0);
  }

  look(deltaX, deltaY, sensitivity = 0.0022) {
    this.yaw -= deltaX * sensitivity;
    this.pitch -= deltaY * sensitivity;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  /** Double-tapping jump toggles fly mode, like creative flight. */
  tapJump(now) {
    if (now - this.lastJumpTap < 300) {
      this.flying = !this.flying;
      this.velocity.y = 0;
      this.lastJumpTap = 0;
    } else {
      this.lastJumpTap = now;
    }
  }

  update(dt, input) {
    // Long frames are split so nothing tunnels through a block. The epsilon
    // stops float remainders from producing a degenerate extra sub-step.
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / 60);
      this.step(step, input);
      remaining -= step;
    }
    this.applyToCamera();
  }

  /**
   * True when a solid block sits just under the player's feet.
   *
   * Landing alone can't answer this: once snapped to the top of a block the
   * player stops sinking into it, so on short frames no collision is detected
   * and the player would flicker between grounded and airborne — which loses
   * jumps. Probing a couple of centimetres down is stable at any frame rate.
   */
  hasGroundBelow() {
    const half = WIDTH / 2;
    const probeY = Math.floor(this.position.y - 0.02);
    if (Math.abs(this.position.y - (probeY + 1)) > 0.06) return false;
    for (let z = Math.floor(this.position.z - half + EPS); z <= Math.floor(this.position.z + half - EPS); z++) {
      for (let x = Math.floor(this.position.x - half + EPS); x <= Math.floor(this.position.x + half - EPS); x++) {
        if (this.world.isSolidAt(x, probeY, z)) return true;
      }
    }
    return false;
  }

  step(dt, input) {
    const eye = this.position.y + EYE_HEIGHT;
    this.inWater = this.world.isLiquidAt(this.position.x, this.position.y + 0.5, this.position.z);
    const headUnderwater = this.world.isLiquidAt(this.position.x, eye, this.position.z);

    // Horizontal intent in world space.
    let forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    let strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (forward !== 0 || strafe !== 0) {
      const length = Math.hypot(forward, strafe);
      forward /= length;
      strafe /= length;
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // yaw 0 looks down -Z, matching the camera's default orientation.
    const dirX = -forward * sin + strafe * cos;
    const dirZ = -forward * cos - strafe * sin;

    let speed;
    if (this.flying) speed = input.sprint ? FLY_SPEED * 2 : FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED;
    else if (input.sneak) speed = SNEAK_SPEED;
    else if (input.sprint && forward > 0) speed = SPRINT_SPEED;
    else speed = WALK_SPEED;

    if (this.flying) {
      this.velocity.x = dirX * speed;
      this.velocity.z = dirZ * speed;
      this.velocity.y = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * speed;
    } else {
      // Ground control is snappy; in air you keep most of your momentum.
      const control = this.onGround ? 1 : 0.22;
      const targetX = dirX * speed;
      const targetZ = dirZ * speed;
      this.velocity.x += (targetX - this.velocity.x) * Math.min(1, control * dt * 14);
      this.velocity.z += (targetZ - this.velocity.z) * Math.min(1, control * dt * 14);

      if (this.inWater) {
        this.velocity.y -= GRAVITY * 0.28 * dt;
        this.velocity.y = Math.max(this.velocity.y, -3);
        if (input.jump) this.velocity.y = headUnderwater ? 3.6 : JUMP_SPEED * 0.55;
        this.velocity.y *= 0.94;
      } else {
        this.velocity.y -= GRAVITY * dt;
        if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;
        if (input.jump && this.onGround) {
          this.velocity.y = JUMP_SPEED;
          this.onGround = false;
        }
      }
    }

    this.moveAxis(0, this.velocity.x * dt);
    this.moveAxis(1, this.velocity.y * dt);
    this.moveAxis(2, this.velocity.z * dt);
    this.onGround = !this.flying && this.hasGroundBelow();

    if (this.position.y < -20) this.spawnAt(Math.floor(this.position.x), Math.floor(this.position.z));
    if (this.position.y > WORLD_HEIGHT) {
      this.position.y = WORLD_HEIGHT;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
  }

  /** Moves along one axis and snaps out of whatever solid block it hit. */
  moveAxis(axis, amount) {
    if (amount === 0) return;
    const p = this.position;
    if (axis === 0) p.x += amount;
    else if (axis === 1) p.y += amount;
    else p.z += amount;

    const half = WIDTH / 2;
    const minX = Math.floor(p.x - half + EPS);
    const maxX = Math.floor(p.x + half - EPS);
    const minY = Math.floor(p.y + EPS);
    const maxY = Math.floor(p.y + HEIGHT - EPS);
    const minZ = Math.floor(p.z - half + EPS);
    const maxZ = Math.floor(p.z + half - EPS);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!this.world.isSolidAt(x, y, z)) continue;

          if (axis === 0) {
            p.x = amount > 0 ? x - half - EPS : x + 1 + half + EPS;
            this.velocity.x = 0;
          } else if (axis === 1) {
            p.y = amount > 0 ? y - HEIGHT - EPS : y + 1 + EPS;
            this.velocity.y = 0;
          } else {
            p.z = amount > 0 ? z - half - EPS : z + 1 + half + EPS;
            this.velocity.z = 0;
          }
          return;
        }
      }
    }
  }

  /** True if the player's box overlaps the given block cell. */
  intersectsBlock(bx, by, bz) {
    const half = WIDTH / 2;
    const p = this.position;
    return (
      p.x + half > bx &&
      p.x - half < bx + 1 &&
      p.y + HEIGHT > by &&
      p.y < by + 1 &&
      p.z + half > bz &&
      p.z - half < bz + 1
    );
  }

  applyToCamera() {
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  toJSON() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      flying: this.flying,
    };
  }

  fromJSON(data) {
    if (!data) return false;
    this.position.set(data.x, data.y, data.z);
    this.yaw = data.yaw ?? 0;
    this.pitch = data.pitch ?? 0;
    this.flying = Boolean(data.flying);
    this.velocity.set(0, 0, 0);
    return true;
  }
}
