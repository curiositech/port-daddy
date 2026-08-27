/**
 * Agent Context Classifier — bounded, local semantic context for suggestibility.
 *
 * The classifier deliberately performs no retrieval and no remote inference. It
 * embeds one bounded snapshot with Port Daddy's shared MiniLM encoder, folds the
 * source vectors into a normalized centroid, and selects the source nearest that
 * centroid as the human-readable topic. A missing local model is a loud degraded
 * state: no topic is emitted and there is no lexical-only or remote fallback.
 */

import { createHash } from 'node:crypto';
import {
  cosineSimilarity,
  createLocalEmbedder,
  defaultTransformersCacheDir,
  isEmbeddingModelCached,
  type LocalEmbedder,
} from './semantic-resolver.js';

/** Versioned provenance label so stored classifications remain interpretable. */
export const AGENT_CONTEXT_CLASSIFIER_VERSION = 'b1.2-v1';

/** The classifier normally refreshes every 60-90 seconds (ADR-0039). */
export const DEFAULT_AGENT_CONTEXT_STALE_AFTER_MS = 90_000;

/**
 * Hard input/output limits. The purpose is to keep one periodic classification
 * independent of repository size and session age instead of letting context
 * grow with the worktree.
 */
export const AGENT_CONTEXT_LIMITS = Object.freeze({
  identityChars: 256,
  purposeChars: 512,
  notes: 20,
  noteChars: 512,
  claims: 32,
  claimChars: 384,
  diffHunks: 10,
  diffHunkChars: 768,
  topicWords: 8,
  topicChars: 96,
});

/** Exact Port Daddy principal/session identity carried into every result. */
export interface AgentContextSessionIdentity {
  sessionId: string;
  agentId: string;
  identity: string;
}

/** A currently claimed surface, optionally narrowed to an AST-backed symbol. */
export interface AgentContextClaim {
  path: string;
  symbolPath?: string | null;
}

/** Caller-supplied bounded-session snapshot before limits are applied. */
export interface AgentContextInput {
  session: AgentContextSessionIdentity;
  purpose: string;
  notes?: readonly string[];
  claims?: readonly AgentContextClaim[];
  diffHunks?: readonly string[];
}

/** Immutable timestamps; freshness is evaluated by the injected classifier clock. */
export interface AgentContextStaleness {
  generatedAt: number;
  staleAt: number;
  ttlMs: number;
}

/** Counts and truncation evidence for the exact bounded input that was embedded. */
export interface AgentContextInputProvenance {
  fingerprintSha256: string;
  sourceCount: number;
  purposeChars: number;
  noteCount: number;
  claimCount: number;
  diffHunkCount: number;
  truncated: boolean;
}

/** Local-model evidence for the emitted normalized centroid. */
export interface AgentContextEmbeddingProvenance {
  provider: 'local';
  modelId: string;
  cache: 'shared-minilm';
  dimensions: number;
  normalized: true;
}

/** Inspectable factors behind confidence instead of an unexplained scalar. */
export interface AgentContextConfidenceProvenance {
  method: 'pairwise-cosine-v1';
  semanticCoherence: number;
  sourceKindCoverage: number;
  support: number;
}

/** Complete provenance carried with a classifier result. */
export interface AgentContextProvenance {
  classifierVersion: typeof AGENT_CONTEXT_CLASSIFIER_VERSION;
  input: AgentContextInputProvenance;
  embedding: AgentContextEmbeddingProvenance;
  topicSource: {
    kind: AgentContextSourceKind;
    index: number;
    semanticCentrality: number;
  };
  confidence: AgentContextConfidenceProvenance;
}

/**
 * Successful topical classification. The flat topic/embedding names follow
 * ADR-0039, while the nested metadata makes model, input, and freshness claims
 * independently inspectable.
 */
export interface AgentContextClassification {
  agentId: string;
  sessionId: string;
  identity: string;
  session: AgentContextSessionIdentity;
  topicTag: string;
  topicEmbedding: number[];
  confidence: number;
  surfaceClaims: string[];
  generatedAt: number;
  staleAt: number;
  staleness: AgentContextStaleness;
  provenance: AgentContextProvenance;
}

