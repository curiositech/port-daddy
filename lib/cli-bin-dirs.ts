/**
 * Per-user CLI install dirs shared by the readiness gate
 * (lib/backend-readiness.ts) and the spawn path
 * (lib/spawner/backends/cli-tube.ts).
 *
 * The daemon runs under launchd with a bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so agent CLIs installed per-user are
 * invisible unless every code path that locates or spawns them augments
 * PATH with the same locations. Keeping the list in one module guarantees
 * readiness and spawn agree — a binary the gate found is findable at spawn
 * time, and vice versa.
 *
 * Operators whose CLI lives somewhere unusual set PD_CLI_BIN_DIRS
 * (colon-separated) instead of touching launchd's PATH. Computed per-call
 * so the override is honored at runtime (and testable).
 */

import { join } from 'node:path';
// Namespace import (not a named `readdirSync`) so test suites that partially
// mock node:fs don't fail at ESM bind time on a missing named export — the
// property is read at call time, inside the try/catch below.
import * as nodeFs from 'node:fs';

/**
 * Node version-manager bin dirs. npm-global CLIs (codex, grok, …) install into
 * the ACTIVE node's bin, which under nvm/volta/fnm is a version-specific path
 * NOT on launchd's bare PATH and NOT a fixed location — so a hardcoded
 * `~/.codex/bin` misses a codex installed via `npm i -g`. Enumerate the
 * version dirs so the daemon finds them. Fail-soft: missing manager → [].
 */
function nodeVersionManagerBinDirs(home: string): string[] {
  const dirs: string[] = [];
  // nvm: ~/.nvm/versions/node/<ver>/bin  (newest first so the active-ish wins)
  try {
    const root = join(home, '.nvm', 'versions', 'node');
    for (const ver of nodeFs.readdirSync(root).sort().reverse()) {
      dirs.push(join(root, ver, 'bin'));
    }
  } catch { /* no nvm */ }
  // volta + fnm shim dirs (fixed locations)
  dirs.push(join(home, '.volta', 'bin'));
  dirs.push(join(home, '.fnm', 'aliases', 'default', 'bin'));
  return dirs;
}

export function cliBinDirs(): string[] {
  const home = process.env.HOME || '';
  const override = process.env.PD_CLI_BIN_DIRS
    ? process.env.PD_CLI_BIN_DIRS.split(':').filter(Boolean)
    : [];
  return [
    ...override,
    join(home, '.local', 'bin'), // claude-code + many per-user installs
    join(home, '.claude', 'local'), // claude-code alternate install path
    join(home, '.codex', 'bin'), // codex (native installer)
    ...nodeVersionManagerBinDirs(home), // codex/grok via `npm i -g` under nvm/volta/fnm
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}
