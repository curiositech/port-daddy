/**
 * pd benchmark — diversity dividend experiment runner.
 *
 * Usage:
 *   pd benchmark run [--conditions c1,c2,...] [--judges j1,j2,...] [--tasks ./tasks.jsonl] [--n 20] [--out ./results/]
 *   pd benchmark list-models
 *   pd benchmark list-conditions
 *   pd benchmark report ./results/bm-xyz.json
 *
 * Quick start (built-in 10-task sampler, all presets):
 *   pd benchmark run
 *
 * Full experiment (~$50-100):
 *   pd benchmark run --conditions h-claude,h-openai,h-kimi,h-qwen,h-codex,d-mixed,d-wide,solo-opus \
 *                    --judges opus,gpt-4o,kimi-k2,codex-5.5,qwen3-72b \
 *                    --n 100
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANSI } from '../../lib/maritime.js';
import { printCompactHeader, ANCHOR } from '../../lib/banner.js';
import {
  runBenchmark,
  BENCHMARK_MODELS,
  PRESET_CONDITIONS,
  PRESET_JUDGES,
  type BenchmarkTask,
  type BenchmarkCondition,
  type BenchmarkModel,
  type BenchmarkReport,
  type ConditionSummary,
} from '../../lib/benchmark.js';

// ─── Built-in sampler tasks ───────────────────────────────────────────────────

const SAMPLER_TASKS: BenchmarkTask[] = [
  // Code
  {
    id: 'code-01',
    category: 'code',
    prompt: 'Write a TypeScript function `groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]>` with correct types. Return only the function, no preamble.',
  },
  {
    id: 'code-02',
    category: 'code',
    prompt: 'Find the bug in this Python function and return a corrected version:\n\ndef first_duplicate(arr):\n    seen = set()\n    for x in arr:\n        if x in seen: return x\n        seen.add(x)\n    return -1\n\nTest case that fails: first_duplicate([3, 1, 3, 4, 2]) should return 3.',
  },
  {
    id: 'code-03',
    category: 'code',
    prompt: 'Write a SQL query that returns the top 3 customers by total order value from tables `orders(id, customer_id, amount)` and `customers(id, name)`. Include ties.',
  },
  // Math
  {
    id: 'math-01',
    category: 'math',
    prompt: 'A snail climbs 3 feet up a 30-foot pole each day and slides 2 feet back each night. On which day does it reach the top? Show your reasoning.',
    referenceAnswer: '28',
  },
  {
    id: 'math-02',
    category: 'math',
    prompt: 'What is the probability that a randomly chosen integer from 1 to 100 is divisible by 3 or 7? Give your answer as a reduced fraction.',
    referenceAnswer: '37/100',
  },
  // Reasoning
  {
    id: 'reason-01',
    category: 'reasoning',
    prompt: 'Alice is taller than Bob. Bob is taller than Carol. David is shorter than Carol. Is David shorter than Alice? Explain in one sentence.',
    referenceAnswer: 'yes',
  },
  {
    id: 'reason-02',
    category: 'reasoning',
    prompt: 'A bat and a ball together cost $1.10. The bat costs $1.00 more than the ball. How much does the ball cost? Show your work.',
    referenceAnswer: '0.05',
  },
  // Review
  {
    id: 'review-01',
    category: 'review',
    prompt: 'Review this code for bugs and security issues. Be specific and concise:\n\nasync function getUser(req, res) {\n  const id = req.query.id;\n  const user = await db.query(`SELECT * FROM users WHERE id = ${id}`);\n  if (!user) return res.status(404).json({ error: "not found" });\n  res.json(user);\n}',
  },
  {
    id: 'review-02',
    category: 'review',
    prompt: 'What is wrong with this retry logic? Fix it:\n\nasync function fetchWithRetry(url, retries = 3) {\n  for (let i = 0; i < retries; i++) {\n    const res = await fetch(url);\n    if (res.ok) return res.json();\n    await new Promise(r => setTimeout(r, 1000));\n  }\n  throw new Error("failed");\n}',
  },
  {
    id: 'review-03',
    category: 'review',
    prompt: 'Identify the O(n) vs O(n²) opportunity in this JavaScript and suggest a fix:\n\nfunction findCommonElements(arr1, arr2) {\n  return arr1.filter(x => arr2.includes(x));\n}',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseModelIds(ids: string): BenchmarkModel[] {
  return ids.split(',').map((id) => {
    const m = BENCHMARK_MODELS[id.trim()];
    if (!m) throw new Error(`Unknown model id "${id.trim()}". Run \`pd benchmark list-models\` to see options.`);
    return m;
  });
}

function parseConditionIds(ids: string): BenchmarkCondition[] {
  return ids.split(',').map((id) => {
    const c = PRESET_CONDITIONS[id.trim()];
    if (!c) throw new Error(`Unknown condition "${id.trim()}". Run \`pd benchmark list-conditions\` to see options.`);
    return c;
  });
}

function loadTasksFile(path: string): BenchmarkTask[] {
  const raw = readFileSync(path, 'utf-8').trim().split('\n');
  return raw.map((line, i) => {
    try {
      return JSON.parse(line) as BenchmarkTask;
    } catch {
      throw new Error(`tasks file line ${i + 1}: invalid JSON`);
    }
  });
}

function bar(value: number, max: number, width = 20): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printReport(report: BenchmarkReport): void {
  const { summary, results } = report;
  const maxScore = 10;

  console.log(`\n${ANSI.fgCyan}━━━ pd benchmark  run=${report.runId} ━━━${ANSI.reset}\n`);
  console.log(`  Tasks: ${results.length / summary.length}   Conditions: ${summary.length}   Judges: ${report.config.judges.map((j) => j.label).join(', ')}\n`);

  // Score table
  const judged = summary.filter((s) => s.avgJudgeScore !== null);
  const autoGraded = summary.filter((s) => s.autoCorrectRate !== null);

  if (judged.length > 0) {
    console.log(`  ${ANSI.fgCyan}Judge Scores (avg 0–10)${ANSI.reset}`);
    const sorted = [...judged].sort((a, b) => (b.avgJudgeScore ?? 0) - (a.avgJudgeScore ?? 0));
    for (const s of sorted) {
      const score = s.avgJudgeScore!;
      const typeIcon = s.conditionType === 'heterogeneous' ? '◆' : s.conditionType === 'solo' ? '★' : '○';
      const corr = s.avgErrorCorrelation !== null ? `  corr=${s.avgErrorCorrelation.toFixed(2)}` : '';
      const cost = s.estimatedCostUsd > 0 ? `  ~$${s.estimatedCostUsd.toFixed(4)}` : '';
      console.log(`  ${typeIcon} ${s.conditionId.padEnd(12)} ${bar(score, maxScore)} ${score.toFixed(1)}${corr}${cost}`);
    }
    console.log('');
  }

  if (autoGraded.length > 0) {
    console.log(`  ${ANSI.fgCyan}Auto-grade Correct Rate${ANSI.reset}`);
    const sorted = [...autoGraded].sort((a, b) => (b.autoCorrectRate ?? 0) - (a.autoCorrectRate ?? 0));
    for (const s of sorted) {
      const rate = s.autoCorrectRate!;
      const typeIcon = s.conditionType === 'heterogeneous' ? '◆' : s.conditionType === 'solo' ? '★' : '○';
      console.log(`  ${typeIcon} ${s.conditionId.padEnd(12)} ${bar(rate, 1)} ${(rate * 100).toFixed(1)}%`);
    }
    console.log('');
  }

  // Diversity insight
  const hetero = summary.filter((s) => s.conditionType === 'heterogeneous');
  const homo = summary.filter((s) => s.conditionType === 'homogeneous');
  if (hetero.length > 0 && homo.length > 0) {
    const heteroAvg = hetero.reduce((s, c) => s + (c.avgJudgeScore ?? c.autoCorrectRate ?? 0), 0) / hetero.length;
    const homoAvg = homo.reduce((s, c) => s + (c.avgJudgeScore ?? c.autoCorrectRate ?? 0), 0) / homo.length;
    const delta = heteroAvg - homoAvg;
    const symbol = delta > 0 ? `${ANSI.fgGreen}+${delta.toFixed(2)} heterogeneous advantage${ANSI.reset}` : `${ANSI.fgRed}${delta.toFixed(2)} no diversity dividend detected${ANSI.reset}`;
    console.log(`  Diversity delta: ${symbol}\n`);

    // Error correlation insight
    const corrData = homo.filter((s) => s.avgErrorCorrelation !== null);
    const hetCorrData = hetero.filter((s) => s.avgErrorCorrelation !== null);
    if (corrData.length > 0 && hetCorrData.length > 0) {
      const homoCorr = corrData.reduce((s, c) => s + c.avgErrorCorrelation!, 0) / corrData.length;
      const hetCorr = hetCorrData.reduce((s, c) => s + c.avgErrorCorrelation!, 0) / hetCorrData.length;
      console.log(`  Error correlation — homogeneous: ${homoCorr.toFixed(2)}  heterogeneous: ${hetCorr.toFixed(2)}`);
      console.log(`  (Lower = more independent failures = more ensemble value)\n`);
    }
  }

  // Token + cost summary
  const totalCost = summary.reduce((s, c) => s + c.estimatedCostUsd, 0);
  console.log(`  Total estimated cost: $${totalCost.toFixed(4)}`);
  console.log(`  Run time: ${report.startedAt} → ${report.completedAt}\n`);
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

function handleListModels(): void {
  printCompactHeader('BENCHMARK MODELS');
  console.log('');
  for (const [id, m] of Object.entries(BENCHMARK_MODELS)) {
    const cost = m.inputCostPer1M !== undefined
      ? `  $${m.inputCostPer1M}/1M in  $${m.outputCostPer1M}/1M out`
      : '  (local / free)';
    console.log(`  ${ANSI.fgCyan}${id.padEnd(16)}${ANSI.reset} ${m.label.padEnd(24)} ${m.adapter.padEnd(12)}${cost}`);
  }
  console.log('');
}

function handleListConditions(): void {
  printCompactHeader('BENCHMARK CONDITIONS');
  console.log('');
  for (const [id, c] of Object.entries(PRESET_CONDITIONS)) {
    const typeIcon = c.type === 'heterogeneous' ? '◆' : c.type === 'solo' ? '★' : '○';
    const models = [...new Set(c.models.map((m) => m.label))].join(' + ');
    console.log(`  ${typeIcon} ${ANSI.fgCyan}${id.padEnd(12)}${ANSI.reset} (${c.type})  ${models}`);
  }
  console.log('');
  console.log('  ◆ heterogeneous  ○ homogeneous  ★ solo baseline\n');
}

async function handleRun(args: string[]): Promise<void> {
  // Parse flags
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }

  const conditionIds = opts['conditions'];
  const judgeIds = opts['judges'];
  const tasksFile = opts['tasks'];
  const nStr = opts['n'];
  const outDir = opts['out'] ?? './benchmark-results';
  const concurrency = parseInt(opts['concurrency'] ?? '6', 10);

  // Build config
  const conditions = conditionIds
    ? parseConditionIds(conditionIds)
    : [
        PRESET_CONDITIONS['h-claude'],
        PRESET_CONDITIONS['h-openai'],
        PRESET_CONDITIONS['h-kimi'],
        PRESET_CONDITIONS['d-mixed'],
        PRESET_CONDITIONS['solo-opus'],
      ];

  const judges = judgeIds ? parseModelIds(judgeIds) : PRESET_JUDGES;

  let tasks: BenchmarkTask[] = tasksFile ? loadTasksFile(tasksFile) : SAMPLER_TASKS;

  if (nStr) {
    const n = parseInt(nStr, 10);
    if (!isNaN(n) && n < tasks.length) tasks = tasks.slice(0, n);
  }

  printCompactHeader('pd benchmark run');
  console.log(`\n  ${ANCHOR} Conditions: ${conditions.map((c) => c.id).join(', ')}`);
  console.log(`  Judges:     ${judges.map((j) => j.label).join(', ')}`);
  console.log(`  Tasks:      ${tasks.length}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log('');

  const report = await runBenchmark({ tasks, conditions, judges, concurrency }, process.env as NodeJS.ProcessEnv);

  // Save results
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${report.runId}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  Results saved → ${outPath}\n`);

  printReport(report);
}

function handleReport(args: string[]): void {
  const path = args[0];
  if (!path) {
    console.error('  Usage: pd benchmark report <path-to-results.json>');
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(`  File not found: ${path}`);
    process.exit(1);
  }
  const report: BenchmarkReport = JSON.parse(readFileSync(path, 'utf-8'));
  printReport(report);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleBenchmark(args: string[]): Promise<void> {
  const sub = args[0] ?? 'run';
  const rest = args.slice(1);

  switch (sub) {
    case 'run':
      await handleRun(rest);
      break;
    case 'list-models':
    case 'models':
      handleListModels();
      break;
    case 'list-conditions':
    case 'conditions':
      handleListConditions();
      break;
    case 'report':
      handleReport(rest);
      break;
    default:
      console.log(`  Usage: pd benchmark <run|list-models|list-conditions|report>`);
      console.log('');
      console.log('  Examples:');
      console.log('    pd benchmark run                          # quick 10-task sampler');
      console.log('    pd benchmark run --n 100 --out ./results  # full experiment');
      console.log('    pd benchmark list-models                  # see all model IDs');
      console.log('    pd benchmark list-conditions              # see all condition presets');
      console.log('    pd benchmark report ./results/bm-xyz.json # re-render a saved run');
  }
}
