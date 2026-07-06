/**
 * CLI Harbor Ledger Commands — Agent Harbor event ledger + projections
 * (binder ch18 Work Order C1; ADR-0095).
 *
 * Subcommands:
 *   pd harbor-ledger status              Projection freshness (stale labeling)
 *   pd harbor-ledger project             Catch projections up to the ledger head
 *   pd harbor-ledger rebuild [name]      Rebuild projection(s) from scratch —
 *                                        the log is sacred, projections are
 *                                        disposable
 *
 * Thin operator surface; all behavior lives in lib/agent-harbor/.
 */

import { initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import {
  PROJECTIONS,
  getProjectionStatus,
  projectPending,
  rebuildProjections,
  type ProjectionName,
} from '../../lib/agent-harbor/projections.js';

function openDb(): DatabaseInstance {
  // Canonical chokepoint (lib/db.ts): single DB path, WAL + busy_timeout,
  // prod-guard in test contexts.
  return initDatabase();
}

function parseProjection(raw: string | undefined): ProjectionName | undefined {
  if (!raw) return undefined;
  if ((PROJECTIONS as readonly string[]).includes(raw)) return raw as ProjectionName;
  throw new Error(`unknown projection "${raw}". Known: ${PROJECTIONS.join(', ')}`);
}

export async function handleHarborLedger(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0] ?? 'status';
  const db = openDb();
  try {
    switch (sub) {
      case 'status': {
        const status = getProjectionStatus(db);
        if (isJson(options)) {
          console.log(JSON.stringify({ projections: status }, null, 2));
          return;
        }
        for (const p of status) {
          const label = p.stale ? `STALE (lag ${p.lagEvents})` : 'fresh';
          console.log(
            `  ${p.projection.padEnd(20)} ${label.padEnd(16)} checkpoint=${p.lastLedgerSeq} head=${p.headSeq}`,
          );
        }
        if (status.some((p) => p.stale) && !isQuiet(options)) {
          console.log('\n  Stale views may display but never authorize commands.');
          console.log('  Run: pd harbor-ledger project   (or rebuild)');
        }
        return;
      }
      case 'project': {
        const results = projectPending(db, { projection: parseProjection(args[1]) });
        if (isJson(options)) {
          console.log(JSON.stringify({ results }, null, 2));
          return;
        }
        for (const r of results) {
          console.log(
            `  ${r.projection.padEnd(20)} applied=${r.applied} duplicatesSkipped=${r.skippedDuplicates} seq ${r.fromSeq} -> ${r.toSeq}`,
          );
        }
        return;
      }
      case 'rebuild': {
        const results = rebuildProjections(db, { projection: parseProjection(args[1]) });
        if (isJson(options)) {
          console.log(JSON.stringify({ rebuilt: true, results }, null, 2));
          return;
        }
        for (const r of results) {
          console.log(`  ${r.projection.padEnd(20)} rebuilt from scratch: ${r.applied} events applied`);
        }
        return;
      }
      default:
        console.error(`Unknown subcommand: harbor-ledger ${sub}`);
        console.error('Usage: pd harbor-ledger <status|project|rebuild> [projection]');
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}
