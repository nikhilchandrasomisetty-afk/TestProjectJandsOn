'use strict';

/**
 * Bundles the game into one self-contained HTML file (dist/voxelcraft.html)
 * that runs from any host with no module loading and no network requests —
 * three.js, every script and every texture end up inline.
 *
 *   node build.js
 *
 * The ES modules are concatenated rather than transpiled: each becomes an IIFE
 * that publishes its exports into a shared registry, and each module's import
 * list is destructured back out of it. That works because the source uses only
 * declaration-form exports and static imports.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'voxelcraft.html');

// Dependency order: every module comes after the ones it imports.
const MODULES = [
  'js/config.js',
  'js/noise.js',
  'js/blocks.js',
  'js/worldgen.js',
  'js/mesher.js',
  'js/world.js',
  'js/player.js',
  'js/main.js',
];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * three.js ships as an ES module whose only module syntax is a single trailing
 * `export{local as Exported, ...}`. Rewriting that into a plain object gives us
 * the same `THREE` namespace without a module loader.
 */
function inlineThree() {
  const source = read('vendor/three.module.min.js');
  const start = source.lastIndexOf('export{');
  if (start === -1) throw new Error('three.js: no export statement found');
  const end = source.indexOf('};', start);
  if (end === -1) throw new Error('three.js: unterminated export statement');

  const pairs = source
    .slice(start + 'export{'.length, end)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [local, exported] = entry.split(/\s+as\s+/).map((s) => s.trim());
      return `${JSON.stringify(exported ?? local)}:${local}`;
    });

  return `${source.slice(0, start)}\nconst THREE = {${pairs.join(',')}};\n`;
}

/** Names a module publishes, e.g. `export class World` -> World. */
function exportedNames(source) {
  const names = [...source.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)];
  if (/^export\s*\{/m.test(source)) throw new Error('list-form exports are not supported by this bundler');
  return names.map((m) => m[1]);
}

/** Names a module pulls in from its siblings (the `three` import is global here). */
function importedNames(source) {
  const names = [];
  for (const match of source.matchAll(/^import\s+\{([^}]*)\}\s+from\s+['"][^'"]+['"];?/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function bundleModule(file) {
  const source = read(file);
  const exports = exportedNames(source);
  const imports = importedNames(source);

  const body = source
    .replace(/^import\s+[^;]+?;\s*$/gm, '') // static imports become registry lookups
    .replace(/^'use strict';\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class)\s)/gm, '');

  const prelude = imports.length ? `  const { ${imports.join(', ')} } = __registry;\n` : '';
  const publish = exports.length ? `\n  Object.assign(__registry, { ${exports.join(', ')} });\n` : '';

  return `// ---- ${file} ----\n(() => {\n${prelude}${body}${publish}})();\n`;
}

function extractSection(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) throw new Error(`index.html: no <${tag}> found`);
  return match[1];
}

function build() {
  const html = read('index.html');
  const styles = extractSection(html, 'style');

  // Body markup, minus the module plumbing the bundle replaces.
  const markup = extractSection(html, 'body')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();

  const script = [
    '/* three.js r160 — MIT licensed, see vendor/THREE-LICENSE.txt */',
    inlineThree(),
    'const __registry = {};',
    ...MODULES.map(bundleModule),
  ].join('\n');

  const page = `<title>Voxelcraft</title>
<style>
${styles.trim()}
</style>

${markup}

<script>
${script}
</script>
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, page);
  const kb = (Buffer.byteLength(page) / 1024).toFixed(0);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${kb} KB)`);
}

build();
