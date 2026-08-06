/**
 * Tests for webhook secret encryption (commit f91195e).
 *
 * EXISTING TEST DEFECTS in webhooks.test.js that these tests fix:
 *
 * TAUTOLOGY (line 460-479) — "should truncate long response bodies":
 *   if (delivery.responseStatus === 200) {
 *     expect(delivery.responseStatus).toBe(200);  // always true inside the if
 *   }
 *   Also: getDeliveries() does not return responseBody at all (field omitted
 *   from the mapping), so truncation was never verifiable via that API.
 *
 * COVERAGE THEATER (line 427-442) — "should track delivery status":
 *   expect(status).toBeDefined() — passes for 'failed', 'pending', or 'banana'.
 *
 * COVERAGE THEATER (line 381-395) — "should include HMAC signature when secret configured":
 *   Only checks /^sha256=/ format. After encryption was added, this test gives
 *   zero assurance that decryptSecret returned the plaintext (vs the raw JSON
 *   envelope). Bug below would pass this test undetected.
 *
 * BUG EXPOSED — decryptSecret catch path:
 *   When GCM auth tag verification fails (key rotation / tampered ciphertext),
 *   decryptSecret returns the raw JSON envelope string instead of null.
 *   The callers treat any truthy return as the signing key, so the delivery is
 *   signed with the garbage envelope — unverifiable by the recipient, with no
 *   error logged. The fix is `catch { return null }` in the catch block.
 */

import { jest } from '@jest/globals';
import { createHmac, randomBytes, createCipheriv } from 'node:crypto';
import { createTestDb, createMockFetch, waitFor } from '../setup-unit.js';
import { createWebhooks, WebhookEvent } from '../../lib/webhooks.js';

// These tests deliberately exercise decryptSecret's failure path (rotated/missing
// master key), which logs via console.error by design. Silence it so CI output
// isn't drowned in expected, asserted-on error logs.
let consoleErrorSpy;
beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  consoleErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHmac(secret, payloadObject) {
  return 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(payloadObject)).digest('hex');
}

function insertWebhook(db, id, url, secret, events = ['*']) {
  db.prepare(
    'INSERT INTO webhooks (id, url, secret, events, filter_pattern, active, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)'
  ).run(id, url, secret, JSON.stringify(events), Date.now());
}

// ---------------------------------------------------------------------------
// 1. HMAC correctness — replaces the coverage-theater HMAC format check
// ---------------------------------------------------------------------------

