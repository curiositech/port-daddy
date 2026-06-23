/**
 * Dev-berth registry reader (ADR-0084).
 *
 * The `pd dev up/down/list` commands persist running dev/codebase berths to
 * `~/.port-daddy/dev-daemons.json`. This tiny reader lets the CLI's global
 * `--daemon <tier|label|url>` resolver look up a berth by label without pulling
 * the whole `berths.ts` command module (and its `child_process` deps) onto the
 * hot dispatch path.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';
import type { DevDaemonRecord } from '../../shared/daemon-berths.js';

const REGISTRY_FILE = join(PD_HOME, 'dev-daemons.json');

/** Read the recorded dev berths. Returns [] when missing or corrupt. */
export function readDevDaemonRegistry(): DevDaemonRecord[] {
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
    if (Array.isArray(raw)) return raw as DevDaemonRecord[];
  } catch {
    // Missing or corrupt — treat as empty.
  }
  return [];
}
