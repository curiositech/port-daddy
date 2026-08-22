import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// [skillId, scriptFile, exportedFn]
const audited = [
  ['agent-compliance-conformance', 'conformance_audit', 'auditConformance'],
  ['articles-of-agreement-auditor', 'articles_audit', 'auditArticles'],
  ['agent-control-command-contract', 'control_contract_audit', 'auditControlContract'],
  ['destructive-action-policy-matrix', 'policy_matrix_audit', 'auditPolicyMatrix'],
  ['operator-surface-authority-designer', 'surface_authority_audit', 'auditSurfaceAuthority'],
  ['work-intake-node-shaping', 'node_shaping_audit', 'auditNodeShaping'],
  ['coordination-verb-broker-migration', 'broker_migration_audit', 'auditBrokerMigration'],
  ['local-first-tenancy-boundary', 'tenancy_boundary_audit', 'auditTenancyBoundary'],
  ['mcp-trust-broker', 'mcp_admission_audit', 'auditMcpAdmission'],
  ['focus-receipt-proof-gate', 'focus_receipt_audit', 'auditFocusReceipt'],
  ['architecture-binder-of-record', 'binder_coverage_audit', 'auditBinderCoverage'],
  ['agent-visual-evidence-manifest', 'proof_manifest_audit', 'auditProofManifest'],
];

const skillIds = audited.map((a) => a[0]);

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}

// A committed sample plus a wall-clock assertion is a dated bomb. focus-receipt's
// sample carries reviewDate 2026-08-15 and passed here every day until 2026-08-16,
// when `review-date-elapsed` began firing and failed this suite on every PR in the
// repo — none of which had touched the skill. Auditors now receive a pinned
// evaluation instant, so "the sample is a good receipt" stays a statement about the
// sample rather than about the day CI happened to run.
//
// Passed to every auditor, not just the one that reads it: the eleven that ignore a
// second argument are unaffected, and the next auditor to grow a time-dependent rule
// inherits determinism instead of rediscovering this failure.
const PINNED_NOW = Date.parse('2026-08-10T00:00:00Z');

describe('agent-governance auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs', async (skillId, scriptFile, fnName) => {
    const mod = await import(pathToFileURL(join(repo, 'skills', skillId, 'scripts', `${scriptFile}.mjs`)).href);
    const fn = mod[fnName];
    expect(typeof fn).toBe('function');

    const report = fn(sample(skillId), { now: PINNED_NOW });
    expect(report.pass).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings).toHaveLength(0);

    expect(() => fn(null)).toThrow();
    expect(() => fn('not-an-object')).toThrow();
  });
});

describe('focus-receipt staleness is pinned to an evaluation instant, not the wall clock', () => {
  async function auditFocusReceipt() {
    const mod = await import(
      pathToFileURL(
        join(repo, 'skills', 'focus-receipt-proof-gate', 'scripts', 'focus_receipt_audit.mjs'),
      ).href
    );
    return mod.auditFocusReceipt;
  }

  test('still reports an elapsed reviewDate — the check is pinned, not disabled', async () => {
    const fn = await auditFocusReceipt();
    const receipt = sample('focus-receipt-proof-gate');
    const afterReview = Date.parse(`${receipt.receipt.reviewDate}T00:00:00Z`) + 86_400_000;

    const report = fn(receipt, { now: afterReview });
    const elapsed = report.findings.filter((f) => f.id === 'review-date-elapsed');
    expect(elapsed).toHaveLength(1);
    expect(elapsed[0].severity).toBe('high');
  });

  test('a receipt whose reviewDate is still ahead is not flagged', async () => {
    const fn = await auditFocusReceipt();
    const receipt = sample('focus-receipt-proof-gate');
    const beforeReview = Date.parse(`${receipt.receipt.reviewDate}T00:00:00Z`) - 86_400_000;

    const report = fn(receipt, { now: beforeReview });
    expect(report.findings.filter((f) => f.id === 'review-date-elapsed')).toHaveLength(0);
  });

  test('defaults to the wall clock when no instant is supplied', async () => {
    const fn = await auditFocusReceipt();
    const receipt = sample('focus-receipt-proof-gate');
    // Deliberately not asserting a verdict: which way this falls depends on the
    // date the suite runs, and pinning that is exactly the bug above. What must
    // hold is that omitting `now` still produces a real report.
    const report = fn(receipt);
    expect(Array.isArray(report.findings)).toBe(true);
  });
});

describe('agent-governance skills are first-party auditor bundles with intact references', () => {
  test.each(skillIds)('%s frontmatter + reference integrity', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toMatch(/kind:\s*first-party/);
    expect(existsSync(join(skillDir, 'CHANGELOG.md'))).toBe(true);
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath)) || existsSync(join(repo, relativePath))).toBe(true);
    }
  });
});
