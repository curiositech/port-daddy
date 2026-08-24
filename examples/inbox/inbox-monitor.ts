/**
 * Inbox Monitor
 *
 * Poll your inbox for new messages, print them, and mark as read.
 *
 * Usage:
 *   PORT_DADDY_ACTOR_CREDENTIAL=<credential> npx tsx examples/inbox/inbox-monitor.ts <canonical-actor-id>
 *
 * The actor must already have a live daemon-bound inbox. An actor ID or alias
 * alone is never read authority.
 */
import { PortDaddy } from '../../lib/client.js';

const agentId = process.argv[2];
const credential = process.env.PORT_DADDY_ACTOR_CREDENTIAL ?? process.env.PD_ACTOR_CREDENTIAL;
if (!agentId || !credential?.trim()) {
  console.error('Usage: PORT_DADDY_ACTOR_CREDENTIAL=<credential> npx tsx inbox-monitor.ts <canonical-actor-id>');
  process.exit(1);
}

const pd = new PortDaddy({ agentId, credential });

console.log(`Monitoring inbox for "${agentId}" via real-time pub/sub...`);
console.log('Ctrl+C to stop.\n');

// Subscribe to real-time inbox messages
const sub = pd.inboxSubscribe(agentId);

sub.on('message', async (data: any) => {
  // data is the full message object published by the server
  const ts = new Date(data.createdAt || Date.now()).toISOString().slice(11, 19);
  const from = data.from || data.sender || 'system';

  console.log(`[${ts}] [${data.type || 'message'}] ${from}: ${data.content}`);

  // Mark as read after receiving
  if (data.id) {
    await pd.inboxMarkRead(agentId, data.id);
  }
});

sub.on('error', (err) => {
  console.error('Subscription error:', err);
});

sub.on('connected', () => {
  console.log('Connected to inbox stream. Waiting for messages...');
});
