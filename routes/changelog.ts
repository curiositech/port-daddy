/**
 * Changelog Routes
 *
 * Hierarchical changelog with identity-based rollup
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface ChangelogDeps {
  changelog: {
    add: (options: {
      identity: string;
      summary: string;
      type?: 'feature' | 'fix' | 'refactor' | 'docs' | 'chore' | 'breaking';
      description?: string;
      sessionId?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    }) => { success: boolean; id: number; identity: string; ancestors: string[] };
    get: (id: number) => { success: boolean; entry?: unknown; error?: string };
    list: (identity: string, limit?: number) => { success: boolean; identity: string; entries: unknown[]; count: number };
    listTree: (identity: string, limit?: number) => { success: boolean; identity: string; entries: unknown[]; count: number };
    recent: (limit?: number) => { success: boolean; entries: unknown[]; count: number };
    listBySession: (sessionId: string) => { success: boolean; sessionId: string; entries: unknown[]; count: number };
    listByAgent: (agentId: string, limit?: number) => { success: boolean; agentId: string; entries: unknown[]; count: number };
    since: (timestamp: number, limit?: number) => { success: boolean; since: number; entries: unknown[]; count: number };
    rollup: (rootIdentity: string) => unknown;
    export: (options?: { identity?: string; since?: number; limit?: number; format?: 'flat' | 'tree' | 'keep-a-changelog' }) => string;
    identities: () => { success: boolean; identities: string[]; count: number };
  };
}


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const changelogPlugin: FastifyPluginAsync<{ deps: ChangelogDeps }> = async (fastify, opts) => {
  const { changelog } = opts.deps;

  // POST /changelog - Add a changelog entry
  fastify.post('/changelog', async (request: FastifyRequest, reply: FastifyReply) => {
    const { identity, summary, type, description, sessionId, agentId, metadata } = request.body as any;

    if (!identity || typeof identity !== 'string') {
      reply.code(400);
      return { error: 'identity is required' };
    }

    if (!summary || typeof summary !== 'string') {
      reply.code(400);
      return { error: 'summary is required' };
    }

    const validTypes = ['feature', 'fix', 'refactor', 'docs', 'chore', 'breaking'];
    if (type && !validTypes.includes(type)) {
      reply.code(400);
      return { error: `type must be one of: ${validTypes.join(', ')}` };
    }

    const result = changelog.add({
      identity,
      summary,
      type,
      description,
      sessionId,
      agentId,
      metadata,
    });

    reply.code(201);
    return result;
  });

  // GET /changelog - List recent changelog entries
  fastify.get('/changelog', async (request: FastifyRequest, reply: FastifyReply) => {
    const limit = Math.min(parseInt((request.query as any).limit as string) || 50, 500);
    const since = (request.query as any).since ? parseInt((request.query as any).since as string) : undefined;
    const format = (request.query as any).format as 'flat' | 'tree' | 'keep-a-changelog' | undefined;

    if (format) {
      const markdown = changelog.export({ since, limit, format });
      if ((request.query as any).raw === 'true') {
        reply.type('text/markdown');
        return markdown;
      } else {
        return { success: true, format, markdown };
      }
    }

    if (since) {
      return changelog.since(since, limit);
    } else {
      return changelog.recent(limit);
    }
  });

  // GET /changelog/identities - List all distinct identities
  fastify.get('/changelog/identities', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return changelog.identities();
  });

  // GET /changelog/session/:sessionId - List entries for a session
  fastify.get('/changelog/session/:sessionId', async (request: FastifyRequest, _reply: FastifyReply) => {
    const sessionId = (request.params as any).sessionId as string;
    return changelog.listBySession(sessionId);
  });

  // GET /changelog/agent/:agentId - List entries for an agent
  fastify.get('/changelog/agent/:agentId', async (request: FastifyRequest, _reply: FastifyReply) => {
    const agentId = (request.params as any).agentId as string;
    const limit = Math.min(parseInt((request.query as any).limit as string) || 50, 500);
    return changelog.listByAgent(agentId, limit);
  });

  // GET /changelog/:id (numeric) - Get a single entry by ID
  // Note: Fastify doesn't support regex in route params the same way Express does.
  // We'll handle numeric vs identity in a single :id route.
  fastify.get('/changelog/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const idParam = (request.params as any).id as string;

    // If purely numeric, treat as entry ID
    if (/^\d+$/.test(idParam)) {
      const id = parseInt(idParam);
      const result = changelog.get(id);

      if (!result.success) {
        reply.code(404);
        return result;
      }

      return result;
    }

    // Otherwise treat as identity
    const identity = idParam;
    const limit = Math.min(parseInt((request.query as any).limit as string) || 50, 500);
    const tree = (request.query as any).tree === 'true';
    const format = (request.query as any).format as 'flat' | 'tree' | 'keep-a-changelog' | undefined;

    if (format) {
      const markdown = changelog.export({ identity, limit, format });
      if ((request.query as any).raw === 'true') {
        reply.type('text/markdown');
        return markdown;
      } else {
        return { success: true, identity, format, markdown };
      }
    }

    if ((request.query as any).rollup === 'true') {
      return { success: true, rollup: changelog.rollup(identity) };
    }

    if (tree) {
      return changelog.listTree(identity, limit);
    } else {
      return changelog.list(identity, limit);
    }
  });
};
