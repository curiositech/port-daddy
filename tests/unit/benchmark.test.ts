/**
 * Unit tests for lib/benchmark.ts — no live LLM calls required.
 *
 * Tests: model catalog shape, condition preset invariants, judge panel
 * diversity, cost rates, and TaskConditionResult shape.
 */
import { describe, expect, test } from '@jest/globals';
import {
  BENCHMARK_MODELS,
  PRESET_CONDITIONS,
  PRESET_JUDGES,
  type TaskConditionResult,
} from '../../lib/benchmark.js';

function makeResult(
  taskId: string,
  conditionId: string,
  candidateTexts: string[],
  avgJudgeScore: number | null = null,
): TaskConditionResult {
  return {
    taskId,
    conditionId,
    candidateOutputs: candidateTexts.map((text, i) => ({ modelLabel: `model-${i}`, text })),
    synthesizedAnswer: candidateTexts[0] ?? '',
    judgeScores: avgJudgeScore !== null
      ? [{ judgeLabel: 'test-judge', score: avgJudgeScore, rationale: '' }]
      : [],
    avgJudgeScore,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    elapsedMs: 500,
  };
}

// ─── Model catalog ────────────────────────────────────────────────────────────

describe('BENCHMARK_MODELS', () => {
  test('all required models are present', () => {
    const required = ['kimi-k2', 'qwen3-72b', 'gpt-4o', 'codex-5.5', 'claude-sonnet', 'claude-opus'];
    for (const id of required) {
      expect(BENCHMARK_MODELS).toHaveProperty([id]);
    }
  });

  test('each model has a non-empty label', () => {
    for (const m of Object.values(BENCHMARK_MODELS)) {
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  test('each model adapter is a known value', () => {
    const valid = new Set(['cloudflare', 'openai', 'claude-sdk', 'ollama']);
    for (const [id, m] of Object.entries(BENCHMARK_MODELS)) {
      expect(valid.has(m.adapter)).toBe(true);
    }
  });

  test('each model has a non-empty model string', () => {
    for (const m of Object.values(BENCHMARK_MODELS)) {
      expect(m.model.length).toBeGreaterThan(0);
    }
  });

  test('cost rates are non-negative when present', () => {
    for (const m of Object.values(BENCHMARK_MODELS)) {
      if (m.inputCostPer1M !== undefined) {
        expect(m.inputCostPer1M).toBeGreaterThanOrEqual(0);
      }
      if (m.outputCostPer1M !== undefined) {
        expect(m.outputCostPer1M).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('gpt-4o costs more than gpt-4o-mini', () => {
    const full = BENCHMARK_MODELS['gpt-4o'];
    const mini = BENCHMARK_MODELS['gpt-4o-mini'];
    expect(full.inputCostPer1M!).toBeGreaterThan(mini.inputCostPer1M!);
  });

  test('ollama model has zero cost', () => {
    const local = BENCHMARK_MODELS['ollama-llama3'];
    expect(local.inputCostPer1M).toBe(0);
    expect(local.outputCostPer1M).toBe(0);
  });
});

// ─── Condition presets ────────────────────────────────────────────────────────

describe('PRESET_CONDITIONS', () => {
  test('all required presets exist', () => {
    const required = [
      'h-claude', 'h-openai', 'h-kimi', 'h-qwen', 'h-codex',
      'd-mixed', 'd-wide', 'solo-opus',
    ];
    for (const id of required) {
      expect(PRESET_CONDITIONS).toHaveProperty(id);
    }
  });

  test('each condition id matches its key', () => {
    for (const [key, c] of Object.entries(PRESET_CONDITIONS)) {
      expect(c.id).toBe(key);
    }
  });

  test('homogeneous conditions use a single repeated model', () => {
    const homo = Object.values(PRESET_CONDITIONS).filter((c) => c.type === 'homogeneous');
    expect(homo.length).toBeGreaterThan(0);
    for (const c of homo) {
      const unique = new Set(c.models.map((m) => m.model));
      expect(unique.size).toBe(1);
    }
  });

  test('heterogeneous conditions use at least 2 distinct models', () => {
    const hetero = Object.values(PRESET_CONDITIONS).filter((c) => c.type === 'heterogeneous');
    expect(hetero.length).toBeGreaterThan(0);
    for (const c of hetero) {
      const unique = new Set(c.models.map((m) => m.model));
      expect(unique.size).toBeGreaterThanOrEqual(2);
    }
  });

  test('solo conditions have exactly 1 model entry', () => {
    const solo = Object.values(PRESET_CONDITIONS).filter((c) => c.type === 'solo');
    expect(solo.length).toBeGreaterThan(0);
    for (const c of solo) {
      expect(c.models.length).toBe(1);
    }
  });

  test('all conditions have at least one model', () => {
    for (const c of Object.values(PRESET_CONDITIONS)) {
      expect(c.models.length).toBeGreaterThan(0);
    }
  });
});

// ─── Judge panel ──────────────────────────────────────────────────────────────

describe('PRESET_JUDGES', () => {
  test('has at least 3 judges', () => {
    expect(PRESET_JUDGES.length).toBeGreaterThanOrEqual(3);
  });

  test('judges span at least 2 adapters (vendor diversity)', () => {
    const adapters = new Set(PRESET_JUDGES.map((j) => j.adapter));
    expect(adapters.size).toBeGreaterThanOrEqual(2);
  });

  test('judges span at least 3 distinct model strings', () => {
    const models = new Set(PRESET_JUDGES.map((j) => j.model));
    expect(models.size).toBeGreaterThanOrEqual(3);
  });
});

// ─── TaskConditionResult shape ────────────────────────────────────────────────

describe('TaskConditionResult (makeResult helper)', () => {
  test('avgJudgeScore is null when no judges ran', () => {
    const r = makeResult('t1', 'h-claude', ['answer'], null);
    expect(r.avgJudgeScore).toBeNull();
    expect(r.judgeScores.length).toBe(0);
  });

  test('judgeScores populated when score provided', () => {
    const r = makeResult('t1', 'h-claude', ['answer'], 7);
    expect(r.judgeScores.length).toBe(1);
    expect(r.judgeScores[0].score).toBe(7);
    expect(r.avgJudgeScore).toBe(7);
  });

  test('candidateOutputs length matches fleet size', () => {
    const r = makeResult('t1', 'd-mixed', ['a', 'b', 'c'], 8);
    expect(r.candidateOutputs.length).toBe(3);
  });

  test('synthesizedAnswer defaults to first candidate', () => {
    const r = makeResult('t1', 'h-kimi', ['first', 'second']);
    expect(r.synthesizedAnswer).toBe('first');
  });
});
