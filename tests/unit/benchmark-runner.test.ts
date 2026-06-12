/**
 * Runner-level tests for lib/benchmark.ts — exercises the actual aggregation
 * logic (synthesis, blind-judge scoring + JSON parse, error correlation,
 * buildSummary, auto-grade, cost estimate) with mocked adapters so no live
 * LLM calls are made.
 *
 * The static-catalog invariants live in benchmark.test.ts; this file proves
 * the math the whole feature exists to produce.
 *
 * Mocking idiom: jest.unstable_mockModule must be declared before the dynamic
 * import of the module under test (see tests/unit/cli-fetch.test.js).
 */
import { jest } from '@jest/globals';
import type { LLMCompletionResult } from '../../lib/llm-call.js';

// The adapter mock is a single programmable function. Each test installs a
// responder that maps (model, prompt) -> LLMCompletionResult so we can drive
// candidate text, synthesis output, and judge JSON deterministically.
type Responder = (model: string, prompt: string) => LLMCompletionResult;
let responder: Responder = () => ({ ok: true, text: 'default' });

const cloudflareAdapter = jest.fn(async (req: any) => responder(req.model, req.prompt));
const ollamaAdapter = jest.fn(async (req: any) => responder(req.model, req.prompt));
const openaiAdapter = jest.fn(async (req: any) => responder(req.model, req.prompt));

jest.unstable_mockModule('../../lib/llm-call.js', () => ({
  cloudflareAdapter,
  ollamaAdapter,
}));

jest.unstable_mockModule('../../lib/spawner/backends/openai.js', () => ({
  openaiAdapter,
}));

const { runBenchmark } = await import('../../lib/benchmark.js');
import type {
  BenchmarkModel,
  BenchmarkTask,
  BenchmarkCondition,
} from '../../lib/benchmark.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const M = {
  a: { label: 'A', adapter: 'openai', model: 'model-a', inputCostPer1M: 1, outputCostPer1M: 2 } as BenchmarkModel,
  b: { label: 'B', adapter: 'cloudflare', model: 'model-b', inputCostPer1M: 0.5, outputCostPer1M: 1 } as BenchmarkModel,
  c: { label: 'C', adapter: 'ollama', model: 'model-c', inputCostPer1M: 0, outputCostPer1M: 0 } as BenchmarkModel,
  j1: { label: 'J1', adapter: 'openai', model: 'judge-1' } as BenchmarkModel,
  j2: { label: 'J2', adapter: 'cloudflare', model: 'judge-2' } as BenchmarkModel,
  j3: { label: 'J3', adapter: 'ollama', model: 'judge-3' } as BenchmarkModel,
};

const soloA: BenchmarkCondition = { id: 's-a', type: 'solo', models: [M.a] };
const heteroABC: BenchmarkCondition = { id: 'd-abc', type: 'heterogeneous', models: [M.a, M.b, M.c] };
const homoAAA: BenchmarkCondition = { id: 'h-aaa', type: 'homogeneous', models: [M.a, M.a, M.a] };

function task(id: string, ref?: string): BenchmarkTask {
  return { id, category: 'reasoning', prompt: `prompt for ${id}`, referenceAnswer: ref };
}

const baseOpts = { concurrency: 4, verbose: false, callTimeoutMs: 1000 };

beforeEach(() => {
  responder = () => ({ ok: true, text: 'default' });
  cloudflareAdapter.mockClear();
  ollamaAdapter.mockClear();
  openaiAdapter.mockClear();
});

// A judge responder that scores a fixed value and emits valid JSON.
function judgeReturning(score: number): Responder {
  return (model, prompt) => {
    if (model.startsWith('judge-')) {
      return { ok: true, text: JSON.stringify({ score, rationale: 'ok' }) };
    }
    // Candidate / synthesis call: echo a candidate, with token counts.
    return { ok: true, text: `answer-from-${model}`, inputTokens: 10, outputTokens: 5 };
  };
}

// ─── Judge scoring + JSON parse ───────────────────────────────────────────────

