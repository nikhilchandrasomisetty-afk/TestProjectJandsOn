# Blockcraft

A tiny Minecraft-style voxel game that runs in the browser, built with [Three.js](https://threejs.org/).

## Run it

```sh
npm install
npm start
```

Then open http://localhost:8080 and click to start.

## Controls

- **WASD** — move
- **Mouse** — look around
- **Space** — jump
- **Left click** — break a block
- **Right click** — place a block
- **1-4** — choose block type (grass, dirt, stone, wood)
- **Esc** — release the mouse

## How it works

- `src/main.js` procedurally generates a voxel terrain, renders each block type as an
  `InstancedMesh` (for performance), and implements first-person movement with simple
  gravity/collision against the voxel grid plus raycast-based block break/place.
- `server.js` is a minimal static file server (no bundler needed) that serves
  `index.html`, `src/`, and the local `node_modules/three` package referenced via an
  import map in `index.html`.
