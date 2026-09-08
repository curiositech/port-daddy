/**
 * Agent Context Classifier focused contract tests.
 *
 * Every test injects vectors directly: no ONNX load, model download, network,
 * or lexical substitute can affect the result. This makes semantic selection,
 * confidence, normalization, provenance, and degradation deterministic.
 */

import { describe, expect, test } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_CONTEXT_LIMITS,
  AgentContextClassifierOutputError,
  AgentContextClassifierUnavailableError,
  createAgentContextClassifier,
  createAgentContextClassifierTestSeam,
  type AgentContextInput,
} from '../../lib/agent-context-classifier.js';
import type { LocalEmbedder } from '../../lib/semantic-resolver.js';

/** Build a deterministic embedder while retaining the exact batched texts. */
function fakeEmbedder(
  vectorFor: (text: string, index: number) => number[],
  modelId = 'Xenova/test-MiniLM',
): LocalEmbedder & { batches: string[][] } {
  const embedder: LocalEmbedder & { batches: string[][] } = {
    modelId,
    batches: [],
    async embed(texts: string[]): Promise<number[][]> {
      this.batches.push([...texts]);
      return texts.map(vectorFor);
    },
  };
  return embedder;
}

/** Canonical exact identity used by focused classifier fixtures. */
const session = {
  sessionId: 'session-b1-2',
  agentId: 'agent-suggestibility',
  identity: 'port-daddy:contrib:suggest-b1-2-classifier',
};

