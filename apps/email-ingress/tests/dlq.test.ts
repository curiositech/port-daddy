// Dead-letter queue for inbound envelopes: stash on exhausted retries,
// cron replay with RE-SIGNING (secret rotation heals old envelopes),
// delivered → deleted, failed → kept with attempt count, unparseable →
// dropped loudly. The daemon's delivery-id dedup makes replays safe.

import { describe, expect, test } from 'vitest';
import { stashEnvelope, replayDlq, dlqDepth, redactDeliveryId, DLQ_ALERT_THRESHOLD, type KVLike } from '../src/dlq.js';
import { verifySignature } from '../src/envelope.js';

function fakeKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async put(key, value) { store.set(key, value); },
    async get(key) { return store.get(key) ?? null; },
    async delete(key) { store.delete(key); },
    async list({ prefix, limit = 1000 }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

describe('envelope DLQ', () => {
  test('stash is keyed by delivery id — a retried stash overwrites, never duplicates', async () => {
    const kv = fakeKV();
    await stashEnvelope(kv, { channel: 'email-inbound', body: '{"a":1}', deliveryId: '<m1@x>', attempts: 3 });
    await stashEnvelope(kv, { channel: 'email-inbound', body: '{"a":1}', deliveryId: '<m1@x>', attempts: 6 });
    expect(await dlqDepth(kv)).toBe(1);
    expect(JSON.parse(kv.store.get('dlq:<m1@x>')!).attempts).toBe(6);
  });

  test('replay delivers with a FRESH signature (rotation heals), deletes on success, keeps on failure', async () => {
    const kv = fakeKV();
    await stashEnvelope(kv, { channel: 'email-inbound', body: '{"ok":true}', deliveryId: '<good@x>', attempts: 3 });
    await stashEnvelope(kv, { channel: 'email-inbound', body: '{"down":true}', deliveryId: '<down@x>', attempts: 3 });

    const seen: Array<{ url: string; sig: string | null; deliveryId: string | null; body: string }> = [];
    const daemon = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      const headers = init?.headers as Record<string, string>;
      seen.push({ url: String(url), sig: headers['x-pd-webhook-signature'], deliveryId: headers['x-pd-delivery-id'], body });
      // The daemon is back for one envelope, still down for the other.
      return new Response('{}', { status: body.includes('down') ? 503 : 200 });
    }) as unknown as typeof fetch;

    const result = await replayDlq(kv, daemon, 'https://tunnel.example', 'ROTATED-secret');
    expect(result.delivered).toBe(1);
    expect(result.kept).toBe(1);

    // Delivered one is gone; failed one kept with bumped attempts.
    expect(await dlqDepth(kv)).toBe(1);
    expect(JSON.parse(kv.store.get('dlq:<down@x>')!).attempts).toBeGreaterThan(3);

    // Signature was minted at REPLAY time with the current secret.
    const good = seen.find((s) => s.body.includes('ok'))!;
    expect(good.url).toBe('https://tunnel.example/webhooks/fleet/email-inbound');
    expect(good.deliveryId).toBe('<good@x>');
    expect(await verifySignature(good.body, 'ROTATED-secret', good.sig)).toBe(true);
  });

  test('unparseable records are dropped (loudly), not retried forever', async () => {
    const kv = fakeKV();
    kv.store.set('dlq:garbage', 'not json');
    const logs: string[] = [];
    const result = await replayDlq(kv, (async () => new Response('{}')) as unknown as typeof fetch, 'https://t', 's', (m) => logs.push(m));
    expect(result.scanned).toBe(1);
    expect(await dlqDepth(kv)).toBe(0);
    expect(logs.join(' ')).toMatch(/unparseable/);
  });

  // The `email:<from>:<date>` fallback delivery id (used when a message lacks a
  // Message-ID) embeds the sender address — PII that must never reach Workers
  // logs. Message-IDs are opaque tokens and pass through unredacted.
  test('replay-failure logs redact the PII fallback delivery id, not opaque Message-IDs', async () => {
    const kv = fakeKV();
    const piiId = 'email:alice@victim.example:2026-07-07T00:00:00Z';
    await stashEnvelope(kv, { channel: 'email-inbound', body: '{"x":1}', deliveryId: piiId, attempts: 3 });
    const logs: string[] = [];
    const downDaemon = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await replayDlq(kv, downDaemon, 'https://t', 's', (m) => logs.push(m));
    const line = logs.join(' ');
    expect(line).not.toContain('alice@victim.example'); // no PII in logs
    expect(line).toContain(redactDeliveryId(piiId));    // stable correlation tag instead
    // The redactor is deterministic and non-reversible for the PII form,
    // and a pass-through for opaque Message-IDs.
    expect(redactDeliveryId(piiId)).toMatch(/^email:#[0-9a-f]{8}$/);
    expect(redactDeliveryId(piiId)).toBe(redactDeliveryId(piiId));
    expect(redactDeliveryId('<abc123@mail.example>')).toBe('<abc123@mail.example>');
    expect(DLQ_ALERT_THRESHOLD).toBeGreaterThan(0);
  });
});
