/**
 * Cost Tracker — per-spawn LLM cost recording.
 *
 * Records a cost event for every spawn. When token counts are available
 * (claude SDK backend), computes exact cost. Legacy or non-enforced paths can
 * still emit estimates for opaque backends, but live operator-facing launches
 * are expected to be blocked upstream unless exact telemetry is available.
 *
 * Usage:
 *   costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'myapp' })
 *   costTracker.total({ since: Date.now() - 86_400_000 })
 *   costTracker.summary()                           // by project, last 24h
 *   costTracker.budgetStatus('myapp', 5.00)         // $5/day budget check
 *
 * Rate table: update when Anthropic/Google change pricing.
 * Rates are in USD per 1M tokens.
 */

import type { Database } from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { isSubscriptionBackend } from './backend-catalog.js';
import { appendEvent } from './agent-harbor/event-ledger.js';
import type { CostAccrualEvent } from './agent-harbor/types.js';

// ─── Model Rate Table (USD per 1M tokens) ─────────────────────────────────────

interface ModelRate {
  input: number;   // USD per 1M input tokens
  cachedInput?: number; // USD per 1M cached input tokens
  output: number;  // USD per 1M output tokens
  label: string;
}

const FALLBACK_MODEL_RATES: Record<string, ModelRate> = {
  claude: { input: 3.00, output: 15.00, label: 'Claude fallback (Sonnet-class estimate)' },
  gemini: { input: 1.25, output: 5.00, label: 'Gemini fallback (Pro-class estimate)' },
};