/** Production freshness policy; the embedder is deliberately not selectable. */
export interface AgentContextClassifierOptions {
  clock?: () => number;
  staleAfterMs?: number;
}

/**
 * @internal Deterministic test seam. Production callers must use
 * `createAgentContextClassifier`, which always constructs the cache-gated shared
 * MiniLM embedder. This type does not authorize alternate production providers.
 */
export interface AgentContextClassifierTestOptions extends AgentContextClassifierOptions {
  embedder: LocalEmbedder;
}

/** Public classifier surface; storage/timer wiring remains a separate slice. */
export interface AgentContextClassifier {
  /**
   * Classify one bounded session snapshot using only the local semantic model.
   *
   * @param input Purpose, notes, claims, diff hunks, and exact session identity.
   * @returns A normalized, attributable classification with freshness metadata.
   */
  classify(input: AgentContextInput): Promise<AgentContextClassification>;

  /**
   * Evaluate a stored classification against the injected clock. The design
   * keeps the serialized result immutable while allowing freshness to advance.
   *
   * @param classification Previously emitted classification.
   * @returns True at or after its `staleAt` boundary.
   */
  isStale(classification: AgentContextClassification): boolean;
}

/** Source categories whose coverage contributes to the confidence calculation. */
const AGENT_CONTEXT_SOURCE_KINDS = ['purpose', 'note', 'claim', 'diff'] as const;
type AgentContextSourceKind = (typeof AGENT_CONTEXT_SOURCE_KINDS)[number];

/** One bounded semantic document in the single embedding batch. */
interface AgentContextSource {
  kind: AgentContextSourceKind;
  index: number;
  value: string;
  embeddingText: string;
}

/** Internal bounded snapshot plus evidence about information discarded by caps. */
interface BoundedAgentContext {
  session: AgentContextSessionIdentity;
  purpose: string;
  notes: string[];
  claims: AgentContextClaim[];
  diffHunks: string[];
  sources: AgentContextSource[];
  truncated: boolean;
}

/**
 * Typed loud-degradation error. Consumers can render `degraded` without
 * mistaking the absence of a model for a low-confidence lexical result.
 */
export class AgentContextClassifierUnavailableError extends Error {
  readonly code = 'AGENT_CONTEXT_EMBEDDER_UNAVAILABLE';
  readonly degraded = true;
  readonly modelId: string;

  /**
   * Preserve the local model id and cause so repair surfaces can explain the
   * exact failed dependency without exposing context text.
   *
   * @param modelId Local embedding model that could not produce vectors.
   * @param cause Original loader/inference failure.
   */
  constructor(modelId: string, cause: unknown) {
    const detail = cause instanceof Error && cause.message.trim()
      ? ` Cause: ${cause.message.trim()}`
      : '';
    super(
      `Agent context classifier degraded: local embedding model ${modelId} is unavailable. ` +
      'No classification was emitted; no remote or lexical-only fallback was attempted. ' +
      `Repair the shared MiniLM installation with pd doctor or pd embed prefetch.${detail}`,
      { cause },
    );
    this.name = 'AgentContextClassifierUnavailableError';
    this.modelId = modelId;
  }
}

/** Loud contract error for malformed or non-normalizable embedder output. */
export class AgentContextClassifierOutputError extends Error {
  readonly code = 'AGENT_CONTEXT_INVALID_EMBEDDING';

  /**
   * Keep malformed model output distinct from model availability. This purpose
   * prevents callers from retrying corrupt vectors as if a cache were missing.
   *
   * @param message Specific violated vector contract.
   */
  constructor(message: string) {
    super(`Agent context classifier rejected embedding output: ${message}`);
    this.name = 'AgentContextClassifierOutputError';
  }
}

/**
 * Clamp a numeric score to the probability interval. Design intent: every
 * serialized confidence factor obeys the same closed 0..1 contract.
 *
 * @param value Candidate score.
 * @returns `value` constrained to 0..1.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Round inspectable scores so JSON receipts stay stable across runtimes. The
 * purpose is deterministic tuple evidence, not cosmetic display precision.
 *
 * @param value Floating-point score.
 * @returns Score rounded to six decimal places.
 */
