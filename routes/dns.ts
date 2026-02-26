/**
 * DNS Routes
 *
 * Local DNS registration for services via mDNS
 */

import { Router, Request, Response } from 'express';

interface DnsModule {
  register(identity: string, port: number): Promise<{ success: boolean; hostname: string; error?: string }>;
  unregister(identity: string): Promise<{ success: boolean }>;
  list(): Array<{ identity: string; hostname: string; port: number; pid: number | null; registeredAt: number }>;
  cleanup(): void;
}

interface DnsRouteDeps {
  dns: DnsModule;
}

export function createDnsRoutes({ dns }: DnsRouteDeps): Router {
  const router = Router();

  // Register DNS for a service
  router.post('/dns/:identity', async (req: Request, res: Response) => {
    const identity = req.params.identity as string;
    const { port } = req.body;

    if (!port || typeof port !== 'number') {
      res.status(400).json({ success: false, error: 'port is required (number)' });
      return;
    }

    const result = await dns.register(identity, port);
    res.json(result);
  });

  // Unregister DNS
  router.delete('/dns/:identity', async (req: Request, res: Response) => {
    const identity = req.params.identity as string;
    const result = await dns.unregister(identity);
    res.json(result);
  });

  // List all DNS registrations
  router.get('/dns', (_req: Request, res: Response) => {
    const registrations = dns.list();
    res.json({ success: true, registrations });
  });

  // Cleanup all DNS registrations
  router.post('/dns/cleanup', (_req: Request, res: Response) => {
    dns.cleanup();
    res.json({ success: true, message: 'All DNS registrations cleaned up' });
  });

  return router;
}
