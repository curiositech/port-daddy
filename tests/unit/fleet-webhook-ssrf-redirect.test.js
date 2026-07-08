// tests/unit/fleet-webhook-ssrf-redirect.test.js
//
// SSRF-via-redirect defense for the webhook output sink (security review
// finding). assertSafeOutboundUrl validates only the LITERAL recipient; with
// the default redirect:'follow', a recipient that passes the guard could 302
// to an internal HOST (169.254.169.254, 127.0.0.1, 10.x) and the fetch would
// follow it — host-controlling SSRF. The sink must pass redirect:'manual' and
// refuse the 3xx rather than chase it into the private network.

import { describe, expect, test, afterEach } from '@jest/globals';

const { WebhookOutputSink } = await import('../../lib/fleet/outputs/webhook.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('webhook output sink — redirect SSRF defense', () => {
  test('passes redirect:manual and refuses a 3xx (cannot be chased to an internal host)', async () => {
    let captured = null;
    globalThis.fetch = async (_url, init) => {
      captured = init;
      // A host that passed the guard now 302s toward cloud metadata.
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    };

    const sink = new WebhookOutputSink();
    await expect(
      sink.dispatch({
        sink: 'webhook',
        type: 'url',
        recipient: 'https://relay.example/hook', // passes assertSafeOutboundUrl
        pii: 'none', // skip the consent gate; we're testing transport, not consent
        body: 'ping',
      }),
    ).rejects.toThrow(/refused redirect/i);

    // The load-bearing option: the redirect is NOT followed.
    expect(captured?.redirect).toBe('manual');
  });

  test('a normal 2xx still delivers (the guard does not break the happy path)', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    const sink = new WebhookOutputSink();
    const res = await sink.dispatch({
      sink: 'webhook', type: 'url', recipient: 'https://relay.example/hook', pii: 'none', body: 'ping',
    });
    expect(res.receipt).toEqual({ status: 200 });
  });
});