function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Validate an identity field without silently changing the principal. The
 * design rejects overlong identifiers instead of truncating attribution.
 *
 * @param value Candidate identity field.
 * @param field Human-readable field name for errors.
 * @returns The trimmed exact identifier.
 */
function requireIdentity(value: unknown, field: keyof AgentContextSessionIdentity): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Agent context ${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`Agent context ${field} must be a non-empty string`);
  if (trimmed.length > AGENT_CONTEXT_LIMITS.identityChars) {
    throw new RangeError(`Agent context ${field} exceeds ${AGENT_CONTEXT_LIMITS.identityChars} characters`);
  }
  return trimmed;
}

/**
 * Collapse whitespace and cap one semantic input. This purpose prevents a
 * single verbose note or diff hunk from consuming the periodic context budget.
 *
 * @param value Raw source text.
 * @param maxChars Maximum retained characters.
 * @returns Bounded text and whether any content was discarded.
 */
function boundText(value: string, maxChars: number): { value: string; truncated: boolean } {
  const collapsed = (value ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return { value: collapsed, truncated: false };
  return { value: collapsed.slice(0, maxChars).trimEnd(), truncated: true };
}

/**
 * Convert the semantic winner into a short operator-facing tag. Design intent:
 * selection stays embedding-driven while this function only sanitizes and
 * bounds the chosen label.
 *
 * @param value Source text selected by cosine centrality.
 * @returns A non-empty topic of at most eight words and 96 characters.
 */
function topicFromSource(value: string): string {
  const words = value
    .replace(/[\\/_.:#()[\]{}>`*]+/g, ' ')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, AGENT_CONTEXT_LIMITS.topicWords);
  const topic = words.join(' ').slice(0, AGENT_CONTEXT_LIMITS.topicChars).trim();
  if (!topic) throw new TypeError('Agent context produced no displayable topic text');
  return topic;
}

/**
 * Bound arrays and construct the one semantic batch in a stable order. Design
 * intent: stable ordering makes fingerprints, topic tie-breaking, and tests
 * reproducible.
 *
 * @param input Unbounded caller snapshot.
 * @returns Bounded sources plus truncation evidence.
 */
function boundAgentContext(input: AgentContextInput): BoundedAgentContext {
  const session: AgentContextSessionIdentity = {
    sessionId: requireIdentity(input.session?.sessionId, 'sessionId'),
    agentId: requireIdentity(input.session?.agentId, 'agentId'),
    identity: requireIdentity(input.session?.identity, 'identity'),
  };
  const boundedPurpose = boundText(input.purpose, AGENT_CONTEXT_LIMITS.purposeChars);
  if (!boundedPurpose.value) throw new TypeError('Agent context purpose must be a non-empty string');

  let truncated = boundedPurpose.truncated;
  const rawNotes = input.notes ?? [];
  const notes = rawNotes.slice(0, AGENT_CONTEXT_LIMITS.notes).flatMap((note) => {
    const bounded = boundText(note, AGENT_CONTEXT_LIMITS.noteChars);
    truncated ||= bounded.truncated;
    return bounded.value ? [bounded.value] : [];
  });
  truncated ||= rawNotes.length > AGENT_CONTEXT_LIMITS.notes;

  const rawClaims = input.claims ?? [];
  const claims: AgentContextClaim[] = [];
  const seenClaims = new Set<string>();
  for (const claim of rawClaims.slice(0, AGENT_CONTEXT_LIMITS.claims)) {
    const boundedPath = boundText(claim?.path ?? '', AGENT_CONTEXT_LIMITS.claimChars);
    const boundedSymbol = boundText(claim?.symbolPath ?? '', AGENT_CONTEXT_LIMITS.claimChars);
    truncated ||= boundedPath.truncated || boundedSymbol.truncated;
    if (!boundedPath.value) continue;
    const key = `${boundedPath.value}\u0000${boundedSymbol.value}`;
    if (seenClaims.has(key)) continue;
    seenClaims.add(key);
    claims.push({ path: boundedPath.value, symbolPath: boundedSymbol.value || null });
  }
  truncated ||= rawClaims.length > AGENT_CONTEXT_LIMITS.claims;

  const rawDiffHunks = input.diffHunks ?? [];
  const diffHunks = rawDiffHunks.slice(0, AGENT_CONTEXT_LIMITS.diffHunks).flatMap((hunk) => {
    const bounded = boundText(hunk, AGENT_CONTEXT_LIMITS.diffHunkChars);
    truncated ||= bounded.truncated;
    return bounded.value ? [bounded.value] : [];
  });
  truncated ||= rawDiffHunks.length > AGENT_CONTEXT_LIMITS.diffHunks;

  const sources: AgentContextSource[] = [
    { kind: 'purpose', index: 0, value: boundedPurpose.value, embeddingText: `purpose: ${boundedPurpose.value}` },
    ...notes.map((value, index) => ({ kind: 'note' as const, index, value, embeddingText: `note: ${value}` })),
    ...claims.map((claim, index) => {
      const value = claim.symbolPath ? `${claim.path}#${claim.symbolPath}` : claim.path;
      return { kind: 'claim' as const, index, value, embeddingText: `claimed surface: ${value}` };
    }),
    ...diffHunks.map((value, index) => ({ kind: 'diff' as const, index, value, embeddingText: `changed code: ${value}` })),
  ];

  return { session, purpose: boundedPurpose.value, notes, claims, diffHunks, sources, truncated };
}

/**
 * L2-normalize and validate one vector. Design intent: normalize even though
 * MiniLM promises normalized output so injected/changed implementations cannot
 * weaken the stored contract.
 *
 * @param vector Raw embedding vector.
 * @param label Source label used in loud errors.
 * @returns Finite unit-length vector.
 */
function normalizeEmbedding(vector: number[], label: string): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new AgentContextClassifierOutputError(`${label} is empty`);
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new AgentContextClassifierOutputError(`${label} contains a non-finite value`);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
    throw new AgentContextClassifierOutputError(`${label} has zero magnitude`);
  }
  return vector.map((value) => value / norm);
}

/**
 * Average normalized vectors into one unit centroid. This design makes every
 * retained source contribute while preserving the cosine-space contract.
 *
 * @param vectors Valid, equal-dimensional unit vectors.
 * @returns Unit-length semantic centroid.
 */
function centroidEmbedding(vectors: number[][]): number[] {
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some((vector) => vector.length !== dimensions)) {
    throw new AgentContextClassifierOutputError('vectors have inconsistent dimensions');
  }
  const centroid = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) centroid[index] += vector[index];
  }
  return normalizeEmbedding(centroid, 'semantic centroid');
}

