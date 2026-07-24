/**
 * Harbormaster CLI — operator surface for the merge-owning actor.
 *
 *   pd harbormaster start    — launch the body (foreground or via launchd)
 *   pd harbormaster stop     — graceful SIGTERM
 *   pd harbormaster status   — current queue summary + last merge / conflict
 *   pd harbormaster queue    — pretty-print the merge queue
 *
 * The body itself lives in lib/harbormaster.ts. This CLI is a thin operator
 * wrapper; nothing here decides what to merge.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initDatabase } from '../../lib/db.js';
import { type DatabaseInstance } from '../../lib/sqlite-runtime.js';
import {
  createHarbormaster,
  HARBORMASTER_ACTOR_ID,
  DEFAULT_POLL_INTERVAL_MS,
} from '../../lib/harbormaster.js';
import { jscSafeModeEnv } from '../../shared/daemon-binary.js';
import type { CLIOptions } from '../types.js';

const PID_FILE = join(homedir(), '.port-daddy', 'harbormaster.pid');

function ensurePdDir(): void {
  const dir = join(homedir(), '.port-daddy');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writePidFile(pid: number): void {
  ensurePdDir();
  writeFileSync(PID_FILE, String(pid), 'utf8');
}

function deletePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────────

export async function handleHarbormaster(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0] ?? 'status';
  switch (sub) {
    case 'start':
      await cmdStart(options);
      return;
    case 'stop':
      await cmdStop();
      return;
    case 'status':
      await cmdStatus(options);
      return;
    case 'queue':
      await cmdQueue(options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      console.error(`pd harbormaster: unknown subcommand '${sub}'`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.log(`Usage: pd harbormaster <command>

Commands:
  start [--foreground]   Launch the harbormaster body. Default forks a detached child
                         that writes ${PID_FILE}. --foreground keeps it attached.
  stop                   Send SIGTERM to the running body.
  status [--json]        Current queue summary + body PID liveness.
  queue [--json]         Pretty-print the merge queue (queued + blocked + merged).
  help                   This message.

Safety: harbormaster never merges a row unless its dispatch row is state='accepted'
AND the merge_queue row is state='queued'. All destructive git verbs flow through
the pd-shim wrapper; PD_SHIM_OFF is never set by this body.`);
}

async function cmdStart(options: CLIOptions): Promise<void> {
  const existing = readPidFile();
  if (existing && processAlive(existing)) {
    console.log(`harbormaster already running (pid ${existing})`);
    return;
  }

  if (options['foreground'] || options['fg']) {
    await runForeground();
    return;
  }

  // Fork a detached child running this same CLI in --foreground mode.
  // Using the operator's own pd binary keeps the dependency chain honest.
  // JSC safe-mode (#676): harbormaster is a long-lived Bun polling daemon, same native-crash
  // surface as the main daemon. Bake BUN_JSC_* into the detached child at spawn (JSC reads at init).
  const child = spawn(process.argv[0]!, [process.argv[1]!, 'harbormaster', 'start', '--foreground'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...jscSafeModeEnv() },
  });
  child.unref();
  writePidFile(child.pid ?? 0);
  console.log(`harbormaster started (pid ${child.pid}) — log via pd note tail`);
}

async function runForeground(): Promise<void> {
  writePidFile(process.pid);
  const db = openDb();
  const hm = createHarbormaster({ db, pollIntervalMs: DEFAULT_POLL_INTERVAL_MS });

  hm.events.on('harbormaster:merged', (e) =>
    console.log(`[harbormaster] merged #${e.id} ${e.branch} -> ${e.baseBranch} (${e.mergeStyle})`),
  );
  hm.events.on('harbormaster:conflict', (e) =>
    console.log(`[harbormaster] conflict #${e.id} files=${e.files.join(',')} -> back to produced`),
  );
  hm.events.on('harbormaster:blocked', (e) =>
    console.log(`[harbormaster] blocked #${e.id}: ${e.reason}`),
  );

  const { leased } = await hm.start();
  if (!leased) {
    console.error('harbormaster: another body holds the lease; exiting');
    deletePidFile();
    process.exit(2);
  }

  const shutdown = async () => {
    console.log('[harbormaster] shutting down...');
    await hm.stop();
    deletePidFile();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Park forever. The polling loop fires via setInterval inside the body.
  await new Promise(() => {});
}

async function cmdStop(): Promise<void> {
  const pid = readPidFile();
  if (!pid) {
    console.log('harbormaster: no pid file; not running');
    return;
  }
  if (!processAlive(pid)) {
    console.log(`harbormaster: pid ${pid} not alive; cleaning pid file`);
    deletePidFile();
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`harbormaster: SIGTERM sent to pid ${pid}`);
  } catch (e) {
    console.error(`harbormaster: failed to signal pid ${pid}:`, (e as Error).message);
    process.exit(1);
  }
}

async function cmdStatus(options: CLIOptions): Promise<void> {
  const pid = readPidFile();
  const alive = pid ? processAlive(pid) : false;
  const db = openDb();
  const hm = createHarbormaster({ db });
  const summary = hm.queueSummary();
  const lastMerged = readLastMergedRow(db);
  const lastBlocked = readLastBlockedRow(db);

  const out = {
    actor: HARBORMASTER_ACTOR_ID,
    body: { pid, alive },
    schemaReady: hm.schemaHasDispatchColumns(),
    queue: summary,
    lastMerged,
    lastBlocked,
  };

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Harbormaster: ${alive ? `running (pid ${pid})` : 'not running'}`);
  console.log(`Schema ready: ${out.schemaReady ? 'yes' : 'no — dispatch columns not on this db'}`);
  console.log(
    `Queue: ${summary.queued} queued / ${summary.blocked} blocked / ${summary.merged} merged / ${summary.candidates} ready-to-merge`,
  );
  if (lastMerged) {
    console.log(`Last merged: #${lastMerged.id} ${lastMerged.branch} @ ${formatTs(lastMerged.merged_at)}`);
  }
  if (lastBlocked) {
    console.log(`Last blocked: #${lastBlocked.id} ${lastBlocked.branch} — ${lastBlocked.failure_reason}`);
  }
}

async function cmdQueue(options: CLIOptions): Promise<void> {
  const db = openDb();
  const hm = createHarbormaster({ db });
  const candidates = hm.findCandidates();

  // Also list non-ready rows in queue so the operator sees the whole picture.
  const stateCol = hasCol(db, 'merge_queue', 'state') ? 'state' : 'status';
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db
      .prepare(
        `SELECT id, branch, base_branch, ${stateCol} AS state, dispatch_id, failure_reason
         FROM merge_queue ORDER BY submitted_at DESC LIMIT 50`,
      )
      .all() as Array<Record<string, unknown>>;
  } catch {
    rows = [];
  }

  if (options['json'] || options['j']) {
    console.log(JSON.stringify({ candidates, recent: rows }, null, 2));
    return;
  }

  console.log(`Ready to merge (two-key satisfied): ${candidates.length}`);
  for (const c of candidates) {
    console.log(
      `  #${c.id} ${c.branch} -> ${c.baseBranch} (${c.mergeStyle}, dispatch=${c.dispatchId})`,
    );
  }
  console.log('');
  console.log(`Recent merge_queue rows:`);
  for (const r of rows) {
    const reason = r['failure_reason'] ? ` — ${r['failure_reason']}` : '';
    console.log(`  #${r['id']} ${r['branch']} -> ${r['base_branch']}  [${r['state']}]${reason}`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function openDb(): DatabaseInstance {
  // Route through the canonical chokepoint so assertNotProdInTest() runs and
  // test traffic can never leak into the live registry (see lib/db.ts guard
  // + tests/unit/no-direct-database-open.test.js).
  return initDatabase();
}

function hasCol(db: DatabaseInstance, table: string, col: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === col);
  } catch {
    return false;
  }
}

function readLastMergedRow(db: DatabaseInstance): {
  id: number;
  branch: string;
  merged_at: number | null;
} | null {
  try {
    const stateCol = hasCol(db, 'merge_queue', 'state') ? 'state' : 'status';
    const row = db
      .prepare(
        `SELECT id, branch, merged_at FROM merge_queue WHERE ${stateCol} = 'merged'
         ORDER BY merged_at DESC LIMIT 1`,
      )
      .get() as { id: number; branch: string; merged_at: number | null } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function readLastBlockedRow(db: DatabaseInstance): {
  id: number;
  branch: string;
  failure_reason: string;
} | null {
  try {
    const stateCol = hasCol(db, 'merge_queue', 'state') ? 'state' : 'status';
    const row = db
      .prepare(
        `SELECT id, branch, failure_reason FROM merge_queue WHERE ${stateCol} = 'blocked'
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number; branch: string; failure_reason: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function formatTs(ms: number | null | undefined): string {
  if (!ms) return 'unknown';
  return new Date(ms).toISOString();
}
