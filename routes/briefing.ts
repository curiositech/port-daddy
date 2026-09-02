/**
 * Briefing Routes
 *
 * POST /briefing          — Generate .portdaddy/ in projectRoot, write to disk
 * GET  /briefing          — Detect project from projectRoot, no disk write
 * GET  /briefing/:project — Return briefing as JSON (no disk write)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateProjectRoot } from '../lib/utils.js';

interface BriefingRouteDeps {
  briefing: {
    generate(projectRoot: string, options?: { project?: string | null; writeToDisk?: boolean; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      briefing?: Record<string, unknown>;
      error?: string;
    };
    sync(projectRoot: string, options?: { project?: string | null; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      archivedSessions?: number;
      archivedAgents?: number;
      error?: string;
    };
    gatherData(project: string, projectRoot: string): Record<string, unknown>;
    detectProject(projectRoot: string, explicitProject?: string | null): string;
  };
}


// =============================================================================
// Fastify plugin export
// =============================================================================

export const briefingPlugin: FastifyPluginAsync<{ deps: BriefingRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { briefing } = deps;

  fastify.post('/briefing', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectRoot, project, full } = (request.body ?? {}) as any;

    if (!projectRoot || typeof projectRoot !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectRoot is required' };
    }

    const validation = validateProjectRoot(projectRoot);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    try {
      if (full) {
        const result = briefing.sync(projectRoot, { project, full: true });
        if (!result.success) { reply.code(400); return result; }
        return result;
      } else {
        const result = briefing.generate(projectRoot, { project });
        if (!result.success) { reply.code(400); return result; }
        return result;
      }
    } catch (err) {
      reply.code(500);
      return { success: false, error: (err as Error).message };
    }
  });

  const readBriefing = async (projectRoot: unknown, project: string | undefined, reply: FastifyReply) => {
    if (!projectRoot || typeof projectRoot !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectRoot is required' };
    }

    const validation = validateProjectRoot(projectRoot);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    try {
      const result = briefing.generate(projectRoot, { project, writeToDisk: false });
      if (!result.success) { reply.code(400); return result; }
      return { success: true, briefing: result.briefing };
    } catch (err) {
      reply.code(500);
      return { success: false, error: (err as Error).message };
    }
  };

  fastify.get('/briefing', async (request: FastifyRequest, reply: FastifyReply) => {
    // No magic project name: omitted project and the literal name "auto" differ.
    return readBriefing((request.query as any).projectRoot, undefined, reply);
  });

  fastify.get('/briefing/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { project } = request.params as { project: string };
    const projectRoot = (request.query as any).projectRoot ?? process.cwd();
    return readBriefing(projectRoot, project, reply);
  });
};
