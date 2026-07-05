// tests/unit/fleet-email-io.test.js
//
// Email I/O — the Phase-3/4 (sans Twilio) email channels:
//
// TRIGGER (inbound-webhook mode): the Cloudflare Email Worker POSTs an
// HMAC-signed envelope to the fleet webhook receiver; EmailTriggerSource
// verifies the HMAC, dedupes by Message-Id, applies from/subject filters,
// fans out to every subscriber, and emits with the ADR-0093 metadata
// contract: consent_verified ONLY from a DMARC pass (content-author
// verification), never from the envelope HMAC (transport).
//
// SINK: three real transports. The worker transport is proven against an
// injected fetch — URL, HMAC header (verifiable with the daemon's own
// verifyWebhookHmac), and payload are all pinned. Raw-SMTP-only config
// reports an HONEST {ready:false} instead of the old stub's pretend-ready.

import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';

const { EmailTriggerSource } = await import('../../lib/fleet/triggers/email.js');
const { EmailOutputSink } = await import('../../lib/fleet/outputs/email.js');
const { verifyWebhookHmac } = await import('../../lib/fleet/webhook-hmac.js');
const { ConsentGate, setSharedConsentGate } = await import('../../lib/fleet/consent-gate.js');
const { parseTriggerSpec } = await import('../../lib/fleet/types.js');

function makeScratch() {
  const home = process.env.HOME || '';
  try {
    return mkdtempSync(join(home, 'coding', 'tmp', 'pd-email-io-test-'));
  } catch {
    return mkdtempSync(join(tmpdir(), 'pd-email-io-test-'));
  }
}

