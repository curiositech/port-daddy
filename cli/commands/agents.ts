/**
 * CLI Agent Commands
 *
 * Handles: agent, agents commands for multi-agent coordination
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';

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
    process.exit(1);
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
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to register agent'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.registered ? `Registered agent: ${agentId}` : `Updated agent: ${agentId}`);

        // Show salvage notice if there are dead agents in the same project
        if (data.salvageHint) {
          console.log('');
          console.log(maritimeStatus('warning', data.salvageHint as string));
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
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to send heartbeat'));
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
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to unregister agent'));
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
          console.error(maritimeStatus('error', (data.error as string) || 'Failed to read inbox'));
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
          console.error(maritimeStatus('error', (data.error as string) || 'Failed to send message'));
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
          console.error(maritimeStatus('error', (data.error as string) || 'Failed to get inbox stats'));
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
          console.error(maritimeStatus('error', (data.error as string) || 'Failed to clear inbox'));
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
          console.error(maritimeStatus('error', (data.error as string) || 'Failed to mark as read'));
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
        console.error(maritimeStatus('error', (data.error as string) || 'Agent not found'));
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
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list agents'));
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
