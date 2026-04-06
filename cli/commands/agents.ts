/**
 * CLI Agent Commands
 *
 * Handles: agent, agents commands for multi-agent coordination
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { resolveFleetAgentRuntime } from '../../lib/fleet-engine.js';
import { autoIdentityFromPackageJson } from './services.js';

const AGENT_ADMIN_SUBCOMMANDS = new Set(['register', 'heartbeat', 'unregister', 'inbox', 'help', 'run']);

interface SpawnPreflightResponse {
  success?: boolean;
  launchReady: boolean;
  blockedReasons?: string[];
  warnings?: string[];
  localExecutionLikely?: boolean;
  localExecutionNote?: string;
  budget?: {
    project: string;
    budgetUsdPerDay: number;
    spentUsd: number;
    remainingUsd: number;
    percentUsed: number;
    overBudget: boolean;
  } | null;
  attempts?: Array<{
    attempt: number;
    backend: string | null;
    model: string | null;
    modelTier: string | null;
    readinessStatus: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
    readinessSummary: string;
    readinessNextStep?: string;
  }>;
}

function shouldRunAutopilot(subcommand: string, args: string[], options: CLIOptions): boolean {
  if (subcommand === 'run') return true;
  if (AGENT_ADMIN_SUBCOMMANDS.has(subcommand)) return false;
  return subcommand.includes(' ')
    || args.length > 0
    || !!options.backend
    || !!options.model
    || !!options.tier
    || !!options.timeout
    || !!options.allowedTools
    || !!options.identity
    || !!options.recipe
    || !!options.background;
}

async function finishAutopilotSession(agentId: string | undefined, sessionId: string | undefined, note: string, status: 'completed' | 'abandoned'): Promise<void> {
  if (!agentId || !sessionId) return;
  await pdFetch(`${PORT_DADDY_URL}/sugar/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, sessionId, note, status }),
  }).catch(() => {});
}

function parseBudgetValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function fetchAgentPreflight(runtime: ReturnType<typeof resolveFleetAgentRuntime>, identity: string | undefined, budgetUsd: number | undefined): Promise<SpawnPreflightResponse | null> {
  try {
    const preflightRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/spawn/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backend: runtime.backend,
        model: runtime.model,
        modelTier: runtime.modelTier,
        identity,
        budgetUsd,
      }),
    });
    if (!preflightRes.ok) return null;
    return await preflightRes.json() as unknown as SpawnPreflightResponse;
  } catch {
    return null;
  }
}

function printPreflight(preflight: SpawnPreflightResponse): void {
  ui.info('pd agent preflight');
  for (const attempt of preflight.attempts || []) {
    const modelLabel = attempt.model || (attempt.modelTier ? `${attempt.modelTier} tier` : 'backend default');
    console.error(`  Attempt ${attempt.attempt}: ${attempt.backend || 'MISSING'} / ${modelLabel} / ${attempt.readinessStatus}`);
    console.error(`    ${attempt.readinessSummary}`);
    if (attempt.readinessNextStep) {
      console.error(`    next: ${attempt.readinessNextStep}`);
    }
  }
  if (preflight.budget) {
    console.error(`  Budget: $${preflight.budget.spentUsd.toFixed(2)} / $${preflight.budget.budgetUsdPerDay.toFixed(2)} (${preflight.budget.percentUsed.toFixed(1)}%)`);
  }
  for (const warning of preflight.warnings || []) {
    console.error(`  Warning: ${warning}`);
  }
  if (preflight.localExecutionLikely && preflight.localExecutionNote) {
    console.error(`  Note: ${preflight.localExecutionNote}`);
  }
}

async function runAgentAutopilot(task: string, options: CLIOptions): Promise<void> {
  const runtime = resolveFleetAgentRuntime({
    backend: options.backend as string | undefined,
    model: options.model as string | undefined,
    modelTier: options.tier as 'low' | 'mid' | 'high' | undefined,
  });

  if (!runtime.backend) {
    ui.error('pd agent could not resolve a backend');
    ui.info('Set --backend, or export PD_FLEET_DEFAULT_BACKEND / PORT_DADDY_FLEET_DEFAULT_BACKEND.');
    process.exit(1);
  }

  const purpose = (options.purpose as string) || task;
  const identity = (options.identity as string) || autoIdentityFromPackageJson() || undefined;
  const allowedTools = options.allowedTools as string | undefined;
  const timeout = options.timeout ? parseInt(options.timeout as string, 10) : undefined;
  const budgetUsd = parseBudgetValue(options.budget);

  if (budgetUsd == null || budgetUsd <= 0) {
    ui.error('pd agent requires --budget <usd> with a positive ceiling');
    process.exit(1);
  }

  const preflight = await fetchAgentPreflight(runtime, identity, budgetUsd);

  if (!isQuiet(options) && !isJson(options)) {
    ui.info('pd agent autopilot');
    console.error(`  Task: ${task}`);
    console.error(`  Runtime: ${runtime.backend}${runtime.model ? ` / ${runtime.model}` : ''}`);
    if (identity) console.error(`  Identity: ${identity}`);
    console.error(`  Budget ceiling: $${budgetUsd.toFixed(2)}`);
    if (preflight) printPreflight(preflight);
    else for (const warning of runtime.warnings) console.error(`  Warning: ${warning}`);
  }

  if (preflight && !preflight.launchReady) {
    ui.error(preflight.blockedReasons?.[0] || 'pd agent preflight failed');
    process.exit(1);
  }

  const beginRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sugar/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose,
      identity,
      agentId: options.agent,
      type: 'pd-agent',
    }),
  });
  const beginData = await beginRes.json();

  if (!beginRes.ok) {
    ui.error((beginData.error as string) || 'Failed to begin pd agent session');
    process.exit(1);
  }

  const sessionAgentId = beginData.agentId as string | undefined;
  const sessionId = beginData.sessionId as string | undefined;
  let closed = false;
  const closeSession = async (note: string, status: 'completed' | 'abandoned'): Promise<void> => {
    if (closed) return;
    closed = true;
    await finishAutopilotSession(sessionAgentId, sessionId, note, status);
  };

  const handleInterrupt = (): void => {
    void closeSession('Interrupted before completion', 'abandoned').finally(() => process.exit(130));
  };
  process.once('SIGINT', handleInterrupt);
  process.once('SIGTERM', handleInterrupt);

  try {
    const spawnRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backend: runtime.backend,
        model: runtime.model,
        identity,
        purpose: `pd agent: ${purpose.slice(0, 120)}`,
        task,
        allowedTools,
        timeout,
        budgetUsd,
      }),
    });
    const spawnData = await spawnRes.json();

    if (!spawnRes.ok) {
      await closeSession(`Failed: ${(spawnData.error as string) || 'spawn request failed'}`, 'abandoned');
      ui.error((spawnData.error as string) || 'Failed to run pd agent task');
      process.exit(1);
    }

    const failed = spawnData.status === 'failed';
    const finalNote = failed
      ? `Failed: ${String(spawnData.error || 'unknown').slice(0, 200)}`
      : `Completed: ${String(spawnData.output || '').slice(0, 200)}`;
    await closeSession(finalNote, failed ? 'abandoned' : 'completed');

    if (isJson(options)) {
      console.log(JSON.stringify({
        agentId: sessionAgentId,
        sessionId,
        runtime,
        result: spawnData,
      }, null, 2));
      if (failed) process.exit(1);
      return;
    }

    if (isQuiet(options)) {
      console.log((spawnData.output as string) || (spawnData.error as string) || (spawnData.agentId as string));
      if (failed) process.exit(1);
      return;
    }

    if (failed) ui.error(`pd agent failed: ${String(spawnData.error || 'unknown failure')}`);
    else ui.success('pd agent completed');
    console.error(`  Session: ${sessionId}`);
    console.error(`  Agent: ${sessionAgentId}`);
    if (spawnData.agentId) console.error(`  Spawned: ${spawnData.agentId as string}`);
    if (spawnData.output && typeof spawnData.output === 'string') {
      console.error('');
      console.error('--- Output ---');
      console.log(spawnData.output);
    }
    if (failed) process.exit(1);
  } finally {
    process.off('SIGINT', handleInterrupt);
    process.off('SIGTERM', handleInterrupt);
  }
}

/**
 * Handle `pd agent <subcommand>` command
 */