const EMAIL_ENV_VARS = [
  'PD_EMAIL_INBOUND_SECRET', 'PD_EMAIL_IMAP_HOST', 'PD_EMAIL_IMAP_USER', 'PD_EMAIL_IMAP_PASS',
  'PD_EMAIL_OAUTH_TOKEN', 'PD_EMAIL_WORKER_URL', 'PD_EMAIL_WORKER_SECRET', 'PD_EMAIL_FROM',
  'PD_EMAIL_SENDGRID_KEY', 'PD_EMAIL_POSTMARK_KEY', 'PD_EMAIL_SMTP_HOST', 'PD_EMAIL_SMTP_USER',
  'PD_EMAIL_SMTP_PASS',
];
const savedEnv = {};
beforeEach(() => {
  for (const k of EMAIL_ENV_VARS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of EMAIL_ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setSharedConsentGate(null);
});

/** A fake receiver capturing the handler the email source registers. */
function makeReceiver() {
  const handlers = new Map();
  return {
    handlers,
    registerHandler: (channel, handler) => {
      if (handlers.has(channel)) throw new Error(`channel "${channel}" is already registered`);
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
  };
}

function signedRequest(envelope, secret) {
  const raw = Buffer.from(JSON.stringify(envelope));
  return {
    headers: {
      'x-pd-webhook-signature': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    },
    body: envelope,
    rawBody: raw,
    ip: '198.51.100.7',
  };
}

const BASE_ENVELOPE = {
  from: 'alice@example.com',
  to: ['fleet@portdaddy.dev'],
  subject: 'sensor report',
  date: '2026-07-04T12:00:00Z',
  bodyText: 'all nominal',
  hasHtml: false,
  messageId: '<m1@example.com>',
  dmarc: 'none',
};

// ─── Trigger: availability honesty ───────────────────────────────────────────

describe('EmailTriggerSource availability', () => {
  test('no inbound secret and no IMAP creds → honest refusal naming both paths', async () => {
    const src = new EmailTriggerSource({}, { registerHandler: makeReceiver().registerHandler });
    const a = await src.available();
    expect(a.ready).toBe(false);
    expect(a.requires.join(' ')).toMatch(/PD_EMAIL_INBOUND_SECRET/);
    expect(a.requires.join(' ')).toMatch(/IMAP/);
  });

  test('inbound secret + receiver dep → ready with no mailbox creds at all', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const src = new EmailTriggerSource({}, { registerHandler: makeReceiver().registerHandler });
    expect((await src.available()).ready).toBe(true);
  });
});

// ─── Trigger: inbound-webhook mode ───────────────────────────────────────────

describe('EmailTriggerSource inbound-webhook mode', () => {
  test('signed envelope emits an event; HMAC never sets consent_verified; DMARC pass does', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const receiver = makeReceiver();
    const src = new EmailTriggerSource({}, { registerHandler: receiver.registerHandler });
    const events = [];
    const handle = await src.start(parseTriggerSpec('email:received'), (e) => events.push(e));

    const handler = receiver.handlers.get('email-inbound');
    expect(handler).toBeDefined();

    // dmarc none → consent_verified false even though the HMAC verified.
    const res1 = await handler(signedRequest(BASE_ENVELOPE, 's3cret'));
    expect(res1.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('email');
    expect(events[0].metadata.sender).toBe('alice@example.com');
    expect(events[0].metadata.consent_verified).toBe(false);

    // dmarc pass → consent_verified true (content-author verification).
    const res2 = await handler(signedRequest(
      { ...BASE_ENVELOPE, messageId: '<m2@example.com>', dmarc: 'pass' }, 's3cret',
    ));
    expect(res2.status).toBe(200);
    expect(events[1].metadata.consent_verified).toBe(true);

    await handle.stop();
    expect(receiver.handlers.has('email-inbound')).toBe(false);
  });

  test('bad signature is a 401 and emits nothing', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const receiver = makeReceiver();
    const src = new EmailTriggerSource({}, { registerHandler: receiver.registerHandler });
    const events = [];
    const handle = await src.start(parseTriggerSpec('email:received'), (e) => events.push(e));

    const req = signedRequest(BASE_ENVELOPE, 'WRONG-secret');
    const res = await receiver.handlers.get('email-inbound')(req);
    expect(res.status).toBe(401);
    expect(events).toHaveLength(0);
    await handle.stop();
  });

  test('malformed envelope is a 400', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const receiver = makeReceiver();
    const src = new EmailTriggerSource({}, { registerHandler: receiver.registerHandler });
    const handle = await src.start(parseTriggerSpec('email:received'), () => {});
    const res = await receiver.handlers.get('email-inbound')(signedRequest({ nonsense: true }, 's3cret'));
    expect(res.status).toBe(400);
    await handle.stop();
  });

  test('duplicate Message-Id is deduped (Worker redelivery cannot double-fire an agent)', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const receiver = makeReceiver();
    const src = new EmailTriggerSource({}, { registerHandler: receiver.registerHandler });
    const events = [];
    const handle = await src.start(parseTriggerSpec('email:received'), (e) => events.push(e));
    const handler = receiver.handlers.get('email-inbound');
    await handler(signedRequest(BASE_ENVELOPE, 's3cret'));
    const dup = await handler(signedRequest(BASE_ENVELOPE, 's3cret'));
    expect(dup.body.deduped).toBe(true);
    expect(events).toHaveLength(1);
    await handle.stop();
  });

  test('two subscribers with different filters fan out from one channel registration', async () => {
    process.env.PD_EMAIL_INBOUND_SECRET = 's3cret';
    const receiver = makeReceiver();
    const src = new EmailTriggerSource({}, { registerHandler: receiver.registerHandler });
    const teamEvents = [];
    const newsletterEvents = [];
    const h1 = await src.start(parseTriggerSpec('email:received(from:@example.com)'), (e) => teamEvents.push(e));
    const h2 = await src.start(parseTriggerSpec('email:received(from:newsletter@*)'), (e) => newsletterEvents.push(e));
    // One registration serves both.
    expect(receiver.handlers.size).toBe(1);

    const res = await receiver.handlers.get('email-inbound')(signedRequest(BASE_ENVELOPE, 's3cret'));
    expect(res.body.matched).toBe(1); // only the @example.com filter matches
    expect(teamEvents).toHaveLength(1);
    expect(newsletterEvents).toHaveLength(0);

    // Channel stays registered until the LAST subscriber stops.
    await h1.stop();
    expect(receiver.handlers.has('email-inbound')).toBe(true);
    await h2.stop();
    expect(receiver.handlers.has('email-inbound')).toBe(false);
  });
});

