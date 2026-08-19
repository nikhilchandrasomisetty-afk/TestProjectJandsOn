import * as THREE from "three";
import { WORLD_HEIGHT } from "./chunk.js";
import { BLOCKS } from "./blocks.js";

const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const SNEAK_EYE_HEIGHT = 1.45;

const GRAVITY = -30;
const TERMINAL_VELOCITY = -56;
const JUMP_SPEED = 9.0;

const SPEED_WALK = 4.6;
const SPEED_SPRINT = 6.8;
const SPEED_SNEAK = 1.7;
const SPEED_FLY = 12;

const WATER_GRAVITY = -6.5;
const WATER_TERMINAL = -3.2;
const SWIM_SPEED = 3.4;
const WATER_DRAG = 0.62;

const ACCEL_GROUND = 14;
const ACCEL_AIR = 3.2;

const EPS = 1e-4;

const MAX_HEALTH = 20;
const SAFE_FALL = 3.5;
const BREATH_SECONDS = 12;

export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;

    this.position = new THREE.Vector3(0, WORLD_HEIGHT, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.spawn = new THREE.Vector3(0, WORLD_HEIGHT, 0);

    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;

    this.health = MAX_HEALTH;
    this.breath = BREATH_SECONDS;
    this.dead = false;

    this.fallStartY = null;
    this.stepDistance = 0;
    this.lastStepAt = 0;

    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._lookDir = new THREE.Vector3();

    this.onFootstep = null;
    this.onHurt = null;
    this.onDeath = null;
  }

  get eyeY() {
    return this.position.y + (this.sneaking && this.onGround ? SNEAK_EYE_HEIGHT : EYE_HEIGHT);
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.eyeY, this.position.z);
  }

  lookDirection(out = this._lookDir) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
  }

  addLook(dx, dy, sensitivity = 0.0022) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    // Keep yaw bounded so it never loses float precision over a long session.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  syncCamera() {
    this._euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this._euler);
    this.camera.position.set(this.position.x, this.eyeY, this.position.z);
  }

  // Finds open ground near (x, z) and drops the player onto it.
  respawn(x = this.spawn.x, z = this.spawn.z) {
    const surface = this.world.surfaceY(Math.floor(x), Math.floor(z));
    this.position.set(Math.floor(x) + 0.5, surface + 1.2, Math.floor(z) + 0.5);
    this.velocity.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.breath = BREATH_SECONDS;
    this.dead = false;
    this.fallStartY = null;
    this.spawn.copy(this.position);
  }

  // --- collision ------------------------------------------------------------

  // True when the player's box at (x, y, z) overlaps any solid voxel.
  collides(x, y, z) {
    const minX = Math.floor(x - HALF_WIDTH);
    const maxX = Math.floor(x + HALF_WIDTH);
    const minY = Math.floor(y);
    const maxY = Math.floor(y + HEIGHT - EPS);
    const minZ = Math.floor(z - HALF_WIDTH);
    const maxZ = Math.floor(z + HALF_WIDTH);

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (this.world.isSolidAt(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  // Moves along one axis and snaps flush against whatever it hits, so the
  // player slides along walls instead of stopping dead against them.
  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const before = p[axis];
    p[axis] += amount;

    if (!this.collides(p.x, p.y, p.z)) return false;

    if (axis === "y") {
      p.y = amount > 0
        ? Math.ceil(p.y + HEIGHT) - HEIGHT - EPS
        : Math.floor(p.y) + 1 + EPS;
    } else {
      p[axis] = amount > 0
        ? Math.ceil(p[axis] + HALF_WIDTH) - HALF_WIDTH - EPS
        : Math.floor(p[axis] - HALF_WIDTH) + 1 + HALF_WIDTH + EPS;
    }

    // If snapping did not resolve it (a block appeared inside the player),
    // fall back to refusing the move entirely.
    if (this.collides(p.x, p.y, p.z)) p[axis] = before;
    return true;
  }

  // Keeps the player from walking off a ledge while sneaking.
  wouldLeaveGround(dx, dz) {
    const x = this.position.x + dx;
    const z = this.position.z + dz;
    const y = this.position.y - 0.06;
    for (const ox of [-HALF_WIDTH, HALF_WIDTH]) {
      for (const oz of [-HALF_WIDTH, HALF_WIDTH]) {
        if (this.world.isSolidAt(x + ox, y, z + oz)) return false;
      }
    }
    return true;
  }

  // --- update ---------------------------------------------------------------

  update(dt, input) {
    dt = Math.min(dt, 0.05);
    if (this.dead) {
      this.syncCamera();
      return;
    }

    const p = this.position;
    this.inWater = this.world.isLiquidAt(p.x, p.y + 0.4, p.z);
    this.headInWater = this.world.isLiquidAt(p.x, this.eyeY, p.z);

    this.sneaking = input.sneak && !this.flying;
    this.sprinting = input.sprint && input.forward && !this.sneaking && !this.inWater;

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let wishX = 0;
    let wishZ = 0;
    if (input.forward) { wishX += this._forward.x; wishZ += this._forward.z; }
    if (input.back) { wishX -= this._forward.x; wishZ -= this._forward.z; }
    if (input.right) { wishX += this._right.x; wishZ += this._right.z; }
    if (input.left) { wishX -= this._right.x; wishZ -= this._right.z; }

    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    let speed = SPEED_WALK;
    if (this.flying) speed = SPEED_FLY;
    else if (this.sneaking) speed = SPEED_SNEAK;
    else if (this.sprinting) speed = SPEED_SPRINT;
    else if (this.inWater) speed = SWIM_SPEED;

    const accel = this.flying || this.onGround || this.inWater ? ACCEL_GROUND : ACCEL_AIR;
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;
    const blend = Math.min(1, accel * dt);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    if (this.flying) {
      let vy = 0;
      if (input.jump) vy += SPEED_FLY;
      if (input.sneak) vy -= SPEED_FLY;
      this.velocity.y = vy;
      this.fallStartY = null;
    } else if (this.inWater) {
      this.velocity.y += WATER_GRAVITY * dt;
      this.velocity.y *= Math.pow(WATER_DRAG, dt * 8);
      if (input.jump) this.velocity.y = SWIM_SPEED;
      if (this.velocity.y < WATER_TERMINAL) this.velocity.y = WATER_TERMINAL;
      this.fallStartY = null;
    } else {
      this.velocity.y += GRAVITY * dt;
      if (this.velocity.y < TERMINAL_VELOCITY) this.velocity.y = TERMINAL_VELOCITY;
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // Horizontal movement, with the sneak ledge guard applied per axis.
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;

    if (this.sneaking && this.onGround && this.wouldLeaveGround(dx, 0)) {
      this.velocity.x = 0;
    } else if (this.moveAxis("x", dx)) {
      this.velocity.x = 0;
    }

    if (this.sneaking && this.onGround && this.wouldLeaveGround(0, dz)) {
      this.velocity.z = 0;
    } else if (this.moveAxis("z", dz)) {
      this.velocity.z = 0;
    }

    // Vertical movement, tracking ground contact and fall distance.
    const movingDown = this.velocity.y <= 0;
    if (!this.flying && !this.inWater && movingDown && this.fallStartY === null && !this.onGround) {
      this.fallStartY = p.y;
    }

    const hitVertical = this.moveAxis("y", this.velocity.y * dt);
    if (hitVertical) {
      if (movingDown) {
        if (!this.onGround) this.land();
        this.onGround = true;
      }
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }

    if (p.y < -8) this.kill();

    this.updateSteps(dt, wishLen);
    this.updateVitals(dt);
    this.syncCamera();
  }

  land() {
    if (this.fallStartY === null) return;
    const distance = this.fallStartY - this.position.y;
    this.fallStartY = null;
    if (this.inWater || this.flying) return;
    if (distance > SAFE_FALL) {
      this.damage(Math.floor(distance - SAFE_FALL));
    }
  }

  updateSteps(dt, wishLen) {
    if (!this.onGround || wishLen === 0 || this.flying) return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.stepDistance += speed * dt;
    if (this.stepDistance > (this.sneaking ? 2.4 : 1.9)) {
      this.stepDistance = 0;
      const below = this.world.getBlock(
        Math.floor(this.position.x),
        Math.floor(this.position.y - 0.2),
        Math.floor(this.position.z)
      );
      if (below !== BLOCKS.AIR && this.onFootstep) this.onFootstep(below);
    }
  }

  updateVitals(dt) {
    if (this.headInWater) {
      this.breath -= dt;
      if (this.breath <= 0) {
        this.breath = 1.2;
        this.damage(1);
      }
    } else if (this.breath < BREATH_SECONDS) {
      this.breath = Math.min(BREATH_SECONDS, this.breath + dt * 4);
    }
  }

  damage(amount) {
    if (amount <= 0 || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (this.onHurt) this.onHurt(amount);
    if (this.health === 0) this.kill();
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.velocity.set(0, 0, 0);
    if (this.onDeath) this.onDeath();
  }

  toggleFly() {
    this.flying = !this.flying;
    if (this.flying) this.velocity.y = 0;
    return this.flying;
  }

  serialize() {
    return {
      x: this.position.x, y: this.position.y, z: this.position.z,
      yaw: this.yaw, pitch: this.pitch,
      health: this.health, flying: this.flying,
    };
  }

  restore(state) {
    if (!state) return;
    this.position.set(state.x, state.y, state.z);
    this.yaw = state.yaw ?? 0;
    this.pitch = state.pitch ?? 0;
    this.health = state.health ?? MAX_HEALTH;
    this.flying = !!state.flying;
    this.dead = false;
    this.velocity.set(0, 0, 0);
    this.syncCamera();
  }
}

export { MAX_HEALTH, BREATH_SECONDS, HEIGHT as PLAYER_HEIGHT };
