/**
 * Spawner Module — AI Agent Launcher
 *
 * Factory function createSpawner(deps) with methods:
 * - spawn(spec): Launch an AI agent (ollama/claude/gemini/aider/custom)
 * - list(): List active spawned agents
 * - kill(agentId): Stop a spawned agent
 *
 * Auto-wires Port Daddy coordination (register/session/heartbeat/done) silently.
 */

import { randomBytes } from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Load .env.local for spawned agents ─────────────────────────────────────
// The daemon runs via launchd which has no shell env. Spawned agents need
// API keys that live in .env.local. Load once at module init.
// Derive module directory without import.meta.url (breaks Jest ESM mocks)
const _dotenvCache: Record<string, string> = {};
function loadDotenvOnce(): Record<string, string> {
  if (Object.keys(_dotenvCache).length > 0) return _dotenvCache;
  // Search multiple locations: cwd, project root, the dev checkout, home dir
  const searchDirs = [
    process.cwd(),
    join(process.cwd(), '..'),                         // parent of cwd (worktree -> repo)
    join(process.env.HOME || '', 'coding/port-daddy'), // dev checkout (worktree source)
    process.env.HOME || '',
  ];
  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const name of ['.env.local', '.env']) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
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
  backend: 'ollama' | 'claude' | 'claude-cli' | 'gemini' | 'aider' | 'custom';
  model?: string;
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
  startedAt: number;
  completedAt: number | null;
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

// Internal tracking record
interface AgentRecord extends SpawnedAgent {
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  childProcess: ChildProcess | null;
}

// =============================================================================
// PD coordination helpers (fire-and-forget, silent on failure)
// =============================================================================

const PD_URL = process.env.PORT_DADDY_URL || 'http://localhost:9876';

async function pdCoordinate(path: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${PD_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Silent — coordination failures never block spawning
  }
}

// =============================================================================
// Backend implementations
// =============================================================================

async function runOllama(spec: SpawnSpec, model: string): Promise<{ output: string; error: string | null }> {
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

async function runClaude(spec: SpawnSpec, model: string): Promise<{ output: string; error: string | null }> {
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
        create(opts: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }>;
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
    return { output: text, error: null };
  } catch (err) {
    return { output: '', error: (err as Error).message };
  }
}