/**
 * Select the source nearest the centroid. Design intent: ties retain stable
 * input order, so the purpose wins only when semantic evidence genuinely ties.
 *
 * @param sources Stable bounded sources.
 * @param vectors Normalized source vectors in matching order.
 * @param centroid Normalized combined embedding.
 * @returns Selected source and its cosine centrality.
 */
function selectTopicSource(
  sources: AgentContextSource[],
  vectors: number[][],
  centroid: number[],
): { source: AgentContextSource; centrality: number } {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < sources.length; index += 1) {
    const score = cosineSimilarity(vectors[index], centroid);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return { source: sources[bestIndex], centrality: roundScore(clamp01(bestScore)) };
}

/**
 * Compute confidence from pairwise semantic agreement, source-kind coverage,
 * and bounded support. The purpose avoids string overlap and artificial model
 * certainty: a purpose-only snapshot remains low confidence even with a valid
 * vector, while multiple coherent source kinds can approach one.
 *
 * @param sources Bounded sources included in classification.
 * @param vectors Normalized source embeddings.
 * @returns Scalar confidence plus inspectable factor values.
 */
function confidenceFromSemanticEvidence(
  sources: AgentContextSource[],
  vectors: number[][],
): { confidence: number; provenance: AgentContextConfidenceProvenance } {
  let pairCount = 0;
  let pairTotal = 0;
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      pairTotal += clamp01(cosineSimilarity(vectors[left], vectors[right]));
      pairCount += 1;
    }
  }
  const semanticCoherence = pairCount > 0 ? pairTotal / pairCount : 0;
  const sourceKindDenominator = AGENT_CONTEXT_SOURCE_KINDS.length;
  const sourceKindCoverage = new Set(sources.map((source) => source.kind)).size
    / sourceKindDenominator;
  const support = Math.min(
    1,
    Math.max(0, sources.length - 1) / sourceKindDenominator,
  );
  const confidence = clamp01(
    0.25 + (0.55 * semanticCoherence) + (0.10 * sourceKindCoverage) + (0.10 * support),
  );
  return {
    confidence: roundScore(confidence),
    provenance: {
      method: 'pairwise-cosine-v1',
      semanticCoherence: roundScore(semanticCoherence),
      sourceKindCoverage: roundScore(sourceKindCoverage),
      support: roundScore(support),
    },
  };
}

