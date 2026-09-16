/**
 * Integration Tests for Agent Inbox real-time pub/sub
 *
 * Verifies that:
 * 1. An agent can subscribe to their inbox via real-time SSE.
 * 2. Messages sent to the agent's inbox are received instantly without polling.
 * 3. The SDK's inboxSubscribe method works as intended.
 */

import { PortDaddy } from '../../lib/client.js';
import { request, getDaemonState } from '../helpers/integration-setup.js';
import { registerTestActorVia } from '../helpers/actor-credentials.js';

describe('Agent Inbox Real-time Integration', () => {
  const agentId = 'test-agent-' + Date.now();
  const senderAlias = 'system-test-' + Date.now();
  let pd;
  let sender;

  beforeAll(async () => {
    const { sockPath } = getDaemonState();
    // #8877 / ADR-0122: inbox sends require a daemon-minted credential, and
    // `from` must be a name that credential is entitled to. Mint a real soul
    // through the public door and BIND the alias we intend to send under, so
    // this fixture exercises the same path a real client does. The old
    // `from: 'system-test'` was an un-minted string and is now (correctly) a
    // 403 — the fix is to mint it, never to relax the route.
    sender = await registerTestActorVia(request, { alias: senderAlias });
    pd = new PortDaddy({ agentId, socketPath: sockPath, credential: sender.credential });

    // Ensure agent is registered
    const reg = await request('/agents', {
      method: 'POST',
      body: {
        id: agentId,
        purpose: 'Testing real-time inbox'
      }
    });
    if (!reg.ok) {
      console.error(`[DEBUG] Agent registration failed: HTTP ${reg.status}`, reg.text);
    }
    expect(reg.ok).toBe(true);
  });

  afterAll(async () => {
    await pd.inboxClear(agentId);
  });

  test('Should receive inbox messages in real-time via subscription', (done) => {
    const testContent = 'Hello Swarm! ' + Math.random();
    const sub = pd.inboxSubscribe(agentId);

    sub.on('connected', async () => {
      // Once connected, send a message to this agent
      try {
        await pd.inboxSend(agentId, testContent, { from: senderAlias, type: 'hail' });
      } catch (err) {
        console.error(`[DEBUG] inboxSend failed: ${err.message}`, {
          agentId,
          content: testContent,
          options: { from: senderAlias, type: 'hail' }
        });
        done(err);
      }
    });

    const timer = setTimeout(() => {
      sub.unsubscribe();
      done(new Error('Timeout: Message not received in real-time within 5s'));
    }, 5000);

    sub.on('message', (msg) => {
      try {
        expect(msg.content).toBe(testContent);
        expect(msg.from).toBe(senderAlias);
        // The daemon's own verdict rides with the message, not just the name.
        expect(msg.fromActorId).toBe(sender.actorId);
        expect(msg.agentId).toBe(agentId);
        
        clearTimeout(timer);
        sub.unsubscribe();
        done();
      } catch (err) {
        clearTimeout(timer);
        sub.unsubscribe();
        done(err);
      }
    });
  });
});
