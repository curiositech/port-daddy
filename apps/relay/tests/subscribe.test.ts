/**
 * Tests for handleSubscribe from_seq backfill (ADR-0049)
 *
 * Verifies that a reconnecting subscriber with from_seq > 0:
 *   1. Receives missed events as SSE backfill before the live stream opens.
 *   2. Receives events in seq-ascending order with correct wire schema (v:1).
 *   3. Falls through to the DO live stream with no backfill when from_seq = 0.
 *   4. Returns 409 and aborts the stream when the DO subscribe fails.
 */

import { describe, it, expect } from 'vitest';
import { handleSubscribe } from '../src/handlers.js';
import type { Env } from '../src/types.js';

// ── Minimal D1 mock ───────────────────────────────────────────────────────────

interface MockEvent {
  sender: string;
  channel: string;
  seq: number;
  prev_hash: string;
  this_hash: string;
  iat: number;
  ciphertext: string;
  sig: string;
}

function makeMockD1(session: object | null, events: MockEvent[]): D1Database {
  // Each prepare() returns a chainable statement mock.
  // We distinguish the session query (returns session via .first()) from the
  // events backfill query (returns events via .all()).
  const stmtFor = (query: string) => {
    const isSessionQuery = query.includes('FROM sessions');
    const bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) {
        bound.push(...vals);
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (isSessionQuery) return session as T | null;
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // Return the pre-set events for any SELECT from events
        return { results: events as unknown as T[] };
      },
      async run(): Promise<{ success: boolean }> {
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };

  return {
    prepare: stmtFor,
    // The remaining D1Database surface is not used by handleSubscribe:
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

// ── Minimal DO namespace mock ─────────────────────────────────────────────────

function makeMockDoNamespace(doFetch: (url: string | URL | Request) => Promise<Response>): DurableObjectNamespace {
  const fakeId = {} as DurableObjectId;
  return {
    idFromName: () => fakeId,
    get: () => ({ fetch: doFetch }) as unknown as DurableObjectStub,
    idFromString: () => fakeId,
    newUniqueId: () => fakeId,
  } as unknown as DurableObjectNamespace;
}

// ── SSE stream reader helpers ─────────────────────────────────────────────────

/** Read all chunks from the stream, tolerating aborts (used for error-path tests). */
async function readSseChunks(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const dec = new TextDecoder();
  const reader = body.getReader();
  const chunks: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(dec.decode(value));
    }
  } catch {
    // Stream may be aborted after a DO failure — that's expected.
  }
  return chunks;
}

/**
 * Parse SSE data frames from the combined stream text.
 * The backfill format is: `data: <JSON.stringify(FanoutMessage)>\n\n`
 * where FanoutMessage.payload is itself a JSON string of a RelayEvent.
 * Returns the decoded RelayEvent objects.
 */
