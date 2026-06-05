/**
 * Integration: prove the inbound GitHub webhook route closes the dispatch
 * loop. A pd-fleet.yml agent declaring `trigger: global:github:webhook:<event>`
 * resolves (via resolveFleetChannel) to the EXACT literal channel the route
 * publishes onto the real messaging bus — so the fleet engine's
 * messaging.subscribe(...) fires when a webhook arrives.
 */
import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';
import { resolveFleetChannel } from '../../lib/fleet-channels.js';
import { githubWebhookPlugin } from '../../routes/github-webhook.js';

describe('github webhook → fleet dispatch loop (real messaging)', () => {
  test('a global: github trigger receives the webhook the route publishes', async () => {
    const db = createTestDb();
    const messaging = createMessaging(db);
    const app = Fastify();
    await app.register(githubWebhookPlugin, {
      deps: { messaging, logger: createMockLogger(), metrics: { errors: 0, messages_published: 0 } },
    });

    // What a fleet agent would declare in pd-fleet.yml. The engine resolves
    // this exact string through resolveFleetChannel before subscribing.
    const agentTrigger = 'global:github:webhook:pull_request';
    const subscribedChannel = resolveFleetChannel(agentTrigger, '/repos/curiositech/port-daddy', 'port-daddy');

    // The keystone equivalence: the resolved subscribe channel === the literal
    // channel the inbound route publishes.
    expect(subscribedChannel).toBe('github:webhook:pull_request');

    const received = [];
    const unsubscribe = messaging.subscribe(subscribedChannel, (msg) => received.push(msg));
    expect(unsubscribe).toBeTruthy();

    process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: { 'x-github-event': 'pull_request' },
        payload: {
          action: 'opened',
          repository: { full_name: 'curiositech/port-daddy' },
          sender: { login: 'octocat' },
          pull_request: { number: 7, title: 'Wire it up' },
        },
      });
      expect(res.statusCode).toBe(204);
    } finally {
      delete process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH;
    }

    // The subscriber (i.e. the fleet engine) saw the event.
    expect(received).toHaveLength(1);
    expect(received[0].sender).toBe('octocat');
    expect(received[0].payload).toEqual(expect.objectContaining({
      event: 'pull_request',
      action: 'opened',
      repository: expect.objectContaining({ full_name: 'curiositech/port-daddy' }),
    }));
    expect(received[0].payload.payload).toEqual(expect.objectContaining({
      pull_request: expect.objectContaining({ number: 7 }),
    }));

    unsubscribe();
    db.close?.();
  });
});
