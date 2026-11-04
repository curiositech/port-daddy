#!/usr/bin/env node
/** Publish image derivatives from the one canonical Book tree. Never publish TeX or fonts. */
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.pdf', '.json', '.txt']);
export function stageBookAssets(repoRoot) {
  let count = 0;
  for (const family of ['figures', 'plates']) {
    const source = join(repoRoot, 'book', family);
    const destination = join(repoRoot, 'website-v2/public/whitepaper', family);
    rmSync(destination, { recursive: true, force: true });
    function visit(relative = '') {
      for (const entry of readdirSync(join(source, relative), { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Book assets cannot be symlinks: ${join(relative, entry.name)}`);
        const path = join(relative, entry.name);
        if (entry.isDirectory()) {
          // Original-source preservation is for the downloadable source bundle.
          if (family === 'plates' && path === 'originals') continue;
          visit(path);
        } else if (entry.isFile() && (allowed.has(extname(path).toLowerCase()) || entry.name === 'LICENSE')) {
          const target = join(destination, path);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(join(source, path), target);
          count += 1;
        }
      }
    }
    // An absent source tree must fail before silently producing a partial website.
    if (!statSync(source).isDirectory()) throw new Error(`Missing canonical source tree: ${source}`);
    visit();
  }
  return count;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`Staged ${stageBookAssets(repoRoot)} Book assets from book/ for the website.`);
}
