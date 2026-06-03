/**
 * Attestation engine (ADR-0045) — the honest self-report.
 *
 * Port Daddy degrades quietly today. This is the spine of the opposite: run a
 * registry of invariant checks, and report PASS/FAIL/SKIPPED/UNKNOWN per check
 * with a severity. The cardinal rule (ADR-0045 § Honest green): "all good" is
 * CONJUNCTIVE and SCOPED — green only when every CRITICAL and WARN invariant
 * actually PASSED, and the report always lists, loudly, what was SKIPPED or
 * UNKNOWN. Absence of error is never an attestation.
 *
 * This module is PURE: types + summarize + exit-code + render. The checks
 * themselves (which probe the daemon, DB, keychain, brew receipt, …) live in
 * lib/attest-invariants.ts with injected probes, so both this engine and the
 * checks are unit-testable without a running system.
 */

export type Severity = 'critical' | 'warn' | 'info';
export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'unknown';

export type InvariantClass =
  | 'liveness'
  | 'integrity'
  | 'security'
  | 'provenance'
  | 'coordination'
  | 'cost';

/** What a single check returns. */
export interface CheckOutcome {
  status: CheckStatus;
  /** One-line human detail (what was found). Always set for non-pass. */
  detail?: string;
  /** For fail/unknown: the action that fixes it. Required by ADR-0045 — a loud
   *  failure that doesn't name the fix is just a different silent failure. */
  fix?: string;
}

/** A registered invariant: identity + severity + the check thunk. */
export interface Invariant<Ctx = unknown> {
  id: string;
  class: InvariantClass;
  severity: Severity;
  title: string;
  run: (ctx: Ctx) => Promise<CheckOutcome> | CheckOutcome;
}

/** A check outcome stamped with its invariant's identity. */
export interface InvariantResult extends CheckOutcome {
  id: string;
  class: InvariantClass;
  severity: Severity;
  title: string;
}

export interface AttestReport {
  results: InvariantResult[];
  /** Honest green: every critical+warn invariant PASSED (no fail/skipped/unknown). */
  green: boolean;
  counts: Record<CheckStatus, number>;
  /** Critical invariants that are not PASS — the things that must scream. */
  criticalProblems: InvariantResult[];
  /** Everything we could NOT verify — always surfaced, never hidden. */
  unverified: InvariantResult[];
  generatedAt: number;
}

/**
 * Run every invariant against the context. A check that throws becomes
 * `unknown` (we could not determine it) — never a silent pass.
 */
export async function runAttest<Ctx>(
  invariants: Invariant<Ctx>[],
  ctx: Ctx,
  now: () => number = Date.now,
): Promise<AttestReport> {
  const results: InvariantResult[] = [];
  for (const inv of invariants) {
    let outcome: CheckOutcome;
    try {
      outcome = await inv.run(ctx);
    } catch (err) {
      outcome = {
        status: 'unknown',
        detail: `check threw: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'inspect the check; an exception means the invariant could not be evaluated',
      };
    }
    results.push({ id: inv.id, class: inv.class, severity: inv.severity, title: inv.title, ...outcome });
  }
  return summarize(results, now());
}

/** Aggregate results into a report, applying the honest-green rule. */
export function summarize(results: InvariantResult[], generatedAt: number): AttestReport {
  const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, skipped: 0, unknown: 0 };
  for (const r of results) counts[r.status]++;

  // Green requires every CRITICAL and WARN invariant to have PASSED. A skipped
  // or unknown critical/warn is NOT green — we refuse to claim what we didn't
  // verify. INFO-level checks never gate green.
  const gating = results.filter((r) => r.severity !== 'info');
  const green = gating.length > 0 && gating.every((r) => r.status === 'pass');

  // A critical FAILURE (verified-broken) or UNKNOWN (check errored) screams and
  // forces a non-zero exit. A critical SKIPPED (couldn't-check) is NOT a failure
  // — it blocks "green" (we won't claim what we didn't verify) but it is reported
  // only under `unverified`, not as a broken invariant.
  const criticalProblems = results.filter(
    (r) => r.severity === 'critical' && (r.status === 'fail' || r.status === 'unknown'),
  );
  const unverified = results.filter((r) => r.status === 'skipped' || r.status === 'unknown');

  return { results, green, counts, criticalProblems, unverified, generatedAt };
}

/**
 * Process exit code for `pd attest`: non-zero when any CRITICAL invariant is not
 * PASS (so CI / scripts / boot gates fail loudly), 0 otherwise.
 */
export function exitCode(report: AttestReport): number {
  return report.criticalProblems.length > 0 ? 1 : 0;
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skipped: 'SKIP',
  unknown: ' ?? ',
};

/**
 * Human-readable report. Lists everything, then — loudly and separately — the
 * critical problems and the unverified set, so the operator sees the exact
 * boundary of what "good" means right now.
 */
export function renderReport(report: AttestReport): string {
  const lines: string[] = [];
  const byClass = new Map<InvariantClass, InvariantResult[]>();
  for (const r of report.results) {
    if (!byClass.has(r.class)) byClass.set(r.class, []);
    byClass.get(r.class)!.push(r);
  }
  for (const [cls, rs] of byClass) {
    lines.push(`\n[${cls}]`);
    for (const r of rs) {
      const sev = r.severity === 'critical' ? '!' : r.severity === 'warn' ? '~' : ' ';
      let line = `  ${STATUS_GLYPH[r.status]} ${sev} ${r.title}`;
      if (r.detail) line += ` — ${r.detail}`;
      lines.push(line);
      if (r.status !== 'pass' && r.fix) lines.push(`         fix: ${r.fix}`);
    }
  }

  const c = report.counts;
  lines.push(
    `\nsummary: ${c.pass} pass · ${c.fail} fail · ${c.skipped} skipped · ${c.unknown} unknown`,
  );

  if (report.criticalProblems.length > 0) {
    lines.push(`\n!! CRITICAL — ${report.criticalProblems.length} invariant(s) not satisfied:`);
    for (const r of report.criticalProblems) lines.push(`   - ${r.title}: ${r.detail ?? r.status}`);
  }
  if (report.unverified.length > 0) {
    lines.push(`\n?? NOT VERIFIED (${report.unverified.length}) — these are NOT part of "all good":`);
    for (const r of report.unverified) lines.push(`   - ${r.title} [${r.status}]: ${r.detail ?? ''}`);
  }

  if (report.green) {
    lines.push(`\nGREEN: every checked critical+warn invariant passed.`);
    if (report.unverified.length > 0) {
      lines.push(`(scoped — see NOT VERIFIED above for what this green does NOT cover.)`);
    }
  } else {
    lines.push(`\nNOT GREEN: ${report.criticalProblems.length} critical problem(s), ${report.unverified.length} unverified.`);
  }
  return lines.join('\n');
}