async function runGemini(spec: SpawnSpec, model: string): Promise<{ output: string; error: string | null }> {
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

function runAider(spec: SpawnSpec): Promise<{ output: string; error: string | null }> {
  return new Promise((resolve) => {
    const files = spec.files || [];
    const args = ['--yes', '--no-stream', '--message', spec.task, ...files];

    const child = spawnChild('aider', args, {
      cwd: spec.workdir || process.cwd(),
      env: { ...process.env, ...loadDotenvOnce(), ...(spec.env || {}) },
      timeout: spec.timeout || 300000,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      const output = stdout.join('');
      const errText = stderr.join('');
      if (code !== 0) {
        resolve({ output, error: errText || `aider exited with code ${code}` });
      } else {
        resolve({ output: output + (errText ? `\nstderr: ${errText}` : ''), error: null });
      }
    });

    child.on('error', (err) => {
      resolve({ output: '', error: `Failed to start aider: ${err.message}` });
    });
  });
}

function runCustom(spec: SpawnSpec): Promise<{ output: string; error: string | null; child: ChildProcess }> {
  return new Promise((resolve) => {
    // Reject obvious shell injection patterns
    const DANGEROUS_PATTERNS = /[;&|`$(){}!<>]/;
    if (DANGEROUS_PATTERNS.test(spec.task)) {
      return resolve({
        output: '',
        error: 'Command contains shell metacharacters. Use explicit arguments instead of shell syntax.',
        child: null as any
      });
    }

    // SECURITY: Use explicit /bin/sh -c instead of shell: true.
    // The dangerous pattern check above catches metacharacters; this
    // ensures the command is executed in a controlled shell invocation.
    const child = spawnChild('/bin/sh', ['-c', spec.task], {
      cwd: spec.workdir || process.cwd(),
      env: { ...process.env, ...loadDotenvOnce(), ...(spec.env || {}) },
      shell: false,
      timeout: spec.timeout || 300000,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      const output = stdout.join('');
      const errText = stderr.join('');
      if (code !== 0) {
        resolve({ output, error: errText || `command exited with code ${code}`, child });
      } else {
        resolve({ output: output + (errText ? `\nstderr: ${errText}` : ''), error: null, child });
      }
    });

    child.on('error', (err) => {
      resolve({ output: '', error: `Failed to start command: ${err.message}`, child });
    });
  });
}

function runClaudeCli(spec: SpawnSpec): Promise<{ output: string; error: string | null }> {
  return new Promise((resolve) => {
    const args = ['-p', spec.task];

    if (spec.allowedTools) {
      args.push('--allowedTools', spec.allowedTools);
    }
    // Note: --cwd and --max-tokens are not valid claude CLI flags.
    // Use cwd on the spawn options instead (already done below).

    const dotenv = loadDotenvOnce();
    // Ensure ~/.local/bin is in PATH for claude binary discovery
    const homeBin = join(process.env.HOME || '', '.local', 'bin');
    const currentPath = process.env.PATH || '';
    const augmentedPath = currentPath.includes('.local/bin') ? currentPath : `${homeBin}:${currentPath}`;

    const child = spawnChild('claude', args, {
      cwd: spec.workdir || process.cwd(),
      env: { ...process.env, ...dotenv, ...(spec.env || {}), PATH: augmentedPath },
      timeout: spec.timeout || 300000,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      const output = stdout.join('');
      const errText = stderr.join('');
      if (code !== 0) {
        resolve({ output, error: errText || `claude exited with code ${code}` });
      } else {
        resolve({ output, error: null });
      }
    });

    child.on('error', (err) => {
      resolve({ output: '', error: `Failed to start claude CLI: ${err.message}` });
    });
  });
}

// =============================================================================
// Default models per backend
// =============================================================================

const DEFAULT_MODELS: Record<SpawnSpec['backend'], string> = {
  ollama: 'llama3.2:8b',
  claude: 'claude-haiku-4-5-20251001',
  'claude-cli': 'claude-cli',  // claude CLI manages its own model
  gemini: 'gemini-2.0-flash-exp',
  aider: 'aider',   // aider manages its own model selection
  custom: 'custom',
};

// =============================================================================
// Module factory
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function createSpawner(_deps: {} = {}) {
  // In-memory registry of active spawned agents
  const agents = new Map<string, AgentRecord>();

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

  /**
   * Spawn an AI agent with the given spec.
   * Automatically wires PD session + heartbeat + done.
   */
  async function spawn(spec: SpawnSpec): Promise<SpawnResult> {
    cleanupStaleAgents();
    const agentId = `spawned-${randomBytes(6).toString('hex')}`;
    const model = spec.model || DEFAULT_MODELS[spec.backend];
    const startedAt = Date.now();

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

    try {
      let output: string;
      let error: string | null;

      switch (spec.backend) {
        case 'ollama': {
          const result = await runOllama(spec, model);
          output = result.output;
          error = result.error;
          break;
        }
        case 'claude': {
          const result = await runClaude(spec, model);
          output = result.output;
          error = result.error;
          break;
        }
        case 'gemini': {
          const result = await runGemini(spec, model);
          output = result.output;
          error = result.error;
          break;
        }
        case 'claude-cli': {
          const result = await runClaudeCli(spec);
          output = result.output;
          error = result.error;
          break;
        }
        case 'aider': {
          const result = await runAider(spec);
          output = result.output;
          error = result.error;
          break;
        }
        case 'custom': {
          const result = await runCustom(spec);
          output = result.output;
          error = result.error;
          record.childProcess = result.child;
          break;
        }
        default: {
          output = '';
          error = `Unknown backend: ${String(spec.backend)}`;
        }
      }

      const completedAt = Date.now();
      const status: SpawnResult['status'] = error ? 'failed' : 'completed';

      // Update record
      record.status = status;
      record.completedAt = completedAt;

      // Clean up heartbeat
      if (record.heartbeatInterval) {
        clearInterval(record.heartbeatInterval);
        record.heartbeatInterval = null;
      }

      // PD coordination: done
      const doneNote = error ? `Failed: ${error.slice(0, 200)}` : `Completed: ${output.slice(0, 200)}`;
      await pdCoordinate('/sugar/done', { agentId, note: doneNote });

      return {
        agentId,
        backend: spec.backend,
        model,
        status,
        output: output || null,
        error,
        startedAt,
        completedAt,
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      const completedAt = Date.now();

      record.status = 'failed';
      record.completedAt = completedAt;

      if (record.heartbeatInterval) {
        clearInterval(record.heartbeatInterval);
        record.heartbeatInterval = null;
      }

      await pdCoordinate('/sugar/done', { agentId, note: `Error: ${errorMessage}` });

      return {
        agentId,
        backend: spec.backend,
        model,
        status: 'failed',
        output: null,
        error: errorMessage,
        startedAt,
        completedAt,
      };
    }
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

    // PD coordination: done (fire-and-forget)
    pdCoordinate('/sugar/done', { agentId, note: 'Killed by spawner' }).catch(() => {});
  }

  return { spawn, list, kill };
}
