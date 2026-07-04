import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Backend Catalog — single source of truth for the fleet's available LLM backends.
 *
 * This file is consumed by:
 *   - `routes/fleet.ts` (GET /fleet/models)
 *   - `cli/commands/backend.ts` (pd backend list / use / cost)
 *   - `apps/FleetBar/FleetBar/BackendStore.swift` (via /fleet/models)
 *   - `public/index.html` (Backend panel)
 *
 * Each entry carries enough metadata for a UI to:
 *   - show the right framing ("FREE — Claude Max" vs "metered API")
 *   - explain the cost model (subscription/metered/local/free)
 *   - render setup CTAs (install brew, set API key, run setup-token)
 *   - rank the picker so "free via subscription" rises to the top when ready
 *
 * Cost-model values:
 *   - `subscription` — flat-rate; user already pays a monthly fee
 *     (CLI tube backends: cli:claude-code, cli:codex)
 *   - `metered`      — pay-per-token API (claude, gemini, cloudflare, openai)
 *   - `local`        — runs on user's machine, no marginal cost
 *     (ollama, custom)
 *   - `cli`          — driven through a CLI binary (codex, claude-cli, aider);
 *                      auth/cost is opaque to PD
 */

export type BackendCostModel = 'subscription' | 'metered' | 'local' | 'cli';

export interface BackendCatalogEntry {
  /** Internal id used throughout PD (spawner, readiness, cost-tracker). */
  id: string;
  /** Display name. */
  name: string;
  /** Cost model — drives UI framing. */
  costModel: BackendCostModel;
  /**
   * Headline framing copy. Shown in FleetBar status row and dashboard hero.
   * Should read aloud well. e.g. "FREE — your Claude Max subscription"
   */
  framing: string;
  /**
   * One-line description of what this backend is, for the picker.
   */
  description: string;
  /**
   * Models exposed by this backend. Tier-aware backends (claude-cli)
   * supplement this list from BUILTIN_MODEL_TIERS at request time.
   */
  models: string[];
  /**
   * Marketing tagline for the picker. e.g. "$200/mo Claude Max powers the fleet at $0 marginal"
   */
  tagline?: string;
  /**
   * If non-null, the env var the operator would set to force this backend
   * for every spawn regardless of pd-fleet.yml. The CLI-tube backends
   * (`cli:claude-code`, `cli:codex`, `cli:gemini`, `cli:groq`, `cli:grok`)
   * honor this (via PD_USE_CLI_BACKEND).
   */
  pdUseCliBackendValue?: 'claude-code' | 'codex' | 'gemini' | 'groq' | 'grok';
  /**
   * Show this prominently in the picker. Used to rank "free via subscription"
   * options ahead of metered ones in the FleetBar/dashboard picker.
   */
  recommended?: boolean;
}

