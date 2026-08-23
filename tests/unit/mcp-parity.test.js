/**
 * MCP Parity Tests - MCP <--> Manifest bidirectional enforcement
 *
 * These tests ensure the MCP server (mcp/server.ts) stays in sync with
 * features.manifest.json and the actual HTTP API routes.
 *
 * Checks:
 *   1. MCP --> Manifest: Every MCP tool maps to a manifest feature
 *   2. Manifest --> MCP: Every routed feature has MCP tool coverage
 *   3. MCP --> Routes: Every MCP API call references a real server route
 *   4. MCP tool coverage quality: Feature-specific checks
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

// ============================================================================
// Canonical MCP Tool -> Feature Mapping
// ============================================================================

/**
 * Every MCP tool name MUST appear in this map. If you add a tool to mcp/server.ts,
 * add it here too. This is part of the parity enforcement contract.
 */
const TOOL_FEATURE_MAP = {
  // Trust / introspection
  'attest': 'attest',
  // Host-safety posture audit (ADR-0088 Phase A) — read-only
  'safe_scan': 'safe',
  'relay_status': 'relay',
  'coordination_status': 'coordination',
  'harbormaster_status': 'harbormaster',

  // Harbors (permission namespaces) — #199 cop-out conversion
  'list_harbors': 'harbors',
  'get_harbor': 'harbors',
  'check_harbor_envelope': 'harbors',
  'whois': 'whois',

  // Pheromone signals — #199
  'spray_pheromone': 'pheromone',
  'resolve_pheromone': 'pheromone',
  'pheromone_coverage': 'pheromone',
  'read_pheromones': 'pheromone',
  'read_entity_pheromones': 'pheromone',

  // Roadmap projection (cartographer) + items of record (roadmap) — #199
  'roadmap_progress': 'cartographer',
  'roadmap_claims': 'cartographer',
  'roadmap_list': 'roadmap',
  'roadmap_get': 'roadmap',
  'roadmap_promote': 'roadmap',

  // Commitments (ADR-0041) — #199
  'commit': 'commitments',
  'list_commitments': 'commitments',
  'list_overdue_commitments': 'commitments',

  // Suggestibility nudges (ADR-0039)
  'list_nudges': 'suggestions',
  'respond_nudge': 'suggestions',

  // Parley (ADR-0055)
  'call_parley': 'parley',
  'list_parleys': 'parley',
  'get_parley': 'parley',
  'respond_parley': 'parley',
  'resolve_parley': 'parley',

  // Knowledge: semantic search + symbol index — #199
  'semantic_search': 'semantic',
  'semantic_resolve': 'semantic',
  'find_symbols': 'symbols',
  'symbol_stats': 'symbols',
  'predict_conflicts': 'symbols',
  'blast_radius': 'symbols',

  // Port management
  'claim_port': 'claim',
  'release_port': 'release',
  'list_services': 'services',
  'get_service': 'services',
  'health_check': 'health',

  // Sessions & Notes
  'start_session': 'sessions',
  'end_session': 'sessions',
  'add_note': 'notes',
  'list_sessions': 'sessions',
  'list_notes': 'notes',
  'claim_files': 'sessions',
  'claim_symbols': 'sessions',
  'claim_region': 'sessions',   // Harbor editor P3: region-scoped claim
  'release_region': 'sessions', // Harbor editor P3: region-scoped release

  // Locks
  'acquire_lock': 'locks',
  'release_lock': 'locks',
  'list_locks': 'locks',

  // Messaging
  'publish_message': 'messaging',
  'get_messages': 'messaging',
  'discourse_lineage': 'messaging',

  // Agents
  'register_agent': 'agents',
  'agent_heartbeat': 'agents',
  'list_agents': 'agents',
  'active_agent_roster': 'agents',
  'durable_agent_roster': 'durable_agent_roster',
  'create_durable_agent': 'durable_agent_roster',
  'promote_session_to_durable_agent': 'durable_agent_roster',
  'attach_durable_agent_handoff': 'durable_agent_roster',
  'continue_durable_agent': 'durable_agent_roster',
  'harness_continuation_matrix': 'backend',

  // Salvage
  'check_salvage': 'salvage',
  'claim_salvage': 'salvage',

  // Tunnels
  'start_tunnel': 'tunnel',
  'stop_tunnel': 'tunnel',
  'list_tunnels': 'tunnel',

  // Project scanning
  'scan_project': 'scan',

  // System
  'daemon_status': 'system',
  'activity_log': 'activity',

  // Session Phases
  'set_session_phase': 'session_phases',

  // File Claims
  'list_file_claims': 'file_claims',
  'who_owns_file': 'file_claims',

  // Integration Signals
  'integration_ready': 'integration_signals',
  'integration_needs': 'integration_signals',
  'integration_list': 'integration_signals',

  // Briefing
  'briefing_generate': 'briefing',
  'briefing_read': 'briefing',

  // Sugar (Compound Workflows)
  'begin_session': 'sugar',
  'end_session_full': 'sugar',
  'whoami': 'sugar',
  'coordination_preflight': 'advisor',

  // DNS
  'dns_register': 'dns',
  'dns_unregister': 'dns',
  'dns_list': 'dns',
  'dns_lookup': 'dns',
  'dns_cleanup': 'dns',
  'dns_status': 'dns',
  'dns_setup': 'dns',
  'dns_teardown': 'dns',
  'dns_sync': 'dns',

  // Ports (extended)
  'list_active_ports': 'ports',
  'list_system_ports': 'ports',
  'cleanup_ports': 'ports',

  // Sessions (extended)
  'get_session': 'sessions',
  'delete_session': 'sessions',
  'release_files': 'sessions',

  // Messaging (extended)
  'list_channels': 'messaging',
  'clear_channel': 'messaging',

  // Agents (extended)
  'unregister_agent': 'agents',
  'get_agent': 'agents',

  // Actors
  'list_actors': 'actors',
  'get_actor': 'actors',
  'message_actor': 'actors',
  'list_actor_inbox': 'actors',
  'get_actor_inbox_stats': 'actors',

  // Salvage (extended)
  'salvage_complete': 'salvage',
  'salvage_abandon': 'salvage',
  'salvage_dismiss': 'salvage',

  // Inbox
  'inbox_send': 'inbox',
  'inbox_read': 'inbox',
  'inbox_stats': 'inbox',
  'inbox_mark_read': 'inbox',
  'inbox_mark_all_read': 'inbox',
  'inbox_clear': 'inbox',

  // Webhooks
  'webhook_add': 'webhooks',
  'webhook_list': 'webhooks',
  'webhook_events': 'webhooks',
  'webhook_get': 'webhooks',
  'webhook_update': 'webhooks',
  'webhook_remove': 'webhooks',
  'webhook_test': 'webhooks',
  'webhook_deliveries': 'webhooks',

  // Projects
  'list_projects': 'projects',
  'get_project': 'projects',
  'delete_project': 'projects',

  // Changelog
  'changelog_add': 'changelog',
  'changelog_list': 'changelog',
  'changelog_get': 'changelog',
  'changelog_identities': 'changelog',
  'changelog_by_session': 'changelog',
  'changelog_by_agent': 'changelog',

  // Activity (extended)
  'activity_summary': 'activity',
  'activity_stats': 'activity',
  'activity_range': 'activity',

  // System (extended)
  'get_version': 'system',
  'get_metrics': 'system',
  'get_config': 'system',
  'wait_for_service': 'wait',

  // FleetControl
  'list_bonds': 'bonds',
  'get_bond': 'bonds',
  'slash_bond': 'bonds',
  'list_wallets': 'bonds',
  'get_wallet': 'bonds',
  'top_up_wallet': 'bonds',
  'set_wallet_budget': 'bonds',
  'list_budget_pending': 'budget_guard',
  'get_budget_pending': 'budget_guard',
  'resolve_budget_pending': 'budget_guard',
  'get_panic_status': 'panic',
  'arm_fleet_panic': 'panic',
  'disarm_fleet_panic': 'panic',

  // Meta-tool (progressive disclosure)
  'pd_discover': 'system',

  // Launch hints
  'get_launch_hints': 'launch_hints',

  // Magic tools (high-level composed operations)
  'fleet_init': 'fleet',
  'fleet_status': 'fleet',
  'swarm_awareness': 'agents',
  'sitrep': 'system',
  'catch_me_up': 'activity',
  'file_heat': 'pheromone',
  'talk_to_agent': 'inbox',
  'spawn': 'spawn',
  'cockpit_missions_list': 'cockpit',

  // Tuple Space
  'tuple_out': 'tuples',
  'tuple_read': 'tuples',
  'tuple_take': 'tuples',
  'tuple_scan': 'tuples',
  'tuple_count': 'tuples',
  'graph_edges': 'graph',
  'graph_stats': 'graph',
  'memory_episodes': 'memory',
  'memory_stats': 'memory',

  // Feedback (central agentic-feedback primitive)
  'drop_feedback': 'feedback',
  'submit_visual_task': 'visual_tasks',
  'list_feedback': 'feedback',
  'feedback_summary': 'feedback',

  // Context Health (ADR-0048 P1/P3)
  'get_context_budget': 'context_health',
  'get_context_overview': 'context_health',
  'get_task_ledger': 'context_health',

  // Harvest (ADR-0048 P2/P3)
  'harvest_session': 'harvest',
  'find_related_work': 'harvest',

  // Custodian (ADR-0048 P3)
  'custodian_status': 'custodian',
  'list_pending_approvals': 'custodian',
  'resolve_approval': 'custodian',
};

