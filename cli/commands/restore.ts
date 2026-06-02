/**
 * pd restore — restore a backup to the daemon's DB path. See ADR-0037.
 *
 *   pd restore <snapshot-id> [--from URI] [--dest PATH] [--force]
 *
 * Safety:
 *   - Hashes the snapshot's gzipped + uncompressed bytes against the
 *     manifest before touching anything destructive.
 *   - Renames the current DB to `<dbPath>.pre-restore-<ts>` so the
 *     restore is reversible.
 *   - Runs PRAGMA integrity_check on the restored DB; if it fails, rolls
 *     back to the pre-restore file.
 *
 * The daemon should be stopped before restore (active writers will lose
 * uncommitted state). The CLI does NOT auto-stop in PR-α — operators are
 * prompted unless `--force` is set, and we recommend `pd daemon stop` in
 * the prompt copy. Auto-stop integration ships in a follow-up.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { createFileBackend } from '../../lib/backup-backends/file.js';
import type { BackupBackend } from '../../lib/backup-backends/types.js';
import { resolveDbPath } from '../../lib/db.js';
import { restoreBackup } from '../../lib/backup.js';
import * as ui from '../utils/ui.js';
import type { CLIOptions } from '../types.js';

function resolveBackend(options: CLIOptions): BackupBackend {
  const fromUri = typeof options.from === 'string' ? options.from : undefined;
  if (fromUri && !fromUri.startsWith('file://')) {
    throw new Error(`backend URI "${fromUri}" is not supported in this slice (file:// only — see ADR-0037)`);
  }
  return createFileBackend(fromUri);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

export async function handleRestore(positional: string[], options: CLIOptions): Promise<void> {
  const snapshotId = positional[0];
  if (!snapshotId) {
    ui.error('usage: pd restore <snapshot-id> [--from URI] [--dest PATH] [--force]');
    process.exitCode = 1;
    return;
  }
  const destPath = typeof options.dest === 'string' ? options.dest : resolveDbPath();
  const isJson = !!(options.json || options.j);

  try {
    const backend = resolveBackend(options);

    if (!options.force && existsSync(destPath)) {
      ui.warn('Restore will overwrite the live DB at:');
      console.log(`  ${destPath}`);
      ui.info('Stop the daemon first (pd daemon stop) so writes do not race the restore.');
      ui.info(`A pre-restore copy will be saved alongside as ${destPath}.pre-restore-<timestamp>.`);
      const ok = await confirm('Proceed?');
      if (!ok) {
        ui.info('Aborted.');
        return;
      }
    }

    const result = await restoreBackup({
      backend,
      snapshotId,
      destPath,
      preserveExisting: true,
    });

    if (isJson) {
      console.log(JSON.stringify({ success: true, ...result }, null, 2));
      return;
    }
    ui.success(`Restored ${result.snapshotId} → ${result.destPath}`);
    console.log(`  integrity_check: ${result.integrityOk ? 'ok' : 'FAILED (rolled back)'}`);
    if (result.preRestorePath) {
      console.log(`  pre-restore copy: ${result.preRestorePath}`);
      ui.info('Verify the daemon comes up cleanly, then you can rm the pre-restore copy.');
    }
  } catch (err) {
    ui.error((err as Error).message);
    process.exitCode = 1;
  }
}
