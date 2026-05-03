/**
 * Fastify Route Aggregator
 *
 * Registers all Fastify route plugins. Replaces routes/index.ts (Express).
 * Each plugin receives deps via opts.deps (except arbiterPlugin which takes opts.arbiter).
 *
 * Order matters: health routes before services routes (health routes have
 * more specific paths like /services/health/:id that must match before
 * the generic /services/:id catch-all).
 */

import type { FastifyInstance } from 'fastify';

import { infoPlugin } from './info.js';
import { healthPlugin } from './health.js';
import { servicesPlugin } from './services.js';
import { messagingPlugin } from './messaging.js';
import { locksPlugin } from './locks.js';
import { agentsPlugin } from './agents.js';
import { activityPlugin } from './activity.js';
import { webhooksPlugin } from './webhooks.js';
import { configPlugin } from './config.js';
import { projectsPlugin } from './projects.js';
import { sessionsPlugin } from './sessions.js';
import { resurrectionPlugin } from './resurrection.js';
import { changelogPlugin } from './changelog.js';
import { tunnelPlugin } from './tunnel.js';
import { dnsPlugin } from './dns.js';
import { sugarPlugin } from './sugar.js';
import { launchPlugin } from './launch.js';
import { spawnPlugin } from './spawn.js';
import { harborsPlugin } from './harbors.js';
import { sortiesPlugin } from './sorties.js';
import { orchestratorPlugin } from './orchestrator.js';
import { briefingPlugin } from './briefing.js';
import { sitrepPlugin } from './sitrep.js';
// Arbiter and pheromone have different option shapes
import { arbiterPlugin } from './arbiter.js';
import { pheromonePlugin } from './pheromone.js';
import { tuplesPlugin } from './tuples.js';
import { fleetPlugin } from './fleet.js';
import { observabilityPlugin } from './observability.js';
import { mergeQueuePlugin } from './merge-queue.js';
import { symbolsPlugin } from './symbols.js';
import { operatorPlugin } from './operator.js';
import { actorsPlugin } from './actors.js';
import { cartographerPlugin } from './cartographer.js';
import { graphPlugin } from './graph.js';
import { memoryPlugin } from './memory.js';
import { semanticPlugin } from './semantic.js';
import { bondsPlugin } from './bonds.js';
import { walletsPlugin } from './wallets.js';
import { panicPlugin } from './panic.js';
import { budgetPlugin } from './budget.js';
import { advisorPlugin } from './advisor.js';
import { quorumPlugin } from './quorum.js';
import { resourcesPlugin } from './resources.js';
import { feedbackPlugin } from './feedback.js';
import { usagePlugin } from './usage.js';
import { cockpitPlugin } from './cockpit.js';

type AnyDeps = Record<string, unknown>;

/**
 * Register all Fastify route plugins.
 *
 * @param fastify - Fastify instance
 * @param deps - Dependencies object (constructed in server-fastify.ts)
 * @param arbiter - Arbiter instance (separate from deps)
 * @param pheromoneDeps - Pheromone route deps (different shape from main deps)
 */
