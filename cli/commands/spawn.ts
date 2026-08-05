/**
 * CLI Spawn Commands — AI Agent Launcher + Watch
 *
 * Handles: spawn, spawned, watch
 */

import { pdFetch } from '../utils/fetch.js';
import { createWatch } from '../../lib/watch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY, relativeTime } from '../utils/output.js';
import {
  resolveDeclaredChannel,
  formatResolvedChannel,
} from '../utils/channel-resolution.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { autoIdentityFromPackageJson } from './services.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { KNOWN_BACKEND_IDS } from '../../lib/backend-catalog.js';
import { randomUUID } from 'node:crypto';

function parseBudgetValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const SPAWN_ADMISSION_TIMEOUT_MS = 15_000;
const SPAWN_POLL_INTERVAL_MS = 1_000;

class SpawnMonitorMissingError extends Error {}

function spawnCollectionSettled(data: Record<string, unknown>): boolean {
  return data.terminal === true || data.outcomeUnknown === true ||
    ['completed', 'failed', 'killed', 'cancelled', 'over_budget', 'no_runtime', 'unknown'].includes(String(data.status || ''));
}

async function collectSpawn(monitorUrl: string): Promise<Record<string, unknown>> {
  let reconnects = 0;
  while (true) {
    try {
      const response = await pdFetch(monitorUrl, { method: 'GET', timeout: SPAWN_ADMISSION_TIMEOUT_MS });
      const data = await response.json();
      if (response.status === 404) {
        throw new SpawnMonitorMissingError((data.error as string) || `No spawned run found at ${monitorUrl}`);
      }
      if (!response.ok) throw new Error((data.error as string) || `spawn monitor returned HTTP ${response.status}`);
      reconnects = 0;
      if (spawnCollectionSettled(data)) return data;
    } catch (error) {
      if (error instanceof SpawnMonitorMissingError) throw error;
      reconnects += 1;
      if (reconnects === 1) {
        ui.warn(`Spawn monitor disconnected; the daemon still owns the run. Reconnecting (${(error as Error).message})…`);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, SPAWN_POLL_INTERVAL_MS));
  }
}

function printSpawnResult(data: Record<string, unknown>, options: CLIOptions): void {
  const failed = data.success === false && data.outcomeUnknown !== true ||
    ['failed', 'killed', 'cancelled', 'over_budget', 'no_runtime'].includes(String(data.status || ''));
  const unknown = data.outcomeUnknown === true || data.status === 'unknown';

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    if (failed) process.exit(1);
    return;
  }
  if (isQuiet(options)) {
    if (data.output && typeof data.output === 'string') console.log(data.output);
    else console.log(data.agentId);
    if (failed) process.exit(1);
    return;
  }

  const runLabel = String(data.agentId || data.id || 'unassigned run');
  const agentMsg = `Agent ${runLabel}: ${data.status as string}`;
  if (data.status === 'completed') ui.success(agentMsg);
  else if (failed) ui.error(agentMsg);
  else ui.warn(agentMsg);
  if (data.backend) console.error(`  Backend: ${data.backend as string}`);
  if (data.model) console.error(`  Model: ${data.model as string}`);
  if (data.identity) console.error(`  Identity: ${data.identity as string}`);
  if (data.completedAt && data.startedAt) {
    console.error(`  Duration: ${relativeTime((data.completedAt as number) - (data.startedAt as number))}`);
  }
  if (data.error) console.error(`  ${unknown ? 'Reconciliation' : 'Error'}: ${data.error as string}`);
  if (data.output && typeof data.output === 'string') {
    console.error('');
    console.error('--- Output ---');
    console.log(data.output);
  }
  if (failed) process.exit(1);
}

// =============================================================================
// handleSpawn — pd spawn --backend ollama -- "my task"
// =============================================================================

