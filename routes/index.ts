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
import { agentCockpitPlugin } from './agent-cockpit.js';
import { agentRosterPlugin } from './agent-roster.js';
import { durableAgentRosterPlugin } from './durable-agent-roster.js';
import { agentHarborPlugin } from './agent-harbor.js';
import { activityPlugin } from './activity.js';
import { webhooksPlugin } from './webhooks.js';
import { githubWebhookPlugin } from './github-webhook.js';
import { fleetWebhooksPlugin } from './fleet-webhooks.js';
import { fleetApprovalsPlugin } from './fleet-approvals.js';
import { fleetPushPlugin } from './fleet-push.js';
import { relayPlugin } from './relay.js';
import { configPlugin } from './config.js';
import { projectsPlugin } from './projects.js';
import { sessionsPlugin } from './sessions.js';
import { resurrectionPlugin } from './resurrection.js';
import { changelogPlugin } from './changelog.js';
import { tunnelPlugin } from './tunnel.js';
import { dnsPlugin } from './dns.js';
import { sugarPlugin } from './sugar.js';
import { attentionPlugin } from './attention.js';
import { suggestionsPlugin } from './suggestions.js';
import { launchPlugin } from './launch.js';
import { spawnPlugin } from './spawn.js';
import { attestPlugin } from './attest.js';
import { safePlugin } from './safe.js';
import { transcriptsPlugin } from './transcripts.js';
import { harborsPlugin } from './harbors.js';
import { whoisPlugin } from './whois.js';
import { sortiesPlugin } from './sorties.js';
import { orchestratorPlugin } from './orchestrator.js';
import { briefingPlugin } from './briefing.js';
import { sitrepPlugin } from './sitrep.js';
// Arbiter and pheromone have different option shapes
import { arbiterPlugin } from './arbiter.js';
import { pheromonePlugin } from './pheromone.js';
import { tuplesPlugin } from './tuples.js';
import { blobPlugin } from './blob.js';
import { bootyPlugin } from './booty.js';
import { fleetPlugin } from './fleet.js';
import { observabilityPlugin } from './observability.js';
import { metricsPromPlugin } from './metrics-prom.js';
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
import { parleyPlugin } from './parley.js';
import { galaxyPlugin } from './galaxy.js';
import { resourcesPlugin } from './resources.js';
import { feedbackPlugin } from './feedback.js';
import { roadmapPlugin } from './roadmap.js';
import { roadmapActivityPlugin } from './roadmap-activity.js';
import { commitmentsPlugin } from './commitments.js';
import { shipwrightPlugin } from './shipwright.js';
import { usagePlugin } from './usage.js';
import { cloudAppTelemetryPlugin } from './cloud-app-telemetry.js';
import { testHooksPlugin } from './test-hooks.js';
import { cockpitPlugin } from './cockpit.js';
import { popperPlugin } from './popper.js';
import { dispatchesPlugin } from './dispatches.js';
import { harbormasterPlugin } from './harbormaster.js';
import { visualTasksPlugin } from './visual-tasks.js';
import { fleetHitlProposalsPlugin } from './fleet-hitl-proposals.js';
import { setupPlugin } from './setup.js';
import { secretsPlugin } from './secrets.js';
import { contextRoutes as contextPlugin } from './context.js';
import { harvestPlugin } from './harvest.js';
import { custodianPlugin } from './custodian.js';

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
  await fastify.register(agentRosterPlugin, { deps } as any);
  await fastify.register(durableAgentRosterPlugin, { deps } as any);

  // Agent Harbor read API (binder ch09; work order C-routes). Serves C1's
  // projections over HTTP: GET /agent-nodes (+detail/files), paged+SSE
  // GET /sessions/:id/events, /costs, /receipts/:id verify, /compliance/:id.
  // Read-only; stale projections are labeled in the envelope, never hidden.
  await fastify.register(agentHarborPlugin, { deps } as any);

  // Agent Cockpit — "Watch + Grab the Wheel" Phase 0. Additive: GET
  // /agents/:id/stream (merged SSE) + POST /agents/:id/interrupt (soft steer).
  // Registers AFTER agentsPlugin so its specific /agents/:id/stream path is
  // matched alongside the generic /agents/:id. transcripts is optional in deps;
  // the plugin self-degrades to status+tube sources when it's absent.
  await fastify.register(agentCockpitPlugin, { deps } as any);

  await fastify.register(activityPlugin, { deps } as any);
  await fastify.register(webhooksPlugin, { deps } as any);
  await fastify.register(githubWebhookPlugin, { deps } as any);
  // Fleet inbound webhook receiver (I/O wiring Phase 2, trust-gated).
  await fastify.register(fleetWebhooksPlugin, { deps } as any);
  // Trust-gate approval loop: WebSocket stream + REST decisions (ADR-0093 L2).
  await fastify.register(fleetApprovalsPlugin, { deps } as any);
  // Web Push (VAPID) so approval gates reach the operator's devices.
  await fastify.register(fleetPushPlugin, { deps } as any);

  // Relay — daemon-side federation management (ADR-0049). Was SHIPPED-DEAD:
  // routes/relay.ts defined GET/POST /relay/config, /relay/status and
  // POST /relay/exchange but the plugin was never registered, so the
  // `pd relay` CLI 404'd against a live daemon. Mutating routes are
  // loopback-guarded + SSRF-validated inside the plugin (see routes/relay.ts).
  // getRelayStatus is supplied by server.ts; it honestly reports
  // "not connected" because the outbound SSE connection manager is not yet
  // started in the daemon.
  await fastify.register(relayPlugin, {
    deps: {
      db: (deps as any).db,
      logger: (deps as any).logger,
      getRelayStatus:
        (deps as { getRelayStatus?: () => unknown }).getRelayStatus ??
        (() => ({
          connected: false,
          session_id: null,
          last_handshake: null,
          accepted_channels: [],
          relay_version: null,
        })),
      // Optional: server.ts supplies this so a runtime relay config write or a
      // freshly exchanged card restarts the live connection lifecycle.
      onConfigChanged: (deps as { notifyRelayConfigChanged?: () => void }).notifyRelayConfigChanged,
    },
  } as any);

  await fastify.register(configPlugin, { deps } as any);
  await fastify.register(projectsPlugin, { deps } as any);
  await fastify.register(sessionsPlugin, { deps } as any);
  await fastify.register(resurrectionPlugin, { deps } as any);
  await fastify.register(changelogPlugin, { deps } as any);
  await fastify.register(tunnelPlugin, { deps } as any);
  await fastify.register(dnsPlugin, { deps } as any);
  await fastify.register(sugarPlugin, { deps } as any);
  await fastify.register(attentionPlugin, { deps } as any);
  await fastify.register(suggestionsPlugin, { deps } as any);
  await fastify.register(launchPlugin, { deps } as any);
  await fastify.register(spawnPlugin, { deps } as any);
  await fastify.register(attestPlugin, { deps } as any);
  // ADR-0088 Phase A: GET /safe/scan — the read-only host-safety posture audit.
  // The A5 trust ledger it records into is daemon-resident (bun:sqlite), so the
  // scan lives behind the daemon and the CLI/MCP both hit this one route.
  await fastify.register(safePlugin, { deps } as any);
  await fastify.register(transcriptsPlugin, { deps } as any);
  await fastify.register(sortiesPlugin, { deps } as any);
  await fastify.register(harborsPlugin, { deps } as any);
  if ((deps as any).whois) {
    await fastify.register(whoisPlugin, { deps } as any);
  }
  await fastify.register(orchestratorPlugin, { deps } as any);
  await fastify.register(briefingPlugin, { deps } as any);
  await fastify.register(sitrepPlugin, { deps } as any);
  await fastify.register(actorsPlugin, { deps } as any);
  await fastify.register(cartographerPlugin, {
    deps: {
      daemonDir: (deps as any).repoRoot ?? (deps as any).__dirname ?? process.cwd(),
      feedback: (deps as any).feedback,
      roadmapPop: (deps as any).roadmapPop,
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

  // Blob store (Phase 0 of tube-as-coordination-substrate roadmap).
  // Filesystem-only — registers iff a blob store dep was constructed.
  if ((deps as any).blobs) {
    await fastify.register(blobPlugin, { deps } as any);
  }

  // Booty — artifact harvest provenance over the blob store (slice S4a).
  // Requires both the provenance table (booty) and the blob store (blobs):
  // a booty row must never point at bytes the store cannot produce.
  if ((deps as any).booty && (deps as any).blobs) {
    await fastify.register(bootyPlugin, { deps } as any);
  }

  // Fleet daemon (always-on fleet management) — fleetDaemon, messaging, logger are in deps
  if ((deps as any).fleetDaemon) {
    await fastify.register(fleetPlugin, { deps } as any);
  }

  // Observability (counters + cost tracking)
  if ((deps as any).counters && (deps as any).costTracker) {
    await fastify.register(observabilityPlugin, { deps } as any);
  }

  // Cloud App telemetry — remote GitHub App / Cloudflare Worker events that
  // never passed through the local spawner.
  await fastify.register(cloudAppTelemetryPlugin, { deps } as any);

  // Prometheus metrics + JSON snapshots (powers /metrics dashboard page)
  if ((deps as any).metricsRegistry && (deps as any).db) {
    await fastify.register(metricsPromPlugin, { deps } as any);
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

  // GUI-first local onboarding and setup actions.
  await fastify.register(setupPlugin, { deps } as any);

  // Managed provider secret store — keychain-backed CRUD over the
  // allow-listed keys. Reveal is loopback-guarded inside the plugin.
  await fastify.register(secretsPlugin, { deps } as any);

  // Operator resource governance — observe/advisory mode before enforcement.
  await fastify.register(resourcesPlugin, { deps } as any);

  // Quorum primitive — tuple-backed proposals/votes for swarm decisions.
  // Only mounts if a quorum dep was constructed (depends on tuple space).
  if ((deps as any).quorum) {
    await fastify.register(quorumPlugin, { deps } as any);
  }

  // Parley — manual forced-reconciliation core for contested agent work.
  if ((deps as any).parley) {
    await fastify.register(parleyPlugin, { deps } as any);
  }

  // Session Galaxy — 2-D embedding map of recent agent sessions (MiniLM tail
  // embeddings, seeded t-SNE, MI-labeled clusters) with click-through detail.
  if ((deps as any).galaxy) {
    await fastify.register(galaxyPlugin, { deps } as any);
  }

  // Feedback — central agentic-feedback primitive (tuple-backed).
  // Mounts when the feedback dep is present (depends on tuple space).
  if ((deps as any).feedback) {
    await fastify.register(feedbackPlugin, { deps } as any);
  }

  // Roadmap — tuple-backed roadmap_items DB-of-record (slices A+B of
  // roadmap-db-of-record). Mounts when both roadmapItems and
  // roadmapPromote are present so the promote endpoint can land
  // atomic feedback→item links.
  if ((deps as any).roadmapItems && (deps as any).roadmapPromote) {
    await fastify.register(roadmapPlugin, { deps } as any);
  }

  // Roadmap Activity — the live-work join for the roadmap command center
  // (operator mandate 2026-08-22): GET /roadmap/activity (board feed with
  // stage counts) + GET /roadmap/items/:slug/activity (per-item attachments
  // with honest liveness, cockpit links, HITL). Read-only; mounts when the
  // roadmapActivity dep is present.
  if ((deps as any).roadmapActivity) {
    await fastify.register(roadmapActivityPlugin, { deps } as any);
  }

  // Durable commitments + obligation monitor (ADR-0041 first slice). Mounts
  // when both the commitments store and its monitor were constructed.
  if ((deps as any).commitments && (deps as any).obligationMonitor) {
    await fastify.register(commitmentsPlugin, { deps } as any);
  }

  // Shipwright — survey/propose/apply for fleet authoring.
  // Always mounts; LLM augmentation is opt-in and degrades if no client wired.
  await fastify.register(shipwrightPlugin, {
    deps: {
      llmClient: (deps as any).llmClient,
      defaultLlmModel: (deps as any).defaultLlmModel,
    },
  });

  // Usage telemetry — local product instrumentation for CLI/SDK/MCP/UI/daemon.
  // The plugin self-degrades when telemetry storage is absent, so UI calls do
  // not spray 404s in dev/profiling daemon modes.
  await fastify.register(usagePlugin, { deps } as any);

  // Test-only hooks. Self-degrades to no-op when NODE_ENV !== 'test'. Used
  // by the integration suite to drive the budget-kill chain end-to-end
  // (spec docs/shipwright/FLEETCONTROL-HARDENING.md §6.2).
  if ((deps as any).costTracker) {
    await fastify.register(testHooksPlugin, { deps } as any);
  }

  // App-Native Development Cockpit — read-only roadmap intake. Pure-function
  // markdown reader, no extra deps required.
  await fastify.register(cockpitPlugin, { deps } as any);

  // Roadmap popper HTTP surface — operator's pd popper CLI + FleetBar
  // Nightshift status banner. Self-degrades instead of 404ing when the
  // popper body is not configured in a stripped daemon mode.
  await fastify.register(popperPlugin, { deps } as any);

  // Dispatch queue HTTP surface — operator's POST /dispatches +
  // accept/reject/cancel buttons. Requires `dispatchQueue` in deps.
  if ((deps as { dispatchQueue?: unknown }).dispatchQueue) {
    await fastify.register(dispatchesPlugin, { deps } as any);
  }

  // Harbormaster status HTTP surface — FleetBar polls this read-only view
  // instead of shelling out to `pd harbormaster status`. Self-degrades when
  // stripped daemon modes do not provide a DB.
  await fastify.register(harbormasterPlugin, { deps } as any);

  // Fleet HITL proposals — cloud ships can propose work, but only these
  // operator-gated routes may turn a proposal into a dispatch.
  if ((deps as { db?: unknown }).db || (deps as { fleetProposals?: unknown }).fleetProposals) {
    await fastify.register(fleetHitlProposalsPlugin, { deps } as any);
  }

  // Visual task issue intake — browser/FleetBar POST /visual-tasks. This is
  // product vocabulary over channels, blobs, inboxes, and dispatch queue writes.
  await fastify.register(visualTasksPlugin, { deps } as any);

  // Context health overview — mounts when contextTracker dep is present.
  if ((deps as { contextTracker?: unknown }).contextTracker) {
    await fastify.register(contextPlugin, { deps } as any);
  }

  // Session harvest — mounts when episodicMemory dep is present (already gated above for memoryPlugin).
  if ((deps as { episodicMemory?: unknown }).episodicMemory) {
    await fastify.register(harvestPlugin, { deps } as any);
  }

  // Knowledge Custodian — mounts when custodian + operatorPermissions are present.
  if ((deps as { custodian?: unknown }).custodian && (deps as { operatorPermissions?: unknown }).operatorPermissions) {
    await fastify.register(custodianPlugin, {
      deps: {
        custodian: (deps as any).custodian,
        operatorPermissions: (deps as any).operatorPermissions,
      },
    });
  }
}
