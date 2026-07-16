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
 *     (CLI tube backends: cli:claude-code, cli:codex, cli:agy)
 *   - `metered`      — pay-per-token API (claude, gemini, cloudflare, openai)
 *   - `local`        — runs on user's machine, no marginal cost
 *     (ollama, custom)
 *   - `cli`          — driven through a CLI binary (codex, claude-cli, aider);
 *                      auth/cost is opaque to PD
 */

export type BackendCostModel = 'subscription' | 'metered' | 'local' | 'cli';

export type HarnessSpawnTransport =
  | 'agent-cli'
  | 'provider-sdk'
  | 'provider-http'
  | 'model-server-http'
  | 'custom-command';

export type HarnessPromptTransport =
  | 'argument'
  | 'stdin'
  | 'json-body'
  | 'sdk-argument'
  | 'custom';

export type HarnessInteractiveChannel =
  | 'terminal'
  | 'stream-json'
  | 'remote-control'
  | 'app-server'
  | 'acp'
  | 'http'
  | 'none';

export type HarnessAuthMode =
  | 'oauth-subscription'
  | 'api-key'
  | 'api-token'
  | 'delegated-cli'
  | 'local-none'
  | 'custom';

export type HarnessTranscriptFormat =
  | 'claude-jsonl'
  | 'codex-rollout-jsonl'
  | 'gemini-session-json'
  | 'agy-log'
  | 'port-daddy-jsonl'
  | 'aider-chat-history'
  | 'none'
  | 'custom';

export interface HarnessCommandTemplate {
  /** Executable only; never a shell fragment. */
  executable: string;
  /** argv template. Supported placeholders are documented in ADR-0118. */
  args: readonly string[];
  promptTransport: HarnessPromptTransport;
}

export interface HarnessProbeSpec {
  executable: string;
  spawnHelpArgs: readonly string[];
  spawnEvidence: readonly string[];
  resumeHelpArgs?: readonly string[];
  resumeEvidence?: readonly string[];
}

export interface HarnessAdapterCapabilities {
  /** Stable adapter family. Several billing rows may share one harness. */
  family: string;
  spawn: {
    transport: HarnessSpawnTransport;
    command?: HarnessCommandTemplate;
  };
  resume: {
    /** True only when the harness itself can restore prior context. */
    native: boolean;
    /** `history` restores messages but not a stable harness session identity. */
    scope: 'session' | 'history' | 'none';
    command?: HarnessCommandTemplate;
  };
  /** Every N:N target must be able to receive a sanitized handoff capsule. */
  acceptsInitialPrompt: boolean;
  interactiveChannels: readonly HarnessInteractiveChannel[];
  transcript: {
    format: HarnessTranscriptFormat;
    owner: 'harness' | 'port-daddy' | 'remote-provider' | 'none';
    stability: 'documented' | 'observed' | 'internal' | 'none';
    root?: string;
  };
  authModes: readonly HarnessAuthMode[];
  limitations: readonly string[];
  /** Optional, side-effect-free help probe. Never launches a model call. */
  probe?: HarnessProbeSpec;
}

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
   * (`cli:claude-code`, `cli:codex`, `cli:agy`, `cli:gemini`, `cli:groq`, `cli:grok`)
   * honor this (via PD_USE_CLI_BACKEND).
   */
  pdUseCliBackendValue?: 'claude-code' | 'codex' | 'agy' | 'gemini' | 'groq' | 'grok';
  /**
   * Show this prominently in the picker. Used to rank "free via subscription"
   * options ahead of metered ones in the FleetBar/dashboard picker.
   */
  recommended?: boolean;
  /** N:N continuation mechanics for this concrete backend route. */
  adapter: HarnessAdapterCapabilities;
}