export const BACKEND_CATALOG: readonly BackendCatalogEntry[] = [
  // ──── Subscription / free-at-marginal-cost ─────────────────────────────
  {
    id: 'cli:claude-code',
    name: 'Claude Code (CLI)',
    costModel: 'subscription',
    framing: 'FREE — your Claude Max subscription',
    description: "Drives your local `claude` binary as a child process. Auth and billing flow through your Claude Max ($200/mo) or Claude Pro ($20/mo) subscription. $0 marginal cost per spawn.",
    tagline: '$200/mo Claude Max powers the entire fleet at $0 marginal',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
    pdUseCliBackendValue: 'claude-code',
    recommended: true,
  },
  {
    id: 'cli:codex',
    name: 'Codex (ChatGPT Pro CLI)',
    costModel: 'subscription',
    framing: 'FREE — your ChatGPT Pro subscription',
    description: "Drives your local `codex` binary as a child process. Auth and billing flow through your ChatGPT Pro ($20/mo) subscription. $0 marginal cost per spawn.",
    tagline: '$20/mo ChatGPT Pro powers the entire fleet at $0 marginal',
    models: ['gpt-5', 'gpt-5-codex'],
    pdUseCliBackendValue: 'codex',
    recommended: true,
  },
  {
    id: 'cli:gemini',
    name: 'Gemini CLI',
    costModel: 'subscription',
    framing: 'FREE tier — your Google account',
    description: "Drives your local `gemini` binary as a child process. Auth and billing flow through your Google account (generous free tier) or Gemini Code Assist subscription.",
    tagline: 'Google-account Gemini CLI free tier powers spawns at $0 marginal',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    pdUseCliBackendValue: 'gemini',
  },
  {
    id: 'cli:groq',
    name: 'Groq Code CLI',
    costModel: 'subscription',
    framing: 'Rides your Groq account',
    description: "Drives your local `groq` binary as a child process. Auth and billing flow through your Groq account; the CLI manages its own key.",
    tagline: 'Groq LPU speed through your existing groq CLI login',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    pdUseCliBackendValue: 'groq',
  },
  {
    id: 'cli:grok',
    name: 'Grok CLI',
    costModel: 'subscription',
    framing: 'Rides your xAI / SuperGrok subscription',
    description: "Drives your local `grok` binary as a child process. Auth and billing flow through your xAI account or SuperGrok subscription.",
    tagline: 'SuperGrok subscription powers spawns at $0 marginal',
    models: ['grok-4', 'grok-code-fast-1'],
    pdUseCliBackendValue: 'grok',
  },

  // ──── Metered (pay per token) ───────────────────────────────────────────
  {
    id: 'claude-cli',
    name: 'Claude CLI (tier shorthand)',
    costModel: 'cli',
    framing: 'Metered through `claude` CLI',
    description: 'The `claude` binary in non-tube mode; tier-aware (low/mid/high → haiku/sonnet/opus).',
    models: ['haiku', 'sonnet', 'opus'],
  },
  {
    id: 'claude',
    name: 'Claude SDK',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Direct Anthropic API via @anthropic-ai/sdk. Requires ANTHROPIC_API_KEY.',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Google Gemini REST API (generateContent). Requires GEMINI_API_KEY. Default model: gemini-2.5-flash.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    costModel: 'metered',
    framing: 'Cheap metered — fractions of a cent per spawn',
    description: 'Cloudflare Workers AI — many open models behind one API token.',
    models: [
      '@cf/zai-org/glm-4.7-flash',
      '@cf/openai/gpt-oss-120b',
      // Real Workers AI slug — the phantom kimi-k2.6 id hung ai.run (2026-07-03 fleet outage).
      '@cf/moonshotai/kimi-k2-instruct',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/nvidia/nemotron-3-120b-a12b',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Direct OpenAI API. Requires OPENAI_API_KEY. Default model: gpt-5-mini.',
    models: ['gpt-5-nano', 'gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4o-mini', 'o4-mini'],
  },
  {
    id: 'groq',
    name: 'Groq (LPU)',
    costModel: 'metered',
    framing: 'Cheap metered — fast open-weight models on LPU hardware',
    description: 'Groq OpenAI-compatible API. Requires GROQ_API_KEY. Default model: llama-3.3-70b-versatile.',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (legacy CLI mode)',
    costModel: 'cli',
    framing: 'Metered through `codex` CLI',
    description: 'Legacy adapter that drives `codex` CLI in non-tube mode.',
    models: ['gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.4'],
  },

  // ──── Local / free ──────────────────────────────────────────────────────
  {
    id: 'ollama',
    name: 'Ollama (local)',
    costModel: 'local',
    framing: 'FREE — runs on your machine',
    description: 'Local Ollama daemon. Free, but quality depends on your hardware.',
    models: [],
  },
  {
    id: 'aider',
    name: 'Aider',
    costModel: 'cli',
    framing: 'Metered — depends on Aider model config',
    description: 'Drives the `aider` CLI; underlying model provider auth is external.',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5'],
  },
  {
    id: 'custom',
    name: 'Custom command',
    costModel: 'cli',
    framing: 'Cost depends on the command',
    description: 'Run an arbitrary command as a spawn. Operator declares the cost shape.',
    models: ['custom-low', 'custom-mid', 'custom-high'],
  },
];

/**
 * Lookup helper. Returns undefined for unknown ids so callers can
 * decide whether to error or fall through.
 */
export function getBackendCatalogEntry(id: string): BackendCatalogEntry | undefined {
  return BACKEND_CATALOG.find((entry) => entry.id === id);
}

/**
 * The set of backend ids the catalog knows about. Used by route validators
 * to reject "unknown backend" requests before they hit readiness probes.
 */
export const KNOWN_BACKEND_IDS: ReadonlySet<string> = new Set(BACKEND_CATALOG.map((b) => b.id));

export const CLI_BACKEND_SELECTION_PATH = join(homedir(), '.port-daddy-cli-backend');
const MAX_PERSISTED_BACKEND_SELECTION_BYTES = 128;

/**
 * "Free via subscription / local" backends, ranked first in pickers.
 * Order matches BACKEND_CATALOG declaration order so we get a stable
 * recommended picker (Claude Max first, then ChatGPT Pro, then local Ollama).
 */
export function recommendedBackendIds(): string[] {
  return BACKEND_CATALOG
    .filter((b) => b.recommended || b.costModel === 'local')
    .map((b) => b.id);
}

function normalizeForcedCliBackend(raw: string | undefined | null): {
  id: string;
  value: NonNullable<BackendCatalogEntry['pdUseCliBackendValue']>;
} | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'claude-code' || normalized === 'claude') {
    return { id: 'cli:claude-code', value: 'claude-code' };
  }
  if (normalized === 'codex') return { id: 'cli:codex', value: 'codex' };
  if (normalized === 'gemini') return { id: 'cli:gemini', value: 'gemini' };
  if (normalized === 'groq') return { id: 'cli:groq', value: 'groq' };
  if (normalized === 'grok') return { id: 'cli:grok', value: 'grok' };
  return null;
}

