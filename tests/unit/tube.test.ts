/**
 * Tests for `lib/tube.ts` and `cli/commands/tube.ts`.
 *
 * The CLI handler module imports `pdFetch` and `resolveDeclaredChannel`
 * which both reach for the daemon, so we mock those before importing the
 * handler. The lib module itself is pure-ish (deps are injected) and tests
 * call it directly.
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildEnvelope,
  decodeMessage,
  formatProse,
  listen,
  readHistory,
  reply,
  send,
  synthesizeSender,
  writeHistory,
  inMemoryHistoryStore,
  createFileHistoryStore,
  defaultHistoryPath,
  safeChannelSlug,
  TUBE_ENVELOPE_KIND,
  type HistoryStore,
  type RawDaemonMessage,
  type TubeClient,
} from '../../lib/tube.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks for the CLI handler (must register before import)
// ─────────────────────────────────────────────────────────────────────────────

const mockPdFetch = jest.fn();
const mockResolveDeclared = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:43121',
}));
jest.unstable_mockModule('../../cli/utils/channel-resolution.js', () => ({
  resolveDeclaredChannel: mockResolveDeclared,
  formatResolvedChannel: ({ requestedChannel, physicalChannel }: { requestedChannel: string; physicalChannel: string }) =>
    requestedChannel === physicalChannel ? physicalChannel : `${requestedChannel} -> ${physicalChannel}`,
  resolveTargetDir: () => '/tmp',
}));
jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

const { handleTube, readStdinToEnd, buildMetaFromOptions } = await import('../../cli/commands/tube.js');

// ─────────────────────────────────────────────────────────────────────────────
// Lib tests — pure functions
// ─────────────────────────────────────────────────────────────────────────────

describe('lib/tube envelope', () => {
  test('buildEnvelope wraps body and threading metadata', () => {
    expect(buildEnvelope('hello')).toEqual({ v: 1, kind: TUBE_ENVELOPE_KIND, body: 'hello' });
    expect(buildEnvelope('hi', 42)).toEqual({ v: 1, kind: TUBE_ENVELOPE_KIND, body: 'hi', inReplyTo: 42 });
  });

  test('decodeMessage handles tube envelopes (object payload)', () => {
    const row: RawDaemonMessage = {
      id: 7,
      sender: 'alice',
      createdAt: 1000,
      payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'yo', inReplyTo: 3 },
    };
    expect(decodeMessage(row)).toMatchObject({
      id: 7,
      sender: 'alice',
      body: 'yo',
      inReplyTo: 3,
      envelope: true,
    });
  });

  test('decodeMessage handles tube envelopes encoded as a JSON string', () => {
    const row: RawDaemonMessage = {
      id: 8,
      sender: null,
      createdAt: 2000,
      payload: JSON.stringify({ v: 1, kind: TUBE_ENVELOPE_KIND, body: 'serialized' }),
    };
    expect(decodeMessage(row)).toMatchObject({ body: 'serialized', envelope: true });
  });

  test('decodeMessage gracefully handles non-tube payloads', () => {
    const stringRow = decodeMessage({ id: 1, sender: 's', createdAt: 1, payload: 'plain text' });
    expect(stringRow).toMatchObject({ body: 'plain text', envelope: false });

    const objRow = decodeMessage({ id: 2, sender: 's', createdAt: 1, payload: { foo: 'bar' } });
    expect(objRow.envelope).toBe(false);
    expect(objRow.body).toBe('{"foo":"bar"}');
  });

  // ADR-0047 Phase 0 — typed performative envelope round-trip.
  test('buildEnvelope carries performative + conversationId + delegationChain', () => {
    const env = buildEnvelope('do it', 7, {
      performative: 'request',
      conversationId: 'conv-1',
      delegationChain: ['a', 'b'],
    });
    expect(env).toEqual({
      v: 1, kind: TUBE_ENVELOPE_KIND, body: 'do it', inReplyTo: 7,
      performative: 'request', conversationId: 'conv-1', delegationChain: ['a', 'b'],
    });
  });

  test('a performative envelope ROUND-TRIPS through build → decode (Phase 0 done-condition)', () => {
    const env = buildEnvelope('refactor auth', undefined, {
      performative: 'propose', conversationId: 'conv-42', delegationChain: ['steward', 'worker'],
    });
    const decoded = decodeMessage({ id: 9, sender: 'steward', createdAt: 1, payload: env });
    expect(decoded).toMatchObject({
      body: 'refactor auth', envelope: true,
      performative: 'propose', conversationId: 'conv-42', delegationChain: ['steward', 'worker'],
    });
  });

  test('round-trips through the stringified-payload path too', () => {
    const env = buildEnvelope('mayday', undefined, { performative: 'distress', conversationId: 'c9' });
    const decoded = decodeMessage({ id: 10, sender: 'x', createdAt: 1, payload: JSON.stringify(env) });
    expect(decoded).toMatchObject({ performative: 'distress', conversationId: 'c9', envelope: true });
  });

  test('legacy envelopes without conversation meta decode unchanged (back-compat)', () => {
    const decoded = decodeMessage({ id: 1, sender: 's', createdAt: 1, payload: buildEnvelope('hi', 3) });
    expect(decoded).toMatchObject({ body: 'hi', inReplyTo: 3, envelope: true });
    expect(decoded.performative).toBeUndefined();
    expect(decoded.conversationId).toBeUndefined();
    expect(decoded.delegationChain).toBeUndefined();
  });

  test('an unknown performative is dropped, not surfaced as a bad value', () => {
    const decoded = decodeMessage({
      id: 1, sender: 's', createdAt: 1,
      payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'x', performative: 'bogus-act' },
    });
    expect(decoded.envelope).toBe(true);
    expect(decoded.performative).toBeUndefined();
  });

  // RCP-14 — argumentative relationship (the discourse-move half of SwarmDiscourse).
  test('buildEnvelope carries the argumentative relationship', () => {
    const env = buildEnvelope('no, the cause is X', 7, { relationship: 'contradicts' });
    expect(env).toEqual({
      v: 1, kind: TUBE_ENVELOPE_KIND, body: 'no, the cause is X', inReplyTo: 7, relationship: 'contradicts',
    });
  });

  test('relationship ROUND-TRIPS through build → decode, alongside a performative', () => {
    const env = buildEnvelope('and also Y', 4, { performative: 'inform', relationship: 'extends' });
    const decoded = decodeMessage({ id: 11, sender: 'worker', createdAt: 1, payload: env });
    expect(decoded).toMatchObject({
      body: 'and also Y', inReplyTo: 4, envelope: true, performative: 'inform', relationship: 'extends',
    });
  });

  test('relationship round-trips through the stringified-payload path too', () => {
    const env = buildEnvelope('combining both', undefined, { relationship: 'synthesizes' });
    const decoded = decodeMessage({ id: 12, sender: 'x', createdAt: 1, payload: JSON.stringify(env) });
    expect(decoded).toMatchObject({ relationship: 'synthesizes', envelope: true });
  });

  test('an unknown relationship is dropped, not surfaced as a bad value', () => {
    const decoded = decodeMessage({
      id: 1, sender: 's', createdAt: 1,
      payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'x', relationship: 'vibes-with' },
    });
    expect(decoded.envelope).toBe(true);
    expect(decoded.relationship).toBeUndefined();
  });

  test('legacy envelopes without a relationship decode unchanged (back-compat)', () => {
    const decoded = decodeMessage({ id: 1, sender: 's', createdAt: 1, payload: buildEnvelope('hi', 3) });
    expect(decoded.relationship).toBeUndefined();
  });
});

describe('lib/tube history store', () => {
  test('safeChannelSlug strips path-unfriendly chars', () => {
    expect(safeChannelSlug('br:repo:work:a/b')).toBe('br_repo_work_a_b');
    expect(safeChannelSlug('plain')).toBe('plain');
    expect(safeChannelSlug('')).toBe('channel');
  });

  test('inMemoryHistoryStore round-trips per channel', () => {
    const h = inMemoryHistoryStore();
    expect(h.read('a')).toBeNull();
    h.write('a', 12);
    expect(h.read('a')).toBe(12);
    expect(h.read('b')).toBeNull();
  });

  test('file-backed history store persists and reads back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tube-hist-'));
    try {
      const h = createFileHistoryStore(dir);
      expect(h.read('chan')).toBeNull();
      h.write('chan', 99);
      const path = defaultHistoryPath('chan', dir);
      expect(existsSync(path)).toBe(true);
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      expect(stored.lastSeenId).toBe(99);
      expect(h.read('chan')).toBe(99);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file-backed history store ignores corrupted files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tube-hist-'));
    try {
      const h = createFileHistoryStore(dir);
      h.write('c', 5);
      // Corrupt the cursor file.
      const path = defaultHistoryPath('c', dir);
      writeFileSync(path, 'not-json', 'utf8');
      expect(h.read('c')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function makeClient(overrides: Partial<TubeClient> = {}): TubeClient & {
  publish: jest.Mock;
  getMessages: jest.Mock;
} {
  const publish = jest.fn(async () => ({ ok: true, id: 1 })) as unknown as jest.Mock;
  const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as jest.Mock;
  return {
    publish: (overrides.publish as jest.Mock) ?? publish,
    getMessages: (overrides.getMessages as jest.Mock) ?? getMessages,
  } as TubeClient & { publish: jest.Mock; getMessages: jest.Mock };
}

describe('lib/tube listen', () => {
  test('happy path: emits decoded messages and advances cursor', async () => {
    const client = makeClient({
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'a', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'one' } },
          { id: 2, sender: 'b', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'two' } },
        ],
      })) as unknown as jest.Mock,
    });
    const history = inMemoryHistoryStore();
    const res = await listen('test', client, history);
    expect(res.messages.map((m) => m.body)).toEqual(['one', 'two']);
    expect(res.lastSeenId).toBe(2);
    expect(history.read('test')).toBe(2);
  });

  test('history guard: second call with overlapping window does not re-emit', async () => {
    const messages = [
      { id: 5, sender: null, createdAt: 5, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'old' } },
      { id: 6, sender: null, createdAt: 6, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'new' } },
    ];
    const getMessages = jest.fn() as unknown as jest.Mock;
    // First call: returns both. Second call: simulates a daemon that DIDN'T
    // honor `after` (defense in depth) so still returns the duplicate.
    (getMessages as jest.Mock)
      .mockImplementationOnce(async () => ({ ok: true, messages }))
      .mockImplementationOnce(async () => ({ ok: true, messages }));
    const client = makeClient({ getMessages });
    const history = inMemoryHistoryStore();

    const first = await listen('c', client, history);
    expect(first.messages).toHaveLength(2);
    expect(history.read('c')).toBe(6);

    const second = await listen('c', client, history);
    expect(second.messages).toHaveLength(0);
    expect(history.read('c')).toBe(6);

    // First call had no cursor → uses limit; second call has cursor 6 → uses after.
    expect((getMessages as jest.Mock).mock.calls[0][1]).toEqual({ limit: 50 });
    expect((getMessages as jest.Mock).mock.calls[1][1]).toEqual({ after: 6 });
  });

  test('explicit since= overrides the on-disk cursor', async () => {
    const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as jest.Mock;
    const client = makeClient({ getMessages });
    const history = inMemoryHistoryStore();
    history.write('c', 10);
    await listen('c', client, history, { since: 3 });
    expect((getMessages as jest.Mock).mock.calls[0][1]).toEqual({ after: 3 });
  });

  test('multi-subscriber: distinct historyKey → each listener gets its own cursor (fan-out)', async () => {
    // Daemon returns the same message every poll (honoring `after` is irrelevant
    // here — both listeners start with no cursor under their own key).
    const messages = [
      { id: 7, sender: 'sender', createdAt: 7, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'broadcast' } },
    ];
    const getMessages = jest.fn(async () => ({ ok: true, messages })) as unknown as jest.Mock;
    const client = makeClient({ getMessages });
    const history = inMemoryHistoryStore();

    // Two listeners on the SAME channel 'c' but DISTINCT identities. Each must
    // receive the message — this is the multi-subscriber contract.
    const alice = await listen('c', client, history, { historyKey: 'c::alice' });
    const bob = await listen('c', client, history, { historyKey: 'c::bob' });

    expect(alice.messages.map((m) => m.body)).toEqual(['broadcast']);
    expect(bob.messages.map((m) => m.body)).toEqual(['broadcast']); // pre-fix: [] (shared cursor)
    // Cursors are tracked per identity, not on the bare channel key.
    expect(history.read('c::alice')).toBe(7);
    expect(history.read('c::bob')).toBe(7);
    expect(history.read('c')).toBeNull();
  });

  test('single-consumer regression: a SHARED channel cursor makes the 2nd listener miss it', async () => {
    // Documents the old behavior the fix removes: without per-listener keys, two
    // listeners share one channel cursor and race — the 2nd sees nothing.
    const messages = [
      { id: 7, sender: 'sender', createdAt: 7, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'broadcast' } },
    ];
    const getMessages = jest.fn(async () => ({ ok: true, messages })) as unknown as jest.Mock;
    const client = makeClient({ getMessages });
    const history = inMemoryHistoryStore();

    const first = await listen('c', client, history); // channel-keyed cursor → 7
    const second = await listen('c', client, history); // same cursor → id 7 filtered out
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(0);
  });

  test('disableHistory leaves the cursor untouched', async () => {
    const getMessages = jest.fn(async () => ({
      ok: true,
      messages: [{ id: 9, sender: null, createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'x' } }],
    })) as unknown as jest.Mock;
    const client = makeClient({ getMessages });
    const history = inMemoryHistoryStore();
    history.write('c', 1);
    const res = await listen('c', client, history, { disableHistory: true });
    expect(res.messages).toHaveLength(1);
    expect(history.read('c')).toBe(1); // unchanged
    // since opts.since wasn't provided AND history is disabled, the call is `limit`-based.
    expect((getMessages as jest.Mock).mock.calls[0][1]).toEqual({ limit: 50 });
  });

  test('listen surfaces daemon errors', async () => {
    const client = makeClient({
      getMessages: jest.fn(async () => ({ ok: false, messages: [], error: 'boom' })) as unknown as jest.Mock,
    });
    await expect(listen('c', client, inMemoryHistoryStore())).rejects.toThrow(/boom/);
  });
});

describe('lib/tube send & reply', () => {
  test('send wraps body in envelope and calls publish', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 42 })) as unknown as jest.Mock;
    const client = makeClient({ publish });
    const out = await send('c', 'hello', client, { sender: 'me' });
    expect(out.id).toBe(42);
    expect((publish as jest.Mock).mock.calls[0][1]).toMatchObject({
      kind: TUBE_ENVELOPE_KIND,
      body: 'hello',
    });
    expect((publish as jest.Mock).mock.calls[0][2]).toEqual({ sender: 'me' });
  });

  test('reply attaches inReplyTo', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 7 })) as unknown as jest.Mock;
    const client = makeClient({ publish });
    const out = await reply('c', 5, 'thanks', client);
    expect(out.id).toBe(7);
    expect((publish as jest.Mock).mock.calls[0][1]).toMatchObject({
      kind: TUBE_ENVELOPE_KIND,
      body: 'thanks',
      inReplyTo: 5,
    });
  });

  test('reply rejects invalid parent ids', async () => {
    const client = makeClient();
    await expect(reply('c', 0, 'x', client)).rejects.toThrow(/parent id/);
    await expect(reply('c', NaN, 'x', client)).rejects.toThrow(/parent id/);
  });

  test('send rejects empty body', async () => {
    const client = makeClient();
    await expect(send('c', '   ', client)).rejects.toThrow(/empty body/);
  });

  test('send forwards conversation meta onto the envelope', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 1 })) as unknown as jest.Mock;
    const client = makeClient({ publish });
    await send('c', 'proposing', client, { sender: 'me', meta: { performative: 'propose', conversationId: 'cv' } });
    expect((publish as jest.Mock).mock.calls[0][1]).toMatchObject({
      body: 'proposing', performative: 'propose', conversationId: 'cv',
    });
  });

  test('reply forwards the argumentative relationship onto the envelope', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 2 })) as unknown as jest.Mock;
    const client = makeClient({ publish });
    await reply('c', 5, 'that is wrong because Z', client, { sender: 'me', meta: { relationship: 'contradicts' } });
    expect((publish as jest.Mock).mock.calls[0][1]).toMatchObject({
      body: 'that is wrong because Z', inReplyTo: 5, relationship: 'contradicts',
    });
  });
});

describe('lib/tube prose & sender helpers', () => {
  test('synthesizeSender produces a stable per-cwd+channel label', () => {
    const a = synthesizeSender('ui:clicks', '/Users/jane/coding/myapp');
    const b = synthesizeSender('ui:clicks', '/Users/jane/coding/myapp');
    expect(a).toBe(b);
    expect(a).toContain('myapp');
    expect(a).toContain('ui_clicks');
  });

  test('synthesizeSender disambiguates by cwd basename', () => {
    const a = synthesizeSender('ui:clicks', '/tmp/repo-a');
    const b = synthesizeSender('ui:clicks', '/tmp/repo-b');
    expect(a).not.toBe(b);
  });

  test('formatProse renders a crank-handle block referencing event id and channel', () => {
    const block = formatProse(
      {
        id: 42,
        sender: 'web-demo',
        createdAt: 1714519871000,
        body: '{"button":"deploy-staging"}',
        envelope: true,
        raw: null,
      },
      'ui:clicks'
    );
    expect(block).toContain('id=42');
    expect(block).toContain('ui:clicks');
    expect(block).toContain('web-demo');
    expect(block).toContain('--reply');
    expect(block).toContain('correlated to id=42');
  });

  test('formatProse marks reply parents with the threading hint', () => {
    const block = formatProse(
      {
        id: 88,
        sender: 'agent',
        createdAt: 0,
        body: 'follow up',
        inReplyTo: 42,
        envelope: true,
        raw: null,
      },
      'chan'
    );
    expect(block).toContain('↩ 42');
  });

  test('formatProse surfaces the typed discourse move when present', () => {
    const block = formatProse(
      {
        id: 90, sender: 'agent', createdAt: 0, body: 'disagree', inReplyTo: 7,
        performative: 'inform', relationship: 'contradicts', envelope: true, raw: null,
      },
      'chan'
    );
    expect(block).toContain('Discourse: act=inform · relationship=contradicts');
  });

  test('formatProse omits the discourse line for a plain message', () => {
    const block = formatProse(
      { id: 91, sender: 'agent', createdAt: 0, body: 'hi', envelope: true, raw: null },
      'chan'
    );
    expect(block).not.toContain('Discourse:');
  });
});

describe('lib/tube history meta', () => {
  test('inMemoryHistoryStore round-trips foreign event metadata', () => {
    const h = inMemoryHistoryStore();
    expect(readHistory(h, 'c')).toBeNull();
    writeHistory(h, 'c', { lastSeenId: 10, lastForeignEventId: 7, lastForeignSender: 'web-demo' });
    const meta = readHistory(h, 'c');
    expect(meta).toMatchObject({
      lastSeenId: 10,
      lastForeignEventId: 7,
      lastForeignSender: 'web-demo',
    });
  });

  test('writeHistory preserves prior foreign-event hints when only lastSeenId advances', () => {
    const h = inMemoryHistoryStore();
    writeHistory(h, 'c', { lastSeenId: 5, lastForeignEventId: 5, lastForeignSender: 'someone' });
    writeHistory(h, 'c', { lastSeenId: 6 }); // listener saw its own message — no foreign update
    const meta = readHistory(h, 'c');
    expect(meta).toMatchObject({ lastSeenId: 6, lastForeignEventId: 5, lastForeignSender: 'someone' });
  });

  test('readHistory falls back to legacy read() when readMeta is unavailable', () => {
    const legacy: HistoryStore = {
      read: () => 17,
      write: () => {},
    };
    expect(readHistory(legacy, 'c')).toEqual({ lastSeenId: 17 });
  });

  test('writeHistory falls back to legacy write() when writeMeta is unavailable', () => {
    const writes: Array<[string, number]> = [];
    const legacy: HistoryStore = {
      read: () => null,
      write: (channel, id) => { writes.push([channel, id]); },
    };
    writeHistory(legacy, 'c', { lastSeenId: 21, lastForeignEventId: 19 });
    expect(writes).toEqual([['c', 21]]);
  });

  test('file-backed store persists foreign-event metadata across reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tube-meta-'));
    try {
      const h = createFileHistoryStore(dir);
      writeHistory(h, 'chan', { lastSeenId: 99, lastForeignEventId: 97, lastForeignSender: 'web' });
      // Fresh store instance pointing at the same dir should still see the meta.
      const h2 = createFileHistoryStore(dir);
      expect(readHistory(h2, 'chan')).toMatchObject({
        lastSeenId: 99,
        lastForeignEventId: 97,
        lastForeignSender: 'web',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lib/tube listen with selfSender', () => {
  test('filters out our own messages and does not advance lastForeignEventId past them', async () => {
    const client = makeClient({
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 10, sender: 'web-demo', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'click' } },
          { id: 11, sender: 'pd-tube/me/chan', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'self reply', inReplyTo: 10 } },
        ],
      })) as unknown as jest.Mock,
    });
    const history = inMemoryHistoryStore();
    const res = await listen('chan', client, history, { selfSender: 'pd-tube/me/chan' });

    expect(res.messages.map((m) => m.id)).toEqual([10]);
    expect(res.lastSeenId).toBe(11);
    expect(res.lastForeignEventId).toBe(10);
    expect(res.lastForeignSender).toBe('web-demo');

    const meta = readHistory(history, 'chan');
    expect(meta).toMatchObject({ lastSeenId: 11, lastForeignEventId: 10, lastForeignSender: 'web-demo' });
  });

  test('advances lastForeignEventId only on truly foreign messages', async () => {
    const client = makeClient({
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'me', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'mine' } },
          { id: 2, sender: 'them', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'theirs' } },
          { id: 3, sender: 'me', createdAt: 3, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'mine again' } },
        ],
      })) as unknown as jest.Mock,
    });
    const res = await listen('chan', client, inMemoryHistoryStore(), { selfSender: 'me' });
    expect(res.lastSeenId).toBe(3);
    expect(res.lastForeignEventId).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI handler tests
// ─────────────────────────────────────────────────────────────────────────────

function fakeStdin(body: string, opts: { isTTY?: boolean } = {}) {
  const stream = Readable.from([Buffer.from(body, 'utf8')]) as Readable & { isTTY?: boolean };
  stream.isTTY = !!opts.isTTY;
  return stream as NodeJS.ReadableStream & { isTTY?: boolean };
}

describe('readStdinToEnd', () => {
  test('reads piped bytes', async () => {
    expect(await readStdinToEnd(fakeStdin('hi there'))).toBe('hi there');
  });

  test('rejects when stdin is a TTY', async () => {
    await expect(readStdinToEnd(fakeStdin('', { isTTY: true }))).rejects.toThrow(/needs a body on stdin/);
  });
});

describe('cli/tube handler', () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  const logs: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    logs.length = 0;
    console.log = (msg?: unknown) => { logs.push(typeof msg === 'string' ? msg : String(msg)); };
    console.error = jest.fn();
    process.exit = ((code?: number) => { throw new Error(`exit:${code ?? 0}`); }) as never;

    mockResolveDeclared.mockImplementation(async (channel: string) => ({
      requestedChannel: channel,
      physicalChannel: channel,
      resolved: false,
    }));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  });

  test('listen --once emits decoded messages as JSON when --json', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'a', createdAt: 100, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'hi' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { once: true, json: true }, {
      client,
      history: inMemoryHistoryStore(),
    });

    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ id: 1, sender: 'a', body: 'hi' });
  });

  test('--lineage --json renders the argument graph + digest over the backlog (RCP-14)', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'alice', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'do X', performative: 'propose', conversationId: 'cv' } },
          { id: 2, sender: 'bob', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'no, Y', inReplyTo: 1, relationship: 'contradicts', conversationId: 'cv' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { lineage: true, json: true }, { client, history: inMemoryHistoryStore() });

    expect(logs).toHaveLength(1);
    const out = JSON.parse(logs[0]);
    expect(out).toMatchObject({ ok: true, conversationId: 'cv' });
    expect(out.digest.total).toBe(2);
    expect(out.digest.byRelationship.contradicts).toBe(1);
    expect(out.digest.unresolvedContradictions).toHaveLength(1);
    expect(out.tree).toContain('#1 alice [act=propose]: do X');
    expect(out.tree).toContain('#2 bob [contradicts]: no, Y');
  });

  test('--lineage prose mode prints the digest summary and flags unresolved contradictions', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'alice', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'claim' } },
          { id: 2, sender: 'bob', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'wrong', inReplyTo: 1, relationship: 'contradicts' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { lineage: true }, { client, history: inMemoryHistoryStore() });

    const out = logs.join('\n');
    expect(out).toContain('Discourse lineage');
    expect(out).toContain('stances: contradicts=1');
    expect(out).toContain('unresolved contradiction');
  });

  test('--lineage recommends a parley when waste beats cost (RCP-2a)', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'alice', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'claim' } },
          { id: 2, sender: 'bob', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'wrong', inReplyTo: 1, relationship: 'contradicts' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    // High waste-per-contradiction, low parley cost → convene.
    await handleTube('chan', { lineage: true, json: true, 'waste-per-contradiction': '10', 'parley-cost': '1' }, { client, history: inMemoryHistoryStore() });
    const out = JSON.parse(logs[0]);
    expect(out.parley.convene).toBe(true);
    expect(out.parley.shape).toBe('debate-with-judge');
  });

  test('--lineage holds (no parley) when coordinating costs more than the conflict', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 1, sender: 'a', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'one' } },
          { id: 2, sender: 'b', createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'two', inReplyTo: 1, relationship: 'contradicts' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    // High parley cost → coordinating isn't worth it.
    await handleTube('chan', { lineage: true, 'parley-cost': '100' }, { client, history: inMemoryHistoryStore() });
    const out = logs.join('\n');
    expect(out).toContain('no parley');
  });

  test('--send pipes stdin to publish (top-level, no inReplyTo)', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 50 })) as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { send: true, json: true }, {
      client,
      history: inMemoryHistoryStore(),
      stdin: fakeStdin('hello world\n'),
    });

    expect((publish as jest.Mock).mock.calls).toHaveLength(1);
    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('hello world');
    expect(envelope.inReplyTo).toBeUndefined();
    expect(logs[0]).toContain('"id":50');
  });

  test('--reply-to=<id> pipes stdin and tags the explicit parent id', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 99 })) as unknown as TubeClient['publish'];
    const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as TubeClient['getMessages'];
    const client: TubeClient = { publish, getMessages };

    await handleTube('chan', { 'reply-to': '7', json: true, send: true }, {
      client,
      history: inMemoryHistoryStore(),
      stdin: fakeStdin('roger that'),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('roger that');
    expect(envelope.inReplyTo).toBe(7);
  });

  test('--send with TTY stdin exits non-zero with helpful error', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await expect(
      handleTube('chan', { send: true }, {
        client,
        history: inMemoryHistoryStore(),
        stdin: fakeStdin('', { isTTY: true }),
      })
    ).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/stdin/i));
  });

  test('--send with empty stdin exits non-zero', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await expect(
      handleTube('chan', { send: true }, {
        client,
        history: inMemoryHistoryStore(),
        stdin: fakeStdin('   \n  '),
      })
    ).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/empty/i));
  });

  test('missing channel exits non-zero', async () => {
    await expect(handleTube(undefined, {})).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/Usage:/));
  });

  test('inline --reply auto-correlates to lastForeignEventId, posts, and falls through to listening', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 200 })) as unknown as TubeClient['publish'];
    const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as TubeClient['getMessages'];
    const client: TubeClient = { publish, getMessages };
    const history = inMemoryHistoryStore();
    writeHistory(history, 'chan', { lastSeenId: 42, lastForeignEventId: 42, lastForeignSender: 'web-demo' });
    const sleep = jest.fn(async () => {});

    // wait-for=0 makes the post-reply listen pass exit on its first empty
    // poll, so we can assert the reply was posted AND control flowed into the
    // listen block (one getMessages call at minimum).
    await handleTube('chan', { reply: 'shipping it', json: true, 'wait-for': '0' }, {
      client,
      history,
      stdin: fakeStdin('', { isTTY: true }),
      sleep,
    });

    expect((publish as jest.Mock).mock.calls).toHaveLength(1);
    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('shipping it');
    expect(envelope.inReplyTo).toBe(42);
    expect((getMessages as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('inline --reply errors out when no foreign event has been seen', async () => {
    const publish = jest.fn() as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };
    await expect(
      handleTube('chan', { reply: 'late to the party' }, {
        client,
        history: inMemoryHistoryStore(),
        stdin: fakeStdin('', { isTTY: true }),
      })
    ).rejects.toThrow('exit:1');
    expect(publish).not.toHaveBeenCalled();
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/no event to reply to/));
  });

  test('--reply=<numeric> --send keeps the legacy post-and-exit shape', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 555 })) as unknown as TubeClient['publish'];
    const getMessages = jest.fn() as unknown as TubeClient['getMessages'];
    const client: TubeClient = { publish, getMessages };

    await handleTube('chan', { reply: '7', send: true, json: true }, {
      client,
      history: inMemoryHistoryStore(),
      stdin: fakeStdin('roger that\n'),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('roger that');
    expect(envelope.inReplyTo).toBe(7);
    // Post-and-exit: no listen pass should have happened.
    expect((getMessages as jest.Mock).mock.calls).toHaveLength(0);
    // Legacy shape emits a deprecation hint to ui.warn pointing at --reply-to.
    expect(mockUi.warn).toHaveBeenCalledWith(expect.stringMatching(/--reply-to=7/));
  });

  test('--reply with literal numeric body sends "42" as the body, not as a parent id', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 100 })) as unknown as TubeClient['publish'];
    const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as TubeClient['getMessages'];
    const client: TubeClient = { publish, getMessages };
    const history = inMemoryHistoryStore();
    writeHistory(history, 'chan', { lastSeenId: 9, lastForeignEventId: 9, lastForeignSender: 'web' });

    await handleTube('chan', { reply: '42', json: true, 'wait-for': '0' }, {
      client,
      history,
      stdin: fakeStdin('', { isTTY: true }),
      sleep: jest.fn(async () => {}),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('42');
    // Auto-correlated to the last foreign event id (9), NOT to "42" as parent.
    expect(envelope.inReplyTo).toBe(9);
  });

  test('--reply <body> --reply-to=<id> uses the explicit parent and continues listening', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 101 })) as unknown as TubeClient['publish'];
    const getMessages = jest.fn(async () => ({ ok: true, messages: [] })) as unknown as TubeClient['getMessages'];
    const client: TubeClient = { publish, getMessages };

    await handleTube('chan', { reply: 'shipped', 'reply-to': '17', json: true, 'wait-for': '0' }, {
      client,
      history: inMemoryHistoryStore(), // no foreign event seen — explicit parent does not need one
      stdin: fakeStdin('', { isTTY: true }),
      sleep: jest.fn(async () => {}),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('shipped');
    expect(envelope.inReplyTo).toBe(17);
    // Falls through to listen — at least one getMessages poll happens.
    expect((getMessages as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('--reply-to with non-numeric value rejects with a clear error', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await expect(
      handleTube('chan', { 'reply-to': 'banana', send: true }, {
        client,
        history: inMemoryHistoryStore(),
        stdin: fakeStdin('hi'),
      }),
    ).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/--reply-to/));
  });

  test('--reply <body> --send <other-body> rejects (cannot mix inline reply with a stdin/inline send)', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await expect(
      handleTube('chan', { reply: 'inline reply body', send: 'inline send body', json: true }, {
        client,
        history: inMemoryHistoryStore(),
        stdin: fakeStdin('', { isTTY: true }),
      }),
    ).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringMatching(/inline reply OR stdin send|takes no body/));
  });

  test('--send "body" posts the inline body as a top-level message', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 1 })) as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { send: 'inline hello', json: true }, {
      client,
      history: inMemoryHistoryStore(),
      stdin: fakeStdin('', { isTTY: true }),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('inline hello');
    expect(envelope.inReplyTo).toBeUndefined();
  });

  test('listen --once with no flags emits prose by default', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 5, sender: 'web-demo', createdAt: 1714519871000, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'click' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await handleTube('ui:clicks', { once: true }, {
      client,
      history: inMemoryHistoryStore(),
    });

    const joined = logs.join('\n');
    expect(joined).toContain('id=5');
    expect(joined).toContain('ui:clicks');
    expect(joined).toContain('web-demo');
    expect(joined).toContain('--reply');
  });

  test('listen --once --raw emits the legacy tab-separated format', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 9, sender: 'a', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'plain' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { once: true, raw: true }, {
      client,
      history: inMemoryHistoryStore(),
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe('9\ta\tplain');
  });

  test('listen blocks until an event arrives, then exits', async () => {
    let pollCount = 0;
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => {
        pollCount++;
        if (pollCount < 3) return { ok: true, messages: [] };
        return {
          ok: true,
          messages: [
            { id: 1, sender: 'web', createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'finally' } },
          ],
        };
      }) as unknown as TubeClient['getMessages'],
    };
    const sleep = jest.fn(async () => {}); // skip real waiting

    await handleTube('chan', { json: true }, {
      client,
      history: inMemoryHistoryStore(),
      sleep,
    });

    expect(pollCount).toBe(3);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ body: 'finally' });
  });

  test('listen times out cleanly when no event arrives within --wait-for', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({ ok: true, messages: [] })) as unknown as TubeClient['getMessages'],
    };
    const sleep = jest.fn(async () => {});

    await handleTube('chan', { json: true, 'wait-for': '0' }, {
      client,
      history: inMemoryHistoryStore(),
      sleep,
    });

    // wait-for=0 means the deadline is reached on the very first iteration.
    // We should print a structured timeout marker and exit cleanly.
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ ok: true, timedOut: true });
  });

  test('listen --once + history-guard skips messages already seen', async () => {
    const messages = [
      { id: 1, sender: null, createdAt: 1, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'one' } },
      { id: 2, sender: null, createdAt: 2, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'two' } },
    ];
    const getMessages = jest.fn(async () => ({ ok: true, messages })) as unknown as TubeClient['getMessages'];
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages,
    };
    const history = inMemoryHistoryStore();

    await handleTube('chan', { once: true, json: true }, { client, history });
    expect(logs).toHaveLength(2);

    logs.length = 0;
    await handleTube('chan', { once: true, json: true }, { client, history });
    expect(logs).toHaveLength(0);
  });
});

describe('cli/tube buildMetaFromOptions', () => {
  test('parses valid performative + relationship + conversation-id', () => {
    const meta = buildMetaFromOptions({
      performative: 'propose',
      relationship: 'extends',
      'conversation-id': 'cv-7',
    } as any);
    expect(meta).toEqual({ performative: 'propose', relationship: 'extends', conversationId: 'cv-7' });
  });

  test('returns undefined when no meta flags are present', () => {
    expect(buildMetaFromOptions({ reply: 'hi' } as any)).toBeUndefined();
  });

  test('rejects an unknown performative with a helpful error', () => {
    expect(() => buildMetaFromOptions({ performative: 'yell' } as any)).toThrow(/unknown --performative/);
  });

  test('rejects an unknown relationship with a helpful error', () => {
    expect(() => buildMetaFromOptions({ relationship: 'vibes' } as any)).toThrow(/unknown --relationship/);
  });
});