/**
 * Hash the bounded snapshot, never the discarded tail. The motivation is to
 * let tuple consumers detect repeated classifications without persisting raw
 * notes or diff text in provenance.
 *
 * @param bounded Exact bounded snapshot used to build embedding sources.
 * @returns Lowercase SHA-256 hex fingerprint.
 */
function inputFingerprint(bounded: BoundedAgentContext): string {
  return createHash('sha256')
    .update(JSON.stringify({
      session: bounded.session,
      sources: bounded.sources.map(({ kind, index, value }) => ({ kind, index, value })),
    }))
    .digest('hex');
}

/**
 * Construct the production embedder behind an explicit cache-presence gate.
 * The design makes this classifier stricter than the generic resolver: even an
 * installation-wide download opt-in cannot turn a periodic classification tick
 * into network work. A missing model therefore reaches the typed degraded path.
 *
 * @returns Shared-cache MiniLM embedder that can only read local artifacts.
 */
function createStrictSharedMiniLMEmbedder(): LocalEmbedder {
  const cacheDir = defaultTransformersCacheDir();
  const embedder = createLocalEmbedder({ cacheDir });
  return {
    modelId: embedder.modelId,
    /**
     * Refuse an uncached model before the generic embedder can evaluate any
     * download opt-in. The design keeps periodic work local and predictable.
     *
     * @param texts Bounded semantic documents to encode in one logical batch.
     * @returns Normalized vectors from the shared cached MiniLM model.
     */
    async embed(texts: string[]): Promise<number[][]> {
      if (!isEmbeddingModelCached(cacheDir, embedder.modelId)) {
        throw new Error(
          `model ${embedder.modelId} is missing from the shared cache at ${cacheDir}; ` +
          'remote model loading is disabled for periodic agent-context classification',
        );
      }
      return embedder.embed(texts);
    },
  };
}

/**
 * Build the classifier around an already selected embedder. Design intent:
 * share one implementation between the production factory and its explicit
 * deterministic test seam without reopening production provider selection.
 *
 * @param embedder Production-selected MiniLM embedder or a deterministic test fake.
 * @param options Clock and staleness policy.
 * @returns A classifier with deterministic classification and freshness APIs.
 */
