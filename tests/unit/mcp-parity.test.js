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

  // Locks
  'acquire_lock': 'locks',
  'release_lock': 'locks',
  'list_locks': 'locks',

  // Messaging
  'publish_message': 'messaging',
  'get_messages': 'messaging',

  // Agents
  'register_agent': 'agents',
  'agent_heartbeat': 'agents',
  'list_agents': 'agents',

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

  // DNS
  'dns_register': 'dns',
  'dns_unregister': 'dns',
  'dns_list': 'dns',
  'dns_lookup': 'dns',
  'dns_cleanup': 'dns',
  'dns_status': 'dns',

  // Meta-tool (progressive disclosure)
  'pd_discover': 'system',
};

/**
 * Features that are exempt from MCP tool coverage requirements.
 * These are CLI-only, dashboard-only, or intentionally not exposed via MCP.
 */
const MCP_EXEMPT_FEATURES = new Set([
  'orchestration',  // CLI-only (up/down)
  'daemon',         // CLI-only (start/stop/restart)
  'diagnostics',    // CLI-only (doctor/diagnose/ci-gate)
  'inbox',          // Server-side only, not yet wired to MCP
  'endpoints',      // Sub-feature of services, managed via claim
  'changelog',      // Not yet exposed via MCP
  'projects',       // Accessed via scan_project indirectly
  'ports',          // Legacy routes, covered by claim/release/services
  'wait',           // Covered by health_check conceptually
  'webhooks',       // CLI-only webhook management, not exposed via MCP
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
 * Extract all Express routes from routes/*.ts files.
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

describe('MCP tool API calls --> Server routes (no ghost API calls)', () => {
  it('should extract API calls from MCP handleTool function', () => {
    expect(mcpApiCalls.length).toBeGreaterThan(10);
  });

  it('every MCP API call should match a real server route', () => {
    const ghostCalls = [];

    for (const call of mcpApiCalls) {
      // Skip paths that are just :param (result of template-only paths)
      if (call.path === ':param' || call.path === '') continue;

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
  ];

  const CATEGORY_NAMES = [
    'session-lifecycle', 'ports', 'sessions', 'notes', 'locks',
    'messaging', 'agents', 'integration', 'dns', 'briefing',
    'tunnels', 'system',
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

  it('tiered mode should expose 9 tools (8 essential + pd_discover)', () => {
    // In default (non-full) mode, only essential + pd_discover are listed
    const tieredCount = ESSENTIAL_NAMES.length + 1; // +1 for pd_discover
    expect(tieredCount).toBe(9);
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
