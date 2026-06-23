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
import { planCorral, applyCorralItem } from '../../lib/safe/corral.js';
import { scanStagedDiff, formatStagedFinding } from '../../lib/safe/staged-guard.js';
import { CORRAL_HONEST_LIMIT, corralStorageStatus } from '../../lib/secret-env.js';
import { parseAssignment } from '../../lib/safe/corral.js';
import { readFileSync } from 'node:fs';
import type { CLIOptions } from '../types.js';
import type { SecretFinding, CorralPlanItem } from '../../lib/safe/types.js';

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
//  pd safe corral <key> | --all   (ADR-0088 Phase B)
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the corral candidate findings: the A1 host scan's findings, optionally
 * narrowed to a single dotenv KEY (the `<key>` arg). The scan is in-process
 * (corral is a local file+vault op; no daemon needed). NO RAW VALUE leaves here.
 */
function corralCandidates(key: string | undefined): SecretFinding[] {
  const raw = scanHost({});
  if (!key) return raw.findings;
  // Narrow to findings whose source line is a `KEY=value` assignment for <key>.
  return raw.findings.filter((f) => {
    try {
      const lines = readFileSync(f.path, 'utf8').split('\n');
      const assign = parseAssignment(lines[f.line - 1] ?? '');
      return assign?.key === key;
    } catch {
      return false;
    }
  });
}

function printPlanItem(item: CorralPlanItem): void {
  if (item.corralable) {
    process.stdout.write(`  CORRAL  ${item.path}:${item.line}  ${item.ruleId}  (…${item.last4})\n`);
    process.stdout.write(`          ${item.key}=… -> ${item.key}=${item.ref}\n`);
  } else {
    process.stdout.write(
      `  SKIP    ${item.path}:${item.line}  ${item.ruleId}  (…${item.last4})  [${item.skipReason}]\n`,
    );
  }
}

async function handleCorral(key: string | undefined, options: CLIOptions): Promise<void> {
  const all = options.all === true || (options.all as unknown) === 'true';
  const apply = options.apply === true || options.apply === 'true';

  if (!key && !all) {
    process.stderr.write(
      'Usage: pd safe corral <key>            corral one detected secret\n' +
        '       pd safe corral --all           corral every detected secret\n' +
        '       (add --apply to write; default is a DRY RUN that prints the plan)\n',
    );
    process.exit(2);
    return;
  }

  const findings = corralCandidates(all ? undefined : key);
  if (findings.length === 0) {
    process.stdout.write(
      key
        ? `No detected secret matches key "${key}" in a KEY=value source line.\n`
        : 'No detected secrets to corral.\n',
    );
    process.stdout.write(`\n${CORRAL_HONEST_LIMIT}\n`);
    process.exit(0);
    return;
  }

  const plan = planCorral(findings);
  const storage = corralStorageStatus();

  if (!apply) {
    process.stdout.write('pd safe corral — DRY RUN (nothing written). Plan:\n\n');
    for (const item of plan.items) printPlanItem(item);
    process.stdout.write(`\nVault: ${storage.storage} (${storage.location})\n`);
    process.stdout.write(`Backups would be written under: ${plan.backupDir}\n`);
    process.stdout.write('\nRe-run with --apply to corral (reversible: a .bak is kept and the\n');
    process.stdout.write('source is rewritten to a pd-secret:// reference resolved at exec time).\n');
    process.stdout.write(`\n${CORRAL_HONEST_LIMIT}\n`);
    if (options.json) {
      process.stdout.write('\n' + JSON.stringify({ dryRun: true, plan, storage, honestLimit: CORRAL_HONEST_LIMIT }, null, 2) + '\n');
    }
    process.exit(0);
    return;
  }

  if (!storage.available) {
    process.stderr.write(
      'pd safe corral --apply: no encrypted secret storage is available on this\n' +
        'machine (Keychain unavailable). Refusing to corral — it would leave a\n' +
        'plaintext copy. Nothing was written.\n',
    );
    process.exit(1);
    return;
  }

  const results = plan.items.map((item) => applyCorralItem(item));
  const applied = results.filter((r) => r.applied);
  const skipped = results.filter((r) => !r.applied);

  if (options.json) {
    process.stdout.write(JSON.stringify({ applied, skipped, storage, honestLimit: CORRAL_HONEST_LIMIT }, null, 2) + '\n');
  } else {
    for (const r of applied) {
      process.stdout.write(
        `corralled ${r.ruleId} at ${r.path}:${r.line} (…${r.last4}) -> pd-secret://${r.key}\n` +
          `  round-trip verified, backup at ${r.backupPath}\n`,
      );
    }
    for (const r of skipped) {
      process.stdout.write(`SKIPPED   ${r.path}:${r.line} (…${r.last4}): ${r.error}\n`);
    }
    process.stdout.write(
      `\nResolve at run time with: pd env exec -- <command>\n` +
        `(pd-secret:// refs are injected into the child env only; no plaintext at rest).\n`,
    );
    process.stdout.write(`\n${CORRAL_HONEST_LIMIT}\n`);
  }
  process.exit(skipped.length > 0 && applied.length === 0 ? 1 : 0);
}

// ════════════════════════════════════════════════════════════════════════
//  pd safe guard --staged   (ADR-0088 Phase B / ADR-0053 surface)
// ════════════════════════════════════════════════════════════════════════

/**
 * Reuse the A1 scanner against `git diff --staged` so a NEW secret is caught at
 * the commit/push boundary. Exit 1 (blocking) when a staged secret is found.
 * NO RAW VALUE printed — path/line/ruleId/last4 only.
 */
function handleGuard(options: CLIOptions): void {
  const result = scanStagedDiff();

  if (!result.diffAvailable) {
    process.stderr.write('pd safe guard: could not read the staged diff (is this a git repo with staged changes?).\n');
    process.exit(0);
    return;
  }

  if (result.findings.length === 0) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ clean: true, files: result.files }, null, 2) + '\n');
    } else if (!options.quiet && !options.q) {
      process.stdout.write(`pd safe guard: no secrets in ${result.files.length} staged file(s). Clean.\n`);
    }
    process.exit(0);
    return;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ clean: false, findings: result.findings }, null, 2) + '\n');
  } else {
    process.stderr.write('pd safe guard BLOCKED: staged changes add secret(s):\n\n');
    for (const f of result.findings) {
      process.stderr.write(`  ${formatStagedFinding(f)}\n`);
    }
    process.stderr.write(
      '\nUn-stage the secret, or corral it first: pd safe corral <KEY> --apply,\n' +
        'then stage the pd-secret:// reference instead. (Raw value never shown.)\n',
    );
  }
  process.exit(1);
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
    case 'corral':
      await handleCorral(positional[1], options);
      return;
    case 'guard':
      handleGuard(options);
      return;
    default:
      process.stderr.write(
        `Unknown subcommand: pd safe ${sub}\n` +
          'Usage: pd safe scan [--json] | pd safe baseline accept <id> | pd safe fix [--auto]\n' +
          '       | pd safe corral <key>|--all [--apply] | pd safe guard [--staged]\n',
      );
      process.exit(2);
  }
}
