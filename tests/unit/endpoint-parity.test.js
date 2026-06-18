/**
 * Endpoint Parity Test — Static analysis to catch ghost endpoints.
 *
 * Reads all CLI command files and extracts every URL the CLI fetches,
 * then reads all server route files and extracts every registered route.
 * Fails if the CLI references an endpoint that doesn't exist on the server.
 *
 * This prevents "ghost features" — code in the CLI that calls a
 * non-existent server endpoint (like the DNS feature that was documented
 * and wired in the CLI but never implemented server-side).
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a URL path for comparison:
 * - Replace Express-style :paramName with :param
 * - Remove trailing slashes
 * - Remove regex constraints like (:id(\\d+)) to :param
 */
function normalizePath(path) {
  return path
    .replace(/:[^/()]+(\([^)]*\))?/g, ':param')
    .replace(/\/+$/, '')
    || '/';
}

/**
 * Extract all endpoints the CLI calls via pdFetch.
 *
 * Parses patterns like:
 *   pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/heartbeat`, { method: 'POST' })
 *   pdFetch(`${PORT_DADDY_URL}/health`)
 *
 * Returns array of { method, path, file, line } objects.
 */
function extractCliEndpoints() {
  const cliDir = join(ROOT, 'cli', 'commands');
  const endpoints = [];

  for (const file of readdirSync(cliDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(cliDir, file), 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match pdFetch(`${PORT_DADDY_URL}/path...`)
      const fetchMatch = line.match(/pdFetch\s*\(\s*`\$\{PORT_DADDY_URL\}(\/[^`]*)`/);
      if (!fetchMatch) continue;

      let rawPath = fetchMatch[1];

      // Replace template expressions embedded in the path with :param FIRST
      // e.g., /agents/${encodeURIComponent(agentId)}/heartbeat -> /agents/:param/heartbeat
      rawPath = rawPath.replace(/\$\{encodeURIComponent\([^)]+\)\}/g, ':param');
      rawPath = rawPath.replace(/\$\{encodeURIComponent\s*\([^)]+\)\}/g, ':param');

      // Strip trailing query string expressions like ${params.toString() ? ...}
      // These appear at the end: /activity/summary${params.toString()...
      rawPath = rawPath.replace(/\$\{[^}]*\}$/g, '');

      // Strip literal query strings: /sessions?status=active&limit=1
      rawPath = rawPath.replace(/\?.*$/, '');

      // Replace remaining template expressions with :param
      // e.g., /changelog/${identity} -> /changelog/:param
      rawPath = rawPath.replace(/\$\{[^}]+\}/g, ':param');

      // Clean up any double slashes from replacements
      rawPath = rawPath.replace(/\/+/g, '/');

      // Remove trailing slash
      rawPath = rawPath.replace(/\/+$/, '') || '/';

      // Detect HTTP method from surrounding lines
      let method = 'GET';
      const context = lines.slice(i, Math.min(i + 6, lines.length)).join(' ');
      const methodMatch = context.match(/method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
      if (methodMatch) {
        method = methodMatch[1].toUpperCase();
      }

      endpoints.push({
        method,
        path: normalizePath(rawPath),
        file: file,
        line: i + 1
      });
    }
  }

  return endpoints;
}

/**
 * Extract all registered server routes from routes/*.ts and server.ts.
 *
 * Parses patterns like:
 *   router.post('/agents/:id/heartbeat', (req, res) => { ... })
 *
 * Returns a Set of "METHOD /normalized/path" strings.
 */
function extractServerRoutes() {
  const routesDir = join(ROOT, 'routes');
  const routes = new Set();

  const routePattern = /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, file), 'utf-8');
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const path = normalizePath(match[2]);
      routes.add(`${method} ${path}`);
    }
  }

  // Also check server.ts for any directly registered routes
  const serverContent = readFileSync(join(ROOT, 'server.ts'), 'utf-8');
  let match;
  while ((match = routePattern.exec(serverContent)) !== null) {
    const method = match[1].toUpperCase();
    const path = normalizePath(match[2]);
    routes.add(`${method} ${path}`);
  }

  return routes;
}

/**
 * Check if a CLI endpoint matches any registered server route.
 * Handles parameterized paths where both sides use :param.
 */
function matchesRoute(endpoint, serverRoutes) {
  const key = `${endpoint.method} ${endpoint.path}`;
  if (serverRoutes.has(key)) return true;

  for (const route of serverRoutes) {
    const [routeMethod, routePath] = route.split(' ', 2);
    if (routeMethod !== endpoint.method) continue;

    const epSegments = endpoint.path.split('/').filter(Boolean);
    const routeSegments = routePath.split('/').filter(Boolean);

    if (epSegments.length !== routeSegments.length) continue;

    const segmentsMatch = epSegments.every((seg, idx) => {
      const routeSeg = routeSegments[idx];
      if (seg === routeSeg) return true;
      if (seg === ':param' || routeSeg === ':param') return true;
      return false;
    });

    if (segmentsMatch) return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Endpoint Parity: CLI calls server routes', () => {
  const cliEndpoints = extractCliEndpoints();
  const serverRoutes = extractServerRoutes();

  it('should find CLI endpoints to validate', () => {
    expect(cliEndpoints.length).toBeGreaterThan(20);
  });

  it('should find server routes to compare against', () => {
    expect(serverRoutes.size).toBeGreaterThan(20);
  });

  it('every CLI pdFetch call should have a matching server route', () => {
    const ghosts = [];

    for (const ep of cliEndpoints) {
      if (!matchesRoute(ep, serverRoutes)) {
        ghosts.push(`${ep.method} ${ep.path}  (cli/commands/${ep.file}:${ep.line})`);
      }
    }

    if (ghosts.length > 0) {
      const msg = [
        '',
        'Ghost endpoints found! CLI calls these but no server route exists:',
        '',
        ...ghosts.map(g => `  ${g}`),
        '',
        'Fix by either:',
        '  1. Implementing the missing route in routes/*.ts',
        '  2. Removing the dead CLI code that references it',
        '',
      ].join('\n');

      // fail() with a readable message
      expect(ghosts).toHaveLength(0);
      throw new Error(msg);
    }
  });

  it('DNS ghost regression guard', () => {
    // /dns/:id was a ghost endpoint — documented and CLI-wired but never implemented.
    // If someone adds CLI code calling /dns without a matching route, catch it.
    const dnsEndpoints = cliEndpoints.filter(ep => ep.path.startsWith('/dns'));
    for (const ep of dnsEndpoints) {
      expect(matchesRoute(ep, serverRoutes)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MCP Parity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clean a template literal path: strip trailing query string expressions,
 * replace embedded template expressions with :param.
 */
function cleanTemplatePath(rawPath) {
  // 1. Replace path-segment template expressions (preceded by /) with /:param
  //    e.g., /sessions/${id} → /sessions/:param
  //    e.g., /agents/${enc(id)}/heartbeat → /agents/:param/heartbeat
  rawPath = rawPath.replace(/\/\$\{[^}]+\}/g, '/:param');
  // 2. Strip remaining trailing template expressions (query string suffixes like ${qs})
  //    e.g., /services${qs} → /services
  rawPath = rawPath.replace(/\$\{[^}]*\}$/g, '');
  // 3. Replace any remaining embedded expressions with :param
  rawPath = rawPath.replace(/\$\{[^}]+\}/g, ':param');
  // 4. Strip query strings
  rawPath = rawPath.replace(/\?.*$/, '');
  // 5. Normalize slashes
  rawPath = rawPath.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
  return rawPath;
}

/**
 * Extract all HTTP calls from the MCP server's tool handler.
 *
 * Parses patterns like:
 *   res = await POST(`/agents/${encodeURIComponent(args.agent_id)}`, body);
 *   res = await GET('/health');
 *   res = await api('PUT', `/sessions/${...}/phase`, { ... });
 *
 * Returns array of { method, path, tool, line } objects.
 */
function extractMcpEndpoints() {
  const mcpPath = join(ROOT, 'mcp', 'server.ts');
  const content = readFileSync(mcpPath, 'utf-8');
  const lines = content.split('\n');
  const endpoints = [];

  // Track which tool case we're in
  let currentTool = 'unknown';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track case statements
    const caseMatch = line.match(/case\s+['"`](\w+)['"`]/);
    if (caseMatch) {
      currentTool = caseMatch[1];
    }

    // Match: await GET('/path') — static strings only (single/double quotes, NOT backticks)
    const helperMatch = line.match(/await\s+(GET|POST|PUT|DELETE)\s*\(\s*['"]([^'"]+)['"]\s*[,)]/);
    if (helperMatch) {
      const method = helperMatch[1];
      let rawPath = helperMatch[2];
      rawPath = rawPath.replace(/\?.*$/, '');
      rawPath = rawPath.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
      endpoints.push({ method, path: normalizePath(rawPath), tool: currentTool, line: i + 1 });
      continue;
    }

    // Match: await GET(`/path/${expr}`) or await GET(`/path${qs}`) — template literals
    const templateHelperMatch = line.match(/await\s+(GET|POST|PUT|DELETE)\s*\(\s*`([^`]+)`/);
    if (templateHelperMatch) {
      const method = templateHelperMatch[1];
      let rawPath = cleanTemplatePath(templateHelperMatch[2]);
      endpoints.push({ method, path: normalizePath(rawPath), tool: currentTool, line: i + 1 });
      continue;
    }

    // Match: await api('METHOD', `/path/${expr}`, body)
    const apiMatch = line.match(/await\s+api\s*\(\s*['"`](GET|POST|PUT|DELETE)['"`]\s*,\s*`([^`]+)`/);
    if (apiMatch) {
      const method = apiMatch[1];
      let rawPath = cleanTemplatePath(apiMatch[2]);
      endpoints.push({ method, path: normalizePath(rawPath), tool: currentTool, line: i + 1 });
      continue;
    }
  }

  return endpoints;
}

describe('Endpoint Parity: MCP calls server routes', () => {
  const mcpEndpoints = extractMcpEndpoints();
  const serverRoutes = extractServerRoutes();

  it('should find MCP endpoints to validate', () => {
    // MCP makes at least 30 HTTP calls across all tools
    expect(mcpEndpoints.length).toBeGreaterThan(25);
  });

  it('every MCP HTTP call should have a matching server route', () => {
    const ghosts = [];

    for (const ep of mcpEndpoints) {
      if (!matchesRoute(ep, serverRoutes)) {
        ghosts.push(`${ep.method} ${ep.path}  (mcp tool: ${ep.tool}, line ${ep.line})`);
      }
    }

    if (ghosts.length > 0) {
      const msg = [
        '',
        'MCP ghost endpoints found! MCP server calls these but no server route exists:',
        '',
        ...ghosts.map(g => `  ${g}`),
        '',
        'This means agents using the MCP server will get 404/405 errors.',
        'Fix by either:',
        '  1. Correcting the MCP route to match the actual server route',
        '  2. Implementing the missing route in routes/*.ts',
        '',
      ].join('\n');

      expect(ghosts).toHaveLength(0);
      throw new Error(msg);
    }
  });

  it('MCP register_agent should POST to /agents (not /agents/:id)', () => {
    const regEndpoints = mcpEndpoints.filter(ep => ep.tool === 'register_agent' && ep.method === 'POST');
    expect(regEndpoints.length).toBeGreaterThan(0);
    for (const ep of regEndpoints) {
      expect(ep.path).toBe('/agents');
    }
  });

  it('MCP agent_heartbeat should POST to /agents/:param/heartbeat', () => {
    const hbEndpoints = mcpEndpoints.filter(ep => ep.tool === 'agent_heartbeat');
    expect(hbEndpoints.length).toBeGreaterThan(0);
    for (const ep of hbEndpoints) {
      expect(ep.method).toBe('POST');
      expect(ep.path).toBe('/agents/:param/heartbeat');
    }
  });

  it('MCP check_salvage should GET from /resurrection/pending', () => {
    const salvageEndpoints = mcpEndpoints.filter(ep => ep.tool === 'check_salvage');
    expect(salvageEndpoints.length).toBeGreaterThan(0);
    for (const ep of salvageEndpoints) {
      expect(ep.path).toBe('/resurrection/pending');
    }
  });

  it('MCP claim_salvage should POST to /resurrection/claim/:param', () => {
    const claimEndpoints = mcpEndpoints.filter(ep => ep.tool === 'claim_salvage');
    expect(claimEndpoints.length).toBeGreaterThan(0);
    for (const ep of claimEndpoints) {
      expect(ep.method).toBe('POST');
      expect(ep.path).toBe('/resurrection/claim/:param');
    }
  });
});

describe('Endpoint Parity: SDK calls server routes', () => {
  it('SDK fetch calls should reference existing server routes', () => {
    const clientPath = join(ROOT, 'lib', 'client.ts');
    const content = readFileSync(clientPath, 'utf-8');
    const serverRoutes = extractServerRoutes();

    const sdkEndpoints = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match this.fetch('/path...' patterns
      const fetchMatch = line.match(/this\.fetch\s*\(\s*['"`]\/?([^'"`$]+)['"`]/);
      if (!fetchMatch) continue;

      let rawPath = '/' + fetchMatch[1];
      rawPath = rawPath.replace(/\?.*$/, '');
      rawPath = rawPath.replace(/\$\{[^}]+\}/g, ':param');
      rawPath = rawPath.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';

      let method = 'GET';
      const context = lines.slice(Math.max(0, i - 3), Math.min(i + 6, lines.length)).join(' ');
      const methodMatch = context.match(/method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
      if (methodMatch) {
        method = methodMatch[1].toUpperCase();
      }

      sdkEndpoints.push({
        method,
        path: normalizePath(rawPath),
        file: 'lib/client.ts',
        line: i + 1
      });
    }

    const ghosts = [];
    for (const ep of sdkEndpoints) {
      if (!matchesRoute(ep, serverRoutes)) {
        ghosts.push(`${ep.method} ${ep.path}  (${ep.file}:${ep.line})`);
      }
    }

    if (ghosts.length > 0) {
      throw new Error(
        'SDK ghost endpoints found:\n' +
        ghosts.map(g => `  ${g}`).join('\n')
      );
    }
  });
});
