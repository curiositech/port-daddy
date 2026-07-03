import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSurfaceMatrix } from '../../skills/developer-surface-strategist/scripts/surface_matrix.mjs';
import { reviewProductReality } from '../../skills/product-reality-reviewer/scripts/reality_check.mjs';
import { scoreProjectPlan } from '../../skills/vibe-project-master-plan/scripts/plan_score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const skillIds = ['vibe-project-master-plan', 'product-reality-reviewer', 'developer-surface-strategist'];

describe('vibe project planning helper scripts', () => {
  test('scoreProjectPlan blocks plans with no cold start, proof, or rollback', () => {
    const report = scoreProjectPlan({
      name: 'agent app',
      productPromise: 'Build an app that triggers agents from user intent.',
      users: [{ name: 'builder' }],
      coldStart: { accountCreation: 'email magic link' },
      surfaces: ['gui', 'sdk'],
      architecture: { dataObjects: ['project'], auth: 'session cookie' },
      agents: [{ name: 'builder-agent', trigger: 'button', input: 'task' }],
      buildSlices: [{ name: 'mvp', acceptanceGates: ['renders'] }],
      launch: { docs: 'README' },
    });

    expect(report.pass).toBe(false);
    expect(report.coldStartGaps).toContain('coldStart.missingProviderFallback');
    expect(report.sliceGaps).toContain('buildSlices[0].proofArtifacts');
    expect(report.sliceGaps).toContain('buildSlices[0].rollback');
    expect(report.agentGaps).toContain('agents[0].permission');
  });

  test('scoreProjectPlan passes a complete first-run and launch manifest', () => {
    const report = scoreProjectPlan({
      name: 'tube workflow builder',
      productPromise: 'Help developers create listener and sender code for agent workflows.',
      users: [{ name: 'developer' }],
      coldStart: {
        accountCreation: 'email magic link plus local demo',
        emptyState: 'sample workflow',
        missingProviderFallback: 'mock agent and routed-provider option',
        demoMode: 'sample channel',
      },
      surfaces: ['gui', 'cli', 'sdk', 'mcp'],
      architecture: {
        dataObjects: ['workflow', 'message', 'receipt'],
        auth: 'workspace session',
        permissions: 'scoped channel write',
        trustBoundaries: 'agent write actions require approval',
        observability: 'receipt log and transcript',
      },
      agents: [{ name: 'generator', trigger: 'schema submitted', input: 'workflow schema', permission: 'read templates', progress: 'status events', receipt: 'generated files list', rollback: 'discard draft' }],
      buildSlices: [{ name: 'schema', acceptanceGates: ['schema validates'], proofArtifacts: ['jest output'], rollback: 'revert schema commit' }],
      launch: {
        docs: 'quickstart',
        support: 'feedback form with receipt export',
        telemetry: 'anonymous activation funnel',
        securityPrivacy: 'credential redaction',
        postLaunchReview: 'review failed runs weekly',
      },
    });

    expect(report.pass).toBe(true);
    expect(report.criticalGaps).toHaveLength(0);
  });

  test('reviewProductReality finds account, provider, trust, and agent rollback blockers', () => {
    const review = reviewProductReality({
      name: 'magic agent app',
      targetUsers: ['solo builders'],
      firstRun: { firstValue: 'sample output' },
      account: {},
      providerAccess: {},
      trust: {},
      support: {},
      agentActions: [{ name: 'edit repo', approval: 'preview diff' }],
    });

    expect(review.verdict).toBe('not-ready');
    expect(review.mustFix.map((finding) => finding.id)).toContain('account-creation');
    expect(review.mustFix.map((finding) => finding.id)).toContain('provider-fallback');
    expect(review.mustFix.map((finding) => finding.id)).toContain('receipts');
    expect(review.mustFix.map((finding) => finding.id)).toContain('agent-0-rollback');
  });

  test('reviewProductReality passes a build-ready product manifest', () => {
    const review = reviewProductReality({
      name: 'workflow planner',
      targetUsers: ['developer'],
      firstRun: { firstValue: 'sample project plan', emptyState: 'guided prompt' },
      account: { creation: 'email magic link' },
      providerAccess: { fallback: 'demo mode', credentialUx: 'guided provider panel' },
      trust: { permissions: 'scoped read/write', receipts: 'transcript and diff' },
      support: { path: 'feedback with transcript export' },
      business: { pricing: 'free demo and metered provider use' },
      agentActions: [{ name: 'generate sender', approval: 'human reviews files', rollback: 'discard draft branch' }],
    });

    expect(review.verdict).toBe('build-ready');
    expect(review.summary.findingCount).toBe(0);
  });

  test('buildSurfaceMatrix chooses surfaces and flags missing Python SDK and tube contract gaps', () => {
    const matrix = buildSurfaceMatrix({
      name: 'agent workflow api',
      targetLanguages: ['Python', 'TypeScript'],
      surfaces: ['sdk'],
      workflows: [
        { name: 'configure credentials', actor: 'human operator', frequency: 'routine setup' },
        { name: 'trigger review', actor: 'application', embedded: true },
        { name: 'let model inspect status', actor: 'model agent' },
      ],
      tubeWorkflow: { channel: 'project.review.request', sender: 'sendReviewRequest' },
      sdkPlan: { examples: ['typescript sender'], tests: ['round trip'] },
    });

    expect(matrix.workflows.find((workflow) => workflow.name === 'configure credentials').primarySurface).toBe('gui');
    expect(matrix.workflows.find((workflow) => workflow.name === 'trigger review').primarySurface).toBe('sdk');
    expect(matrix.workflows.find((workflow) => workflow.name === 'let model inspect status').primarySurface).toBe('mcp');
    expect(matrix.sdkGaps).toContain('sdkPlan.python');
    expect(matrix.tubeGaps).toContain('tubeWorkflow.listener');
    expect(matrix.pass).toBe(false);
  });

  test('buildSurfaceMatrix passes a codegen-ready tube and SDK plan', () => {
    const matrix = buildSurfaceMatrix({
      name: 'tube codegen',
      targetLanguages: ['Python', 'TypeScript'],
      surfaces: ['sdk', 'cli', 'mcp'],
      workflows: [{ name: 'send tube event', actor: 'developer', embedded: true }],
      tubeWorkflow: {
        channel: 'project.review.request',
        messageSchema: 'tube-message.v1',
        sender: 'sendReviewRequest',
        listener: 'onReviewRequest',
        receipt: 'review.receipt.v1',
        idempotency: 'message id',
        auth: 'workspace token',
        targetLanguages: ['python', 'typescript'],
      },
      sdkPlan: { python: 'pyproject package with sync and async clients', examples: ['sender', 'listener'], tests: ['fake bus round trip'] },
    });

    expect(matrix.pass).toBe(true);
    expect(matrix.gaps).toHaveLength(0);
    expect(matrix.recommendedSurfaces).toContain('sdk');
  });

  test('helper CLI entrypoints print JSON reports', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'vibe-project-cli-'));
    try {
      const fixtures = [
        {
          script: join(repo, 'skills/vibe-project-master-plan/scripts/plan_score.mjs'),
          input: {
            name: 'tiny',
            productPromise: 'ship',
            users: [{ name: 'user' }],
            coldStart: {},
            surfaces: ['gui'],
            architecture: {},
            buildSlices: [{}],
            launch: {},
          },
          expectKey: 'score',
        },
        {
          script: join(repo, 'skills/product-reality-reviewer/scripts/reality_check.mjs'),
          input: {
            name: 'product',
            targetUsers: ['user'],
            firstRun: {},
            account: {},
            providerAccess: {},
            trust: {},
            support: {},
          },
          expectKey: 'verdict',
        },
        {
          script: join(repo, 'skills/developer-surface-strategist/scripts/surface_matrix.mjs'),
          input: {
            name: 'surfaces',
            workflows: [{ name: 'configure app', actor: 'human operator', frequency: 'routine' }],
          },
          expectKey: 'workflows',
        },
      ];

      for (const [index, fixture] of fixtures.entries()) {
        const inputPath = join(tmpRoot, `fixture-${index}.json`);
        writeFileSync(inputPath, JSON.stringify(fixture.input), 'utf8');
        const stdout = execFileSync(process.execPath, [fixture.script, '--input', inputPath], { cwd: repo, encoding: 'utf8' });
        const parsed = JSON.parse(stdout);
        expect(parsed).toHaveProperty(fixture.expectKey);
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('vibe project planning skill contracts', () => {
  test.each(skillIds)('%s follows skill-architect bundle conventions', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    expect(skillText).toContain('NOT for');
    expect(skillText).toContain('```mermaid');
    expect(skillText).toContain('## Anti-Patterns');
    expect(skillText.split('\n').length).toBeLessThan(500);
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`]+)`/g)].map((match) => match[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
