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
  listen,
  reply,
  send,
  inMemoryHistoryStore,
  createFileHistoryStore,
  defaultHistoryPath,
  safeChannelSlug,
  TUBE_ENVELOPE_KIND,
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
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
}));
jest.unstable_mockModule('../../cli/utils/channel-resolution.js', () => ({
  resolveDeclaredChannel: mockResolveDeclared,
  formatResolvedChannel: ({ requestedChannel, physicalChannel }: { requestedChannel: string; physicalChannel: string }) =>
    requestedChannel === physicalChannel ? physicalChannel : `${requestedChannel} -> ${physicalChannel}`,
  resolveTargetDir: () => '/tmp',
}));
jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

const { handleTube, handleTubeChat, readStdinToEnd } = await import('../../cli/commands/tube.js');

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

  test('--reply pipes stdin and tags parent id', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 99 })) as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn() as unknown as TubeClient['getMessages'],
    };

    await handleTube('chan', { reply: '7', json: true }, {
      client,
      history: inMemoryHistoryStore(),
      stdin: fakeStdin('roger that'),
    });

    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('roger that');
    expect(envelope.inReplyTo).toBe(7);
  });

  test('chat --once spawns a backend for each top-level message and replies in-thread', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 99 })) as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 7, sender: 'ui', createdAt: 100, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'what broke?' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };
    const spawnClient = {
      spawn: jest.fn(async () => ({ ok: true as const, output: 'the retry path duplicates events', agentId: 'spawned-1' })),
    };

    await handleTubeChat('chan', {
      once: true,
      json: true,
      backend: 'codex',
      tier: 'low',
      budget: '5',
      identity: 'port-daddy:tube-chat:test',
      sender: 'bridge',
    }, {
      client,
      spawnClient,
      history: inMemoryHistoryStore(),
    });

    expect(spawnClient.spawn).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'codex',
      modelTier: 'low',
      budgetUsd: 5,
      identity: 'port-daddy:tube-chat:test',
    }));
    const envelope = (publish as jest.Mock).mock.calls[0][1] as { body: string; inReplyTo?: number };
    expect(envelope.body).toBe('the retry path duplicates events');
    expect(envelope.inReplyTo).toBe(7);
  });

  test('chat skips its own replies and existing reply messages', async () => {
    const publish = jest.fn(async () => ({ ok: true, id: 99 })) as unknown as TubeClient['publish'];
    const client: TubeClient = {
      publish,
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 7, sender: 'bridge', createdAt: 100, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'self' } },
          { id: 8, sender: 'ui', createdAt: 101, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'reply', inReplyTo: 7 } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };
    const spawnClient = {
      spawn: jest.fn(async () => ({ ok: true as const, output: 'unused' })),
    };

    await handleTubeChat('chan', {
      once: true,
      backend: 'codex',
      tier: 'low',
      budget: '5',
      sender: 'bridge',
      quiet: true,
    }, {
      client,
      spawnClient,
      history: inMemoryHistoryStore(),
    });

    expect(spawnClient.spawn).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test('chat requires a positive budget', async () => {
    const client: TubeClient = {
      publish: jest.fn() as unknown as TubeClient['publish'],
      getMessages: jest.fn(async () => ({
        ok: true,
        messages: [
          { id: 7, sender: 'ui', createdAt: 100, payload: { v: 1, kind: TUBE_ENVELOPE_KIND, body: 'hello' } },
        ],
      })) as unknown as TubeClient['getMessages'],
    };

    await expect(handleTubeChat('chan', { once: true }, {
      client,
      spawnClient: { spawn: jest.fn(async () => ({ ok: true as const, output: 'unused' })) },
      history: inMemoryHistoryStore(),
    })).rejects.toThrow(/exit:1/);
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('--budget'));
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