function createAgentContextClassifierWithEmbedder(
  embedder: LocalEmbedder,
  options: AgentContextClassifierOptions,
): AgentContextClassifier {
  const clock = options.clock ?? Date.now;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_AGENT_CONTEXT_STALE_AFTER_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new RangeError('Agent context staleAfterMs must be a positive finite number');
  }

  return {
    /**
     * Classify one bounded snapshot. Design intent: embedding failures are
     * explicit degraded errors and malformed vectors never reach tuple storage.
     *
     * @param input Session context and exact source identity.
     * @returns Normalized semantic context with confidence and provenance.
     */
    async classify(input): Promise<AgentContextClassification> {
      const bounded = boundAgentContext(input);
      let rawVectors: number[][];
      try {
        rawVectors = await embedder.embed(bounded.sources.map((source) => source.embeddingText));
      } catch (error) {
        throw new AgentContextClassifierUnavailableError(embedder.modelId, error);
      }
      if (rawVectors.length !== bounded.sources.length) {
        throw new AgentContextClassifierOutputError(
          `expected ${bounded.sources.length} vectors, received ${rawVectors.length}`,
        );
      }
      const vectors = rawVectors.map((vector, index) => normalizeEmbedding(vector, `source vector ${index}`));
      const dimensions = vectors[0]?.length ?? 0;
      if (vectors.some((vector) => vector.length !== dimensions)) {
        throw new AgentContextClassifierOutputError('vectors have inconsistent dimensions');
      }

      const topicEmbedding = centroidEmbedding(vectors);
      const selected = selectTopicSource(bounded.sources, vectors, topicEmbedding);
      const scored = confidenceFromSemanticEvidence(bounded.sources, vectors);
      const generatedAt = clock();
      if (!Number.isFinite(generatedAt) || generatedAt < 0) {
        throw new RangeError('Agent context classifier clock must return a non-negative finite timestamp');
      }
      const staleAt = generatedAt + staleAfterMs;
      const surfaceClaims = bounded.claims.map((claim) => (
        claim.symbolPath ? `${claim.path}#${claim.symbolPath}` : claim.path
      ));

      return {
        agentId: bounded.session.agentId,
        sessionId: bounded.session.sessionId,
        identity: bounded.session.identity,
        session: { ...bounded.session },
        topicTag: topicFromSource(selected.source.value),
        topicEmbedding,
        confidence: scored.confidence,
        surfaceClaims,
        generatedAt,
        staleAt,
        staleness: { generatedAt, staleAt, ttlMs: staleAfterMs },
        provenance: {
          classifierVersion: AGENT_CONTEXT_CLASSIFIER_VERSION,
          input: {
            fingerprintSha256: inputFingerprint(bounded),
            sourceCount: bounded.sources.length,
            purposeChars: bounded.purpose.length,
            noteCount: bounded.notes.length,
            claimCount: bounded.claims.length,
            diffHunkCount: bounded.diffHunks.length,
            truncated: bounded.truncated,
          },
          embedding: {
            provider: 'local',
            modelId: embedder.modelId,
            cache: 'shared-minilm',
            dimensions,
            normalized: true,
          },
          topicSource: {
            kind: selected.source.kind,
            index: selected.source.index,
            semanticCentrality: selected.centrality,
          },
          confidence: scored.provenance,
        },
      };
    },

    /**
     * Compare immutable freshness evidence with the injected clock. The design
     * avoids serializing a stale boolean that becomes incorrect with time.
     *
     * @param classification Previously emitted semantic context.
     * @returns True once the classification reaches its stale boundary.
     */
    isStale(classification): boolean {
      return clock() >= classification.staleAt;
    },
  };
}

/**
 * Create the production local-only topical classifier. The embedder is not an
 * option: every production caller goes through the cache-presence gate and the
 * one shared `createLocalEmbedder` MiniLM implementation. Design intent: make
 * the one-model, no-download boundary structural rather than advisory.
 *
 * @param options Clock and staleness policy only.
 * @returns A classifier backed by the cache-gated shared MiniLM embedder.
 */
export function createAgentContextClassifier(
  options: AgentContextClassifierOptions = {},
): AgentContextClassifier {
  return createAgentContextClassifierWithEmbedder(createStrictSharedMiniLMEmbedder(), options);
}

/**
 * @internal Create a classifier with deterministic vectors for unit tests.
 * This explicit seam keeps fake or failing embedders out of the production
 * factory instead of treating arbitrary `LocalEmbedder` values as authorized
 * providers. Design intent: test semantic behavior without model or network
 * nondeterminism while keeping production provider selection closed.
 *
 * @param options Required test embedder plus deterministic clock/TTL controls.
 * @returns A classifier suitable for isolated contract tests.
 */
export function createAgentContextClassifierTestSeam(
  options: AgentContextClassifierTestOptions,
): AgentContextClassifier {
  const { embedder, ...classifierOptions } = options;
  return createAgentContextClassifierWithEmbedder(embedder, classifierOptions);
}
