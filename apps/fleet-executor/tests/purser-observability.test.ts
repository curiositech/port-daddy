/**
 * Per-call accounting + full-text capture for the purser's two AI calls
 * (steel-man, test-authoring) — the same run-page observability work as
 * transcript-observability.test.ts, exercised through `runPurser` directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { runPurser, type TranscriptLike, type PurserMetrics } from '../src/purser.js';
import { type ShipConfig } from '../src/fleet.js';
import { makeEnv } from './harness.js';
import type { PRContext } from '../src/github.js';
import { TRANSCRIPT_TEXT_CAP } from '../src/transcript-text.js';

const OWNER = 'erichowens';
const REPO = 'port-daddy';

const STEELMAN_JSON = [
  '```json',
  JSON.stringify({
    purpose: 'Guarantee the widget frobs deterministically.',
    contract: { obligations: ['frobs on empty input without throwing'] },
    testTargets: ['src/widget.ts'],
  }),
  '```',
].join('\n');

const TESTS_JSON = [
  '```json',
  JSON.stringify({
    files: [{ path: 'tests/purser/widget.contract.test.ts', contents: 'it("frobs", () => {});' }],
  }),
  '```',
].join('\n');

function mkShip(over: Partial<ShipConfig> = {}): ShipConfig {
  return {
    name: 'purser',
    trigger: 'pull_request:opened',
    prompt: 'You are pd-purser.',
    cfModel: '@cf/qwen/qwen3-30b-a3b-fp8',
    temperature: null,
    role: 'Hold the PR to its best interpretation.',
    telos: 'Steel-man, then demand.',
    blocking: false,
    needsExecution: false,
    ideation: false,
    purser: true,
    blockWithoutSandbox: false,
    testPaths: [],
    graft: [],
    ...over,
  };
}

function mkCtx(over: Partial<PRContext> = {}): PRContext {
  return {
    owner: OWNER,
    repo: REPO,
    prNumber: 7,
    title: 'Add widget frobbing',
    body: 'Frobs the widget.',
    headSha: 'HEADSHA',
    headRef: 'feat/widget',
    baseSha: 'BASESHA',
    baseRef: 'main',
    isFork: false,
    authorLogin: 'a-human',
    authorType: 'User',
    state: 'open',
    merged: false,
    installationId: 0,
    files: [{ filename: 'src/widget.ts', status: 'modified', additions: 3, deletions: 1 }],
    diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+frob',
    ...over,
  };
}

/** Sequential AI stub whose responses carry a usage block (steel-man, then tests). */
function seqAiWithUsage(
  responses: Array<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }>,
): Ai {
  let i = 0;
  const run = vi.fn(async () => {
    const r = responses[i++];
    return { response: r?.text ?? '', usage: r?.usage };
  });
  return { run } as unknown as Ai;
}

interface RecordedStep { kind: string; ship: string | null; title: string; detail: unknown }

function recorder(): { steps: RecordedStep[]; transcript: TranscriptLike } {
  const steps: RecordedStep[] = [];
  return {
    steps,
    transcript: {
      async step(kind, ship, title, detail) {
        steps.push({ kind, ship, title, detail });
      },
    },
  };
}

function freshMetrics(): PurserMetrics {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, calls: 0, allEmpty: true, usageReports: 0 };
}

