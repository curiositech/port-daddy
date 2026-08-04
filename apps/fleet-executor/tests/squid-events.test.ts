/**
 * Tests for the cloud squid (src/squid-events.ts): fire-and-forget coordination
 * events on channel 'fleet-cloud'. The hard contract under test: silently
 * disabled unless BOTH vars are set, correct envelope + bearer auth when
 * enabled, and NEVER throwing — not on a rejected fetch, not on a throwing
 * fetch, not on a bogus URL.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { emitSquidEvent, SQUID_CHANNEL } from '../src/squid-events.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl?: () => Promise<Response>) {
  const fn = vi.fn(impl ?? (async () => new Response('{}', { status: 200 })));
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

const PAYLOAD = { repo: 'o/r', pr: 7, runId: 'run:d-1' };

describe('emitSquidEvent', () => {
  it('is silently disabled when either var is missing (zero fetches)', () => {
    const fn = stubFetch();
    emitSquidEvent({}, 'run-started', PAYLOAD);
    emitSquidEvent({ RELAY_PUBLISH_URL: 'https://relay.example/pub' }, 'run-started', PAYLOAD);
    emitSquidEvent({ RELAY_PUBLISH_TOKEN: 'tok' }, 'run-started', PAYLOAD);
    emitSquidEvent({ RELAY_PUBLISH_URL: '', RELAY_PUBLISH_TOKEN: '' }, 'run-started', PAYLOAD);
    expect(fn).not.toHaveBeenCalled();
  });

  it('POSTs the publish envelope with bearer auth on channel fleet-cloud', () => {
    const fn = stubFetch();
    emitSquidEvent(
      { RELAY_PUBLISH_URL: 'https://relay.example/pub', RELAY_PUBLISH_TOKEN: 'sekrit' },
      'ship-verdict',
      { ...PAYLOAD, ship: 'code-reviewer', verdict: 'PASS' },
    );
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.example/pub');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekrit');
    const body = JSON.parse(String(init.body)) as {
      event: { channel: string; type: string; sender: string; iat: number; payload: unknown };
    };
    expect(body.event.channel).toBe(SQUID_CHANNEL);
    expect(body.event.type).toBe('ship-verdict');
    expect(body.event.sender).toBe('fleet-executor');
    expect(typeof body.event.iat).toBe('number');
    expect(body.event.payload).toEqual({ ...PAYLOAD, ship: 'code-reviewer', verdict: 'PASS' });
  });

  it('never throws when fetch rejects (fire-and-forget)', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });
    expect(() =>
      emitSquidEvent(
        { RELAY_PUBLISH_URL: 'https://relay.example/pub', RELAY_PUBLISH_TOKEN: 't' },
        'run-concluded',
        { ...PAYLOAD, verdict: 'success' },
      ),
    ).not.toThrow();
    // Let the rejected promise settle — an unhandled rejection would fail the test.
    await new Promise(r => setTimeout(r, 0));
  });

  it('never throws when fetch itself throws synchronously', () => {
    const fn = vi.fn(() => {
      throw new Error('sync boom');
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    expect(() =>
      emitSquidEvent(
        { RELAY_PUBLISH_URL: 'https://relay.example/pub', RELAY_PUBLISH_TOKEN: 't' },
        'pr-stacked',
        { ...PAYLOAD, ship: 'spark', url: 'https://github.com/x' },
      ),
    ).not.toThrow();
  });
});
