import type { FastifyPluginAsync } from 'fastify';
import type { SemanticResolver, SemanticResolutionDecision, SemanticReviewAction } from '../lib/semantic-resolver.js';
import { collectSemanticAliases, type SemanticAlias } from '../lib/semantic-terms.js';
import type { Tuple, TupleSpace } from '../lib/tuples.js';
import type { EpisodicMemory, Episode } from '../lib/episodic-memory.js';
import type { MergeQueue } from '../lib/merge-queue.js';
import type { MergeQueueEntry } from '../lib/orchestrator-plugins.js';

interface SemanticRouteDeps {
  semanticResolver: SemanticResolver;
  tuples?: Pick<TupleSpace, 'rd'>;
  episodicMemory?: EpisodicMemory;
  mergeQueue?: Pick<MergeQueue, 'list'>;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const DEFAULT_DIAGNOSTIC_LIMIT = 10;
const MAX_DIAGNOSTIC_LIMIT = 50;

function parseLimit(value: string | undefined): number {
  if (!value) return DEFAULT_DIAGNOSTIC_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DIAGNOSTIC_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_DIAGNOSTIC_LIMIT);
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (value == null) return output;
  if (typeof value === 'string') {
    if (value.trim()) output.push(value);
    return output;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, output);
    }
  }
  return output;
}

function textMatchesAlias(alias: SemanticAlias, values: unknown[]): boolean {
  const strings = values.flatMap((value) => collectStrings(value));
  const joined = strings.join(' ').toLowerCase();
  if (!joined) return false;
  if (joined.includes(alias.canonical.toLowerCase())) return true;
  if (alias.tokens.every((token) => joined.includes(token.toLowerCase()))) return true;

  const [candidate] = collectSemanticAliases([joined], { limit: 1 });
  if (!candidate) return false;
  const candidateTokens = new Set(candidate.tokens);
  return alias.tokens.every((token) => candidateTokens.has(token));
}

function tupleEvidence(tuple: Tuple): Record<string, unknown> {
  const [kind, sourceOrDecision, rawOrCanonical, canonicalOrCandidate, maybeSimilarityOrMetadata, maybeMetadata] = tuple.fields;
  const evidence: Record<string, unknown> = {
    id: tuple.id,
    harbor: tuple.harbor,
    kind,
    writtenBy: tuple.writtenBy,
    createdAt: tuple.createdAt,
    fields: tuple.fields,
  };

  if (kind === 'semantic:alias') {
    evidence.sourceType = sourceOrDecision ?? null;
    evidence.rawTerm = rawOrCanonical ?? null;
    evidence.canonicalTerm = canonicalOrCandidate ?? null;
    evidence.metadata = maybeSimilarityOrMetadata ?? null;
  } else if (kind === 'semantic:resolution') {
    evidence.decision = sourceOrDecision ?? null;
    evidence.canonicalTerm = rawOrCanonical ?? null;
    evidence.candidateTerm = canonicalOrCandidate ?? null;
    evidence.similarity = maybeSimilarityOrMetadata ?? null;
    evidence.metadata = maybeMetadata ?? null;
  }

  return evidence;
}

function episodeMatchesAlias(alias: SemanticAlias, episode: Episode): boolean {
  return textMatchesAlias(alias, [
    episode.title,
    episode.summary,
    episode.sourceType,
    episode.sourceId,
    episode.metadata,
  ]);
}

function mergeEntryTexts(entry: MergeQueueEntry): unknown[] {
  const metadata = entry.metadata ?? {};
  return [
    entry.branch,
    entry.baseBranch,
    metadata.task,
    metadata.title,
    metadata.purpose,
    metadata.summary,
    metadata,
    entry.claims.map((claim) => [
      claim.path,
      claim.symbol,
      claim.symbolPath,
      claim.startLine,
      claim.endLine,
    ]),
  ];
}

function mergeEntryMatchesAlias(alias: SemanticAlias, entry: MergeQueueEntry): boolean {
  return textMatchesAlias(alias, mergeEntryTexts(entry));
}

/**
 * Internal semantic-resolution API.
 *
 * Sample calls:
 * - `GET /semantic/stats?projectDir=/Users/erichowens/coding/port-daddy`
 * - `GET /semantic/resolutions?decision=review&limit=20`
 * - `GET /semantic/resolve?q=design-system+CSS+tasks&projectDir=/Users/erichowens/coding/port-daddy`
 * - `POST /semantic/resolutions/42/review` with `{ "action": "accept" }`
 * - `GET /semantic/search?q=port+daddy+css+tokens&limit=5`
 *
 * Sample response payload:
 * ```json
 * {
 *   "success": true,
 *   "model": "Xenova/all-MiniLM-L6-v2",
 *   "autoThreshold": 0.88,
 *   "reviewThreshold": 0.8,
 *   "reviewBacklog": 3
 * }
 * ```
 */
