// Pure-function tests for the email ingress envelope helpers. The trust
// consequences are real: parseDmarc feeds consent_verified in the daemon's
// email trigger, and signBody must match the daemon's verifyWebhookHmac
// byte-for-byte.

import { describe, expect, test } from 'vitest';
import { buildInboundEnvelope, parseDmarc, signBody, verifySignature } from '../src/envelope.js';

describe('parseDmarc', () => {
  test('extracts pass/fail verdicts', () => {
    expect(parseDmarc('mx.cloudflare.net; dkim=pass header.d=gmail.com; dmarc=pass action=none')).toBe('pass');
    expect(parseDmarc('mx.cloudflare.net; spf=pass; dmarc=fail action=quarantine')).toBe('fail');
  });

  test('anything else — missing header, no dmarc clause, weird verdicts — is none (never guess pass)', () => {
    expect(parseDmarc(null)).toBe('none');
    expect(parseDmarc(undefined)).toBe('none');
    expect(parseDmarc('')).toBe('none');
    expect(parseDmarc('spf=pass dkim=pass')).toBe('none');
    expect(parseDmarc('dmarc=bestguess')).toBe('none');
  });

  test('does not match a dmarc= substring inside another token', () => {
    expect(parseDmarc('x-fake-dmarc=pass')).toBe('none');
  });
});

describe('buildInboundEnvelope', () => {
  test('builds a complete envelope with dmarc verdict', () => {
    const env = buildInboundEnvelope({
      from: 'alice@example.com',
      to: 'fleet@portdaddy.dev',
      subject: 'sensor report',
      date: '2026-07-04T12:00:00Z',
      bodyText: 'all systems nominal',
      hasHtml: false,
      messageId: '<abc@example.com>',
      references: '<r1@x> <r2@x>',
      authenticationResults: 'dmarc=pass',
    });
    expect(env.from).toBe('alice@example.com');
    expect(env.to).toEqual(['fleet@portdaddy.dev']);
    expect(env.references).toEqual(['<r1@x>', '<r2@x>']);
    expect(env.dmarc).toBe('pass');
  });

  test('caps the body so attachment-laden mail cannot balloon the envelope', () => {
    const env = buildInboundEnvelope({
      from: 'a@b.c',
      to: 'x@y.z',
      subject: null,
      date: null,
      bodyText: 'x'.repeat(200_000),
      hasHtml: true,
      messageId: null,
      references: null,
      authenticationResults: null,
    });
    expect(env.bodyText.length).toBe(64_000);
    expect(env.dmarc).toBe('none');
  });
});

describe('signBody / verifySignature', () => {
  test('round-trips and matches the daemon header format', async () => {
    const sig = await signBody('{"a":1}', 'secret-key');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifySignature('{"a":1}', 'secret-key', sig)).toBe(true);
  });

  test('rejects wrong secret, tampered body, missing header', async () => {
    const sig = await signBody('{"a":1}', 'secret-key');
    expect(await verifySignature('{"a":1}', 'other-key', sig)).toBe(false);
    expect(await verifySignature('{"a":2}', 'secret-key', sig)).toBe(false);
    expect(await verifySignature('{"a":1}', 'secret-key', null)).toBe(false);
  });
});

describe('postWithRetry', () => {
  const noSleep = async () => {};

  test('retries network errors and 5xx, succeeds when the daemon comes back', async () => {
    const { postWithRetry } = await import('../src/envelope.js');
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new Error('connect ECONNREFUSED');
      if (calls === 2) return new Response('oops', { status: 503 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await postWithRetry(flaky, 'https://d/x', {}, [1, 1], noSleep);
    expect(result).toEqual(expect.objectContaining({ ok: true, attempts: 3 }));
  });

  test('4xx is terminal — retrying cannot fix a bad signature', async () => {
    const { postWithRetry } = await import('../src/envelope.js');
    let calls = 0;
    const rejecting = (async () => {
      calls += 1;
      return new Response('bad sig', { status: 401 });
    }) as unknown as typeof fetch;
    const result = await postWithRetry(rejecting, 'https://d/x', {}, [1, 1], noSleep);
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(result.error).toMatch(/terminal 401/);
  });

  test('exhausted retries report the last error', async () => {
    const { postWithRetry } = await import('../src/envelope.js');
    const down = (async () => { throw new Error('tunnel down'); }) as unknown as typeof fetch;
    const result = await postWithRetry(down, 'https://d/x', {}, [1, 1], noSleep);
    expect(result).toEqual(expect.objectContaining({ ok: false, attempts: 3 }));
    expect(result.error).toMatch(/tunnel down/);
  });
});

describe('postWithRetry timeouts', () => {
  test('a per-attempt timeout (AbortError) is retryable, not fatal', async () => {
    const { postWithRetry } = await import('../src/envelope.js');
    let calls = 0;
    const hangsOnce = (async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await postWithRetry(hangsOnce, 'https://d/x', {}, [1], async () => {}, 50);
    expect(result).toEqual(expect.objectContaining({ ok: true, attempts: 2 }));
  });
});