const CLAUDE_CLI_ADAPTER: HarnessAdapterCapabilities = {
  family: 'claude-code',
  spawn: {
    transport: 'agent-cli',
    command: { executable: 'claude', args: ['-p', '{prompt}'], promptTransport: 'argument' },
  },
  resume: {
    native: true,
    scope: 'session',
    command: { executable: 'claude', args: ['--resume', '{sessionId}', '-p', '{prompt}'], promptTransport: 'argument' },
  },
  acceptsInitialPrompt: true,
  interactiveChannels: ['terminal', 'stream-json', 'remote-control'],
  transcript: {
    format: 'claude-jsonl',
    owner: 'harness',
    stability: 'observed',
    root: '~/.claude/projects',
  },
  authModes: ['oauth-subscription', 'api-key'],
  limitations: [
    'Native resume requires a canonical UUID, an explicit Claude JSONL transcript reference, and daemon-witnessed session metadata bound to the canonical source workspace; another harness must enter through a sanitized handoff capsule.',
  ],
  probe: {
    executable: 'claude',
    spawnHelpArgs: ['--help'],
    spawnEvidence: ['--print', '--output-format'],
    resumeHelpArgs: ['--help'],
    resumeEvidence: ['--resume', '--fork-session'],
  },
};

const CODEX_CLI_ADAPTER: HarnessAdapterCapabilities = {
  family: 'codex-cli',
  spawn: {
    transport: 'agent-cli',
    command: { executable: 'codex', args: ['exec', '--json', '{prompt}'], promptTransport: 'argument' },
  },
  resume: {
    native: true,
    scope: 'session',
    command: { executable: 'codex', args: ['exec', 'resume', '{sessionId}', '{prompt}'], promptTransport: 'argument' },
  },
  acceptsInitialPrompt: true,
  interactiveChannels: ['terminal', 'app-server'],
  transcript: {
    format: 'codex-rollout-jsonl',
    owner: 'harness',
    stability: 'observed',
    root: '~/.codex/sessions',
  },
  authModes: ['oauth-subscription', 'api-key'],
  limitations: [
    'Native resume requires a canonical UUID, an explicit Codex rollout reference, and daemon-witnessed session_meta bound to the canonical source workspace; cross-harness continuation creates a successor from a handoff capsule.',
  ],
  probe: {
    executable: 'codex',
    spawnHelpArgs: ['exec', '--help'],
    spawnEvidence: ['Run Codex non-interactively', '[PROMPT]'],
    resumeHelpArgs: ['exec', 'resume', '--help'],
    resumeEvidence: ['Resume a previous session', '[SESSION_ID]'],
  },
};

const AGY_CLI_ADAPTER: HarnessAdapterCapabilities = {
  family: 'agy-cli',
  spawn: {
    transport: 'agent-cli',
    command: { executable: 'agy', args: ['--print', '{prompt}'], promptTransport: 'argument' },
  },
  resume: {
    native: true,
    scope: 'session',
    command: { executable: 'agy', args: ['--conversation', '{sessionId}', '--print', '{prompt}'], promptTransport: 'argument' },
  },
  acceptsInitialPrompt: true,
  interactiveChannels: ['terminal'],
  transcript: { format: 'agy-log', owner: 'harness', stability: 'observed' },
  authModes: ['delegated-cli'],
  limitations: [
    'Native resume requires a canonical UUID, the conversation-keyed brain transcript, and an exact workspace-to-conversation binding in Antigravity last_conversations metadata.',
    'Structured transcript streaming is not documented; Port Daddy currently captures prompt plus final output.',
  ],
  probe: {
    executable: 'agy',
    spawnHelpArgs: ['--help'],
    spawnEvidence: ['--print', '--prompt-interactive'],
    resumeHelpArgs: ['--help'],
    resumeEvidence: ['--conversation', '--continue'],
  },
};

const GEMINI_CLI_ADAPTER: HarnessAdapterCapabilities = {
  family: 'gemini-cli',
  spawn: {
    transport: 'agent-cli',
    command: { executable: 'gemini', args: ['--prompt', '{prompt}'], promptTransport: 'argument' },
  },
  resume: {
    native: true,
    scope: 'session',
    command: { executable: 'gemini', args: ['--resume', '{sessionId}', '--prompt', '{prompt}'], promptTransport: 'argument' },
  },
  acceptsInitialPrompt: true,
  interactiveChannels: ['terminal', 'acp'],
  transcript: {
    format: 'gemini-session-json',
    owner: 'harness',
    stability: 'observed',
    root: '~/.gemini',
  },
  authModes: ['oauth-subscription', 'api-key'],
  limitations: [
    'Gemini UUID resume is project-scoped and requires an explicit chat reference; Port Daddy witnesses the canonical UUID, project hash, registry entry, chat file, and canonical workspace before launch.',
  ],
  probe: {
    executable: 'gemini',
    spawnHelpArgs: ['--help'],
    spawnEvidence: ['--prompt', '--output-format'],
    resumeHelpArgs: ['--help'],
    resumeEvidence: ['--resume', '--list-sessions'],
  },
};

