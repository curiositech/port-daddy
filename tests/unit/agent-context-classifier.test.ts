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
    const classifier = createAgentContextClassifier({ embedder, clock: () => 10_000, staleAfterMs: 60_000 });

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
    expect(result.topicEmbedding[0]).toBeCloseTo(0.6, 12);
    expect(result.topicEmbedding[1]).toBeCloseTo(0.8, 12);
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
    const classifier = createAgentContextClassifier({ embedder, clock: () => 1 });

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

  test('evaluates the exact stale boundary with the injected clock', async () => {
    let now = 1_000;
    const classifier = createAgentContextClassifier({
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
    const classifier = createAgentContextClassifier({ embedder });
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

  test.each([
    ['missing vector', []],
    ['zero vector', [[0, 0]]],
    ['non-finite vector', [[Number.NaN, 1]]],
  ])('rejects malformed embedder output: %s', async (_label, vectors) => {
    const embedder: LocalEmbedder = {
      modelId: 'Xenova/broken-MiniLM',
      async embed(): Promise<number[][]> {
        return vectors as number[][];
      },
    };
    const classifier = createAgentContextClassifier({ embedder });

    await expect(classifier.classify({ session, purpose: 'invalid vector contract' }))
      .rejects.toBeInstanceOf(AgentContextClassifierOutputError);
  });

  test('rejects missing purpose or source-session identity before invoking the model', async () => {
    const embedder = fakeEmbedder(() => [1, 0]);
    const classifier = createAgentContextClassifier({ embedder });
    const missingPurpose: AgentContextInput = { session, purpose: '   ' };
    const missingSession: AgentContextInput = {
      session: { ...session, sessionId: '' },
      purpose: 'identity must remain attributable',
    };

    await expect(classifier.classify(missingPurpose)).rejects.toThrow('purpose must be a non-empty string');
    await expect(classifier.classify(missingSession)).rejects.toThrow('sessionId must be a non-empty string');
    expect(embedder.batches).toHaveLength(0);
  });
});
