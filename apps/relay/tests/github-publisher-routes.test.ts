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
  it('is reachable at the governed endpoint and rejects malformed capability-v2 input', async () => {
    const response = await worker.fetch(new Request('https://relay.example/v1/fleetbot/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env(), ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'publisher request envelope is invalid',
    });
    expect(response.headers.get('X-Request-Id')).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it('does not restore the retired operator bearer path', async () => {
    const response = await worker.fetch(new Request('https://relay.example/v1/fleetbot/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer pdu_${'ab'.repeat(32)}`,
      },
      body: '{}',
    }), env(), ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('does not expose non-POST methods as publisher operations', async () => {
    const response = await worker.fetch(
      new Request('https://relay.example/v1/fleetbot/publish'),
      env(),
      ctx,
    );
    expect(response.status).toBe(404);
  });

  it('routes exact grant snapshot reads through signed workload authentication', async () => {
    const response = await worker.fetch(
      new Request(`https://relay.example/v1/fleetbot/publisher-grants/pdg_${'ab'.repeat(16)}`),
      env(),
      ctx,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'WORKLOAD_PROOF_INVALID' });
  });

  it('routes receipt recovery only as a bounded signed POST', async () => {
    const response = await worker.fetch(new Request(
      'https://relay.example/v1/fleetbot/publisher-receipts/recover',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ), env(), ctx);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'WORKLOAD_PROOF_INVALID' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const get = await worker.fetch(new Request(
      'https://relay.example/v1/fleetbot/publisher-receipts/recover',
    ), env(), ctx);
    expect(get.status).toBe(404);
  });
});
