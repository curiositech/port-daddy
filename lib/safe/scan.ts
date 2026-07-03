/**
 * lib/safe/scan.ts — the A9/A10 orchestrator for ADR-0088 Phase A (`pd safe`).
 *
 * A8 (`posture-report.ts`) is a PURE reducer: it takes the typed outputs of the
 * read-only sensors A1–A7 and folds them into a {@link PostureReport}. Something
 * has to actually RUN those sensors and gather the {@link PostureInputs}. That is
 * this module — the single composition point the CLI (`pd safe scan`), the daemon
 * route (`GET /safe/scan`), and the MCP tool (`safe_scan`) all call so they
 * produce byte-identical reports.
 *
 * 100% READ-ONLY. It reads files the operator's own UID can already read, shells
 * unprivileged trust/network CLIs (`codesign`, `nettop`, `lsof`, `ps`), and — when
 * a daemon DB handle is supplied — records what it observed into the A5 trust
 * ledger (the only write, and it is the durable spine, not host state). It writes
 * NO host state and emits NO raw secret: every {@link SecretFinding} that crosses
 * this boundary already carries only `path/line/ruleId/last4/entropy`.
 *
 * The opt-in reversible `chmod` (`pd safe fix --auto`) is the ONLY mutation of
 * host state in Phase A and lives in {@link planJewelFixes}/{@link applyJewelFix}
 * here — never run implicitly; the CLI gates it behind an explicit flag and
 * records the prior mode so the change is reversible.
 *
 * NO keyword-NLP anywhere: secret detection is structured key-FORMAT regex +
 * entropy (A1), MCP inventory is structured `command`-array inspection (A7).
 */

import { chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

import { scanHost } from './secret-scanner.js';
import { loadBaseline, applyBaseline } from './baseline.js';
import { auditPerms, jewelTargets } from './perms-audit.js';
import { assessBinary, type TrustRunner } from './binary-trust.js';
import { captureEgressSnapshot, type SpawnLookup } from './egress-snapshot.js';
import { inventoryMcp } from './mcp-inventory.js';
import {
  buildPostureReport,
  type PostureReport,
  type PostureInputs,
} from './posture-report.js';
import type {
  BinaryTrust,
  EgressSnapshot,
  KnownSpawn,
  PermFinding,
} from './types.js';

/** The committed baseline file, relative to a workdir root. */
export const BASELINE_FILENAME = '.pd-secrets-baseline.json';

// ════════════════════════════════════════════════════════════════════════
//  Running-process enumeration (the A4 binary scope)
// ════════════════════════════════════════════════════════════════════════

/** A running process the operator's UID owns: `{ pid, path }`. */
export interface RunningProcess {
  pid: number;
  path: string;
}

/**
 * Injectable shell so the orchestrator is testable without a real host. Uses the
 * {@link TrustRunner} shape (`{ ok, out } | null`) because the binary-trust
 * sensor (A4) needs the exit STATUS, not just stdout (`codesign` signals
 * verify/notarize verdicts via exit code). The string-only sensors (A6 egress,
 * `ps` enumeration) read `.out` and ignore `.ok`.
 */
export type ShellRunner = TrustRunner;

/** Exported for the ENOENT regression test — production callers use the default. */
export const realRunner: ShellRunner = (cmd, args) => {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (e) {
    // A non-zero exit still carries stdout (codesign prints to stdout/stderr on
    // failure) — surface it with ok:false so the trust classifier can read both.
    // != null (not !== undefined): a spawn-level failure — ENOENT for a binary
    // that doesn't exist on this OS, e.g. `nettop` on Linux — sets stdout to
    // NULL in Bun, and .toString() on null crashed the whole scan on CI.
    const err = e as { status?: number; stdout?: Buffer | string | null };
    if (err && err.stdout != null) {
      return { ok: false, out: typeof err.stdout === 'string' ? err.stdout : err.stdout.toString('utf8') };
    }
    return null;
  }
};

/** Adapt a {@link ShellRunner} to the string-only contract A6/`ps` expect. */
function stringRunner(run: ShellRunner): (cmd: string, args: string[]) => string | null {
  return (cmd, args) => {
    const r = run(cmd, args);
    return r ? r.out : null;
  };
}

/**
 * Own-UID running processes via `ps -xo pid=,comm=` (no sudo, no other users).
 * `comm` is the executable path on macOS. Defensive: tolerates malformed lines,
 * a missing `ps`, and deduplicates by absolute path (one assessment per binary —
 * the ledger cache keys on cdhash regardless).
 */
export function enumerateRunningProcesses(run: ShellRunner = realRunner): RunningProcess[] {
  const r = run('ps', ['-xo', 'pid=,comm=']);
  const out = r ? r.out : null;
  if (!out) return [];
  const seen = new Set<string>();
  const procs: RunningProcess[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.indexOf(' ');
    if (sp <= 0) continue;
    const pid = Number(trimmed.slice(0, sp));
    const path = trimmed.slice(sp + 1).trim();
    // Only absolute on-disk binaries (skip kernel threads / bracketed names).
    if (!Number.isInteger(pid) || pid <= 0 || !path.startsWith('/')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    procs.push({ pid, path });
  }
  return procs;
}

// ════════════════════════════════════════════════════════════════════════
//  Trust-ledger recording (A5) — optional, daemon-resident
// ════════════════════════════════════════════════════════════════════════

/**
 * The slice of {@link TrustLedger} the scan needs — a structural type so the
 * orchestrator never imports `bun:sqlite`. The daemon route passes a real
 * `TrustLedger`; pure-fn callers (CLI without a daemon) pass nothing.
 */
export interface LedgerSink {
  record(trust: BinaryTrust): unknown;
}

// ════════════════════════════════════════════════════════════════════════
//  The scan
// ════════════════════════════════════════════════════════════════════════

export interface RunScanOptions {
  /** Operator $HOME. Defaults to os.homedir(). */
  home?: string;
  /** Extra workdir roots whose `.env*` files are also scanned (A1). */
  extraRoots?: string[];
  /** Directory holding the committed `.pd-secrets-baseline.json` (A2). Defaults to cwd. */
  baselineDir?: string;
  /** The host allowlist a flow's remoteHost is checked against (A8). */
  allowlistedHosts?: string[];
  /** Daemon trust ledger to record observed binaries into (A5). Optional. */
  ledger?: LedgerSink;
  /** Resolve a PID → known PD agent for egress correlation (A6). */
  spawnLookup?: SpawnLookup;
  /** Injectable shell for process enumeration + binary trust (tests). */
  run?: ShellRunner;
}

/** The full scan result: the report plus the raw perm findings the fixer needs. */
export interface ScanRunResult {
  report: PostureReport;
  /** A3 perm findings, kept so `pd safe fix --auto` can plan from the same scan. */
  permFindings: PermFinding[];
  /** The binaries A4 assessed, for the ledger / debug surface. */
  binaries: BinaryTrust[];
  /** The A6 egress snapshot (evidence). */
  egress: EgressSnapshot;
}

/**
 * Run A1–A7 and fold them into a deterministic-for-fixed-host {@link PostureReport}.
 * Read-only except the optional A5 ledger record (durable spine, not host state).
 */
export function runSafeScan(opts: RunScanOptions = {}): ScanRunResult {
  const home = opts.home ?? homedir();
  const run = opts.run ?? realRunner;
  const baselineDir = opts.baselineDir ?? process.cwd();

  // ── A1 + A2: secrets at rest, filtered through the committed baseline ──
  const rawScan = scanHost({ home, extraRoots: opts.extraRoots });
  const baseline = loadBaseline(`${baselineDir}/${BASELINE_FILENAME}`);
  const secrets = applyBaseline(rawScan.findings, baseline);

  // ── A3: crown-jewel permission audit + Coast Guard posture ──
  const perms = auditPerms(home);

  // ── A4/A5: assess RUNNING binaries (the live execution surface) ──
  const procs = enumerateRunningProcesses(run);
  const binaries: BinaryTrust[] = [];
  for (const proc of procs) {
    const trust = assessBinary(proc.path, { run, home, pid: proc.pid, isRunningProcess: true });
    binaries.push(trust);
    // A5: record into the durable ledger when a daemon handle is present. The
    // ledger itself caches by (path, cdhash) so a re-scan of an unchanged binary
    // does not re-shell codesign; recording is idempotent + never downgrades an
    // operator verdict.
    if (opts.ledger) {
      try {
        opts.ledger.record(trust);
      } catch {
        // Ledger write is best-effort evidence; a scan must never fail because
        // the durable spine hiccuped. The report stands on the live assessment.
      }
    }
  }

  // ── A6: point-in-time egress snapshot (evidence, not enforcement) ──
  const egress = captureEgressSnapshot({
    run: stringRunner(run),
    lookup: opts.spawnLookup ?? (() => null),
  });

  // ── A7: configured-MCP-server supply-chain inventory ──
  const mcp = inventoryMcp({ home });

  // ── A8: fold into the deterministic posture report ──
  const inputs: PostureInputs = {
    secrets,
    perms,
    binaries,
    egress,
    mcp,
    ...(opts.allowlistedHosts ? { allowlistedHosts: opts.allowlistedHosts } : {}),
  };

  return {
    report: buildPostureReport(inputs),
    permFindings: perms.findings,
    binaries,
    egress,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  A9 `pd safe fix --auto` — the ONLY write to host state in Phase A
// ════════════════════════════════════════════════════════════════════════

/**
 * One planned `chmod`: the crown-jewel path, the mode it has now (`priorMode`,
 * recorded so the change is reversible), and the tightened mode A9 would set.
 * NOTHING is applied by planning — the CLI prints the plan and only applies on
 * an explicit `--auto`.
 */
export interface JewelFixPlan {
  path: string;
  priorMode: string;
  newMode: string;
}

/** Parse an octal mode string like `0644` / `0700` into a number. */
function parseOctal(mode: string): number | null {
  const n = parseInt(mode, 8);
  return Number.isInteger(n) ? n : null;
}

/**
 * Plan the world/group-readable crown-jewel tightenings from A3 findings. ONLY
 * the `exposed` findings with a `recommendedMode` are eligible — a perm that is
 * already correct, or a path that does not exist, is never touched. Pure: returns
 * a plan, applies nothing.
 */
export function planJewelFixes(findings: PermFinding[]): JewelFixPlan[] {
  const plans: JewelFixPlan[] = [];
  for (const f of findings) {
    if (!f.exists) continue;
    if (f.severity !== 'exposed') continue;
    if (!f.recommendedMode) continue;
    if (!(f.worldReadable || f.groupReadable)) continue;
    plans.push({ path: f.path, priorMode: f.mode, newMode: f.recommendedMode });
  }
  return plans;
}

/** The outcome of applying one planned fix — enough to roll it back. */
export interface JewelFixResult {
  path: string;
  priorMode: string;
  newMode: string;
  applied: boolean;
  error?: string;
}

/**
 * Apply ONE planned `chmod`, recording the prior mode it actually read off disk
 * (re-`stat`ed at apply time, never trusting the plan's stale value — TOCTOU
 * hygiene) so the change is reversible. Returns the result; never throws — a
 * failed chmod is reported, not fatal.
 *
 * Injectable `chmod`/`stat` for tests; defaults to the real fs.
 */
export function applyJewelFix(
  plan: JewelFixPlan,
  deps: {
    chmod?: (path: string, mode: number) => void;
    stat?: (path: string) => { mode: number } | null;
  } = {},
): JewelFixResult {
  const chmod = deps.chmod ?? ((p: string, m: number) => chmodSync(p, m));
  const stat =
    deps.stat ??
    ((p: string): { mode: number } | null => {
      try {
        return { mode: statSync(p).mode & 0o777 };
      } catch {
        return null;
      }
    });

  const live = stat(plan.path);
  const priorMode = live ? '0' + (live.mode & 0o777).toString(8).padStart(3, '0') : plan.priorMode;
  const target = parseOctal(plan.newMode);
  if (target === null) {
    return { path: plan.path, priorMode, newMode: plan.newMode, applied: false, error: 'unparseable target mode' };
  }
  try {
    chmod(plan.path, target);
    return { path: plan.path, priorMode, newMode: plan.newMode, applied: true };
  } catch (e) {
    return {
      path: plan.path,
      priorMode,
      newMode: plan.newMode,
      applied: false,
      error: e instanceof Error ? e.message : 'chmod failed',
    };
  }
}

// Re-export the jewel target list so the CLI can show which paths are in scope.
export { jewelTargets };
export type { KnownSpawn };