// Keys are substrings — matched with .includes() against the model name.
// List more-specific keys before less-specific ones.
const MODEL_RATES: Array<[string, ModelRate]> = [
  // Cloudflare Workers AI
  ['@cf/moonshotai/kimi-k2.7-code',             { input: 0.950, output: 4.000, label: 'Cloudflare Workers AI Kimi K2.7 Code (verified live pricing page 2026-08-22; code-reviewer pin)' }],
  ['@cf/moonshotai/kimi-k2-instruct',           { input: 0.950, cachedInput: 0.160, output: 4.000, label: 'Cloudflare Workers AI Kimi K2 Instruct' }],
  ['@cf/moonshotai/kimi-k2.6',                  { input: 0.950, cachedInput: 0.160, output: 4.000, label: 'Kimi K2.6 (phantom Workers AI id — never existed, retired 2026-07 #654; row kept so historical cost events still price)' }],
  ['@cf/moonshotai/kimi-k2.5',                  { input: 0.600, cachedInput: 0.100, output: 3.000, label: 'Kimi K2.5 (phantom Workers AI id — never existed, retired 2026-07 #654; row kept so historical cost events still price)' }],
  ['@cf/zai-org/glm-4.7-flash',                 { input: 0.060, output: 0.400, label: 'Cloudflare Workers AI GLM-4.7-Flash' }],
  ['@cf/zai-org/glm-5.2',                       { input: 1.400, output: 4.400, label: 'Cloudflare Workers AI GLM-5.2 (verified live pricing page 2026-08-22; code-reviewer reduce)' }],
  ['@cf/deepseek-ai/deepseek-v4-flash-0731',    { input: 0.440, output: 1.320, label: 'Cloudflare Workers AI DeepSeek V4-Flash-0731 (verified 2026-08-22; purser author tier)' }],
  ['@cf/deepseek-ai/deepseek-v4-pro-0813',      { input: 1.320, output: 3.960, label: 'Cloudflare Workers AI DeepSeek V4-Pro-0813 (verified 2026-08-22; red-team)' }],
  ['@cf/google/gemma-4-26b-a4b-it',             { input: 0.100, output: 0.300, label: 'Cloudflare Workers AI Gemma 4 26B A4B (verified 2026-08-22)' }],
  // Full-universe admission rows (verified against the live pricing page
  // 2026-08-22, PR #9249) — mirrors of apps/fleet-executor/src/spend.ts.
  ['@cf/meta/llama-3.1-8b-instruct-fp8',        { input: 0.152, output: 0.287, label: 'Cloudflare Workers AI Llama 3.1 8B FP8' }],
  ['@cf/meta/llama-3.2-1b-instruct',            { input: 0.027, output: 0.201, label: 'Cloudflare Workers AI Llama 3.2 1B' }],
  ['@cf/meta/llama-3.2-3b-instruct',            { input: 0.051, output: 0.335, label: 'Cloudflare Workers AI Llama 3.2 3B' }],
  ['@cf/meta/llama-3.2-11b-vision-instruct',    { input: 0.049, output: 0.676, label: 'Cloudflare Workers AI Llama 3.2 11B Vision' }],
  ['@cf/qwen/qwq-32b',                          { input: 0.660, output: 1.000, label: 'Cloudflare Workers AI QwQ 32B' }],
  ['@cf/qwen/qwen3.8-27b',                      { input: 0.450, output: 3.200, label: 'Cloudflare Workers AI Qwen 3.8 27B' }],
  ['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', { input: 0.497, output: 4.881, label: 'Cloudflare Workers AI DeepSeek R1 Distill Qwen 32B (XO default)' }],
  ['@cf/ibm-granite/granite-4.0-h-micro',       { input: 0.017, output: 0.112, label: 'Cloudflare Workers AI Granite 4.0 H Micro' }],
  ['@cf/aisingapore/gemma-sea-lion-v4-27b-it',  { input: 0.351, output: 0.555, label: 'Cloudflare Workers AI Gemma SEA-LION v4 27B' }],
  ['@cf/mistralai/mistral-small-3.1-24b-instruct', { input: 0.351, output: 0.555, label: 'Cloudflare Workers AI Mistral Small 3.1 24B' }],
  // qwen2.5-coder-32b: the 2026-07-07 blackout hotfix pinned every ship to this,
  // the PRICIEST qwen ($0.66/$1.00 — src pricing page). No longer a default (ships
  // fell back to qwen3-30b, ~13x cheaper input), but still pinnable, so a
  // historical/pinned cost event must price. See wrangler KNOWN_GOOD_CF_MODELS.
  ['@cf/qwen/qwen2.5-coder-32b-instruct',       { input: 0.660, output: 1.000, label: 'Cloudflare Workers AI Qwen2.5 Coder 32B Instruct' }],
  ['@cf/qwen/qwen3-30b-a3b-fp8',                { input: 0.051, output: 0.335, label: 'Cloudflare Workers AI Qwen3 30B A3B FP8' }],
  ['@cf/nvidia/nemotron-3-120b-a12b',           { input: 0.500, output: 1.500, label: 'Cloudflare Workers AI Nemotron 3 120B A12B' }],
  ['@cf/meta/llama-4-scout-17b-16e-instruct',   { input: 0.270, output: 0.850, label: 'Cloudflare Workers AI Llama 4 Scout 17B 16E Instruct' }],
  ['@cf/openai/gpt-oss-120b',                   { input: 0.350, output: 0.750, label: 'Cloudflare Workers AI GPT-OSS 120B' }],
  // gpt-oss-20b: the cheaper review-bot candidate ($0.20/$0.30 — src pricing page).
  // Priced ahead of any switch so cost tracking lights up immediately if adopted.
  ['@cf/openai/gpt-oss-20b',                    { input: 0.200, output: 0.300, label: 'Cloudflare Workers AI GPT-OSS 20B' }],
  // Legacy exact rates retained for explicit older configs, not recommended tiers.
  ['@cf/meta/llama-3.1-8b-instruct',          { input: 0.282, output: 0.827, label: 'Cloudflare Workers AI Llama 3.1 8B Instruct' }],
  ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', { input: 0.293, output: 2.253, label: 'Cloudflare Workers AI Llama 3.3 70B FP8 Fast' }],
  ['@cf/meta/llama-3.1-70b-instruct-fp8-fast', { input: 0.293, output: 2.253, label: 'Cloudflare Workers AI Llama 3.1 70B FP8 Fast' }],
  // OpenAI — GPT-5.4 / Codex (legacy project-specific names; keep first)
  ['gpt-5.4-mini',          { input:  0.75, cachedInput: 0.075, output:  4.50, label: 'GPT-5.4 mini' }],
  ['gpt-5.4',               { input:  2.50, cachedInput: 0.25,  output: 15.00, label: 'GPT-5.4' }],
  ['gpt-5.3-codex',         { input:  1.75, cachedInput: 0.175, output: 14.00, label: 'GPT-5.3 Codex' }],
  // OpenAI — GPT-5 family (used by the OpenAI backend in lib/spawner/backends/openai.ts).
  // Substring matching means more-specific keys must come first: `-nano` and
  // `-mini` win over bare `gpt-5`. Same convention as the Claude rates above.
  // Rates as of 2026-05; update when OpenAI publishes new pricing.
  ['gpt-5-nano',            { input:  0.05, cachedInput: 0.005, output:  0.40, label: 'GPT-5 nano' }],
  ['gpt-5-mini',            { input:  0.25, cachedInput: 0.025, output:  2.00, label: 'GPT-5 mini' }],
  ['gpt-5',                 { input:  1.25, cachedInput: 0.125, output: 10.00, label: 'GPT-5' }],
  // OpenAI — GPT-4.1 family
  ['gpt-4.1-nano',          { input:  0.10, cachedInput: 0.025, output:  0.40, label: 'GPT-4.1 nano' }],
  ['gpt-4.1-mini',          { input:  0.40, cachedInput: 0.10,  output:  1.60, label: 'GPT-4.1 mini' }],
  ['gpt-4.1',               { input:  2.00, cachedInput: 0.50,  output:  8.00, label: 'GPT-4.1' }],
  // OpenAI — GPT-4o family
  ['gpt-4o-mini',           { input:  0.15, cachedInput: 0.075, output:  0.60, label: 'GPT-4o mini' }],
  ['gpt-4o',                { input:  2.50, cachedInput: 1.25,  output: 10.00, label: 'GPT-4o' }],
  // OpenAI — o-series reasoning
  ['o4-mini',               { input:  1.10, cachedInput: 0.275, output:  4.40, label: 'OpenAI o4-mini' }],
  ['o3',                    { input:  2.00, cachedInput: 0.50,  output:  8.00, label: 'OpenAI o3' }],
  ['o1',                    { input: 15.00, cachedInput: 7.50,  output: 60.00, label: 'OpenAI o1' }],
  // Anthropic — Opus
  ['claude-opus-4',           { input: 15.00, output: 75.00, label: 'Claude Opus 4' }],
  // Anthropic — Sonnet
  ['claude-sonnet-4-6',       { input:  3.00, output: 15.00, label: 'Claude Sonnet 4.6' }],
  ['claude-sonnet-4-5',       { input:  3.00, output: 15.00, label: 'Claude Sonnet 4.5' }],
  ['claude-3-5-sonnet',       { input:  3.00, output: 15.00, label: 'Claude 3.5 Sonnet' }],
  // Anthropic — Haiku
  ['claude-haiku-4-5',        { input:  0.80, output:  4.00, label: 'Claude Haiku 4.5' }],
  ['claude-3-5-haiku',        { input:  0.80, output:  4.00, label: 'Claude 3.5 Haiku' }],
  ['claude-haiku',            { input:  0.80, output:  4.00, label: 'Claude Haiku' }],
  // Anthropic — claude-cli tier shorthands.
  // The claude-cli backend's tier resolver (lib/fleet-engine.ts BUILTIN_MODEL_TIERS)
  // returns bare names "opus" / "sonnet" / "haiku" for `--tier high|mid|low`.
  // findRate() does substring matching, so the longer keys above never match
  // a 4-6-character shortname. These rows are placed at the END so full IDs
  // hit their specific entries first; the shortnames are matched as a fallback
  // when the backend hands back only the tier alias.
  ['opus',                    { input: 15.00, output: 75.00, label: 'Claude Opus (claude-cli tier shorthand)' }],
  ['sonnet',                  { input:  3.00, output: 15.00, label: 'Claude Sonnet (claude-cli tier shorthand)' }],
  ['haiku',                   { input:  0.80, output:  4.00, label: 'Claude Haiku (claude-cli tier shorthand)' }],
  // Groq (OpenAI-compatible; open-weight models on LPU hardware).
  // Rates as of 2026-06 — https://groq.com/pricing. More-specific IDs first.
  ['llama-3.3-70b-versatile',   { input: 0.59, output: 0.79, label: 'Groq Llama 3.3 70B Versatile' }],
  ['llama-3.1-8b-instant',      { input: 0.05, output: 0.08, label: 'Groq Llama 3.1 8B Instant' }],
  ['openai/gpt-oss-120b',       { input: 0.15, cachedInput: 0.075, output: 0.60, label: 'Groq GPT-OSS 120B' }],
  ['openai/gpt-oss-20b',        { input: 0.10, cachedInput: 0.05,  output: 0.50, label: 'Groq GPT-OSS 20B' }],
  ['moonshotai/kimi-k2',        { input: 1.00, output: 3.00, label: 'Groq Kimi K2' }],
  // DeepSeek (OpenAI-compatible; V3 + R1). Model ids are unique to DeepSeek so
  // they live safely in the shared table (no bare-word false-match risk).
  // Rates as of 2026-06 — https://api-docs.deepseek.com/quick_start/pricing.
  // More-specific id first so 'deepseek-reasoner' wins over 'deepseek-chat'.
  ['deepseek-reasoner',         { input: 0.55, output: 2.19, label: 'DeepSeek R1 (deepseek-reasoner)' }],
  ['deepseek-chat',             { input: 0.27, output: 1.10, label: 'DeepSeek V3 (deepseek-chat)' }],
  // xAI (Grok; OpenAI-compatible). Model ids are unique to xAI so they live
  // safely in the shared table. Rates as of 2026-06 — https://docs.x.ai/docs/models.
  // More-specific ids first ('grok-code-fast-1' before 'grok-3'/'grok-2').
  ['grok-code-fast-1',          { input: 0.20, output: 1.50, label: 'xAI Grok Code Fast 1' }],
  ['grok-3',                    { input: 3.00, output: 15.00, label: 'xAI Grok 3' }],
  ['grok-2',                    { input: 2.00, output: 10.00, label: 'xAI Grok 2' }],
  // Gemini — 2.5 family (current). Thinking-model output tokens (incl.
  // thoughtsTokenCount) are billed at the output rate; geminiAdapter folds
  // them into outputTokens. More-specific keys before less-specific.
  ['gemini-2.5-flash-lite',   { input:  0.10, output: 0.40, label: 'Gemini 2.5 Flash-Lite' }],
  ['gemini-2.5-flash',        { input:  0.30, output: 2.50, label: 'Gemini 2.5 Flash' }],
  ['gemini-2.5-pro',          { input:  1.25, output: 10.00, label: 'Gemini 2.5 Pro (≤200K context)' }],
  // Gemini — legacy (1.5 family retained for explicit older configs).
  ['gemini-1.5-pro',          { input:  1.25, output:  5.00, label: 'Gemini 1.5 Pro' }],
  ['gemini-1.5-flash',        { input:  0.075, output: 0.30, label: 'Gemini 1.5 Flash' }],
];

