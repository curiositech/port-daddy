/**
 * `pd safe` — the host-safety verb group (ADR-0088 Phase A, A9).
 *
 *   pd safe scan              the read-only posture audit (default). Rich table,
 *                             or `--json` for the structured report.
 *   pd safe baseline accept <id>   triage a NEW secret finding into the committed
 *                             `.pd-secrets-baseline.json` (suppresses it from the
 *                             score; <id> is the finding fingerprint or a prefix).
 *   pd safe fix --auto        the OPT-IN, reversible `chmod` of world/group-readable
 *                             crown jewels ONLY, recording the prior mode. The ONLY
 *                             write to host state in Phase A; never implicit.
 *
 * The scan prefers the daemon route (`GET /safe/scan`) so the A5 binary-trust
 * ledger (daemon-resident, bun:sqlite) is populated + cached. When the daemon is
 * unreachable it falls back to a local in-process scan (no durable ledger) so the
 * audit still works on a cold machine — and SAYS SO, never silently degrading.
 *
 * GREEN ≠ SANDBOXED. The report's `HONEST_LIMITS` footer is printed VERBATIM on
 * every path. NO RAW SECRET is ever printed: findings carry path/line/ruleId/
 * last4 only.
 */
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import {
  runSafeScan,
  planJewelFixes,
  applyJewelFix,
  BASELINE_FILENAME,
} from '../../lib/safe/scan.js';
import { renderPostureReportText, type PostureReport } from '../../lib/safe/posture-report.js';
import { scanHost } from '../../lib/safe/secret-scanner.js';
import {
  loadBaseline,
  writeBaseline,
  triage,
  fingerprint,
} from '../../lib/safe/baseline.js';
import type { CLIOptions } from '../types.js';
import type { SecretFinding } from '../../lib/safe/types.js';

interface SafeScanResponse {
  success?: boolean;
  report?: PostureReport;
  error?: string;
}

/** Fetch the report from the daemon, or null when the daemon is unreachable. */
async function fetchReportFromDaemon(allow?: string): Promise<PostureReport | null> {
  try {
    const qs = allow ? `?allow=${encodeURIComponent(allow)}` : '';
    const res = await pdFetch(`${PORT_DADDY_URL}/safe/scan${qs}`);
    const body = (await res.json()) as SafeScanResponse;
    if (body && body.success && body.report) return body.report;
    return null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
//  pd safe scan
// ════════════════════════════════════════════════════════════════════════

async function handleScan(options: CLIOptions): Promise<void> {
  const allow = typeof options.allow === 'string' ? options.allow : undefined;

  // Prefer the daemon (populates + caches the A5 ledger). Fall back to a local
  // in-process scan when the daemon is down — and say so, never silently.
  let report = await fetchReportFromDaemon(allow);
  let viaDaemon = true;
  if (!report) {
    viaDaemon = false;
    report = runSafeScan(allow ? { allowlistedHosts: allow.split(',').map((h) => h.trim()) } : {}).report;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ viaDaemon, report }, null, 2) + '\n');
  } else {
    process.stdout.write(renderPostureReportText(report) + '\n');
    // Surface fingerprint ids for the NEW secrets so the operator can run
    // `pd safe baseline accept <id>`. Computed locally (same scanner, same
    // $HOME → stable fingerprints); raw value never printed, only ruleId/last4.
    if (report.summary.newSecrets > 0) {
      const fps = newFindingsWithFingerprints();
      if (fps.length > 0) {
        process.stdout.write('\nAccept a finding into the baseline with its id:\n');
        for (const { fp, finding } of fps) {
          process.stdout.write(
            `  ${fp.slice(0, 12)}  ${finding.ruleId}  ${finding.path}:${finding.line} (…${finding.last4})\n`,
          );
        }
        process.stdout.write('  → pd safe baseline accept <id>\n');
      }
    }
    if (!viaDaemon) {
      process.stdout.write(
        '\n(scanned in-process — the daemon was unreachable, so the A5 binary-trust\n' +
          ' ledger was NOT updated. Start the daemon for a cached, durable scan.)\n',
      );
    }
  }

  // Exit code: green → 0, amber → 0 (advisory), red → 1 so CI/boot gates fail.
  process.exit(report.state === 'red' ? 1 : 0);
}

// ════════════════════════════════════════════════════════════════════════
//  pd safe baseline accept <id>
// ════════════════════════════════════════════════════════════════════════

