import Fastify from 'fastify';
import { parleyPlugin } from '../../../routes/parley.js';

describe('Parley harbor handling for mixed query/body parameters', () => {
  let app;
  let lastRespondArgs = null;
  let lastResolveArgs = null;
  let lastGetArgs = null;

  const fakeParley = {
    async respond(args) {
      lastRespondArgs = args;
      // Return a turn that echoes the harbor we received
      return {
        turn: { parleyId: args.parleyId, harbor: args.harbor },
        notified: [],
        notifyFailures: [],
      };
    },
    async resolve(args) {
      lastResolveArgs = args;
      return {
        turn: { parleyId: args.parleyId, harbor: args.harbor },
        notified: [],
        notifyFailures: [],
      };
    },
    async get(parleyId, harbor) {
      lastGetArgs = [parleyId, harbor];
      return { parleyId, harbor, status: 'open' };
    },
    async markSeen() {},
    async list() {
      return [];
    },
  };

  beforeEach(async () => {
    lastRespondArgs = null;
    lastResolveArgs = null;
    lastGetArgs = null;

    app = Fastify();
    await app.register(parleyPlugin, { deps: { parley: fakeParley } });
    await app.ready();
  });

  test('POST /parley/respond: body harbor overrides query harbor', async () => {
    const payload = {
      parleyId: 'p1',
      harbor: 'body-harbor',
      party: 'agent-a',
      performative: 'propose',
      content: 'test',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/parley/respond?harbor=query-harbor',
      payload,
    });

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.payload);
    // The handler should have used the harbor from the body, not the query string
    expect(lastRespondArgs).toMatchObject({ harbor: 'body-harbor' });
    // The subsequent status lookup must also have been performed with the body harbor
    expect(lastGetArgs).toEqual(['p1', 'body-harbor']);
    expect(json.status.harbor).toBe('body-harbor');
  });

  test('POST /parley/respond: harbor supplied only via query is rejected (no silent fallback)', async () => {
    const payload = {
      parleyId: 'p2',
      // No harbor field in the body
      party: 'agent-a',
      performative: 'propose',
      content: 'test',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/parley/respond?harbor=only-query',
      payload,
    });

    // The route should refuse to accept a harbor that is not present in the request body
    expect(response.statusCode).toBe(400);
    const json = JSON.parse(response.payload);
    expect(json.message).toMatch(/harbor/i);
  });

  test('GET /parley/:id: query harbor is used even if a body harbor is present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/parley/p1?harbor=query-harbor',
      // Fastify allows a payload on GET; we include a conflicting harbor to test precedence
      payload: { harbor: 'body-ignored' },
    });

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.payload);
    // The GET handler must prioritize the query string over any body payload
    expect(lastGetArgs).toEqual(['p1', 'query-harbor']);
    expect(json.status.harbor).toBe('query-harbor');
  });
});