// ─── Ollama-only model rates ──────────────────────────────────────────────────
//
// Held in a SEPARATE table from the cross-backend MODEL_RATES so bare-word
// family keys like `qwen` / `llama` / `mistral` cannot false-match a future
// non-ollama paid model whose name happens to contain those substrings
// (e.g. `claude-llama-experimental`). findRate() consults this table only
// when the backend argument is 'ollama'.
//
// Rates are an electricity / amortized-hardware proxy for M4 Max-class
// hardware:
//   ~50W draw * (1 / 100 tok/s) = 0.5 J/tok = 1.39e-4 Wh/tok
//   * $0.30/kWh = 4.2e-8 USD/tok = 0.042 USD/M tokens
// Rounded up to 0.05 USD/M for input and output. Token counts are exact
// (Ollama returns prompt_eval_count + eval_count on /api/chat — see
// lib/llm-call.ts ollamaAdapter:148-149). The fail-closed telemetry policy
// (lib/backend-telemetry-policy.ts) checks hasExactModelRate(model, 'ollama')
// against these entries; the spawner (lib/spawner.ts:1005-1052) then
// enforces the full pipeline (token-count present, computed cost not
// estimate, costUsd > 0).
const OLLAMA_MODEL_RATES: Array<[string, ModelRate]> = [
  ['qwen',        { input:  0.05, output:  0.05, label: 'Ollama local Qwen family (electricity proxy)' }],
  ['llama',       { input:  0.05, output:  0.05, label: 'Ollama local Llama / dolphin-llama family (electricity proxy)' }],
  ['mistral',     { input:  0.05, output:  0.05, label: 'Ollama local Mistral / dolphin-mistral family (electricity proxy)' }],
  ['hermes',      { input:  0.05, output:  0.05, label: 'Ollama local Hermes family (electricity proxy)' }],
  ['dolphin',     { input:  0.05, output:  0.05, label: 'Ollama local Dolphin family (electricity proxy)' }],
  ['phi',         { input:  0.05, output:  0.05, label: 'Ollama local Phi family (electricity proxy)' }],
  ['gemma',       { input:  0.05, output:  0.05, label: 'Ollama local Gemma family (electricity proxy)' }],
  ['codellama',   { input:  0.05, output:  0.05, label: 'Ollama local CodeLlama family (electricity proxy)' }],
  ['nomic-embed', { input:  0.01, output:  0.01, label: 'Ollama local nomic-embed (smaller embedding model)' }],
];

