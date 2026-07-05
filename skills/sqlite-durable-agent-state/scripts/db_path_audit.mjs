#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Paths a package manager, version manager, or the OS itself can delete out
// from under a running daemon. Checked against the RAW path string, never the
// self-declared `kind` field — the port-daddy 7-db incident happened partly
// because a path's *label* said "data dir" while its *string* pointed into a
// Homebrew Cellar version directory that `brew upgrade` deletes wholesale.
const RISKY_PATH_PATTERNS = [
  { regex: /\/Cellar\//, code: 'CELLAR_PATH_STORAGE', label: 'Homebrew Cellar path (deleted on brew upgrade/cleanup)' },
  { regex: /\/opt\/homebrew\/(opt|Caskroom)\//, code: 'CELLAR_PATH_STORAGE', label: 'Homebrew opt/Caskroom symlink path (version-churns on upgrade)' },
  { regex: /\/(nvm|\.nvm|n\/versions|\.rbenv|\.pyenv|\.volta)\/versions?\//, code: 'VERSION_MANAGER_PATH_STORAGE', label: 'Language version-manager path (deleted when that version is pruned)' },
  { regex: /\/node_modules\//, code: 'NODE_MODULES_PATH_STORAGE', label: 'node_modules path (wiped by every reinstall)' },
  { regex: /^\/(private\/)?tmp\//, code: 'EPHEMERAL_TMP_PATH_STORAGE', label: 'OS temp directory (purged on reboot or by a timer)' },
  { regex: /\/Library\/Caches\//, code: 'CACHE_DIR_PATH_STORAGE', label: 'OS/App cache directory (eligible for OS-initiated cleanup)' },
  { regex: /\.claude\/worktrees\//, code: 'WORKTREE_PATH_STORAGE', label: 'Git worktree path (removed when the worktree is deleted)' },
];

function auditPathString(pathStr) {
  const hits = [];
  for (const pattern of RISKY_PATH_PATTERNS) {
    if (pattern.regex.test(pathStr)) hits.push(pattern);
  }
  return hits;
}

function normalizeJournalMode(mode) {
  return String(mode ?? '').trim().toLowerCase();
}

function isSufficientProbe(postVerify) {
  if (!postVerify || typeof postVerify !== 'object') return false;
  if (!postVerify.table) return false;
  return Boolean(postVerify.probeSql || postVerify.column);
}

export function auditDbPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan must be an object');
  }
  const candidatePaths = asArray(plan.candidatePaths);
  if (candidatePaths.length === 0) {
    throw new Error('plan.candidatePaths must include at least one candidate path');
  }

  const findings = [];
  const pushFinding = (severity, code, message, detail) => {
    findings.push({ severity, code, message, detail: detail ?? null });
  };

  // --- 1. Canonical-path selection & fragmentation ---------------------
  const canonicalPaths = candidatePaths.filter((entry) => entry && entry.canonical === true);
  if (canonicalPaths.length === 0) {
    pushFinding(
      'blocker',
      'NO_CANONICAL_PATH',
      'No candidate path is marked canonical:true. Exactly one path must be authoritative for every reader and writer.',
      { candidateCount: candidatePaths.length },
    );
  } else if (canonicalPaths.length > 1) {
    pushFinding(
      'blocker',
      'PATH_FRAGMENTATION',
      `${canonicalPaths.length} candidate paths are marked canonical. This is the exact shape of the port-daddy 7-.db incident: CLI, snapshot, and export tooling each resolved a different "canonical" path and silently diverged (7 vs 48 vs 89 items).`,
      { canonicalPaths: canonicalPaths.map((entry) => entry.path) },
    );
  }

  // --- 2. Risky physical path locations (checked on ALL candidates, ----
  //        not just the declared canonical one -- self-reported kind is
  //        not trusted, only the literal path string is).
  for (const entry of candidatePaths) {
    const pathStr = String(entry?.path ?? '');
    const hits = auditPathString(pathStr);
    for (const hit of hits) {
      pushFinding(
        entry.canonical ? 'blocker' : 'warning',
        hit.code,
        `${entry.canonical ? 'Canonical' : 'Candidate'} path "${pathStr}" resolves under a ${hit.label}.`,
        { path: pathStr, declaredKind: entry.kind ?? null },
      );
    }
  }

  // --- 3. Env-var pin -----------------------------------------------------
  const envPin = plan.envPin && typeof plan.envPin === 'object' ? plan.envPin : null;
  if (!envPin || !envPin.varName) {
    pushFinding(
      'blocker',
      'MISSING_ENV_PIN',
      'No PORT_DADDY_DB-style env var pin declared. Without a single env-resolved path, different processes (daemon, CLI, snapshot, export) can each fall back to a different default and fragment silently.',
      null,
    );
  } else if (!/^[A-Z][A-Z0-9_]*$/.test(envPin.varName)) {
    pushFinding(
      'warning',
      'MALFORMED_ENV_VAR_NAME',
      `envPin.varName "${envPin.varName}" does not look like a conventional SCREAMING_SNAKE_CASE env var.`,
      { varName: envPin.varName },
    );
  }

  // --- 4. Journal mode + busy_timeout -------------------------------------
  const journalMode = normalizeJournalMode(plan.journalMode);
  const busyTimeoutMs = Number(plan.busyTimeoutMs ?? 0);
  if (journalMode === 'wal') {
    if (!plan.busyTimeoutMs || busyTimeoutMs <= 0) {
      pushFinding(
        'blocker',
        'WAL_NO_BUSY_TIMEOUT',
        'journalMode is "wal" but busyTimeoutMs is unset or 0. WAL improves reader/writer concurrency, it does not remove SQLITE_BUSY on writer contention; without a busy_timeout, concurrent writers crash-loop instead of waiting.',
        { busyTimeoutMs },
      );
    } else if (busyTimeoutMs < 2000) {
      pushFinding(
        'warning',
        'LOW_BUSY_TIMEOUT',
        `busyTimeoutMs is ${busyTimeoutMs}ms, which is thin for a multi-agent writer topology. 2000-5000ms is a safer floor for CLI + daemon contention.`,
        { busyTimeoutMs },
      );
    }
  } else if (journalMode === '' || journalMode === 'off') {
    pushFinding(
      'warning',
      'JOURNAL_MODE_UNSAFE',
      `journalMode "${plan.journalMode ?? '(unset)'}" gives no crash-safety guarantee. Use "wal" for concurrent-reader daemons or "delete"/"truncate" only for genuinely single-writer, single-reader tools.`,
      { journalMode: plan.journalMode ?? null },
    );
  }

  // --- 5. Migration post-apply verification -------------------------------
  const migrations = asArray(plan.migrations);
  if (migrations.length === 0) {
    pushFinding('warning', 'NO_MIGRATIONS_DECLARED', 'plan.migrations is empty; nothing to verify.', null);
  }
  const migrationFindings = migrations.map((migration) => {
    const id = migration?.id ?? '(unnamed migration)';
    if (!migration || typeof migration !== 'object' || !migration.postVerify) {
      pushFinding(
        'blocker',
        'MIGRATION_NO_VERIFY',
        `Migration "${id}" has no postVerify probe. Marking a migration "applied" in history (e.g. \`migration repair --status applied\`) does not run its SQL -- only a real post-apply query proves the table/column exists.`,
        { migrationId: id },
      );
      return { id, sufficient: false };
    }
    if (!isSufficientProbe(migration.postVerify)) {
      pushFinding(
        'warning',
        'MIGRATION_WEAK_VERIFY',
        `Migration "${id}" postVerify names a table but has neither probeSql nor column, so the probe cannot distinguish "table exists" from "table has the expected shape".`,
        { migrationId: id, postVerify: migration.postVerify },
      );
      return { id, sufficient: false };
    }
    return { id, sufficient: true };
  });

  // --- 6. Writer topology --------------------------------------------------
  const writerTopology = plan.writerTopology && typeof plan.writerTopology === 'object' ? plan.writerTopology : {};
  const writers = asArray(writerTopology.writers);
  const strategy = String(writerTopology.strategy ?? 'none');
  const safeStrategies = ['single-writer', 'queue', 'serialized'];
  const concurrentWriters = writers.filter((writer) => (writer?.mode ?? 'concurrent') === 'concurrent');
  if (writers.length > 1 && !safeStrategies.includes(strategy)) {
    pushFinding(
      'blocker',
      'CONCURRENT_WRITERS_UNSAFE',
      `${writers.length} writers are declared (${writers.map((w) => w.name).join(', ')}) with writerTopology.strategy "${strategy}". Multiple writers without a single-writer/queue/serialized strategy is how "upserts vanish across harbors": two writers race a non-atomic read-modify-write and the loser's write is silently lost.`,
      { writers: writers.map((w) => ({ name: w.name, mode: w.mode ?? 'concurrent' })), strategy },
    );
  } else if (concurrentWriters.length > 1 && strategy === 'none') {
    pushFinding(
      'blocker',
      'CONCURRENT_WRITERS_UNSAFE',
      `${concurrentWriters.length} writers are explicitly marked mode:"concurrent" with no serialization strategy declared.`,
      { concurrentWriters: concurrentWriters.map((w) => w.name) },
    );
  }
  if (writers.filter((writer) => writer?.mode === 'exclusive').length > 1) {
    pushFinding(
      'warning',
      'MULTIPLE_EXCLUSIVE_WRITERS',
      'More than one writer is marked mode:"exclusive". Only one process can hold an exclusive writer role at a time; this is a design contradiction, not just a runtime race.',
      { exclusiveWriters: writers.filter((writer) => writer?.mode === 'exclusive').map((writer) => writer.name) },
    );
  }

  const blockerCount = findings.filter((finding) => finding.severity === 'blocker').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const pass = blockerCount === 0;

  const recommendations = [];
  if (canonicalPaths.length !== 1) {
    recommendations.push('Collapse to exactly one canonical:true path and delete/redirect every other candidate before shipping.');
  }
  if (!envPin || !envPin.varName) {
    recommendations.push('Introduce a single env var (PORT_DADDY_DB-style) that every reader and writer resolves the DB path from, with no per-tool fallback default.');
  }
  if (findings.some((finding) => finding.code.endsWith('_PATH_STORAGE') && finding.severity === 'blocker')) {
    recommendations.push('Move the canonical DB under a stable, tool-owned directory such as ~/.<product>/ or an XDG data dir -- never a Cellar/opt/version-manager/node_modules/cache/tmp/worktree path.');
  }
  if (findings.some((finding) => finding.code.endsWith('_PATH_STORAGE') && finding.severity === 'warning')) {
    recommendations.push('Quarantine (rename, do not delete) the non-canonical fossil path(s) flagged above once their data has been merged into the canonical DB.');
  }
  if (journalMode === 'wal' && (!plan.busyTimeoutMs || busyTimeoutMs < 2000)) {
    recommendations.push('Set PRAGMA busy_timeout to at least 2000-5000ms alongside PRAGMA journal_mode=WAL.');
  }
  if (migrationFindings.some((migration) => !migration.sufficient)) {
    recommendations.push('Give every migration a postVerify probe (table + probeSql or column) and run it against the live DB after applying -- never trust migration-history "applied" rows alone.');
  }
  if (writers.length > 1 && !safeStrategies.includes(strategy)) {
    recommendations.push('Route all writes through one process (the daemon) or a serialized queue; readers may stay concurrent under WAL.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Plan looks durable: single canonical env-pinned path, safe journal/busy_timeout pairing, verified migrations, and a serialized writer topology.');
  }

  return {
    pass,
    summary: {
      candidatePathCount: candidatePaths.length,
      canonicalPathCount: canonicalPaths.length,
      migrationCount: migrations.length,
      verifiedMigrationCount: migrationFindings.filter((migration) => migration.sufficient).length,
      writerCount: writers.length,
      writerStrategy: strategy,
      blockerCount,
      warningCount,
    },
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: db_path_audit.mjs --input <plan>.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const plan = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditDbPlan(plan), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`db_path_audit: ${error.message}\n`);
    process.exit(1);
  }
}
