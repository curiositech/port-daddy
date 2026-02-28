/**
 * Tunnel Routes
 *
 * Handles tunnel creation, management, and status for exposing local services.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
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
    start(serviceId: string, provider?: TunnelProvider): Promise<{ success: boolean; url?: string; error?: string }>;
    stop(serviceId: string): { success: boolean; error?: string };
    status(serviceId: string): {
      serviceId: string;
      provider: TunnelProvider;
      port: number;
      url: string | null;
      status: string;
      pid?: number;
      startedAt?: number;
    };
    list(): Array<{
      serviceId: string;
      provider: TunnelProvider;
      port: number;
      url: string | null;
      status: string;
      pid?: number;
      startedAt?: number;
    }>;
    checkProvider(provider: TunnelProvider): Promise<boolean>;
  };
}

const VALID_PROVIDERS = ['ngrok', 'cloudflared', 'localtunnel'];

/**
 * Create tunnel routes
 */
export function createTunnelRoutes(deps: TunnelRouteDeps): Router {
  const { logger, metrics, tunnel } = deps;
  const router = Router();

  // =========================================================================
  // GET /tunnel/providers - Check which providers are installed
  // IMPORTANT: Must be defined BEFORE /tunnel/:id to avoid route collision
  // =========================================================================
  router.get('/tunnel/providers', async (req: Request, res: Response) => {
    try {
      const providers: Record<string, boolean> = {};

      for (const provider of VALID_PROVIDERS) {
        providers[provider] = await tunnel.checkProvider(provider as TunnelProvider);
      }

      res.json({
        success: true,
        providers
      });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // POST /tunnel/:id - Start a tunnel for a service
  // =========================================================================
  router.post('/tunnel/:id', async (req: Request, res: Response) => {
    try {
      const idValidation = validateIdentity(req.params.id as string);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error, code: 'IDENTITY_INVALID' });
      }

      const { provider = 'ngrok' } = req.body;

      if (!VALID_PROVIDERS.includes(provider)) {
        return res.status(400).json({
          error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
          code: 'INVALID_PROVIDER'
        });
      }

      const result = await tunnel.start(req.params.id as string, provider as TunnelProvider);

      if (!result.success) {
        return res.status(400).json({ error: result.error, code: 'TUNNEL_ERROR' });
      }

      logger.info('tunnel_started', { serviceId: req.params.id, provider, url: result.url });

      res.json({
        success: true,
        serviceId: req.params.id,
        provider,
        url: result.url
      });
    } catch (error) {
      metrics.errors++;
      logger.error('tunnel_start_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // DELETE /tunnel/:id - Stop a tunnel for a service
  // =========================================================================
  router.delete('/tunnel/:id', (req: Request, res: Response) => {
    try {
      const idValidation = validateIdentity(req.params.id as string);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error, code: 'IDENTITY_INVALID' });
      }

      const result = tunnel.stop(req.params.id as string);

      if (!result.success) {
        return res.status(400).json({ error: result.error, code: 'TUNNEL_ERROR' });
      }

      logger.info('tunnel_stopped', { serviceId: req.params.id as string });

      res.json({ success: true, serviceId: req.params.id as string });
    } catch (error) {
      metrics.errors++;
      logger.error('tunnel_stop_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /tunnel/:id - Get tunnel status for a service
  // =========================================================================
  router.get('/tunnel/:id', (req: Request, res: Response) => {
    try {
      const idValidation = validateIdentity(req.params.id as string);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error, code: 'IDENTITY_INVALID' });
      }

      const status = tunnel.status(req.params.id as string);

      res.json({
        success: true,
        ...status
      });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /tunnels - List all active tunnels
  // =========================================================================
  router.get('/tunnels', (req: Request, res: Response) => {
    try {
      const tunnels = tunnel.list();

      res.json({
        success: true,
        tunnels,
        count: tunnels.length
      });
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