export async function handleSpawn(
  args: string[],
  options: CLIOptions,
): Promise<void> {
  // Explicit operator cancellation. This is a terminal, durable lifecycle
  // transition; low-level process signals remain an implementation detail.
  if (args[0] === 'cancel') {
    const agentId = args[1];
    if (!agentId) {
      console.error('Usage: pd spawn cancel <agentId>');
      process.exit(1);
    }

    const ok = await requireConfirmation({
      summary: `Spawn cancellation will stop ${agentId} mid-run, finalize its transcript, and preserve partial work for inspection.`,
      args: options as Record<string, unknown>,
    });
    if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

    const res: PdFetchResponse = await pdFetch(`/spawn/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || `Failed to cancel agent ${agentId}`);
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (!isQuiet(options)) {
      ui.success(`Agent ${agentId} cancelled`);
    }
    return;
  }

  // Collect task: everything after '--' separator
  const doubleDashIdx = process.argv.indexOf('--');
  let task: string | undefined;
  if (doubleDashIdx !== -1) {
    task = process.argv.slice(doubleDashIdx + 1).join(' ');
  }

  // Fall back to positional args (before any flags)
  if (!task && args.length > 0) {
    task = args.join(' ');
  }

  const backend = (options.backend as string) || 'ollama';
  const budgetUsd = parseBudgetValue(options.budget);
  const requestedTimeoutMs = options.timeout != null ? parseInt(String(options.timeout), 10) : undefined;

  // Single source of truth: lib/backend-catalog.ts (ADR-0057 model-abstraction
  // unification) — this used to be a hand-maintained array duplicating
  // routes/spawn.ts's own list, which had already drifted from it.
  const validBackends = [...KNOWN_BACKEND_IDS];
  if (!validBackends.includes(backend)) {
    console.error(`Invalid backend "${backend}". Valid: ${validBackends.join(', ')}`);
    process.exit(1);
  }

  if (!task) {
    console.error('Usage: pd spawn --backend <backend> -- <task>');
    console.error('       pd spawn --backend claude -- "Write a hello world program"');
    console.error('');
    console.error(`Backends: ${validBackends.join(', ')}`);
    console.error('');
    console.error('Options:');
    console.error('  --backend <name>      AI backend to use (default: ollama)');
    console.error('  --model <name>        Model override');
    console.error('  --tier <level>        Model tier override (low, mid, high)');
    console.error('  --identity <id>       PD semantic identity (project:stack:context)');
    console.error('  --purpose <text>      Human-readable task description');
    console.error('  --budget <usd>        Required spend ceiling for this launch');
    console.error('  --allowedTools <str>  Tool permissions for claude-cli backend');
    console.error('  --maxTokens <n>       Max tokens for claude/claude-cli backends');
    console.error('  --timeout <ms>         Optional hard task deadline; CLI agents have no default');
    console.error('  --detach               Return the durable receipt without following the run');
    console.error('  --inject-squid-hooks  Install Giant Squid tentacles before launching supported CLI backends');
    console.error('  -j, --json            JSON output');
    console.error('  -q, --quiet           Suppress output');
    console.error('');
    console.error('Subcommands:');
    console.error('  pd spawn cancel <id>  Cancel a running spawn and retain its record');
    process.exit(1);
  }

  const identity = (options.identity as string) || autoIdentityFromPackageJson() || undefined;
  if (!identity) {
    ui.error('pd spawn requires --identity <project:stack:context> or a package.json name for auto-detection');
    process.exit(1);
  }
  if (!options.identity && !isQuiet(options) && !isJson(options)) {
    ui.info(`Auto-detected identity: ${identity}`);
  }
  if (budgetUsd == null || budgetUsd <= 0) {
    ui.error('pd spawn requires --budget <usd> with a positive ceiling');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    backend,
    budgetUsd,
    identity,
    task,
  };

  if (options.model) body.model = options.model;
  if (typeof options.tier === 'string') body.modelTier = options.tier;
  if (options.purpose) body.purpose = options.purpose;

  // Aider: collect --files from options
  if (options.files) {
    if (typeof options.files === 'string') {
      body.files = [options.files];
    } else if (Array.isArray(options.files)) {
      body.files = options.files;
    }
  }

  if (options.workdir) body.workdir = options.workdir;
  if (requestedTimeoutMs && requestedTimeoutMs > 0) body.timeout = requestedTimeoutMs;
  if (options.allowedTools) body.allowedTools = options.allowedTools;
  if (options.maxTokens) body.maxTokens = parseInt(options.maxTokens as string, 10);
  if (options['inject-squid-hooks'] === true || options.injectSquidHooks === true) {
    body.injectSquidHooks = true;
  }

  if (IS_TTY && !isQuiet(options) && !isJson(options)) {
    ui.info(`Spawning ${backend} agent...`);
  }

  const res: PdFetchResponse = await pdFetch('/spawn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'respond-async',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
    timeout: SPAWN_ADMISSION_TIMEOUT_MS,
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to spawn agent');
    process.exit(1);
  }

  if (res.status === 202 && data.monitorUrl && options.detach !== true) {
    if (!isQuiet(options) && !isJson(options)) {
      ui.success(`Accepted ${data.agentId as string}; following durable run (Ctrl-C detaches only this client).`);
    }
    try {
      printSpawnResult(await collectSpawn(String(data.monitorUrl)), options);
    } catch (error) {
      ui.error((error as Error).message);
      process.exit(1);
    }
    return;
  }

  printSpawnResult(data, options);
}

// =============================================================================
// handleSpawned — pd spawned
// =============================================================================

export async function handleSpawned(
  args: string[],
  options: CLIOptions,
): Promise<void> {
  const agentId = args[0];
  if (agentId) {
    const monitorUrl = `/spawn/${encodeURIComponent(agentId)}`;
    try {
      if (options.wait === true || options.follow === true) {
        printSpawnResult(await collectSpawn(monitorUrl), options);
        return;
      }
      const one = await pdFetch(monitorUrl, { method: 'GET' });
      const data = await one.json();
      if (!one.ok) throw new Error((data.error as string) || `Failed to inspect ${agentId}`);
      printSpawnResult(data, options);
    } catch (error) {
      ui.error((error as Error).message);
      process.exit(1);
    }
    return;
  }
  const res: PdFetchResponse = await pdFetch('/spawn', {
    method: 'GET',
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list spawned agents');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const agents = (data.agents || []) as Array<{
    agentId: string;
    backend: string;
    model: string;
    status: string;
    identity: string | null;
    purpose: string | null;
    startedAt: number;
    completedAt: number | null;
  }>;

  if (agents.length === 0) {
    if (!isQuiet(options)) {
      console.error('No spawned agents');
    }
    return;
  }

  if (isQuiet(options)) {
    for (const a of agents) {
      console.log(`${a.agentId}\t${a.backend}\t${a.status}`);
    }
    return;
  }

  console.error('');
  console.error(
    'AGENT ID'.padEnd(20) +
    'BACKEND'.padEnd(10) +
    'MODEL'.padEnd(25) +
    'STATUS'.padEnd(12) +
    'AGE'
  );
  console.error('\u2500'.repeat(80));

  const now = Date.now();
  for (const a of agents) {
    const age = relativeTime(now - a.startedAt);
    console.error(
      a.agentId.slice(0, 19).padEnd(20) +
      a.backend.padEnd(10) +
      (a.model || '').slice(0, 24).padEnd(25) +
      a.status.padEnd(12) +
      age
    );
  }
  console.error('');
  console.error(`Total: ${agents.length} agent(s)`);
}

// =============================================================================
// handleWatch — pd watch <channel> --exec <script>
// =============================================================================

export async function handleWatch(
  channel: string | undefined,
  options: CLIOptions,
): Promise<void> {
  if (!channel) {
    console.error('Usage: pd watch <channel> --exec <script>');
    console.error('');
    console.error('Subscribes to a pub/sub channel and runs a script on each message.');
    console.error('Declared logical channels auto-resolve against the current repo/worktree by default.');
    console.error('Reconnects automatically with exponential backoff (1s → 2s → 4s … 30s).');
    console.error('');
    console.error('Options:');
    console.error('  --exec <script>          Shell command to run on each message (required)');
    console.error('  --once                   Exit after first message');
    console.error('  --max-concurrent <n>     Max concurrent exec processes (default: 3)');
    console.error('  --timeout <ms>           Per-exec timeout in ms (default: 30000)');
    console.error('  --min-interval <ms>      Min ms between executions — rate limit (default: 0)');
    console.error('  --dir <path>             Resolve declared logical channels for this worktree');
    console.error('  --raw-channel            Bypass logical-channel resolution and use the literal string');
    console.error('');
    console.error('Environment variables set when exec runs:');
    console.error('  PD_MESSAGE          Full message JSON string');
    console.error('  PD_MESSAGE_CONTENT  Extracted content field');
    console.error('  PD_CHANNEL          Channel name');
    console.error('  PD_TIMESTAMP        ISO timestamp');
    console.error('');
    console.error('Examples:');
    console.error('  pd watch deployments --exec ./deploy.sh');
    console.error('  pd watch alerts --exec "echo $PD_MESSAGE_CONTENT" --max-concurrent 1');
    console.error('  pd watch builds --exec ./notify.sh --timeout 10000 --min-interval 5000');
    process.exit(1);
  }

  const exec = options.exec as string | undefined;
  if (!exec) {
    ui.error('--exec is required');
    console.error('Example: pd watch deployments --exec ./handle-message.sh');
    process.exit(1);
  }

  let resolvedChannel;
  try {
    resolvedChannel = await resolveDeclaredChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  const once = !!options.once;
  const maxConcurrent = options['max-concurrent'] !== undefined
    ? parseInt(String(options['max-concurrent']), 10)
    : 3;
  const timeout = options.timeout !== undefined
    ? parseInt(String(options.timeout), 10)
    : 30_000;
  const minInterval = options['min-interval'] !== undefined
    ? parseInt(String(options['min-interval']), 10)
    : 0;

  if (IS_TTY && !isQuiet(options)) {
    ui.info(`Watching ${formatResolvedChannel(resolvedChannel)} — exec: ${exec}`);
    if (once) console.error('  (--once: will exit after first message)');
    console.error(`  max-concurrent: ${maxConcurrent}  timeout: ${timeout}ms  min-interval: ${minInterval}ms`);
    console.error('  Reconnects with exponential backoff on disconnect');
    console.error('  Press Ctrl+C to stop');
  }

  const watcher = createWatch();
  const handle = watcher.watch(resolvedChannel.physicalChannel, { exec, once, maxConcurrent, timeout, minInterval });

  // Handle SIGINT/SIGTERM gracefully
  const cleanup = () => {
    handle.stop();
    if (IS_TTY && !isQuiet(options)) {
      console.error('');
      ui.warn('Watch stopped');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep the process alive until stopped
  await new Promise<void>((resolve) => {
    if (once) {
      // Poll for once+fired state (handle doesn't expose fired state directly)
      const checkInterval = setInterval(() => {
        // The watch will stop itself when once=true and message received
        // We rely on the process naturally ending when the SSE connection closes
        clearInterval(checkInterval);
        resolve();
      }, 100);
    }
    // For non-once mode, stay alive indefinitely via signal handler
  });
}
