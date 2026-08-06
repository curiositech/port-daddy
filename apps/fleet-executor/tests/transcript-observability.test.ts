/**
 * End-to-end coverage for the fleet run-page observability work: every MAP
 * chunk / REDUCE / purser call now carries its own model id, token usage, USD
 * cost, and the actual prompt sent + response received (capped; see
 * src/transcript-text.ts and src/call-accounting.ts) — not just a length.
 *
 * These drive the real `executeFleet` pipeline (same harness as
 * transcript.test.ts / no-usable-output-run.test.ts) and assert on what
 * actually lands in `fleet_run_steps.detail`, which is exactly what the relay
 * run page reads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import { TRANSCRIPT_TEXT_CAP } from '../src/transcript-text.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';

function fleetYaml(ships: Array<{ name: string; blocking?: boolean; model?: string }>): string {
  const body = ships
    .map(s => {
      const lines = [`    ${s.name}:`, '      trigger: pull_request:opened'];
      if (s.blocking) lines.push('      blocking: true');
      lines.push('      fallbacks:');
      lines.push('        - backend: cloudflare');
      lines.push(`          model: '${s.model ?? '@cf/openai/gpt-oss-120b'}'`);
      lines.push('      prompt: |');
      lines.push(`        ${s.name} ship: review the diff and report findings.`);
      return lines.join('\n');
    })
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

const REVIEWER_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/openai/gpt-oss-120b' },
]);

function seedToken(kv: KVNamespace, installationId = 42): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a transcript row names the model that row actually ran on', () => {
  it('MAP rows are accounted at the MAP model, not the ship\'s configured one', () => {
    // THE BELIEF: under tiering, `ship.cfModel` is what the ship REDUCES with.
    // Stamping it on a MAP row is wrong twice over -- it prices 92 cheap calls
    // at the capable model's rate, and it tells an operator reading the run
    // page that a chunk ran on a model it never touched.
    //
    // Asserted against source because the defect is a plausible-looking
    // argument at a call site, not a behaviour any fixture would catch: both
    // models produce a valid row, and only one of them is true.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src', 'execute.ts'), 'utf8');

    expect(
      src,
      'execute.ts is accounting a call at ship.cfModel again. Use mapModelFor(ship) ' +
        'on MAP rows and reduceModelFor(ship) on the REDUCE row -- under tiering ' +
        'those are different models and the row must name the one that ran.',
    ).not.toContain('perCallAccounting(ship.cfModel');
    expect(src).toContain('perCallAccounting(mapModelFor(ship)');
    expect(src).toContain('perCallAccounting(reduceModelFor(ship)');
  });
});

describe('per-call model/cost/prompt/response reach the transcript', () => {
  it('a single-chunk MAP step carries model, tokens, cost, and the real prompt+response', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv);
    const ai = aiStub({
      perShip: { 'code-reviewer': '```json\n[]\n```\nFLEET-VERDICT: PASS' },
      usage: { prompt_tokens: 900, completion_tokens: 60 },
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const mapStep = d1.steps.find(s => s.kind === 'map-chunk')!;
    const detail = JSON.parse(String(mapStep.detail));

    expect(detail.model).toBe('@cf/openai/gpt-oss-120b');
    expect(detail.usageReported).toBe(true);
    expect(detail.inputTokens).toBe(900);
    expect(detail.outputTokens).toBe(60);
    // 900/1e6*0.35 + 60/1e6*0.75 = 0.000315 + 0.000045 = 0.00036
    expect(detail.costUsd).toBeCloseTo(0.00036, 8);

    // The ACTUAL text, not just a length.
    expect(detail.prompt).toContain('## Diff');
    expect(detail.promptTruncated).toBe(false);
    expect(detail.promptLength).toBe(detail.prompt.length);
    expect(detail.response).toBe('```json\n[]\n```\nFLEET-VERDICT: PASS');
    expect(detail.responseTruncated).toBe(false);
    expect(detail.responseLength).toBe(detail.response.length);
  });

  it('the ship-spend row carries the ship system prompt once (capped), regardless of chunk count', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const spend = d1.steps.find(s => s.kind === 'ship-spend')!;
    const detail = JSON.parse(String(spend.detail));
    expect(typeof detail.systemPrompt).toBe('string');
    expect(detail.systemPrompt.length).toBeGreaterThan(0);
    expect(detail.systemPromptTruncated).toBe(false);
    expect(detail.systemPromptLength).toBe(detail.systemPrompt.length);
    // Same contract text the ship prompt was built from.
    expect(detail.systemPrompt).toContain('code-reviewer ship: review the diff');
  });

  it('a multi-chunk run records model/cost/prompt/response on BOTH map-chunk rows and the reduce row', async () => {
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + '+line\n'.repeat(1500);
    state.prDiff = file('a.ts') + file('b.ts');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'partial\n\nFLEET-VERDICT: PASS' },
      managerOutput: 'merged\n\nFLEET-VERDICT: PASS',
      usage: { prompt_tokens: 200, completion_tokens: 50 },
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const mapSteps = d1.steps.filter(s => s.kind === 'map-chunk');
    expect(mapSteps).toHaveLength(2);
    for (const step of mapSteps) {
      const detail = JSON.parse(String(step.detail));
      expect(detail.model).toBe('@cf/openai/gpt-oss-120b');
      expect(detail.costUsd).toBeGreaterThan(0);
      expect(detail.response).toBe('partial\n\nFLEET-VERDICT: PASS');
    }

    const reduceStep = d1.steps.find(s => s.kind === 'reduce')!;
    const reduceDetail = JSON.parse(String(reduceStep.detail));
    expect(reduceDetail.model).toBe('@cf/openai/gpt-oss-120b');
    expect(reduceDetail.costUsd).toBeGreaterThan(0);
    expect(reduceDetail.response).toBe('merged\n\nFLEET-VERDICT: PASS');
    // The merge prompt embeds both partial reviews.
    expect(reduceDetail.prompt).toContain('Partial review 1 of 2');
    expect(reduceDetail.prompt).toContain('Partial review 2 of 2');
  });

  it('truncates an oversized REDUCE merge prompt honestly instead of dropping it silently', async () => {
    // Five same-sized files, each just under MAP_CHUNK_CHAR_LIMIT (12,000
    // chars) so chunkDiff keeps them as five SEPARATE chunks (two of them
    // combined would exceed the per-chunk budget). Each MAP call returns a
    // ~5,000-char partial; REDUCE's merge prompt concatenates all five
    // ("## Partial review i of 5\n\n<partial>") — comfortably past the
    // 24,000-char transcript cap — so the run page must say so rather than
    // just cutting it.
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + '+line\n'.repeat(1830); // ~11,000 chars
    state.prDiff = ['a', 'b', 'c', 'd', 'e'].map(n => file(`${n}.ts`)).join('');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv);
    const bigPartial = 'FINDING '.repeat(625) + '\n\nFLEET-VERDICT: PASS'; // ~5,000 chars
    const ai = aiStub({
      perShip: { 'code-reviewer': bigPartial },
      managerOutput: 'merged\n\nFLEET-VERDICT: PASS',
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const mapSteps = d1.steps.filter(s => s.kind === 'map-chunk');
    expect(mapSteps.length).toBeGreaterThan(1); // confirms the multi-chunk fan-out this test relies on

    const reduceStep = d1.steps.find(s => s.kind === 'reduce')!;
    const detail = JSON.parse(String(reduceStep.detail));
    expect(detail.promptTruncated).toBe(true);
    expect(detail.prompt.length).toBe(TRANSCRIPT_TEXT_CAP);
    // The truth about how much was cut is never lost, even though the tail is.
    expect(detail.promptLength).toBeGreaterThan(TRANSCRIPT_TEXT_CAP);
  });
});
