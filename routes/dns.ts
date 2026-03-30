/**
 * DNS Routes
 *
 * Local DNS records for services. Maps semantic identities to
 * friendly .local hostnames via SQLite-backed records.
 *
 * IMPORTANT: Static routes (/dns, /dns/status, /dns/cleanup) MUST be
 * registered BEFORE parameterized routes (/dns/:id) to prevent Express
 * from matching "status" or "cleanup" as an :id parameter.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface DnsRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: {
    errors: number;
  };
  dns: {
    register(identity: string, options: { hostname?: string; port: number }): Record<string, unknown>;
    unregister(identity: string): Record<string, unknown>;
    list(options?: { pattern?: string; limit?: number }): Record<string, unknown>;
    lookup(hostname: string): Record<string, unknown>;
    get(identity: string): Record<string, unknown>;
    cleanup(): Record<string, unknown>;
    status(): Record<string, unknown>;
  };
  resolver?: {
    setup(): { success: boolean; alreadySetUp?: boolean };
    teardown(): { success: boolean; wasSetUp: boolean };
    sync(): { success: boolean; entries: number };
    status(): { isSetUp: boolean; hostsFilePath: string; entries: number; fileExists: boolean };
  };
  activityLog?: {
    log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
}

/**
 * Create DNS routes
 *
 * @param deps - Dependencies
 * @returns Express router
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const dnsPlugin: FastifyPluginAsync<{ deps: DnsRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, dns, resolver } = opts.deps;

  // GET /dns - List all DNS records (static route, before :id)
  fastify.get('/dns', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pattern, limit } = request.query as any;

      const options: { pattern?: string; limit?: number } = {};
      if (pattern) options.pattern = pattern as string;
      if (limit) options.limit = parseInt(limit as string, 10);

      return dns.list(options);
    } catch (error) {
      metrics.errors++;
      logger.error('dns_list_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /dns/status - DNS system status
  fastify.get('/dns/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = dns.status() as Record<string, unknown>;
      if (resolver) {
        result.resolver = resolver.status();
      } else {
        result.resolver = { configured: false };
      }
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_status_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /dns/cleanup - Remove stale DNS records
  fastify.post('/dns/cleanup', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = dns.cleanup();
      logger.info('dns_cleanup', result);
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_cleanup_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /dns/setup - Initialize /etc/hosts managed section
  fastify.post('/dns/setup', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!resolver) {
        reply.code(501);
        return { error: 'Resolver not configured', code: 'NOT_CONFIGURED' };
      }

      const result = resolver.setup();
      logger.info('dns_resolver_setup', result);
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_resolver_setup_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /dns/teardown - Remove /etc/hosts managed section
  fastify.post('/dns/teardown', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!resolver) {
        reply.code(501);
        return { error: 'Resolver not configured', code: 'NOT_CONFIGURED' };
      }

      const result = resolver.teardown();
      logger.info('dns_resolver_teardown', result);
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_resolver_teardown_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /dns/sync - Rebuild /etc/hosts from DNS registry
  fastify.post('/dns/sync', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!resolver) {
        reply.code(501);
        return { error: 'Resolver not configured', code: 'NOT_CONFIGURED' };
      }

      const result = resolver.sync();
      logger.info('dns_resolver_sync', result);
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_resolver_sync_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /dns/resolver - Resolver status
  fastify.get('/dns/resolver', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!resolver) {
        return { configured: false };
      }

      const status = resolver.status();
      return { configured: true, ...status };
    } catch (error) {
      metrics.errors++;
      logger.error('dns_resolver_status_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /dns/:id - Register DNS for a service
  fastify.post('/dns/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const identity = (request.params as any).id as string;
      const { hostname, port } = request.body as any;

      if (!identity) {
        reply.code(400);
        return { error: 'identity is required', code: 'VALIDATION_ERROR' };
      }

      if (typeof port !== 'number' || port < 1 || port > 65535) {
        reply.code(400);
        return { error: 'port must be a number between 1 and 65535', code: 'VALIDATION_ERROR' };
      }

      const options: { hostname?: string; port: number } = { port };
      if (hostname) options.hostname = hostname;

      const result = dns.register(identity, options);

      if (!result.success) {
        const status = result.code === 'HOSTNAME_CONFLICT' ? 409 : 400;
        reply.code(status);
        return result;
      }

      logger.info('dns_register', { identity, hostname: result.hostname as string, port });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_register_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /dns/:id - Unregister DNS for a service
  fastify.delete('/dns/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const identity = (request.params as any).id as string;

      if (!identity) {
        reply.code(400);
        return { error: 'identity is required', code: 'VALIDATION_ERROR' };
      }

      const result = dns.unregister(identity);

      if (!result.success) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        reply.code(status);
        return result;
      }

      logger.info('dns_unregister', { identity });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_unregister_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /dns/:id - Get DNS record by identity
  fastify.get('/dns/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const identity = (request.params as any).id as string;

      if (!identity) {
        reply.code(400);
        return { error: 'identity is required', code: 'VALIDATION_ERROR' };
      }

      const result = dns.get(identity);

      if (!result.success) {
        reply.code(404);
        return result;
      }

      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('dns_get_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
