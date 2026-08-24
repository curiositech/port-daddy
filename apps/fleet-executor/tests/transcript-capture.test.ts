/**
 * pd-transcript.v1 capture layer (src/transcript-capture.ts): the envelope
 * format rules, the fail-open recording contract, the secret scrub, and the
 * one-shot R2 + D1 flush. These tests double as the format's validator: any
 * drift in mandatory fields, the closed kind union, or truncation marking
 * fails here before it can rot in storage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PD_TRANSCRIPT_VERSION,
  ShipTranscript,
  flushShipTranscript,
  runCaptured,
  scrubSecrets,
  sysPromptHash,
  transcriptObjectKey,
} from '../src/transcript-capture.js';

const META = { phase: 'map' as const, model: '@cf/test/model', chunk: { index: 0, count: 2 } };

const REQUEST = {
  messages: [
    { role: 'system', content: 'You are ship pd-qa. Review carefully.' },
    { role: 'user', content: 'Here is the diff chunk.' },
  ],
  max_tokens: 64,
};

const AI_RESPONSE = { response: 'FLEET-VERDICT: PASS', usage: { prompt_tokens: 40, completion_tokens: 8 } };

function parsed(cap: ShipTranscript) {
  return cap
    .serialize()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('pd-transcript.v1 envelope format', () => {
  it('records request + response as versioned turns with monotonic seq', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    await runCaptured(cap, META, REQUEST, async () => AI_RESPONSE);
    const turns = parsed(cap);
    expect(turns.map(t => t.kind)).toEqual(['system', 'user', 'assistant']);
    expect(turns.map(t => t.seq)).toEqual([0, 1, 2]);
    for (const t of turns) {
      expect(t.v).toBe(PD_TRANSCRIPT_VERSION);
      expect(t.runId).toBe('run:abc');
      expect(t.ship).toBe('qa');
      expect(t.attempt).toBe(1);
      expect(t.phase).toBe('map');
      expect(t.chunk).toEqual({ index: 0, count: 2 });
      expect(t.model).toBe('@cf/test/model');
      expect(typeof t.ts).toBe('number');
      expect(t.truncated).toBe(false);
    }
    const assistant = turns[2];
    expect(assistant.content).toEqual([{ type: 'text', text: 'FLEET-VERDICT: PASS' }]);
    expect(assistant.usage).toEqual({ prompt: 40, completion: 8 });
    expect(typeof assistant.latencyMs).toBe('number');
  });

  it('deduplicates a repeated system prompt via sysRef (MAP fan-out shape)', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    await runCaptured(cap, META, REQUEST, async () => AI_RESPONSE);
    await runCaptured(cap, { ...META, chunk: { index: 1, count: 2 } }, REQUEST, async () => AI_RESPONSE);
    const systems = parsed(cap).filter(t => t.kind === 'system');
    expect(systems).toHaveLength(2);
    expect(systems[0].sysRef).toBe(sysPromptHash(REQUEST.messages[0].content));
    expect(systems[0].content[0].text).toContain('pd-qa');
    // The repeat carries the hash and NO body — readers resolve it upstream.
    expect(systems[1].sysRef).toBe(systems[0].sysRef);
    expect(systems[1].content).toEqual([]);
  });

  it('records a thrown call as an error turn and rethrows unchanged', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 2);
    const boom = new Error('Workers AI 429');
    await expect(
      runCaptured(cap, META, REQUEST, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    const turns = parsed(cap);
    expect(turns.at(-1)?.kind).toBe('error');
    expect(turns.at(-1)?.content[0].text).toContain('Workers AI 429');
  });

  it('degrades to a plain call when capture is null', async () => {
    const res = await runCaptured(null, META, REQUEST, async () => AI_RESPONSE);
    expect(res).toBe(AI_RESPONSE);
  });

  it('truncates an oversized turn body with an EXPLICIT marker', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    cap.recordResponse(META, { response: 'x'.repeat(300 * 1024) }, 5);
    const turn = parsed(cap)[0];
    expect(turn.truncated).toBe(true);
    expect(turn.content[0].text.length).toBe(256 * 1024);
  });
});

describe('secret scrub', () => {
  it('masks GitHub token shapes, JWTs, and Authorization headers', () => {
    const dirty =
      'token ghs_abcdefghijklmnopqrstuv123 then ' +
      'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and ' +
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl plus ' +
      'Authorization: Bearer supersecretvalue tail';
    const clean = scrubSecrets(dirty);
    expect(clean).not.toContain('ghs_abcdefghijklmnopqrstuv123');
    expect(clean).not.toContain('github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(clean).not.toContain('c2lnbmF0dXJl');
    expect(clean).not.toContain('supersecretvalue');
    expect(clean).toContain('[scrubbed:github-token]');
    expect(clean).toContain('[scrubbed:jwt]');
    expect(clean).toContain('tail');
  });

  it('is applied to every recorded turn body', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    await runCaptured(
      cap,
      META,
      { messages: [{ role: 'user', content: 'use ghs_abcdefghijklmnopqrstuv123 now' }] },
      async () => ({ response: 'echo ghs_abcdefghijklmnopqrstuv123' }),
    );
    expect(cap.serialize()).not.toContain('ghs_abcdefghijklmnopqrstuv123');
  });
});

describe('flushShipTranscript', () => {
  function mocks() {
    const put = vi.fn(async () => ({}));
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    return {
      env: {
        TRANSCRIPTS: { put } as unknown as R2Bucket,
        DB: { prepare } as unknown as D1Database,
      },
      put,
      prepare,
      bind,
    };
  }

  it('writes the JSONL object under the deterministic key, then the index row', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 3);
    await runCaptured(cap, META, REQUEST, async () => AI_RESPONSE);
    const { env, put, prepare, bind } = mocks();
    await flushShipTranscript(env, cap);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(transcriptObjectKey('run:abc', 'qa', 3));
    expect(put.mock.calls[0][0]).toBe('v1/run:abc/qa.3.jsonl');
    expect(prepare.mock.calls[0][0]).toContain('fleet_run_transcripts');
    const bound = bind.mock.calls[0] as unknown[];
    expect(bound[0]).toBe('run:abc');
    expect(bound[1]).toBe('qa');
    expect(bound[2]).toBe(3);
    expect(bound[4]).toBe(3); // three turns
    expect(bound[6]).toBe('@cf/test/model'); // models_csv
  });

  it('is a no-op without a bucket binding and swallows a D1 failure', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    await runCaptured(cap, META, REQUEST, async () => AI_RESPONSE);
    await expect(flushShipTranscript({}, cap)).resolves.toBeUndefined();
    const put = vi.fn(async () => ({}));
    const failingDb = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error('no such table: fleet_run_transcripts');
          },
        }),
      }),
    } as unknown as D1Database;
    await expect(
      flushShipTranscript({ TRANSCRIPTS: { put } as unknown as R2Bucket, DB: failingDb }, cap),
    ).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1); // object still landed
  });

  it('never writes an index row when the R2 put fails (no row without bytes)', async () => {
    const cap = new ShipTranscript('run:abc', 'qa', 1);
    await runCaptured(cap, META, REQUEST, async () => AI_RESPONSE);
    const prepare = vi.fn();
    await expect(
      flushShipTranscript(
        {
          TRANSCRIPTS: {
            put: async () => {
              throw new Error('r2 down');
            },
          } as unknown as R2Bucket,
          DB: { prepare } as unknown as D1Database,
        },
        cap,
      ),
    ).resolves.toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('skips empty captures entirely', async () => {
    const { env, put } = mocks();
    await flushShipTranscript(env, new ShipTranscript('run:abc', 'qa', 1));
    await flushShipTranscript(env, null);
    expect(put).not.toHaveBeenCalled();
  });
});
