/**
 * Pheromone Routes — Stigmergic coordination API
 *
 * POST /pheromone/spray        — Set a pheromone value on an entity
 * GET  /pheromone/files        — File heat map from session claims + pheromones
 * GET  /pheromone/:table/:id   — Read pheromone values for an entity
 * GET  /pheromone              — List all non-zero pheromones
 */

import { Router, type Request, type Response } from 'express';
import type { FastifyPluginAsync } from 'fastify';
import type { createPheromoneManager } from '../lib/pheromone.js';
import type { createSessions } from '../lib/sessions.js';

type PheromoneManager = ReturnType<typeof createPheromoneManager>;
type Sessions = ReturnType<typeof createSessions>;

interface FileClaimRow {
  file_path: string;
  claimed_at: number;
  released_at: number | null;
  session_id: string;
  agent_id: string | null;
  session_status: string;
  purpose: string | null;
}

/** Escape SQL LIKE wildcards (% and _) in user input */
function escapeLike(str: string): string {
  return str.replace(/[%_]/g, '\\$&');
}

interface PheromoneRouteDeps {
  pheromones: PheromoneManager;
  sessions: Sessions;
  db: any;
}

export function createPheromoneRoutes(deps: PheromoneRouteDeps): Router {
  const { pheromones, sessions, db } = deps;
  const router = Router();

  /**
   * POST /pheromone/spray
   * Body: { table, id, key, strength }
   */
  router.post('/pheromone/spray', (req: Request, res: Response) => {
    const { table, id, key, strength } = req.body as Record<string, unknown>;

    if (!table || typeof table !== 'string') {
      return res.status(400).json({ success: false, error: 'table is required (services, projects, sessions, agents)' });
    }
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, error: 'id is required' });
    }
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, error: 'key is required' });
    }
    const str = typeof strength === 'number' ? strength : parseFloat(String(strength));
    if (isNaN(str) || str < 0 || str > 1) {
      return res.status(400).json({ success: false, error: 'strength must be 0-1' });
    }

    const result = pheromones.spray(table, id, key, str);
    if (!result.success) {
      return res.status(404).json({ success: false, error: `Entity not found: ${table}/${id}` });
    }

    res.json({ success: true, table, id, key, strength: str, pheromones: result.pheromones });
  });

  /**
   * GET /pheromone/files?path=src/&depth=3
   * File heat map — aggregates pheromone-like signals from session file claims.
   * Returns files ranked by activity (claim count, recency, active claims).
   */
  router.get('/pheromone/files', (_req: Request, res: Response) => {
    const pathPrefix = (_req.query.path as string) || '';
    const rawDepth = _req.query.depth !== undefined ? parseInt(_req.query.depth as string, 10) : 5;
    const maxDepth = Number.isFinite(rawDepth) ? rawDepth : 5;

    try {
      // Query all active file claims from sessions
      const claims = db.prepare(`
        SELECT sf.file_path, sf.claimed_at, sf.released_at, sf.session_id,
               s.agent_id, s.status as session_status, s.purpose
        FROM session_files sf
        JOIN sessions s ON s.id = sf.session_id
        WHERE sf.file_path LIKE ? ESCAPE '\\'
        ORDER BY sf.claimed_at DESC
      `).all(pathPrefix ? `${escapeLike(pathPrefix)}%` : '%') as FileClaimRow[];

      // Compute per-file heat
      const now = Date.now();
      const fileHeat = new Map<string, {
        path: string;
        heat: number;
        activeClaims: number;
        totalClaims: number;
        lastActivity: number;
        agents: string[];
        conflict: boolean;
      }>();

      for (const claim of claims) {
        const path = claim.file_path;
        let entry = fileHeat.get(path);
        if (!entry) {
          entry = {
            path,
            heat: 0,
            activeClaims: 0,
            totalClaims: 0,
            lastActivity: 0,
            agents: [],
            conflict: false,
          };
          fileHeat.set(path, entry);
        }

        entry.totalClaims++;

        // Active claim = not released and session is active
        const isActive = !claim.released_at && claim.session_status === 'active';
        if (isActive) {
          entry.activeClaims++;
          if (claim.agent_id && !entry.agents.includes(claim.agent_id)) {
            entry.agents.push(claim.agent_id);
          }
        }

        // Recency-weighted heat: exponential decay from claim time
        const age = now - claim.claimed_at;
        const recencyHeat = Math.exp(-age / (30 * 60 * 1000)); // half-life ~20 min
        entry.heat = Math.min(1, entry.heat + recencyHeat * 0.3);

        // Active claims add more heat
        if (isActive) entry.heat = Math.min(1, entry.heat + 0.3);

        entry.lastActivity = Math.max(entry.lastActivity, claim.claimed_at);
      }

      // Mark conflicts: multiple active claims on the same file = conflict
      // Use activeClaims count, not agents array, because sessions without
      // a registered agent (null agent_id) still represent concurrent work.
      for (const entry of fileHeat.values()) {
        entry.conflict = entry.activeClaims > 1;
      }

      // Build directory rollup
      const dirHeat = new Map<string, { path: string; heat: number; fileCount: number; conflictCount: number }>();

      for (const entry of fileHeat.values()) {
        const parts = entry.path.split('/');
        for (let i = 1; i <= Math.min(parts.length - 1, maxDepth); i++) {
          const dir = parts.slice(0, i).join('/') + '/';
          let dirEntry = dirHeat.get(dir);
          if (!dirEntry) {
            dirEntry = { path: dir, heat: 0, fileCount: 0, conflictCount: 0 };
            dirHeat.set(dir, dirEntry);
          }
          dirEntry.heat = Math.max(dirEntry.heat, entry.heat);
          dirEntry.fileCount++;
          if (entry.conflict) dirEntry.conflictCount++;
        }
      }

      // Sort files by heat descending
      const files = [...fileHeat.values()]
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 50)
        .map(f => ({
          ...f,
          heat: Math.round(f.heat * 1000) / 1000,
          lastActivity: f.lastActivity ? new Date(f.lastActivity).toISOString() : null,
        }));

      // Sort directories by heat descending
      const directories = [...dirHeat.values()]
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 20)
        .map(d => ({
          ...d,
          heat: Math.round(d.heat * 1000) / 1000,
        }));

      res.json({
        success: true,
        files,
        directories,
        summary: {
          totalFiles: fileHeat.size,
          activeConflicts: [...fileHeat.values()].filter(f => f.conflict).length,
          hottestFile: files[0]?.path || null,
          hottestDir: directories[0]?.path || null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /**
   * GET /pheromone/:table/:id
   */
  router.get('/pheromone/:table/:id', (req: Request, res: Response) => {
    const { table, id } = req.params as { table: string; id: string };
    const result = pheromones.sniff(table, id);
    if (!result.success) {
      return res.status(404).json({ success: false, error: `Entity not found: ${table}/${id}` });
    }
    res.json({ success: true, table, id, pheromones: result.pheromones });
  });

  /**
   * GET /pheromone
   */
  router.get('/pheromone', (_req: Request, res: Response) => {
    const results = pheromones.list();
    res.json({ success: true, count: results.length, pheromones: results });
  });

  return router;
}

// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const pheromonePlugin: FastifyPluginAsync<{ deps: PheromoneRouteDeps }> = async (fastify, opts) => {
  const { pheromones, sessions, db } = opts.deps;

  // POST /pheromone/spray
  fastify.post('/pheromone/spray', async (request, reply) => {
    const { table, id, key, strength } = request.body as any;

    if (!table || typeof table !== 'string') {
      reply.code(400); return { success: false, error: 'table is required (services, projects, sessions, agents)' };
    }
    if (!id || typeof id !== 'string') {
      reply.code(400); return { success: false, error: 'id is required' };
    }
    if (!key || typeof key !== 'string') {
      reply.code(400); return { success: false, error: 'key is required' };
    }
    const str = typeof strength === 'number' ? strength : parseFloat(String(strength));
    if (isNaN(str) || str < 0 || str > 1) {
      reply.code(400); return { success: false, error: 'strength must be 0-1' };
    }

    const result = pheromones.spray(table, id, key, str);
    if (!result.success) {
      reply.code(404); return { success: false, error: `Entity not found: ${table}/${id}` };
    }

    return { success: true, table, id, key, strength: str, pheromones: result.pheromones };
  });

  // GET /pheromone/files?path=src/&depth=3
  fastify.get('/pheromone/files', async (request, reply) => {
    const pathPrefix = ((request.query as any).path as string) || '';
    const rawDepth = (request.query as any).depth !== undefined ? parseInt((request.query as any).depth as string, 10) : 5;
    const maxDepth = Number.isFinite(rawDepth) ? rawDepth : 5;

    try {
      const claims = db.prepare(`
        SELECT sf.file_path, sf.claimed_at, sf.released_at, sf.session_id,
               s.agent_id, s.status as session_status, s.purpose
        FROM session_files sf
        JOIN sessions s ON s.id = sf.session_id
        WHERE sf.file_path LIKE ? ESCAPE '\\'
        ORDER BY sf.claimed_at DESC
      `).all(pathPrefix ? `${escapeLike(pathPrefix)}%` : '%') as FileClaimRow[];

      const now = Date.now();
      const fileHeat = new Map<string, {
        path: string;
        heat: number;
        activeClaims: number;
        totalClaims: number;
        lastActivity: number;
        agents: string[];
        conflict: boolean;
      }>();

      for (const claim of claims) {
        const path = claim.file_path;
        let entry = fileHeat.get(path);
        if (!entry) {
          entry = {
            path,
            heat: 0,
            activeClaims: 0,
            totalClaims: 0,
            lastActivity: 0,
            agents: [],
            conflict: false,
          };
          fileHeat.set(path, entry);
        }

        entry.totalClaims++;

        const isActive = !claim.released_at && claim.session_status === 'active';
        if (isActive) {
          entry.activeClaims++;
          if (claim.agent_id && !entry.agents.includes(claim.agent_id)) {
            entry.agents.push(claim.agent_id);
          }
        }

        const age = now - claim.claimed_at;
        const recencyHeat = Math.exp(-age / (30 * 60 * 1000));
        entry.heat = Math.min(1, entry.heat + recencyHeat * 0.3);

        if (isActive) entry.heat = Math.min(1, entry.heat + 0.3);

        entry.lastActivity = Math.max(entry.lastActivity, claim.claimed_at);
      }

      for (const entry of fileHeat.values()) {
        entry.conflict = entry.activeClaims > 1;
      }

      const dirHeat = new Map<string, { path: string; heat: number; fileCount: number; conflictCount: number }>();

      for (const entry of fileHeat.values()) {
        const parts = entry.path.split('/');
        for (let i = 1; i <= Math.min(parts.length - 1, maxDepth); i++) {
          const dir = parts.slice(0, i).join('/') + '/';
          let dirEntry = dirHeat.get(dir);
          if (!dirEntry) {
            dirEntry = { path: dir, heat: 0, fileCount: 0, conflictCount: 0 };
            dirHeat.set(dir, dirEntry);
          }
          dirEntry.heat = Math.max(dirEntry.heat, entry.heat);
          dirEntry.fileCount++;
          if (entry.conflict) dirEntry.conflictCount++;
        }
      }

      const files = [...fileHeat.values()]
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 50)
        .map(f => ({
          ...f,
          heat: Math.round(f.heat * 1000) / 1000,
          lastActivity: f.lastActivity ? new Date(f.lastActivity).toISOString() : null,
        }));

      const directories = [...dirHeat.values()]
        .sort((a, b) => b.heat - a.heat)
        .slice(0, 20)
        .map(d => ({
          ...d,
          heat: Math.round(d.heat * 1000) / 1000,
        }));

      return {
        success: true,
        files,
        directories,
        summary: {
          totalFiles: fileHeat.size,
          activeConflicts: [...fileHeat.values()].filter(f => f.conflict).length,
          hottestFile: files[0]?.path || null,
          hottestDir: directories[0]?.path || null,
        },
      };
    } catch (err) {
      reply.code(500); return { success: false, error: (err as Error).message };
    }
  });

  // GET /pheromone/:table/:id
  fastify.get('/pheromone/:table/:id', async (request, reply) => {
    const { table, id } = request.params as any;
    const result = pheromones.sniff(table, id);
    if (!result.success) {
      reply.code(404); return { success: false, error: `Entity not found: ${table}/${id}` };
    }
    return { success: true, table, id, pheromones: result.pheromones };
  });

  // GET /pheromone
  fastify.get('/pheromone', async (request, reply) => {
    const results = pheromones.list();
    return { success: true, count: results.length, pheromones: results };
  });
};
