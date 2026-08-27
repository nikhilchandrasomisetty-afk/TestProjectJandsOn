# Blockforge

A playable first-person 3D voxel sandbox built from scratch: procedurally generated
block terrain, mining and building, crafting, a day/night cycle, original creatures
with simple AI, two game modes, and persistent saved worlds. Runs in the browser on
desktop, tablet, and phone.

Everything here — code, textures, item icons, creature designs, sound effects — is
original to this project and generated at runtime from plain canvas and WebAudio
primitives. There are no imported art, audio, or level assets, and no code copied from
any other game. The only third-party dependency is the Three.js rendering library,
vendored under `vendor/` with its MIT licence.

---

## Running the game

The game is a static site using ES modules and an import map, so it must be served over
HTTP — opening `index.html` from the filesystem will not work (browsers block module
loading from `file://`).

Pick any one of these, from the repository root:

```bash
# Python 3 (installed nearly everywhere)
python3 -m http.server 8080

# Node.js
npx serve -l 8080
#   or
npx http-server -p 8080

# PHP
php -S localhost:8080
```

Then open <http://localhost:8080> and press **PLAY**.

There is no build step, no `npm install`, and no network access required at runtime.

**Requirements:** any browser with WebGL2 and ES module support — Chrome/Edge 90+,
Firefox 90+, Safari 15+. Deploying to any static host (GitHub Pages, Netlify, S3)
works as-is.

---

## Controls

### Keyboard & mouse

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Look around (click the canvas once to capture the pointer) |
| `Space` | Jump — double-tap to toggle flight in creative mode |
| `Shift` | Sprint |
| `Ctrl` or `C` | Crouch (also stops you walking off ledges) |
| Left click (hold) | Break the targeted block / attack a creature |
| Right click | Place the held block, or eat the held food |
| Middle click | Pick the targeted block into the hotbar |
| `1`–`9` | Select hotbar slot |
| Mouse wheel | Cycle hotbar slots |
| `E` | Inventory |
| `F` | Crafting |
| `Q` | Drop the held item |
| `G` | Swap between creative and survival |
| `H` or `F3` | Debug overlay (FPS, position, chunk and draw-call counts) |
| `Esc` | Pause menu |

### Touch / tablet

Touch controls appear automatically on touch devices, and can be forced on from
Settings for testing on a desktop.

| Input | Action |
| --- | --- |
| Left joystick | Move — push to the outer edge to sprint |
| Drag anywhere on the right | Look around |
| Tap the look area | Break the targeted block |
| **BREAK** (hold) | Mine continuously |
| **PLACE** | Place the held block |
| **JUMP** | Jump — double-tap to toggle flight in creative mode |
| **CROUCH** | Toggle sneaking |
| **FLY** | Toggle flight (creative mode) |
| Tap a hotbar slot | Select it |
| **BAG** / **CRAFT** / **☰** | Inventory, crafting, pause menu |

---

## Implemented features

**World generation**
- Chunked terrain (16 × 80 × 16 blocks per chunk), effectively unbounded — chunks are
  generated on demand around the player and unloaded once they fall out of range.
- Original Perlin-style gradient noise implementation (`js/noise.js`), with fractal
  Brownian motion for terrain and separate noise fields for mountains, temperature,
  humidity, rivers, caves, and ore veins.
- Four biomes — plains, forest, desert, and mountains — with snow above the tree line
  and sand along shorelines.
- Lakes, rivers, and animated translucent water with an underwater view and drowning.
- 3D-noise cave systems threading through the stone layer.
- Trees whose canopies correctly span chunk boundaries.
- Ore distribution tuned by depth: coal near the surface, then iron, gold, and the
  game's own Glowing Crystal Ore in the deepest layers.
- Deterministic from a seed: the same seed always produces the same world.

**Blocks and interaction**
- 18 block types, each with an id, name, procedurally painted texture, hardness, break
  time, solidity, and collectibility.
- Voxel DDA raycasting from the crosshair for precise targeting, with a wireframe
  highlight and a progressive break overlay.
- Tool tiers gate progress: ore hardness requires a good enough pickaxe, and the right
  tool class mines its material faster. Tools wear down and break.
- Breaking a log makes the surrounding foliage decay.

**Player**
- First-person controller with swept AABB collision resolved axis by axis.
- Gravity, jumping, sprinting, crouching, fall damage, swimming, and drowning.
- Creative flight with vertical controls.

**Inventory and crafting**
- 9-slot hotbar plus a 27-slot backpack, stackable items with counts and durability
  bars.
- Click-to-pick / click-to-place item movement that works with both mouse and touch.
- 23 original recipes: planks, sticks, workbench, torches, furnace, glass, and full
  wood / stone / iron tool sets plus a crystal pickaxe.
- Recipes are gated on proximity to a placed Workbench, and smelting recipes on a
  placed Furnace plus coal as fuel.
- A creative palette for grabbing any block or item instantly.

**Day/night cycle**
- Full sunrise → day → sunset → night cycle on a configurable day length.
- Gradient sky dome with keyframed colours, an orbiting sun and moon, and a star field
  that fades in after dusk.
- Lighting drives both the terrain shader and the scene lights: nights are visibly dark
  but still navigable, and caves are dark enough that torches matter.
- Torches near the player act as real point lights in the terrain shader.

**Creatures**
- Five original species: Meadow Hopper, Ridge Tusker, and Cave Glimmer (peaceful);
  Night Grumble and Stone Spikeling (hostile).