describe('runBenchmark — judge scoring', () => {
  test('parses judge JSON and averages scores into avgJudgeScore', async () => {
    responder = judgeReturning(8);
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [M.j1, M.j2, M.j3], judgesPerResponse: 3, ...baseOpts },
    );
    const r = report.results[0];
    expect(r.judgeScores.length).toBe(3);
    expect(r.avgJudgeScore).toBe(8);
    expect(report.summary[0].avgJudgeScore).toBe(8);
  });

  test('clamps out-of-range judge scores into 0..10', async () => {
    responder = (model) =>
      model.startsWith('judge-')
        ? { ok: true, text: JSON.stringify({ score: 42, rationale: 'too high' }) }
        : { ok: true, text: 'x', inputTokens: 1, outputTokens: 1 };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    expect(report.results[0].judgeScores[0].score).toBe(10);
  });

  test('a judge returning non-JSON yields score 0 with a parse-error rationale', async () => {
    responder = (model) =>
      model.startsWith('judge-')
        ? { ok: true, text: 'I think this is pretty good, no JSON here' }
        : { ok: true, text: 'x', inputTokens: 1, outputTokens: 1 };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    expect(report.results[0].judgeScores[0].score).toBe(0);
    expect(report.results[0].judgeScores[0].rationale).toMatch(/Parse error/);
  });

  test('judges that are also condition models are excluded from the panel', async () => {
    responder = judgeReturning(7);
    // J-overlap shares the label 'A' with the condition's model.
    const judgeOverlap: BenchmarkModel = { label: 'A', adapter: 'openai', model: 'judge-overlap' };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [judgeOverlap, M.j2], judgesPerResponse: 2, ...baseOpts },
    );
    // Only J2 is eligible (overlap excluded by label), so exactly one judge ran.
    const judgeLabels = report.results[0].judgeScores.map((j) => j.judgeLabel);
    expect(judgeLabels).toEqual(['J2']);
  });
});

// ─── Synthesis (MoA pass) ─────────────────────────────────────────────────────

describe('runBenchmark — synthesis', () => {
  test('solo condition skips synthesis (single candidate passes through)', async () => {
    responder = (model) =>
      model.startsWith('judge-')
        ? { ok: true, text: JSON.stringify({ score: 5, rationale: '' }) }
        : { ok: true, text: `answer-from-${model}`, inputTokens: 4, outputTokens: 2 };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    const r = report.results[0];
    expect(r.candidateOutputs.length).toBe(1);
    expect(r.synthesizedAnswer).toBe('answer-from-model-a');
  });

  test('multi-model condition runs a synthesis pass over candidates', async () => {
    let sawSynthesisPrompt = false;
    responder = (model, prompt) => {
      if (model.startsWith('judge-')) return { ok: true, text: JSON.stringify({ score: 6, rationale: '' }) };
      if (prompt.includes('synthesis engine')) {
        sawSynthesisPrompt = true;
        return { ok: true, text: 'SYNTHESIZED', inputTokens: 3, outputTokens: 3 };
      }
      return { ok: true, text: `cand-${model}`, inputTokens: 4, outputTokens: 2 };
    };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [heteroABC], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    expect(sawSynthesisPrompt).toBe(true);
    expect(report.results[0].synthesizedAnswer).toBe('SYNTHESIZED');
    expect(report.results[0].candidateOutputs.length).toBe(3);
  });
});

// ─── Error handling on candidate failure ──────────────────────────────────────

describe('runBenchmark — candidate errors', () => {
  test('a failing candidate is recorded as [ERROR ...] and surfaced on the result', async () => {
    responder = (model) => {
      if (model.startsWith('judge-')) return { ok: true, text: JSON.stringify({ score: 5, rationale: '' }) };
      if (model === 'model-b') return { ok: false, error: 'boom' };
      return { ok: true, text: `cand-${model}`, inputTokens: 4, outputTokens: 2 };
    };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [heteroABC], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    const r = report.results[0];
    expect(r.error).toBe('boom');
    const errored = r.candidateOutputs.find((c) => c.text.startsWith('[ERROR'));
    expect(errored?.modelLabel).toBe('B');
  });

  test('all candidates failing yields empty synthesis and null judge score', async () => {
    responder = (model) =>
      model.startsWith('judge-')
        ? { ok: true, text: JSON.stringify({ score: 5, rationale: '' }) }
        : { ok: false, error: 'down' };
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [soloA], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    const r = report.results[0];
    expect(r.synthesizedAnswer).toBe('');
    expect(r.avgJudgeScore).toBeNull();
    expect(r.judgeScores.length).toBe(0);
  });
});

// ─── Auto-grading via referenceAnswer ─────────────────────────────────────────

