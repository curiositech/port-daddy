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

import { Router } from 'express';
import type { Request, Response } from 'express';

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
export function createDnsRoutes(deps: DnsRouteDeps): Router {
  const { logger, metrics, dns } = deps;
  const router = Router();

  // =========================================================================
  // GET /dns - List all DNS records (static route, before :id)
  // =========================================================================
  router.get('/dns', (req: Request, res: Response) => {
    try {
      const { pattern, limit } = req.query;

      const options: { pattern?: string; limit?: number } = {};
      if (pattern) options.pattern = pattern as string;
      if (limit) options.limit = parseInt(limit as string, 10);

      const result = dns.list(options);
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_list_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /dns/status - DNS system status (static route, before :id)
  // =========================================================================
  router.get('/dns/status', (_req: Request, res: Response) => {
    try {
      const result = dns.status();
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_status_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // POST /dns/cleanup - Remove stale DNS records (static route, before :id)
  // =========================================================================
  router.post('/dns/cleanup', (_req: Request, res: Response) => {
    try {
      const result = dns.cleanup();
      logger.info('dns_cleanup', result);
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_cleanup_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // POST /dns/:id - Register DNS for a service (parameterized)
  // =========================================================================
  router.post('/dns/:id', (req: Request, res: Response) => {
    try {
      const identity = req.params.id as string;
      const { hostname, port } = req.body;

      if (!identity) {
        return res.status(400).json({ error: 'identity is required', code: 'VALIDATION_ERROR' });
      }

      if (typeof port !== 'number' || port < 1 || port > 65535) {
        return res.status(400).json({ error: 'port must be a number between 1 and 65535', code: 'VALIDATION_ERROR' });
      }

      const options: { hostname?: string; port: number } = { port };
      if (hostname) options.hostname = hostname;

      const result = dns.register(identity, options);

      if (!result.success) {
        const status = result.code === 'HOSTNAME_CONFLICT' ? 409 : 400;
        return res.status(status).json(result);
      }

      logger.info('dns_register', { identity, hostname: result.hostname as string, port });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_register_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // DELETE /dns/:id - Unregister DNS for a service (parameterized)
  // =========================================================================
  router.delete('/dns/:id', (req: Request, res: Response) => {
    try {
      const identity = req.params.id as string;

      if (!identity) {
        return res.status(400).json({ error: 'identity is required', code: 'VALIDATION_ERROR' });
      }

      const result = dns.unregister(identity);

      if (!result.success) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        return res.status(status).json(result);
      }

      logger.info('dns_unregister', { identity });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_unregister_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /dns/:id - Get DNS record by identity (parameterized, LAST)
  // =========================================================================
  router.get('/dns/:id', (req: Request, res: Response) => {
    try {
      const identity = req.params.id as string;

      if (!identity) {
        return res.status(400).json({ error: 'identity is required', code: 'VALIDATION_ERROR' });
      }

      const result = dns.get(identity);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('dns_get_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