export async function registerAllRoutes(
  fastify: FastifyInstance,
  deps: AnyDeps,
  arbiter: unknown,
  pheromoneDeps: AnyDeps,
): Promise<void> {
  // Info routes first (health/version are high-frequency, low-latency)
  await fastify.register(infoPlugin, { deps } as any);

  // Health routes BEFORE services (more specific paths must match first)
  await fastify.register(healthPlugin, { deps } as any);

  // Core API routes
  await fastify.register(servicesPlugin, { deps } as any);
  await fastify.register(messagingPlugin, { deps } as any);
  await fastify.register(locksPlugin, { deps } as any);
  await fastify.register(agentsPlugin, { deps } as any);
  await fastify.register(activityPlugin, { deps } as any);
  await fastify.register(webhooksPlugin, { deps } as any);
  await fastify.register(configPlugin, { deps } as any);
  await fastify.register(projectsPlugin, { deps } as any);
  await fastify.register(sessionsPlugin, { deps } as any);
  await fastify.register(resurrectionPlugin, { deps } as any);
  await fastify.register(changelogPlugin, { deps } as any);
  await fastify.register(tunnelPlugin, { deps } as any);
  await fastify.register(dnsPlugin, { deps } as any);
  await fastify.register(sugarPlugin, { deps } as any);
  await fastify.register(launchPlugin, { deps } as any);
  await fastify.register(spawnPlugin, { deps } as any);
  await fastify.register(sortiesPlugin, { deps } as any);
  await fastify.register(harborsPlugin, { deps } as any);
  await fastify.register(orchestratorPlugin, { deps } as any);
  await fastify.register(briefingPlugin, { deps } as any);
  await fastify.register(sitrepPlugin, { deps } as any);
  await fastify.register(actorsPlugin, { deps } as any);
  await fastify.register(cartographerPlugin, {
    deps: {
      daemonDir: (deps as any).repoRoot ?? (deps as any).__dirname ?? process.cwd(),
      feedback: (deps as any).feedback,
    },
  });
  await fastify.register(operatorPlugin, { deps } as any);

  // These have different option shapes
  await fastify.register(arbiterPlugin, { arbiter } as any);
  await fastify.register(pheromonePlugin, { deps: pheromoneDeps } as any);

  // Tuple space
  const tupleDeps = (deps as any).tuples;
  if (tupleDeps) {
    await fastify.register(tuplesPlugin, { tuples: tupleDeps } as any);
  }

  // Fleet daemon (always-on fleet management) — fleetDaemon, messaging, logger are in deps
  if ((deps as any).fleetDaemon) {
    await fastify.register(fleetPlugin, { deps } as any);
  }

  // Observability (counters + cost tracking)
  if ((deps as any).counters && (deps as any).costTracker) {
    await fastify.register(observabilityPlugin, { deps } as any);
  }

  // Phase 1 — Semantic Graph routes (merge queue, symbol index)
  if ((deps as any).mergeQueue && (deps as any).orchestratorRegistry) {
    await fastify.register(mergeQueuePlugin, { deps } as any);
  }
  if ((deps as any).symbolIndex) {
    await fastify.register(symbolsPlugin, { deps } as any);
  }
  if ((deps as any).graphEdges) {
    await fastify.register(graphPlugin, { deps } as any);
  }
  if ((deps as any).episodicMemory) {
    await fastify.register(memoryPlugin, { deps } as any);
  }
  if ((deps as any).semanticResolver) {
    await fastify.register(semanticPlugin, { deps } as any);
  }

  // FleetControl hardening — bond escrow + wallets + panic
  if ((deps as any).bonds && (deps as any).budgetGuard) {
    await fastify.register(bondsPlugin, { deps } as any);
    await fastify.register(walletsPlugin, { deps } as any);
  }
  await fastify.register(panicPlugin, { deps } as any);

  // Budget pause-and-ask — operator interposition between breach and SIGTERM.
  // Plugin self-degrades to 501 if budgetPause dep absent.
  await fastify.register(budgetPlugin, { deps } as any);

  // Deterministic coordination suggestibility for humans and agents.
  await fastify.register(advisorPlugin, { deps } as any);

  // Operator resource governance — observe/advisory mode before enforcement.
  await fastify.register(resourcesPlugin, { deps } as any);

  // Quorum primitive — tuple-backed proposals/votes for swarm decisions.
  // Only mounts if a quorum dep was constructed (depends on tuple space).
  if ((deps as any).quorum) {
    await fastify.register(quorumPlugin, { deps } as any);
  }

  // Feedback — central agentic-feedback primitive (tuple-backed).
  // Mounts when the feedback dep is present (depends on tuple space).
  if ((deps as any).feedback) {
    await fastify.register(feedbackPlugin, { deps } as any);
  }

  // Usage telemetry — local product instrumentation for CLI/SDK/MCP/UI/daemon.
  if ((deps as any).usageTelemetry) {
    await fastify.register(usagePlugin, { deps } as any);
  }

  // App-Native Development Cockpit — read-only roadmap intake. Pure-function
  // markdown reader, no extra deps required.
  await fastify.register(cockpitPlugin, { deps } as any);
}
