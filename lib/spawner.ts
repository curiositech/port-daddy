/**
 * Spawner Module — AI Agent Launcher
 *
 * Factory function createSpawner(deps) with methods:
 * - spawn(spec): Launch an AI agent (ollama/claude/gemini/codex/aider/custom)
 * - list(): List active spawned agents
 * - kill(agentId): Stop a spawned agent
 *
 * Auto-wires Port Daddy coordination (register/session/heartbeat/done) silently.
 */

import { randomBytes } from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CostTracker } from './cost-tracker.js';
import type { Counters } from './counters.js';
import type { Bonds } from './bonds.js';
import type { Harbors } from './harbors.js';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { getSecret } from './secret-env.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';
import { deriveAgentDisplayName } from './agent-names.js';

// ─── Load .env.local for spawned agents ─────────────────────────────────────
// The daemon runs via launchd which has no shell env. Spawned agents need
// API keys that live in .env.local. Load once at module init.
// Only load from trusted locations: project root and home directory.
const __spawner_dirname = dirname(fileURLToPath(import.meta.url));
const _dotenvCache: Record<string, string> = {};
function loadDotenvOnce(): Record<string, string> {
  if (Object.keys(_dotenvCache).length > 0) return _dotenvCache;
  // Only two trusted locations: project root and home directory
  const searchDirs = [
    join(__spawner_dirname, '..'),  // project root (parent of lib/)
    process.env.HOME || '',         // home directory
  ];
  const currentUid = process.getuid?.();
  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const name of ['.env.local', '.env']) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      // Verify file ownership — skip files not owned by current user
      if (currentUid !== undefined) {
        try {
          const st = statSync(p);
          if (st.uid !== currentUid) {
            console.warn(`[spawner] Skipping ${p}: owned by uid ${st.uid}, expected ${currentUid}`);
            continue;
          }
        } catch {
          continue; // stat failed — skip
        }
      }
      try {
        const lines = readFileSync(p, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq < 1) continue;
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          _dotenvCache[key] = val;
        }
      } catch { /* ignore read errors */ }
    }
  }
  return _dotenvCache;
}

// =============================================================================
// Types
// =============================================================================

export interface SpawnSpec {
  backend: 'ollama' | 'claude' | 'claude-cli' | 'gemini' | 'cloudflare' | 'codex' | 'aider' | 'custom';
  name?: string;        // human-readable display name
  model?: string;
  modelTier?: 'low' | 'mid' | 'high';
  identity?: string;   // PD semantic identity: project:stack:context
  purpose?: string;    // human-readable task description
  task: string;        // the prompt / task
  bondUsd?: number;    // per-spawn bond; slashed on misbehavior, refunded on clean exit
  harborName?: string; // optional override for bond-admission harbor
  files?: string[];    // for aider backend
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;    // ms, default 300000
  allowedTools?: string;  // for claude-cli backend: tool permission string
  maxTokens?: number;     // for claude/claude-cli backends
}

export interface SpawnResult {
  agentId: string;
  name?: string;
  backend: SpawnSpec['backend'];
  model: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  output: string | null;
  error: string | null;
  telemetry: SpawnTelemetry | null;
  startedAt: number;
  completedAt: number | null;
}

export interface SpawnTelemetry {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  costUsd: number;
  rateMode: 'exact';
}

export interface SpawnedAgent {
  agentId: string;
  name: string;
  backend: SpawnSpec['backend'];
  model: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  identity: string | null;
  purpose: string | null;
  startedAt: number;
  completedAt: number | null;
}

export interface TelemetryBypassApproval {
  humanConfirmed: true;
  confirmedBy: string;
  reason: string;
}

// Internal tracking record
interface AgentRecord extends SpawnedAgent {
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  childProcess: ChildProcess | null;
  bondId?: number | null;
  bondUsd?: number;
}

interface SpawnerDeps {
  costTracker?: CostTracker;
  counters?: Counters;
  bonds?: Bonds;
  harbors?: Harbors;
  enforceTelemetryPolicy?: boolean;
  telemetryBypassApproval?: TelemetryBypassApproval;
  runnerOverrides?: Partial<Record<SpawnSpec['backend'], (spec: SpawnSpec, model: string) => Promise<BackendRunResult>>>;
}

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD_RED = '\x1b[1;31m';
const ANSI_BANNER_RED = '\x1b[1;97;41m';
const telemetryBypassWarnings = new Set<string>();

