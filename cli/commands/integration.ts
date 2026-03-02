/**
 * CLI Integration Commands
 *
 * Thin wrappers over pub/sub for cross-agent integration signals.
 * Channels: integration:<project>:ready, integration:<project>:needs
 *
 * Handles: pd integration ready/needs/list
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Handle `pd integration <subcommand>` commands
 */
export async function handleIntegration(
  subcommand: string | undefined,
  rest: string[],
  options: CLIOptions
): Promise<void> {
  if (!subcommand) {
    console.error('Usage: port-daddy integration <ready|needs|list> [args]');
    console.error('');
    console.error('Commands:');
    console.error('  ready <identity> "description"   Signal that work is ready for integration');
    console.error('  needs <identity> "description"   Signal that work needs something from another agent');
    console.error('  list [--project PROJECT]         Show recent integration messages');
    console.error('');
    console.error('Examples:');
    console.error('  pd integration ready myapp:api "Auth module complete, API ready for frontend"');
    console.error('  pd integration needs myapp:frontend "Waiting for API auth endpoints"');
    console.error('  pd integration list --project myapp');
    process.exit(1);
  }

  switch (subcommand) {
    case 'ready':
      return integrationSignal('ready', rest, options);
    case 'needs':
      return integrationSignal('needs', rest, options);
    case 'list':
      return integrationList(options);
    default:
      console.error(`Unknown integration command: ${subcommand}`);
      console.error('Run "port-daddy integration" for usage');
      process.exit(1);
  }
}

async function integrationSignal(type: 'ready' | 'needs', rest: string[], options: CLIOptions): Promise<void> {
  const identity = rest[0];
  const description = rest.slice(1).join(' ');

  if (!identity || !description) {
    console.error(`Usage: port-daddy integration ${type} <identity> "description"`);
    process.exit(1);
  }

  // Extract project from identity (first segment of project:stack:context)
  const project = identity.split(':')[0];
  const channel = `integration:${project}:${type}`;

  const payload = {
    type,
    identity,
    description,
    timestamp: Date.now(),
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, sender: identity })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || `Failed to publish ${type} signal`));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ ...data, channel, type, identity, description }, null, 2));
  } else if (isQuiet(options)) {
    console.log(channel);
  } else {
    const emoji = type === 'ready' ? 'ready' : 'needs';
    console.log(maritimeStatus('success', `[${emoji}] ${identity}: ${description}`));
    console.log(`  Channel: ${channel}`);
  }
}

async function integrationList(options: CLIOptions): Promise<void> {
  // List all integration channels
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list channels'));
    process.exit(1);
  }

  const channels = data.channels as Array<{ channel: string; count: number; lastMessage: number }>;
  const integrationChannels = channels.filter(c => c.channel.startsWith('integration:'));

  // Filter by project if specified
  const project = options.project as string | undefined;
  const filtered = project
    ? integrationChannels.filter(c => c.channel.startsWith(`integration:${project}:`))
    : integrationChannels;

  if (filtered.length === 0) {
    if (!isQuiet(options)) {
      const msg = project ? `No integration signals for project: ${project}` : 'No integration signals';
      console.log(msg);
    }
    return;
  }

  // Fetch messages from each integration channel
  const allMessages: Array<{
    channel: string;
    type: string;
    identity: string;
    description: string;
    timestamp: number;
    sender: string | null;
  }> = [];

  for (const ch of filtered) {
    const msgRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(ch.channel)}?limit=10`);
    if (!msgRes.ok) continue;
    const msgData = await msgRes.json();
    const messages = msgData.messages as Array<{ payload: unknown; sender: string | null; createdAt: number }>;

    for (const msg of messages) {
      const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
      allMessages.push({
        channel: ch.channel,
        type: (payload as Record<string, unknown>).type as string || 'unknown',
        identity: (payload as Record<string, unknown>).identity as string || msg.sender || 'unknown',
        description: (payload as Record<string, unknown>).description as string || '',
        timestamp: (payload as Record<string, unknown>).timestamp as number || msg.createdAt,
        sender: msg.sender,
      });
    }
  }

  // Sort by timestamp descending
  allMessages.sort((a, b) => b.timestamp - a.timestamp);

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, signals: allMessages, count: allMessages.length }, null, 2));
    return;
  }

  const now = Date.now();
  console.log('TYPE'.padEnd(8) + 'IDENTITY'.padEnd(25) + 'DESCRIPTION'.padEnd(40) + 'AGE');
  console.log('\u2500'.repeat(78));

  for (const msg of allMessages) {
    const age = formatAge(now - msg.timestamp);
    const desc = msg.description.length > 38 ? msg.description.slice(0, 35) + '...' : msg.description.padEnd(40);
    console.log(
      `${msg.type.padEnd(8)}${msg.identity.slice(0, 23).padEnd(25)}${desc}${age}`
    );
  }
  console.log('');
  console.log(`Total: ${allMessages.length} signal(s)`);
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
