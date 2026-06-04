/**
 * The invariant checks (ADR-0045, phases 1–3), across all six classes.
 *
 * Every check reads an injected probe from AttestContext. A probe that is
 * UNDEFINED means "not checkable in this context" → the check returns SKIPPED
 * (honest: we don't claim a green we didn't earn). A probe that runs but finds
 * a problem returns FAIL with a `fix`. This keeps the whole set unit-testable
 * with mocked probes and reusable both daemon-side and CLI-side.
 */

import type { AttestReport, Invariant, CheckOutcome } from './attest.js';

export interface AttestContext {
  // ── liveness ──
  daemonHealth?: () => Promise<{ status?: string; version?: string } | null>;
  /** Version the CLI/package expects; compared to the daemon's reported version. */
  expectedVersion?: string;
  /** Whether the running daemon is the install we expect (homebrew-vs-repo trap). */
  daemonPathExpected?: () => boolean | null;
  /** Does the CLI emit output when captured (piped/non-TTY)? Silence = mute = failure. */
  cliSelfSpeech?: () => Promise<{ speaks: boolean; reason: string; remediation?: string }>;
  // ── integrity ──
  dbIntegrityCheck?: () => string; // sqlite 'ok' or error text
  schemaTables?: () => string[];
  requiredTables?: string[];
  prodDaemonOnTestDb?: () => boolean | null;
  lastBackupAgeMs?: () => number | null;
  backupMaxAgeMs?: number; // default 24h
  // ── security ──
  cryptoSelfTest?: () => Promise<boolean> | boolean; // sign→verify roundtrip
  dbFileMode?: () => number | null; // octal, e.g. 0o600
  // ── provenance ──
  installedBinarySha?: () => Promise<string | null>;
  tapDeclaredSha?: () => Promise<string | null>;
  // ── coordination ──
  committedActorsUp?: () => Promise<Array<{ id: string; up: boolean }>>;
  guardMode?: () => string | null; // 'enforce' | 'advisory' | null
  // ── cost ──
  budgetOverrun?: () => boolean | null;
}

