// tests/unit/llm-call-semantic-cache.test.js
//
// Semantic tier of createLLMClient (ADR-0059): an exact-match miss falls through
// to embedding+cosine against same-model cached entries, reusing the operator's
// local embedder (lib/semantic-resolver.ts) — no new embedding service, no
// external vector DB. Tests inject a fake embedder so they're fast/deterministic.

import { describe, test, expect } from '@jest/globals';
import { createLLMClient } from '../../lib/llm-call.js';

function scriptedAdapter(scripted) {
  let i = 0;
  const calls = [];
  return {
    adapter: async (req) => {
      const r = scripted[i++] ?? { ok: false, error: 'no script' };
      calls.push({ ...req });
      return { ok: r.ok, text: r.text, error: r.error };
    },
    calls,
  };
}

// Fake embedder: maps each prompt to a caller-controlled normalized vector, so
// cosine similarity is exactly what the test intends. Same shape as the real
// LocalEmbedder (embed(texts) => Promise<number[][]>).
function fakeEmbedder(vectorFor) {
  return { modelId: 'fake-mini', embed: async (texts) => texts.map(vectorFor) };
}

// Near-identical to [1,0] (cosine 0.999); clearly different = [0,1] (cosine 0).
const VECTORS = {
  'weather today?': [1, 0],
  "what's the weather?": [0.999, Math.sqrt(1 - 0.999 * 0.999)], // cosine 0.999 vs [1,0]
  'capital of france?': [0, 1], // cosine 0 vs [1,0]
};
const vectorFor = (text) => VECTORS[text] ?? [0, 0];

describe('createLLMClient semantic tier', () => {
  test('a near-miss prompt is served from cache via the semantic tier', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'sunny' }]);
    const client = createLLMClient({
      adapter, cacheTtlMs: 60_000, embedder: fakeEmbedder(vectorFor), semanticThreshold: 0.95,
    });
    const a = await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    // Different exact key → exact miss → semantic tier matches the stored entry.
    const b = await client.complete({ prompt: "what's the weather?", cacheKey: 'k-b' });

    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.text).toBe('sunny'); // reused the neighbour's answer
    expect(calls).toHaveLength(1); // adapter called only once
    expect(client.stats().semanticHits).toBe(1);
    expect(client.stats().cacheHits).toBe(0); // it was a SEMANTIC, not exact, hit
  });

  test('below threshold → no semantic hit, adapter called again', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'sunny' }, { ok: true, text: 'paris' }]);
    const client = createLLMClient({
      adapter, cacheTtlMs: 60_000, embedder: fakeEmbedder(vectorFor), semanticThreshold: 0.95,
    });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    const b = await client.complete({ prompt: 'capital of france?', cacheKey: 'k-c' }); // cosine 0

    expect(b.cached).toBe(false);
    expect(b.text).toBe('paris');
    expect(calls).toHaveLength(2);
    expect(client.stats().semanticHits).toBe(0);
  });

  test('cross-model isolation: a near prompt under a DIFFERENT model is not a hit', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'haiku-ans' }, { ok: true, text: 'sonnet-ans' }]);
    const client = createLLMClient({
      adapter, cacheTtlMs: 60_000, embedder: fakeEmbedder(vectorFor), semanticThreshold: 0.95,
    });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a', model: 'haiku' });
    const b = await client.complete({ prompt: "what's the weather?", cacheKey: 'k-b', model: 'sonnet' });

    expect(b.cached).toBe(false); // would-be semantic match belongs to a different model
    expect(b.text).toBe('sonnet-ans');
    expect(calls).toHaveLength(2);
  });

  test('semantic:false opts out per call', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'sunny' }, { ok: true, text: 'sunny2' }]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000, embedder: fakeEmbedder(vectorFor) });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    const b = await client.complete({ prompt: "what's the weather?", cacheKey: 'k-b', semantic: false });
    expect(b.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test('embedder failure is best-effort: falls through to the adapter, never throws', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'a' }, { ok: true, text: 'b' }]);
    const brokenEmbedder = { modelId: 'x', embed: async () => { throw new Error('model not loaded'); } };
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000, embedder: brokenEmbedder });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    const b = await client.complete({ prompt: "what's the weather?", cacheKey: 'k-b' });
    expect(b.cached).toBe(false);
    expect(b.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(client.stats().semanticHits).toBe(0);
  });

  test('no embedder → exact-match only (unchanged behaviour, semanticHits stays 0)', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'a' }, { ok: true, text: 'b' }]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000 });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    const b = await client.complete({ prompt: "what's the weather?", cacheKey: 'k-b' });
    expect(b.cached).toBe(false);
    expect(calls).toHaveLength(2);
    expect(client.stats().semanticHits).toBe(0);
  });

  test('exact-match still short-circuits before the semantic tier', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'sunny' }]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000, embedder: fakeEmbedder(vectorFor) });
    await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' });
    const b = await client.complete({ prompt: 'weather today?', cacheKey: 'k-a' }); // same key
    expect(b.cached).toBe(true);
    expect(client.stats().cacheHits).toBe(1);
    expect(client.stats().semanticHits).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
