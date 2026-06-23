/**
 * Tests for the receiver's envelope builder + forwarder (forward.ts).
 *
 * worker.test.ts covers the end-to-end handler; this pins forward.ts directly:
 * field extraction, the GitHub-origin passthrough fields (raw_payload +
 * signature) added for daemon-side HMAC re-verification, and the forward
 * request shape / result handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildEnvelope, forwardEnvelope, type WebhookEnvelope } from '../src/forward.js';

const RAW = JSON.stringify({
  action: 'opened',
  pull_request: { number: 7 },
  repository: { full_name: 'curiositech/port-daddy', id: 42 },
  installation: { id: 9999 },
  sender: { login: 'octocat', id: 1 },
});
const SIG = 'sha256=' + 'a'.repeat(64);

describe('buildEnvelope', () => {
  it('extracts routing fields and sets the suggested channel', () => {
    const env = buildEnvelope({ event: 'pull_request', delivery: 'd-1', payload: JSON.parse(RAW), rawPayload: RAW, signature: SIG });
    expect(env.event).toBe('pull_request');
    expect(env.delivery).toBe('d-1');
    expect(env.channel).toBe('github:webhook:pull_request');
    expect(env.action).toBe('opened');
    expect(env.repository).toEqual({ full_name: 'curiositech/port-daddy', id: 42 });
    expect(env.installation_id).toBe(9999);
    expect(env.sender).toEqual({ login: 'octocat', id: 1 });
  });

  it('carries the GitHub-origin passthrough fields verbatim (raw_payload + signature)', () => {
    const env = buildEnvelope({ event: 'push', delivery: 'd-2', payload: JSON.parse(RAW), rawPayload: RAW, signature: SIG });
    // The daemon re-verifies HMAC over exactly these bytes — must be byte-identical.
    expect(env.raw_payload).toBe(RAW);
    expect(env.signature).toBe(SIG);
  });

  it('tolerates missing optional fields (no repo/sender/installation → nulls)', () => {
    const payload = { hello: 'world' };
    const env = buildEnvelope({ event: 'ping', delivery: 'd-3', payload, rawPayload: JSON.stringify(payload), signature: null });
    expect(env.repository).toBeNull();
    expect(env.installation_id).toBeNull();
    expect(env.sender).toBeNull();
    expect(env.action).toBeNull();
    expect(env.signature).toBeNull();
  });
});

function envelope(): WebhookEnvelope {
  return buildEnvelope({ event: 'pull_request', delivery: 'd-1', payload: JSON.parse(RAW), rawPayload: RAW, signature: SIG });
}

describe('forwardEnvelope', () => {
  it('POSTs JSON with bearer auth + pd webhook headers, returns ok on 2xx', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const res = await forwardEnvelope(envelope(), { url: 'https://daemon.example/msg', authToken: 'tok', timeoutMs: 8000, fetcher });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(202);

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['x-pd-webhook-event']).toBe('pull_request');
    expect(headers['x-pd-webhook-delivery']).toBe('d-1');
    // Body is the serialized envelope and includes the passthrough fields.
    const sent = JSON.parse(init.body as string) as WebhookEnvelope;
    expect(sent.raw_payload).toBe(RAW);
    expect(sent.signature).toBe(SIG);
  });

  it('returns ok:false with status on non-2xx', async () => {
    const fetcher = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    const res = await forwardEnvelope(envelope(), { url: 'https://daemon.example/msg', timeoutMs: 8000, fetcher });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.error).toContain('502');
  });

  it('returns ok:false with the error message when fetch throws', async () => {
    const fetcher = (async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
    const res = await forwardEnvelope(envelope(), { url: 'https://daemon.example/msg', timeoutMs: 8000, fetcher });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('connection refused');
  });

  it('omits the Authorization header when no token is given', async () => {
    let seen: Record<string, string> = {};
    const fetcher = (async (_u: unknown, init?: RequestInit) => {
      seen = init!.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await forwardEnvelope(envelope(), { url: 'https://daemon.example/msg', timeoutMs: 8000, fetcher });
    expect(seen['authorization']).toBeUndefined();
  });
});
