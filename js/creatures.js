import * as THREE from 'three';
import { isSolid, BlockIds } from './blocks.js';
import { ItemIds } from './items.js';
import { CHUNK_Y, SEA_LEVEL } from './world.js';

// Original creature designs, all built from plain boxes so they match the voxel
// art style without resembling any existing game's characters.

export const Species = {
  HOPPER: {
    id: 'hopper',
    name: 'Meadow Hopper',      // round peaceful grazer with tall ears
    hostile: false,
    health: 8,
    speed: 1.8,
    body: { w: 0.7, h: 0.6, d: 0.9 },
    colors: { body: 0xd9c7a0, accent: 0xa8916b, eye: 0x2b2b2b },
    drops: [{ id: ItemIds.RAW_MEAT, count: 1 }],
    ears: true,
    spawnLight: 'day',
  },
  TUSKER: {
    id: 'tusker',
    name: 'Ridge Tusker',       // stocky peaceful herd animal
    hostile: false,
    health: 14,
    speed: 1.4,
    body: { w: 0.9, h: 0.9, d: 1.4 },
    colors: { body: 0x8a6f52, accent: 0xefe6d2, eye: 0x201a14 },
    drops: [{ id: ItemIds.RAW_MEAT, count: 2 }],
    tusks: true,
    spawnLight: 'day',
  },
  GLIMMER: {
    id: 'glimmer',
    name: 'Cave Glimmer',       // glowing peaceful cave critter
    hostile: false,
    health: 6,
    speed: 2.2,
    body: { w: 0.5, h: 0.5, d: 0.6 },
    colors: { body: 0x6fd8c8, accent: 0xc98cff, eye: 0xffffff },
    drops: [{ id: ItemIds.CRYSTAL_SHARD, count: 1 }],
    glow: true,
    spawnLight: 'any',
  },
  GRUMBLE: {
    id: 'grumble',
    name: 'Night Grumble',      // lanky hostile night stalker
    hostile: true,
    health: 16,
    speed: 3.0,
    damage: 3,
    body: { w: 0.6, h: 1.3, d: 0.5 },
    colors: { body: 0x3d4757, accent: 0x7a2e3d, eye: 0xff5c4d },
    drops: [{ id: BlockIds.COAL_ORE, count: 1 }],
    spawnLight: 'night',
    burnsInSun: true,
  },
  SPIKELING: {
    id: 'spikeling',
    name: 'Stone Spikeling',    // small aggressive cave dweller
    hostile: true,
    health: 10,
    speed: 3.6,
    damage: 2,
    body: { w: 0.55, h: 0.55, d: 0.55 },
    colors: { body: 0x5b5f66, accent: 0xb44a2e, eye: 0xffca3a },
    drops: [{ id: BlockIds.COBBLESTONE, count: 2 }],
    spines: true,
    spawnLight: 'dark',
  },
};

let nextId = 1;

class Creature {
  constructor(species, position) {
    this.species = species;
    this.id = nextId++;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = species.health;
    this.state = 'wander';
    this.stateTimer = 0;
    this.onGround = false;
    this.walkPhase = 0;
    this.attackCooldown = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.group = null;
    this.parts = null;
    this.targetYaw = this.yaw;
  }
}