export const semanticPlugin: FastifyPluginAsync<{ deps: SemanticRouteDeps }> = async (fastify, opts) => {
  const { semanticResolver, tuples, episodicMemory, mergeQueue, metrics, logger } = opts.deps;

  /**
   * Return threshold and backlog health for the embedding join policy.
   */
  fastify.get('/semantic/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return {
        success: true,
        ...semanticResolver.stats(query.projectDir),
      };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Return recent persisted decisions so operators can inspect false positives,
   * misses, and near-threshold review candidates.
   */
  fastify.get('/semantic/resolutions', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const decision = query.decision as SemanticResolutionDecision | undefined;
      const resolutions = semanticResolver.listResolutions({
        projectDir: query.projectDir,
        decision,
        query: query.query || query.q,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, resolutions, count: resolutions.length };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_resolutions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Resolve a free-form phrase into its lexical canonical alias, then show the
   * live tuple, memory, merge, and resolver evidence that currently agrees with
   * that term. This is intentionally read-only and diagnostic-shaped for
   * operators checking whether the harmonization path is working end to end.
   */
  fastify.get('/semantic/resolve', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const text = query.query || query.q;
      if (!text?.trim()) {
        reply.code(400);
        return { success: false, error: 'query is required' };
      }

      const limit = parseLimit(query.limit);
      const aliases = collectSemanticAliases([text], { limit: 4 });
      const projectDir = query.projectDir;
      const project = query.project;
      const harbor = query.harbor;
      const scanLimit = Math.min(limit * 5, 200);

      const tupleAliasRows = tuples?.rd(['semantic:alias'], { harbor, limit: scanLimit }) ?? [];
      const tupleResolutionRows = tuples?.rd(['semantic:resolution'], { harbor, limit: scanLimit }) ?? [];
      const memoryRows = episodicMemory?.list({
        projectDir,
        project,
        harbor,
        limit: scanLimit,
      }) ?? [];
      const mergeRows = mergeQueue?.list({
        repository: projectDir,
        limit: scanLimit,
      }) ?? [];
      const resolutionRows = semanticResolver.listResolutions({
        projectDir,
        limit: scanLimit,
      });

      const diagnostics = await Promise.all(aliases.map(async (alias) => {
        let knownTerms: Awaited<ReturnType<SemanticResolver['search']>> = [];
        let searchError: string | null = null;
        try {
          knownTerms = await semanticResolver.search(alias.canonical, { limit });
        } catch (error) {
          searchError = error instanceof Error ? error.message : 'semantic search failed';
        }

        const tupleAliases = tupleAliasRows
          .filter((tuple) => textMatchesAlias(alias, tuple.fields))
          .slice(0, limit)
          .map(tupleEvidence);
        const resolutionTuples = tupleResolutionRows
          .filter((tuple) => textMatchesAlias(alias, tuple.fields))
          .slice(0, limit)
          .map(tupleEvidence);
        const memoryEpisodes = memoryRows
          .filter((episode) => episodeMatchesAlias(alias, episode))
          .slice(0, limit);
        const mergeEntries = mergeRows
          .filter((entry) => mergeEntryMatchesAlias(alias, entry))
          .slice(0, limit);
        const resolutions = resolutionRows
          .filter((resolution) => textMatchesAlias(alias, [
            resolution.rawTerm,
            resolution.canonicalTerm,
            resolution.candidateTerm,
            resolution.metadata,
          ]))
          .slice(0, limit);

        return {
          raw: alias.raw,
          canonicalTerm: alias.canonical,
          tokens: alias.tokens,
          fingerprint: alias.fingerprint,
          knownTerms,
          searchError,
          evidence: {
            tupleAliases,
            resolutionTuples,
            memoryEpisodes,
            mergeEntries,
            resolutions,
          },
          counts: {
            tupleAliases: tupleAliases.length,
            resolutionTuples: resolutionTuples.length,
            memoryEpisodes: memoryEpisodes.length,
            mergeEntries: mergeEntries.length,
            resolutions: resolutions.length,
            knownTerms: knownTerms.length,
          },
        };
      }));

      return {
        success: true,
        query: text,
        projectDir: projectDir ?? null,
        project: project ?? null,
        harbor: harbor ?? null,
        aliases: diagnostics,
        count: diagnostics.length,
        sources: {
          tuples: Boolean(tuples),
          memory: Boolean(episodicMemory),
          mergeQueue: Boolean(mergeQueue),
          semanticResolver: true,
        },
      };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_resolve_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Persist an operator review decision for a near-threshold candidate.
   */
  fastify.post('/semantic/resolutions/:id/review', async (request, reply) => {
    try {
      const id = Number.parseInt((request.params as { id?: string }).id ?? '', 10);
      const body = (request.body ?? {}) as {
        action?: SemanticReviewAction;
        reviewer?: string | null;
        note?: string | null;
      };
      if (!Number.isFinite(id) || id <= 0) {
        reply.code(400);
        return { success: false, error: 'resolution id is required' };
      }
      if (body.action !== 'accept' && body.action !== 'reject') {
        reply.code(400);
        return { success: false, error: 'action must be accept or reject' };
      }
      const resolution = semanticResolver.review(id, {
        action: body.action,
        reviewer: body.reviewer ?? null,
        note: body.note ?? null,
      });
      return { success: true, resolution };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'semantic review failed';
      if (message.includes('not found') || message.includes('no candidate term')) {
        reply.code(404);
        return { success: false, error: message };
      }
      metrics.errors += 1;
      logger.error('semantic_review_error', { error: message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Run nearest-neighbor search over the known semantic term inventory.
   */
  fastify.get('/semantic/search', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const text = query.query || query.q;
      if (!text?.trim()) {
        reply.code(400);
        return { success: false, error: 'query is required' };
      }
      const matches = await semanticResolver.search(text, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, matches, count: matches.length };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_search_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