describe('runBenchmark — auto-grade', () => {
  test('referenceAnswer present => binary autoCorrect, no judge calls', async () => {
    responder = (model) => {
      if (model.startsWith('judge-')) throw new Error('judges must not run for auto-graded tasks');
      return { ok: true, text: 'the answer is 28 days', inputTokens: 4, outputTokens: 2 };
    };
    const report = await runBenchmark(
      { tasks: [task('t1', '28')], conditions: [soloA], judges: [M.j1], judgesPerResponse: 1, ...baseOpts },
    );
    const r = report.results[0];
    expect(r.autoCorrect).toBe(true);
    expect(r.judgeScores.length).toBe(0);
    expect(r.avgJudgeScore).toBeNull();
    expect(report.summary[0].autoCorrectRate).toBe(1);
  });

  test('autoCorrect is false when the reference is absent from the answer', async () => {
    responder = () => ({ ok: true, text: 'the answer is 30', inputTokens: 4, outputTokens: 2 });
    const report = await runBenchmark(
      { tasks: [task('t1', '28')], conditions: [soloA], judges: [M.j1], ...baseOpts },
    );
    expect(report.results[0].autoCorrect).toBe(false);
    expect(report.summary[0].autoCorrectRate).toBe(0);
  });
});

// ─── Error correlation + summary aggregation ──────────────────────────────────

describe('runBenchmark — error correlation', () => {
  test('models that always fail together yield correlation ~1 (no diversity dividend)', async () => {
    // 4 tasks; homogeneous fleet of 3. Make every response "wrong" (judge<=4)
    // for half the tasks and "right" for the other half, identically across
    // candidates — perfectly correlated failures.
    const wrongTasks = new Set(['t1', 't2']);
    responder = (model, prompt) => {
      if (model.startsWith('judge-')) {
        // Derive task from the prompt text ("prompt for tN" is embedded).
        const m = prompt.match(/prompt for (t\d)/);
        const tid = m?.[1] ?? '';
        const score = wrongTasks.has(tid) ? 2 : 9;
        return { ok: true, text: JSON.stringify({ score, rationale: '' }) };
      }
      return { ok: true, text: `cand-${model}`, inputTokens: 4, outputTokens: 2 };
    };
    const tasks = ['t1', 't2', 't3', 't4'].map((id) => task(id));
    const report = await runBenchmark(
      { tasks, conditions: [homoAAA], judges: [M.j1, M.j2, M.j3], judgesPerResponse: 3, ...baseOpts },
    );
    const corr = report.summary[0].avgErrorCorrelation;
    expect(corr).not.toBeNull();
    expect(corr!).toBeCloseTo(1, 5);
  });

  test('correlation is null with fewer than 3 scored multi-candidate results', async () => {
    responder = judgeReturning(8);
    const report = await runBenchmark(
      { tasks: [task('t1')], conditions: [heteroABC], judges: [M.j1, M.j2, M.j3], judgesPerResponse: 3, ...baseOpts },
    );
    // Only one task => fewer than 3 scored results => correlation undefined.
    expect(report.summary[0].avgErrorCorrelation).toBeNull();
  });
});

describe('runBenchmark — summary aggregation', () => {
  test('summary reports model labels, task count, token averages, and a positive cost estimate', async () => {
    responder = (model) =>
      model.startsWith('judge-')
        ? { ok: true, text: JSON.stringify({ score: 7, rationale: '' }) }
        : { ok: true, text: `cand-${model}`, inputTokens: 10, outputTokens: 5 };
    const tasks = [task('t1'), task('t2')];
    const report = await runBenchmark(
      { tasks, conditions: [heteroABC], judges: [M.j1, M.j2, M.j3], judgesPerResponse: 3, ...baseOpts },
    );
    const s = report.summary[0];
    expect(s.conditionId).toBe('d-abc');
    expect(s.conditionType).toBe('heterogeneous');
    expect(s.modelLabels).toEqual(['A', 'B', 'C']);
    expect(s.taskCount).toBe(2);
    // 3 candidates × 10 input each = 30 input tokens per task.
    expect(s.avgInputTokens).toBe(30);
    expect(s.avgOutputTokens).toBe(15);
    // Cost is strictly positive because A and B carry nonzero rates.
    expect(s.estimatedCostUsd).toBeGreaterThan(0);
  });

  test('runId, timestamps, and per-task×condition result count are well-formed', async () => {
    responder = judgeReturning(5);
    const tasks = [task('t1'), task('t2')];
    const report = await runBenchmark(
      { tasks, conditions: [soloA, heteroABC], judges: [M.j1, M.j2, M.j3], judgesPerResponse: 3, ...baseOpts },
    );
    expect(report.runId).toMatch(/^bm-/);
    expect(Date.parse(report.startedAt)).not.toBeNaN();
    expect(Date.parse(report.completedAt)).not.toBeNaN();
    // 2 tasks × 2 conditions = 4 results.
    expect(report.results.length).toBe(4);
    expect(report.summary.length).toBe(2);
  });
});
