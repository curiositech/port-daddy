/**
 * Tunnel Routes
 *
 * Handles tunnel creation, management, and status for exposing local services.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateIdentity } from '../shared/validators.js';
import type { TunnelProvider } from '../lib/tunnel.js';

interface TunnelRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: {
    errors: number;
  };
  tunnel: {
    start(serviceId: string, provider?: TunnelProvider): Promise<{
      success: boolean;
      url?: string;
      error?: string;
      expiresAt?: number;
    }>;
    stop(serviceId: string): { success: boolean; error?: string };
    status(serviceId: string): {
      serviceId: string;
      provider: TunnelProvider;
      port: number;
      url: string | null;
      status: string;
      pid?: number;
      startedAt?: number;
      expiresAt?: number;
      ageMs?: number;
      cleanupReason?: 'expired' | 'orphan-process' | 'stale-record';
    };
    list(): Array<{
      serviceId: string;
      provider: TunnelProvider;
      port: number;
      url: string | null;
      status: string;
      pid?: number;
      startedAt?: number;
      expiresAt?: number;
      ageMs?: number;
    }>;
    checkProvider(provider: TunnelProvider): Promise<boolean>;
    dispose?(): void;
  };
}

const VALID_PROVIDERS = ['ngrok', 'cloudflared', 'localtunnel'];

/**
 * Create tunnel routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const tunnelPlugin: FastifyPluginAsync<{ deps: TunnelRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, tunnel } = opts.deps;

  // GET /tunnel/providers - Check which providers are installed
  fastify.get('/tunnel/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providers: Record<string, boolean> = {};

      for (const provider of VALID_PROVIDERS) {
        providers[provider] = await tunnel.checkProvider(provider as TunnelProvider);
      }

      return {
        success: true,
        providers
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /tunnel/:id - Start a tunnel for a service
  fastify.post('/tunnel/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const idValidation = validateIdentity((request.params as any).id as string);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error, code: 'IDENTITY_INVALID' };
      }

      const { provider = 'ngrok' } = request.body as any;

      if (!VALID_PROVIDERS.includes(provider)) {
        reply.code(400);
        return {
          error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
          code: 'INVALID_PROVIDER'
        };
      }

      const result = await tunnel.start((request.params as any).id as string, provider as TunnelProvider);

      if (!result.success) {
        reply.code(400);
        return { error: result.error, code: 'TUNNEL_ERROR' };
      }

      logger.info('tunnel_started', { serviceId: (request.params as any).id, provider, url: result.url });

      return {
        success: true,
        serviceId: (request.params as any).id,
        provider,
        url: result.url,
        expiresAt: result.expiresAt
      };
    } catch (error) {
      metrics.errors++;
      logger.error('tunnel_start_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /tunnel/:id - Stop a tunnel for a service
  fastify.delete('/tunnel/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const idValidation = validateIdentity((request.params as any).id as string);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error, code: 'IDENTITY_INVALID' };
      }

      const result = tunnel.stop((request.params as any).id as string);

      if (!result.success) {
        reply.code(400);
        return { error: result.error, code: 'TUNNEL_ERROR' };
      }

      logger.info('tunnel_stopped', { serviceId: (request.params as any).id as string });

      return { success: true, serviceId: (request.params as any).id as string };
    } catch (error) {
      metrics.errors++;
      logger.error('tunnel_stop_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /tunnel/:id - Get tunnel status for a service
  fastify.get('/tunnel/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const idValidation = validateIdentity((request.params as any).id as string);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error, code: 'IDENTITY_INVALID' };
      }

      const status = tunnel.status((request.params as any).id as string);

      return {
        success: true,
        ...status
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /tunnels - List all active tunnels
  fastify.get('/tunnels', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tunnels = tunnel.list();

      return {
        success: true,
        tunnels,
        count: tunnels.length
      };
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
