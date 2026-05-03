/**
 * pd snapshots — list and restore claim-watcher snapshots.
 *
 * The daemon-side claim watcher (lib/claim-watcher.ts) writes pre-stomp
 * file bytes to ~/.port-daddy/snapshots/<sessionId>/, with one
 * manifest.jsonl line per snapshot. This command surfaces those
 * snapshots to the operator and provides one-command rollback.
 *
 *   pd snapshots list                           # every recent snapshot
 *   pd snapshots list --session <id>            # one session's snapshots
 *   pd snapshots list --path <substr>           # filter by file path
 *   pd snapshots list --json                    # structured output
 *   pd snapshots show <snapshotPath>            # print the snapshot contents
 *   pd snapshots restore <snapshotPath>         # write snapshot back to its
 *                                               # original file path
 *   pd snapshots prune [--days N]               # delete snapshots older than N
 *
 * "snapshotPath" can be the absolute path under ~/.port-daddy/snapshots/, or
 * any unique trailing substring. The command resolves the shortest match.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import * as ui from '../utils/ui.js';
import type { CLIOptions } from '../types.js';

interface ManifestEntry {
  sessionId: string;
  agentId?: string | null;
  filePath: string;
  snapshotPath: string;
  priorHash: string;
  priorBytes: number;
  snapshotAt: string;
}

// Resolved on every call so tests (and the rare runtime HOME change) see
// the live $HOME instead of the value captured at module load. The env
// override lets tests sidestep libuv's cached passwd/HOME entirely.
function snapshotRoot(): string {
  const override = process.env.PORT_DADDY_SNAPSHOT_ROOT;
  if (override && override.length > 0) return override;
  return join(homedir(), '.port-daddy', 'snapshots');
}

function safeReadJsonl(path: string): ManifestEntry[] {
  if (!existsSync(path)) return [];
  const out: ManifestEntry[] = [];
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.sessionId && entry?.filePath && entry?.snapshotPath) {
        out.push(entry as ManifestEntry);
      }
    } catch {
      // skip malformed manifest lines — best-effort surface
    }
  }
  return out;
}

function listManifests(): ManifestEntry[] {
  const root = snapshotRoot();
  if (!existsSync(root)) return [];
  const out: ManifestEntry[] = [];
  for (const sessionDir of readdirSync(root)) {
    const manifest = join(root, sessionDir, 'manifest.jsonl');
    out.push(...safeReadJsonl(manifest));
  }
  // Newest first — easier to scan.
  return out.sort((a, b) => (a.snapshotAt < b.snapshotAt ? 1 : -1));
}

function matchSelector(entries: ManifestEntry[], selector: string): ManifestEntry[] {
  // Support exact snapshotPath or any unique trailing substring of it.
  const exact = entries.filter((e) => e.snapshotPath === selector);
  if (exact.length > 0) return exact;
  return entries.filter((e) => e.snapshotPath.endsWith(selector) || e.snapshotPath.includes(selector));
}

function formatRow(e: ManifestEntry): string {
  const when = e.snapshotAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  const session = e.sessionId.length > 28 ? e.sessionId.slice(0, 27) + '…' : e.sessionId;
  return `${when}  ${session.padEnd(28)}  ${e.filePath}`;
}

function handleList(options: CLIOptions): void {
  const filterSession = typeof options.session === 'string' ? options.session : null;
  const filterPath = typeof options.path === 'string' ? options.path : null;
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 50;

  let entries = listManifests();
  if (filterSession) entries = entries.filter((e) => e.sessionId.includes(filterSession));
  if (filterPath) entries = entries.filter((e) => e.filePath.includes(filterPath));
  entries = entries.slice(0, limit);

  if (options.json || options.j) {
    console.log(JSON.stringify({ success: true, count: entries.length, entries }, null, 2));
    return;
  }

  if (entries.length === 0) {
    ui.info('No snapshots found.');
    return;
  }

  console.log(`Found ${entries.length} snapshot(s):`);
  console.log('');
  console.log('  TIMESTAMP           SESSION                       FILE');
  for (const e of entries) console.log('  ' + formatRow(e));
  console.log('');
  ui.info('Restore: pd snapshots restore <snapshotPath-or-suffix>');
}

function handleShow(positional: string[], options: CLIOptions): void {
  const selector = positional[0];
  if (!selector) {
    ui.error('Usage: pd snapshots show <snapshotPath-or-suffix>');
    process.exit(1);
  }
  const matches = matchSelector(listManifests(), selector);
  if (matches.length === 0) {
    ui.error(`No snapshot matches "${selector}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    ui.error(`Selector "${selector}" matches ${matches.length} snapshots — be more specific`);
    for (const m of matches.slice(0, 5)) console.error('  ' + m.snapshotPath);
    process.exit(1);
  }
  const entry = matches[0];
  if (!existsSync(entry.snapshotPath)) {
    ui.error(`Snapshot file missing: ${entry.snapshotPath}`);
    process.exit(1);
  }
  if (options.json || options.j) {
    // Snapshots are raw bytes — could be binary, partial UTF-8, or anything
    // the operator was editing. Base64-encode for JSON safety; the caller
    // can decode with the explicit `encoding` field if they need bytes.
    const bytes = readFileSync(entry.snapshotPath);
    console.log(JSON.stringify({
      success: true,
      ...entry,
      encoding: 'base64',
      contents: bytes.toString('base64'),
    }, null, 2));
    return;
  }
  process.stdout.write(readFileSync(entry.snapshotPath));
}

function handleRestore(positional: string[], options: CLIOptions): void {
  const selector = positional[0];
  if (!selector) {
    ui.error('Usage: pd snapshots restore <snapshotPath-or-suffix> [--target <path>]');
    process.exit(1);
  }
  const matches = matchSelector(listManifests(), selector);
  if (matches.length === 0) {
    ui.error(`No snapshot matches "${selector}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    ui.error(`Selector "${selector}" matches ${matches.length} snapshots — be more specific`);
    for (const m of matches.slice(0, 5)) console.error('  ' + m.snapshotPath);
    process.exit(1);
  }
  const entry = matches[0];
  if (!existsSync(entry.snapshotPath)) {
    ui.error(`Snapshot file missing: ${entry.snapshotPath}`);
    process.exit(1);
  }

  // Default target: original filePath (resolved against cwd if relative).
  // --target lets the caller redirect the restore to a different path
  // (useful for diffing, or when the original path no longer exists).
  const explicitTarget = typeof options.target === 'string' ? options.target : null;
  const target = explicitTarget
    ? resolve(process.cwd(), explicitTarget)
    : entry.filePath.startsWith('/') ? entry.filePath : resolve(process.cwd(), entry.filePath);

  if (existsSync(target) && !options.force) {
    ui.warn(`${target} exists. Re-run with --force to overwrite.`);
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(entry.snapshotPath, target);

  if (options.json || options.j) {
    console.log(JSON.stringify({ success: true, restoredTo: target, from: entry.snapshotPath, sessionId: entry.sessionId }, null, 2));
    return;
  }
  ui.success(`Restored ${entry.filePath} from ${entry.snapshotAt}`);
  console.log(`  source: ${entry.snapshotPath}`);
  console.log(`  target: ${target}`);
}

function handlePrune(options: CLIOptions): void {
  const days = typeof options.days === 'number' && options.days > 0 ? options.days : 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dryRun = Boolean(options['dry-run'] || options.n);

  const root = snapshotRoot();
  if (!existsSync(root)) {
    ui.info('Snapshot directory does not exist; nothing to prune.');
    return;
  }

  let pruned = 0;
  let bytesFreed = 0;
  let kept = 0;

  for (const sessionDir of readdirSync(root)) {
    const dirPath = join(root, sessionDir);
    let entries: string[];
    try { entries = readdirSync(dirPath); } catch { continue; }
    for (const name of entries) {
      if (name === 'manifest.jsonl') continue;
      const file = join(dirPath, name);
      let s;
      try { s = statSync(file); } catch { continue; }
      if (s.mtimeMs < cutoff) {
        bytesFreed += s.size;
        if (!dryRun) rmSync(file, { force: true });
        pruned += 1;
      } else {
        kept += 1;
      }
    }
  }

  if (options.json || options.j) {
    console.log(JSON.stringify({ success: true, dryRun, days, pruned, kept, bytesFreed }, null, 2));
    return;
  }
  const verb = dryRun ? 'Would prune' : 'Pruned';
  ui.success(`${verb} ${pruned} snapshot(s) older than ${days}d (${(bytesFreed / 1024 / 1024).toFixed(1)} MiB), kept ${kept}.`);
}

function printUsage(): void {
  console.log('Usage: pd snapshots <list|show|restore|prune> [options]');
  console.log('');
  console.log('  pd snapshots list [--session <id>] [--path <substr>] [--limit N] [--json]');
  console.log('  pd snapshots show <snapshotPath-or-suffix>');
  console.log('  pd snapshots restore <snapshotPath-or-suffix> [--target <path>] [--force]');
  console.log('  pd snapshots prune [--days N] [--dry-run] [--json]    # default --days 7');
}

export async function handleSnapshots(positional: string[], options: CLIOptions): Promise<void> {
  const subcommand = positional[0] || 'list';
  const rest = positional.slice(1);
  switch (subcommand) {
    case 'list':
    case 'ls':
      handleList(options);
      return;
    case 'show':
    case 'cat':
      handleShow(rest, options);
      return;
    case 'restore':
      handleRestore(rest, options);
      return;
    case 'prune':
    case 'gc':
      handlePrune(options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      // Treat bare "pd snapshots <suffix>" as a list+filter shortcut.
      handleList({ ...options, path: subcommand });
  }
}
