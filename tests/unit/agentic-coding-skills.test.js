import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStoryMatrix } from '../../skills/agentic-coding-product-research/scripts/story_matrix.mjs';
import { scoreMagicProgression } from '../../skills/agentic-coding-ux-designer/scripts/magic_progression_score.mjs';
import { evaluateLatencyBudget } from '../../skills/swarm-invocation-designer/scripts/latency_budget.mjs';
import { evaluateTrajectorySuite } from '../../skills/agent-rl-sandbox-trainer/scripts/trajectory_eval_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const skillIds = [
  'agentic-coding-product-research',
  'agentic-coding-ux-designer',
  'swarm-invocation-designer',
  'agent-rl-sandbox-trainer',
];

describe('agentic coding skill helpers', () => {
  test('buildStoryMatrix derives stories and requires real source citations', () => {
    const matrix = buildStoryMatrix({
      sources: [{ id: 'cursor-docs', title: 'Cursor docs', kind: 'official-doc', url: 'https://cursor.com/docs/agent/overview.md' }],
      audiences: [
        {
          id: 'staff-engineer',
          name: 'a staff engineer',
          jobs: ['delegate a safe refactor across a repo'],
          pains: ['agent work is invisible until review time'],
          craves: ['mergeable progress with tests and rollback'],
          evidence: ['cursor-docs'],
        },
      ],
    });

    expect(matrix.summary.storyCount).toBe(1);
    expect(matrix.user_stories[0].story).toContain('As a staff engineer');
    expect(matrix.unmet_needs[0].portDaddyImplication).toContain('transcript');
    expect(() => buildStoryMatrix({ sources: [], audiences: [] })).toThrow(/at least one citation/);
    expect(() =>
      buildStoryMatrix({
        sources: [{ id: 'source-1', url: 'https://example.com/research' }],
        audiences: [{ id: 'uncited', name: 'an uncited user', jobs: ['ship work'] }],
      }),
    ).toThrow(/must include at least one evidence source/);
    expect(() =>
      buildStoryMatrix({
        sources: [
          { id: 'same', url: 'https://example.com/one' },
          { id: 'same', url: 'https://example.com/two' },
        ],
        audiences: [{ id: 'cited', name: 'a cited user', jobs: ['ship work'], evidence: ['same'] }],
      }),
    ).toThrow(/duplicates source id/);
  });

  test('scoreMagicProgression catches missing rollback and high friction', () => {
    const report = scoreMagicProgression({
      flowName: 'spawn-reviewer',
      steps: [
        {
          id: 'intent',
          label: 'Invoke reviewer from selected diff',
          friction: 1,
          context: true,
          visibleProgress: true,
          rollback: false,
          humanGate: true,
          receipt: true,
        },
        {
          id: 'scope',
          label: 'Hand-enter file list and model parameters',
          friction: 5,
          context: true,
          visibleProgress: false,
          rollback: false,
          humanGate: true,
          receipt: false,
        },
      ],
    });

    expect(report.pass).toBe(false);
    expect(report.recommendations.some((item) => item.signal === 'rollback')).toBe(true);
    expect(report.recommendations.some((item) => item.signal === 'friction')).toBe(true);

    const noneRollback = scoreMagicProgression({
      flowName: 'string-none',
      steps: [{ id: 'danger', label: 'Run write action', friction: 0, context: true, visibleProgress: true, rollback: 'none', humanGate: true, receipt: true }],
    });
    expect(noneRollback.pass).toBe(false);
    expect(noneRollback.steps[0].missingSignals).toContain('rollback');
  });

  test('evaluateLatencyBudget separates IPC hot paths from durable Internet Computer paths', () => {
    const ipc = evaluateLatencyBudget({
      name: 'agent-bus',
      targetP95Ms: 20,
      icpMeaning: 'ipc',
      channels: [
        { name: 'mailbox', role: 'hot', transport: 'unix-socket', p95Ms: 2 },
        { name: 'receipt-log', role: 'durable', transport: 'sqlite', p95Ms: 8, durable: true },
      ],
      messages: [{ name: 'tool-intent', actualBytes: 512, maxBytes: 1024, schema: 'tool-intent.v1' }],
    });
    const internetComputer = evaluateLatencyBudget({
      name: 'settlement',
      targetP95Ms: 10,
      icpMeaning: 'internet-computer',
      channels: [{ name: 'canister', role: 'hot', transport: 'icp-consensus', p95Ms: 2000 }],
      messages: [{ name: 'full-context', actualBytes: 8192, maxBytes: 1024 }],
    });

    expect(ipc.pass).toBe(true);
    expect(ipc.icpGuidance).toContain('lightning-fast');
    expect(internetComputer.pass).toBe(false);
    expect(internetComputer.icpGuidance).toContain('poor hot path');
    expect(() => evaluateLatencyBudget({})).toThrow(/plan.name is required/);
    expect(() =>
      evaluateLatencyBudget({
        name: 'bad-latency',
        targetP95Ms: 10,
        channels: [{ name: 'hot', role: 'hot', transport: 'loopback', p95Ms: 'fast' }],
      }),
    ).toThrow(/channels\[0\]\.p95Ms/);
  });

  test('evaluateTrajectorySuite scores artifact-backed traces and validated unhooks', () => {
    const report = evaluateTrajectorySuite({
      agent: { name: 'review-fixer', baseModel: 'base', adapter: 'lora-review-fix' },
      rewardSpec: { actionOrderRequired: true, defaultPassReward: 1, requireValidatedUnhooksForDeployment: true },
      unhooks: [
        { name: 'reset fixture', command: 'npm run fixture:reset', validated: true },
        { name: 'disable adapter', procedure: 'unset AGENT_ADAPTER and rerun base model', validated: true },
      ],
      tasks: [
        {
          id: 'reply-thread',
          instruction: 'Fix a reviewer thread and cite validation.',
          expectedActions: [{ tool: 'edit_file', argsContains: ['review'] }, { tool: 'run_tests', argsContains: ['agentic'] }],
          expectedEvidence: [{ kind: 'test-output', contains: ['validation passed'], exitCode: 0 }],
        },
        {
          id: 'missed-test',
          instruction: 'Run the focused test.',
          expectedActions: [{ tool: 'run_tests', argsContains: ['focused'] }],
          expectedEvidence: [{ kind: 'test-output', contains: ['validation passed'], exitCode: 0 }],
        },
      ],
      trajectories: [
        {
          taskId: 'reply-thread',
          actions: [
            { tool: 'edit_file', args: { path: 'review.md' } },
            { tool: 'run_tests', args: { command: 'npm test -- agentic' } },
          ],
          finalState: 'validation passed',
          artifacts: [{ kind: 'test-output', name: 'jest', content: 'validation passed', exitCode: 0 }],
        },
        {
          taskId: 'missed-test',
          actions: [{ tool: 'edit_file', args: { path: 'x' } }],
          finalState: 'validation passed',
          artifacts: [],
        },
      ],
    });

    expect(report.summary.passed).toBe(1);
    expect(report.summary.evalGatePassed).toBe(false);
    expect(report.summary.unhooksReady).toBe(true);
    expect(report.summary.deployable).toBe(false);
    expect(report.warnings[0]).toContain('eval gate failed');
    expect(report.rewardSpec.actionOrderRequired).toBe(true);
    expect(report.trainingRows.find((row) => row.taskId === 'missed-test').preference).toBe('rejected');
    expect(report.rows.find((row) => row.taskId === 'missed-test').selfReportOnly).toBe(true);
    expect(report.validatedUnhooks).toHaveLength(2);
  });

  test('evaluateTrajectorySuite does not hide missing unhooks behind defaults', () => {
    const report = evaluateTrajectorySuite({
      agent: { name: 'unsafe-adapter' },
      tasks: [
        {
          id: 'claim',
          instruction: 'Claim before edit.',
          expectedActions: [{ tool: 'claim_files', argsContains: ['src/app.js'] }],
          expectedEvidence: [{ kind: 'claim-row', contains: ['src/app.js'] }],
        },
      ],
      trajectories: [
        {
          taskId: 'claim',
          actions: [{ tool: 'claim_files', args: { path: 'src/app.js' } }],
          artifacts: [{ kind: 'claim-row', content: 'src/app.js claimed by agent' }],
        },
      ],
    });

    expect(report.summary.passed).toBe(1);
    expect(report.summary.evalGatePassed).toBe(true);
    expect(report.summary.unhooksReady).toBe(false);
    expect(report.summary.deployable).toBe(false);
    expect(report.validatedUnhooks).toHaveLength(0);
    expect(report.suggestedUnhooks).toContain('disable adapter and fall back to base model');
    expect(report.warnings[0]).toContain('no validated unhooks');
  });

  test('evaluateTrajectorySuite enforces expected action order for safety behaviors', () => {
    const report = evaluateTrajectorySuite({
      agent: { name: 'claim-discipline' },
      rewardSpec: { actionOrderRequired: true },
      unhooks: [{ name: 'reset fixture', command: 'npm run fixture:reset', validated: true }],
      tasks: [
        {
          id: 'claim-before-edit',
          instruction: 'Claim before editing.',
          expectedActions: [
            { tool: 'claim_files', argsContains: ['src/app.js'] },
            { tool: 'edit_file', argsContains: ['src/app.js'] },
          ],
          expectedEvidence: [{ kind: 'claim-row', contains: ['src/app.js'] }],
        },
      ],
      trajectories: [
        {
          taskId: 'claim-before-edit',
          actions: [
            { tool: 'edit_file', args: { path: 'src/app.js' } },
            { tool: 'claim_files', args: { path: 'src/app.js' } },
          ],
          artifacts: [{ kind: 'claim-row', content: 'src/app.js claimed' }],
        },
      ],
    });

    expect(report.summary.passed).toBe(0);
    expect(report.rows[0].actionResults[0].matched).toBe(true);
    expect(report.rows[0].actionResults[1].matched).toBe(false);
    expect(report.trainingRows[0].preference).toBe('rejected');
  });

  test('evaluateTrajectorySuite is deployable only when evals and unhooks both pass', () => {
    const report = evaluateTrajectorySuite({
      agent: { name: 'safe-adapter' },
      rewardSpec: { actionOrderRequired: true, requireValidatedUnhooksForDeployment: true },
      unhooks: [{ name: 'reset fixture', command: 'npm run fixture:reset', validated: true }],
      tasks: [
        {
          id: 'claim-before-edit',
          instruction: 'Claim before editing.',
          expectedActions: [
            { tool: 'claim_files', argsContains: ['src/app.js'] },
            { tool: 'edit_file', argsContains: ['src/app.js'] },
          ],
          expectedEvidence: [{ kind: 'claim-row', contains: ['src/app.js'] }],
        },
      ],
      trajectories: [
        {
          taskId: 'claim-before-edit',
          actions: [
            { tool: 'claim_files', args: { path: 'src/app.js' } },
            { tool: 'edit_file', args: { path: 'src/app.js' } },
          ],
          artifacts: [{ kind: 'claim-row', content: 'src/app.js claimed' }],
        },
      ],
    });

    expect(report.summary.evalGatePassed).toBe(true);
    expect(report.summary.unhooksReady).toBe(true);
    expect(report.summary.deployable).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  test('helper CLI entrypoints print JSON reports', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'agentic-coding-cli-'));
    try {
      const fixtures = [
        {
          script: join(repo, 'skills/agentic-coding-product-research/scripts/story_matrix.mjs'),
          input: {
            sources: [{ id: 'docs', url: 'https://example.com/docs' }],
            audiences: [{ id: 'builder', name: 'a builder', jobs: ['ship a slice'], evidence: ['docs'] }],
          },
          expectKey: 'user_stories',
        },
        {
          script: join(repo, 'skills/agentic-coding-ux-designer/scripts/magic_progression_score.mjs'),
          input: {
            flowName: 'safe-flow',
            steps: [{ label: 'Review diff', friction: 1, context: true, visibleProgress: true, rollback: true, humanGate: true, receipt: true }],
          },
          expectKey: 'score',
        },
        {
          script: join(repo, 'skills/swarm-invocation-designer/scripts/latency_budget.mjs'),
          input: {
            name: 'bus',
            targetP95Ms: 25,
            channels: [{ name: 'hot', role: 'hot', transport: 'unix-socket', p95Ms: 2 }],
          },
          expectKey: 'hotP95Ms',
        },
        {
          script: join(repo, 'skills/agent-rl-sandbox-trainer/scripts/trajectory_eval_harness.mjs'),
          input: {
            agent: { name: 'safe' },
            unhooks: [{ name: 'reset', command: 'npm run reset', validated: true }],
            tasks: [{ id: 'task', instruction: 'Run test', expectedActions: [{ tool: 'run_tests' }], expectedEvidence: [{ kind: 'test-output', contains: ['PASS'], exitCode: 0 }] }],
            trajectories: [{ taskId: 'task', actions: [{ tool: 'run_tests', args: {} }], artifacts: [{ kind: 'test-output', content: 'PASS', exitCode: 0 }] }],
          },
          expectKey: 'summary',
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

describe('agentic coding skill contract files', () => {
  test.each(skillIds)('%s declares IO contracts and points to existing resources', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`]+)`/g)].map((match) => match[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
