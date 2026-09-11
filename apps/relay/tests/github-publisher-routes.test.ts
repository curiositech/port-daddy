import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

function env(): Env {
  const statement = {
    bind() { return statement; },
    async first() { return null; },
    async all() { return { results: [] }; },
    async run() { return { success: true }; },
  };
  return {
    DB: { prepare: () => statement } as unknown as D1Database,
    KV: {} as KVNamespace,
    HARBOR_CHANNEL: {} as DurableObjectNamespace,
    RELAY_OPERATOR_TOKEN: 'operator-token-0123456789abcdef-0123456789abcdef',
    RELAY_ED25519_PRIVATE_KEY_HEX: '42'.repeat(32),
    GITHUB_WEBHOOK_SECRET: 'webhook-secret-0123456789abcdef',
  } as Env;
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

describe('Fleetbot publisher route', () => {
  it('is reachable at the governed endpoint and rejects missing account credentials', async () => {
    const response = await worker.fetch(new Request('https://relay.example/v1/fleetbot/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env(), ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'UNAUTHENTICATED',
      error: 'a Port Daddy account login is required',
    });
    expect(response.headers.get('X-Request-Id')).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it('does not expose non-POST methods as publisher operations', async () => {
    const response = await worker.fetch(
      new Request('https://relay.example/v1/fleetbot/publish'),
      env(),
      ctx,
    );
    expect(response.status).toBe(404);
  });
});
