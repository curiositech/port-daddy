/**
 * Config Routes
 *
 * Configuration loading endpoint.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from '../lib/config.js';
import type { DaemonConfig } from '../lib/daemon-config.js';
import { ConfigKeyError, ConfigValueError } from '../lib/daemon-config.js';

interface ConfigRouteDeps {
  metrics: { errors: number };
  daemonConfig?: DaemonConfig;
}

function serializeRow(row: ReturnType<DaemonConfig['list']>[number]): Record<string, unknown> {
  return {
    key: row.key,
    value: row.value,
    type: row.type,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt,
    spec: {
      description: row.spec.description,
      default: row.spec.default,
      min: row.spec.min,
      max: row.spec.max,
      oneOf: row.spec.oneOf,
    },
  };
}

/**
 * Create config routes
 *
 * @param deps - Route dependencies
 * @returns Express router with config routes
 */


// =============================================================================
// Fastify plugin export
// =============================================================================
export const configPlugin: FastifyPluginAsync<{ deps: ConfigRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { metrics, daemonConfig } = deps;

  // GET /config
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { dir } = request.query as any;
      const targetDir: string = (dir as string) || process.cwd();

      const config = loadConfig(targetDir);

      if (!config) {
        reply.code(404);
        return {
          success: false,
          error: 'No .portdaddyrc found',
          suggestion: 'Run port-daddy scan to create one'
        };
      }

      return {
        success: true,
        config,
        path: (config as Record<string, unknown>)._path
      };

    } catch (error) {
      if ((error as Error).message.includes('Failed to parse')) {
        reply.code(400);
        return { success: false, error: (error as Error).message };
      }
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // -------------------------------------------------------------------------
  // Daemon-wide config (key/value store, whitelisted schema in lib/daemon-config.ts)
  // -------------------------------------------------------------------------

  function requireDaemonConfig(reply: FastifyReply): DaemonConfig | null {
    if (!daemonConfig) {
      reply.code(503);
      void reply.send({ success: false, error: 'daemon config store not wired into this daemon' });
      return null;
    }
    return daemonConfig;
  }

  // GET /config/daemon — list every known key with current value + metadata.
  fastify.get('/config/daemon', async (_request: FastifyRequest, reply: FastifyReply) => {
    const dc = requireDaemonConfig(reply);
    if (!dc) return;
    try {
      const items = dc.list().map(serializeRow);
      return { success: true, items };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: (error as Error).message };
    }
  });

  // GET /config/daemon/:key — single key.
  fastify.get('/config/daemon/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const dc = requireDaemonConfig(reply);
    if (!dc) return;
    try {
      const key = String((request.params as { key?: string }).key || '');
      const row = dc.list().find((r) => r.key === key);
      if (!row) {
        reply.code(404);
        return { success: false, error: `Unknown daemon config key '${key}'.` };
      }
      return { success: true, ...serializeRow(row) };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: (error as Error).message };
    }
  });

  // PUT /config/daemon/:key — set a value. Body: { value }.
  fastify.put('/config/daemon/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const dc = requireDaemonConfig(reply);
    if (!dc) return;
    try {
      const key = String((request.params as { key?: string }).key || '');
      const body = (request.body as { value?: unknown }) || {};
      if (body.value === undefined) {
        reply.code(400);
        return { success: false, error: "body.value is required" };
      }
      const row = dc.set(key, body.value);
      return { success: true, ...serializeRow({ ...row, spec: row.spec }) };
    } catch (error) {
      if (error instanceof ConfigKeyError) {
        reply.code(404);
        return { success: false, code: error.code, error: error.message };
      }
      if (error instanceof ConfigValueError) {
        reply.code(400);
        return { success: false, code: error.code, error: error.message };
      }
      metrics.errors++;
      reply.code(500);
      return { error: (error as Error).message };
    }
  });

  // DELETE /config/daemon/:key — restore the spec default.
  fastify.delete('/config/daemon/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const dc = requireDaemonConfig(reply);
    if (!dc) return;
    try {
      const key = String((request.params as { key?: string }).key || '');
      dc.unset(key);
      const row = dc.list().find((r) => r.key === key);
      return { success: true, ...(row ? serializeRow(row) : { key }) };
    } catch (error) {
      if (error instanceof ConfigKeyError) {
        reply.code(404);
        return { success: false, code: error.code, error: error.message };
      }
      metrics.errors++;
      reply.code(500);
      return { error: (error as Error).message };
    }
  });
};