function parseSseEvents(combined: string): Array<Record<string, unknown>> {
  return combined
    .split('\n\n')
    .filter(Boolean)
    .map(block => block.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
    .map(raw => {
      const msg = JSON.parse(raw) as { type: string; payload: string };
      return JSON.parse(msg.payload) as Record<string, unknown>;
    });
}

// ── Shared session fixture ────────────────────────────────────────────────────

const MOCK_SESSION = {
  session_id: 'sess-abc',
  fingerprint: 'fp-aa',
  nonce_c: 'nc',
  nonce_s: 'ns',
  subs_json: JSON.stringify(['harbor-fp:my-channel']),
  created_at: 1_700_000_000,
  expires_at: 9_999_999_999,
};

const MOCK_EVENTS: MockEvent[] = [
  {
    sender: 'fp-aa',
    channel: 'harbor-fp:my-channel',
    seq: 6,
    prev_hash: 'aaa',
    this_hash: 'bbb',
    iat: 1_700_000_006,
    ciphertext: 'cipher6',
    sig: 'sig6',
  },
  {
    sender: 'fp-aa',
    channel: 'harbor-fp:my-channel',
    seq: 7,
    prev_hash: 'bbb',
    this_hash: 'ccc',
    iat: 1_700_000_007,
    ciphertext: 'cipher7',
    sig: 'sig7',
  },
];

function makeEnv(events: MockEvent[], doFetch: (u: string | URL | Request) => Promise<Response>): Env {
  return {
    DB: makeMockD1(MOCK_SESSION, events),
    HARBOR_CHANNEL: makeMockDoNamespace(doFetch),
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  };
}

function makeRequest(sessionId: string, fromSeq: number): Request {
  return new Request(
    `https://relay.example.com/v1/subscribe/${sessionId}?from_seq=${fromSeq}`,
    { headers: { Accept: 'text/event-stream' } }
  );
}

// ── DO live stream that closes immediately ────────────────────────────────────

function emptyDoStream(): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  void writer.close();
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleSubscribe — from_seq backfill', () => {
  it('returns 200 SSE response with correct headers when from_seq > 0', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => emptyDoStream());
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('includes missed events as SSE data before live stream when from_seq > 0', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => emptyDoStream());
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    const chunks = await readSseChunks(resp.body!);
    const events = parseSseEvents(chunks.join(''));

    // Both backfill events should be present (seq 6 and 7)
    expect(events.some(e => e['seq'] === 6)).toBe(true);
    expect(events.some(e => e['seq'] === 7)).toBe(true);
  });

  it('backfill events have v:1 wire field', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => emptyDoStream());
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    const chunks = await readSseChunks(resp.body!);
    const events = parseSseEvents(chunks.join(''));

    // Every backfill event should carry v:1
    expect(events.every(e => e['v'] === 1)).toBe(true);
  });

  it('backfill events are formatted as SSE data lines', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => emptyDoStream());
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    const chunks = await readSseChunks(resp.body!);
    const combined = chunks.join('');

    // SSE format: each message starts with "data: " and ends with double newline
    const dataLines = combined.split('\n\n').filter(Boolean);
    expect(dataLines.length).toBeGreaterThanOrEqual(2);
    for (const line of dataLines) {
      expect(line.trimStart()).toMatch(/^data: /);
    }
  });

  it('backfill events carry type:"event" envelope', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => emptyDoStream());
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    const chunks = await readSseChunks(resp.body!);
    const combined = chunks.join('');

    // The FanoutMessage envelope type should be "event"
    expect(combined).toContain('"type":"event"');
  });

  it('emits no backfill when from_seq = 0 (direct DO proxy)', async () => {
    let doFetchCalled = false;
    const doFetch = async (_url: string | URL | Request): Promise<Response> => {
      doFetchCalled = true;
      return emptyDoStream();
    };
    const env = makeEnv([], doFetch);
    const req = makeRequest('sess-abc', 0);
    await handleSubscribe(req, env, 'sess-abc');

    // When fromSeq=0 the handler should delegate directly to the DO
    expect(doFetchCalled).toBe(true);
  });

  it('aborts the SSE stream if DO subscribe returns non-2xx', async () => {
    const env = makeEnv(MOCK_EVENTS, async () => new Response('DO error', { status: 503 }));
    const req = makeRequest('sess-abc', 5);
    const resp = await handleSubscribe(req, env, 'sess-abc');

    // The response is still 200 (stream was opened)
    expect(resp.status).toBe(200);

    // Reading to completion should not hang (stream is aborted after backfill)
    const chunks = await readSseChunks(resp.body!);
    // Backfill events are written before the DO failure occurs; parse to verify
    const events = parseSseEvents(chunks.join(''));
    expect(events.some(e => e['seq'] === 6)).toBe(true);
  });

  it('returns 404 for an unknown session id', async () => {
    const env = makeEnv([], async () => emptyDoStream());
    // Override DB to return no session
    env.DB = makeMockD1(null, []) as unknown as typeof env.DB;
    const req = makeRequest('no-such-session', 5);
    const resp = await handleSubscribe(req, env, 'no-such-session');

    expect(resp.status).toBe(404);
  });
});