// ─── LM Studio-only model rates ───────────────────────────────────────────────
//
// LM Studio runs an OpenAI-compatible local server and returns exact
// `usage.{prompt_tokens,completion_tokens}` on every completion, so the exact
// telemetry path applies (just like Ollama). It serves whatever model is loaded
// in the app, so the reported model id is operator-chosen and unbounded — we
// cannot enumerate it. We therefore use a single catch-all electricity-proxy
// rate (same $0.05/M floor as the Ollama family) consulted ONLY when the
// backend argument is 'lmstudio', so it can never false-match a paid remote
// model. The catch-all '' key matches every model id via substring (`includes`).
// Held in its own table to keep the bare-word match scoped to this backend.
const LMSTUDIO_MODEL_RATES: Array<[string, ModelRate]> = [
  ['', { input: 0.05, output: 0.05, label: 'LM Studio local model (electricity proxy)' }],
];

/**
 * Flat per-session cost estimates for backends that don't expose token counts.
 * These are conservative estimates meant to flag usage, not for billing.
 * Update based on observed actual spend.
 */
const SESSION_ESTIMATES_USD: Record<string, number> = {
  'claude':     0.08,  // conservative floor for SDK calls when telemetry is partial/missing
  'claude-cli': 0.05,  // ~50k tokens/session at Sonnet pricing
  'gemini':     0.03,  // conservative floor for remote Gemini requests
  'aider':      0.10,  // aider makes multiple calls; typically 2-4 cycles
  'cloudflare': 0.05,  // remote inference via Cloudflare AI
  'openai':     0.05,  // remote inference via OpenAI API (overridden by exact token rates)
  'groq':       0.02,  // remote inference via Groq LPU (overridden by exact token rates)
  'deepseek':   0.02,  // remote inference via DeepSeek API (overridden by exact token rates)
  'xai':        0.05,  // remote inference via xAI Grok API (overridden by exact token rates)
  // CLI-tube backends route through operator's flat-rate subscription
  // (Claude Max / ChatGPT Pro). Marginal cost to PD's wallet is zero,
  // but we record a tiny nonzero session estimate so cost dashboards
  // count usage and a daily project budget can still rate-limit.
  'cli:claude-code': 0.001,
  'cli:codex':       0.001,
  'cli:agy':         0.001,
  'cli:gemini':      0.001,
  'cli:groq':        0.001,
  'cli:grok':        0.001,
  'custom':     0.00,  // unknown — assume free
  'ollama':     0.00,  // local — free
  'lmstudio':   0.00,  // local LM Studio server — free (runs on operator hardware)
};