const SKIP = (why: string): CheckOutcome => ({ status: 'skipped', detail: why });
const DEFAULT_BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function createInvariants(): Invariant<AttestContext>[] {
  return [
    // ── LIVENESS ──────────────────────────────────────────────────────────
    {
      id: 'liveness.daemon-responds',
      class: 'liveness',
      severity: 'critical',
      title: 'daemon responds and reports ok',
      async run(ctx) {
        if (!ctx.daemonHealth) return SKIP('no daemon-health probe wired');
        const h = await ctx.daemonHealth();
        if (!h) return { status: 'fail', detail: 'daemon did not respond', fix: 'run `pd start`' };
        if (h.status && h.status !== 'ok') {
          return { status: 'fail', detail: `health status=${h.status}`, fix: 'inspect daemon logs' };
        }
        return { status: 'pass', detail: `version ${h.version ?? '?'}` };
      },
    },
    {
      id: 'liveness.cli-daemon-version-match',
      class: 'liveness',
      severity: 'warn',
      title: 'CLI and daemon report the same version',
      async run(ctx) {
        if (!ctx.daemonHealth || !ctx.expectedVersion) return SKIP('no version probe wired');
        const h = await ctx.daemonHealth();
        if (!h?.version) return SKIP('daemon did not report a version');
        return h.version === ctx.expectedVersion
          ? { status: 'pass', detail: h.version }
          : {
              status: 'fail',
              detail: `daemon ${h.version} != CLI ${ctx.expectedVersion}`,
              fix: 'restart the daemon onto the upgraded binary (`brew services restart …` / `pd restart`)',
            };
      },
    },
    {
      id: 'liveness.daemon-from-expected-install',
      class: 'liveness',
      severity: 'warn',
      title: 'daemon runs from the expected install path',
      run(ctx) {
        if (!ctx.daemonPathExpected) return SKIP('no install-path probe wired');
        const ok = ctx.daemonPathExpected();
        if (ok === null) return SKIP('install path could not be determined');
        return ok
          ? { status: 'pass' }
          : { status: 'fail', detail: 'daemon is not the expected install', fix: 'stop stray daemons; run the homebrew install' };
      },
    },
    {
      // Silence is not success: a CLI that emits ZERO output when captured is a
      // mute-tool liveness failure (the bun-stdio-in-sandbox trap). Detect it
      // rather than infer it after an hour of confusion. See lib/cli-liveness.ts.
      id: 'liveness.cli-self-speech',
      class: 'liveness',
      severity: 'critical',
      title: 'CLI emits output when captured (not mute)',
      async run(ctx) {
        if (!ctx.cliSelfSpeech) return SKIP('no CLI self-speech probe wired');
        const v = await ctx.cliSelfSpeech();
        return v.speaks
          ? { status: 'pass', detail: v.reason }
          : { status: 'fail', detail: v.reason, fix: v.remediation ?? 'route around the mute CLI via daemon HTTP routes' };
      },
    },

    // ── INTEGRITY ─────────────────────────────────────────────────────────
    {
      id: 'integrity.db-integrity-check',
      class: 'integrity',
      severity: 'critical',
      title: 'PRAGMA integrity_check is ok',
      run(ctx) {
        if (!ctx.dbIntegrityCheck) return SKIP('no DB integrity probe wired');
        const r = ctx.dbIntegrityCheck();
        return r === 'ok'
          ? { status: 'pass' }
          : { status: 'fail', detail: r, fix: 'restore from `pd backup` (do NOT keep writing to a corrupt DB)' };
      },
    },
    {
      id: 'integrity.schema-present',
      class: 'integrity',
      severity: 'critical',
      title: 'all required tables exist',
      run(ctx) {
        if (!ctx.schemaTables || !ctx.requiredTables) return SKIP('no schema probe wired');
        const present = new Set(ctx.schemaTables());
        const missing = ctx.requiredTables.filter((t) => !present.has(t));
        return missing.length === 0
          ? { status: 'pass' }
          : { status: 'fail', detail: `missing tables: ${missing.join(', ')}`, fix: 'run migrations / rebuild schema' };
      },
    },
    {
      id: 'integrity.prod-not-on-test-db',
      class: 'integrity',
      severity: 'critical',
      title: 'prod daemon is not pointed at a test DB',
      run(ctx) {
        if (!ctx.prodDaemonOnTestDb) return SKIP('no prod/test DB probe wired');
        const onTest = ctx.prodDaemonOnTestDb();
        if (onTest === null) return SKIP('could not determine DB context');
        return onTest
          ? { status: 'fail', detail: 'prod daemon is using a test DB', fix: 'fix PD_DB_PATH / resolver; restart' }
          : { status: 'pass' };
      },
    },
    {
      id: 'integrity.backup-fresh',
      class: 'integrity',
      severity: 'warn',
      title: 'a recent backup exists',
      run(ctx) {
        if (!ctx.lastBackupAgeMs) return SKIP('no backup-age probe wired');
        const age = ctx.lastBackupAgeMs();
        if (age === null) return { status: 'fail', detail: 'no backup found', fix: 'run `pd backup`' };
        const max = ctx.backupMaxAgeMs ?? DEFAULT_BACKUP_MAX_AGE_MS;
        return age <= max
          ? { status: 'pass', detail: `${Math.round(age / 3.6e6)}h old` }
          : { status: 'fail', detail: `last backup ${Math.round(age / 3.6e6)}h old`, fix: 'run `pd backup`' };
      },
    },

    // ── SECURITY ──────────────────────────────────────────────────────────
    {
      id: 'security.crypto-self-test',
      class: 'security',
      severity: 'critical',
      title: 'crypto sign→verify round-trip works',
      async run(ctx) {
        if (!ctx.cryptoSelfTest) return SKIP('no crypto self-test probe wired');
        const ok = await ctx.cryptoSelfTest();
        return ok
          ? { status: 'pass' }
          : { status: 'fail', detail: 'sign→verify failed', fix: 'crypto/keystore is broken — do not trust signatures; inspect keys' };
      },
    },
    {
      id: 'security.db-file-perms',
      class: 'security',
      severity: 'warn',
      title: 'DB file is not world-readable',
      run(ctx) {
        if (!ctx.dbFileMode) return SKIP('no DB file-mode probe wired');
        const mode = ctx.dbFileMode();
        if (mode === null) return SKIP('could not stat DB file');
        const worldReadable = (mode & 0o004) !== 0;
        return worldReadable
          ? { status: 'fail', detail: `mode ${mode.toString(8)}`, fix: 'chmod 600 the DB file' }
          : { status: 'pass', detail: mode.toString(8) };
      },
    },

    // ── PROVENANCE ────────────────────────────────────────────────────────
    {
      id: 'provenance.brew-hash-match',
      class: 'provenance',
      severity: 'critical',
      title: 'installed binary SHA matches the tap formula',
      async run(ctx) {
        if (!ctx.installedBinarySha || !ctx.tapDeclaredSha) return SKIP('no provenance probe wired');
        const [got, want] = await Promise.all([ctx.installedBinarySha(), ctx.tapDeclaredSha()]);
        if (!got || !want) return SKIP('could not read installed or declared SHA');
        return got === want
          ? { status: 'pass', detail: got.slice(0, 12) }
          : { status: 'fail', detail: `installed ${got.slice(0, 12)} != tap ${want.slice(0, 12)}`, fix: 'reinstall from the tap; investigate tampering / partial upgrade' };
      },
    },

    // ── COORDINATION ──────────────────────────────────────────────────────
    {
      id: 'coordination.committed-actors-up',
      class: 'coordination',
      severity: 'critical',
      title: 'committed actors (e.g. Cartographer) are up',
      async run(ctx) {
        if (!ctx.committedActorsUp) return SKIP('no committed-actor probe wired');
        const actors = await ctx.committedActorsUp();
        if (actors.length === 0) return SKIP('no committed actors registered');
        const down = actors.filter((a) => !a.up).map((a) => a.id);
        return down.length === 0
          ? { status: 'pass', detail: `${actors.length} up` }
          : { status: 'fail', detail: `down: ${down.join(', ')}`, fix: 'restart the actor / honor or release its commitment (ADR-0041)' };
      },
    },
    {
      id: 'coordination.guard-enforcing',
      class: 'coordination',
      severity: 'warn',
      title: 'Coordination Guard is enforcing',
      run(ctx) {
        if (!ctx.guardMode) return SKIP('no guard-mode probe wired');
        const mode = ctx.guardMode();
        if (mode === null) return SKIP('guard mode unknown');
        return mode === 'enforce'
          ? { status: 'pass' }
          : { status: 'fail', detail: `mode=${mode}`, fix: 'run `pd guard install --mode enforce`' };
      },
    },

    // ── COST ──────────────────────────────────────────────────────────────
    {
      id: 'cost.no-budget-overrun',
      class: 'cost',
      severity: 'warn',
      title: 'no budget overrun',
      run(ctx) {
        if (!ctx.budgetOverrun) return SKIP('no budget probe wired');
        const over = ctx.budgetOverrun();
        if (over === null) return SKIP('budget state unknown');
        return over
          ? { status: 'fail', detail: 'budget exceeded', fix: 'pause spawning / raise the cap' }
          : { status: 'pass' };
      },
    },
  ];
}

/** Required tables the schema check expects (extend as the schema grows). */
export const CORE_REQUIRED_TABLES = [
  'roadmap_items',
  'messages',
  'agents',
  'sessions',
  'locks',
];

export type { AttestReport };
