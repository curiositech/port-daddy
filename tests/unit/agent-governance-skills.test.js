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

describe('agent-governance auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs', async (skillId, scriptFile, fnName) => {
    const mod = await import(pathToFileURL(join(repo, 'skills', skillId, 'scripts', `${scriptFile}.mjs`)).href);
    const fn = mod[fnName];
    expect(typeof fn).toBe('function');

    const report = fn(sample(skillId));
    expect(report.pass).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings).toHaveLength(0);

    expect(() => fn(null)).toThrow();
    expect(() => fn('not-an-object')).toThrow();
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
