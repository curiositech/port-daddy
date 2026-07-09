import type { Severity } from './health-severity.js';

export const DAEMON_OUTER_SUPERVISOR_LABELS = [
  'homebrew.mxcl.port-daddy',
  'com.portdaddy.daemon',
] as const;

export type SupervisorState = 'ready' | 'degraded' | 'blocked' | 'unknown';

export interface OuterSupervisor {
  label: string;
  loaded: boolean;
  running: boolean;
  pid: number | null;
}

export interface SupervisorRepair {
  command: string;
  description: string;
}

export interface SupervisorIntegrityAssessment {
  severity: Severity;
  detail: string;
  hint?: string;
  repair?: SupervisorRepair;
}

export interface CrashLedgerEntry {
  at: number;
  kind: 'crash' | 'restart-attempt' | 'restart-suppressed';
  classification?: string | null;
  detail?: string;
  source?: 'bosun' | 'pd-supervisor' | 'launchd' | 'doctor' | string;
}

export interface CrashLedgerProjection {
  severity: Severity;
  windowMs: number;
  total: number;
  crashCount: number;
  restartAttemptCount: number;
  missingClassificationCount: number;
  lastCrashAt: number | null;
  lastRestartAttemptAt: number | null;
  classifications: Record<string, number>;
  reasons: string[];
}

export interface RestartPolicyDecision {
  allowed: boolean;
  action: 'restart' | 'suppress_duplicate_restart' | 'halt_restart_loop';
  reason: string;
  lastRestartAttemptAt: number | null;
  nextAllowedAt: number | null;
  recentRestartAttempts: number;
}

export interface StaleVersionAssessment {
  severity: Severity;
  stale: boolean;
  reason: string;
  runningVersion: string | null;
  latestVersion: string | null;
}

export interface PdSupervisorProjection {
  state: SupervisorState;
  severity: Severity;
  outerSupervisor: SupervisorIntegrityAssessment;
  crashLedger: CrashLedgerProjection;
  restartPolicy: RestartPolicyDecision;
  staleVersion: StaleVersionAssessment;
  duties: string[];
  legacyBosun: {
    role: 'implementation-retained' | 'not-present';
    reason: string;
  };
}

const DEFAULT_CRASH_LEDGER_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_RESTART_BACKOFF_MS = 30_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 5;

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, critical: 2 };

function worstSeverity(values: Severity[]): Severity {
  return values.reduce<Severity>((worst, value) => (
    SEVERITY_RANK[value] > SEVERITY_RANK[worst] ? value : worst
  ), 'ok');
}

function stateFromSeverity(severity: Severity): SupervisorState {
  if (severity === 'critical') return 'blocked';
  if (severity === 'warn') return 'degraded';
  return 'ready';
}

export function assessOuterSupervisorIntegrity(input: {
  supervisors: OuterSupervisor[];
  daemonReachable: boolean;
  platform?: NodeJS.Platform;
}): SupervisorIntegrityAssessment {
  const plat = input.platform ?? process.platform;
  if (plat !== 'darwin') {
    return { severity: 'ok', detail: `Supervision integrity is a macOS-only check (skipped on ${plat})` };
  }

  const loaded = input.supervisors.filter((s) => s.loaded);
  const running = loaded.filter((s) => s.running);

  if (loaded.length === 0) {
    if (input.daemonReachable) {
      return {
        severity: 'warn',
        detail: 'Daemon is reachable but NO launchd supervisor owns it - it will not be resurrected if it dies',
        hint: 'Run: port-daddy install   (installs the launchd supervisor)',
        repair: { command: 'port-daddy install', description: 'Installs the launchd supervisor for the running daemon.' },
      };
    }
    return {
      severity: 'critical',
      detail: 'No launchd supervisor is loaded and the daemon is not reachable',
      hint: 'Run: port-daddy install   then: port-daddy start',
      repair: { command: 'port-daddy install', description: 'Installs the launchd supervisor, then start the daemon with port-daddy start.' },
    };
  }

  if (loaded.length >= 2) {
    return {
      severity: 'warn',
      detail: `${loaded.length} supervisors loaded (${loaded.map((s) => s.label).join(', ')}) - duplicate KeepAlive jobs race the listener`,
      hint: `Keep exactly one. Unload the duplicate: launchctl bootout gui/$(id -u)/${loaded[1].label}`,
      repair: {
        command: `launchctl bootout gui/$(id -u)/${loaded[1].label}`,
        description: 'Unloads the duplicate supervisor so exactly one KeepAlive job owns the daemon.',
      },
    };
  }

  const one = loaded[0];
  if (running.length >= 1) {
    return { severity: 'ok', detail: `${one.label} is loaded and running (PID ${one.pid})` };
  }

  if (input.daemonReachable) {
    return {
      severity: 'warn',
      detail: `${one.label} is loaded but its process is not running - the daemon is currently UNSUPERVISED (reachable now, but won't be resurrected)`,
      hint: `Re-kick the supervisor: launchctl kickstart -k gui/$(id -u)/${one.label}`,
      repair: {
        command: `launchctl kickstart -k gui/$(id -u)/${one.label}`,
        description: 'Re-kicks the loaded supervisor so the daemon is resurrected if it dies.',
      },
    };
  }

  return {
    severity: 'critical',
    detail: `${one.label} is loaded but not running, and the daemon is not reachable - this is how the daemon silently dies`,
    hint: `Re-kick the supervisor: launchctl kickstart -k gui/$(id -u)/${one.label}`,
    repair: {
      command: `launchctl kickstart -k gui/$(id -u)/${one.label}`,
      description: 'Re-kicks the loaded supervisor and restarts the daemon.',
    },
  };
}

