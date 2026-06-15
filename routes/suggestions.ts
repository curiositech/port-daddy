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
import {
  runOverlapScan,
  type SessionsClaimSource,
  type BrokerInbox,
  type BrokerActivityLog,
} from '../lib/suggestion-broker.js';

interface SuggestionsRouteDeps {
  suggestions: Suggestions;
  sessions: SessionsClaimSource;
  agentInbox: BrokerInbox;
  activityLog?: BrokerActivityLog;
}

export const suggestionsPlugin: FastifyPluginAsync<{ deps: SuggestionsRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { suggestions, sessions, agentInbox, activityLog } = opts.deps;

  fastify.get('/suggestions', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, string>;
    const items = suggestions.list({
      agentId: q.agentId || undefined,
      status: (q.status as SuggestionStatus) || undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { success: true, suggestions: items, count: items.length };
  });

  fastify.post('/suggestions/scan', async () => {
    const result = runOverlapScan({ sessions, suggestions, inbox: agentInbox, activityLog });
    return { success: true, ...result };
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
