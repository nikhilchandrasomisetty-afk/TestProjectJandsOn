import * as THREE from 'three';

// Day/night cycle: a gradient sky dome, a sun and moon on a shared orbit, a star
// field that fades in after dusk, and colour/intensity curves that drive both the
// scene lights and the voxel shader uniforms.

const KEYFRAMES = [
  // t (0..1 of a full day), top sky, horizon sky, sun colour, sun strength, ambient
  { t: 0.00, top: 0x05070f, hor: 0x0b1020, sun: 0x2a3550, strength: 0.11, ambient: 0.19 }, // midnight
  { t: 0.20, top: 0x101a33, hor: 0x233255, sun: 0x445577, strength: 0.15, ambient: 0.21 },
  { t: 0.25, top: 0x2c3f6b, hor: 0xd9714a, sun: 0xffa259, strength: 0.42, ambient: 0.28 }, // sunrise
  { t: 0.32, top: 0x4f8fd6, hor: 0xa8d3f0, sun: 0xfff3d4, strength: 0.88, ambient: 0.36 },
  { t: 0.50, top: 0x3f86e0, hor: 0xbfe0f7, sun: 0xffffff, strength: 1.00, ambient: 0.42 }, // noon
  { t: 0.68, top: 0x4f8fd6, hor: 0xa8d3f0, sun: 0xfff0cf, strength: 0.86, ambient: 0.36 },
  { t: 0.75, top: 0x2e3f6e, hor: 0xe0794a, sun: 0xff9152, strength: 0.40, ambient: 0.27 }, // sunset
  { t: 0.82, top: 0x121a30, hor: 0x27304f, sun: 0x3c4a6b, strength: 0.15, ambient: 0.21 },
  { t: 1.00, top: 0x05070f, hor: 0x0b1020, sun: 0x2a3550, strength: 0.11, ambient: 0.19 },
];