describe('agent context classifier', () => {
  test('bounds one semantic batch and emits normalized, attributable, fresh context', async () => {
    const embedder = fakeEmbedder(() => [3, 4]);
    const notes = Array.from(
      { length: AGENT_CONTEXT_LIMITS.notes + 3 },
      (_, index) => `note ${index} ${'x'.repeat(AGENT_CONTEXT_LIMITS.noteChars + 20)}`,
    );
    const claims = Array.from(
      { length: AGENT_CONTEXT_LIMITS.claims + 2 },
      (_, index) => ({ path: `lib/surface-${index}.ts`, symbolPath: `function-${index}` }),
    );
    const diffHunks = Array.from(
      { length: AGENT_CONTEXT_LIMITS.diffHunks + 4 },
      (_, index) => `diff hunk ${index} ${'y'.repeat(AGENT_CONTEXT_LIMITS.diffHunkChars + 20)}`,
    );
    const classifier = createAgentContextClassifierTestSeam({
      embedder,
      clock: () => 10_000,
      staleAfterMs: 60_000,
    });

    const result = await classifier.classify({
      session,
      purpose: 'Implement bounded topical classifier semantics with deterministic evidence and careful provenance',
      notes,
      claims,
      diffHunks,
    });

    expect(embedder.batches).toHaveLength(1);
    expect(embedder.batches[0]).toHaveLength(
      1 + AGENT_CONTEXT_LIMITS.notes + AGENT_CONTEXT_LIMITS.claims + AGENT_CONTEXT_LIMITS.diffHunks,
    );
    expect(result.session).toEqual(session);
    expect(result.agentId).toBe(session.agentId);
    expect(result.sessionId).toBe(session.sessionId);
    expect(result.identity).toBe(session.identity);
    expect(result.topicTag.split(/\s+/)).toHaveLength(AGENT_CONTEXT_LIMITS.topicWords);
    expect(result.topicTag.length).toBeLessThanOrEqual(AGENT_CONTEXT_LIMITS.topicChars);
    expect(Math.hypot(...result.topicEmbedding)).toBeCloseTo(1, 12);
    expect(result.confidence).toBe(1);
    expect(result.surfaceClaims).toHaveLength(AGENT_CONTEXT_LIMITS.claims);
    expect(result.surfaceClaims[0]).toBe('lib/surface-0.ts#function-0');
    expect(result.generatedAt).toBe(10_000);
    expect(result.staleAt).toBe(70_000);
    expect(result.staleness).toEqual({ generatedAt: 10_000, staleAt: 70_000, ttlMs: 60_000 });
    expect(result.provenance).toMatchObject({
      classifierVersion: 'b1.2-v1',
      input: {
        sourceCount: 1 + AGENT_CONTEXT_LIMITS.notes + AGENT_CONTEXT_LIMITS.claims + AGENT_CONTEXT_LIMITS.diffHunks,
        noteCount: AGENT_CONTEXT_LIMITS.notes,
        claimCount: AGENT_CONTEXT_LIMITS.claims,
        diffHunkCount: AGENT_CONTEXT_LIMITS.diffHunks,
        truncated: true,
      },
      embedding: {
        provider: 'local',
        modelId: 'Xenova/test-MiniLM',
        cache: 'shared-minilm',
        dimensions: 2,
        normalized: true,
      },
      topicSource: { kind: 'purpose', index: 0, semanticCentrality: 1 },
      confidence: {
        method: 'pairwise-cosine-v1',
        semanticCoherence: 1,
        sourceKindCoverage: 1,
        support: 1,
      },
    });
    expect(result.provenance.input.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('chooses the topic by embedding centrality and lowers confidence for disagreement', async () => {
    const vectors = new Map<string, number[]>([
      ['purpose: alpha unrelated wording', [1, 0]],
      ['note: qqq foreign vocabulary', [0, 1]],
      ['note: central semantic topic', [1, 1]],
    ]);
    const embedder = fakeEmbedder((text) => vectors.get(text) ?? [0, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });

    const result = await classifier.classify({
      session,
      purpose: 'alpha unrelated wording',
      notes: ['qqq foreign vocabulary', 'central semantic topic'],
    });

    expect(result.topicTag).toBe('central semantic topic');
    expect(result.provenance.topicSource).toMatchObject({ kind: 'note', index: 1, semanticCentrality: 1 });
    expect(result.provenance.confidence.semanticCoherence).toBeCloseTo(0.471405, 6);
    expect(result.confidence).toBeCloseTo(0.609272, 6);
    expect(Math.hypot(...result.topicEmbedding)).toBeCloseTo(1, 12);
  });

  test('keeps the first bounded source when exact topic-centrality scores tie', async () => {
    const embedder = fakeEmbedder((text) => {
      if (text === 'purpose: first source wins exact centrality tie') return [1, 0];
      if (text === 'note: second source has the same centrality') return [0, 1];
      return [0, 0];
    });
    const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });

    const result = await classifier.classify({
      session,
      purpose: 'first source wins exact centrality tie',
      notes: ['second source has the same centrality'],
    });

    expect(result.topicTag).toBe('first source wins exact centrality tie');
    expect(result.provenance.topicSource).toEqual({
      kind: 'purpose',
      index: 0,
      semanticCentrality: 0.707107,
    });
  });

  test('accepts explicit empty arrays without adding sources to the embedding batch', async () => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });

    const result = await classifier.classify({
      session,
      purpose: 'classify the required purpose only',
      notes: [],
      claims: [],
      diffHunks: [],
    });

    expect(embedder.batches).toEqual([['purpose: classify the required purpose only']]);
    expect(result.provenance.input).toMatchObject({
      sourceCount: 1,
      noteCount: 0,
      claimCount: 0,
      diffHunkCount: 0,
      truncated: false,
    });
    expect(result.surfaceClaims).toEqual([]);
  });

  test.each([
    ['omitted', {}],
    ['null', { notes: null, claims: null, diffHunks: null }],
  ])('treats %s optional collections as empty', async (_label, collections) => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });
    const input = {
      session,
      purpose: 'optional collections remain an empty semantic batch',
      ...collections,
    } as unknown as AgentContextInput;

    const result = await classifier.classify(input);

    expect(embedder.batches).toEqual([[
      'purpose: optional collections remain an empty semantic batch',
    ]]);
    expect(result.provenance.input).toMatchObject({
      sourceCount: 1,
      noteCount: 0,
      claimCount: 0,
      diffHunkCount: 0,
    });
  });

  test('discards blank sources and duplicate claims before constructing the one embed batch', async () => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });

    const result = await classifier.classify({
      session,
      purpose: 'retain only meaningful semantic sources',
      notes: [' ', '\n\t', ' retained note ', '   '],
      claims: [
        { path: '   ' },
        { path: '\n', symbolPath: 'function ignoredBecausePathIsBlank' },
        { path: ' lib/keep.ts ', symbolPath: '  ' },
        { path: 'lib/keep.ts' },
        { path: 'lib/keep.ts', symbolPath: null },
        { path: 'lib/keep.ts', symbolPath: undefined },
        { path: ' lib/symbol.ts ', symbolPath: ' function retained ' },
      ],
      diffHunks: ['  ', '\n\t'],
    });

    expect(embedder.batches).toEqual([[
      'purpose: retain only meaningful semantic sources',
      'note: retained note',
      'claimed surface: lib/keep.ts',
      'claimed surface: lib/symbol.ts#function retained',
    ]]);
    expect(result.provenance.input).toMatchObject({
      sourceCount: 4,
      noteCount: 1,
      claimCount: 2,
      diffHunkCount: 0,
    });
    expect(result.surfaceClaims).toEqual(['lib/keep.ts', 'lib/symbol.ts#function retained']);
  });

  test('normalizes each source independently of its raw magnitude', async () => {
    const classifyWithFirstMagnitude = async (scale: number) => {
      const embedder = fakeEmbedder((_text, index) => (
        index === 0 ? [3 * scale, 4 * scale] : [4, -3]
      ));
      const classifier = createAgentContextClassifierTestSeam({ embedder, clock: () => 1 });
      return classifier.classify({
        session,
        purpose: 'normalization scale invariance',
        notes: ['independent semantic evidence'],
      });
    };

    const baseline = await classifyWithFirstMagnitude(1);
    const scaled = await classifyWithFirstMagnitude(100);

    expect(scaled.topicEmbedding).toHaveLength(baseline.topicEmbedding.length);
    scaled.topicEmbedding.forEach((value, index) => {
      expect(value).toBeCloseTo(baseline.topicEmbedding[index], 12);
    });
    expect(scaled.confidence).toBe(baseline.confidence);
    expect(scaled.provenance.topicSource).toEqual(baseline.provenance.topicSource);
    expect(Math.hypot(...scaled.topicEmbedding)).toBeCloseTo(1, 12);
  });

  test('evaluates the exact stale boundary with the injected clock', async () => {
    let now = 1_000;
    const classifier = createAgentContextClassifierTestSeam({
      embedder: fakeEmbedder(() => [1, 0]),
      clock: () => now,
      staleAfterMs: 1_000,
    });
    const result = await classifier.classify({ session, purpose: 'staleness boundary proof' });

    now = 1_999;
    expect(classifier.isStale(result)).toBe(false);
    now = 2_000;
    expect(classifier.isStale(result)).toBe(true);
  });

  test('fails loudly when the local model is unavailable and never emits a fallback classification', async () => {
    const embedder: LocalEmbedder = {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      async embed(): Promise<number[][]> {
        throw new Error('model is not cached');
      },
    };
    const classifier = createAgentContextClassifierTestSeam({ embedder });
    const promise = classifier.classify({ session, purpose: 'local model degradation' });

    await expect(promise).rejects.toBeInstanceOf(AgentContextClassifierUnavailableError);
    await expect(promise).rejects.toMatchObject({
      code: 'AGENT_CONTEXT_EMBEDDER_UNAVAILABLE',
      degraded: true,
      modelId: 'Xenova/all-MiniLM-L6-v2',
    });
    await expect(promise).rejects.toThrow('No classification was emitted; no remote or lexical-only fallback was attempted');
  });

  test('default production path refuses a missing cache even when generic model downloads are opted in', async () => {
    const cacheDir = join(process.cwd(), '.scratch', 'agent-context-classifier-missing-model-fixture');
    const previousCacheDir = process.env.PD_TRANSFORMERS_CACHE_DIR;
    const previousDownloadOptIn = process.env.PORT_DADDY_ALLOW_MODEL_DOWNLOAD;
    expect(existsSync(cacheDir)).toBe(false);

    process.env.PD_TRANSFORMERS_CACHE_DIR = cacheDir;
    process.env.PORT_DADDY_ALLOW_MODEL_DOWNLOAD = '1';
    try {
      const classifier = createAgentContextClassifier();
      await expect(classifier.classify({ session, purpose: 'never perform periodic model egress' }))
        .rejects.toMatchObject({
          code: 'AGENT_CONTEXT_EMBEDDER_UNAVAILABLE',
          degraded: true,
          modelId: 'Xenova/all-MiniLM-L6-v2',
        });
    } finally {
      if (previousCacheDir === undefined) delete process.env.PD_TRANSFORMERS_CACHE_DIR;
      else process.env.PD_TRANSFORMERS_CACHE_DIR = previousCacheDir;
      if (previousDownloadOptIn === undefined) delete process.env.PORT_DADDY_ALLOW_MODEL_DOWNLOAD;
      else process.env.PORT_DADDY_ALLOW_MODEL_DOWNLOAD = previousDownloadOptIn;
    }
    expect(existsSync(cacheDir)).toBe(false);
  });

  test('rejects an embedding batch whose vector count does not match its sources', async () => {
    const embedder: LocalEmbedder = {
      modelId: 'Xenova/broken-MiniLM',
      async embed(): Promise<number[][]> {
        return [];
      },
    };
    const classifier = createAgentContextClassifierTestSeam({ embedder });

    await expect(classifier.classify({ session, purpose: 'invalid vector count' }))
      .rejects.toThrow('expected 1 vectors, received 0');
  });

  test.each([
    ['zero vector', [[0, 0]]],
    ['non-finite vector', [[Number.NaN, 1]]],
  ])('rejects malformed embedder output: %s', async (_label, vectors) => {
    const embedder: LocalEmbedder = {
      modelId: 'Xenova/broken-MiniLM',
      async embed(): Promise<number[][]> {
        return vectors as number[][];
      },
    };
    const classifier = createAgentContextClassifierTestSeam({ embedder });

    await expect(classifier.classify({ session, purpose: 'invalid vector contract' }))
      .rejects.toBeInstanceOf(AgentContextClassifierOutputError);
  });

  test('rejects missing purpose or source-session identity before invoking the model', async () => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder });
    const missingPurpose: AgentContextInput = { session, purpose: '   ' };

    await expect(classifier.classify(missingPurpose)).rejects.toThrow('purpose must be a non-empty string');
    expect(embedder.batches).toHaveLength(0);
  });

  test.each(['sessionId', 'agentId', 'identity'] as const)(
    'rejects a blank %s before invoking the model',
    async (field) => {
      const embedder = fakeEmbedder(() => [1, 0]);
      const classifier = createAgentContextClassifierTestSeam({ embedder });
      const missingIdentity: AgentContextInput = {
        session: { ...session, [field]: '   ' },
        purpose: 'identity must remain attributable',
      };

      await expect(classifier.classify(missingIdentity))
        .rejects.toThrow(`${field} must be a non-empty string`);
      expect(embedder.batches).toHaveLength(0);
    },
  );

  test('rejects a non-string identity with the classifier validation error', async () => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifierTestSeam({ embedder });
    const invalidIdentity = {
      session: { ...session, agentId: 42 },
      purpose: 'identity types remain explicit at the JavaScript boundary',
    } as unknown as AgentContextInput;

    await expect(classifier.classify(invalidIdentity))
      .rejects.toThrow('agentId must be a non-empty string');
    expect(embedder.batches).toHaveLength(0);
  });
});
