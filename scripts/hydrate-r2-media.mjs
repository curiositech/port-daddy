#!/usr/bin/env node
// Fetch only LFS-backed review media. Whole-repository LFS hydration would also
// fetch the Book and unrelated product artifacts; these checks do not need them.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OFFLOAD_ROOTS, repoRootFromHere } from './r2-media-manifest.mjs';

export function hydrateMedia(repoRoot, { run = execFileSync } = {}) {
  const include = OFFLOAD_ROOTS.map((root) => `${root}**`).join(',');
  // No catch: missing Git LFS, an unavailable object or network/auth failure
  // must stop the check or upload before pointer bytes can be called media.
  run('git', ['lfs', 'pull', `--include=${include}`, '--exclude='], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) hydrateMedia(repoRootFromHere());