function requireTelemetryBypassApproval(approval?: TelemetryBypassApproval): asserts approval is TelemetryBypassApproval {
  const confirmedBy = approval?.confirmedBy?.trim();
  const reason = approval?.reason?.trim();
  if (approval?.humanConfirmed === true && confirmedBy && reason) {
    return;
  }

  throw new Error([
    `${ANSI_BANNER_RED} TELEMETRY BYPASS REJECTED ${ANSI_RESET}`,
    `${ANSI_BOLD_RED}HITL confirmation is required to create a spawner with enforceTelemetryPolicy:false.${ANSI_RESET}`,
    'Pass telemetryBypassApproval: { humanConfirmed: true, confirmedBy: "<human>", reason: "<why this bypass is acceptable>" }.',
  ].join('\n'));
}

function warnTelemetryBypass(approval: TelemetryBypassApproval): void {
  const confirmedBy = approval.confirmedBy.trim();
  const reason = approval.reason.trim();
  const warningKey = `${confirmedBy}:${reason}`;
  if (telemetryBypassWarnings.has(warningKey)) return;
  telemetryBypassWarnings.add(warningKey);
  console.error([
    `${ANSI_BANNER_RED} TELEMETRY BYPASS ACTIVE ${ANSI_RESET}`,
    `${ANSI_BOLD_RED}Operator launches are running with enforceTelemetryPolicy:false.${ANSI_RESET}`,
    `confirmedBy=${confirmedBy}`,
    `reason=${reason}`,
  ].join('\n'));
}

// =============================================================================
// PD coordination helpers (fire-and-forget, silent on failure)
// =============================================================================

async function pdCoordinate(path: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${getDaemonTcpUrl(process.env.PORT_DADDY_URL)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Silent — coordination failures never block spawning
  }
}

// =============================================================================
// Shared child-process runner (eliminates 3x copy-paste)
// =============================================================================

interface ChildRunOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  stdio?: ('ignore' | 'pipe')[];
  onChild?: (child: ChildProcess) => void;
}

function runChild(opts: ChildRunOpts): Promise<{ output: string; error: string | null; child: ChildProcess }> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeout || 300000;
    const child = spawnChild(opts.cmd, opts.args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env as NodeJS.ProcessEnv,
      timeout: timeoutMs,
      detached: true,
      shell: false,
      ...(opts.stdio ? { stdio: opts.stdio as any } : {}),
    });
    opts.onChild?.(child);

    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalChildProcess(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        signalChildProcess(child, 'SIGKILL');
      }, 5000);
      forceKillTimer.unref?.();
    }, Math.max(1, timeoutMs - 25));
    timeoutTimer.unref?.();

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const out = stdout.join('');
      const errText = stderr.join('');
      if (timedOut) {
        resolve({ output: out, error: `${opts.cmd} timed out after ${timeoutMs}ms${errText ? `: ${errText}` : ''}`, child });
      } else if (code !== 0) {
        resolve({ output: out, error: errText || `${opts.cmd} exited with code ${code}`, child });
      } else {
        resolve({ output: out + (errText ? `\nstderr: ${errText}` : ''), error: null, child });
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ output: '', error: `Failed to start ${opts.cmd}: ${err.message}`, child });
    });
  });
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back below for non-detached/mocked processes.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best-effort termination; the close/error handlers own final state.
  }
}

function terminateChildProcess(child: ChildProcess): void {
  signalChildProcess(child, 'SIGTERM');
  const forceKillTimer = setTimeout(() => {
    signalChildProcess(child, 'SIGKILL');
  }, 5000);
  forceKillTimer.unref?.();
}

// =============================================================================
// Backend implementations
// =============================================================================

interface BackendRunResult {
  output: string;
  error: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  childProcess?: ChildProcess | null;
}

interface BackendRunContext {
  onChildProcess?: (child: ChildProcess) => void;
}

interface CodexUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

const CODEX_DAEMON_CONTEXT_ENV_KEYS = [
  'CODEX_THREAD_ID',
] as const;

async function runOllama(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: spec.task }],
      stream: false,
    }),
    signal: spec.timeout ? AbortSignal.timeout(spec.timeout) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown error');
    return { output: '', error: `Ollama HTTP ${res.status}: ${text}` };
  }

  const data = await res.json() as Record<string, unknown>;
  const message = (data.message as Record<string, unknown> | undefined)?.content as string || '';
  return { output: message, error: null };
}