export function readPersistedCliBackendSelection(
  path: string = CLI_BACKEND_SELECTION_PATH,
): string | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    if (raw.length > MAX_PERSISTED_BACKEND_SELECTION_BYTES) return null;
    return raw.trim() || null;
  } catch {
    return null;
  }
}

function detectForcedCliBackendMatch(
  env: NodeJS.ProcessEnv = process.env,
  options: { persistedPath?: string | null } = {},
): { id: string; value: NonNullable<BackendCatalogEntry['pdUseCliBackendValue']> } | null {
  const envMatch = normalizeForcedCliBackend(env.PD_USE_CLI_BACKEND);
  if (envMatch) return envMatch;

  const hasExplicitPersistedPath = typeof options.persistedPath === 'string';
  const shouldReadDefaultPersistedPath = options.persistedPath === undefined && env === process.env;
  if (!hasExplicitPersistedPath && !shouldReadDefaultPersistedPath) return null;
  const persistedPath = hasExplicitPersistedPath ? options.persistedPath as string : CLI_BACKEND_SELECTION_PATH;

  return normalizeForcedCliBackend(
    readPersistedCliBackendSelection(persistedPath),
  );
}

/**
 * Detect which CLI backend (if any) the operator has forced. The process env
 * wins; otherwise the FleetBar/CLI persisted choice is honored.
 */
export function detectForcedCliBackend(
  env: NodeJS.ProcessEnv = process.env,
  options: { persistedPath?: string | null } = {},
): string | null {
  return detectForcedCliBackendMatch(env, options)?.id ?? null;
}

export function detectForcedCliBackendValue(
  env: NodeJS.ProcessEnv = process.env,
  options: { persistedPath?: string | null } = {},
): string | null {
  return detectForcedCliBackendMatch(env, options)?.value ?? null;
}