/** All NEW (un-suppressed) findings on this host, each tagged with its fingerprint. */
function newFindingsWithFingerprints(): Array<{ fp: string; finding: SecretFinding }> {
  const result = runSafeScan();
  // The report does not carry fingerprints (it carries only last4/ruleId/path),
  // so re-derive from the same scanner deterministically. A finding that the
  // baseline already suppresses won't be in newSecrets; but to accept it we need
  // the full raw scan, then fingerprint each. We re-scan the host here.
  const baselineDir = process.cwd();
  const baseline = loadBaseline(`${baselineDir}/${BASELINE_FILENAME}`);
  const raw = scanHost({});
  void result;
  return raw.findings
    .map((finding) => ({ fp: fingerprint(finding), finding }))
    .filter(({ fp }) => {
      const entry = baseline.entries.find((e) => e.fingerprint === fp);
      // Surface findings that are not already in a SUPPRESSING state.
      return !entry || (entry.state !== 'accepted' && entry.state !== 'false-positive');
    });
}

function handleBaselineAccept(id: string | undefined, options: CLIOptions): void {
  if (!id) {
    process.stderr.write(
      'pd safe baseline accept <id>: missing finding id.\n' +
        'Run `pd safe scan` first; each new finding line carries its fingerprint id.\n',
    );
    process.exit(2);
  }

  const candidates = newFindingsWithFingerprints();
  const matches = candidates.filter(({ fp }) => fp === id || fp.startsWith(id));
  if (matches.length === 0) {
    process.stderr.write(
      `pd safe baseline accept: no NEW finding matches id "${id}".\n` +
        'Use the full or prefix fingerprint shown by `pd safe scan`.\n',
    );
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write(
      `pd safe baseline accept: id "${id}" is ambiguous (${matches.length} matches). ` +
        'Use a longer prefix.\n',
    );
    process.exit(1);
  }

  const { finding } = matches[0];
  const baselinePath = `${process.cwd()}/${BASELINE_FILENAME}`;
  const baseline = loadBaseline(baselinePath);
  const note = typeof options.note === 'string' ? options.note : undefined;
  const updated = triage(
    baseline,
    { ruleId: finding.ruleId, path: finding.path, last4: finding.last4 },
    'accepted',
    note ? { note } : {},
  );
  writeBaseline(baselinePath, updated);

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          accepted: {
            fingerprint: fingerprint(finding),
            ruleId: finding.ruleId,
            path: finding.path,
            last4: finding.last4,
          },
          baseline: baselinePath,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `Accepted ${finding.ruleId} at ${finding.path} (…${finding.last4}) into ${BASELINE_FILENAME}.\n` +
        'It is suppressed from the posture score on the next scan.\n',
    );
  }
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════════
//  pd safe fix --auto
// ════════════════════════════════════════════════════════════════════════

function handleFix(options: CLIOptions): void {
  const auto = options.auto === true || options.auto === 'true';

  const scan = runSafeScan();
  const plans = planJewelFixes(scan.permFindings);

  if (plans.length === 0) {
    process.stdout.write('No world/group-readable crown jewels to tighten. Nothing to fix.\n');
    process.exit(0);
  }

  if (!auto) {
    // Dry-run: PRINT what `--auto` would do, change NOTHING.
    process.stdout.write('pd safe fix would tighten these crown-jewel permissions:\n\n');
    for (const p of plans) {
      process.stdout.write(`  ${p.path}   ${p.priorMode} -> ${p.newMode}\n`);
    }
    process.stdout.write(
      '\nThis is a DRY RUN. Re-run with `--auto` to apply (reversible — the prior\n' +
        'mode is recorded in the output so you can chmod it back).\n',
    );
    process.exit(0);
  }

  // Apply. Each result records the prior mode (re-stat'ed at apply time) so the
  // change is reversible.
  const results = plans.map((p) => applyJewelFix(p));
  const applied = results.filter((r) => r.applied);
  const failed = results.filter((r) => !r.applied);

  if (options.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  } else {
    for (const r of applied) {
      process.stdout.write(`tightened ${r.path}: ${r.priorMode} -> ${r.newMode}\n`);
    }
    for (const r of failed) {
      process.stdout.write(`SKIPPED  ${r.path}: ${r.error ?? 'unknown error'}\n`);
    }
    if (applied.length > 0) {
      process.stdout.write(
        '\nReversible: to undo any change, `chmod <priorMode> <path>` using the prior\n' +
          'mode printed above.\n',
      );
    }
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

// ════════════════════════════════════════════════════════════════════════
//  Dispatch
// ════════════════════════════════════════════════════════════════════════

export async function handleSafe(positional: string[], options: CLIOptions): Promise<void> {
  const sub = positional[0] ?? 'scan';

  switch (sub) {
    case 'scan':
      await handleScan(options);
      return;
    case 'baseline': {
      const action = positional[1];
      if (action === 'accept') {
        handleBaselineAccept(positional[2], options);
        return;
      }
      process.stderr.write('Usage: pd safe baseline accept <id>\n');
      process.exit(2);
      return;
    }
    case 'fix':
      handleFix(options);
      return;
    default:
      process.stderr.write(
        `Unknown subcommand: pd safe ${sub}\n` +
          'Usage: pd safe scan [--json] | pd safe baseline accept <id> | pd safe fix [--auto]\n',
      );
      process.exit(2);
  }
}