function promptOnlyCliAdapter(
  family: string,
  executable: string,
  authModes: readonly HarnessAuthMode[],
  limitations: readonly string[],
): HarnessAdapterCapabilities {
  return {
    family,
    spawn: {
      transport: 'agent-cli',
      command: { executable, args: ['-p', '{prompt}'], promptTransport: 'argument' },
    },
    resume: { native: false, scope: 'none' },
    acceptsInitialPrompt: true,
    interactiveChannels: ['terminal'],
    transcript: { format: 'none', owner: 'none', stability: 'none' },
    authModes,
    limitations,
    probe: {
      executable,
      spawnHelpArgs: ['--help'],
      spawnEvidence: ['-p'],
    },
  };
}

function apiAdapter(
  family: string,
  transport: 'provider-sdk' | 'provider-http',
  authModes: readonly HarnessAuthMode[],
  limitations: readonly string[] = [],
): HarnessAdapterCapabilities {
  return {
    family,
    spawn: { transport },
    resume: { native: false, scope: 'none' },
    acceptsInitialPrompt: true,
    interactiveChannels: ['http'],
    transcript: {
      format: 'port-daddy-jsonl',
      owner: 'port-daddy',
      stability: 'internal',
    },
    authModes,
    limitations: [
      'Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule.',
      ...limitations,
    ],
  };
}

function localModelServerAdapter(family: string): HarnessAdapterCapabilities {
  return {
    family,
    spawn: { transport: 'model-server-http' },
    resume: { native: false, scope: 'none' },
    acceptsInitialPrompt: true,
    interactiveChannels: ['http'],
    transcript: { format: 'port-daddy-jsonl', owner: 'port-daddy', stability: 'internal' },
    authModes: ['local-none'],
    limitations: [
      'A model server is not an agent harness; Port Daddy must own tools, transcript, state, and continuation.',
    ],
  };
}

