/**
 * lib/safe/baseline.ts — A2, the detect-secrets-style baseline triage store
 * (ADR-0088 Phase A). Ships WITH the scanner — without it the posture score is
 * noise on first run, and trust dies.
 *
 * A committed `.pd-secrets-baseline.json` of triaged findings keyed by a stable
 * fingerprint `hash(ruleId + path + last4)`. Each entry has a state
 * (`accepted | rotated | false-positive`). A re-scan surfaces only NEW
 * (un-fingerprinted) findings; `accepted`/`false-positive` are suppressed from
 * the score, `rotated` is informational (the secret was moved/rotated — Phase B
 * corral writes this).
 *
 * NO RAW SECRET is ever stored: the fingerprint is over `ruleId+path+last4`, and
 * `last4` is an identifier, not a credential. The line number is deliberately
 * EXCLUDED from the fingerprint so a triaged finding survives the file growing
 * or shrinking above it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  SecretFinding,
  FindingFingerprint,
  BaselineEntry,
  BaselineState,
  SecretsBaseline,
  BaselinedScanResult,
} from './types.js';

/**
 * Stable fingerprint of a finding: `sha256(ruleId + '\0' + path + '\0' + last4)`.
 * Line is intentionally excluded (survives file edits above the secret). Raw
 * value is never an input (we never hold it).
 */
export function fingerprint(
  f: Pick<SecretFinding, 'ruleId' | 'path' | 'last4'>,
): FindingFingerprint {
  return createHash('sha256')
    .update(`${f.ruleId}\0${f.path}\0${f.last4}`)
    .digest('hex');
}

/** States that SUPPRESS a finding from the posture score. */
const SUPPRESSING: ReadonlySet<BaselineState> = new Set<BaselineState>([
  'accepted',
  'false-positive',
]);

/** An empty baseline (the shape written on first `pd safe scan --write-baseline`). */
export function emptyBaseline(now: () => Date = () => new Date()): SecretsBaseline {
  return { version: 1, generatedAt: now().toISOString(), entries: [] };
}

/** Build a baseline that ACCEPTS every finding in a scan (first-run triage). */
export function baselineFromFindings(
  findings: SecretFinding[],
  state: BaselineState = 'accepted',
  now: () => Date = () => new Date(),
): SecretsBaseline {
  const byFp = new Map<FindingFingerprint, BaselineEntry>();
  for (const f of findings) {
    const fp = fingerprint(f);
    if (byFp.has(fp)) continue;
    byFp.set(fp, {
      fingerprint: fp,
      ruleId: f.ruleId,
      path: f.path,
      last4: f.last4,
      state,
      triagedAt: now().toISOString(),
    });
  }
  return {
    version: 1,
    generatedAt: now().toISOString(),
    entries: [...byFp.values()],
  };
}

/** Index a baseline by fingerprint for O(1) lookup. */
function indexBaseline(b: SecretsBaseline): Map<FindingFingerprint, BaselineEntry> {
  const m = new Map<FindingFingerprint, BaselineEntry>();
  for (const e of b.entries) m.set(e.fingerprint, e);
  return m;
}

/**
 * Filter a scan's findings against a baseline: only findings with NO suppressing
 * baseline entry surface as `newFindings`. A finding whose fingerprint is
 * `accepted`/`false-positive` is suppressed (counted in `suppressed`). A
 * `rotated` entry does NOT suppress (the secret should be gone; if it reappears
 * that is news). An un-fingerprinted finding is always NEW.
 */
export function applyBaseline(
  findings: SecretFinding[],
  baseline: SecretsBaseline,
): BaselinedScanResult {
  const idx = indexBaseline(baseline);
  const newFindings: SecretFinding[] = [];
  let suppressed = 0;
  for (const f of findings) {
    const entry = idx.get(fingerprint(f));
    if (entry && SUPPRESSING.has(entry.state)) {
      suppressed++;
      continue;
    }
    newFindings.push(f);
  }
  return { newFindings, suppressed, allFindings: findings };
}

/**
 * Record a triage decision for one fingerprint (the `pd safe baseline accept
 * <id>` write path). Upserts; returns a NEW baseline (pure — does not mutate).
 */
export function triage(
  baseline: SecretsBaseline,
  finding: Pick<SecretFinding, 'ruleId' | 'path' | 'last4'>,
  state: BaselineState,
  opts: { note?: string; now?: () => Date } = {},
): SecretsBaseline {
  const now = opts.now ?? (() => new Date());
  const fp = fingerprint(finding);
  const entries = baseline.entries.filter((e) => e.fingerprint !== fp);
  entries.push({
    fingerprint: fp,
    ruleId: finding.ruleId,
    path: finding.path,
    last4: finding.last4,
    state,
    triagedAt: now().toISOString(),
    ...(opts.note ? { note: opts.note } : {}),
  });
  return { version: 1, generatedAt: now().toISOString(), entries };
}

// ── Disk I/O (the committed JSON file) ───────────────────────────────────────

/** Load a baseline from disk; an empty baseline if the file is absent. */
export function loadBaseline(path: string): SecretsBaseline {
  if (!existsSync(path)) return emptyBaseline();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SecretsBaseline;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
    /* fall through to empty */
  }
  return emptyBaseline();
}

/** Write a baseline to disk (pretty JSON, trailing newline). */
export function writeBaseline(path: string, baseline: SecretsBaseline): void {
  writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
}