- Built from plain boxes with walking leg animation, head bob, ears, tusks, and spines.
- Simple AI state machine — wander, idle, chase, flee — with player detection, obstacle
  hopping, gravity and collision, melee attacks, knockback, and drops.
- Time- and depth-aware spawning: peaceful animals by day, hostiles at night and
  underground. Night Grumbles burn away at sunrise.
- Models are pooled and reused rather than rebuilt on every spawn.

**Game modes**
- **Survival** — health, hunger, stamina, fall and drowning damage, resource gathering,
  crafting, hostile creatures, item loss on death.
- **Creative** — unlimited blocks, flight, instant breaking, no health or hunger.
- Switchable mid-game with `G`.

**UI**
- Main menu, world creation, world list, settings, and a how-to-play screen.
- In-game HUD: crosshair with target feedback, health / hunger / stamina / breath bars,
  hotbar with icons and counts, clock, mode chip, toasts, and a debug overlay.
- Pause menu, death and respawn screen, and a tabbed inventory/crafting screen.
- Responsive layout down to phone screens, with safe-area insets honoured.

**Saving**
- Named worlds saved to IndexedDB, with a localStorage fallback for private windows and
  restricted contexts.
- Saves the seed, player position and stats, inventory, time of day, and every block the
  player has changed. Terrain itself is regenerated from the seed, so saves stay small.
- Autosaves every 45 seconds, on manual save, and on quit. **PLAY** resumes the most
  recently played world.

**Performance**
- Greedy meshing merges coplanar faces into the largest possible quads — measured at a
  **43% reduction** in quad count versus naive per-face meshing. Merged quads tile the
  texture atlas via `fract()` in a custom shader.
- Hidden-face culling: only faces between a solid block and a non-opaque neighbour are
  emitted at all.
- Per-chunk frustum culling — a typical view renders under 80 draw calls for 150+
  loaded chunks.
- Chunk generation and meshing are time-budgeted per frame, so streaming never stalls
  the frame rate.
- Chunks unload beyond the render distance; creature models are pooled; the terrain uses
  two shared materials for all chunks.
- Frame delta is clamped so a backgrounded tab can't fling the player through the world.

---

## Project layout

```
index.html            Page shell: canvas, HUD, and every menu screen
css/style.css         All styling, including the responsive/touch layout
js/main.js            Game orchestrator — bootstrap, main loop, wiring
js/noise.js           Original Perlin-style 2D/3D gradient noise
js/blocks.js          Block registry (id, name, hardness, solidity, drops)
js/items.js           Item registry, crafting recipes, procedural item icons
js/textures.js        Runtime-painted texture atlas and inventory block icons
js/world.js           Chunk model and the terrain/cave/ore/tree generator
js/mesher.js          Greedy meshing plus the custom voxel shader material
js/chunkmanager.js    Chunk streaming, block get/set, edit tracking, lighting data
js/player.js          First-person controller, physics, raycasting, break times
js/input.js           Keyboard/mouse and touch input, unified into one state object
js/inventory.js       Slots, stacking, durability, hotbar selection
js/crafting.js        Recipe matching and crafting/smelting
js/creatures.js       Creature species, models, AI, and the pooled manager
js/sky.js             Day/night cycle, sky dome, sun/moon, stars, scene lights
js/ui.js              Every screen, the HUD, and the icon cache
js/audio.js           Procedural WebAudio sound effects
js/storage.js         IndexedDB + localStorage world persistence
vendor/               Three.js (MIT), vendored so the game runs fully offline
```

A debug handle is exposed as `window.Blockforge` (registries and Three.js) and the live
game as `window.game`, for poking around from the browser console.

---

## Limitations and possible next steps

Known simplifications, and what would most improve the game next:

- **Lighting is approximate.** Sky light is derived from each column's height rather
  than a flood-filled light volume, so light does not bend around corners — a windowed
  room lights the same as a sealed one, and torch light does not spill through doorways.
  A proper BFS light propagation pass (per chunk, with cross-chunk queues) is the single
  biggest visual upgrade available.
- **Generation runs on the main thread.** It is time-budgeted so it never stalls the
  frame, but moving chunk generation and meshing into Web Workers with transferable
  buffers would let the world stream in noticeably faster on large render distances.
- **Torches are full glowing blocks**, not slim wall-mounted models. Non-cube block
  shapes (slabs, stairs, torches, doors) would need a separate mesh path alongside the
  greedy mesher.
- **World height is capped at 80 blocks.** Enough for mountains, caves, and deep mining,
  but not for dramatic ravines or multi-layer cave networks.
- **Water is static.** It renders and you can swim and drown in it, but it does not flow
  into holes you dig, and placing water is not possible.
- **Crafting is ingredient-based, not grid-based.** Recipes check that you hold the
  right ingredients rather than requiring a spatial 3×3 arrangement — deliberately
  chosen so the same UI works well with touch. A drag-and-drop grid could be layered on
  top for players who prefer it.
- **No block-entity storage.** The furnace and workbench act as proximity unlocks rather
  than containers with their own inventories and smelting timers.
- **Creature AI is intentionally simple** — wander, chase, flee. No pathfinding around
  obstacles beyond hopping one block, no group behaviour, and no breeding or taming.
- **Single-player only**, with no multiplayer or networking layer.
- Other natural additions: biome-specific structures and villages, weather, a proper
  hunger-restoring farming loop, redstone-like logic blocks, and an options screen for
  key rebinding.

---

## Licence and attribution

Original game code and assets. Not affiliated with, endorsed by, or derived from any
other game. Three.js is included under the MIT licence — see
`vendor/THREE-LICENSE.txt`.
