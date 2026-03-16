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

const pd = new PortDaddy({ agentId });

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
  console.log('📡 Connected to swarm radio. Waiting for messages...');
});
