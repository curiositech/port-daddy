import Fastify from 'fastify';
import { agentHarborRoutes } from '../../../routes/agent-harbor';

describe('malformed IP rejection', () => {
  let app;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    const db = { /* stub methods if needed */ };
    const sse = { /* stub */ };
    // register plugin with minimal options
    await app.register(agentHarborRoutes, { db, sse });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('rejects request with malformed IP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/review', // adjust path if known
      payload: { /* minimal valid body maybe */ },
      remoteAddress: 'not-an-ip',
    });
    expect(response.statusCode).toBe(403);
    // optionally check body message
    expect(response.body).toContain('Invalid IP');
    // ensure no context_pressure events logged; we can spy on db.write or event emitter
    // if plugin uses db.contextPressure.create, we can mock db.contextPressure = { create: jest.fn() }
    // then after request, expect that mock not called
    // But we need to set that before request
  });
});