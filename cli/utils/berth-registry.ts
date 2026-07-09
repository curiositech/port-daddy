/**
 * Dev-berth registry reader (ADR-0084).
 *
 * The `pd dev up/down/list` commands persist running dev/codebase berths to
 * `~/.port-daddy/dev-daemons.json` (as does the daemon itself now, at boot —
 * see `registerDaemonBerth` in `shared/daemon-berths.ts`, the canonical
 * read/write implementation this re-exports under its established name).
 * This tiny re-export lets the CLI's global `--daemon <tier|label|url>`
 * resolver look up a berth by label without pulling the whole `berths.ts`
 * command module (and its `child_process` deps) onto the hot dispatch path.
 */

export { readDaemonBerthRegistry as readDevDaemonRegistry } from '../../shared/daemon-berths.js';
