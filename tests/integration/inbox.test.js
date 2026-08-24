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
  let agentId;
  let actor;
  let pd;

  beforeAll(async () => {
    const { sockPath } = getDaemonState();
    actor = await registerTestActorVia(request, { alias: `inbox-integration-${Date.now()}` });
    agentId = actor.actorId;
    pd = new PortDaddy({ agentId, credential: actor.credential, socketPath: sockPath });
  });

  afterAll(async () => {
    await pd.inboxMarkAllRead(agentId);
  });

  test('Should receive inbox messages in real-time via subscription', (done) => {
    const testContent = 'Hello Swarm! ' + Math.random();
    const sub = pd.inboxSubscribe(agentId);

    sub.on('connected', async () => {
      // Once connected, send a message to this agent
      try {
        await pd.inboxSend(agentId, testContent);
      } catch (err) {
        console.error(`[DEBUG] inboxSend failed: ${err.message}`, {
          agentId,
          content: testContent,
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
        expect(msg.from).toBe(agentId);
        expect(msg.type).toBe('external.authenticated');
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
