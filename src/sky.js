import * as THREE from "three";

// A full day/night cycle. Time runs 0..1 with 0 at midnight, 0.25 sunrise,
// 0.5 noon and 0.75 sunset. Sky, fog, and light colors are all derived from
// the sun's elevation so they never disagree with each other.

const DAY_LENGTH_SECONDS = 480;

const COLOR_NIGHT = new THREE.Color(0x070b18);
const COLOR_TWILIGHT = new THREE.Color(0xe0794c);
const COLOR_DAY = new THREE.Color(0x8fd0f0);

const SUN_DAY = new THREE.Color(0xfff3dd);
const SUN_TWILIGHT = new THREE.Color(0xff9d5c);
const MOON_LIGHT = new THREE.Color(0x8fa6d8);

const SKY_RADIUS = 320;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export class Sky {
  constructor(scene, { renderDistance = 5, chunkSize = 16 } = {}) {
    this.scene = scene;
    this.time = 0.30; // start shortly after sunrise
    this.paused = false;
    this.speed = 1;

    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();

    const viewDistance = renderDistance * chunkSize;
    scene.fog = new THREE.Fog(COLOR_DAY.getHex(), viewDistance * 0.45, viewDistance * 1.05);
    this.baseFogNear = scene.fog.near;
    this.baseFogFar = scene.fog.far;

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.position.set(60, 100, 30);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0xbdd9ff, 0x4a4436, 0.55);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    scene.add(this.ambient);

    // Celestial bodies and stars ride in a group centered on the player so the
    // sky never appears to slide past as the player walks.
    this.dome = new THREE.Group();
    scene.add(this.dome);

    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(14, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false })
    );
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(9, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xdfe6f5, fog: false })
    );
    this.dome.add(this.sun, this.moon);

    this.stars = this._buildStars(700);
    this.dome.add(this.stars);
  }

  _buildStars(count) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Rejection-free spherical distribution, upper hemisphere biased.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(theta) * r * SKY_RADIUS;
      positions[i * 3 + 1] = Math.abs(u) * SKY_RADIUS;
      positions[i * 3 + 2] = Math.sin(theta) * r * SKY_RADIUS;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    return new THREE.Points(geometry, material);
  }

  setTime(t) {
    this.time = ((t % 1) + 1) % 1;
  }

  get clockLabel() {
    const totalMinutes = Math.floor(this.time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  get isNight() {
    return this.sunElevation < -0.05;
  }

  update(dt, playerPosition) {
    if (!this.paused) {
      this.time = (this.time + (dt * this.speed) / DAY_LENGTH_SECONDS) % 1;
    }

    const angle = this.time * Math.PI * 2;
    const elevation = -Math.cos(angle);
    this.sunElevation = elevation;

    const dir = new THREE.Vector3(Math.sin(angle) * 0.85, elevation, 0.42).normalize();

    // Sky and fog: night below the horizon, a warm band while the sun is low,
    // full daylight above it.
    const dayFactor = smoothstep(-0.02, 0.28, elevation);
    const twilightFactor = smoothstep(-0.30, -0.02, elevation) * (1 - dayFactor);

    this.skyColor.copy(COLOR_NIGHT);
    this.skyColor.lerp(COLOR_TWILIGHT, twilightFactor);
    this.skyColor.lerp(COLOR_DAY, dayFactor);

    this.scene.background = this.scene.background instanceof THREE.Color
      ? this.scene.background.copy(this.skyColor)
      : new THREE.Color().copy(this.skyColor);

    this.fogColor.copy(this.skyColor);
    if (this.scene.fog) this.scene.fog.color.copy(this.fogColor);

    // Lighting.
    const sunIntensity = clamp01(elevation * 1.6) * 1.05;
    const moonIntensity = clamp01(-elevation * 0.9) * 0.22;

    this.sunLight.position.copy(dir).multiplyScalar(120);
    if (playerPosition) {
      this.sunLight.position.add(playerPosition);
      this.sunLight.target.position.copy(playerPosition);
      this.dome.position.copy(playerPosition);
    }
    this.sunLight.target.updateMatrixWorld();

    if (elevation > 0) {
      this.sunLight.color.copy(SUN_TWILIGHT).lerp(SUN_DAY, smoothstep(0.02, 0.32, elevation));
      this.sunLight.intensity = sunIntensity;
    } else {
      this.sunLight.color.copy(MOON_LIGHT);
      this.sunLight.intensity = moonIntensity;
      this.sunLight.position.copy(dir).multiplyScalar(-120);
      if (playerPosition) this.sunLight.position.add(playerPosition);
    }

    this.hemi.intensity = 0.16 + dayFactor * 0.5;
    this.hemi.color.copy(this.skyColor);
    this.ambient.intensity = 0.10 + dayFactor * 0.20 + twilightFactor * 0.06;

    // Celestial bodies sit on the dome opposite each other.
    this.sun.position.copy(dir).multiplyScalar(SKY_RADIUS);
    this.moon.position.copy(dir).multiplyScalar(-SKY_RADIUS);
    this.sun.visible = elevation > -0.25;
    this.moon.visible = elevation < 0.25;

    this.stars.material.opacity = clamp01(-elevation * 1.5 - 0.05);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.rotation.y = angle * 0.5;
  }

  // Called when the camera goes below a water surface.
  applyUnderwaterFog(active) {
    if (!this.scene.fog) return;
    if (active) {
      this.scene.fog.color.setHex(0x2a5a9a);
      this.scene.fog.near = 0.1;
      this.scene.fog.far = 22;
    } else {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.near = this.baseFogNear;
      this.scene.fog.far = this.baseFogFar;
    }
  }
}

export { DAY_LENGTH_SECONDS };
