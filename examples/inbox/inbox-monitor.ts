/**
 * Inbox Monitor
 *
 * Poll your inbox for new messages, print them, and mark as read.
 *
 * Usage:
 *   npx tsx examples/inbox/inbox-monitor.ts <agent-id>
 *
 * The agent must already be registered with Port Daddy:
 *   pd agent register --agent <agent-id> --purpose "..."
 *
 * Set PORT_DADDY_URL to override the default http://localhost:9876.
 */
import { PortDaddy } from 'port-daddy/client';

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: npx tsx inbox-monitor.ts <agent-id>');
  process.exit(1);
}

const intervalMs = 5_000;
const pd = new PortDaddy({ agentId });

async function poll(): Promise<void> {
  const { messages } = await pd.inboxList(agentId, { unreadOnly: true });
  for (const msg of messages) {
    const ts = new Date(msg.createdAt).toISOString().slice(11, 19);
    const from = msg.from ?? 'system';
    console.log(`[${ts}] [${msg.type}] ${from}: ${msg.content}`);
    await pd.inboxMarkRead(agentId, msg.id);
  }
}

console.log(`Monitoring inbox for "${agentId}" every ${intervalMs / 1000}s...`);
console.log('Ctrl+C to stop.\n');

// Initial poll, then interval
poll().catch(console.error);
setInterval(() => {
  poll().catch(console.error);
}, intervalMs);
