/**
 * pd backup — durable snapshots of port-registry.db. See ADR-0037.
 *
 *   pd backup                                  # take a backup, default backend
 *   pd backup --to file://<dir>                # custom backend URI
 *   pd backup --retention "daily=14,keep=5"    # override retention
 *   pd backup --no-prune                       # take backup, skip retention
 *   pd backup list [--to URI]                  # newest-first list
 *   pd backup show <snapshot-id> [--to URI]    # print full manifest
 *   pd backup prune [--to URI] [--retention SPEC]
 */

import { createFileBackend } from '../../lib/backup-backends/file.js';
import type { BackupBackend } from '../../lib/backup-backends/types.js';
import {
  createBackup,
  listBackups,
  parseRetentionSpec,
  pruneBackups,
  showBackup,
} from '../../lib/backup.js';
import * as ui from '../utils/ui.js';
import type { CLIOptions } from '../types.js';

function resolveBackend(options: CLIOptions): BackupBackend {
  const uri = typeof options.to === 'string' ? options.to : undefined;
  if (uri && !uri.startsWith('file://')) {
    throw new Error(`backend URI "${uri}" is not supported in this slice (file:// only — see ADR-0037)`);
  }
  return createFileBackend(uri);
}

function isJson(options: CLIOptions): boolean {
  return !!(options.json || options.j);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function fmtTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

async function runBackup(options: CLIOptions): Promise<void> {
  const backend = resolveBackend(options);
  const retentionSpec = options['no-prune']
    ? null
    : parseRetentionSpec(typeof options.retention === 'string' ? options.retention : undefined);

  const result = await createBackup({
    backend,
    retention: retentionSpec,
  });

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }

  ui.success(`Backup written: ${result.snapshotId}`);
  console.log(`  backend:      ${backend.uri}`);
  console.log(`  uncompressed: ${fmtBytes(result.manifest.dbBytesUncompressed)}`);
  console.log(`  compressed:   ${fmtBytes(result.manifest.dbBytesCompressed)}`);
  console.log(`  sha256:       ${result.manifest.sha256Uncompressed.slice(0, 16)}…`);
  if (result.manifest.encryption.scheme === 'none') {
    ui.warn('Backup is unencrypted (PR-α default). Encryption-at-rest lands in PR-β (ADR-0037).');
  }
  if (result.pruned.length > 0) {
    console.log(`  pruned:       ${result.pruned.length} older snapshot(s)`);
  }
}

async function runList(options: CLIOptions): Promise<void> {
  const backend = resolveBackend(options);
  const snapshots = await listBackups(backend);

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, count: snapshots.length, snapshots }, null, 2));
    return;
  }
  if (snapshots.length === 0) {
    ui.info(`No backups in ${backend.uri}`);
    return;
  }
  console.log(`${snapshots.length} backup(s) in ${backend.uri}:`);
  console.log('');
  console.log('  TIMESTAMP             SIZE       ENC   SNAPSHOT-ID');
  for (const s of snapshots) {
    const ts = fmtTimestamp(s.createdAt);
    const size = fmtBytes(s.dbBytesCompressed).padEnd(9);
    const enc = s.encryption.scheme.padEnd(5);
    console.log(`  ${ts}  ${size}  ${enc}  ${s.snapshotId}`);
  }
}

async function runShow(positional: string[], options: CLIOptions): Promise<void> {
  const snapshotId = positional[0];
  if (!snapshotId) {
    ui.error('usage: pd backup show <snapshot-id> [--to URI]');
    process.exitCode = 1;
    return;
  }
  const backend = resolveBackend(options);
  const manifest = await showBackup(backend, snapshotId);
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, manifest }, null, 2));
    return;
  }
  console.log(JSON.stringify(manifest, null, 2));
}

async function runPrune(options: CLIOptions): Promise<void> {
  const backend = resolveBackend(options);
  const retention = parseRetentionSpec(typeof options.retention === 'string' ? options.retention : undefined);
  const deleted = await pruneBackups({ backend, retention });
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, deleted, count: deleted.length }, null, 2));
    return;
  }
  if (deleted.length === 0) ui.info('Nothing to prune; all snapshots fall within retention window.');
  else ui.success(`Pruned ${deleted.length} snapshot(s): ${deleted.join(', ')}`);
}

export async function handleBackup(positional: string[], options: CLIOptions): Promise<void> {
  const sub = positional[0];
  const rest = positional.slice(1);
  try {
    switch (sub) {
      case undefined:
      case '':
      case 'run':
        await runBackup(options);
        break;
      case 'list':
        await runList(options);
        break;
      case 'show':
        await runShow(rest, options);
        break;
      case 'prune':
        await runPrune(options);
        break;
      case 'init':
        ui.warn('`pd backup init` lands in PR-β with encryption-at-rest (ADR-0037). No-op for now.');
        break;
      default:
        ui.error(`Unknown subcommand: pd backup ${sub}`);
        ui.info('Valid subcommands: (no args), list, show, prune');
        process.exitCode = 1;
    }
  } catch (err) {
    ui.error((err as Error).message);
    process.exitCode = 1;
  }
}
