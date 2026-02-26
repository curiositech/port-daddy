/**
 * Changelog Routes
 *
 * Hierarchical changelog with identity-based rollup
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

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

export function createChangelogRoutes(deps: ChangelogDeps): Router {
  const router = Router();
  const { changelog } = deps;

  /**
   * POST /changelog
   * Add a changelog entry
   */
  router.post('/changelog', (req: Request, res: Response): void => {
    const { identity, summary, type, description, sessionId, agentId, metadata } = req.body;

    if (!identity || typeof identity !== 'string') {
      res.status(400).json({ error: 'identity is required' });
      return;
    }

    if (!summary || typeof summary !== 'string') {
      res.status(400).json({ error: 'summary is required' });
      return;
    }

    const validTypes = ['feature', 'fix', 'refactor', 'docs', 'chore', 'breaking'];
    if (type && !validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      return;
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

    res.status(201).json(result);
  });

  /**
   * GET /changelog
   * List recent changelog entries
   */
  router.get('/changelog', (req: Request, res: Response): void => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    const format = req.query.format as 'flat' | 'tree' | 'keep-a-changelog' | undefined;

    // Export format requested
    if (format) {
      const markdown = changelog.export({ since, limit, format });
      if (req.query.raw === 'true') {
        res.type('text/markdown').send(markdown);
      } else {
        res.json({ success: true, format, markdown });
      }
      return;
    }

    // JSON listing
    if (since) {
      res.json(changelog.since(since, limit));
    } else {
      res.json(changelog.recent(limit));
    }
  });

  /**
   * GET /changelog/identities
   * List all distinct identities with changelog entries
   */
  router.get('/changelog/identities', (_req: Request, res: Response): void => {
    res.json(changelog.identities());
  });

  /**
   * GET /changelog/session/:sessionId
   * List changelog entries for a session
   */
  router.get('/changelog/session/:sessionId', (req: Request, res: Response): void => {
    const sessionId = req.params.sessionId as string;
    res.json(changelog.listBySession(sessionId));
  });

  /**
   * GET /changelog/agent/:agentId
   * List changelog entries for an agent
   */
  router.get('/changelog/agent/:agentId', (req: Request, res: Response): void => {
    const agentId = req.params.agentId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    res.json(changelog.listByAgent(agentId, limit));
  });

  /**
   * GET /changelog/:id
   * Get a single changelog entry by ID
   */
  router.get('/changelog/:id(\\d+)', (req: Request, res: Response): void => {
    const id = parseInt(req.params.id as string);
    const result = changelog.get(id);

    if (!result.success) {
      res.status(404).json(result);
      return;
    }

    res.json(result);
  });

  /**
   * GET /changelog/:identity
   * List changelog entries for an identity (with optional tree expansion)
   */
  router.get('/changelog/:identity', (req: Request, res: Response): void => {
    const identity = req.params.identity as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const tree = req.query.tree === 'true';
    const format = req.query.format as 'flat' | 'tree' | 'keep-a-changelog' | undefined;

    // Export format requested
    if (format) {
      const markdown = changelog.export({ identity, limit, format });
      if (req.query.raw === 'true') {
        res.type('text/markdown').send(markdown);
      } else {
        res.json({ success: true, identity, format, markdown });
      }
      return;
    }

    // Rollup view
    if (req.query.rollup === 'true') {
      res.json({ success: true, rollup: changelog.rollup(identity) });
      return;
    }

    // JSON listing
    if (tree) {
      res.json(changelog.listTree(identity, limit));
    } else {
      res.json(changelog.list(identity, limit));
    }
  });

  return router;
}
