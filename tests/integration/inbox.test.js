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

describe('Agent Inbox Real-time Integration', () => {
  const agentId = 'test-agent-' + Date.now();
  let pd;

  beforeAll(async () => {
    const { sockPath } = getDaemonState();
    pd = new PortDaddy({ agentId, socketPath: sockPath });

    // Ensure agent is registered
    await request('/agents', {
      method: 'POST',
      body: {
        agentId,
        purpose: 'Testing real-time inbox'
      }
    });
  });

  afterAll(async () => {
    await pd.inboxClear(agentId);
  });

  test('Should receive inbox messages in real-time via subscription', (done) => {
    const testContent = 'Hello Swarm! ' + Math.random();
    const sub = pd.inboxSubscribe(agentId);

    sub.on('connected', async () => {
      // Once connected, send a message to this agent
      await pd.inboxSend(agentId, testContent, { from: 'system-test', type: 'hail' });
    });

    const timer = setTimeout(() => {
      sub.unsubscribe();
      done(new Error('Timeout: Message not received in real-time within 5s'));
    }, 5000);

    sub.on('message', (msg) => {
      try {
        expect(msg.content).toBe(testContent);
        expect(msg.from).toBe('system-test');
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
