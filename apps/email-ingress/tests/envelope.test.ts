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
