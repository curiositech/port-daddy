/**
 * pd benchmark — multi-backend LLM diversity experiment runner.
 *
 * Runs a task corpus against named fleet conditions (homogeneous or
 * heterogeneous), aggregates answers via MoA-style synthesis, and scores
 * each response with a rotating blind judge panel drawn from a different
 * set of backends.
 *
 * The core claim under test: heterogeneous LLM ensembles produce better
 * outputs than homogeneous fleets of the same size — the "diversity
 * dividend." Reference: Wang et al., Mixture-of-Agents (ICLR 2025).
 *
 * Architecture:
 *   BenchmarkRunner.run(config)
 *     → for each task × condition:
 *         runCondition() → N parallel completions → synthesize → score
 *     → aggregate() → BenchmarkReport
 *
 * Backends used here:
 *   - cloudflare  (@cf/moonshotai/kimi-k2-instruct, @cf/qwen/qwen3-72b)
 *   - openai      (gpt-4o, o4-mini / codex-5.5)
 *   - claude      (via SDK — claude-opus-4-8, claude-sonnet-4-6)
 *   - ollama      (local fallback)
 *
 * All completions go through the existing llm-call adapters so credential
 * resolution, error shapes, and token counting stay consistent.
 */

import { cloudflareAdapter, ollamaAdapter } from './llm-call.js';
import { openaiAdapter } from './spawner/backends/openai.js';
import type { LLMCompletionRequest, LLMCompletionResult } from './llm-call.js';

// ─── Public types ────────────────────────────────────────────────────────────

export interface BenchmarkModel {
  /** Display label shown in reports. */
  label: string;
  /** Adapter key: 'cloudflare' | 'openai' | 'claude-sdk' | 'ollama' */
  adapter: 'cloudflare' | 'openai' | 'claude-sdk' | 'ollama';
  /** Model identifier forwarded to the adapter. */
  model: string;
  /** Cost per 1M input tokens in USD (for spend projection). */
  inputCostPer1M?: number;
  /** Cost per 1M output tokens in USD. */
  outputCostPer1M?: number;
}

export interface BenchmarkCondition {
  /** Short identifier used in results (e.g. 'h-claude', 'd-mixed'). */
  id: string;
  /** 'homogeneous' | 'heterogeneous' | 'solo' */
  type: 'homogeneous' | 'heterogeneous' | 'solo';
  /** Models that generate candidate answers. For solo, length must be 1. */
  models: BenchmarkModel[];
}

export interface BenchmarkTask {
  id: string;
  /** Task category used for sliced reporting. */
  category: 'code' | 'math' | 'reasoning' | 'review';
  /** The prompt sent to each model. */
  prompt: string;
  /**
   * Optional reference answer for auto-grading multiple-choice tasks.
   * When set, judge scoring is skipped and correctness is binary.
   */
  referenceAnswer?: string;
}

export interface BenchmarkConfig {
  /** Task corpus to run. */
  tasks: BenchmarkTask[];
  /** Fleet conditions to compare. */
  conditions: BenchmarkCondition[];
  /** Models used as blind judges. Must not overlap with condition models. */
  judges: BenchmarkModel[];
  /**
   * Number of judges randomly drawn per response. Min 1, max judges.length.
   * Default: min(3, judges.length).
   */
  judgesPerResponse?: number;
  /** Abort timeout per individual LLM call in ms. Default 60_000. */
  callTimeoutMs?: number;
  /** Max concurrent LLM calls across all conditions. Default 6. */
  concurrency?: number;
  /** If true, emit progress lines to stdout during the run. Default true. */
  verbose?: boolean;
}

export interface TaskConditionResult {
  taskId: string;
  conditionId: string;
  /** Raw outputs per model before synthesis. */
  candidateOutputs: Array<{ modelLabel: string; text: string; inputTokens?: number; outputTokens?: number }>;
  /** Synthesized final answer (MoA pass). */
  synthesizedAnswer: string;
  /** Judge scores (one per judge that evaluated this response). */
  judgeScores: Array<{ judgeLabel: string; score: number; rationale: string }>;
  /** Average judge score 0–10. Null if no judges ran (auto-graded). */
  avgJudgeScore: number | null;
  /** Auto-grade result when referenceAnswer was provided. */
  autoCorrect?: boolean;
  /** Total tokens consumed generating candidates + synthesis. */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Wall-clock ms for this task×condition. */
  elapsedMs: number;
  error?: string;
}