export function projectCrashLedger(
  entries: CrashLedgerEntry[],
  opts: { nowMs?: number; windowMs?: number } = {},
): CrashLedgerProjection {
  const nowMs = opts.nowMs ?? Date.now();
  const windowMs = opts.windowMs ?? DEFAULT_CRASH_LEDGER_WINDOW_MS;
  const since = nowMs - windowMs;
  const recent = entries.filter((entry) => entry.at >= since && entry.at <= nowMs);
  const classifications: Record<string, number> = {};
  let missingClassificationCount = 0;
  let crashCount = 0;
  let restartAttemptCount = 0;
  let lastCrashAt: number | null = null;
  let lastRestartAttemptAt: number | null = null;

  for (const entry of recent) {
    if (entry.kind === 'crash') {
      crashCount += 1;
      lastCrashAt = Math.max(lastCrashAt ?? 0, entry.at);
      if (!entry.classification) {
        missingClassificationCount += 1;
      }
    }
    if (entry.kind === 'restart-attempt') {
      restartAttemptCount += 1;
      lastRestartAttemptAt = Math.max(lastRestartAttemptAt ?? 0, entry.at);
    }
    if (entry.classification) {
      classifications[entry.classification] = (classifications[entry.classification] ?? 0) + 1;
    }
  }

  const reasons: string[] = [];
  if (missingClassificationCount > 0) {
    reasons.push(`${missingClassificationCount} crash ledger entr${missingClassificationCount === 1 ? 'y is' : 'ies are'} missing classification`);
  }
  if (crashCount >= 3) {
    reasons.push(`${crashCount} daemon crash events inside ${windowMs}ms`);
  }

  const severity: Severity =
    crashCount >= 3 ? 'critical' :
    missingClassificationCount > 0 || crashCount > 0 ? 'warn' :
    'ok';

  return {
    severity,
    windowMs,
    total: recent.length,
    crashCount,
    restartAttemptCount,
    missingClassificationCount,
    lastCrashAt,
    lastRestartAttemptAt,
    classifications,
    reasons,
  };
}