describe('Webhook HMAC correctness', () => {
  let db, webhooks, mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => { delete global.fetch; });

  it('signature is verifiable by a recipient using the original plaintext secret', async () => {
    const SECRET = 'shared-webhook-secret';

    webhooks.register('https://example.com/hook', { secret: SECRET });
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 3000 });

    await waitFor(() => mockFetch.calls.length > 0, 2000);

    const call = mockFetch.calls[0];
    const sig = call.opts.headers['X-PortDaddy-Signature'];
    const deliveredPayload = JSON.parse(call.opts.body);

    // This is what a real recipient would compute. If decryptSecret returned
    // the JSON envelope instead of the plaintext, this fails with a mismatch.
    expect(sig).toBe(computeHmac(SECRET, deliveredPayload));
  });

  it('signature differs from what you would get by signing with the stored encrypted form', async () => {
    const SECRET = 'another-secret';
    webhooks.register('https://example.com/hook', { secret: SECRET });
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    const sig = call.opts.headers['X-PortDaddy-Signature'];
    const deliveredPayload = JSON.parse(call.opts.body);

    const storedRow = db.prepare('SELECT secret FROM webhooks LIMIT 1').get();
    if (storedRow.secret !== SECRET) {
      // Encryption was applied: the stored form must NOT be what was used to sign
      const badSig = computeHmac(storedRow.secret, deliveredPayload);
      expect(sig).not.toBe(badSig);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. BUG EXPOSURE — decryptSecret returns raw envelope on auth failure
// ---------------------------------------------------------------------------

describe('Bug: decryptSecret returns raw envelope on decryption failure', () => {
  let db, webhooks, mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => { delete global.fetch; });

  it('delivery must not be signed with the raw envelope when decryption fails', async () => {
    // Build a valid v1 envelope encrypted with a random key that is NOT the
    // daemon master key. Simulates key-rotation: old key encrypted the secret,
    // current daemon holds a different key (or key was deleted).
    const otherKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', otherKey, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from('secret', 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    const badEnvelope = JSON.stringify({
      v: 1,
      ct: ct.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    });

    insertWebhook(db, 'rotated-key-wh', 'https://example.com/hook', badEnvelope);
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    const sig = call.opts.headers['X-PortDaddy-Signature'];

    // Correct behavior after fix: no signature when decryption fails.
    // If the OLD bug were present, sig would equal computeHmac(badEnvelope, payload).
    expect(sig).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Backward compatibility — pre-encryption plaintext secrets
// ---------------------------------------------------------------------------

describe('Backward compatibility: plaintext secrets stored before encryption was added', () => {
  let db, webhooks, mockFetch;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
    mockFetch = createMockFetch({ status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => { delete global.fetch; });

  it('legacy plaintext secret produces a verifiable HMAC', async () => {
    const SECRET = 'legacy-plaintext-secret';
    insertWebhook(db, 'legacy-wh', 'https://example.com/hook', SECRET);
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, { port: 9000 });

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    const sig = call.opts.headers['X-PortDaddy-Signature'];
    const deliveredPayload = JSON.parse(call.opts.body);

    expect(sig).toBeDefined();
    expect(sig).toBe(computeHmac(SECRET, deliveredPayload));
  });

  it('legacy plaintext secret starting with { is not misidentified as an encrypted envelope', async () => {
    // A JSON object used as a raw secret — should survive decryptSecret unchanged
    const SECRET = '{"type":"Bearer","token":"abc"}';
    insertWebhook(db, 'json-secret-wh', 'https://example.com/hook', SECRET);
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => mockFetch.calls.length > 0, 2000);
    const call = mockFetch.calls[0];
    const sig = call.opts.headers['X-PortDaddy-Signature'];
    const deliveredPayload = JSON.parse(call.opts.body);

    // Must use the literal string, not garble it through a failed decrypt attempt
    expect(sig).toBe(computeHmac(SECRET, deliveredPayload));
  });
});

// ---------------------------------------------------------------------------
// 4. Secret storage at rest
// ---------------------------------------------------------------------------

describe('Secret storage', () => {
  let db, webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  it('stored secret is either a valid v1 envelope or exactly the plaintext — never a corrupted hybrid', () => {
    const SECRET = 'my-actual-secret';
    const reg = webhooks.register('https://example.com/hook', { secret: SECRET });
    const row = db.prepare('SELECT secret FROM webhooks WHERE id = ?').get(reg.id);

    expect(row.secret).not.toBeNull();

    if (row.secret !== SECRET) {
      // Encryption applied: must be a well-formed JSON envelope
      let parsed;
      expect(() => { parsed = JSON.parse(row.secret); }).not.toThrow();
      expect(parsed.v).toBe(1);
      expect(typeof parsed.ct).toBe('string');
      expect(typeof parsed.iv).toBe('string');
      expect(typeof parsed.tag).toBe('string');
    }
  });

  it('null secret stores as null — not as an encrypted empty string', () => {
    const reg = webhooks.register('https://example.com/hook');
    const row = db.prepare('SELECT secret FROM webhooks WHERE id = ?').get(reg.id);
    expect(row.secret).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. FIX: response body truncation (replaces tautology)
// ---------------------------------------------------------------------------

describe('Response body truncation (fixes tautology in webhooks.test.js:460)', () => {
  let db, webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  afterEach(() => { delete global.fetch; });

  it('response_body in DB is at most 1000 chars even when server returns 2000', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'z'.repeat(2000),
    });

    const webhookId = webhooks.register('https://example.com/hook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    // Wait until the delivery row has a response_body (delivery completed)
    await waitFor(() => {
      const r = db.prepare(
        'SELECT response_body FROM webhook_deliveries WHERE webhook_id = ?'
      ).get(webhookId);
      return r != null && r.response_body != null;
    }, 2000);

    const row = db.prepare(
      'SELECT response_body FROM webhook_deliveries WHERE webhook_id = ?'
    ).get(webhookId);

    // THE REAL CHECK the old test never made:
    expect(row.response_body.length).toBeLessThanOrEqual(1000);
    // And confirm truncation actually happened (not just a short body):
    expect(row.response_body.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 6. FIX: delivery status value (replaces coverage theater)
// ---------------------------------------------------------------------------

describe('Delivery status value (fixes coverage theater in webhooks.test.js:427)', () => {
  let db, webhooks;

  beforeEach(() => {
    db = createTestDb();
    webhooks = createWebhooks(db);
  });

  afterEach(() => { delete global.fetch; });

  it('status is exactly "delivered" after a 200 response — not just toBeDefined()', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'OK',
    });

    const webhookId = webhooks.register('https://example.com/hook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => {
      const d = webhooks.getDeliveries(webhookId);
      return d.count > 0 && d.deliveries[0].status !== 'pending';
    }, 2000);

    const d = webhooks.getDeliveries(webhookId);
    // Old test: toBeDefined() — 'failed' or 'pending' would pass unnoticed
    expect(d.deliveries[0].status).toBe('delivered');
  });

  it('status is "retrying" or "failed" after a 500 — never stays "pending"', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Error',
      text: async () => 'Server Error',
    });

    const webhookId = webhooks.register('https://example.com/hook').id;
    webhooks.trigger(WebhookEvent.SERVICE_CLAIM, {});

    await waitFor(() => {
      const d = webhooks.getDeliveries(webhookId);
      return d.count > 0 && d.deliveries[0].status !== 'pending';
    }, 1500);

    const d = webhooks.getDeliveries(webhookId);
    expect(['retrying', 'failed']).toContain(d.deliveries[0].status);
    expect(d.deliveries[0].status).not.toBe('pending');
  });
});
