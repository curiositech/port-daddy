/**
 * Suggestions routes — the suggestibility layer's HTTP surface (ADR-0039).
 *
 *   GET  /suggestions?agentId=...&status=...&limit=...   list an agent's suggestions
 *   POST /suggestions/scan                               run the claim-overlap detector now
 *   POST /suggestions/:id/accept                         agent acted on it
 *   POST /suggestions/:id/decline                        agent declined (primes cooldown)
 *   POST /suggestions/mute   { agentId, kind, untilMs }  mute a kind for an agent
 *
 * `scan` is the on-demand trigger for this slice; the periodic/reactive auto-trigger
 * (a daemon tick or a claim-watcher hook) is the next slice. Detection composes the
 * shipped sessions claim index + agent inbox — see `lib/suggestion-broker.ts`.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Suggestions, SuggestionKind, SuggestionStatus } from '../lib/suggestions.js';
import type { BlastRadiusDeps } from '../lib/blast-radius.js';
import {
  runClaimTreeTroubleScan,
  type SessionsClaimSource,
  type BrokerInbox,
  type BrokerActivityLog,
} from '../lib/suggestion-broker.js';
import { runLiveSurfaceScan, type RunLiveSurfaceScanDeps } from '../lib/surface-live.js';

/** The full sessions module also exposes `list` (active sessions w/ worktreeId) — the
 *  route receives it at runtime even though the overlap path only needs the claim source. */
interface SessionsListSource {
  list?(options?: { status?: string }): {
    sessions?: Array<{ id: string; agentId: string | null; purpose: string; worktreeId: string | null }>;
  };
}

interface SuggestionsRouteDeps {
  suggestions: Suggestions;
  sessions: SessionsClaimSource & SessionsListSource;
  agentInbox: BrokerInbox;
  activityLog?: BrokerActivityLog;
  /** Present in the daemon — enables the real-edit semantic-conflict scan alongside the
   *  declared-claim overlap scan. Absent in minimal/test wiring (overlap only). */
  symbolIndex?: RunLiveSurfaceScanDeps['symbolIndex'];
}

export const suggestionsPlugin: FastifyPluginAsync<{ deps: SuggestionsRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { suggestions, sessions, agentInbox, activityLog, symbolIndex } = opts.deps;
  // The semantic scanner can run against a lighter symbol-index interface. The
  // claim-tree scanner asks for one additional, concrete capability: reverse
  // dependency traversal. Do not pretend the graph exists when it is absent.
  const dependencyGraph: BlastRadiusDeps | undefined = symbolIndex
    && typeof (symbolIndex as Partial<BlastRadiusDeps>).getDependents === 'function'
    ? symbolIndex as unknown as BlastRadiusDeps
    : undefined;

  fastify.get('/suggestions', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, string>;
    const parsedLimit = q.limit != null && q.limit !== '' ? Number(q.limit) : undefined;
    const items = suggestions.list({
      agentId: q.agentId || undefined,
      status: (q.status as SuggestionStatus) || undefined,
      limit: parsedLimit != null && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    return { success: true, suggestions: items, count: items.length };
  });

  fastify.post('/suggestions/scan', async () => {
    // 1) claim-tree trouble projection (the previous overlap-only nudge is a
    // subset of this finite-state explanation, so it is intentionally not run
    // alongside it and cannot double-notify an agent).
    const claimTree = runClaimTreeTroubleScan({ sessions, suggestions, inbox: agentInbox, activityLog, symbolIndex: dependencyGraph });
    // 2) real-edit semantic conflicts (signature/dependency/transitive, from each live
    //    session's actual git diff) — fires only when the symbol index is wired in.
    let semantic = null;
    if (symbolIndex && typeof sessions.list === 'function') {
      try {
        semantic = await runLiveSurfaceScan({
          listActiveSessions: () =>
            (sessions.list!({ status: 'active' }).sessions ?? []).map((s) => ({
              id: s.id,
              agentId: s.agentId,
              purpose: s.purpose,
              worktreeId: s.worktreeId,
            })),
          symbolIndex,
          suggestions,
          inbox: agentInbox,
          activityLog,
        });
      } catch (err) {
        activityLog?.log('surface_scan.error', { error: (err as Error).message });
      }
    }
    // `pairs` and the nested `claimTree` projection are the canonical contract.
    // The retired overlap-only count is deliberately not revived: it described a
    // less capable scan and would let consumers mistake the projection's unit.
    return { success: true, ...claimTree, claimTree, semantic };
  });

  fastify.post('/suggestions/:id/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = Number((request.params as { id: string }).id);
    const res = suggestions.accept(id);
    if (!res.success) {
      reply.code(res.error === 'not found' ? 404 : 409);
      return { success: false, error: res.error };
    }
    return { success: true, suggestion: res.suggestion };
  });

  fastify.post('/suggestions/:id/decline', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = Number((request.params as { id: string }).id);
    const res = suggestions.decline(id);
    if (!res.success) {
      reply.code(res.error === 'not found' ? 404 : 409);
      return { success: false, error: res.error };
    }
    return { success: true, suggestion: res.suggestion };
  });

  fastify.post('/suggestions/mute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { agentId?: string; kind?: string; untilMs?: number; durationMs?: number };
    if (!body.agentId || !body.kind) {
      reply.code(400);
      return { success: false, error: 'agentId and kind required' };
    }
    const until = body.untilMs ?? Date.now() + (body.durationMs ?? 24 * 60 * 60 * 1000);
    return suggestions.mute(body.agentId, body.kind as SuggestionKind, until);
  });
};
