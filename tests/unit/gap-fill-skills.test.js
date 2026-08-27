import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditDbPlan } from '../../skills/sqlite-durable-agent-state/scripts/db_path_audit.mjs';
import { lintLaunchdPlan } from '../../skills/macos-launchd-supervision/scripts/plist_lint.mjs';
import { auditContainment } from '../../skills/sandboxed-adversarial-test-harness/scripts/containment_audit.mjs';
import { lintReceipt } from '../../skills/agent-work-receipt-designer/scripts/receipt_lint.mjs';
import { stressPricingPlan } from '../../skills/agent-labor-pricing-function/scripts/pricing_stress.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const skillIds = [
  'sqlite-durable-agent-state',
  'macos-launchd-supervision',
  'sandboxed-adversarial-test-harness',
  'agent-work-receipt-designer',
  'agent-labor-pricing-function',
];

function sample(skillId) {
  return JSON.parse(
    readFileSync(
      join(repo, 'skills', skillId, 'examples', 'sample-input.json'),
      'utf8',
    ),
  );
}

describe('gap-fill skill helpers pass their own verified sample and reject bad input', () => {
  test('auditDbPlan passes a canonical env-pinned plan and flags fragmentation + Cellar paths', () => {
    const clean = auditDbPlan(sample('sqlite-durable-agent-state'));
    expect(clean.pass).toBe(true);
    expect(clean.findings).toHaveLength(0);

    const fragmented = auditDbPlan({
      candidatePaths: [
        {
          path: '/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3',
          canonical: true,
        },
        { path: '/Users/agent/.port-daddy/registry.db', canonical: true },
      ],
      journalMode: 'wal',
    });
    expect(fragmented.pass).toBe(false);
    const codes = fragmented.findings.map((f) => f.code);
    expect(codes).toContain('PATH_FRAGMENTATION');
    expect(codes.some((c) => /CELLAR|WAL_NO_BUSY/.test(c))).toBe(true);

    expect(() => auditDbPlan({})).toThrow();
    expect(() => auditDbPlan({ candidatePaths: [] })).toThrow();
  });

  test('lintLaunchdPlan passes a supervised plan and flags /tmp logs + KeepAlive-only supervision', () => {
    const clean = lintLaunchdPlan(sample('macos-launchd-supervision'));
    expect(clean.pass).toBe(true);

    const bad = lintLaunchdPlan({
      label: 'com.example.bad',
      programArgs: ['pd', 'start'],
      runAtLoad: false,
      keepAlive: true,
      throttleInterval: 0,
      stdoutPath: '/tmp/bad.log',
      stderrPath: '/tmp/bad.log',
      agentVsDaemon: 'agent',
      hasExternalIntegrityCheck: false,
    });
    expect(bad.pass).toBe(false);
    const text = JSON.stringify(bad.findings);
    expect(text).toMatch(/tmp/i);
    expect(text).toMatch(/integrity|KeepAlive|supervis/i);

    expect(() => lintLaunchdPlan(null)).toThrow();
  });

  test('auditContainment passes a fail-closed allowlist harness and flags missing threat coverage', () => {
    const clean = auditContainment(
      sample('sandboxed-adversarial-test-harness'),
    );
    expect(clean.pass).toBe(true);
    expect(Object.keys(clean.coverageByThreatClass).length).toBeGreaterThan(0);

    const gappy = auditContainment({
      name: 'leaky',
      isolationDimensions: ['filesystem'],
      egressPolicy: { mode: 'denylist', default: 'allow', deny: ['evil.com'] },
      pathPolicy: { mode: 'denylist', jailRoot: '/tmp/jail' },
      secretHandling: { mode: 'real', exposedToSandbox: true },
      adversarialCases: [
        {
          id: 'only-ssrf',
          invariant: 'Outbound fetch to metadata endpoint is refused.',
          threatClass: 'ssrf',
          expected: 'contained',
          failMode: 'fail-open',
        },
      ],
      failMode: 'fail-open',
    });
    expect(gappy.pass).toBe(false);
    expect(gappy.findings.length).toBeGreaterThan(0);

    expect(() => auditContainment({})).toThrow();
  });

  test('lintReceipt passes an artifact-backed receipt and fails a self-reported one', () => {
    const clean = lintReceipt(sample('agent-work-receipt-designer'));
    expect(clean.pass).toBe(true);
    expect(clean.score).toBeGreaterThanOrEqual(80);

    const selfReported = lintReceipt({
      identity: {
        agent: 'x',
        model: 'y',
        backend: 'claude-code',
        sessionId: 's',
      },
      intent: { goal: 'g', scope: ['a'], stopCondition: 'c' },
      contextUsed: { filesRead: ['a'] },
      actions: {
        commands: [{ cmd: 'test', exitCode: 0 }],
        filesChanged: { diffSummary: '+1 -0' },
      },
      validation: {
        artifactBacked: true,
        tests: [{ name: 't', passed: true }],
      },
      spend: { costUsd: 1 },
      risks: [],
      rollback: { checkpoint: 'abc' },
      provenance: { timestamp: '2026-07-03T00:00:00Z' },
    });
    expect(selfReported.pass).toBe(false);
    expect(JSON.stringify(selfReported.findings)).toMatch(
      /self-report|artifact/i,
    );

    expect(() => lintReceipt(null)).toThrow();
  });

  test('lintReceipt requires complete evidence-backed containment for Dream Rig receipts', () => {
    const base = sample('agent-work-receipt-designer');
    const missing = lintReceipt(base, { requireContainment: true });
    expect(missing.pass).toBe(false);
    expect(
      missing.findings.some((finding) => finding.id === 'missing-containment'),
    ).toBe(true);

    const threatClasses = [
      'ssrf',
      'path-traversal',
      'secret-exfil',
      'resource-exhaustion',
      'side-effect-write',
    ];
    const coverageByThreatClass = Object.fromEntries(
      threatClasses.map((threatClass) => [
        threatClass,
        {
          total: 1,
          containedAssertions: 1,
          evidencedContainments: 1,
          containmentRate: 1,
        },
      ]),
    );
    const probeResults = threatClasses.map((threatClass) => ({
      caseId: `case-${threatClass}`,
      threatClass,
      contained: true,
      mechanism: 'fixture',
      artifactPath: `blob:${threatClass}`,
    }));
    const containment = {
      schema: 'pd.agent-harbor.dream-rig-containment-report.v0',
      reportId: 'containment_lint_green',
      specName: 'dream-rig-lifecycle-scenario',
      pass: true,
      coverageByThreatClass,
      findings: [],
      recommendations: [],
      residualRisks: [],
      probeResults,
      generatedAt: '2026-08-26T12:00:00.000Z',
    };
    const clean = lintReceipt(
      {
        ...base,
        containment,
      },
      { requireContainment: true },
    );
    expect(clean.pass).toBe(true);

    const forged = lintReceipt(
      {
        ...base,
        containment: {
          ...containment,
          probeResults: [{ ...probeResults[0], contained: false }],
        },
      },
      { requireContainment: true },
    );
    expect(forged.pass).toBe(false);
    expect(
      forged.findings.some(
        (finding) => finding.id === 'containment-not-proven',
      ),
    ).toBe(true);

    const ambiguous = lintReceipt(
      {
        ...base,
        containment: {
          ...containment,
          reportId: '',
          probeResults: [
            ...probeResults,
            {
              caseId: 'undeclared-class',
              threatClass: 'prompt-injection',
              contained: true,
              mechanism: 'fixture',
              artifactPath: 'blob:undeclared-class',
            },
          ],
        },
      },
      { requireContainment: true },
    );
    expect(ambiguous.pass).toBe(false);
    expect(
      ambiguous.findings.some(
        (finding) => finding.id === 'containment-not-proven',
      ),
    ).toBe(true);
  });

  test('stressPricingPlan passes a healthy plan and flags negative margin + bill-shock', () => {
    const clean = stressPricingPlan(sample('agent-labor-pricing-function'));
    expect(clean.pass).toBe(true);
    expect(
      Array.isArray(clean.marginByPersona) ||
        typeof clean.marginByPersona === 'object',
    ).toBe(true);

    const underwater = stressPricingPlan({
      model: 'metered',
      valueMetric: { name: 'tokens', unit: 'token', buyerCanPredict: false },
      unitCosts: { modelTokenCost: 0.5, toolCompute: 0.3, overhead: 0.2 },
      pricePoints: [
        {
          tier: 'flat',
          basePrice: 10,
          includedUnits: 100,
          overageRatePerUnit: 0.2,
        },
      ],
      guardrails: {
        spendCap: false,
        budgetPreview: false,
        perTaskEstimate: false,
        transparentMetering: false,
      },
      personas: [{ name: 'power-user', tier: 'flat', monthlyUnits: 5000 }],
    });
    expect(underwater.pass).toBe(false);
    expect(underwater.findings.length).toBeGreaterThan(0);

    expect(() => stressPricingPlan({})).toThrow();
  });
});

describe('gap-fill skill contract files', () => {
  test.each(skillIds)(
    '%s declares IO contracts and points to existing resources',
    (skillId) => {
      const skillDir = join(repo, 'skills', skillId);
      const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

      expect(skillText).toContain('io-contract');
      expect(skillText).toContain('provenance');
      for (const relativePath of [
        ...skillText.matchAll(
          /`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g,
        ),
      ].map((match) => match[1])) {
        expect(existsSync(join(skillDir, relativePath))).toBe(true);
      }
    },
  );
});
