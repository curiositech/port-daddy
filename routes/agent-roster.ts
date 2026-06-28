import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  buildActiveAgentRoster,
  type ActiveAgentRosterAgent,
  type ActiveAgentRosterClaim,
  type ActiveAgentRosterSession,
} from '../lib/active-agent-roster.js';

interface AgentRosterRouteDeps {
  agents: {
    list(opts: { activeOnly?: boolean; identityPrefix?: string }): { agents?: ActiveAgentRosterAgent[] };
  };
  sessions: {
    list(opts?: { status?: string; project?: string | null; allWorktrees?: boolean; includeNotes?: boolean; limit?: number }): { sessions?: ActiveAgentRosterSession[] };
    listAllActiveClaims(opts?: Record<string, unknown>): { claims?: ActiveAgentRosterClaim[] };
  };
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const agentRosterPlugin: FastifyPluginAsync<{ deps: AgentRosterRouteDeps }> = async (fastify, opts) => {
  const { agents, sessions, metrics, logger } = opts.deps;

  fastify.get('/agent-roster', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { project?: unknown; limit?: unknown };
      const project = typeof query.project === 'string' && query.project.trim() ? query.project.trim() : null;
      const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 100;
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 250) : 100;

      const [agentRes, sessionRes, claimRes] = await Promise.all([
        agents.list({ activeOnly: false, ...(project ? { identityPrefix: project } : {}) }),
        sessions.list({ status: 'active', project, allWorktrees: true, includeNotes: true, limit }),
        Promise.resolve(sessions.listAllActiveClaims()),
      ]);

      return buildActiveAgentRoster({
        agents: agentRes.agents ?? [],
        sessions: sessionRes.sessions ?? [],
        claims: claimRes.claims ?? [],
        project,
      });
    } catch (error) {
      metrics.errors++;
      logger.error('agent_roster_failed', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