export interface BenchmarkReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  config: Pick<BenchmarkConfig, 'conditions' | 'judges' | 'judgesPerResponse' | 'concurrency'>;
  results: TaskConditionResult[];
  summary: ConditionSummary[];
}

export interface ConditionSummary {
  conditionId: string;
  conditionType: 'homogeneous' | 'heterogeneous' | 'solo';
  modelLabels: string[];
  taskCount: number;
  avgJudgeScore: number | null;
  autoCorrectRate: number | null;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** Estimated USD spend based on model cost rates. */
  estimatedCostUsd: number;
  /** Pairwise error correlation across candidate outputs (0=no correlation). */
  avgErrorCorrelation: number | null;
  /** Per-category breakdown. */
  byCategory: Record<string, { avgJudgeScore: number | null; autoCorrectRate: number | null; count: number }>;
}

// ─── Well-known model catalog ─────────────────────────────────────────────────

/** Pre-configured models ready to use by ID. Extend as new models launch. */
export const BENCHMARK_MODELS: Record<string, BenchmarkModel> = {
  // Cloudflare Workers AI
  'kimi-k2': {
    label: 'Kimi K2 (CF)',
    adapter: 'cloudflare',
    model: '@cf/moonshotai/kimi-k2-instruct',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
  },
  'qwen3-72b': {
    label: 'Qwen3-72B (CF)',
    adapter: 'cloudflare',
    model: '@cf/qwen/qwen3-72b-fp8-fast',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
  },
  // OpenAI
  'gpt-4o': {
    label: 'GPT-4o',
    adapter: 'openai',
    model: 'gpt-4o',
    inputCostPer1M: 2.50,
    outputCostPer1M: 10.00,
  },
  'codex-5.5': {
    label: 'Codex 5.5 (o4-mini)',
    adapter: 'openai',
    model: 'o4-mini',
    inputCostPer1M: 1.10,
    outputCostPer1M: 4.40,
  },
  'gpt-4o-mini': {
    label: 'GPT-4o-mini',
    adapter: 'openai',
    model: 'gpt-4o-mini',
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
  },
  // Anthropic (via cloudflare gateway or direct SDK — uses cloudflare adapter
  // pointed at Anthropic's CF-hosted endpoint when CF_ANTHROPIC_GATEWAY is set,
  // otherwise falls back to openai-compat adapter with ANTHROPIC_API_KEY)
  'claude-sonnet': {
    label: 'Claude Sonnet 4.6',
    adapter: 'openai',  // Anthropic OpenAI-compat endpoint
    model: 'claude-sonnet-4-6',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
  },
  'claude-opus': {
    label: 'Claude Opus 4.8',
    adapter: 'openai',
    model: 'claude-opus-4-8',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
  },
  // Local
  'ollama-llama3': {
    label: 'Llama 3.1 8B (local)',
    adapter: 'ollama',
    model: 'llama3.1:8b',
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
};

/** Pre-built conditions matching the experiment design. */
export const PRESET_CONDITIONS: Record<string, BenchmarkCondition> = {
  'h-claude': {
    id: 'h-claude',
    type: 'homogeneous',
    models: [BENCHMARK_MODELS['claude-sonnet'], BENCHMARK_MODELS['claude-sonnet'], BENCHMARK_MODELS['claude-sonnet']],
  },
  'h-openai': {
    id: 'h-openai',
    type: 'homogeneous',
    models: [BENCHMARK_MODELS['gpt-4o'], BENCHMARK_MODELS['gpt-4o'], BENCHMARK_MODELS['gpt-4o']],
  },
  'h-kimi': {
    id: 'h-kimi',
    type: 'homogeneous',
    models: [BENCHMARK_MODELS['kimi-k2'], BENCHMARK_MODELS['kimi-k2'], BENCHMARK_MODELS['kimi-k2']],
  },
  'h-qwen': {
    id: 'h-qwen',
    type: 'homogeneous',
    models: [BENCHMARK_MODELS['qwen3-72b'], BENCHMARK_MODELS['qwen3-72b'], BENCHMARK_MODELS['qwen3-72b']],
  },
  'h-codex': {
    id: 'h-codex',
    type: 'homogeneous',
    models: [BENCHMARK_MODELS['codex-5.5'], BENCHMARK_MODELS['codex-5.5'], BENCHMARK_MODELS['codex-5.5']],
  },
  'd-mixed': {
    id: 'd-mixed',
    type: 'heterogeneous',
    models: [BENCHMARK_MODELS['claude-sonnet'], BENCHMARK_MODELS['codex-5.5'], BENCHMARK_MODELS['kimi-k2']],
  },
  'd-wide': {
    id: 'd-wide',
    type: 'heterogeneous',
    models: [BENCHMARK_MODELS['claude-opus'], BENCHMARK_MODELS['codex-5.5'], BENCHMARK_MODELS['qwen3-72b']],
  },
  'solo-opus': {
    id: 'solo-opus',
    type: 'solo',
    models: [BENCHMARK_MODELS['claude-opus']],
  },
};

/** The recommended judge panel — diverse vendors, no overlap with d-mixed. */
export const PRESET_JUDGES: BenchmarkModel[] = [
  BENCHMARK_MODELS['claude-opus'],
  BENCHMARK_MODELS['gpt-4o'],
  BENCHMARK_MODELS['kimi-k2'],
  BENCHMARK_MODELS['codex-5.5'],
  BENCHMARK_MODELS['qwen3-72b'],
];

// ─── Adapter dispatch ─────────────────────────────────────────────────────────

async function callModel(
  model: BenchmarkModel,
  prompt: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<LLMCompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const req: LLMCompletionRequest = {
    prompt,
    model: model.model,
    signal: controller.signal,
    maxTokens: 2048,
    env,
  };
  try {
    switch (model.adapter) {
      case 'cloudflare':
        return await cloudflareAdapter(req);
      case 'openai':
        return await openaiAdapter(req, resolveOpenAICompat(model, env));
      case 'ollama':
        return await ollamaAdapter(req);
      case 'claude-sdk':
        // Claude SDK path: treat as openai-compat with Anthropic base URL
        return await openaiAdapter(req, {
          apiKey: env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
          baseUrl: 'https://api.anthropic.com/v1',
          missingKeyError: 'ANTHROPIC_API_KEY is not set',
        });
      default:
        return { ok: false, error: `Unknown adapter: ${(model as any).adapter}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function resolveOpenAICompat(
  model: BenchmarkModel,
  env?: NodeJS.ProcessEnv,
): { apiKey?: string; baseUrl?: string; missingKeyError?: string } {
  // Anthropic models routed through openai-compat need ANTHROPIC_API_KEY
  if (model.model.startsWith('claude-')) {
    const key = env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    return {
      apiKey: key,
      baseUrl: 'https://api.anthropic.com/v1',
      missingKeyError: 'ANTHROPIC_API_KEY is not set',
    };
  }
  return {};
}

// ─── Synthesis (MoA pass) ────────────────────────────────────────────────────

async function synthesize(
  task: BenchmarkTask,
  candidates: string[],
  synthesizer: BenchmarkModel,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  if (candidates.length === 1) return candidates[0];
  const numbered = candidates.map((c, i) => `Response ${i + 1}:\n${c}`).join('\n\n---\n\n');
  const prompt = `You are a synthesis engine. Given the following ${candidates.length} candidate responses to the task below, produce a single best answer that incorporates the strongest reasoning from each. Do not add new facts. Return only the synthesized answer.\n\nTask: ${task.prompt}\n\n${numbered}`;
  const result = await callModel(synthesizer, prompt, timeoutMs, env);
  return result.ok && result.text ? result.text : candidates[0];
}

// ─── Judge scoring ────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a strict, impartial evaluator. Score the response to the given task on a scale of 0–10:
- 0–2: wrong or incoherent
- 3–4: partially correct, major gaps
- 5–6: correct but incomplete or unclear
- 7–8: correct and clear
- 9–10: exemplary — correct, concise, no wasted tokens

Reply ONLY with JSON: {"score": <integer 0-10>, "rationale": "<one sentence>"}`;

async function judgeResponse(
  task: BenchmarkTask,
  answer: string,
  judge: BenchmarkModel,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ score: number; rationale: string }> {
  const prompt = `${JUDGE_SYSTEM}\n\nTask: ${task.prompt}\n\nResponse to evaluate:\n${answer}`;
  const result = await callModel(judge, prompt, timeoutMs, env);
  if (!result.ok || !result.text) return { score: 0, rationale: `Judge error: ${result.error}` };
  try {
    const json = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('no JSON');
    const parsed = JSON.parse(json);
    return {
      score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
      rationale: String(parsed.rationale ?? ''),
    };
  } catch {
    return { score: 0, rationale: `Parse error: ${result.text.slice(0, 120)}` };
  }
}

// ─── Error correlation ────────────────────────────────────────────────────────

/**
 * Compute average pairwise Pearson correlation of "is wrong" indicators
 * across candidate outputs.
 *
 * A high correlation (near 1) means models fail together — the ensemble
 * gives no diversity benefit. Low correlation (near 0) means failures are
 * independent — the ensemble can recover.
 *
 * "Wrong" = judge score ≤ 4 when judge scores are available, otherwise
 * undefined (returns null).
 */
function computeErrorCorrelation(results: TaskConditionResult[]): number | null {
  const scored = results.filter((r) => r.judgeScores.length > 0 && r.candidateOutputs.length > 1);
  if (scored.length < 3) return null;

  // Build per-model error vectors: 1 = wrong (score ≤ 4), 0 = correct
  const modelLabels = scored[0].candidateOutputs.map((c) => c.modelLabel);
  const vectors: number[][] = modelLabels.map(() => []);

  for (const r of scored) {
    const avgScore = r.avgJudgeScore ?? 5;
    // Threshold: score ≤ 4 = "wrong"
    for (let i = 0; i < r.candidateOutputs.length; i++) {
      vectors[i].push(avgScore <= 4 ? 1 : 0);
    }
  }

  let totalCorr = 0;
  let pairs = 0;
  for (let a = 0; a < vectors.length; a++) {
    for (let b = a + 1; b < vectors.length; b++) {
      totalCorr += pearson(vectors[a], vectors[b]);
      pairs++;
    }
  }
  return pairs === 0 ? null : totalCorr / pairs;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi; dx2 += xi * xi; dy2 += yi * yi;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];
  constructor(slots: number) { this.slots = slots; }
  async acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return; }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.slots++;
    }
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runBenchmark(
  config: BenchmarkConfig,
  env?: NodeJS.ProcessEnv,
): Promise<BenchmarkReport> {
  const {
    tasks,
    conditions,
    judges,
    judgesPerResponse = Math.min(3, judges.length),
    callTimeoutMs = 60_000,
    concurrency = 6,
    verbose = true,
  } = config;

  const runId = `bm-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const results: TaskConditionResult[] = [];
  const sem = new Semaphore(concurrency);

  const log = verbose ? (msg: string) => process.stdout.write(msg + '\n') : () => {};

  log(`\n  🧪 pd benchmark  run=${runId}  tasks=${tasks.length}  conditions=${conditions.length}`);
  log(`  Judges: ${judges.map((j) => j.label).join(', ')}`);
  log('');

  for (const task of tasks) {
    for (const condition of conditions) {
      const t0 = Date.now();
      log(`  [${task.id}] ${condition.id} (${condition.models.map((m) => m.label).join(' + ')})`);

      // ── 1. Generate candidate outputs ────────────────────────────────────
      const candidateOutputs: TaskConditionResult['candidateOutputs'] = [];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let conditionError: string | undefined;

      const candidateTasks = condition.models.map(async (model) => {
        await sem.acquire();
        try {
          const res = await callModel(model, task.prompt, callTimeoutMs, env);
          if (res.ok && res.text) {
            candidateOutputs.push({
              modelLabel: model.label,
              text: res.text,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
            });
            totalInputTokens += res.inputTokens ?? 0;
            totalOutputTokens += res.outputTokens ?? 0;
          } else {
            candidateOutputs.push({ modelLabel: model.label, text: `[ERROR: ${res.error}]` });
            conditionError = res.error;
          }
        } finally {
          sem.release();
        }
      });

      await Promise.all(candidateTasks);

      const validCandidates = candidateOutputs.filter((c) => !c.text.startsWith('[ERROR'));

      // ── 2. Synthesis (MoA pass) ──────────────────────────────────────────
      let synthesizedAnswer = '';
      if (validCandidates.length > 0) {
        const synthesizer = condition.models[0];
        synthesizedAnswer = await synthesize(
          task,
          validCandidates.map((c) => c.text),
          synthesizer,
          callTimeoutMs,
          env,
        );
      }

      // ── 3. Auto-grade or judge ───────────────────────────────────────────
      let judgeScores: TaskConditionResult['judgeScores'] = [];
      let avgJudgeScore: number | null = null;
      let autoCorrect: boolean | undefined;

      if (task.referenceAnswer) {
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
        autoCorrect = norm(synthesizedAnswer).includes(norm(task.referenceAnswer));
      } else if (synthesizedAnswer) {
        // Pick judgesPerResponse judges at random, excluding models used in this condition
        const conditionLabels = new Set(condition.models.map((m) => m.label));
        const eligibleJudges = judges.filter((j) => !conditionLabels.has(j.label));
        const selected = shuffleSample(eligibleJudges, judgesPerResponse);

        const judgeTasks = selected.map(async (judge) => {
          await sem.acquire();
          try {
            const { score, rationale } = await judgeResponse(task, synthesizedAnswer, judge, callTimeoutMs, env);
            judgeScores.push({ judgeLabel: judge.label, score, rationale });
          } finally {
            sem.release();
          }
        });

        await Promise.all(judgeTasks);

        if (judgeScores.length > 0) {
          avgJudgeScore = judgeScores.reduce((s, j) => s + j.score, 0) / judgeScores.length;
        }
      }

      results.push({
        taskId: task.id,
        conditionId: condition.id,
        candidateOutputs,
        synthesizedAnswer,
        judgeScores,
        avgJudgeScore: avgJudgeScore !== null ? Math.round(avgJudgeScore * 10) / 10 : null,
        autoCorrect,
        totalInputTokens,
        totalOutputTokens,
        elapsedMs: Date.now() - t0,
        error: conditionError,
      });

      const scoreStr = avgJudgeScore !== null
        ? `score=${avgJudgeScore.toFixed(1)}`
        : autoCorrect !== undefined
          ? `correct=${autoCorrect}`
          : 'no score';
      log(`    → ${scoreStr}  tokens=${totalInputTokens + totalOutputTokens}  ${Date.now() - t0}ms`);
    }
  }

  const completedAt = new Date().toISOString();
  const summary = buildSummary(conditions, results);

  return { runId, startedAt, completedAt, config: { conditions, judges, judgesPerResponse, concurrency }, results, summary };
}

function shuffleSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function buildSummary(conditions: BenchmarkCondition[], results: TaskConditionResult[]): ConditionSummary[] {
  return conditions.map((cond) => {
    const mine = results.filter((r) => r.conditionId === cond.id);
    const judged = mine.filter((r) => r.avgJudgeScore !== null);
    const autoGraded = mine.filter((r) => r.autoCorrect !== undefined);

    const avgJudgeScore = judged.length > 0
      ? judged.reduce((s, r) => s + r.avgJudgeScore!, 0) / judged.length
      : null;

    const autoCorrectRate = autoGraded.length > 0
      ? autoGraded.filter((r) => r.autoCorrect).length / autoGraded.length
      : null;

    const avgInputTokens = mine.length > 0
      ? mine.reduce((s, r) => s + r.totalInputTokens, 0) / mine.length : 0;
    const avgOutputTokens = mine.length > 0
      ? mine.reduce((s, r) => s + r.totalOutputTokens, 0) / mine.length : 0;

    // Cost estimate: sum over unique models × their usage
    const estimatedCostUsd = mine.reduce((total, r) => {
      for (const model of cond.models) {
        const inp = (r.totalInputTokens / cond.models.length) * (model.inputCostPer1M ?? 0) / 1_000_000;
        const out = (r.totalOutputTokens / cond.models.length) * (model.outputCostPer1M ?? 0) / 1_000_000;
        total += inp + out;
      }
      return total;
    }, 0);

    const categories = [...new Set(results.map((r) => r.taskId))];
    const byCategory: ConditionSummary['byCategory'] = {};
    // (category lookup requires task metadata — CLI passes tasks for this)
    // Populated by CLI layer which has the full task list.

    return {
      conditionId: cond.id,
      conditionType: cond.type,
      modelLabels: [...new Set(cond.models.map((m) => m.label))],
      taskCount: mine.length,
      avgJudgeScore: avgJudgeScore !== null ? Math.round(avgJudgeScore * 10) / 10 : null,
      autoCorrectRate: autoCorrectRate !== null ? Math.round(autoCorrectRate * 1000) / 1000 : null,
      avgInputTokens: Math.round(avgInputTokens),
      avgOutputTokens: Math.round(avgOutputTokens),
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      avgErrorCorrelation: computeErrorCorrelation(mine),
      byCategory,
    };
  });
}