export async function handleAgent(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (!subcommand || subcommand === 'help') {
    console.error('Usage: port-daddy agent <subcommand> [options]');
    console.error('');
    console.error('Subcommands:');
    console.error('  "task text"                               Run a one-shot pd agent autopilot task');
    console.error('  run <task text>                           Explicit autopilot form');
    console.error('  register [--agent <id>] [--type <type>] [--identity <project:stack:context>] [--purpose <text>] [--skills <list>]');
    console.error('                                            Register as an agent (auto-checks for dead agents in same project)');
    console.error('  heartbeat [--agent <id>]                  Send heartbeat');
    console.error('  unregister [--agent <id>]                 Unregister agent');
    console.error('  inbox                                     Read your inbox');
    console.error('  inbox send <agent-id> <message>           Send DM to another agent');
    console.error('  inbox stats                               Get inbox statistics');
    console.error('  inbox clear                               Clear your inbox');
    console.error('  <agent-id>                                Get agent info');
    console.error('');
    console.error('Options:');
    console.error('  --identity <project:stack:context>        Semantic identity (enables context-aware salvage)');
    console.error('  --purpose <text>                          What you\'re working on');
    console.error('  --budget <usd>                           Required one-shot spend ceiling enforced at launch');
    console.error('  --skills <list>                           Comma-separated agent skills (e.g. "typescript,react")');
    console.error('  --worktree <id>                           Git worktree identifier');
    process.exit(1);
  }

  if (shouldRunAutopilot(subcommand, args, options)) {
    const task = subcommand === 'run'
      ? args.join(' ').trim()
      : [subcommand, ...args].join(' ').trim();
    if (!task) {
      ui.error('pd agent autopilot needs a task');
      ui.info('Usage: pd agent "task text"');
      ui.info('   or: pd agent run "task text"');
      process.exit(1);
    }
    await runAgentAutopilot(task, options);
    return;
  }

  const agentId: string = (options.agent as string) || process.env.AGENT_ID || `cli-${process.pid}`;

  switch (subcommand) {
    case 'register': {
      const body: Record<string, unknown> = {
        id: agentId,
        name: options.name,
        type: options.agentType || 'cli',
        maxServices: options.maxServices ? parseInt(options.maxServices as string, 10) : undefined,
        maxLocks: options.maxLocks ? parseInt(options.maxLocks as string, 10) : undefined,
        // Context-aware salvage: semantic identity enables project-scoped resurrection
        identity: options.identity,
        purpose: options.purpose,
        skills: options.skills,
        worktreeId: options.worktree
      };

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PID': String(process.pid)
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to register agent');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.registered ? `Registered agent: ${agentId}` : `Updated agent: ${agentId}`);

        // Show salvage notice if there are dead agents in the same project
        if (data.salvageHint) {
          console.log('');
          ui.warn(data.salvageHint as string);
        }
      }
      break;
    }

    case 'heartbeat': {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PID': String(process.pid)
        }
      });

      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to send heartbeat');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else if (!isQuiet(options)) {
        console.log(`Heartbeat sent for ${agentId}`);
      }
      break;
    }

    case 'unregister': {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to unregister agent');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.unregistered ? `Unregistered agent: ${agentId}` : `Agent not found: ${agentId}`);
      }
      break;
    }

    // =========================================================================
    // INBOX COMMANDS
    // =========================================================================

    case 'inbox': {
      const inboxAction = args[0];

      if (!inboxAction || inboxAction === 'list') {
        // Read inbox
        const params = new URLSearchParams();
        if (options.unread) params.append('unread', 'true');
        if (options.limit) params.append('limit', String(options.limit));

        const res: PdFetchResponse = await pdFetch(
          `${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox${params.toString() ? '?' + params : ''}`
        );
        const data = await res.json();

        if (!res.ok) {
          ui.error((data.error as string) || 'Failed to read inbox');
          process.exit(1);
        }

        if (isJson(options)) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const messages = data.messages as Array<{
          id: number;
          from: string | null;
          content: string;
          type: string;
          read: boolean;
          createdAt: number;
        }>;

        if (messages.length === 0) {
          console.log('No messages in inbox');
          return;
        }

        console.log('');
        for (const msg of messages) {
          const readMark = msg.read ? ' ' : '\u2709';
          const time = new Date(msg.createdAt).toISOString().slice(11, 19);
          const from = msg.from || 'system';
          console.log(`${readMark} [${time}] <${from}> ${msg.content.slice(0, 60)}${msg.content.length > 60 ? '...' : ''}`);
        }
        console.log('');
        console.log(`${data.count} message(s)`);

      } else if (inboxAction === 'send') {
        // Send DM: pd agent inbox send <target-agent> <message>
        const targetAgent = args[1];
        const message = args.slice(2).join(' ');

        if (!targetAgent || !message) {
          console.error('Usage: pd agent inbox send <agent-id> <message>');
          process.exit(1);
        }

        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(targetAgent)}/inbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message, from: agentId })
        });
        const data = await res.json();

        if (!res.ok) {
          ui.error((data.error as string) || 'Failed to send message');
          process.exit(1);
        }

        if (isJson(options)) {
          console.log(JSON.stringify(data, null, 2));
        } else if (!isQuiet(options)) {
          console.log(`Message sent to ${targetAgent}`);
        }

      } else if (inboxAction === 'stats') {
        // Get inbox stats
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox/stats`);
        const data = await res.json();

        if (!res.ok) {
          ui.error((data.error as string) || 'Failed to get inbox stats');
          process.exit(1);
        }

        if (isJson(options)) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`Inbox: ${data.unread} unread / ${data.total} total`);
        }

      } else if (inboxAction === 'clear') {
        // Clear inbox
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox`, {
          method: 'DELETE'
        });
        const data = await res.json();

        if (!res.ok) {
          ui.error((data.error as string) || 'Failed to clear inbox');
          process.exit(1);
        }

        if (isJson(options)) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`Cleared ${data.deleted} message(s) from inbox`);
        }

      } else if (inboxAction === 'read-all') {
        // Mark all as read
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox/read-all`, {
          method: 'PUT'
        });
        const data = await res.json();

        if (!res.ok) {
          ui.error((data.error as string) || 'Failed to mark as read');
          process.exit(1);
        }

        if (isJson(options)) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`Marked ${data.marked} message(s) as read`);
        }

      } else {
        console.error(`Unknown inbox action: ${inboxAction}`);
        console.error('Available actions: list, send, stats, clear, read-all');
        process.exit(1);
      }
      break;
    }

    default: {
      // Treat as agent ID lookup
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(subcommand)}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Agent not found');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        const agent = data.agent as {
          id: string;
          name?: string;
          type: string;
          pid: number;
          isActive: boolean;
          lastHeartbeat: number;
          registeredAt: number;
          maxServices: number;
          maxLocks: number;
        };
        console.log(`Agent: ${agent.id}`);
        console.log(`  Name: ${agent.name || '-'}`);
        console.log(`  Type: ${agent.type}`);
        console.log(`  PID: ${agent.pid}`);
        console.log(`  Active: ${agent.isActive ? 'yes' : 'no'}`);
        console.log(`  Last heartbeat: ${new Date(agent.lastHeartbeat).toISOString()}`);
        console.log(`  Registered: ${new Date(agent.registeredAt).toISOString()}`);
        console.log(`  Limits: ${agent.maxServices} services, ${agent.maxLocks} locks`);
      }
    }
  }
}

/**
 * Handle `pd agents` command
 */
export async function handleAgents(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.active) params.append('active', 'true');
  if (options.identity) params.append('identity', options.identity as string);
  if (options.purpose) params.append('purpose', options.purpose as string);
  if (options.skills) params.append('skills', options.skills as string);

  const url: string = `${PORT_DADDY_URL}/agents${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list agents');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No agents registered');
    return;
  }

  console.log('');
  console.log('ID'.padEnd(25) + 'TYPE'.padEnd(10) + 'PID'.padEnd(10) + 'ACTIVE'.padEnd(10) + 'LAST HEARTBEAT');
  console.log('\u2500'.repeat(75));

  const agents = data.agents as Array<{ id: string; type: string; pid: number; isActive: boolean; lastHeartbeat: number }>;
  for (const agent of agents) {
    const lastHb: string = new Date(agent.lastHeartbeat).toISOString().replace('T', ' ').slice(0, 19);
    console.log(
      agent.id.slice(0, 24).padEnd(25) +
      agent.type.padEnd(10) +
      String(agent.pid).padEnd(10) +
      (agent.isActive ? 'yes' : 'no').padEnd(10) +
      lastHb
    );
  }

  console.log('');
  console.log(`Total: ${data.count} agent(s)`);
}
