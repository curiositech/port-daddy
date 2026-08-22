/**
 * Bounded body reads (#7743).
 *
 * These pin the property the incident turned on: the executor must never pull
 * an unbounded response body into a 128MB isolate. The Cloudflare log that
 * finally named the failure read `outcome: exceededMemory` with 79.7s of wall
 * clock against 0.78s of CPU — an allocation shaped like a large download, not
 * like computation. A cap is only worth anything if it stops reading rather
 * than trimming after the fact, so the streaming path is what is asserted.
 */

import { describe, it, expect } from 'vitest';
import { readTextCapped, MAX_DIFF_BYTES, MAX_FILES_BYTES } from '../src/github.js';

/**
 * Build a Response whose body streams in many small chunks.
 *
 * WHY A REAL STREAM: a single-shot `new Response(bigString)` would exercise the
 * no-body fallback instead of the reader loop that does the actual bounding.
 * Counting chunks handed out also proves the reader STOPPED early rather than
 * consuming everything and slicing.
 *
 * @param totalBytes - How many bytes the body would deliver if read to the end.
 * @param chunkSize - Size of each streamed chunk.
 * @returns The response plus a live counter of chunks actually pulled.
 */
function streamingResponse(
  totalBytes: number,
  chunkSize = 1024,
): { res: Response; pulled: { count: number } } {
  const pulled = { count: 0 };
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const n = Math.min(chunkSize, totalBytes - sent);
      sent += n;
      pulled.count++;
      controller.enqueue(new Uint8Array(n).fill(0x41)); // 'A'
    },
  });
  return { res: new Response(stream), pulled };
}

describe('readTextCapped — stops reading, does not trim afterwards', () => {
  it('returns a short body whole and reports it untruncated', async () => {
    const { res } = streamingResponse(5_000);
    const r = await readTextCapped(res, 1_000_000);
    expect(r.truncated).toBe(false);
    expect(r.bytes).toBe(5_000);
    expect(r.text.length).toBe(5_000);
  });

  it('caps an oversized body at exactly the limit and flags truncation', async () => {
    const { res } = streamingResponse(500_000);
    const r = await readTextCapped(res, 10_000);
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(10_000);
    expect(r.text.length).toBe(10_000);
  });

  it('STOPS PULLING at the cap — the whole point, since trimming later would already have OOMed', async () => {
    const { res, pulled } = streamingResponse(10_000_000, 1024);
    await readTextCapped(res, 8 * 1024);
    // 8KB cap over 1KB chunks: a handful of pulls, not ~10k of them.
    expect(pulled.count).toBeLessThanOrEqual(9);
  });

  it('a body exactly at the cap is not reported as truncated', async () => {
    const { res } = streamingResponse(4_096);
    const r = await readTextCapped(res, 4_096);
    expect(r.truncated).toBe(false);
    expect(r.bytes).toBe(4_096);
  });

  it('an empty body reads as empty rather than throwing', async () => {
    const r = await readTextCapped(new Response(''), 1_000);
    expect(r.bytes).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('');
  });

  it('the caps are set below the isolate ceiling, and files ≥ diff', () => {
    // 128MB isolate: both bodies are fetched concurrently, so their SUM must
    // sit far under it with room for everything else the run allocates.
    expect(MAX_DIFF_BYTES + MAX_FILES_BYTES).toBeLessThan(16_000_000);
    // The /files JSON repeats every patch inside envelopes, so it runs larger
    // than the raw diff for the same change.
    expect(MAX_FILES_BYTES).toBeGreaterThanOrEqual(MAX_DIFF_BYTES);
  });
});
