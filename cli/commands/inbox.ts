/**
 * CLI Inbox Commands
 * Direct messaging between registered agents.
 */
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { handleSub } from './messaging.js';
import { readCurrentContext } from '../utils/current-context.js';
import * as ui from '../utils/ui.js';
import { inboxMessagePreview } from '../utils/message-preview.js';

/**
 * Handle `pd inbox <subcommand>` command — top-level standalone inbox access.
 */
export async function handleInbox(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  // Resolve the ACTIVE session's durable agentId before the throwaway `cli-<pid>`.
  // The pid is ephemeral (new per invocation), so the old default made `pd inbox`
  // read a phantom mailbox and silently miss every DM to the real agent — two
  // agents on cli-<pid> can never reach each other. (Matches sessions.ts.)
  const agentId: string =
    (options.agent as string) || process.env.AGENT_ID || readCurrentContext()?.agentId || `cli-${process.pid}`;

  if (subcommand === 'watch' || options.watch) {
    // Watch inbox in real-time using SSE sub system
    const channel = `inbox:${agentId}`;
    return handleSub(channel, options);
  }

  if (!subcommand || subcommand === 'list') {
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

  } else if (subcommand === 'send') {
    // pd inbox send <target-agent> <message>
    const targetAgent = args[0];
    const message = args.slice(1).join(' ');

    if (!targetAgent || !message) {
      console.error('Usage: pd send <agent-id> <message>   (alias: pd inbox send …)');
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

  } else if (subcommand === 'stats') {
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

  } else if (subcommand === 'clear') {
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

  } else if (subcommand === 'read-all') {
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

  } else if (subcommand === 'show' || subcommand === 'read') {
    const targetId = args[0];
    if (!targetId) {
      console.error(`Usage: pd inbox ${subcommand} <message-id>`);
      process.exit(1);
    }

    const res: PdFetchResponse = await pdFetch(
      `${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox`
    );
    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to read inbox');
      process.exit(1);
    }

    const messages = data.messages as Array<{
      id: number;
      from: string | null;
      content: string;
      type: string;
      read: boolean;
      createdAt: number;
    }>;

    const msg = messages.find((m) => String(m.id) === targetId.trim());

    if (!msg) {
      ui.error(`Message with ID ${targetId} not found in inbox`);
      process.exit(1);
    }

    // Mark as read
    if (!msg.read) {
      try {
        await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/inbox/${msg.id}/read`, {
          method: 'PUT'
        });
      } catch (err) {
        // Silently ignore or log warning if marking as read fails
      }
    }

    if (isJson(options)) {
      console.log(JSON.stringify(msg, null, 2));
      return;
    }

    if (isQuiet(options)) {
      console.log(msg.content);
      return;
    }

    const time = new Date(msg.createdAt).toISOString();
    const from = msg.from || 'system';

    console.log('');
    console.log(`From:      ${from}`);
    console.log(`Timestamp: ${time}`);
    console.log(`Content:`);
    console.log('-'.repeat(40));
    console.log(msg.content);
    console.log('-'.repeat(40));

  } else if (subcommand === 'help') {
    console.log('Usage: pd inbox [subcommand] [--agent <id>] [-j] [-q]');
    console.log('');
    console.log('Subcommands:');
    console.log('  list (default)            Read inbox messages');
    console.log('  show <message-id>         Show full content of a message');
    console.log('  read <message-id>         Show full content of a message');
    console.log('  send <agent-id> <message> Send a message to an agent');
    console.log('  stats                     Get inbox statistics');
    console.log('  clear                     Clear all messages');
    console.log('  read-all                  Mark all messages as read');
    console.log('');
    console.log('Options:');
    console.log('  --agent <id>              Agent ID (default: AGENT_ID env or cli-<pid>)');
    console.log('  --unread                  Show only unread messages (list)');
    console.log('  --limit <n>               Limit number of messages (list)');
    console.log('  -j, --json                Output as JSON');
    console.log('  -q, --quiet               Minimal output');
    process.exit(0);

  } else {
    console.error(`Unknown inbox subcommand: ${subcommand}`);
    console.error('Available: list, show, read, send, stats, clear, read-all');
    process.exit(1);
  }
}

/**
 * Handle `pd sent` — read receipts: the messages YOU sent and whether each was
 * read, and when. The sender side of the inbox (`pd inbox` is the recipient side).
 */
export const SENT_HELP: string = [
  'Usage: pd sent [--unread] [--limit <n>] [--agent <id>] [-j] [-q]',
  '',
  'Show messages YOU sent and their read receipts (read + when).',
  '  --unread        Only messages not yet read by the recipient',
  '  --limit <n>     Max messages to show (default 50)',
  '  --agent <id>    Sender identity',
  '                  (default: --agent, else $AGENT_ID, else the current',
  '                   session, else cli-<pid>)',
].join('\n');

export async function handleSent(options: CLIOptions): Promise<void> {
  const agentId: string =
    (options.agent as string) || process.env.AGENT_ID || readCurrentContext()?.agentId || `cli-${process.pid}`;

  const params = new URLSearchParams();
  if (options.unread) params.append('unread', 'true');
  if (options.limit) params.append('limit', String(options.limit));

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/sent${params.toString() ? '?' + params : ''}`
  );
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to read sent messages');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const messages = data.messages as Array<{
    id: number;
    agentId: string;
    content: unknown;
    read: boolean;
    readAt: number | null;
    createdAt: number;
  }>;

  if (messages.length === 0) {
    console.log(`No sent messages for ${agentId}`);
    return;
  }

  console.log('');
  for (const msg of messages) {
    const receipt = msg.read
      ? `✓ read ${msg.readAt ? new Date(msg.readAt).toISOString().slice(11, 19) : ''}`.trim()
      : '✉ unread';
    console.log(`${receipt}  → ${msg.agentId}  ${inboxMessagePreview(msg.content, 50)}`);
  }
  console.log('');
  const count = (data as { count: number }).count;
  const readCount = messages.filter((m) => m.read).length;
  console.log(`${count} sent · ${readCount} read · ${count - readCount} unread`);
}
