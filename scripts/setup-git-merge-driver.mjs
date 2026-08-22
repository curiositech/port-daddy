#!/usr/bin/env node
/**
 * Wires the `roadmap-snapshot` git merge driver into THIS checkout's local
 * git config (`git config` with no `--global` — never touches the
 * developer's global config or any other repo).
 *
 * A merge driver named in `.gitattributes` (`merge=roadmap-snapshot`) does
 * nothing on its own — `git config merge.roadmap-snapshot.driver <cmd>` has
 * to be set too, and that setting does NOT travel with `git clone`. This
 * script is how it gets set, via package.json's `"prepare"` lifecycle script.
 *
 * `prepare` runs on a plain `npm install` inside this repo (the first command
 * in CONTRIBUTING.md's Getting Started) and for git-sourced installs — but it
 * does NOT run for `npm install -g port-daddy` from the registry, so this can
 * never break the published package for an end user. As a second layer of
 * safety this is also a total no-op — never throws, never exits non-zero —
 * anywhere it doesn't find a `.git` at the repo root (e.g. if it were ever
 * reached from inside node_modules/).
 *
 * IMPORTANT — what this does NOT cover: GitHub's own "Update branch" / merge
 * queue merges run server-side and never consult a contributor's local git
 * config or .gitattributes. This driver only helps `git merge` / `git rebase`
 * run with a local git client that has run `npm install` here at least once
 * (this script, or manually: see README note near .gitattributes).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER_NAME = 'roadmap-snapshot';
// %O/%A/%B are quoted: git substitutes them textually into this string before
// handing it to the shell, and an unquoted substitution would word-split on
// any space in the temp path. In practice git spawns the driver with cwd set
// to the worktree root and passes bare relative names like `.merge_file_xxxx`
// (verified empirically, including with the worktree's own directory name
// containing spaces), so this hasn't been observed to break — but quoting is
// free, standard practice for shell-interpolated placeholders, and guards
// against any git version/platform that behaves differently.
const DRIVER_CMD = 'npx tsx scripts/merge-roadmap-snapshot.ts "%O" "%A" "%B"';

function main() {
  try {
    if (!existsSync(resolve(ROOT, '.git'))) return; // not a git checkout — e.g. installed as a dependency
    execFileSync('git', ['config', `merge.${DRIVER_NAME}.name`, 'Roadmap snapshot semantic merge (slug-keyed union)'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', `merge.${DRIVER_NAME}.driver`, DRIVER_CMD], { cwd: ROOT, stdio: 'ignore' });
    console.log(`✓ configured local git merge driver "${DRIVER_NAME}" for docs/roadmap/roadmap.snapshot.json`);
  } catch (err) {
    // Never fail an install over this — worst case, that checkout falls back
    // to ordinary textual conflicts on the snapshot, same as before this file
    // existed. But a missing `git` binary (ENOENT) is worth a warning rather
    // than silence: unlike the "not a git checkout" return above, this is a
    // contributor who WILL hit textual conflicts on the snapshot and has no
    // way to know why the driver never got configured.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      console.warn(
        `⚠ could not configure the "${DRIVER_NAME}" git merge driver: \`git\` was not found on PATH. ` +
          'docs/roadmap/roadmap.snapshot.json will fall back to ordinary textual merge conflicts until this is resolved.',
      );
    }
  }
}

main();
