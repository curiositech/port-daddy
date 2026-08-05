/**
 * CLI Agent Commands
 *
 * Handles: agent, agents commands for multi-agent coordination
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { readCurrentContext } from '../utils/current-context.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { inboxMessagePreview } from '../utils/message-preview.js';

/**
 * Handle `pd agent <subcommand>` command
 */
export async function handleAgent(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (!subcommand || subcommand === 'help') {
    console.error('Usage: port-daddy agent <subcommand> [options]');
    console.error('');
    console.error('Subcommands:');
    console.error('  register [--agent <id>] [--type <type>] [--identity <project:stack:context>] [--purpose <text>] [--skills <list>]');
    console.error('                                            Register as an agent (auto-checks for dead agents in same project)');
    console.error('  heartbeat [--agent <id>]                  Send heartbeat');
    console.error('  unregister [--agent <id>]                 Unregister agent');
    console.error('  interrupt <agent-id> [--reason <text>]    Soft-interrupt an agent (publishes control on agent:<id>)');
    console.error('  stream <agent-id>                         Tail the merged SSE feed (status/tube/transcript) until Ctrl-C');
    console.error('  inbox                                     Read your inbox');
    console.error('  inbox send <agent-id> <message>           Send DM to another agent');
    console.error('  inbox stats                               Get inbox statistics');
    console.error('  inbox clear                               Clear your inbox');
    console.error('  <agent-id>                                Get agent info');
    console.error('');
    console.error('Options:');
    console.error('  --identity <project:stack:context>        Semantic identity (enables context-aware salvage)');
    console.error('  --purpose <text>                          What you\'re working on');
    console.error('  --skills <list>                           Comma-separated agent skills (e.g. "typescript,react")');
    console.error('  --worktree <id>                           Git worktree identifier');
    console.error('');
    console.error('Launch delegated work with `pd spawn`, not `pd agent`.');
    process.exit(1);
  }

  // Active session's durable agentId before the ephemeral `cli-<pid>` (see inbox.ts).
  const agentId: string =
    (options.agent as string) || process.env.AGENT_ID || readCurrentContext()?.agentId || `cli-${process.pid}`;

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
      const ok = await requireConfirmation({
        summary: `Unregister will remove agent ${agentId} from the registry. Any active claims it holds are released and another caller may pick up its work via salvage.`,
        args: options as Record<string, unknown>,
      });
      if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

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
    // COCKPIT COMMANDS ("Watch + Grab the Wheel") — routes/agent-cockpit.ts
    // =========================================================================

    case 'interrupt': {
      // pd agent interrupt <id> [--reason <text>]
      // Soft cancel/steer: POST /agents/:id/interrupt publishes a typed
      // control message on the agent's steering channel `agent:<id>`. Does
      // NOT kill the process — a cooperating agent loop observes and reacts.
      const targetId = args[0];
      if (!targetId) {
        ui.error('Usage: pd agent interrupt <agent-id> [--reason <text>]');
        process.exit(1);
      }

      const reason = options.reason as string | undefined;
      const res: PdFetchResponse = await pdFetch(
        `${PORT_DADDY_URL}/agents/${encodeURIComponent(targetId)}/interrupt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reason ? { reason } : {}),
        },
      );

      const data = await res.json();

      if (res.status === 404) {
        ui.error(`No such agent: ${targetId}`);
        ui.info('Run `pd agents` to list registered agents.');
        process.exit(1);
      }

      if (!res.ok || data.success === false) {
        ui.error((data.error as string) || 'Failed to interrupt agent');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else if (!isQuiet(options)) {
        ui.success(`Interrupt delivered to ${targetId}`);
        console.error(`  Channel: ${data.channel}`);
        if (data.messageId != null) console.error(`  Message: ${data.messageId}`);
        if (reason) console.error(`  Reason: ${reason}`);
      } else {
        console.log(String(data.messageId ?? data.channel ?? ''));
      }
      break;
    }

    case 'stream': {
      // pd agent stream <id>
      // Tail the merged SSE feed (GET /agents/:id/stream): agent.status,
      // agent.tube, and agent.transcript envelopes, one per line, until Ctrl-C.
      const targetId = args[0];
      if (!targetId) {
        ui.error('Usage: pd agent stream <agent-id>');
        process.exit(1);
      }
      await tailAgentStream(targetId, options);
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
          content: unknown;
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
          console.log(`${readMark} [${time}] <${from}> ${inboxMessagePreview(msg.content)}`);
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
        const ok = await requireConfirmation({
          summary: `Inbox clear will delete every message addressed to ${agentId}. Senders will not be notified and content is not recoverable.`,
          args: options as Record<string, unknown>,
        });
        if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

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
      // `pd agent` is the registry/control namespace, not a second launch
      // primitive. Older help/docs advertised launch-shaped forms such as
      // `pd agent "task"`, `pd agent run ...`, and `pd agent harness ...`.
      // Treating the first token as an agent id sent those forms to GET
      // /agents/:id and surfaced the daemon's opaque "Not Found" response.
      // Refuse them locally with the one canonical, budgeted replacement.
      const launchShaped = subcommand === 'run'
        || subcommand === 'harness'
        || /\s/.test(subcommand)
        || args.length > 0;
      if (launchShaped) {
        ui.error('pd agent controls registered agents; it does not start work.');
        ui.info('Use: pd spawn --backend <backend> --budget <usd> --identity <project:stack:context> -- "task text"');
        process.exit(1);
      }

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
  if (options.roster || options.live || options.harness) {
    return handleAgentRoster(options);
  }

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

async function handleAgentRoster(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams({ limit: String(options.limit || 100) });
  if (options.project) params.set('project', String(options.project));

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agent-roster?${params}`);
  const data = await res.json();

  if (!res.ok || data.success === false) {
    ui.error((data.error as string) || 'Failed to list active agent roster');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const agents = data.agents as Array<{
    id: string;
    label: string;
    purpose: string | null;
    identity: string | null;
    liveness: string;
    harness: { label: string; backend: string | null; model: string | null };
    worktree: { root: string | null; branch: string | null };
    activeSession: { id: string } | null;
    touchedFiles: Array<{ filePath?: string | null; symbolPath?: string | null }>;
    control: { streamUrl: string | null; interruptUrl: string | null; controlCenterUrl: string; steeringChannel: string };
  }>;

  if (!agents.length) {
    console.log('No live Port Daddy agents found');
    return;
  }

  ui.info(`Active Port Daddy agents${data.project ? ` in ${data.project}` : ''}`);
  console.log('');
  for (const agent of agents) {
    const files = agent.touchedFiles
      .slice(0, 4)
      .map((claim) => claim.symbolPath ? `${claim.filePath ?? '(unknown)'}#${claim.symbolPath}` : claim.filePath)
      .filter(Boolean)
      .join(', ');
    console.log(`${agent.label} (${agent.id})`);
    console.log(`  harness: ${agent.harness.label}${agent.harness.backend ? ` / ${agent.harness.backend}` : ''}${agent.harness.model ? ` / ${agent.harness.model}` : ''}`);
    console.log(`  status:  ${agent.liveness}${agent.identity ? ` / ${agent.identity}` : ''}`);
    console.log(`  worktree:${agent.worktree.root ?? '(unknown)'}${agent.worktree.branch ? ` @ ${agent.worktree.branch}` : ''}`);
    console.log(`  doing:   ${agent.purpose ?? '(no purpose recorded)'}`);
    console.log(`  touching:${files || '(no active file claims)'}`);
    if (agent.control.streamUrl && agent.control.interruptUrl) {
      console.log(`  control: pd agent stream ${agent.id}  |  pd agent interrupt ${agent.id} --reason \"...\"`);
    } else {
      console.log('  control: no live runtime; inspect lineage before continuing');
    }
    if (agent.activeSession?.id) {
      console.log(`  session: ${agent.activeSession.id}`);
      console.log(`  ${agent.liveness === 'alive' ? 'join' : 'inspect'}:    ${PORT_DADDY_URL}${agent.control.controlCenterUrl}`);
    }
    console.log('');
  }
  console.log(`Total: ${data.count} live agent(s)`);
}

/**
 * Tail the merged cockpit SSE feed for one agent (GET /agents/:id/stream).
 *
 * Mirrors the SSE-consumption idiom in cli/commands/transcripts.ts
 * (handleTranscriptsWatch): fetch with `Accept: text/event-stream`, split the
 * stream on the `\n\n` frame delimiter, parse `event:`/`data:` lines, and print
 * one typed envelope per line until Ctrl-C. Reconnects with exponential backoff.
 */
export async function tailAgentStream(agentId: string, options: CLIOptions): Promise<void> {
  const url = `${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/stream`;

  if (IS_TTY && !isQuiet(options)) {
    ui.info(`Tailing merged stream for ${agentId}`);
    console.error('  Press Ctrl+C to stop');
    console.error('');
  }

  let buf = '';
  let abort = false;
  const ctrl = new AbortController();

  function handleSignal(): void {
    abort = true;
    ctrl.abort();
    if (!isQuiet(options) && IS_TTY) {
      console.error('');
      ui.warn('Stream stopped');
    }
    process.exit(0);
  }
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  let backoff = 1000;
  let printed404 = false;
  while (!abort) {
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      if (res.status === 404 || res.status === 400) {
        // Pre-hijack validation failures (bad/missing agent) arrive as JSON.
        if (!printed404) {
          let msg = `Cannot stream agent ${agentId}`;
          try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* noop */ }
          ui.error(msg);
          printed404 = true;
        }
        process.exit(1);
      }
      if (!res.ok || !res.body) {
        if (!isQuiet(options)) ui.warn(`Stream returned status ${res.status}; retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30000, backoff * 2);
        continue;
      }
      backoff = 1000;
      const reader = res.body as unknown as NodeJS.ReadableStream;
      for await (const chunk of reader) {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataStr = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
            else if (line.startsWith(':')) { /* heartbeat / comment */ }
          }
          if (!dataStr) continue;
          renderStreamFrame(event, dataStr, options);
        }
      }
    } catch (err) {
      if (abort) return;
      if (!isQuiet(options)) ui.warn(`Stream error: ${(err as Error).message}; retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(30000, backoff * 2);
    }
  }
}

/**
 * Render one SSE frame from the cockpit stream. The data line carries an
 * AgentStreamEnvelope ({ v, kind, agentId, body, ts }) for typed events, or a
 * small JSON object for `connected`/`timeout`/`error` control frames.
 */
function renderStreamFrame(event: string, dataStr: string, options: CLIOptions): void {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(dataStr); } catch { return; }

  if (isJson(options)) {
    console.log(JSON.stringify({ event, ...payload }));
    return;
  }

  const ts = typeof payload.ts === 'number'
    ? new Date(payload.ts).toISOString().slice(11, 19)
    : new Date().toISOString().slice(11, 19);

  if (event === 'connected') {
    if (IS_TTY) console.error(`[${ts}] connected (channel ${String(payload.channel ?? '')})`);
    return;
  }
  if (event === 'timeout' || event === 'error') {
    ui.warn(`[${ts}] ${event}: ${String((payload as { reason?: string }).reason ?? '')}`);
    return;
  }

  // Typed envelope: event === kind === payload.kind
  const kind = String(payload.kind ?? event);
  console.log(`[${ts}] ${kind}\t${JSON.stringify(payload.body ?? payload)}`);
}
