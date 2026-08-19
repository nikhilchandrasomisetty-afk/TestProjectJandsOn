// Bundles the game into one self-contained HTML file at dist/blockcraft.html.
// Everything — Three.js, all modules, CSS — is inlined, so the result runs
// from a single file with no network access and no module server.
//
//   npm install && npm run build

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "dist");
const outFile = join(outDir, "blockcraft.html");

const result = await build({
  entryPoints: [join(root, "src/main.js")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  write: false,
  alias: {
    three: join(root, "vendor/three/build/three.module.min.js"),
  },
});

const js = result.outputFiles[0].text;

let html = await readFile(join(root, "index.html"), "utf8");

// Swap the import map and module entry point for the inlined bundle.
html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script type="module">\n${js}\n</script>`
);

if (html.includes("importmap")) {
  throw new Error("Failed to inline the bundle — the script tags in index.html did not match.");
}

await mkdir(outDir, { recursive: true });
await writeFile(outFile, html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
console.log(`Wrote ${outFile} (${kb} KB)`);
