import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const GRAVITY = -28;
const JUMP_SPEED = 9;
const WALK_SPEED = 5.4;
const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.7;
const EYE_HEIGHT = 1.55;

export class Player {
  constructor(camera, domElement, world) {
    this.world = world;
    this.controls = new PointerLockControls(camera, domElement);
    this.camera = camera;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;

    this.keys = { forward: false, back: false, left: false, right: false, jump: false };

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();

    window.addEventListener("keydown", (e) => this._setKey(e.code, true));
    window.addEventListener("keyup", (e) => this._setKey(e.code, false));
  }

  spawnAt(x, z) {
    const h = this.world.heightAt(x, z);
    this.position.set(x + 0.5, h + 2, z + 0.5);
  }

  _setKey(code, value) {
    switch (code) {
      case "KeyW": case "ArrowUp": this.keys.forward = value; break;
      case "KeyS": case "ArrowDown": this.keys.back = value; break;
      case "KeyA": case "ArrowLeft": this.keys.left = value; break;
      case "KeyD": case "ArrowRight": this.keys.right = value; break;
      case "Space":
        if (value && this.onGround) {
          this.velocity.y = JUMP_SPEED;
          this.onGround = false;
        }
        this.keys.jump = value;
        break;
    }
  }

  _solidAt(x, y, z) {
    return this.world.isSolidForCollision(
      this.world.get(Math.floor(x), Math.floor(y), Math.floor(z))
    );
  }

  _collidesAt(x, y, z) {
    const r = PLAYER_RADIUS;
    const xmin = Math.floor(x - r), xmax = Math.floor(x + r);
    const zmin = Math.floor(z - r), zmax = Math.floor(z + r);
    const ymin = Math.floor(y), ymax = Math.floor(y + PLAYER_HEIGHT);
    for (let bx = xmin; bx <= xmax; bx++) {
      for (let by = ymin; by <= ymax; by++) {
        for (let bz = zmin; bz <= zmax; bz++) {
          if (this._solidAt(bx + 0.5, by, bz + 0.5)) return true;
        }
      }
    }
    return false;
  }

  update(dt) {
    dt = Math.min(dt, 0.05);

    const camera = this.camera;
    this._forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this._forward.y = 0;
    this._forward.normalize();
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._right.y = 0;
    this._right.normalize();

    let moveX = 0, moveZ = 0;
    if (this.keys.forward) { moveX += this._forward.x; moveZ += this._forward.z; }
    if (this.keys.back) { moveX -= this._forward.x; moveZ -= this._forward.z; }
    if (this.keys.right) { moveX += this._right.x; moveZ += this._right.z; }
    if (this.keys.left) { moveX -= this._right.x; moveZ -= this._right.z; }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }

    this.velocity.x = moveX * WALK_SPEED;
    this.velocity.z = moveZ * WALK_SPEED;
    this.velocity.y += GRAVITY * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    const p = this.position;

    const nx = p.x + this.velocity.x * dt;
    if (!this._collidesAt(nx, p.y, p.z)) p.x = nx;

    const nz = p.z + this.velocity.z * dt;
    if (!this._collidesAt(p.x, p.y, nz)) p.z = nz;

    const ny = p.y + this.velocity.y * dt;
    if (!this._collidesAt(p.x, ny, p.z)) {
      p.y = ny;
      this.onGround = false;
    } else {
      if (this.velocity.y < 0) this.onGround = true;
      this.velocity.y = 0;
    }

    camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
  }
}
