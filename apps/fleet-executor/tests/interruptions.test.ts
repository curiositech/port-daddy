/**
 * Tests for HITL interruption escalation (src/interruptions.ts): fire-and-forget
 * POSTs to the relay's /v1/interruptions. The hard contract under test:
 * silently disabled unless BOTH env vars are set, correct payload + bearer auth
 * when enabled, and NEVER throwing — not on a rejected fetch, not on a throwing
 * fetch, not on a bogus URL. (The purser call-site wiring is covered in
 * tests/purser.test.ts.)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { emitInterruption } from '../src/interruptions.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl?: () => Promise<Response>) {
  const fn = vi.fn(impl ?? (async () => new Response('{}', { status: 201 })));
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

const ASK = {
  title: 'Grant contents:write',
  body: 'Cannot push the test branch.',
  urgency: 'high' as const,
  sourceAgent: 'fleet-executor/purser',
  sourceSession: 'run:d-1',
  installationId: 42,
};

describe('emitInterruption', () => {
  it('is silently disabled when either var is missing (zero fetches)', () => {
    const fn = stubFetch();
    emitInterruption({}, ASK);
    emitInterruption({ INTERRUPTIONS_URL: 'https://relay.example/v1/interruptions' }, ASK);
    emitInterruption({ INTERRUPTIONS_TOKEN: 'pdu_x' }, ASK);
    emitInterruption({ INTERRUPTIONS_URL: '', INTERRUPTIONS_TOKEN: '' }, ASK);
    expect(fn).not.toHaveBeenCalled();
  });

  it('POSTs the relay create-interruption payload with bearer auth', () => {
    const fn = stubFetch();
    emitInterruption(
      { INTERRUPTIONS_URL: 'https://relay.example/v1/interruptions', INTERRUPTIONS_TOKEN: 'sekrit' },
      ASK,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.example/v1/interruptions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekrit');
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Grant contents:write',
      body: 'Cannot push the test branch.',
      urgency: 'high',
      source_agent: 'fleet-executor/purser',
      source_session: 'run:d-1',
      installation_id: 42,
    });
  });

  it('omits optional fields it does not have', () => {
    const fn = stubFetch();
    emitInterruption(
      { INTERRUPTIONS_URL: 'https://relay.example/v1/interruptions', INTERRUPTIONS_TOKEN: 't' },
      { title: 't', body: 'b', urgency: 'critical', sourceAgent: 'fleet-executor/purser' },
    );
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('source_session');
    expect(body).not.toHaveProperty('installation_id');
  });

  it('NEVER throws: rejected fetch, throwing fetch, bogus URL are all swallowed', async () => {
    const rejecting = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', rejecting as unknown as typeof fetch);
    const env = { INTERRUPTIONS_URL: 'https://relay.example/v1/interruptions', INTERRUPTIONS_TOKEN: 't' };
    expect(() => emitInterruption(env, ASK)).not.toThrow();
    await new Promise(r => setTimeout(r, 0)); // the swallowed rejection settles

    const throwingSync = vi.fn(() => {
      throw new Error('sync explosion');
    });
    vi.stubGlobal('fetch', throwingSync as unknown as typeof fetch);
    expect(() => emitInterruption(env, ASK)).not.toThrow();

    vi.stubGlobal('fetch', stubFetch());
    expect(() =>
      emitInterruption({ INTERRUPTIONS_URL: 'not a url at all', INTERRUPTIONS_TOKEN: 't' }, ASK),
    ).not.toThrow();
  });
});