const AIDER_ADAPTER: HarnessAdapterCapabilities = {
  family: 'aider',
  spawn: {
    transport: 'agent-cli',
    command: { executable: 'aider', args: ['--message', '{prompt}'], promptTransport: 'argument' },
  },
  resume: {
    native: true,
    scope: 'history',
    command: {
      executable: 'aider',
      args: ['--restore-chat-history', '--chat-history-file', '{historyFile}', '--message', '{prompt}'],
      promptTransport: 'argument',
    },
  },
  acceptsInitialPrompt: true,
  interactiveChannels: ['terminal'],
  transcript: { format: 'aider-chat-history', owner: 'harness', stability: 'documented' },
  authModes: ['api-key', 'delegated-cli'],
  limitations: ['History restoration replays messages but does not preserve a stable Aider session identity.'],
  probe: {
    executable: 'aider',
    spawnHelpArgs: ['--help'],
    spawnEvidence: ['--message', '--message-file'],
    resumeHelpArgs: ['--help'],
    resumeEvidence: ['--restore-chat-history', '--chat-history-file'],
  },
};

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
    adapter: CLAUDE_CLI_ADAPTER,
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
    adapter: CODEX_CLI_ADAPTER,
  },
  {
    id: 'cli:agy',
    name: 'Antigravity (agy CLI)',
    costModel: 'subscription',
    framing: 'Rides your local agy login',
    description: "Drives your local `agy` binary as a child process. Auth and billing flow through the Antigravity CLI; Port Daddy captures the prompt and final stdout/stderr without claiming structured streaming.",
    tagline: 'Antigravity CLI through your existing agy authentication',
    models: [],
    pdUseCliBackendValue: 'agy',
    adapter: AGY_CLI_ADAPTER,
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
    adapter: GEMINI_CLI_ADAPTER,
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
    adapter: promptOnlyCliAdapter(
      'groq-cli',
      'groq',
      ['delegated-cli', 'api-key'],
      ['No stable session-id resume or structured transcript surface is documented for the installed Port Daddy integration.'],
    ),
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
    adapter: promptOnlyCliAdapter(
      'grok-claude-proxy',
      'grok',
      ['delegated-cli'],
      [
        'The current grok command is a Claude proxy, not an independent durable harness.',
        'Resume ownership remains with the underlying Claude session and is not exposed by the wrapper.',
      ],
    ),
  },

  // ──── Metered (pay per token) ───────────────────────────────────────────
  {
    id: 'claude-cli',
    name: 'Claude CLI (tier shorthand)',
    costModel: 'cli',
    framing: 'Metered through `claude` CLI',
    description: 'The `claude` binary in non-tube mode; tier-aware (low/mid/high → haiku/sonnet/opus).',
    models: ['haiku', 'sonnet', 'opus'],
    adapter: CLAUDE_CLI_ADAPTER,
  },
  {
    id: 'claude',
    name: 'Claude SDK',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Direct Anthropic API via @anthropic-ai/sdk. Requires ANTHROPIC_API_KEY.',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
    adapter: apiAdapter('anthropic-api', 'provider-sdk', ['api-key']),
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Google Gemini REST API (generateContent). Requires GEMINI_API_KEY. Default model: gemini-2.5-flash.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    adapter: apiAdapter('gemini-api', 'provider-http', ['api-key']),
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
    adapter: apiAdapter(
      'cloudflare-workers-ai',
      'provider-http',
      ['api-token'],
      ['Workers AI model calls are stateless; Cloudflare Agents durable state is a separate runtime adapter, not implied by this row.'],
    ),
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'Direct OpenAI API. Requires OPENAI_API_KEY. Default model: gpt-5-mini.',
    models: ['gpt-5-nano', 'gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4o-mini', 'o4-mini'],
    adapter: apiAdapter('openai-api', 'provider-http', ['api-key']),
  },
  {
    id: 'groq',
    name: 'Groq (LPU)',
    costModel: 'metered',
    framing: 'Cheap metered — fast open-weight models on LPU hardware',
    description: 'Groq OpenAI-compatible API. Requires GROQ_API_KEY. Default model: llama-3.3-70b-versatile.',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    adapter: apiAdapter('groq-api', 'provider-http', ['api-key']),
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (legacy CLI mode)',
    costModel: 'cli',
    framing: 'Metered through `codex` CLI',
    description: 'Legacy adapter that drives `codex` CLI in non-tube mode.',
    models: ['gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.4'],
    adapter: CODEX_CLI_ADAPTER,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'DeepSeek OpenAI-compatible API. Requires DEEPSEEK_API_KEY. deepseek-chat = V3 general/coder, deepseek-reasoner = R1 reasoning.',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    adapter: apiAdapter('deepseek-api', 'provider-http', ['api-key']),
  },
  {
    id: 'xai',
    name: 'xAI (Grok API)',
    costModel: 'metered',
    framing: 'Metered API — pennies per spawn',
    description: 'xAI (Grok) OpenAI-compatible API. Requires XAI_API_KEY.',
    models: ['grok-2-latest', 'grok-code-fast-1', 'grok-3'],
    adapter: apiAdapter('xai-api', 'provider-http', ['api-key']),
  },

  // ──── Local / free ──────────────────────────────────────────────────────
  {
    id: 'ollama',
    name: 'Ollama (local)',
    costModel: 'local',
    framing: 'FREE — runs on your machine',
    description: 'Local Ollama daemon. Free, but quality depends on your hardware.',
    models: [],
    adapter: localModelServerAdapter('ollama'),
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    costModel: 'local',
    framing: 'FREE — runs on your machine',
    description: 'Local LM Studio server. Serves whatever model is currently loaded in the app.',
    models: ['local-model'],
    adapter: localModelServerAdapter('lmstudio'),
  },
  {
    id: 'aider',
    name: 'Aider',
    costModel: 'cli',
    framing: 'Metered — depends on Aider model config',
    description: 'Drives the `aider` CLI; underlying model provider auth is external.',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5'],
    adapter: AIDER_ADAPTER,
  },
  {
    id: 'custom',
    name: 'Custom command',
    costModel: 'cli',
    framing: 'Cost depends on the command',
    description: 'Run an arbitrary command as a spawn. Operator declares the cost shape.',
    models: ['custom-low', 'custom-mid', 'custom-high'],
    adapter: {
      family: 'custom-command',
      spawn: { transport: 'custom-command' },
      resume: { native: false, scope: 'none' },
      acceptsInitialPrompt: true,
      interactiveChannels: ['none'],
      transcript: { format: 'custom', owner: 'port-daddy', stability: 'internal' },
      authModes: ['custom'],
      limitations: ['Capabilities are operator-declared and remain unverified until a concrete adapter probe exists.'],
    },
  },
];