async function runClaude(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  // Dynamic import with graceful fallback — use Function to avoid static analysis
  // of the module specifier (so tsc doesn't error on a missing optional dep)
  let Anthropic: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const m = await (new Function('s', 'return import(s)'))('@anthropic-ai/sdk') as { default: unknown };
    Anthropic = m.default;
  } catch {
    return { output: '', error: '@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk' };
  }

  try {
    const client = new (Anthropic as new (opts?: { apiKey?: string }) => {
      messages: {
        create(opts: Record<string, unknown>): Promise<{
          content: Array<{ text: string }>;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
          };
        }>;
      };
    })({
      apiKey: getSecret('ANTHROPIC_API_KEY'),
    });

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: spec.task }],
    });

    const text = response.content.map((c) => c.text).join('');
    return {
      output: text,
      error: null,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  } catch (err) {
    return { output: '', error: (err as Error).message };
  }
}

async function runGemini(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  let GoogleGenerativeAI: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const m = await (new Function('s', 'return import(s)'))('@google/generative-ai') as { GoogleGenerativeAI: unknown };
    GoogleGenerativeAI = m.GoogleGenerativeAI;
  } catch {
    return { output: '', error: '@google/generative-ai is not installed. Run: npm install @google/generative-ai' };
  }

  try {
    const genAI = new (GoogleGenerativeAI as new (apiKey: string) => {
      getGenerativeModel(opts: { model: string }): {
        generateContent(prompt: string): Promise<{
          response: { text(): string };
        }>;
      };
    })(getSecret('GEMINI_API_KEY') || '');

    const geminiModel = genAI.getGenerativeModel({ model });
    const result = await geminiModel.generateContent(spec.task);
    const text = result.response.text();
    return { output: text, error: null };
  } catch (err) {
    return { output: '', error: (err as Error).message };
  }
}

async function runCloudflare(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const token = getSecret('CLOUDFLARE_API_TOKEN')
    || getSecret('CLOUDFLARE_API_KEY')
    || getSecret('CF_API_TOKEN');

  if (!accountId) {
    return { output: '', error: 'CLOUDFLARE_ACCOUNT_ID is not set' };
  }
  if (!token) {
    return { output: '', error: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY is not set' };
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: spec.task }],
      max_tokens: spec.maxTokens,
      stream: false,
    }),
    signal: spec.timeout ? AbortSignal.timeout(spec.timeout) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown error');
    return { output: '', error: `Cloudflare Workers AI HTTP ${res.status}: ${text}` };
  }

  const data = await res.json() as Record<string, any>;
  const result = data.result ?? data;
  const usage = extractCloudflareUsage(result, data);
  const text = typeof result === 'string'
    ? result
    : result?.response
      || result?.text
      || result?.output_text
      || result?.choices?.[0]?.message?.content
      || '';

  if (!text) {
    return { output: '', error: 'Cloudflare Workers AI returned no text response' };
  }

  return {
    output: text,
    error: null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function normalizeCloudflareTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function extractCloudflareUsage(result: unknown, data: Record<string, any>): Pick<BackendRunResult, 'inputTokens' | 'outputTokens'> {
  const resultUsage = (
    result
    && typeof result === 'object'
    && 'usage' in result
  )
    ? (result as { usage?: Record<string, unknown> }).usage
    : undefined;
  const usage = resultUsage || data.usage;
  if (!usage || typeof usage !== 'object') return {};

  const record = usage as Record<string, unknown>;
  const inputTokens = normalizeCloudflareTokenCount(
    record.prompt_tokens ?? record.input_tokens ?? record.inputTokens,
  );
  let outputTokens = normalizeCloudflareTokenCount(
    record.completion_tokens ?? record.output_tokens ?? record.outputTokens,
  );
  const totalTokens = normalizeCloudflareTokenCount(record.total_tokens ?? record.totalTokens);
  if (outputTokens === undefined && inputTokens !== undefined && totalTokens !== undefined) {
    outputTokens = Math.max(0, totalTokens - inputTokens);
  }

  return { inputTokens, outputTokens };
}

function sanitizeCodexOutput(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed === 'codex') return false;
      if (/^OpenAI Codex\b/i.test(trimmed)) return false;
      if (/^(model|provider|approval|sandbox|reasoning effort|session id|workdir):/i.test(trimmed)) return false;
      if (/^\d[\d,]*\s+total tokens used$/i.test(trimmed)) return false;
      if (/^tokens used$/i.test(trimmed)) return false;
      if (/^-{4,}$/.test(trimmed)) return false;
      return true;
    });

  return lines.join('\n').trim();
}

