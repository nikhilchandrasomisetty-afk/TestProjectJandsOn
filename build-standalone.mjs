#!/usr/bin/env node
// Bundles the whole game into one self-contained blockforge.html that runs from
// a plain file:// double-click — no server, no build tooling, no network.
//
//   node build-standalone.mjs
//
// Each ES module is wrapped in its own IIFE that returns its exports into a
// registry, so module-private names (several files declare their own `$`
// helper) stay private exactly as they do with real modules. Imports become
// destructuring reads from that registry. Three.js is wrapped from its
// CommonJS build into a single global.
//
// The multi-file version under js/ stays the source of truth; blockforge.html
// is a generated artifact — edit js/ and css/ and re-run this script.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Modules in dependency order — each only imports from ones listed before it.
const MODULES = [
  'noise.js', 'blocks.js', 'items.js', 'textures.js', 'world.js', 'mesher.js',
  'chunkmanager.js', 'inventory.js', 'crafting.js', 'player.js', 'input.js',
  'creatures.js', 'sky.js', 'audio.js', 'storage.js', 'ui.js', 'main.js',
];

function transform(src, file) {
  const exports = new Set();
  let rest = src;

  // ---------------- imports ----------------
  const importRe = /^[ \t]*import\s+([^;]+?)\s+from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
  rest = rest.replace(importRe, (full, clause, spec) => {
    clause = clause.trim();
    const key = basename(spec);

    const ns = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (ns) {
      if (spec === 'three') return `const ${ns[1]} = __THREE;`;
      return `const ${ns[1]} = __M[${JSON.stringify(key)}];`;
    }

    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const parts = named[1].split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
        const alias = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        return alias ? `${alias[1]}: ${alias[2]}` : entry;
      });
      return `const { ${parts.join(', ')} } = __M[${JSON.stringify(key)}];`;
    }

    throw new Error(`${file}: unsupported import form: ${full.trim()}`);
  });

  // ---------------- exports ----------------
  // export const/let/var/function/class NAME
  rest = rest.replace(
    /^([ \t]*)export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm,
    (m, indent, kind, name) => { exports.add(name); return `${indent}${kind} ${name}`; }
  );
  // export { a, b as c }
  rest = rest.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (m, list) => {
    for (const entry of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const alias = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      exports.add(alias ? `${alias[2]}: ${alias[1]}` : entry);
    }
    return '';
  });

  if (/^\s*(import|export)\b/m.test(rest)) {
    const leftover = rest.split('\n').filter((l) => /^\s*(import|export)\b/.test(l));
    throw new Error(`${file}: leftover module syntax:\n  ${leftover.join('\n  ')}`);
  }

  const returned = [...exports].join(', ');
  return `// ===================== js/${file} =====================
__M[${JSON.stringify(file)}] = (function () {
${rest.trim()}
return { ${returned} };
})();`;
}

// ---- Three.js: wrap the CommonJS build into one global ----
const threeCjsPath = ['vendor/three.cjs', 'vendor/three.min.cjs'].find((p) => existsSync(join(ROOT, p)));
if (!threeCjsPath) {
  console.error('Missing vendor/three.cjs — copy it from the three package build/ directory.');
  process.exit(1);
}
const threeCjs = read(threeCjsPath);
const revision = (threeCjs.match(/REVISION\s*=\s*'([^']+)'/) || [, '?'])[1];
const threeBundle = `/* Three.js r${revision} — MIT licence, full text in the comment banner above. */
var __THREE = (function () {
  var module = { exports: {} };
  var exports = module.exports;
${threeCjs}
  return module.exports;
})();`;

const gameBundle = MODULES.map((f) => transform(read(join('js', f)), f)).join('\n\n');

// ---- Assemble the page ----
const css = read('css/style.css');
const html = read('index.html');

const bodyMatch = html.match(/<body>([\s\S]*?)<script type="module"/);
if (!bodyMatch) throw new Error('Could not locate the body markup in index.html');
const body = bodyMatch[1].trim();
const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Blockforge'])[1];
const favicon = (html.match(/<link rel="icon"[^>]*>/) || [''])[0];

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="theme-color" content="#101725" />
<title>${title}</title>
${favicon}
<!--
  BLOCKFORGE — single-file build.

  Everything is in this one file: the game code, the Three.js renderer, the
  styles, and every texture and sound (all generated procedurally at runtime).
  No server, no install, no network access. Open it in a browser and play.

  Game code and assets are original. Three.js r${revision} is included under the MIT
  licence: Copyright 2010-2026 Three.js Authors. Permission is hereby granted,
  free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without
  restriction, including without limitation the rights to use, copy, modify,
  merge, publish, distribute, sublicense, and/or sell copies of the Software,
  and to permit persons to whom the Software is furnished to do so, subject to
  the following conditions: The above copyright notice and this permission
  notice shall be included in all copies or substantial portions of the
  Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
  EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
  OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
  ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  DEALINGS IN THE SOFTWARE.

  Generated from the multi-file source by build-standalone.mjs — edit the files
  under js/ and css/ and re-run that script rather than editing this file.
-->
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${threeBundle}
</script>
<script>
"use strict";
(function () {
var __M = {};

${gameBundle}
})();
</script>
<noscript><p style="color:#fff;padding:2rem;font-family:sans-serif">This game needs JavaScript enabled.</p></noscript>
</body>
</html>
`;

writeFileSync(join(ROOT, 'blockforge.html'), page);
console.log(`Wrote blockforge.html (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB) — open it directly in a browser.`);