export interface HarnessAdapterCapabilityRow {
  family: string;
  backendIds: string[];
  spawnTransport: HarnessSpawnTransport;
  spawnCommand: string | null;
  resume: 'session' | 'history' | 'handoff-only';
  resumeCommand: string | null;
  acceptsInitialPrompt: boolean;
  interactiveChannels: string[];
  transcript: string;
  authModes: string[];
  limitations: string[];
}

function formatCommand(command: HarnessCommandTemplate | undefined): string | null {
  if (!command) return null;
  return [command.executable, ...command.args].join(' ');
}

/**
 * Collapse billing/provider routes onto their concrete harness adapter family.
 * This is the N-side of N:N portability: adding a backend implements one
 * adapter contract, never a bespoke bridge to every other backend.
 */
export function harnessAdapterCapabilityRows(
  catalog: readonly BackendCatalogEntry[] = BACKEND_CATALOG,
): HarnessAdapterCapabilityRow[] {
  const rows = new Map<string, HarnessAdapterCapabilityRow>();
  for (const backend of catalog) {
    const adapter = backend.adapter;
    const existing = rows.get(adapter.family);
    if (existing) {
      existing.backendIds.push(backend.id);
      continue;
    }
    rows.set(adapter.family, {
      family: adapter.family,
      backendIds: [backend.id],
      spawnTransport: adapter.spawn.transport,
      spawnCommand: formatCommand(adapter.spawn.command),
      resume: adapter.resume.native && adapter.resume.scope !== 'none'
        ? adapter.resume.scope
        : 'handoff-only',
      resumeCommand: formatCommand(adapter.resume.command),
      acceptsInitialPrompt: adapter.acceptsInitialPrompt,
      interactiveChannels: [...adapter.interactiveChannels],
      transcript: `${adapter.transcript.owner}:${adapter.transcript.format}`,
      authModes: [...adapter.authModes],
      limitations: [...adapter.limitations],
    });
  }
  return [...rows.values()];
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Generated operator/developer view used by ADR-0118 and `pd backend adapters`. */
export function renderHarnessAdapterMarkdown(
  rows: readonly HarnessAdapterCapabilityRow[] = harnessAdapterCapabilityRows(),
): string {
  const lines = [
    '| Adapter family | Backend routes | Spawn | Native resume | Handoff input | Live channel | Transcript | Auth | Known limitation |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const spawn = row.spawnCommand
      ? `\`${row.spawnCommand}\``
      : row.spawnTransport;
    const resume = row.resumeCommand
      ? `${row.resume}: \`${row.resumeCommand}\``
      : row.resume;
    lines.push(
      `| ${markdownCell(row.family)} `
      + `| ${markdownCell(row.backendIds.join(', '))} `
      + `| ${markdownCell(spawn)} `
      + `| ${markdownCell(resume)} `
      + `| ${row.acceptsInitialPrompt ? 'initial prompt' : 'none'} `
      + `| ${markdownCell(row.interactiveChannels.join(', '))} `
      + `| ${markdownCell(row.transcript)} `
      + `| ${markdownCell(row.authModes.join(', '))} `
      + `| ${markdownCell(row.limitations.join(' '))} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Lookup helper. Returns undefined for unknown ids so callers can
 * decide whether to error or fall through.
 */
export function getBackendCatalogEntry(id: string): BackendCatalogEntry | undefined {
  return BACKEND_CATALOG.find((entry) => entry.id === id);
}

/**
 * True for backends whose marginal dollar cost to Port Daddy's wallet is
 * $0 — the operator already pays a flat monthly fee (Claude Max, ChatGPT
 * Pro, a Google/Groq/xAI account) regardless of how many spawns run.
 *
 * This is the SINGLE canonical predicate for "does this launch have a real
 * dollar bond to reserve/accrue" — used by both the fleet Conductor's budget
 * breaker (lib/fleet/conductor.ts effectiveBond: a subscription backend
 * reserves $0 against the lineage/global breaker, so a burst of flat-rate
 * dispatches can never exhaust a real-dollar ceiling) and the Agent Harbor
 * cost-accrual ledger (lib/cost-tracker.ts: a subscription backend never
 * appends a CostAccrualEvent — there is no real spend fact to record).
 *
 * 2026-07-14 incident: the Conductor reserved a nonzero bond floor against
 * every `cli:claude-code`/`cli:codex` dispatch (flat-rate CLI subscriptions),
 * which slowly exhausted the finite global dollar ceiling and permanently
 * refused every subsequent dispatch with GLOBAL_BREAKER — a real-dollar gate
 * governing a $0-marginal-cost backend. An unknown/uncatalogued backend id
 * is treated as metered (fail toward tracking real spend, not toward a free
 * pass on the budget gate).
 */
export function isSubscriptionBackend(id: string): boolean {
  return getBackendCatalogEntry(id)?.costModel === 'subscription';
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

/**
 * Explicit off-switch values for PD_USE_CLI_BACKEND. Setting the env var to
 * one of these disables the forced-CLI override ENTIRELY — including the
 * persisted ~/.port-daddy-cli-backend fallback. This is the only way for a
 * single process (a test run, a one-off spawn) to opt out of an operator's
 * persisted FleetBar selection without deleting the file.
 */
const FORCED_CLI_BACKEND_OFF_VALUES = new Set(['none', 'off', 'disabled', 'disable', '0', 'false']);

function isForcedCliBackendOff(raw: string | undefined | null): boolean {
  if (!raw) return false;
  return FORCED_CLI_BACKEND_OFF_VALUES.has(raw.trim().toLowerCase());
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
  if (normalized === 'agy' || normalized === 'antigravity') return { id: 'cli:agy', value: 'agy' };
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
): { id: string; value: NonNullable<BackendCatalogEntry['pdUseCliBackendValue']>; source: 'env' | 'persisted' } | null {
  // PD_USE_CLI_BACKEND=none (off/disabled/0/false) hard-disables the override:
  // the persisted dotfile is NOT consulted. Without this, a process has no way
  // to escape an operator's ~/.port-daddy-cli-backend selection.
  if (isForcedCliBackendOff(env.PD_USE_CLI_BACKEND)) return null;

  const envMatch = normalizeForcedCliBackend(env.PD_USE_CLI_BACKEND);
  if (envMatch) return { ...envMatch, source: 'env' };

  const hasExplicitPersistedPath = typeof options.persistedPath === 'string';
  const shouldReadDefaultPersistedPath = options.persistedPath === undefined && env === process.env;
  if (!hasExplicitPersistedPath && !shouldReadDefaultPersistedPath) return null;
  const persistedPath = hasExplicitPersistedPath ? options.persistedPath as string : CLI_BACKEND_SELECTION_PATH;

  const persistedMatch = normalizeForcedCliBackend(
    readPersistedCliBackendSelection(persistedPath),
  );
  return persistedMatch ? { ...persistedMatch, source: 'persisted' } : null;
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

export interface EffectiveSpawnBackend {
  requestedBackend: string | null;
  backend: string | null;
  forcedBackend: string | null;
  forcedSource: 'env' | 'persisted' | null;
  forced: boolean;
}

/**
 * Operator-scoped backend override used by both /spawn preflight and the
 * spawner's backend dispatch. Per-spawn env is intentionally not accepted here:
 * a request body must not be able to redirect which local CLI executable runs.
 */
export function resolveEffectiveSpawnBackend(
  requestedBackend: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options: { persistedPath?: string | null } = {},
): EffectiveSpawnBackend {
  const requested = requestedBackend?.trim() || null;
  const forced = detectForcedCliBackendMatch(env, options);
  return {
    requestedBackend: requested,
    backend: forced?.id ?? requested,
    forcedBackend: forced?.id ?? null,
    forcedSource: forced?.source ?? null,
    forced: !!forced,
  };
}
