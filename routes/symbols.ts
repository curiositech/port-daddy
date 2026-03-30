/**
 * Symbol Index Routes — AST-based symbol extraction and conflict prediction
 *
 * POST /symbols/parse           — Parse file(s) or directory, extract symbols
 * GET  /symbols                 — Search symbols by name, type, file, exported
 * GET  /symbols/stats           — Index statistics
 * GET  /symbols/file/*          — Get all symbols for a specific file
 * GET  /dependencies            — Get dependencies from or to a file
 * POST /conflicts/predict       — Predict conflicts between two sets of symbol claims
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { SymbolIndex, SymbolClaim } from '../lib/symbol-index.js';

interface SymbolsRouteDeps {
  symbolIndex: SymbolIndex;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const symbolsPlugin: FastifyPluginAsync<{ deps: SymbolsRouteDeps }> = async (fastify, opts) => {
  const { symbolIndex, metrics, logger } = opts.deps;

  // ─────────────────────────────────────────────────────────────────────────
  // POST /symbols/parse — Parse file(s) and store symbols
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/symbols/parse', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { files, directory, glob, exclude } = body ?? {};

      if (directory && typeof directory === 'string') {
        const results = await symbolIndex.parseDirectory(directory, {
          glob: typeof glob === 'string' ? glob : undefined,
          exclude: Array.isArray(exclude) ? exclude : undefined,
        });

        const parsed = results.filter(r => !r.skipped && !r.error);
        const skipped = results.filter(r => r.skipped && !r.error);
        const errors = results.filter(r => r.error);

        logger.info('symbols_parse_directory', {
          directory,
          parsed: parsed.length,
          skipped: skipped.length,
          errors: errors.length,
        });

        return {
          success: true,
          directory,
          total: results.length,
          parsed: parsed.length,
          skipped: skipped.length,
          errors: errors.length,
          results,
        };
      }

      if (files && Array.isArray(files) && files.length > 0) {
        const results = [];
        for (const file of files) {
          if (typeof file !== 'string') continue;
          const result = await symbolIndex.parseFile(file);
          results.push(result);
        }

        const parsed = results.filter(r => !r.skipped && !r.error);
        const errors = results.filter(r => r.error);

        logger.info('symbols_parse_files', {
          fileCount: files.length,
          parsed: parsed.length,
          errors: errors.length,
        });

        return {
          success: true,
          total: results.length,
          parsed: parsed.length,
          skipped: results.length - parsed.length - errors.length,
          errors: errors.length,
          results,
        };
      }

      reply.code(400);
      return {
        success: false,
        error: 'Provide either "files" (string[]) or "directory" (string)',
        code: 'VALIDATION_ERROR',
      };
    } catch (error) {
      metrics.errors++;
      logger.error('symbols_parse_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /symbols/stats — Index statistics
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/symbols/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = symbolIndex.stats();
      return { success: true, ...stats };
    } catch (error) {
      metrics.errors++;
      logger.error('symbols_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /symbols — Search symbols
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/symbols', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const name = typeof q.name === 'string' ? q.name : undefined;
      const type = typeof q.type === 'string' ? q.type : undefined;
      const file = typeof q.file === 'string' ? q.file : undefined;
      const exported = q.exported === 'true' ? true : q.exported === 'false' ? false : undefined;

      const symbols = symbolIndex.findSymbol({ name, type, file, exported });

      return {
        success: true,
        count: symbols.length,
        symbols,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('symbols_search_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /symbols/file/* — Get symbols for a specific file
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/symbols/file/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const filePath = (request.params as any)['*'];
      if (!filePath || typeof filePath !== 'string') {
        reply.code(400);
        return { success: false, error: 'File path required', code: 'VALIDATION_ERROR' };
      }

      // Prepend / since the wildcard strips it
      const fullPath = filePath.startsWith('/') ? filePath : '/' + filePath;
      const symbols = symbolIndex.getSymbols(fullPath);
      const stale = symbolIndex.isStale(fullPath);

      return {
        success: true,
        filePath: fullPath,
        stale,
        count: symbols.length,
        symbols,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('symbols_file_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /dependencies — Get dependencies from or to a file
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/dependencies', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const file = typeof q.file === 'string' ? q.file : undefined;
      const symbol = typeof q.symbol === 'string' ? q.symbol : undefined;
      const direction = typeof q.direction === 'string' ? q.direction : 'from';

      if (!file) {
        reply.code(400);
        return { success: false, error: '"file" query parameter required', code: 'VALIDATION_ERROR' };
      }

      let dependencies;
      if (direction === 'to') {
        dependencies = symbolIndex.getDependents(file, symbol);
      } else {
        dependencies = symbolIndex.getDependencies(file);
      }

      return {
        success: true,
        file,
        direction,
        count: dependencies.length,
        dependencies,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('dependencies_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /conflicts/predict — Predict conflicts between symbol claims
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/conflicts/predict', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { claimsA, claimsB } = body ?? {};

      if (!Array.isArray(claimsA) || !Array.isArray(claimsB)) {
        reply.code(400);
        return {
          success: false,
          error: '"claimsA" and "claimsB" must be arrays of { filePath, symbolPath, type }',
          code: 'VALIDATION_ERROR',
        };
      }

      // Validate claim shapes
      const validateClaim = (c: any): c is SymbolClaim =>
        typeof c.filePath === 'string' &&
        typeof c.symbolPath === 'string' &&
        (c.type === 'read' || c.type === 'modify');

      const validA = claimsA.filter(validateClaim);
      const validB = claimsB.filter(validateClaim);

      if (validA.length === 0 && validB.length === 0) {
        return { success: true, conflicts: [], count: 0 };
      }

      const conflicts = symbolIndex.predictConflicts(validA, validB);

      logger.info('conflicts_predict', {
        claimsA: validA.length,
        claimsB: validB.length,
        conflicts: conflicts.length,
      });

      return {
        success: true,
        count: conflicts.length,
        blocking: conflicts.filter(c => c.severity === 'blocking').length,
        warnings: conflicts.filter(c => c.severity === 'warning').length,
        info: conflicts.filter(c => c.severity === 'info').length,
        conflicts,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('conflicts_predict_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