function estimateOpaqueSessionCost(backend: string, model: string): number {
  const normalizedModel = model.toLowerCase();
  if (backend === 'codex') {
    if (normalizedModel.includes('gpt-5.4-mini')) return 0.08;
    if (normalizedModel.includes('gpt-5.3-codex')) return 0.12;
    return 0.20;
  }
  if (backend === 'aider') {
    if (normalizedModel.includes('mini')) return 0.06;
    if (normalizedModel.includes('gpt-4.1')) return 0.10;
    if (normalizedModel.includes('gpt-5')) return 0.18;
    return 0.10;
  }
  return SESSION_ESTIMATES_USD[backend] ?? 0;
}

function hasKnownPaidRemoteBackend(backend: string): boolean {
  return ['claude', 'claude-cli', 'gemini', 'codex', 'aider', 'cloudflare', 'openai', 'groq', 'deepseek', 'xai', 'cli:claude-code', 'cli:codex', 'cli:agy', 'cli:gemini', 'cli:groq', 'cli:grok'].includes(backend);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostRecordOpts {
  backend: string;
  model: string;
  projectName?: string;
  projectDir?: string;
  identity?: string;
  spawnId?: string;
  /** Input token count — when provided with outputTokens, computes exact cost */
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface CostEvent {
  id: string;
  ts: number;
  backend: string;
  model: string;
  projectName: string | null;
  projectDir: string | null;
  identity: string | null;
  spawnId: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  isEstimate: boolean;
}

export interface CostSummaryRow {
  projectName: string | null;
  projectDir: string | null;
  totalUsd: number;
  spawnCount: number;
  estimatedCount: number;
  topModel: string | null;
}

export interface CostTotals {
  totalUsd: number;
  spawnCount: number;
  estimatedCount: number;
}

export interface BudgetStatus {
  project: string;
  budgetUsdPerDay: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  overBudget: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function findRate(model: string, backend?: string): ModelRate | null {
  const lc = model.toLowerCase();
  // Ollama family rates are checked ONLY for the ollama backend so bare-word
  // keys like 'qwen' / 'llama' / 'mistral' can never false-match a paid
  // remote model that happens to contain those substrings.
  if (backend === 'ollama') {
    for (const [key, rate] of OLLAMA_MODEL_RATES) {
      if (lc.includes(key)) return rate;
    }
    return null;
  }
  // LM Studio serves an operator-chosen loaded model whose id we cannot
  // enumerate; the '' catch-all matches any id but ONLY for the lmstudio
  // backend, so it can never false-match a paid remote model elsewhere.
  if (backend === 'lmstudio') {
    for (const [key, rate] of LMSTUDIO_MODEL_RATES) {
      if (lc.includes(key)) return rate;
    }
    return null;
  }
  for (const [key, rate] of MODEL_RATES) {
    if (lc.includes(key)) return rate;
  }
  return null;
}

export function hasExactModelRate(model: string, backend?: string): boolean {
  return findRate(model, backend) !== null;
}

function findFallbackRate(backend: string, model: string): ModelRate | null {
  const candidates = [model.toLowerCase(), backend.toLowerCase()];
  for (const candidate of candidates) {
    if (candidate.includes('claude')) return FALLBACK_MODEL_RATES.claude;
    if (candidate.includes('gemini')) return FALLBACK_MODEL_RATES.gemini;
  }
  return null;
}

function normalizeTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function computeCost(
  backend: string,
  model: string,
  inputTokens?: number,
  outputTokens?: number,
  cachedInputTokens?: number,
): { costUsd: number; isEstimate: boolean } {
  const normalizedInput = normalizeTokenCount(inputTokens);
  const normalizedOutput = normalizeTokenCount(outputTokens);
  const normalizedCachedInput = normalizeTokenCount(cachedInputTokens);
  // Pass backend through so ollama-family substring keys (qwen / llama /
  // mistral / etc.) only match for the ollama backend; a paid model like
  // `claude-llama-experimental` won't false-match the ollama rate.
  const exactRate = findRate(model, backend);
  const fallbackRate = findFallbackRate(backend, model);
  const knownRate = exactRate || fallbackRate;
  const sessionEstimate = estimateOpaqueSessionCost(backend, model);

  // If we have token counts, use them exactly
  if (normalizedInput !== undefined && normalizedOutput !== undefined) {
    if (knownRate) {
      const cachedInput = Math.min(normalizedCachedInput ?? 0, normalizedInput);
      const uncachedInput = Math.max(0, normalizedInput - cachedInput);
      const cachedInputRate = knownRate.cachedInput ?? knownRate.input;
      const costUsd =
        (uncachedInput / 1_000_000) * knownRate.input +
        (cachedInput / 1_000_000) * cachedInputRate +
        (normalizedOutput / 1_000_000) * knownRate.output;
      return { costUsd: +Math.max(0, costUsd).toFixed(6), isEstimate: !exactRate };
    }
  }

  // Partial token telemetry on paid backends should still produce nonzero telemetry.
  if ((normalizedInput !== undefined || normalizedOutput !== undefined) && knownRate) {
    const inputEstimate = normalizedInput ?? normalizedOutput ?? 0;
    const outputEstimate = normalizedOutput ?? normalizedInput ?? 0;
    const tokenBasedEstimate =
      (inputEstimate / 1_000_000) * knownRate.input +
      (outputEstimate / 1_000_000) * knownRate.output;
    const floor = hasKnownPaidRemoteBackend(backend) ? Math.max(sessionEstimate, 0.01) : sessionEstimate;
    return {
      costUsd: +Math.max(tokenBasedEstimate, floor).toFixed(6),
      isEstimate: true,
    };
  }

  // Fall back to flat estimate
  const estimate = hasKnownPaidRemoteBackend(backend)
    ? Math.max(sessionEstimate, 0.01)
    : sessionEstimate;
  return { costUsd: estimate ?? 0, isEstimate: true };
}

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Optional hooks that turn cost-tracker from observability-only into
 * mid-flight enforcement. When wired:
 *   - onCharge() is called on every recorded cost event
 *   - if the BudgetGuard returns { kill: true }, onKill() fires so the
 *     caller (server.ts) can SIGTERM the live spawn before more money burns
 */
export interface CostTrackerHooks {
  budgetGuard?: {
    onCharge(params: { project: string; agentId: string; usd: number; budgetUsdPerDay: number }): {
      kill: boolean;
      throttle: boolean;
      spentTodayUsd: number;
      reason?: string;
    };
  };
  /** Resolve the daily budget for a project. Return null to skip enforcement. */
  budgetResolver?: (project: string) => number | null;
  /**
   * Called when budget-guard says the spawn must be killed. The caller
   * typically routes this through a budget-pause module that interposes
   * a grace window before actually SIGTERMing — not a direct spawner.kill.
   */
  onKill?: (params: {
    agentId: string;
    project: string;
    reason: string;
    spentTodayUsd: number;
    budgetUsdPerDay: number;
  }) => void;
}

export function createCostTracker(db: Database, hooks: CostTrackerHooks = {}) {
  const { budgetGuard, budgetResolver, onKill } = hooks;
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id           TEXT    PRIMARY KEY,
      ts           INTEGER NOT NULL,
      backend      TEXT    NOT NULL,
      model        TEXT    NOT NULL,
      project_name TEXT,
      project_dir  TEXT,
      identity     TEXT,
      spawn_id     TEXT,
      input_tokens  INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd     REAL    NOT NULL DEFAULT 0,
      is_estimate  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ce_ts      ON cost_events(ts);
    CREATE INDEX IF NOT EXISTS idx_ce_project ON cost_events(project_name, ts);
    CREATE INDEX IF NOT EXISTS idx_ce_backend ON cost_events(backend, ts);
  `);

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(cost_events)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!existingColumns.has('project_dir')) {
    db.exec('ALTER TABLE cost_events ADD COLUMN project_dir TEXT;');
  }
  if (!existingColumns.has('cached_input_tokens')) {
    db.exec('ALTER TABLE cost_events ADD COLUMN cached_input_tokens INTEGER;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_project_dir ON cost_events(project_dir, ts);');

  const insertStmt = db.prepare(`
    INSERT INTO cost_events
      (id, ts, backend, model, project_name, project_dir, identity, spawn_id,
       input_tokens, cached_input_tokens, output_tokens, cost_usd, is_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  /**
   * Append a durable Agent Harbor CostAccrualEvent (ADR-0095, lib/agent-harbor)
   * for a just-recorded cost_events row. Best-effort and NEVER throws — cost
   * recording (cost_events) is the primary, older ledger; this is an additive
   * durable-fact sink layered on top per the 2026-07-14 halt-mandate BUG 2
   * ("built but unfed": CostAccrualLedger/appendEvent existed with zero
   * production writers, so harbor_events was always empty).
   *
   * EXEMPTION: a `costModel:'subscription'` backend (cli:claude-code,
   * cli:codex, …) has $0 real spend by construction — appending a cost fact
   * for it would be recording a fiction. Every metered backend (claude,
   * gemini, cloudflare, openai, groq, deepseek, xai, ollama, lmstudio, aider,
   * custom, and any backend absent from the catalog) accrues, even when the
   * computed cost is an estimate or $0 — the FACT that a metered call
   * happened is itself worth a durable record.
   *
   * Gated on `spawnId` being present: `agentNodeId` is a required field on
   * CostAccrualEvent (schemas/agent-harbor/v0/cost-accrual-event.schema.json)
   * and a cost_events row recorded without a spawnId cannot be attributed to
   * any agent node, so there is nothing honest to append.
   */
  function emitCostAccrualEvent(opts: CostRecordOpts, costUsd: number, isEstimate: boolean, ts: number): void {
    if (!opts.spawnId) return;
    if (isSubscriptionBackend(opts.backend)) return;
    try {
      const quantity = (opts.inputTokens ?? 0) + (opts.outputTokens ?? 0);
      const event: CostAccrualEvent = {
        schema: 'pd.agent-harbor.cost-accrual-event.v0',
        costEventId: `cost_${randomUUID()}`,
        agentNodeId: opts.spawnId,
        sessionId: opts.identity ?? null,
        runId: null,
        provider: opts.backend,
        modelTier: null,
        modelName: opts.model,
        meter: 'tokens',
        // A cost-tracker record() call is the SETTLED total for a completed
        // spawn (spawner.ts calls it once, after the run finishes), so
        // 'finalization' is the correct phase — not a mid-stream 'stream' tick.
        phase: 'finalization',
        quantity,
        unit: 'total-tokens',
        estimatedCostUsd: isEstimate ? costUsd : null,
        actualCostUsd: isEstimate ? null : costUsd,
        budgetId: null,
        budgetAction: 'none',
        idempotencyKey: `cost-tracker:${opts.spawnId}:${ts}`,
        occurredAt: new Date(ts).toISOString(),
      };
      appendEvent(db, { streamType: 'cost-accrual-event', payload: event });
    } catch {
      // The durable ledger is additive observability — a schema/db failure
      // here must never block or fail the primary cost_events recording.
    }
  }

  /**
   * Record a cost event for a completed spawn.
   * Safe to call fire-and-forget — never throws.
   */
  function record(opts: CostRecordOpts): CostEvent | null {
    try {
      const { costUsd, isEstimate } = computeCost(
        opts.backend, opts.model, opts.inputTokens, opts.outputTokens, opts.cachedInputTokens,
      );
      const id = randomBytes(8).toString('hex');
      const ts = Date.now();
      insertStmt.run(
        id, ts, opts.backend, opts.model,
        opts.projectName ?? null, opts.projectDir ?? null, opts.identity ?? null, opts.spawnId ?? null,
        opts.inputTokens ?? null, opts.cachedInputTokens ?? null, opts.outputTokens ?? null,
        costUsd, isEstimate ? 1 : 0,
      );

      emitCostAccrualEvent(opts, costUsd, isEstimate, ts);

      // Budget-guard enforcement hook — the record above is observability,
      // this is the teeth. If the project crosses 100% of its daily budget,
      // onKill fires and the caller SIGTERMs the live spawn. If no
      // budgetResolver is wired (or it returns null for this project),
      // enforcement is skipped for that project — intentional opt-in.
      if (budgetGuard && budgetResolver && opts.projectName && opts.spawnId && costUsd > 0) {
        try {
          const budget = budgetResolver(opts.projectName);
          if (budget && budget > 0 && Number.isFinite(budget)) {
            const decision = budgetGuard.onCharge({
              project: opts.projectName,
              agentId: opts.spawnId,
              usd: costUsd,
              budgetUsdPerDay: budget,
            });
            if (decision.kill && onKill) {
              onKill({
                agentId: opts.spawnId,
                project: opts.projectName,
                reason: decision.reason || 'budget-exceeded',
                spentTodayUsd: decision.spentTodayUsd,
                budgetUsdPerDay: budget,
              });
            }
          }
        } catch {
          // Budget-guard failure must never block cost recording.
        }
      }

      return {
        id, ts,
        backend: opts.backend, model: opts.model,
        projectName: opts.projectName ?? null, projectDir: opts.projectDir ?? null, identity: opts.identity ?? null,
        spawnId: opts.spawnId ?? null,
        inputTokens: opts.inputTokens ?? null, cachedInputTokens: opts.cachedInputTokens ?? null, outputTokens: opts.outputTokens ?? null,
        costUsd, isEstimate,
      };
    } catch {
      return null;
    }
  }

  /** Total cost and spawn count over a time window. Default: last 24h. */
  function total(opts?: { since?: number }): CostTotals {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total, COUNT(*) as count, COALESCE(SUM(is_estimate), 0) as est
      FROM cost_events WHERE ts >= ?
    `).get(since) as { total: number; count: number; est: number };
    return { totalUsd: +row.total.toFixed(6), spawnCount: row.count, estimatedCount: row.est };
  }

  /** Cost broken down by project. Default: last 24h. */
  function summary(opts?: { since?: number; projectName?: string; projectDir?: string }): CostSummaryRow[] {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const conditions = ['ts >= ?'];
    const params: unknown[] = [since];

    if (opts?.projectName) {
      conditions.push('project_name = ?');
      params.push(opts.projectName);
    }
    if (opts?.projectDir) {
      conditions.push('project_dir = ?');
      params.push(opts.projectDir);
    }

    const whereClause = conditions.join(' AND ');

    // Single query using CTE + window function — eliminates N+1 per-project top-model loop.
    interface RawRow {
      project_name: string | null;
      project_dir: string | null;
      total_usd: number;
      spawn_count: number;
      estimated_count: number;
      top_model: string | null;
    }

    const rows = db.prepare(`
      WITH filtered AS (
        SELECT * FROM cost_events WHERE ${whereClause}
      ),
      agg AS (
        SELECT project_name, project_dir, SUM(cost_usd) AS total_usd, COUNT(*) AS spawn_count, SUM(is_estimate) AS estimated_count
        FROM filtered GROUP BY project_name, project_dir
      ),
      model_counts AS (
        SELECT project_name, project_dir, model, COUNT(*) AS cnt
        FROM filtered GROUP BY project_name, project_dir, model
      ),
      top_models AS (
        SELECT project_name, project_dir, model,
               ROW_NUMBER() OVER (PARTITION BY project_name, project_dir ORDER BY cnt DESC) AS rn
        FROM model_counts
      )
      SELECT a.project_name, a.project_dir, a.total_usd, a.spawn_count, a.estimated_count, t.model AS top_model
      FROM agg a
      LEFT JOIN top_models t
        ON t.project_name IS a.project_name
       AND t.project_dir IS a.project_dir
       AND t.rn = 1
      ORDER BY a.total_usd DESC
    `).all(...params) as RawRow[];

    return rows.map(r => ({
      projectName: r.project_name,
      projectDir: r.project_dir,
      totalUsd: +r.total_usd.toFixed(6),
      spawnCount: r.spawn_count,
      estimatedCount: r.estimated_count,
      topModel: r.top_model ?? null,
    }));
  }

  /** Cost broken down by backend. Default: last 24h. */
  function byBackend(opts?: { since?: number }): Array<{ backend: string; totalUsd: number; count: number }> {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const rows = db.prepare(`
      SELECT backend, SUM(cost_usd) as total_usd, COUNT(*) as count
      FROM cost_events WHERE ts >= ?
      GROUP BY backend ORDER BY total_usd DESC
    `).all(since) as { backend: string; total_usd: number; count: number }[];
    return rows.map(r => ({ backend: r.backend, totalUsd: +r.total_usd.toFixed(6), count: r.count }));
  }

  /** Most recent N cost events. */
  function recent(limit = 50): CostEvent[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
    const n = Math.max(0, Math.min(normalizedLimit, 500));
    interface RawEvent {
      id: string; ts: number; backend: string; model: string;
      project_name: string | null; project_dir: string | null; identity: string | null; spawn_id: string | null;
      input_tokens: number | null; cached_input_tokens: number | null; output_tokens: number | null;
      cost_usd: number; is_estimate: number;
    }
    const rows = db.prepare(`
      SELECT * FROM cost_events ORDER BY ts DESC LIMIT ?
    `).all(n) as RawEvent[];
    return rows.map(r => ({
      id: r.id, ts: r.ts, backend: r.backend, model: r.model,
      projectName: r.project_name, projectDir: r.project_dir, identity: r.identity, spawnId: r.spawn_id,
      inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens, outputTokens: r.output_tokens,
      costUsd: r.cost_usd, isEstimate: r.is_estimate === 1,
    }));
  }

  /**
   * Check a project's spend against a daily budget.
   * @param projectName  project to check
   * @param budgetUsdPerDay daily budget ceiling in USD
   * @param since        window start (default: last 24h)
   */
  function budgetStatus(projectName: string, budgetUsdPerDay: number, since?: number): BudgetStatus {
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as spent
      FROM cost_events WHERE (project_name = ? OR project_dir = ?) AND ts >= ?
    `).get(projectName, projectName, since ?? Date.now() - 86_400_000) as { spent: number };
    const spentUsd = +row.spent.toFixed(6);
    const percentUsed = budgetUsdPerDay > 0
      ? +((spentUsd / budgetUsdPerDay) * 100).toFixed(1)
      : spentUsd > 0 ? 100 : 0;
    return {
      project: projectName,
      budgetUsdPerDay,
      spentUsd,
      remainingUsd: Math.max(0, +(budgetUsdPerDay - spentUsd).toFixed(6)),
      percentUsed,
      overBudget: spentUsd > budgetUsdPerDay,
    };
  }

  return { record, total, summary, byBackend, recent, budgetStatus, computeCost };
}

export type CostTracker = ReturnType<typeof createCostTracker>;