/**
 * Features that are exempt from MCP tool coverage requirements.
 * These are CLI-only, dashboard-only, or intentionally not exposed via MCP.
 */
const MCP_EXEMPT_FEATURES = new Set([
  'orchestrator',   // CLI-only (up/down)
  'daemon',         // CLI-only (start/stop/restart)
  'diagnostics',    // CLI-only (doctor/diagnose/ci-gate)
  'endpoints',      // Sub-feature of services, managed via claim
  'arbiter',        // Internal invariant enforcement; admin-only API, not user-facing MCP
  'merge_queue',    // API-only merge queue; no CLI or MCP tools yet
  'observability',  // Internal metrics/golden signals; admin API, not user-facing MCP
  'metricsprom',    // Prometheus scrape + browser dashboard endpoints; consumed by Grafana/scrapers and the /metrics.html page, not by MCP-driving agents
  'cloud_app_telemetry', // Worker-facing GitHub App / Cloudflare telemetry ingest + read API. Agents consume the merged fleet/agents/observability surfaces instead of posting remote telemetry through MCP.
  'resource_governance', // Operator UI read model; MCP wrapper deferred until enforcement controls exist
  'sorties',        // Legacy HTTP record surface; MCP and CLI delegation are spawn-only.
  // CONVERTED to real MCP tools (#199): harbors, pheromone, symbols, semantic, cartographer, roadmap, commitments.
  'secrets',        // PR #197 managed provider credential store. CLI-only (`pd secret set/list/reveal/rm`); write + reveal routes are loopback-only (makeLoopbackGuard). Intentionally NO SDK/MCP surface — an agent must not be able to set or read managed provider API keys (e.g. poison ANTHROPIC_API_KEY to exfiltrate prompts). Follows the `setup` CLI-only precedent.
  'quorum',         // New propose/vote primitive; agents drive consensus via SDK calls in v1, MCP wrapper deferred to v4
  'shipwright',     // Survey + propose + apply for fleet authoring; CLI-driven workflow (long-running, interactive review). MCP wrapper deferred until the propose/apply step is non-interactive.
  'cut',            // CLI/CI-only release engineering (pd cut) — a human/pipeline act, not an agent action; no routes, no MCP.
  'setup',          // Local machine onboarding can run installer commands; daemon routes require loopback + GUI capability token, not MCP exposure.
  'usage',          // Local developer-pane telemetry ingestion; not a user-facing MCP tool.
  'blob',           // Phase 0 tube-as-coordination-substrate: content-addressed object storage; agents use the SDK or HTTP directly, MCP wrapper deferred to Phase 1+
  'booty',          // Slice S4a artifact harvest provenance over the blob store. Deposit+list only; agents drive it via `pd booty add/list` (CLI) or HTTP directly, same posture as blob. MCP wrapper deferred until the sweep/gallery follow-ups exist.
  'attention',      // Session-start convention surface; agents consume it via harness SessionStart hooks (Claude Code) or by running `pd attention` at the top of every session. An MCP tool would invert the dependency — the model would have to decide to call it mid-turn, which is exactly the polling problem this feature is supposed to remove. Deferred indefinitely.
  'popper',         // PR #181 autonomous roadmap-to-dispatch task puller. Operator-driven: `pd popper status/next/pop/enable/disable` + the FleetBar Nightshift surface (HTTP). The popper runs daemon-side on a timer; an MCP tool would invert that (the model deciding to pop work mid-turn). CLI/HTTP-only, MCP wrapper deferred.
  'recovery',       // PR #65 magic-link account recovery. API-only single-use token issue/consume consumed by out-of-band recovery flows (proofs/bonded/recovery/magic-link.pv). Intentionally NO MCP surface — an agent must not be able to mint or consume account-recovery tokens.
  'dispatch',       // PR #163 operator queue for autonomous feature dev (ADR-0035). Operator-driven: `pd dispatch/nightshift/review/morning` + POST/GET /dispatches over the daemon queue. Workers are spawned by the daemon, not by an agent calling a tool mid-turn; accept/reject is a human/operator decision. CLI/HTTP-only, MCP wrapper deferred (same posture as popper).
  'fleet_hitl_proposals', // Operator HITL queue for fleet ship ideas. Ships submit inert proposals over HTTP; approve/reject happens in FleetBar/pd-console and approval hands off to dispatch. No MCP tool should let an agent approve its own proposal.
  'suggest',        // PR #322 Tender suggestion queue. Same self-approval hazard as fleet_hitl_proposals: the Tender ship writes suggestions and `POST /fleet/suggestions/:id/approve` fires a one-shot ship run, so an MCP tool would let a fleet agent approve — and fund — its own fleet's suggestion. Operator-driven via `pd suggest` / FleetBar. Intentionally NO MCP surface.
  'fleet_registry', // PR #322 Tender ship-health registry. GET/POST /fleet/registry is the Tender's health-score data plane consumed by FleetBar and pd-console (operator read model, same posture as transcripts/resource_governance), and POST /fleet/run/:ship fires a ship run — the same inversion popper and dispatch avoid (the model deciding to spend on a run mid-turn). CLI/HTTP-only, MCP wrapper deferred.
  'seamanship',     // PR #322 skill registry (`pd seamanship list/search/show/sync/outcomes/index`, alias `pd skills`). Agents do not reach skills through a tool call today: harnesses load SKILL.md directly and fleet ships receive them via the pd-fleet.yml `graft:` key, resolved server-side from the trusted branch. A search/show MCP wrapper is the natural surface once the Phase 3 BM25+Tool2Vec catalog engine lands; deferred until then rather than wrapping the Phase 1 substring scan.
  'transcripts',    // Fleet ship-run records. Operator-facing read/delete surface (`pd transcripts`, routes/transcripts.ts) consumed by the FleetBar/dashboard ship-run views. Read-only telemetry browsing, not an agent-driving tool; MCP wrapper deferred.
  'relay',          // Cloud relay config/status (ADR-0049). CLI `pd relay url/status/exchange` + HTTP daemon routes for relay config. Relay exchange is an operator/CI token operation; agents use the relay channel directly, not a tool that calls /relay/exchange. MCP wrapper deferred.
  'session_galaxy', // 2-D embedding map of recent agent sessions (routes/galaxy.ts: GET /galaxy/map + /galaxy/session/:id). An operator visualization surface consumed by fleet-ui, pd-console, and the FleetBar webview — cross-session t-SNE scatter data is for human eyes, not an agent-driving tool (an agent inspecting peers uses the sessions/transcripts/parley surfaces directly). MCP wrapper deferred indefinitely.
  'harbor-ledger',  // Agent Harbor read API (routes/agent-harbor.ts, C-routes wave). Read-only projection views consumed by the pd-console roster/detail panes (C3) and doctor (C8), plus a long-lived SSE transcript tail — streams are not MCP-shaped (same posture as agent_cockpit). Agents already write to the ledger via `pd harbor-ledger`; an MCP read wrapper is deferred until an agent-facing consumer exists.
  'roadmap_activity', // Live-work join for the roadmap command center (operator mandate 2026-08-22). Read-only projection consumed by the FleetBar/dashboard board surfaces (follow-up PR) — an operator read model like transcripts/resource_governance, not an agent-driving tool; an agent inspecting who is on an item uses the sessions/cartographer roadmap-claims surfaces directly. MCP wrapper deferred until an agent-facing consumer exists.
  'agent_cockpit',  // "Watch + Grab the Wheel" Phase 0. GET /agents/:id/stream is a long-lived SSE feed consumed by the operator console — streams are not MCP-shaped (MCP is request/response, not a held-open subscription; an MCP-driving agent would already use the in-process messaging.subscribe / transcripts.subscribe primitives this route merges). POST /agents/:id/interrupt is the operator grabbing the wheel from a console (same human-decision posture as dispatch accept/reject); a cooperating agent that wants to steer a peer publishes the same control.interrupt envelope onto the `agent:<id>` channel via the existing messaging surface. MCP wrapper deferred.
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a route path for comparison:
 * - Replace all :paramName with :param
 * - Remove regex constraints
 * - Remove trailing slashes
 */
function normalizePath(path) {
  return path
    .replace(/:[^/()]+(\([^)]*\))?/g, ':param')
    .replace(/\/+$/, '')
    || '/';
}

/**
 * Extract MCP tool names from the TOOLS array in mcp/server.ts.
 * Scoped to the TOOLS array only (excludes resource names, server metadata, etc.)
 */
function extractMcpToolNames(mcpContent) {
  // Extract just the TOOLS array body to avoid matching resource names,
  // server config, or other `name:` properties outside the tools list.
  const toolsSectionMatch = mcpContent.match(/const TOOLS\s*=\s*\[([\s\S]*?)\n\];/);
  const toolsSection = toolsSectionMatch ? toolsSectionMatch[1] : '';
  const toolPattern = /name:\s*['"`]([^'"`]+)['"`]/g;
  const tools = [];
  let match;
  while ((match = toolPattern.exec(toolsSection)) !== null) {
    tools.push(match[1]);
  }
  return tools;
}

/**
 * Extract API calls from the handleTool function in mcp/server.ts.
 * Returns array of { tool, method, pathTemplate } objects.
 *
 * Parses patterns like:
 *   res = await POST('/claim', body);
 *   res = await GET(`/services/${qs}`);
 *   res = await DELETE(`/locks/${encodeURIComponent(args.name as string)}`);
 *   const [health, version, metrics] = await Promise.all([GET('/health'), ...]);
 */
function extractMcpApiCalls(mcpContent) {
  const calls = [];

  // Extract the handleTool function body
  const handleToolMatch = mcpContent.match(/async function handleTool[\s\S]*?^}/m);
  if (!handleToolMatch) return calls;

  const body = handleToolMatch[0];

  // Split by case statements to track which tool makes which calls
  const caseBlocks = body.split(/case\s+['"`]([^'"`]+)['"`]\s*:\s*\{/);

  // Process pairs: caseBlocks[0] is before first case, then [1]=toolname, [2]=body, ...
  for (let i = 1; i < caseBlocks.length; i += 2) {
    const toolName = caseBlocks[i];
    const caseBody = caseBlocks[i + 1] || '';

    // Pre-process: replace ${...} template expressions (including nested parens)
    // with __TMPL__ to avoid regex issues with parens inside template expressions.
    let processedBody = caseBody;
    processedBody = processedBody.replace(/\$\{[^}]+\}/g, '__TMPL__');

    // Match API calls: GET('/path'), POST('/path'), PUT('/path'), DELETE('/path')
    // Handle both regular strings and template literals
    const apiCallPattern = /(GET|POST|PUT|DELETE)\(\s*['"`/]([^'"`\n)]+)['"`]?\s*[,)]/g;
    let apiMatch;
    while ((apiMatch = apiCallPattern.exec(processedBody)) !== null) {
      let pathTemplate = apiMatch[2];

      // Clean up template placeholders:
      // /services__TMPL__ -> /services (qs is a query string like ?pattern=...)
      // /locks/__TMPL__ -> /locks/:param
      // /sessions/__TMPL__ -> /sessions/:param
      // /agents/__TMPL__/heartbeat -> /agents/:param/heartbeat
      // /sessions/__TMPL__/notes__TMPL__ -> /sessions/:param/notes
      pathTemplate = pathTemplate
        .replace(/__TMPL__/g, ':param')      // Replace template placeholders with :param
        .replace(/:param[^/]*/g, ':param')   // Clean trailing chars after :param
        .replace(/\?.*$/, '')                // Remove query strings
        .replace(/\/+$/, '')                 // Remove trailing slashes
        || '/';

      // Handle query string params that became :param glued to a path segment.
      // E.g., /services:param (from /services${qs}) -> /services
      // But preserve /services/:param (from /services/${id})
      // A :param directly after a word (no /) is a query string artifact.
      pathTemplate = pathTemplate
        .replace(/([a-z])(:param)$/g, '$1')       // Trailing :param glued to word -> strip
        .replace(/([a-z])(:param)\//g, '$1/')      // Mid-path :param glued to word -> strip
        .replace(/\/+$/, '')                       // Clean trailing slashes again
        || '/';

      // Normalize multiple consecutive :param segments
      pathTemplate = normalizePath(pathTemplate);

      calls.push({
        tool: toolName,
        method: apiMatch[1],
        path: pathTemplate,
      });
    }
  }

  return calls;
}

/**
 * Extract all daemon routes from routes/*.ts files and server.ts.
 * Returns array of { method, path, file } objects.
 */
function extractServerRoutes() {
  const routesDir = join(ROOT, 'routes');
  const routes = [];

  const routePattern = /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, file), 'utf-8');
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: normalizePath(match[2]),
        file
      });
    }
  }

  // A small number of boot-coupled, read-only routes are registered directly
  // in server.ts (for example coordination peer readiness). They are real MCP
  // targets too, so omitting them here creates a false "ghost API call".
  const serverContent = readFileSync(join(ROOT, 'server.ts'), 'utf-8');
  let match;
  while ((match = routePattern.exec(serverContent)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: normalizePath(match[2]),
      file: 'server.ts',
    });
  }

  return routes;
}

/**
 * Check if two normalized paths match, considering :param wildcards.
 */
function pathsMatch(path1, path2) {
  if (path1 === path2) return true;

  const segs1 = path1.split('/').filter(Boolean);
  const segs2 = path2.split('/').filter(Boolean);

  if (segs1.length !== segs2.length) return false;

  return segs1.every((seg, idx) => {
    const other = segs2[idx];
    if (seg === other) return true;
    if (seg === ':param' || other === ':param') return true;
    return false;
  });
}

// ============================================================================
// Load data once
// ============================================================================

let manifest;
let mcpContent;
let mcpToolNames;
let mcpApiCalls;
let serverRoutes;

beforeAll(() => {
  manifest = JSON.parse(readFileSync(join(ROOT, 'features.manifest.json'), 'utf-8'));
  mcpContent = readFileSync(join(ROOT, 'mcp', 'server.ts'), 'utf-8');
  mcpToolNames = extractMcpToolNames(mcpContent);
  mcpApiCalls = extractMcpApiCalls(mcpContent);
  serverRoutes = extractServerRoutes();
});

// ============================================================================
// 1. MCP --> Manifest: Every MCP tool maps to a manifest feature
// ============================================================================

describe('MCP tools --> Manifest features (every tool maps to a feature)', () => {
  it('should find MCP tools to validate', () => {
    expect(mcpToolNames.length).toBeGreaterThan(15);
  });

  it('TOOL_FEATURE_MAP must cover every MCP tool', () => {
    const unmapped = mcpToolNames.filter(t => !(t in TOOL_FEATURE_MAP));

    if (unmapped.length > 0) {
      const msg = [
        '',
        'MCP tools NOT in TOOL_FEATURE_MAP:',
        '',
        ...unmapped.map(t => `  "${t}"`),
        '',
        'Add these to TOOL_FEATURE_MAP in this test file with their corresponding feature name.',
        '',
      ].join('\n');
      expect(unmapped).toEqual([]);
    }
  });

  it('TOOL_FEATURE_MAP must not reference nonexistent features', () => {
    const featureNames = new Set(Object.keys(manifest.features));
    const invalid = [];

    for (const [tool, feature] of Object.entries(TOOL_FEATURE_MAP)) {
      if (!featureNames.has(feature)) {
        invalid.push(`"${tool}" -> "${feature}" (feature does not exist in manifest)`);
      }
    }

    expect(invalid).toEqual([]);
  });

  it('TOOL_FEATURE_MAP must not reference nonexistent MCP tools', () => {
    const toolNameSet = new Set(mcpToolNames);
    const stale = [];

    for (const tool of Object.keys(TOOL_FEATURE_MAP)) {
      if (!toolNameSet.has(tool)) {
        stale.push(`"${tool}" is in TOOL_FEATURE_MAP but not in MCP server TOOLS array`);
      }
    }

    expect(stale).toEqual([]);
  });
});

// ============================================================================
// 2. Manifest --> MCP: Every routed feature should have MCP coverage
// ============================================================================

describe('Manifest features --> MCP tools (routed features need MCP coverage)', () => {
  it('every routed, non-exempt feature should have at least one MCP tool', () => {
    const toolFeatures = new Set(Object.values(TOOL_FEATURE_MAP));
    const uncovered = [];

    for (const [featureName, feature] of Object.entries(manifest.features)) {
      // Skip features with no routes (CLI-only)
      if (!feature.routes || feature.routes.length === 0) continue;
      // Skip exempt features
      if (MCP_EXEMPT_FEATURES.has(featureName)) continue;

      if (!toolFeatures.has(featureName)) {
        uncovered.push(`"${featureName}" -- ${feature.routes.length} route(s), 0 MCP tools`);
      }
    }

    if (uncovered.length > 0) {
      const msg = [
        '',
        'UNCOVERED FEATURES: These have routes but no MCP tools:',
        '',
        ...uncovered.map(u => `  ${u}`),
        '',
        'Fix by either:',
        '  1. Adding MCP tool(s) for the feature in mcp/server.ts',
        '  2. Adding the feature to MCP_EXEMPT_FEATURES with a comment explaining why',
        '',
      ].join('\n');
      expect(uncovered).toEqual([]);
    }
  });

  it('MCP_EXEMPT_FEATURES should only contain real feature names', () => {
    const featureNames = new Set(Object.keys(manifest.features));
    const invalid = [];

    for (const exemptName of MCP_EXEMPT_FEATURES) {
      if (!featureNames.has(exemptName)) {
        invalid.push(`"${exemptName}" is in MCP_EXEMPT_FEATURES but not in manifest`);
      }
    }

    expect(invalid).toEqual([]);
  });
});

// ============================================================================
// 3. MCP --> Routes: Every MCP API call references a real server route
// ============================================================================

/**
 * Routes that use TypeScript generics in Fastify (`fastify.post<{Params}>()`)
 * cannot be detected by the simple regex route extractor — the `<{Params}>` type
 * argument confuses the `.post(` pattern matcher. These routes ARE real and DO exist
 * in the server; they are just invisible to the static extractor.
 *
 * Convention: add a `_note` to features.manifest.json explaining the omission.
 * Mirroring that convention here avoids false ghost-call failures.
 */
const KNOWN_GENERIC_ROUTES = new Set([
  'POST /harvest/session/:param',   // routes/harvest.ts — Fastify generic syntax
  'POST /custodian/approvals/:param', // routes/custodian.ts — Fastify generic syntax
  'GET /harbors',                   // routes/harbors.ts — Fastify generic syntax
  'GET /harbors/:param',            // routes/harbors.ts — Fastify generic syntax
  'POST /harbors/:param/check',     // routes/harbors.ts — Fastify generic syntax
  'GET /harbors/agent/:param',      // routes/harbors.ts — Fastify generic syntax; no MCP tool calls this route yet, listed pre-emptively so adding one later doesn't silently regress this check
]);

describe('MCP tool API calls --> Server routes (no ghost API calls)', () => {
  it('should extract API calls from MCP handleTool function', () => {
    expect(mcpApiCalls.length).toBeGreaterThan(10);
  });

  it('every MCP API call should match a real server route', () => {
    const ghostCalls = [];

    for (const call of mcpApiCalls) {
      // Skip paths that are just :param (result of template-only paths)
      if (call.path === ':param' || call.path === '') continue;

      // Skip routes known to use TypeScript generics (invisible to the regex extractor)
      const callKey = `${call.method} ${call.path}`;
      if (KNOWN_GENERIC_ROUTES.has(callKey)) continue;

      const matchesRoute = serverRoutes.some(sr =>
        sr.method === call.method && pathsMatch(sr.path, call.path)
      );

      if (!matchesRoute) {
        ghostCalls.push(
          `${call.method} ${call.path}  (tool: "${call.tool}")`
        );
      }
    }

    if (ghostCalls.length > 0) {
      const msg = [
        '',
        'GHOST MCP API CALLS: These MCP tools call routes that do not exist:',
        '',
        ...ghostCalls.map(g => `  ${g}`),
        '',
        'This likely means:',
        '  1. The route was removed/renamed but the MCP tool was not updated',
        '  2. The MCP tool has a typo in its API path',
        '  3. The route is registered differently than expected',
        '',
      ].join('\n');
      expect(ghostCalls).toEqual([]);
    }
  });
});

// ============================================================================
// 4. MCP tool coverage quality checks
// ============================================================================

describe('MCP tool coverage quality', () => {
  it('claim feature should have claim and release tools', () => {
    const claimTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'claim' || TOOL_FEATURE_MAP[t] === 'release'
    );
    expect(claimTools.length).toBeGreaterThanOrEqual(2);
    expect(claimTools).toContain('claim_port');
    expect(claimTools).toContain('release_port');
  });

  it('services feature should have list and get tools', () => {
    const servicesTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'services'
    );
    expect(servicesTools).toContain('list_services');
    expect(servicesTools).toContain('get_service');
  });

  it('sessions feature should have start, end, list, and claim_files tools', () => {
    const sessionTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'sessions'
    );
    expect(sessionTools).toContain('start_session');
    expect(sessionTools).toContain('end_session');
    expect(sessionTools).toContain('list_sessions');
    expect(sessionTools).toContain('claim_files');
  });

  it('notes feature should have add and list tools', () => {
    const noteTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'notes'
    );
    expect(noteTools).toContain('add_note');
    expect(noteTools).toContain('list_notes');
  });

  it('locks feature should have acquire, release, and list tools', () => {
    const lockTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'locks'
    );
    expect(lockTools).toContain('acquire_lock');
    expect(lockTools).toContain('release_lock');
    expect(lockTools).toContain('list_locks');
  });

  it('messaging feature should have publish and get tools', () => {
    const msgTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'messaging'
    );
    expect(msgTools).toContain('publish_message');
    expect(msgTools).toContain('get_messages');
  });

  it('agents feature should have register, heartbeat, and list tools', () => {
    const agentTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'agents'
    );
    expect(agentTools).toContain('register_agent');
    expect(agentTools).toContain('agent_heartbeat');
    expect(agentTools).toContain('list_agents');
  });

  it('salvage feature should have check and claim tools', () => {
    const salvageTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'salvage'
    );
    expect(salvageTools).toContain('check_salvage');
    expect(salvageTools).toContain('claim_salvage');
  });

  it('tunnel feature should have start, stop, and list tools', () => {
    const tunnelTools = mcpToolNames.filter(t =>
      TOOL_FEATURE_MAP[t] === 'tunnel'
    );
    expect(tunnelTools).toContain('start_tunnel');
    expect(tunnelTools).toContain('stop_tunnel');
    expect(tunnelTools).toContain('list_tunnels');
  });

  it('total MCP tool count should match TOOL_FEATURE_MAP size', () => {
    expect(mcpToolNames.length).toBe(Object.keys(TOOL_FEATURE_MAP).length);
  });
});

// ============================================================================
// 5a. MCP tiered loading (progressive disclosure)
// ============================================================================

describe('MCP tiered tool loading', () => {
  const ESSENTIAL_NAMES = [
    'begin_session', 'end_session_full', 'whoami',
    'claim_port', 'release_port', 'add_note',
    'acquire_lock', 'list_services',
    'fleet_init', 'swarm_awareness', 'durable_agent_roster', 'coordination_preflight', 'catch_me_up', 'spawn',
  ];

  const CATEGORY_NAMES = [
    'magic', 'roster', 'session-lifecycle', 'trust', 'safety', 'advisor', 'ports', 'sessions', 'notes', 'locks',
    'messaging', 'agents', 'actors', 'inbox', 'webhooks', 'integration', 'dns', 'briefing',
    'tunnels', 'projects', 'changelog', 'activity', 'system', 'tuples',
    'fleet-control', 'semantic', 'feedback', 'cockpit',
    'harbors', 'signals', 'roadmap', 'commitments', 'suggestions', 'parley', 'knowledge',
    'context', 'harvest', 'custodian',
  ];

  it('ESSENTIAL_TOOL_NAMES in server matches expected set', () => {
    // Verify the MCP source defines the expected essential tools
    const essentialRegex = /ESSENTIAL_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/;
    const match = mcpContent.match(essentialRegex);
    expect(match).not.toBeNull();

    for (const name of ESSENTIAL_NAMES) {
      expect(match[1]).toContain(`'${name}'`);
    }
  });

  it('essential tools are a subset of all MCP tools', () => {
    for (const name of ESSENTIAL_NAMES) {
      expect(mcpToolNames).toContain(name);
    }
  });

  it('pd_discover meta-tool is defined', () => {
    expect(mcpToolNames).toContain('pd_discover');
  });

  it('TOOL_CATEGORIES covers every non-essential, non-meta tool', () => {
    const categoryRegex = /TOOL_CATEGORIES[\s\S]*?=\s*\{([\s\S]*?)\n\};/;
    const match = mcpContent.match(categoryRegex);
    expect(match).not.toBeNull();

    // Every MCP tool should appear in at least one category
    const allCategoryTools = [];
    for (const catName of CATEGORY_NAMES) {
      const catRegex = new RegExp(`'${catName}'[\\s\\S]*?tools:\\s*\\[(.*?)\\]`, 's');
      const catMatch = mcpContent.match(catRegex);
      if (catMatch) {
        const tools = catMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
        allCategoryTools.push(...tools);
      }
    }

    for (const tool of mcpToolNames) {
      if (tool === 'pd_discover') continue; // meta-tool not in categories
      expect(allCategoryTools).toContain(tool);
    }
  });

  it('tiered mode should expose 15 tools (14 essential + pd_discover)', () => {
    // In default (non-full) mode, only essential + pd_discover are listed
    const tieredCount = ESSENTIAL_NAMES.length + 1; // +1 for pd_discover
    expect(tieredCount).toBe(15);
  });
});

// ============================================================================
// 5. Previously-known bugs (now fixed, assertions enforce correctness)
// ============================================================================

describe('MCP salvage and agent routes (previously-known bugs, now fixed)', () => {
  it('check_salvage should call GET /resurrection/pending (fixed)', () => {
    const salvageCalls = mcpApiCalls.filter(c => c.tool === 'check_salvage');
    expect(salvageCalls.length).toBeGreaterThanOrEqual(1);

    // Every check_salvage call should match a real server route
    for (const call of salvageCalls) {
      const matchesRoute = serverRoutes.some(sr =>
        sr.method === call.method && pathsMatch(sr.path, call.path)
      );
      expect(matchesRoute).toBe(true);
    }
  });

  it('claim_salvage should call POST /resurrection/claim/:id (fixed)', () => {
    const claimCalls = mcpApiCalls.filter(c => c.tool === 'claim_salvage');
    expect(claimCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of claimCalls) {
      const matchesRoute = serverRoutes.some(sr =>
        sr.method === call.method && pathsMatch(sr.path, call.path)
      );
      expect(matchesRoute).toBe(true);
    }
  });

  it('agent_heartbeat should call POST /agents/:id/heartbeat (fixed)', () => {
    const heartbeatCalls = mcpApiCalls.filter(c => c.tool === 'agent_heartbeat');
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of heartbeatCalls) {
      // Should be POST, not PUT
      expect(call.method).toBe('POST');
      const matchesRoute = serverRoutes.some(sr =>
        sr.method === call.method && pathsMatch(sr.path, call.path)
      );
      expect(matchesRoute).toBe(true);
    }
  });
});