// ─── Sink: transports ────────────────────────────────────────────────────────

describe('EmailOutputSink', () => {
  test('no transport → honest refusal; SMTP-only → honest "not implemented"', async () => {
    let a = await new EmailOutputSink().available();
    expect(a.ready).toBe(false);
    expect(a.requires.join(' ')).toMatch(/PD_EMAIL_WORKER_URL/);

    process.env.PD_EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.PD_EMAIL_SMTP_USER = 'u';
    process.env.PD_EMAIL_SMTP_PASS = 'p';
    process.env.PD_EMAIL_FROM = 'me@example.com';
    a = await new EmailOutputSink().available();
    expect(a.ready).toBe(false);
    expect(a.reason).toMatch(/SMTP is not implemented/i);
  });

  test('worker transport POSTs an HMAC-signed /send the daemon-side verifier accepts', async () => {
    process.env.PD_EMAIL_WORKER_URL = 'https://pd-email-ingress.example.workers.dev';
    process.env.PD_EMAIL_WORKER_SECRET = 'out-secret';

    const dir = makeScratch();
    try {
      const gate = new ConsentGate({ configPath: join(dir, 'consents.json'), auditLogPath: join(dir, 'audit.log') });
      gate.grant({ sink: 'email', maxPii: 'high', grantedAt: Date.now(), reason: 'test' });
      setSharedConsentGate(gate);

      const calls = [];
      const fakeFetch = async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ sent: true }),
          text: async () => '',
        };
      };
      const sink = new EmailOutputSink(fakeFetch);
      expect((await sink.available()).ready).toBe(true);

      const result = await sink.dispatch({
        sink: 'email',
        type: 'send',
        recipient: 'erich@example.com',
        title: 'Fleet digest',
        body: 'All quiet.',
        pii: 'high',
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://pd-email-ingress.example.workers.dev/send');
      // The signature must verify with the daemon's own HMAC verifier.
      const sig = calls[0].init.headers['x-pd-webhook-signature'];
      expect(verifyWebhookHmac(Buffer.from(calls[0].init.body), 'out-secret', sig)).toBe(true);
      expect(JSON.parse(calls[0].init.body).to).toBe('erich@example.com');
      expect(result.receipt.transport).toBe('worker');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('worker transport surfaces a non-2xx as a typed error (no silent success)', async () => {
    process.env.PD_EMAIL_WORKER_URL = 'https://pd-email-ingress.example.workers.dev';
    process.env.PD_EMAIL_WORKER_SECRET = 'out-secret';
    const dir = makeScratch();
    try {
      const gate = new ConsentGate({ configPath: join(dir, 'consents.json'), auditLogPath: join(dir, 'audit.log') });
      gate.grant({ sink: 'email', maxPii: 'high', grantedAt: Date.now() });
      setSharedConsentGate(gate);

      const sink = new EmailOutputSink(async () => ({
        ok: false, status: 502, headers: { get: () => null },
        json: async () => ({}), text: async () => 'recipient not verified',
      }));
      await expect(sink.dispatch({
        sink: 'email', type: 'send', recipient: 'x@y.z', title: 's', body: 'b', pii: 'high',
      })).rejects.toThrow(/502.*recipient not verified/s);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('consent is still mandatory: no grant → PD_CONSENT_DENIED', async () => {
    process.env.PD_EMAIL_WORKER_URL = 'https://pd-email-ingress.example.workers.dev';
    process.env.PD_EMAIL_WORKER_SECRET = 'out-secret';
    const dir = makeScratch();
    try {
      setSharedConsentGate(new ConsentGate({ configPath: join(dir, 'none.json'), auditLogPath: join(dir, 'audit.log') }));
      const sink = new EmailOutputSink(async () => { throw new Error('must not reach fetch'); });
      await expect(sink.dispatch({
        sink: 'email', type: 'send', recipient: 'x@y.z', title: 's', body: 'b', pii: 'high',
      })).rejects.toThrow(/consent/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
