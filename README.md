# TestProjectJandsOn

## Blockcraft

A small browser-based Minecraft-style voxel game built with [Three.js](https://threejs.org/). No build step, no external CDN — everything needed ships in this repo under `vendor/three`.

### Run it

Browsers block ES module imports from `file://`, so serve the folder over HTTP:

```bash
python3 -m http.server 8000
# or: npx serve
```

Then open `http://localhost:8000/index.html`.

### Controls

- Click the screen to lock your mouse and start
- `W` `A` `S` `D` — move, mouse — look, `Space` — jump
- Left click — break the block you're looking at
- Right click — place the selected block
- `1`-`6` or scroll — choose a block from the hotbar
- `Esc` — release the mouse

### How it works

- `src/noise.js` — seeded value-noise terrain generator (no dependencies)
- `src/blocks.js` — block type registry (grass, dirt, stone, sand, wood, leaves, water, snow, bedrock)
- `src/world.js` — generates the terrain/trees and renders each block type as a `THREE.InstancedMesh`, adding/removing individual block instances in O(1) as the player breaks and places blocks
- `src/player.js` — first-person pointer-lock controls with simple gravity/collision against the voxel grid
- `src/main.js` — wires it all together: renderer, lighting, hotbar UI, raycasting for block interaction
