// tests/unit/purser/ip-type-coercion.test.ts
import Fastify, { FastifyInstance } from 'fastify';
import agentHarborRoutes, { isLoopback } from '../../../routes/agent-harbor.ts';

// Helper to create a fresh Fastify instance with the agent‑harbor routes registered.
async function buildApp(
  deps: Record<string, unknown>
): Promise<FastifyInstance> {
  const app = Fastify();
  // The route registration function expects an object that satisfies AgentHarborDeps.
  // We only provide the pieces that the current implementation touches in the
  // validation path (context pressure persistence and optional logger).  Any extra
  // properties are ignored by the route code.
  await agentHarborRoutes(app, deps as any);
  return app;
}

describe('isLoopback – strict type handling', () => {
  const nonStringValues = [
    null,
    undefined,
    123,
    45.6,
    true,
    false,
    {},
    { address: '127.0.0.1' },
    [],
    ['127.0.0.1'],
  ];

  test.each(nonStringValues)(
    'returns false for non‑string input %p',
    (value) => {
      // @ts-expect-error – we deliberately pass a value of the wrong type.
      expect(isLoopback(value)).toBe(false);
    }
  );
});

describe('POST /agent-harbor/interactive-context-pressure – malformed IP handling', () => {
  let app: FastifyInstance;
  const mockWrite = jest.fn();

  // Minimal mock of the dependencies expected by the route.  The concrete shape
  // is inferred from the existing unit tests (see tests/unit/agent-harbor-routes.test.js).
  const deps = {
    // The route writes a “context pressure” record; we assert that it is never called.
    contextPressureRepo: { write: mockWrite },
    // Optional logger – provide a no‑op implementation to satisfy the type system.
    logger: { info: jest.fn(), error: jest.fn() },
  };

  beforeAll(async () => {
    app = await buildApp(deps);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    mockWrite.mockClear();
  });

  test('rejects request when IP metadata is missing', async () => {
    // Fastify inject defaults to 127.0.0.1; we explicitly override it with an empty string
    // which Fastify treats as “no remote address”.  The route should treat this as malformed.
    const response = await app.inject({
      method: 'POST',
      url: '/agent-harbor/interactive-context-pressure',
      remoteAddress: '',
      payload: {}, // body is irrelevant – validation should happen before parsing.
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.message).toMatch(/ip metadata.*missing|malformed/i);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('rejects request when IP metadata is a non‑IP string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agent-harbor/interactive-context-pressure',
      remoteAddress: 'not-an-ip',
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.message).toMatch(/ip metadata.*missing|malformed/i);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});