function parseCodexUsage(raw: string): CodexUsage {
  let usage: CodexUsage = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        usage?: {
          input_tokens?: unknown;
          cached_input_tokens?: unknown;
          output_tokens?: unknown;
        };
      };
      if (event.type !== 'turn.completed' || !event.usage) continue;

      usage = {
        inputTokens: typeof event.usage.input_tokens === 'number' ? event.usage.input_tokens : undefined,
        cachedInputTokens: typeof event.usage.cached_input_tokens === 'number' ? event.usage.cached_input_tokens : undefined,
        outputTokens: typeof event.usage.output_tokens === 'number' ? event.usage.output_tokens : undefined,
      };
    } catch {
      // runChild may append stderr to stdout; non-JSON lines are not usage.
    }
  }

  return usage;
}

function parseCodexError(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        message?: unknown;
        error?: { message?: unknown };
      };
      if (event.type === 'error' && typeof event.message === 'string') {
        return event.message;
      }
      if (event.type === 'turn.failed' && typeof event.error?.message === 'string') {
        return event.error.message;
      }
    } catch {
      // Non-JSON stdout lines are not Codex structured errors.
    }
  }
  return null;
}

function runCodexCli(spec: SpawnSpec, model: string, context?: BackendRunContext): Promise<BackendRunResult> {
  const workspace = spec.workdir || process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), 'port-daddy-codex-'));
  const outputPath = join(tempDir, 'last-message.txt');
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...loadDotenvOnce(),
    ...(spec.env || {}),
    OTEL_SDK_DISABLED: 'true',
  };
  for (const key of CODEX_DAEMON_CONTEXT_ENV_KEYS) {
    delete env[key];
  }
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--full-auto',
    '--sandbox', 'workspace-write',
    '-C', workspace,
    '--output-last-message', outputPath,
    '--model', model,
    '--json',
    spec.task,
  ];

  return runChild({
    cmd: 'codex',
    args,
    cwd: workspace,
    env,
    timeout: spec.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    onChild: context?.onChildProcess,
  }).then((result) => {
    try {
      const usage = parseCodexUsage(result.output || '');
      const structuredError = parseCodexError(result.output || '');
      const error = structuredError ? `Codex CLI failed: ${structuredError}` : result.error;
      const fileOutput = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8').trim() : '';
      if (fileOutput) {
        return { output: fileOutput, error, ...usage };
      }
      const sanitized = sanitizeCodexOutput(result.output || '');
      return { output: sanitized, error, ...usage };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

function runAider(spec: SpawnSpec, model: string, context?: BackendRunContext): Promise<BackendRunResult> {
  const files = spec.files || [];
  return runChild({
    cmd: 'aider',
    args: ['--yes', '--no-stream', '--model', model, '--message', spec.task, ...files],
    cwd: spec.workdir,
    env: { ...process.env, ...loadDotenvOnce(), ...(spec.env || {}) },
    timeout: spec.timeout,
    onChild: context?.onChildProcess,
  });
}

function runCustom(spec: SpawnSpec, context?: BackendRunContext): Promise<BackendRunResult> {
  // Reject shell injection: metacharacters, newlines, control chars
  const DANGEROUS_PATTERNS = /[;&|`$(){}!<>\n\r\t\x00-\x1f\x7f]/;
  if (DANGEROUS_PATTERNS.test(spec.task)) {
    return Promise.resolve({
      output: '',
      error: 'Command contains shell metacharacters or control characters. Use explicit arguments instead of shell syntax.',
      childProcess: null,
    });
  }

  return runChild({
    cmd: '/bin/sh',
    args: ['-c', spec.task],
    cwd: spec.workdir,
    env: {
      ...process.env,
      ...loadDotenvOnce(),
      ...(spec.env || {}),
      PD_BACKEND: spec.backend,
      PORT_DADDY_BACKEND: spec.backend,
      PD_MODEL: spec.model,
      PORT_DADDY_MODEL: spec.model,
      PD_MODEL_TIER: spec.modelTier,
      PORT_DADDY_MODEL_TIER: spec.modelTier,
    },
    timeout: spec.timeout,
    onChild: context?.onChildProcess,
  }).then((result) => ({
    ...result,
    childProcess: result.child,
  }));
}

function runClaudeCli(spec: SpawnSpec, context?: BackendRunContext): Promise<BackendRunResult> {
  const args = ['-p', spec.task];
  if (spec.model) {
    args.push('--model', spec.model);
  }
  if (spec.allowedTools) {
    args.push('--allowedTools', spec.allowedTools);
  }

  // Strip ANTHROPIC_API_KEY from BOTH dotenv AND process.env before passing to
  // the claude subprocess. The claude CLI manages its own authentication (OAuth).
  // Any ANTHROPIC_API_KEY in the environment overrides OAuth and causes
  // "Invalid API key" when the key is wrong, stale, or for a different account.
  // Explicit user-provided keys via spec.env are still respected (spread last).
  const { ANTHROPIC_API_KEY: _dropped, ...dotenvSafe } = loadDotenvOnce();
  const { ANTHROPIC_API_KEY: _droppedEnv, ...processEnvSafe } = process.env;

  // Ensure ~/.local/bin is in PATH for claude binary discovery
  const homeBin = join(process.env.HOME || '', '.local', 'bin');
  const currentPath = process.env.PATH || '';
  const augmentedPath = currentPath.includes('.local/bin') ? currentPath : `${homeBin}:${currentPath}`;

  return runChild({
    cmd: 'claude',
    args,
    cwd: spec.workdir,
    env: { ...processEnvSafe, ...dotenvSafe, ...(spec.env || {}), PATH: augmentedPath },
    timeout: spec.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    onChild: context?.onChildProcess,
  });
}

// =============================================================================
// Default models per backend
// =============================================================================

const DEFAULT_MODELS: Record<SpawnSpec['backend'], string> = {
  ollama: 'llama3.1:8b',
  claude: 'claude-haiku-4-5-20251001',
  'claude-cli': 'claude-cli',  // claude CLI manages its own model
  gemini: 'gemini-2.0-flash-exp',
  cloudflare: '@cf/meta/llama-3.1-8b-instruct',
  codex: 'gpt-5.4-mini',
  aider: 'aider',   // aider manages its own model selection
  custom: 'custom',
};

// =============================================================================
// Module factory
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function createSpawner(deps: SpawnerDeps = {}) {
  // In-memory registry of active spawned agents
  const agents = new Map<string, AgentRecord>();
  const {
    costTracker,
    counters,
    bonds,
    harbors,
    enforceTelemetryPolicy = true,
    telemetryBypassApproval,
    runnerOverrides = {},
  } = deps;

  // Default bond per spawn when caller doesn't specify one. Tunable via
  // SpawnSpec.bondUsd; a misbehaving agent slashes this, a clean exit refunds.
  // Small enough to not block normal fleet operation, large enough to matter.
  const DEFAULT_BOND_USD = 0.01;

  if (!enforceTelemetryPolicy) {
    requireTelemetryBypassApproval(telemetryBypassApproval);
    warnTelemetryBypass(telemetryBypassApproval);
  }

  /** Hard ceiling on concurrent running agents. Prevents fork bombs.
   *  Fleet YAML limits are per-project; this is the global safety net.
   *  Set high enough for normal fleet operation (8 agents + manual spawns)
   *  but low enough to prevent a runaway trigger from eating all PIDs. */
  const MAX_CONCURRENT_RUNNING = 20;

  const MAX_AGENT_RECORDS = 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  /**
   * Remove completed/failed/killed agents older than 1 hour,
   * and enforce a hard cap of MAX_AGENT_RECORDS entries.
   */
  function cleanupStaleAgents(): void {
    const cutoff = Date.now() - ONE_HOUR;
    for (const [id, record] of agents) {
      if (record.completedAt && record.completedAt < cutoff) {
        agents.delete(id);
      }
    }

    // Hard cap — evict oldest completed entries first
    if (agents.size > MAX_AGENT_RECORDS) {
      const completed = [...agents.entries()]
        .filter(([, r]) => r.completedAt)
        .sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0));
      for (const [id] of completed.slice(0, agents.size - MAX_AGENT_RECORDS)) {
        agents.delete(id);
      }
    }
  }

  function getProjectName(identity?: string): string | undefined {
    if (!identity) return undefined;
    const [projectName] = identity.split(':');
    return projectName || undefined;
  }

  function metricDims(spec: SpawnSpec, model: string): Record<string, string> {
    const dims: Record<string, string> = {
      backend: spec.backend,
      model,
    };
    const projectName = getProjectName(spec.identity);
    if (projectName) dims.project = projectName;
    return dims;
  }

  /**
   * Spawn an AI agent with the given spec.
   * Automatically wires PD session + heartbeat + done.
   */
  async function spawn(spec: SpawnSpec): Promise<SpawnResult> {
    cleanupStaleAgents();

    // Hard global limit — never exceed MAX_CONCURRENT_RUNNING processes
    const running = [...agents.values()].filter(a => a.status === 'running').length;
    const model = spec.model || DEFAULT_MODELS[spec.backend];
    const dims = metricDims(spec, model);
    const blockedResult = (error: string): SpawnResult => ({
      agentId: 'blocked',
      backend: spec.backend,
      model,
      status: 'failed',
      output: null,
      error,
      telemetry: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
    });
    if (running >= MAX_CONCURRENT_RUNNING) {
      counters?.bump('spawn.blocked', dims);
      return blockedResult(`Spawn blocked: ${running} agents already running (limit: ${MAX_CONCURRENT_RUNNING}). Wait for one to finish.`);
    }

    if (!enforceTelemetryPolicy) {
      counters?.bump('spawn.telemetry_bypass', dims);
    }

    if (enforceTelemetryPolicy) {
      if (!costTracker) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult('Spawn blocked: cost tracker unavailable under fail-closed telemetry policy.');
      }

      const telemetryPolicy = assessBackendTelemetryPolicy(spec.backend, model);
      if (!telemetryPolicy.launchAllowed) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(`Spawn blocked: ${telemetryPolicy.summary}`);
      }
    }

    const agentId = `spawned-${randomBytes(6).toString('hex')}`;
    const startedAt = Date.now();
    const projectName = getProjectName(spec.identity);
    const defaultHarborName = projectName ? `${projectName}:fleet` : undefined;
    const harborName = spec.harborName || defaultHarborName;
    const displayName = deriveAgentDisplayName({
      name: spec.name,
      purpose: spec.purpose,
      identity: spec.identity,
      backend: spec.backend,
      fallback: agentId,
    });
    counters?.bump('spawn.started', dims);

    // Block until the project has a daily budget set. Without a budget,
    // the kill-switch has no number to enforce against — a spawn here
    // could burn unbounded cost. Refuse and point the operator at the fix.
    // No-wallet projects get a null budget on first escrow; we block both.
    if (bonds && projectName) {
      const budget = bonds.getBudget(projectName);
      if (budget == null) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(
          `Spawn blocked: project '${projectName}' has no daily budget set. ` +
          `Run: pd wallet budget ${projectName} --usd-per-day <N>`,
        );
      }
    }

    // Escrow bond BEFORE any spawn work. If the wallet is insufficient OR
    // bonds aren't wired, we refuse here rather than run an unbonded agent —
    // the Ostrom "rule-monitoring" invariant: every running agent has a bond.
    const bondUsd = spec.bondUsd ?? DEFAULT_BOND_USD;
    let bondId: number | null = null;
    let enteredHarborName: string | null = null;
    if (harbors && projectName && bondUsd > 0) {
      if (!harborName) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult('Spawn blocked: harbor admission requires a project harbor name.');
      }

      const existingHarbor = harbors.get(harborName);
      if (!existingHarbor) {
        const created = harbors.create(harborName, {
          scope: projectName,
          capabilities: ['spawn:agent'],
          channels: ['agents', 'spawn'],
          agentPatterns: [`${projectName}:*`],
          metadata: { owner: 'spawner', purpose: 'spawn bond admission' },
        });
        if (!created.success) {
          counters?.bump('spawn.blocked', dims);
          return blockedResult(`Spawn blocked: could not create harbor '${harborName}' (${created.error || 'unknown error'}).`);
        }
      }

      const entered = await harbors.enter(harborName, agentId, {
        identity: spec.identity,
        capabilities: ['spawn:agent', `backend:${spec.backend}`],
      });
      if (!entered.success) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(`Spawn blocked: could not enter harbor '${harborName}' (${entered.error || 'unknown error'}).`);
      }
      enteredHarborName = harborName;
    }

    if (bonds && projectName && bondUsd > 0) {
      try {
        const receipt = bonds.escrow({
          project: projectName,
          agentId,
          archetype: spec.backend,
          bondUsd,
          harborName: enteredHarborName ?? harborName,
        });
        if (!receipt || !receipt.ok) {
          counters?.bump('spawn.blocked', dims);
          if (enteredHarborName && harbors) {
            try { harbors.leaveAll(agentId); } catch {}
            enteredHarborName = null;
          }
          return blockedResult(
            `Spawn blocked: could not escrow $${bondUsd.toFixed(4)} bond for project '${projectName}' (${receipt?.reason || 'unknown'})`,
          );
        }
        bondId = receipt.id ?? null;
      } catch (err) {
        counters?.bump('spawn.blocked', dims);
        if (enteredHarborName && harbors) {
          try { harbors.leaveAll(agentId); } catch {}
          enteredHarborName = null;
        }
        return blockedResult(`Spawn blocked: bond escrow threw — ${(err as Error).message}`);
      }
    }

    // Register agent record (running)
    const record: AgentRecord = {
      agentId,
      name: displayName,
      backend: spec.backend,
      model,
      status: 'running',
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      startedAt,
      completedAt: null,
      heartbeatInterval: null,
      childProcess: null,
      bondId,
      bondUsd,
    };
    agents.set(agentId, record);

    // Transition bond: escrowed → running. The markRunning call is what
    // cost-tracker's budget-guard hook looks at — bond must be 'running'
    // before any charge can slash it.
    if (bonds && bondId) {
      try { bonds.markRunning(bondId); } catch {}
    }

    // PD coordination: register agent
    const coordinationMetadata = {
      spawn: true,
      requiresEscrow: true,
      projectName: projectName ?? null,
      bondId,
      bondUsd,
    };

    await pdCoordinate('/agents', {
      id: agentId,
      name: displayName,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      metadata: coordinationMetadata,
    });

    // PD coordination: start session
    await pdCoordinate('/sugar/begin', {
      agentId,
      name: displayName,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      metadata: coordinationMetadata,
    });

    // Start heartbeat interval
    record.heartbeatInterval = setInterval(async () => {
      await pdCoordinate(`/agents/${agentId}/heartbeat`, {});
    }, 30000);
    record.heartbeatInterval.unref?.();

    let output: string | null = null;
    let error: string | null = null;
    let telemetry: SpawnTelemetry | null = null;

    try {
      const override = runnerOverrides[spec.backend];
      let result: BackendRunResult;

      if (override) {
        result = await override(spec, model);
      } else {
        const childContext: BackendRunContext = {
          onChildProcess: (child) => {
            if (record.status === 'running') {
              record.childProcess = child;
            }
          },
        };
        switch (spec.backend) {
          case 'ollama':    result = await runOllama(spec, model); break;
          case 'claude':    result = await runClaude(spec, model); break;
          case 'gemini':    result = await runGemini(spec, model); break;
          case 'cloudflare': result = await runCloudflare(spec, model); break;
          case 'codex':     result = await runCodexCli(spec, model, childContext); break;
          case 'claude-cli': result = await runClaudeCli(spec, childContext); break;
          case 'aider':     result = await runAider(spec, model, childContext); break;
          case 'custom':    result = await runCustom(spec, childContext); break;
          default:
            result = { output: '', error: `Unknown backend: ${String(spec.backend)}` };
        }
      }

      if (result.childProcess) {
        record.childProcess = result.childProcess;
      }

      output = result.output || null;
      error = result.error;

      if (!error && enforceTelemetryPolicy) {
        const inputTokens = result.inputTokens;
        const cachedInputTokens = result.cachedInputTokens;
        const outputTokens = result.outputTokens;

        if (inputTokens === undefined || outputTokens === undefined) {
          error = `Exact telemetry required, but ${spec.backend} did not return token counts.`;
          output = null;
        } else if (!costTracker) {
          error = 'Exact telemetry required, but cost tracker is unavailable.';
          output = null;
        } else {
          const computed = cachedInputTokens === undefined
            ? costTracker.computeCost(spec.backend, model, inputTokens, outputTokens)
            : costTracker.computeCost(spec.backend, model, inputTokens, outputTokens, cachedInputTokens);
          if (computed.isEstimate) {
            error = `Exact telemetry required, but ${spec.backend} cost calculation fell back to an estimate.`;
            output = null;
          } else if (computed.costUsd <= 0) {
            error = `Exact telemetry required, but ${spec.backend} produced a non-positive cost.`;
            output = null;
          } else {
            const recorded = costTracker.record({
              backend: spec.backend,
              model,
              projectName,
              projectDir: spec.workdir ? resolve(spec.workdir) : undefined,
              identity: spec.identity,
              spawnId: agentId,
              inputTokens,
              ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
              outputTokens,
            });

            if (!recorded || recorded.isEstimate || recorded.costUsd <= 0) {
              error = `Exact telemetry required, but ${spec.backend} telemetry could not be persisted as an exact nonzero cost record.`;
              output = null;
            } else {
              telemetry = {
                inputTokens,
                ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
                outputTokens,
                costUsd: recorded.costUsd,
                rateMode: 'exact',
              };
            }
          }
        }
      }
    } catch (err) {
      error = (err as Error).message;
    }

    // Common cleanup — runs for success, failure, and asynchronous kill.
    const wasKilled = record.status === 'killed';
    if (wasKilled) {
      error = 'Killed by spawner';
      output = null;
    }
    const completedAt = record.completedAt ?? Date.now();
    const status: SpawnResult['status'] = wasKilled ? 'killed' : error ? 'failed' : 'completed';

    record.status = status;
    record.completedAt = completedAt;
    record.childProcess = null;

    if (record.heartbeatInterval) {
      clearInterval(record.heartbeatInterval);
      record.heartbeatInterval = null;
    }
    if (enteredHarborName && harbors) {
      try { harbors.leaveAll(agentId); } catch {}
      enteredHarborName = null;
    }

    if (!wasKilled) {
      const doneNote = error ? `Failed: ${error.slice(0, 200)}` : `Completed: ${(output || '').slice(0, 200)}`;
      await pdCoordinate('/sugar/done', { agentId, note: doneNote });
    }

    // Resolve bond. Clean exit → full refund; error → slash full bond with reason.
    // Why slash on any error: an error means the spawn didn't do its job; the
    // commons pool absorbs the cost so the operator doesn't eat it silently.
    if (bonds && bondId) {
      try {
        if (wasKilled) {
          // kill() already resolves the bond as an operator intervention.
        } else if (error) {
          bonds.slash(bondId, bondUsd, `spawn-failed: ${error.slice(0, 120)}`);
        } else {
          bonds.refund(bondId);
        }
      } catch {
        // bond resolution failures are logged but never fail the spawn path
      }
    }

    if (!wasKilled) {
      counters?.bump(error ? 'spawn.failed' : 'spawn.completed', dims);
    }
    if (!error) {
      counters?.bump('spawn.duration_ms', dims, Math.max(1, completedAt - startedAt));
    }
    if (!enforceTelemetryPolicy) {
      costTracker?.record({
        backend: spec.backend,
        model,
        projectName,
        projectDir: spec.workdir ? resolve(spec.workdir) : undefined,
        identity: spec.identity,
        spawnId: agentId,
      });
    }

    return {
      agentId,
      name: displayName,
      backend: spec.backend,
      model,
      status,
      output,
      error,
      telemetry,
      startedAt,
      completedAt,
    };
  }

  /**
   * List all active (and recently completed) spawned agents.
   */
  function list(): SpawnedAgent[] {
    cleanupStaleAgents();
    return Array.from(agents.values()).map((r) => ({
      agentId: r.agentId,
      name: r.name,
      backend: r.backend,
      model: r.model,
      status: r.status,
      identity: r.identity,
      purpose: r.purpose,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
  }

  /**
   * Stop a running spawned agent.
   */
  function kill(agentId: string): void {
    const record = agents.get(agentId);
    if (!record) return;

    // Clean up heartbeat
    if (record.heartbeatInterval) {
      clearInterval(record.heartbeatInterval);
      record.heartbeatInterval = null;
    }
    try {
      harbors?.leaveAll(agentId);
    } catch {}

    // Kill child process if present
    if (record.childProcess) {
      terminateChildProcess(record.childProcess);
      record.childProcess = null;
    }

    record.status = 'killed';
    record.completedAt = Date.now();
    counters?.bump('spawn.killed', metricDims({ backend: record.backend, task: '', identity: record.identity || undefined }, record.model));

    // Kill is an intervention, not a clean exit — slash the bond so the
    // commons pool captures the cost of the decision. Panic path calls
    // bonds.refund separately (operator action, not misbehavior) BEFORE
    // invoking kill, so by the time we get here the bond is either already
    // resolved (no-op) or this is a real kill-for-cause.
    if (bonds && record.bondId) {
      try {
        bonds.slash(record.bondId, record.bondUsd || 0, 'killed-by-spawner');
      } catch {}
    }

    // PD coordination: done (fire-and-forget)
    pdCoordinate('/sugar/done', { agentId, note: 'Killed by spawner' }).catch(() => {});
  }

  return { spawn, list, kill };
}

export type Spawner = ReturnType<typeof createSpawner>;
