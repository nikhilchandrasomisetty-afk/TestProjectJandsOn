# Blockcraft

A browser voxel sandbox — procedurally generated terrain you can dig apart and
rebuild, block by block. Built on [Three.js](https://threejs.org/), with no
build step required to play and no external assets: every texture and sound is
generated at runtime.

## Play

ES modules will not load over `file://`, so serve the folder:

```bash
npm start          # python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

To produce a single self-contained HTML file instead:

```bash
npm install
npm run build      # writes dist/blockcraft.html
```

That file inlines Three.js, every module, and all CSS, so it opens directly
from disk with no server.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move — double-tap `W` or hold `Ctrl` to sprint |
| Mouse | Look around |
| `Space` | Jump · swim up · fly up |
| `Shift` | Sneak — will not walk off ledges · fly down |
| Left click | Hold to mine (harder blocks take longer) |
| Right click | Place the selected block |
| `1`–`9` / scroll | Choose a hotbar block |
| `E` | Inventory and crafting |
| `F` | Toggle flight |
| `G` | Debug readout |
| `R` | Respawn after dying |
| `Esc` | Release the mouse |

Where pointer lock is unavailable — inside a sandboxed iframe, for instance —
the game falls back to click-and-drag to look, and a click without dragging
mines. On touch devices, drag the left half of the screen to move, the right
half to look, and tap to mine.

## What's in it

**World generation** — Terrain comes from layered value noise: a low-frequency
continental field shaped to give decisive coastlines, plus a roughness field
scaled by a mountain mask so peaks are jagged while plains stay smooth.
Separate temperature and humidity fields pick between seven biomes (ocean,
beach, plains, forest, desert, mountains, tundra). Ridged 3D noise carves
connected cave systems, and ore types are layered by depth — coal near the
surface, diamond only in the deepest rock.

**Rendering** — The world is split into 16×64×16 chunks, each meshed into a
single `BufferGeometry` with only the visible faces emitted. Every face corner
gets an ambient-occlusion value from the three blocks meeting at it, baked into
vertex colors, and each quad is split along its darker diagonal so AO gradients
do not bend across the triangle seam. Chunks stream in around the player under
a per-frame time budget so loading never stalls the render loop.

**Textures** — All 24 block textures are painted procedurally into one canvas
atlas at load time: per-pixel noise fills, ore blob clusters, brick courses,
wood grain and rings. The atlas is sampled with a nearest filter and no
mipmaps, which keeps the pixel look sharp and avoids tile bleed at distance.

**Simulation** — Axis-separated AABB collision against the voxel grid, with
flush snapping so the player slides along walls. Swimming, sprinting, sneaking
(which refuses to step off ledges), flight, fall damage, and drowning. Sand and
gravel fall when undermined. A full day/night cycle drives sky color, fog,
sun and moon position, and star visibility from one shared sun elevation.

**Interaction** — Block picking uses an Amanatides & Woo voxel DDA traversal
rather than mesh raycasting, so it walks exactly the grid cells the ray crosses.
Mining time scales with block hardness, stone drops cobblestone, and there is a
small crafting table of recipes.

**Persistence** — Saves are a diff, not a snapshot: the seed plus only the
blocks you changed, so a heavily explored world still stores in a few
kilobytes. Autosaves every 12 seconds and on tab close.

## Layout

```
index.html          markup, styling, and the module entry point
build.mjs           bundles everything into dist/blockcraft.html
src/
  main.js           renderer, game loop, and wiring
  world.js          chunk manager, streaming, raycasting, saves
  chunk.js          chunk storage and the meshing pass with AO
  worldgen.js       terrain, biomes, caves, ores, trees
  noise.js          seeded 2D/3D value noise and fBm
  blocks.js         block registry, hardness, drops, recipes
  textures.js       procedural texture atlas
  player.js         movement, collision, and survival state
  input.js          pointer lock, drag fallback, and touch
  interaction.js    mining progress, block placement, selection outline
  inventory.js      stacks, hotbar, and crafting
  hud.js            hotbar, vitals, inventory screen, debug panel
  sky.js            day/night cycle, sun, moon, and stars
  audio.js          Web Audio sound synthesis
vendor/three/       pinned Three.js build
```

The game exposes `window.__game` for poking at the world from the console —
`__game.player`, `__game.world`, `__game.sky` and so on.
