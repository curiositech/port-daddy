/**
 * Routes Aggregator
 *
 * Collects all route modules and mounts them on the Express app.
 * Each route module exports a factory function that accepts dependencies.
 *
 * The deps object is constructed in server.ts with all required fields.
 * Each route factory defines its own narrow *RouteDeps interface for what it
 * destructures — this aggregator bridges the two with a structural cast.
 */

import { Router } from 'express';

import { createServicesRoutes } from './services.js';
import { createMessagingRoutes } from './messaging.js';
import { createLocksRoutes } from './locks.js';
import { createAgentsRoutes } from './agents.js';
import { createHealthRoutes } from './health.js';
import { createActivityRoutes } from './activity.js';
import { createWebhooksRoutes } from './webhooks.js';
import { createConfigRoutes } from './config.js';
import { createProjectsRoutes } from './projects.js';
import { createSessionsRoutes } from './sessions.js';
import { createInfoRoutes } from './info.js';
import { createDnsRoutes } from './dns.js';

// Each route factory defines its own deps interface (e.g. ServicesRouteDeps,
// InfoRouteDeps). Rather than duplicating those 10 interfaces here, we use a
// structural cast via `unknown`. This is safe because:
// 1. server.ts constructs the deps object with every field all routes need
// 2. Each route factory validates at destructure time what it actually uses
// 3. The route-level interfaces provide full type safety within each file
type AnyDeps = Record<string, unknown>;

/**
 * Create and configure all routes
 *
 * @param deps - Dependencies for route handlers (constructed in server.ts)
 * @returns Express router with all routes mounted
 */
export function createRoutes(deps: AnyDeps): Router {
  const router = Router();

  // Info routes first (health/version are high-frequency, low-latency)
  router.use(createInfoRoutes(deps as unknown as Parameters<typeof createInfoRoutes>[0]));

  // V2 API routes
  router.use(createServicesRoutes(deps as unknown as Parameters<typeof createServicesRoutes>[0]));
  router.use(createMessagingRoutes(deps as unknown as Parameters<typeof createMessagingRoutes>[0]));
  router.use(createLocksRoutes(deps as unknown as Parameters<typeof createLocksRoutes>[0]));
  router.use(createAgentsRoutes(deps as unknown as Parameters<typeof createAgentsRoutes>[0]));
  router.use(createHealthRoutes(deps as unknown as Parameters<typeof createHealthRoutes>[0]));
  router.use(createActivityRoutes(deps as unknown as Parameters<typeof createActivityRoutes>[0]));
  router.use(createWebhooksRoutes(deps as unknown as Parameters<typeof createWebhooksRoutes>[0]));
  router.use(createConfigRoutes(deps as unknown as Parameters<typeof createConfigRoutes>[0]));
  router.use(createProjectsRoutes(deps as unknown as Parameters<typeof createProjectsRoutes>[0]));
  router.use(createSessionsRoutes(deps as unknown as Parameters<typeof createSessionsRoutes>[0]));
  router.use(createDnsRoutes(deps as unknown as Parameters<typeof createDnsRoutes>[0]));

  return router;
}