export function decideRestartPolicy(input: {
  entries: CrashLedgerEntry[];
  nowMs?: number;
  backoffMs?: number;
  windowMs?: number;
  maxRestartAttemptsPerWindow?: number;
}): RestartPolicyDecision {
  const nowMs = input.nowMs ?? Date.now();
  const backoffMs = input.backoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
  const windowMs = input.windowMs ?? DEFAULT_CRASH_LEDGER_WINDOW_MS;
  const maxRestarts = input.maxRestartAttemptsPerWindow ?? DEFAULT_MAX_RESTARTS_PER_WINDOW;
  const since = nowMs - windowMs;
  const restartAttempts = input.entries
    .filter((entry) => entry.kind === 'restart-attempt' && entry.at >= since && entry.at <= nowMs)
    .sort((a, b) => b.at - a.at);
  const lastRestartAttemptAt = restartAttempts[0]?.at ?? null;

  if (restartAttempts.length >= maxRestarts) {
    return {
      allowed: false,
      action: 'halt_restart_loop',
      reason: `${restartAttempts.length} restart attempts inside ${windowMs}ms`,
      lastRestartAttemptAt,
      nextAllowedAt: lastRestartAttemptAt === null ? null : lastRestartAttemptAt + backoffMs,
      recentRestartAttempts: restartAttempts.length,
    };
  }

  if (lastRestartAttemptAt !== null && nowMs - lastRestartAttemptAt < backoffMs) {
    return {
      allowed: false,
      action: 'suppress_duplicate_restart',
      reason: `last restart attempt was ${nowMs - lastRestartAttemptAt}ms ago; backoff is ${backoffMs}ms`,
      lastRestartAttemptAt,
      nextAllowedAt: lastRestartAttemptAt + backoffMs,
      recentRestartAttempts: restartAttempts.length,
    };
  }

  return {
    allowed: true,
    action: 'restart',
    reason: 'restart allowed by pd-supervisor policy',
    lastRestartAttemptAt,
    nextAllowedAt: null,
    recentRestartAttempts: restartAttempts.length,
  };
}

function parseReleaseVersion(version: string | null | undefined): [number, number, number] | null {
  if (!version) return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[+_.-].*)?$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareReleaseVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

export function assessStaleVersion(input: {
  runningVersion?: string | null;
  latestVersion?: string | null;
  berthTier?: string | null;
}): StaleVersionAssessment {
  const runningVersion = input.runningVersion ?? null;
  const latestVersion = input.latestVersion ?? null;
  const berthTier = input.berthTier ?? 'stable';

  if (berthTier !== 'stable') {
    return {
      severity: 'ok',
      stale: false,
      reason: `release-feed stale-version checks are skipped for ${berthTier} berths`,
      runningVersion,
      latestVersion,
    };
  }

  const comparison = compareReleaseVersions(runningVersion, latestVersion);
  if (comparison === null) {
    return {
      severity: 'ok',
      stale: false,
      reason: 'not enough parseable release-version evidence to mark daemon stale',
      runningVersion,
      latestVersion,
    };
  }

  if (comparison < 0) {
    return {
      severity: 'warn',
      stale: true,
      reason: `stable daemon ${runningVersion} is older than release feed ${latestVersion}`,
      runningVersion,
      latestVersion,
    };
  }

  return {
    severity: 'ok',
    stale: false,
    reason: `stable daemon ${runningVersion} is current with release feed ${latestVersion}`,
    runningVersion,
    latestVersion,
  };
}

export function buildPdSupervisorProjection(input: {
  supervisors: OuterSupervisor[];
  daemonReachable: boolean;
  platform?: NodeJS.Platform;
  crashLedger?: CrashLedgerEntry[];
  nowMs?: number;
  restartBackoffMs?: number;
  runningVersion?: string | null;
  latestVersion?: string | null;
  berthTier?: string | null;
  legacyBosunPresent?: boolean;
}): PdSupervisorProjection {
  const nowMs = input.nowMs ?? Date.now();
  const entries = input.crashLedger ?? [];
  const outerSupervisor = assessOuterSupervisorIntegrity({
    supervisors: input.supervisors,
    daemonReachable: input.daemonReachable,
    platform: input.platform,
  });
  const crashLedger = projectCrashLedger(entries, { nowMs });
  const restartPolicy = decideRestartPolicy({
    entries,
    nowMs,
    backoffMs: input.restartBackoffMs,
  });
  const staleVersion = assessStaleVersion({
    runningVersion: input.runningVersion,
    latestVersion: input.latestVersion,
    berthTier: input.berthTier,
  });
  const severity = worstSeverity([
    outerSupervisor.severity,
    crashLedger.severity,
    staleVersion.severity,
    restartPolicy.allowed ? 'ok' : 'warn',
  ]);

  return {
    state: stateFromSeverity(severity),
    severity,
    outerSupervisor,
    crashLedger,
    restartPolicy,
    staleVersion,
    duties: [
      'readiness',
      'crash-ledger',
      'restart-policy',
      'berth-health',
      'stale-version-detection',
      'duplicate-daemon-detection',
    ],
    legacyBosun: {
      role: input.legacyBosunPresent === false ? 'not-present' : 'implementation-retained',
      reason: input.legacyBosunPresent === false
        ? 'no legacy Bosun implementation was reported'
        : 'pd-bosun remains implementation/history until pd-supervisor owns restart proof and packaging',
    },
  };
}
