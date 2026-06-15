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

export function cliBinDirs(): string[] {
  const home = process.env.HOME || '';
  const override = process.env.PD_CLI_BIN_DIRS
    ? process.env.PD_CLI_BIN_DIRS.split(':').filter(Boolean)
    : [];
  return [
    ...override,
    join(home, '.local', 'bin'), // claude-code + many per-user installs
    join(home, '.claude', 'local'), // claude-code alternate install path
    join(home, '.codex', 'bin'), // codex
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}
