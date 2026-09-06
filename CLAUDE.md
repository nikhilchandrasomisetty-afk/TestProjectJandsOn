# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Blockcraft: a small first-person, Minecraft-style voxel game that runs entirely in the
browser, rendered with Three.js. There is no backend beyond a static file server.

## Commands

```sh
npm install   # installs Three.js (the only dependency)
npm start     # runs server.js, serves the game at http://localhost:8080
```

There is no build step, bundler, linter, or test suite — `npm start` is the only script.
To verify a change works, load the page in a browser (or drive it headlessly, e.g. with
Playwright) and check the browser console for errors; there's nothing to typecheck or
unit-test.

## Architecture

- **`index.html`** — the entire page shell: canvas, HUD, hotbar, and the pointer-lock
  "click to play" overlay. It defines an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap)
  that resolves `three` and `three/addons/` to files under `node_modules/three`, then loads
  `src/main.js` as an ES module — there is no bundling step.
- **`server.js`** — a dependency-free static file server (plain `http`/`fs`, no Express).
  It serves any file under the repo root, which is what makes `node_modules/three/...`
  reachable from the browser via the import map above.
- **`src/main.js`** — all game logic, in one file:
  - **Terrain**: `heightAt(x, z)` is a deterministic closed-form height function (sums of
    sines), generated once at startup into a voxel map keyed by `"x,y,z"`.
  - **Rendering**: each block type (grass/dirt/stone/wood) is one `THREE.InstancedMesh`
    (`BlockLayer`), not one mesh per block. Adding/removing a block reuses instance slots
    via a free-list (`freeList`/`nextIndex`) so break/place doesn't grow the instance count
    unboundedly. Removed instances are hidden by zeroing their transform matrix.
  - **Player**: `PointerLockControls` (three/addons) handles mouse look; `updatePlayer()`
    implements axis-separated horizontal collision and gravity/ground-snap collision by
    sampling the voxel map at the corners of the player's bounding box, rather than any
    physics library.
  - **Interaction**: a single center-screen raycast against all `InstancedMesh` layers
    resolves `instanceId` back to a voxel key (via each layer's `indexToKey` map) to
    break (left click) or place adjacent to the hit face's normal (right click).

## Notable constraint

Three.js is installed from **npm**, not loaded from a CDN — this sandbox's network proxy
blocks `unpkg.com` (and likely other CDN hosts), so the import map in `index.html` points
at the locally installed `node_modules/three` rather than a CDN URL. If you add another
front-end dependency, install it via npm and reference it through the import map the same
way; don't assume CDN script tags will load in this environment.

## Leftover file

`app.js` (`console.log('Hello, world!')`) predates Blockcraft and is not referenced by
`package.json` or anything else — it's an artifact of the original empty-repo scaffold,
not part of the game.