describe('purser per-call model/cost/prompt/response', () => {
  it('purser-steelman carries model, cost, and the real system/user prompt + response', async () => {
    const ai = seqAiWithUsage([
      { text: STEELMAN_JSON, usage: { prompt_tokens: 300, completion_tokens: 80 } },
      { text: TESTS_JSON, usage: { prompt_tokens: 400, completion_tokens: 120 } },
    ]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-steelman')!;
    const detail = step.detail as Record<string, unknown>;
    expect(detail.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(detail.usageReported).toBe(true);
    expect(detail.inputTokens).toBe(300);
    expect(detail.outputTokens).toBe(80);
    // 300/1e6*0.051 + 80/1e6*0.335 = 0.0000153 + 0.0000268 = 0.0000421
    expect(detail.costUsd).toBeCloseTo(0.0000421, 6);
    expect(typeof detail.systemPrompt).toBe('string');
    expect(detail.systemPrompt as string).toContain('STEEL-MAN phase');
    expect(typeof detail.userPrompt).toBe('string');
    expect(detail.userPrompt as string).toContain('Add widget frobbing');
    expect(detail.response).toBe(STEELMAN_JSON);
  });

  it('purser-tests carries model, cost, and the real system/user prompt + response', async () => {
    const ai = seqAiWithUsage([
      { text: STEELMAN_JSON, usage: { prompt_tokens: 300, completion_tokens: 80 } },
      { text: TESTS_JSON, usage: { prompt_tokens: 400, completion_tokens: 120 } },
    ]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-tests' && (s.detail as Record<string, unknown>).files)!;
    const detail = step.detail as Record<string, unknown>;
    expect(detail.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(detail.inputTokens).toBe(400);
    expect(detail.outputTokens).toBe(120);
    expect(typeof detail.systemPrompt).toBe('string');
    expect(detail.systemPrompt as string).toContain('ADVERSARIAL TEST AUTHORING');
    expect(detail.response).toBe(TESTS_JSON);
  });

  it('a malformed steel-man still records model/cost/prompt/response on the error step', async () => {
    const ai = seqAiWithUsage([
      { text: 'not json at all', usage: { prompt_tokens: 50, completion_tokens: 10 } },
    ]);
    const rec = recorder();

    await runPurser(mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-steelman')!;
    const detail = step.detail as Record<string, unknown>;
    expect(detail.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(detail.usageReported).toBe(true);
    expect(detail.response).toBe('not json at all');

    // A FAILED call still costs money, and this row is the only place that says
    // so. The failure path is where accounting matters MOST -- a run that burns
    // budget producing unusable output is exactly the run an operator needs to
    // find, and it is the one least likely to be looked at otherwise.
    //
    // Raised in review: this case asserted model and response only, while its
    // own name promised "model/cost/prompt/response" and the PR body claimed
    // accounting survives a parse failure. The name was right and the
    // assertions were not.
    expect(detail.inputTokens).toBe(50);
    expect(detail.outputTokens).toBe(10);
    // 50/1e6*0.051 + 10/1e6*0.335 = 0.00000255 + 0.00000335 = 0.0000059,
    // which costUsdForModel rounds to 6 decimals -> 0.000006. Asserted at the
    // ROUNDED value on purpose: at these token counts the rounding is a ~1.7%
    // move, so a test written against the unrounded arithmetic fails for a
    // reason unrelated to the behaviour under test (it did, first time). The
    // 6-decimal quantisation is deliberate -- see spend.ts, it keeps sub-cent
    // Workers AI costs from vanishing to zero.
    expect(detail.costUsd).toBeCloseTo(0.000006, 7);
    // And the prompts that produced the unusable output -- a rejection without
    // its prompt cannot be diagnosed, only noticed.
    expect(detail.systemPrompt as string).toContain('STEEL-MAN phase');
    expect(detail.userPrompt as string).toContain('Add widget frobbing');
  });

  it('an oversized PR body/diff is truncated in the transcript honestly, never silently dropped', async () => {
    const hugeBody = 'B'.repeat(TRANSCRIPT_TEXT_CAP + 5_000);
    const ai = seqAiWithUsage([
      { text: STEELMAN_JSON, usage: { prompt_tokens: 300, completion_tokens: 80 } },
      { text: TESTS_JSON, usage: { prompt_tokens: 400, completion_tokens: 120 } },
    ]);
    const rec = recorder();

    await runPurser(
      mkShip(),
      mkCtx({ body: hugeBody }),
      makeEnv({ AI: ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    const step = rec.steps.find(s => s.kind === 'purser-steelman')!;
    const detail = step.detail as Record<string, unknown>;
    expect(detail.userPromptTruncated).toBe(true);
    expect((detail.userPrompt as string).length).toBe(TRANSCRIPT_TEXT_CAP);
    expect(detail.userPromptLength as number).toBeGreaterThan(TRANSCRIPT_TEXT_CAP);
  });
});
