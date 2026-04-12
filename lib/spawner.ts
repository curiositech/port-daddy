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
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';

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
  model?: string;
  modelTier?: 'low' | 'mid' | 'high';
  identity?: string;   // PD semantic identity: project:stack:context
  purpose?: string;    // human-readable task description
  task: string;        // the prompt / task
  files?: string[];    // for aider backend
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;    // ms, default 300000
  allowedTools?: string;  // for claude-cli backend: tool permission string
  maxTokens?: number;     // for claude/claude-cli backends
}

export interface SpawnResult {
  agentId: string;
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
  outputTokens: number;
  costUsd: number;
  rateMode: 'exact';
}

export interface SpawnedAgent {
  agentId: string;
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
}

interface SpawnerDeps {
  costTracker?: CostTracker;
  counters?: Counters;
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
}

function runChild(opts: ChildRunOpts): Promise<{ output: string; error: string | null; child: ChildProcess }> {
  return new Promise((resolve) => {
    const child = spawnChild(opts.cmd, opts.args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env as NodeJS.ProcessEnv,
      timeout: opts.timeout || 300000,
      shell: false,
      ...(opts.stdio ? { stdio: opts.stdio as any } : {}),
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      const out = stdout.join('');
      const errText = stderr.join('');
      if (code !== 0) {
        resolve({ output: out, error: errText || `${opts.cmd} exited with code ${code}`, child });
      } else {
        resolve({ output: out + (errText ? `\nstderr: ${errText}` : ''), error: null, child });
      }
    });

    child.on('error', (err) => {
      resolve({ output: '', error: `Failed to start ${opts.cmd}: ${err.message}`, child });
    });
  });
}

// =============================================================================
// Backend implementations
// =============================================================================

interface BackendRunResult {
  output: string;
  error: string | null;
  inputTokens?: number;
  outputTokens?: number;
  childProcess?: ChildProcess | null;
}

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
      apiKey: process.env.ANTHROPIC_API_KEY,
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
    })(process.env.GEMINI_API_KEY || '');

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
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || process.env.CF_API_TOKEN;

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

  return { output: text, error: null };
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

function runCodexCli(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const workspace = spec.workdir || process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), 'port-daddy-codex-'));
  const outputPath = join(tempDir, 'last-message.txt');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--full-auto',
    '--sandbox', 'workspace-write',
    '-C', workspace,
    '--output-last-message', outputPath,
    '--model', model,
    spec.task,
  ];

  return runChild({
    cmd: 'codex',
    args,
    cwd: workspace,
    env: {
      ...process.env,
      ...loadDotenvOnce(),
      ...(spec.env || {}),
      OTEL_SDK_DISABLED: 'true',
    },
    timeout: spec.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).then((result) => {
    try {
      const fileOutput = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8').trim() : '';
      if (fileOutput) {
        return { output: fileOutput, error: result.error };
      }
      const sanitized = sanitizeCodexOutput(result.output || '');
      return { output: sanitized, error: result.error };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

function runAider(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const files = spec.files || [];
  return runChild({
    cmd: 'aider',
    args: ['--yes', '--no-stream', '--model', model, '--message', spec.task, ...files],
    cwd: spec.workdir,
    env: { ...process.env, ...loadDotenvOnce(), ...(spec.env || {}) },
    timeout: spec.timeout,
  });
}

function runCustom(spec: SpawnSpec): Promise<BackendRunResult> {
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
  }).then((result) => ({
    ...result,
    childProcess: result.child,
  }));
}

function runClaudeCli(spec: SpawnSpec): Promise<BackendRunResult> {
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
    enforceTelemetryPolicy = true,
    telemetryBypassApproval,
    runnerOverrides = {},
  } = deps;

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
    counters?.bump('spawn.started', dims);

    // Register agent record (running)
    const record: AgentRecord = {
      agentId,
      backend: spec.backend,
      model,
      status: 'running',
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      startedAt,
      completedAt: null,
      heartbeatInterval: null,
      childProcess: null,
    };
    agents.set(agentId, record);

    // PD coordination: register agent
    await pdCoordinate('/agents', {
      id: agentId,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
    });

    // PD coordination: start session
    await pdCoordinate('/sugar/begin', {
      agentId,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
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
        switch (spec.backend) {
          case 'ollama':    result = await runOllama(spec, model); break;
          case 'claude':    result = await runClaude(spec, model); break;
          case 'gemini':    result = await runGemini(spec, model); break;
          case 'cloudflare': result = await runCloudflare(spec, model); break;
          case 'codex':     result = await runCodexCli(spec, model); break;
          case 'claude-cli': result = await runClaudeCli(spec); break;
          case 'aider':     result = await runAider(spec, model); break;
          case 'custom':    result = await runCustom(spec); break;
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
        const outputTokens = result.outputTokens;

        if (inputTokens === undefined || outputTokens === undefined) {
          error = `Exact telemetry required, but ${spec.backend} did not return token counts.`;
          output = null;
        } else if (!costTracker) {
          error = 'Exact telemetry required, but cost tracker is unavailable.';
          output = null;
        } else {
          const computed = costTracker.computeCost(spec.backend, model, inputTokens, outputTokens);
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
              outputTokens,
            });

            if (!recorded || recorded.isEstimate || recorded.costUsd <= 0) {
              error = `Exact telemetry required, but ${spec.backend} telemetry could not be persisted as an exact nonzero cost record.`;
              output = null;
            } else {
              telemetry = {
                inputTokens,
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

    // Common cleanup — runs for both success and failure
    const completedAt = Date.now();
    const status: SpawnResult['status'] = error ? 'failed' : 'completed';

    record.status = status;
    record.completedAt = completedAt;

    if (record.heartbeatInterval) {
      clearInterval(record.heartbeatInterval);
      record.heartbeatInterval = null;
    }

    const doneNote = error ? `Failed: ${error.slice(0, 200)}` : `Completed: ${(output || '').slice(0, 200)}`;
    await pdCoordinate('/sugar/done', { agentId, note: doneNote });

    counters?.bump(error ? 'spawn.failed' : 'spawn.completed', dims);
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

    // Kill child process if present
    if (record.childProcess) {
      try { record.childProcess.kill('SIGTERM'); } catch {}
      record.childProcess = null;
    }

    record.status = 'killed';
    record.completedAt = Date.now();
    counters?.bump('spawn.killed', metricDims({ backend: record.backend, task: '', identity: record.identity || undefined }, record.model));

    // PD coordination: done (fire-and-forget)
    pdCoordinate('/sugar/done', { agentId, note: 'Killed by spawner' }).catch(() => {});
  }

  return { spawn, list, kill };
}

export type Spawner = ReturnType<typeof createSpawner>;