export class CreatureManager {
  constructor(scene, world, player) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.creatures = [];
    this.pool = [];               // reusable THREE.Group instances keyed by species id
    this.poolBySpecies = new Map();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.spawnTimer = 0;
    this.maxCreatures = 26;
  }

  buildModel(species) {
    const cached = this.poolBySpecies.get(species.id);
    if (cached && cached.length) return cached.pop();

    const g = new THREE.Group();
    const b = species.body;
    const mat = (c, emissive = 0) => new THREE.MeshLambertMaterial({
      color: c, emissive: emissive ? c : 0x000000, emissiveIntensity: emissive,
    });
    const bodyMat = mat(species.colors.body, species.glow ? 0.6 : 0);
    const accentMat = mat(species.colors.accent, species.glow ? 0.4 : 0);
    const eyeMat = new THREE.MeshBasicMaterial({ color: species.colors.eye });

    const LEG_H = 0.34;
    const bodyBottom = LEG_H;              // the body rests on top of the legs
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), bodyMat);
    body.position.y = bodyBottom + b.h / 2;
    g.add(body);

    const headSize = b.w * 0.72;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), bodyMat);
    head.position.set(0, bodyBottom + b.h - headSize * 0.35, -b.d / 2 - headSize * 0.4);
    head.userData.baseY = head.position.y;
    g.add(head);

    const eyeGeo = new THREE.BoxGeometry(headSize * 0.18, headSize * 0.18, 0.04);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * headSize * 0.24, headSize * 0.12, -headSize / 2 - 0.02);
      head.add(eye);
    }

    if (species.ears) {
      const earGeo = new THREE.BoxGeometry(headSize * 0.16, headSize * 0.85, headSize * 0.12);
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(earGeo, accentMat);
        ear.position.set(sx * headSize * 0.26, headSize * 0.72, 0);
        head.add(ear);
      }
    }
    if (species.tusks) {
      const tuskGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3);
      for (const sx of [-1, 1]) {
        const t = new THREE.Mesh(tuskGeo, accentMat);
        t.position.set(sx * headSize * 0.3, -headSize * 0.22, -headSize * 0.45);
        head.add(t);
      }
    }
    if (species.spines) {
      const spikeGeo = new THREE.ConeGeometry(0.09, 0.28, 4);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(spikeGeo, accentMat);
        s.position.set((Math.random() - 0.5) * b.w * 0.7, b.h * 0.55, (Math.random() - 0.5) * b.d * 0.7);
        s.rotation.x = (Math.random() - 0.5) * 0.4;
        body.add(s);
      }
    }

    const legs = [];
    const legH = LEG_H;
    // Pivot at the hip: shift the box down so rotation swings the leg like a limb.
    const legGeo = new THREE.BoxGeometry(b.w * 0.24, legH, b.w * 0.24);
    legGeo.translate(0, -legH / 2, 0);
    const legPos = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const legCount = species.body.h > 1.0 ? 2 : 4; // tall creatures walk on two legs
    for (let i = 0; i < legCount; i++) {
      const leg = new THREE.Mesh(legGeo, accentMat);
      const [sx, sz] = legCount === 2 ? [i === 0 ? -1 : 1, 0] : legPos[i];
      leg.position.set(sx * b.w * 0.3, legH, sz * b.d * 0.32);
      g.add(leg);
      legs.push(leg);
    }

    if (species.glow) {
      const light = new THREE.PointLight(species.colors.accent, 0.9, 7);
      light.position.y = b.h * 0.8;
      g.add(light);
    }

    g.userData.parts = { body, head, legs, bodyMat, accentMat };
    return g;
  }

  releaseModel(species, g) {
    this.group.remove(g);
    let arr = this.poolBySpecies.get(species.id);
    if (!arr) { arr = []; this.poolBySpecies.set(species.id, arr); }
    if (arr.length < 12) arr.push(g);
    else disposeGroup(g);
  }

  spawn(species, position) {
    if (this.creatures.length >= this.maxCreatures) return null;
    const c = new Creature(species, position);
    c.group = this.buildModel(species);
    c.parts = c.group.userData.parts;
    c.group.position.copy(position);
    c.group.visible = true;
    this.group.add(c.group);
    this.creatures.push(c);
    return c;
  }

  despawn(c) {
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
    if (c.group) this.releaseModel(c.species, c.group);
    c.group = null;
  }

  // Chooses a species based on time of day and light, then finds a valid ground spot.
  trySpawnNear(player, isNight) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 22;
    const x = Math.floor(player.position.x + Math.cos(angle) * dist);
    const z = Math.floor(player.position.z + Math.sin(angle) * dist);
    if (!this.world.isLoaded(x, z)) return;

    // find ground
    let groundY = -1;
    for (let y = CHUNK_Y - 2; y > 2; y--) {
      if (isSolid(this.world.getBlock(x, y, z)) &&
          this.world.getBlock(x, y + 1, z) === BlockIds.AIR &&
          this.world.getBlock(x, y + 2, z) === BlockIds.AIR) { groundY = y + 1; break; }
    }
    if (groundY < 0) return;

    const underground = groundY < SEA_LEVEL - 6;
    const pool = [];
    if (underground) {
      pool.push(Species.GLIMMER, Species.SPIKELING, Species.SPIKELING);
    } else if (isNight) {
      pool.push(Species.GRUMBLE, Species.GRUMBLE, Species.SPIKELING, Species.HOPPER);
    } else {
      pool.push(Species.HOPPER, Species.HOPPER, Species.TUSKER);
    }
    const species = pool[Math.floor(Math.random() * pool.length)];
    this.spawn(species, new THREE.Vector3(x + 0.5, groundY, z + 0.5));
  }

  update(dt, isNight, onPlayerDamaged) {
    const player = this.player;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.6;
      if (this.creatures.length < this.maxCreatures) this.trySpawnNear(player, isNight);
    }

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      const distToPlayer = c.position.distanceTo(player.position);

      // Despawn things that wander too far away (keeps the simulation cheap)
      if (distToPlayer > 72 || !this.world.isLoaded(Math.floor(c.position.x), Math.floor(c.position.z))) {
        this.despawn(c);
        continue;
      }
      if (c.dead) { this.despawn(c); continue; }

      this.updateAI(c, dt, distToPlayer, player, isNight, onPlayerDamaged);
      this.updatePhysics(c, dt);
      this.updateVisual(c, dt);
    }
  }

  updateAI(c, dt, dist, player, isNight, onPlayerDamaged) {
    const s = c.species;
    c.stateTimer -= dt;
    c.attackCooldown = Math.max(0, c.attackCooldown - dt);
    c.hurtFlash = Math.max(0, c.hurtFlash - dt);

    // Hostile creatures burn away in daylight so mornings feel safe again
    if (s.burnsInSun && !isNight && c.position.y > SEA_LEVEL) {
      c.health -= dt * 4;
      if (c.health <= 0) { c.dead = true; return; }
    }

    if (s.hostile && dist < 16) {
      c.state = 'chase';
    } else if (!s.hostile && c.state === 'flee') {
      if (c.stateTimer <= 0) c.state = 'wander';
    } else if (c.state === 'chase' && dist >= 20) {
      c.state = 'wander';
    }

    let moveDir = null;
    if (c.state === 'chase') {
      const dx = player.position.x - c.position.x;
      const dz = player.position.z - c.position.z;
      c.targetYaw = Math.atan2(dx, dz);
      if (dist > 1.4) moveDir = new THREE.Vector3(dx, 0, dz).normalize();
      else if (c.attackCooldown <= 0) {
        c.attackCooldown = 1.1;
        player.damage(s.damage || 2);
        if (onPlayerDamaged) onPlayerDamaged(c);
      }
    } else if (c.state === 'flee') {
      const dx = c.position.x - player.position.x;
      const dz = c.position.z - player.position.z;
      c.targetYaw = Math.atan2(dx, dz);
      moveDir = new THREE.Vector3(dx, 0, dz).normalize();
    } else {
      if (c.stateTimer <= 0) {
        c.stateTimer = 1.5 + Math.random() * 3;
        if (Math.random() < 0.35) {
          c.state = 'idle';
        } else {
          c.state = 'wander';
          c.targetYaw = Math.random() * Math.PI * 2;
        }
      }
      if (c.state === 'wander') {
        moveDir = new THREE.Vector3(Math.sin(c.targetYaw), 0, Math.cos(c.targetYaw));
      }
    }

    // Smooth turn toward target heading
    let diff = c.targetYaw - c.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.yaw += diff * Math.min(1, dt * 6);

    const speed = c.state === 'chase' || c.state === 'flee' ? s.speed : s.speed * 0.45;
    if (moveDir) {
      c.velocity.x = moveDir.x * speed;
      c.velocity.z = moveDir.z * speed;
      // Hop over one-block obstacles
      const ahead = new THREE.Vector3(c.position.x + moveDir.x * 0.6, c.position.y, c.position.z + moveDir.z * 0.6);
      if (c.onGround && isSolid(this.world.getBlock(Math.floor(ahead.x), Math.floor(ahead.y), Math.floor(ahead.z)))) {
        c.velocity.y = 7.2;
        c.onGround = false;
      }
      c.walkPhase += dt * speed * 3.4;
    } else {
      c.velocity.x *= 0.75;
      c.velocity.z *= 0.75;
    }
  }

  updatePhysics(c, dt) {
    c.velocity.y -= 26 * dt;
    c.velocity.y = Math.max(c.velocity.y, -40);
    const b = c.species.body;
    const halfW = Math.max(b.w, b.d) / 2;
    const height = b.h + 0.6;

    const collides = (x, y, z) => {
      const minX = Math.floor(x - halfW), maxX = Math.floor(x + halfW);
      const minY = Math.floor(y + 0.02), maxY = Math.floor(y + height - 0.02);
      const minZ = Math.floor(z - halfW), maxZ = Math.floor(z + halfW);
      for (let bx = minX; bx <= maxX; bx++)
        for (let by = minY; by <= maxY; by++)
          for (let bz = minZ; bz <= maxZ; bz++)
            if (isSolid(this.world.getBlock(bx, by, bz))) return true;
      return false;
    };

    c.onGround = false;
    const dy = c.velocity.y * dt;
    c.position.y += dy;
    if (collides(c.position.x, c.position.y, c.position.z)) {
      c.position.y -= dy;
      if (dy < 0) c.onGround = true;
      c.velocity.y = 0;
    }
    const dx = c.velocity.x * dt;
    c.position.x += dx;
    if (collides(c.position.x, c.position.y, c.position.z)) { c.position.x -= dx; c.velocity.x = 0; }
    const dz = c.velocity.z * dt;
    c.position.z += dz;
    if (collides(c.position.x, c.position.y, c.position.z)) { c.position.z -= dz; c.velocity.z = 0; }

    if (c.position.y < -5) c.dead = true;
  }

  updateVisual(c, dt) {
    if (!c.group) return;
    c.group.position.copy(c.position);
    c.group.rotation.y = c.yaw + Math.PI;
    const moving = Math.hypot(c.velocity.x, c.velocity.z) > 0.3;
    const swing = moving ? Math.sin(c.walkPhase) * 0.6 : 0;
    const legs = c.parts.legs;
    for (let i = 0; i < legs.length; i++) {
      legs[i].rotation.x = swing * (i % 2 === 0 ? 1 : -1);
    }
    // Head bob adds a bit of life; set absolutely so it can't drift over time
    const head = c.parts.head;
    head.position.y = head.userData.baseY + Math.sin(performance.now() * 0.003 + c.id) * 0.03;
    const flash = c.hurtFlash > 0;
    c.parts.bodyMat.color.setHex(flash ? 0xff6b6b : c.species.colors.body);
  }

  // Returns the closest creature intersecting the player's view ray.
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    const ray = new THREE.Ray(origin, dir);
    const box = new THREE.Box3();
    const target = new THREE.Vector3();
    for (const c of this.creatures) {
      const b = c.species.body;
      const halfW = Math.max(b.w, b.d) / 2 + 0.15;
      box.min.set(c.position.x - halfW, c.position.y, c.position.z - halfW);
      box.max.set(c.position.x + halfW, c.position.y + b.h + 0.7, c.position.z + halfW);
      if (ray.intersectBox(box, target)) {
        const t = origin.distanceTo(target);
        if (t < bestT) { bestT = t; best = c; }
      }
    }
    return best;
  }

  hurt(c, amount, knockFrom) {
    c.health -= amount;
    c.hurtFlash = 0.25;
    if (knockFrom) {
      const dx = c.position.x - knockFrom.x, dz = c.position.z - knockFrom.z;
      const len = Math.hypot(dx, dz) || 1;
      c.velocity.x += (dx / len) * 5;
      c.velocity.z += (dz / len) * 5;
      c.velocity.y = 4.4;
    }
    if (!c.species.hostile) {
      c.state = 'flee';
      c.stateTimer = 6;
    }
    if (c.health <= 0) {
      c.dead = true;
      return c.species.drops;
    }
    return null;
  }

  clear() {
    for (const c of [...this.creatures]) this.despawn(c);
  }

  dispose() {
    this.clear();
    for (const arr of this.poolBySpecies.values()) for (const g of arr) disposeGroup(g);
    this.poolBySpecies.clear();
    this.scene.remove(this.group);
  }
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
