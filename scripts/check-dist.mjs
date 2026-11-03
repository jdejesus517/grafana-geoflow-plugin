#!/usr/bin/env node
// Fail if dist/ contains anything the plugin isn't meant to ship.
//
// The scaffold's webpack config copies whole globs from src/ (every *.json, every image, ...)
// into dist/, so a stray file under src/ ends up in the published plugin without anyone
// noticing. This compares every file in dist/ against an allowlist and lists the rest.
//
//   npm run build && npm run check:dist

import { readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const ALLOWED = [
  // Plugin entry point and lazily loaded chunks, with source maps.
  /^module\.js(\.map)?$/,
  /^[\w-]+\.js(\.map)?$/,
  // MapLibre's worker, emitted by webpack from the engine's worker URL.
  /^[\w-]+\.mjs(\.map)?$/,
  // Metadata, docs and license files.
  /^plugin\.json$/,
  /^(README|CHANGELOG)\.md$/,
  /^(LICENSE|NOTICE)$/,
  /^(LICENSE|THIRD_PARTY_NOTICES)\.txt$/,
  // Logo and screenshots referenced by plugin.json.
  /^img\/[\w.-]+\.(svg|png|jpe?g|gif)$/,
  // Bundled translations (the scaffold copies src/locales).
  /^locales\/[\w-]+\/[\w.-]+\.json$/,
];

// Files the plugin must ship. THIRD_PARTY_NOTICES.txt carries the license notices that bundled
// packages (MapLibre: BSD-3-Clause) require in binary distributions.
const REQUIRED = ['module.js', 'plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(DIST, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

let files;
try {
  files = await listFiles(DIST);
} catch (error) {
  console.error(`check:dist: cannot read ${DIST} (${error.code}); run npm run build first.`);
  process.exit(1);
}

const unexpected = files.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
if (unexpected.length > 0) {
  console.error(`check:dist: ${unexpected.length} unexpected file(s) in dist/:`);
  unexpected.forEach((file) => console.error(`  ${file}`));
  console.error('Remove them from src/, or add a pattern to scripts/check-dist.mjs if they belong in the plugin.');
  process.exit(1);
}
const missing = REQUIRED.filter((file) => !files.includes(file));
if (missing.length > 0) {
  console.error(`check:dist: missing required file(s) in dist/: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`check:dist: ${files.length} files, all expected.`);