function lerpColor(a, b, t, out) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return out.copy(ca).lerp(cb, t);
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.time = 0.30;            // start just after sunrise
    this.dayLength = 600;        // seconds for a full cycle (10 real minutes)
    this.paused = false;

    this.topColor = new THREE.Color();
    this.horizonColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.sunStrength = 1;
    this.ambient = 0.4;

    // Sky dome: a big inverted sphere with a vertical gradient shader.
    const domeGeo = new THREE.SphereGeometry(480, 24, 16);
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3f86e0) },
        uHorizon: { value: new THREE.Color(0xbfe0f7) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          float t = smoothstep(-0.12, 0.55, h);
          gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    // Stars: a single points cloud, faded via material opacity.
    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    const starSize = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 430;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.9 + 12;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      starSize[i] = 1.4 + Math.random() * 2.4;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(starSize, 1));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -99;
    scene.add(this.stars);

    // Sun and moon discs
    this.sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, depthWrite: false, fog: false })
    );
    this.sunMesh.renderOrder = -98;
    scene.add(this.sunMesh);

    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = moonCanvas.height = 64;
    const mg = moonCanvas.getContext('2d');
    mg.fillStyle = '#e8eefb';
    mg.beginPath(); mg.arc(32, 32, 26, 0, Math.PI * 2); mg.fill();
    mg.fillStyle = '#c9d4e8';
    mg.beginPath(); mg.arc(24, 26, 6, 0, Math.PI * 2); mg.fill();
    mg.beginPath(); mg.arc(40, 38, 8, 0, Math.PI * 2); mg.fill();
    mg.beginPath(); mg.arc(38, 20, 4, 0, Math.PI * 2); mg.fill();
    const moonTex = new THREE.CanvasTexture(moonCanvas);
    this.moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false })
    );
    this.moonMesh.renderOrder = -98;
    scene.add(this.moonMesh);

    // Scene lights used by creature meshes (the terrain uses its own shader)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    scene.add(this.sunLight);
    this.hemi = new THREE.HemisphereLight(0xbfe0f7, 0x4a3c2a, 0.6);
    scene.add(this.hemi);
    // Flat fill so the unlit sides of creatures keep their colour instead of going black
    this.fill = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(this.fill);
  }

  get isNight() {
    return this.time < 0.23 || this.time > 0.78;
  }

  get clockLabel() {
    // t maps directly onto the 24h clock: 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
    const hours = (this.time * 24) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setTime(t) { this.time = ((t % 1) + 1) % 1; }

  update(dt, cameraPosition) {
    if (!this.paused) {
      this.time = (this.time + dt / this.dayLength) % 1;
    }

    // Interpolate the colour keyframes
    let a = KEYFRAMES[0], b = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (this.time >= KEYFRAMES[i].t && this.time <= KEYFRAMES[i + 1].t) {
        a = KEYFRAMES[i]; b = KEYFRAMES[i + 1]; break;
      }
    }
    const span = b.t - a.t || 1;
    const f = Math.min(1, Math.max(0, (this.time - a.t) / span));
    lerpColor(a.top, b.top, f, this.topColor);
    lerpColor(a.hor, b.hor, f, this.horizonColor);
    lerpColor(a.sun, b.sun, f, this.sunColor);
    this.sunStrength = a.strength + (b.strength - a.strength) * f;
    this.ambient = a.ambient + (b.ambient - a.ambient) * f;

    this.domeMat.uniforms.uTop.value.copy(this.topColor);
    this.domeMat.uniforms.uHorizon.value.copy(this.horizonColor);

    // Star visibility ramps up through dusk
    const nightAmount = Math.max(0,
      this.time < 0.25 ? 1 - this.time / 0.25 :
      this.time > 0.75 ? (this.time - 0.75) / 0.25 : 0);
    this.starMat.opacity = Math.min(1, nightAmount * 1.15);

    // Sun/moon orbit: sun peaks at t=0.5, moon is opposite
    const angle = (this.time - 0.25) * Math.PI * 2;
    const R = 380;
    const sunPos = new THREE.Vector3(Math.cos(angle) * R, Math.sin(angle) * R, -R * 0.25);
    this.sunMesh.position.copy(cameraPosition).add(sunPos);
    this.sunMesh.lookAt(cameraPosition);
    this.sunMesh.material.color.copy(this.sunColor).lerp(new THREE.Color(0xffffff), 0.35);
    this.sunMesh.visible = sunPos.y > -60;

    const moonPos = sunPos.clone().multiplyScalar(-1);
    this.moonMesh.position.copy(cameraPosition).add(moonPos);
    this.moonMesh.lookAt(cameraPosition);
    this.moonMesh.visible = moonPos.y > -60;

    this.dome.position.copy(cameraPosition);
    this.stars.position.copy(cameraPosition);

    this.sunLight.position.copy(cameraPosition).add(sunPos.clone().normalize().multiplyScalar(80));
    this.sunLight.target.position.copy(cameraPosition);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = Math.max(0.08, this.sunStrength) * 1.1;
    this.hemi.intensity = 0.35 + this.sunStrength * 0.95;
    this.fill.intensity = 0.22 + this.sunStrength * 0.5;
    this.hemi.color.copy(this.horizonColor);

    this.scene.fog.color.copy(this.horizonColor);
  }

  applyTo(materials) {
    for (const m of materials) {
      if (!m || !m.uniforms) continue;
      m.uniforms.uSunColor.value.copy(this.sunColor);
      m.uniforms.uSunStrength.value = this.sunStrength;
      m.uniforms.uAmbient.value = this.ambient * 0.38;
      m.uniforms.uFogColor.value.copy(this.horizonColor);
    }
  }

  dispose() {
    this.scene.remove(this.dome, this.stars, this.sunMesh, this.moonMesh, this.sunLight, this.hemi, this.fill);
    this.dome.geometry.dispose(); this.domeMat.dispose();
    this.stars.geometry.dispose(); this.starMat.dispose();
    this.sunMesh.geometry.dispose(); this.sunMesh.material.dispose();
    this.moonMesh.geometry.dispose(); this.moonMesh.material.dispose();
  }
}
