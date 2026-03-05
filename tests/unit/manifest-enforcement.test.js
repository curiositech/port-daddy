/**
 * Manifest Enforcement Tests - Bidirectional parity enforcement
 *
 * These static-analysis tests ensure features.manifest.json is the SINGLE
 * SOURCE OF TRUTH for the Port Daddy codebase. They read source files and
 * verify bidirectional consistency:
 *
 *   Routes  <-->  Manifest
 *   CLI     <-->  Manifest
 *   MCP     <-->  Manifest
 *   Completions ->  Manifest (every manifest CLI command must appear in shells)
 *
 * If someone adds a route without updating the manifest, tests fail.
 * If someone adds a manifest entry without implementing the route, tests fail.
 *
 * NOTE: This test complements endpoint-parity.test.js which checks
 * CLI pdFetch calls --> server routes. This test checks manifest <--> everything.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Normalize a route path for comparison:
 * - Replace all :paramName with :param
 * - Remove regex constraints like (:id(\\d+))
 * - Remove trailing slashes
 */
function normalizePath(path) {
  return path
    .replace(/:[^/()]+(\([^)]*\))?/g, ':param')
    .replace(/\/+$/, '')
    || '/';
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

  // Also check server.ts for any directly registered routes
  try {
    const serverContent = readFileSync(join(ROOT, 'server.ts'), 'utf-8');
    let match;
    while ((match = routePattern.exec(serverContent)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: normalizePath(match[2]),
        file: 'server.ts'
      });
    }
  } catch {
    // server.ts might not exist in some test environments
  }

  return routes;
}

/**
 * Extract all manifest routes as a flat array of { method, path, feature }.
 * Manifest format: "METHOD /path" (e.g., "POST /claim")
 */
function extractManifestRoutes(manifest) {
  const routes = [];

  for (const [featureName, feature] of Object.entries(manifest.features)) {
    if (!feature.routes) continue;
    for (const routeStr of feature.routes) {
      const [method, ...pathParts] = routeStr.split(' ');
      const path = normalizePath(pathParts.join(' '));
      routes.push({ method: method.toUpperCase(), path, feature: featureName });
    }
  }

  return routes;
}

/**
 * Extract all CLI commands from the manifest.
 * Returns a flat array of { command, feature } objects.
 */
function extractManifestCliCommands(manifest) {
  const commands = [];
  for (const [featureName, feature] of Object.entries(manifest.features)) {
    if (!feature.cli) continue;
    for (const cmd of feature.cli) {
      commands.push({ command: cmd, feature: featureName });
    }
  }
  return commands;
}

/**
 * Extract completion commands from a bash completion file.
 * Looks for the commands array definition.
 */
function extractBashCompletionCommands(content) {
  // Match the commands=( ... ) array in bash.
  // The bash file uses:
  //   local commands=(
  //     # Service management (+ single-letter aliases)
  //     claim c release r ...
  //   )
  // We need to avoid matching the `)` inside comments (e.g. "single-letter aliases)").
  // Strategy: find the `commands=(` line, then scan forward to find the closing `)` on its own line.
  const lines = content.split('\n');
  let inArray = false;
  let arrayLines = [];

  for (const line of lines) {
    if (!inArray) {
      if (/(?:local\s+)?commands=\(/.test(line)) {
        inArray = true;
        // Capture anything after the opening `(` on the same line
        const afterParen = line.replace(/.*commands=\(\s*/, '').trim();
        if (afterParen && afterParen !== ')') {
          arrayLines.push(afterParen);
        }
      }
      continue;
    }

    // Check if this line is just `)` (the closing of the array)
    if (/^\s*\)\s*$/.test(line)) {
      break;
    }

    arrayLines.push(line);
  }

  // Extract individual words, ignoring comments
  const commands = [];
  for (const line of arrayLines) {
    const cleaned = line.replace(/#.*$/, '').trim();
    const words = cleaned.split(/\s+/).filter(w => w && !w.startsWith('#'));
    commands.push(...words);
  }
  return commands;
}

/**
 * Extract completion commands from a zsh completion file.
 * Looks for command descriptions in the commands array.
 */
function extractZshCompletionCommands(content) {
  const commands = [];

  // Match the commands=( ... ) array in zsh _port_daddy function
  // Pattern: 'commandname:description'
  const cmdPattern = /'([^:'"]+):[^']*'/g;
  let match;

  // Only look within the main commands array, not subcommand arrays
  const mainFuncMatch = content.match(/_port_daddy\(\)\s*\{[\s\S]*?^}/m);
  if (mainFuncMatch) {
    const mainContent = mainFuncMatch[0];
    while ((match = cmdPattern.exec(mainContent)) !== null) {
      commands.push(match[1]);
    }
  }

  return commands;
}

/**
 * Extract completion commands from a fish completion file.
 * Looks for command registrations.
 */
function extractFishCompletionCommands(content) {
  const commands = [];

  // Match: complete -c $prog -n __pd_needs_command -a <command>
  // Also match: complete -c port-daddy -n __pd_needs_command -a <command>
  const cmdPattern = /-n\s+__pd_needs_command\s+-a\s+(\S+)/g;
  let match;
  while ((match = cmdPattern.exec(content)) !== null) {
    // Remove quotes if present
    const cmd = match[1].replace(/^['"]|['"]$/g, '');
    commands.push(cmd);
  }

  return [...new Set(commands)]; // Deduplicate (pd and port-daddy registrations)
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
let serverRoutes;

beforeAll(() => {
  manifest = JSON.parse(readFileSync(join(ROOT, 'features.manifest.json'), 'utf-8'));
  serverRoutes = extractServerRoutes();
});

// ============================================================================
// Routes <--> Manifest
// ============================================================================

describe('Routes --> Manifest (no undocumented routes)', () => {
  it('should find server routes to validate', () => {
    expect(serverRoutes.length).toBeGreaterThan(30);
  });

  it('every server route must appear in the manifest', () => {
    const manifestRoutes = extractManifestRoutes(manifest);
    const undocumented = [];

    for (const route of serverRoutes) {
      const inManifest = manifestRoutes.some(mr =>
        mr.method === route.method && pathsMatch(mr.path, route.path)
      );

      if (!inManifest) {
        undocumented.push(`${route.method} ${route.path}  (${route.file})`);
      }
    }

    if (undocumented.length > 0) {
      const msg = [
        '',
        'UNDOCUMENTED ROUTES: These exist in code but NOT in features.manifest.json:',
        '',
        ...undocumented.map(u => `  ${u}`),
        '',
        'Fix by adding the route to the appropriate feature in features.manifest.json',
        'or creating a new feature entry for it.',
        '',
      ].join('\n');

      expect(undocumented).toEqual([]);
    }
  });
});

describe('Manifest --> Routes (no ghost routes)', () => {
  it('every manifest route must exist in server code', () => {
    const manifestRoutes = extractManifestRoutes(manifest);
    const ghosts = [];

    for (const mr of manifestRoutes) {
      const exists = serverRoutes.some(sr =>
        sr.method === mr.method && pathsMatch(sr.path, mr.path)
      );

      if (!exists) {
        ghosts.push(`${mr.method} ${mr.path}  (feature: "${mr.feature}")`);
      }
    }

    if (ghosts.length > 0) {
      const msg = [
        '',
        'GHOST ROUTES: These are declared in the manifest but NOT in server code:',
        '',
        ...ghosts.map(g => `  ${g}`),
        '',
        'Fix by either:',
        '  1. Implementing the route in routes/*.ts',
        '  2. Removing the ghost route from features.manifest.json',
        '',
      ].join('\n');

      expect(ghosts).toEqual([]);
    }
  });
});

// ============================================================================
// CLI <--> Manifest
// ============================================================================

describe('CLI --> Manifest (no undocumented CLI commands)', () => {
  it('every CLI command handler should map to a manifest feature', () => {
    // Read bin/port-daddy-cli.ts to find the command dispatch
    const cliContent = readFileSync(join(ROOT, 'bin', 'port-daddy-cli.ts'), 'utf-8');

    // Extract commands from the case statements in the main dispatch
    // Pattern: case 'commandname': or case 'cmd1': case 'cmd2':
    const casePattern = /case\s+['"`]([^'"`]+)['"`]\s*:/g;
    const cliCommands = new Set();
    let match;
    while ((match = casePattern.exec(cliContent)) !== null) {
      cliCommands.add(match[1]);
    }

    // Also extract from TIER_1_COMMANDS and TIER_2_COMMANDS sets
    const tierPattern = /new Set\(\[\s*([\s\S]*?)\]\)/g;
    while ((match = tierPattern.exec(cliContent)) !== null) {
      const tierContent = match[1];
      const stringPattern = /['"`]([^'"`]+)['"`]/g;
      let strMatch;
      while ((strMatch = stringPattern.exec(tierContent)) !== null) {
        cliCommands.add(strMatch[1]);
      }
    }

    // Build manifest command set
    const manifestCommands = new Set();
    for (const feature of Object.values(manifest.features)) {
      if (feature.cli) {
        for (const cmd of feature.cli) {
          manifestCommands.add(cmd);
        }
      }
    }

    // Known non-feature commands that exist in CLI but are meta-commands,
    // or are subcommands of a parent command (e.g. 'session end', 'session abandon').
    // Subcommands are handled by their parent case statement and don't need
    // independent manifest entries.
    const metaCommands = new Set([
      'help', 'version', '--help', '-h', '--version', '-V', '--json', '-j', '--quiet', '-q',
      // Short flag characters (from shortFlags map, not commands)
      'p', 'e', 'P', 'n', 'c', 'm', 'd', 't', 'i', 'a', 's', 'o', 'f',
      // Session subcommands: handled inside `case 'session':` dispatch
      'start', 'end', 'done', 'abandon', 'rm',
      // Ports subcommands: 'cleanup' is handled inside `case 'ports':`
      'ports cleanup', 'cleanup',
      // Agent subcommands: handled inside `case 'agent':`
      'register', 'heartbeat', 'unregister',
      // Salvage subcommands
      'claim', 'complete', 'dismiss',
      // Activity subcommands
      'summary', 'stats',
      // Tunnel subcommands
      'stop', 'status', 'providers',
      // URL subcommands
      'set', 'remove', 'ls',
      // Changelog subcommands
      'add', 'show', 'tree', 'export', 'identities',
      // Webhook subcommands
      'events', 'test', 'update', 'deliveries', 'delete',
      // Channel subcommands
      'clear',
      // Files subcommands
      'add',
      // Projects subcommands
      // 'rm' already listed above
    ]);

    const undocumented = [];
    for (const cmd of cliCommands) {
      if (metaCommands.has(cmd)) continue;
      if (!manifestCommands.has(cmd)) {
        undocumented.push(cmd);
      }
    }

    if (undocumented.length > 0) {
      const msg = [
        '',
        'UNDOCUMENTED CLI COMMANDS: These exist in CLI but NOT in features.manifest.json:',
        '',
        ...undocumented.map(u => `  "${u}"`),
        '',
        'Fix by adding the command to the appropriate feature\'s "cli" array in features.manifest.json',
        '',
      ].join('\n');

      expect(undocumented).toEqual([]);
    }
  });
});

describe('Manifest --> CLI (no ghost CLI commands)', () => {
  it('every manifest CLI command should be wired in the CLI', () => {
    // Read bin/port-daddy-cli.ts
    const cliContent = readFileSync(join(ROOT, 'bin', 'port-daddy-cli.ts'), 'utf-8');

    // Build set of all commands mentioned anywhere in the CLI
    // This catches both case statements and tier definitions
    const stringPattern = /['"`]([a-zA-Z][\w-]*)['"`]/g;
    const allCliStrings = new Set();
    let match;
    while ((match = stringPattern.exec(cliContent)) !== null) {
      allCliStrings.add(match[1]);
    }

    const manifestCommands = extractManifestCliCommands(manifest);
    const ghosts = [];

    for (const { command, feature } of manifestCommands) {
      if (!allCliStrings.has(command)) {
        ghosts.push(`"${command}"  (feature: "${feature}")`);
      }
    }

    if (ghosts.length > 0) {
      const msg = [
        '',
        'GHOST CLI COMMANDS: These are in the manifest but NOT wired in the CLI:',
        '',
        ...ghosts.map(g => `  ${g}`),
        '',
        'Fix by either:',
        '  1. Wiring the command in bin/port-daddy-cli.ts',
        '  2. Removing the ghost command from features.manifest.json',
        '',
      ].join('\n');

      expect(ghosts).toEqual([]);
    }
  });
});

// ============================================================================
// MCP --> Manifest
// ============================================================================

describe('MCP --> Manifest (every MCP tool maps to a feature)', () => {
  let mcpTools;

  beforeAll(() => {
    const mcpContent = readFileSync(join(ROOT, 'mcp', 'server.ts'), 'utf-8');
    // Extract tool names from the TOOLS array only (not from resources or server config).
    // The TOOLS array ends with the closing '];' before the handleTool function.
    const toolsSectionMatch = mcpContent.match(/const TOOLS\s*=\s*\[([\s\S]*?)\n\];/);
    const toolsSection = toolsSectionMatch ? toolsSectionMatch[1] : '';
    const toolPattern = /name:\s*['"`]([^'"`]+)['"`]/g;
    mcpTools = [];
    let match;
    while ((match = toolPattern.exec(toolsSection)) !== null) {
      mcpTools.push(match[1]);
    }
  });

  it('should find MCP tools to validate', () => {
    expect(mcpTools.length).toBeGreaterThan(15);
  });

  it('every MCP tool should map to a manifest feature', () => {
    // Build a mapping from MCP tool keywords to manifest feature names
    const featureNames = Object.keys(manifest.features);

    // Mapping from MCP tool name -> expected feature
    const toolFeatureMap = {
      'claim_port': 'claim',
      'release_port': 'release',
      'list_services': 'services',
      'get_service': 'services',
      'health_check': 'health',
      'start_session': 'sessions',
      'end_session': 'sessions',
      'add_note': 'notes',
      'list_sessions': 'sessions',
      'list_notes': 'notes',
      'claim_files': 'sessions',
      'acquire_lock': 'locks',
      'release_lock': 'locks',
      'list_locks': 'locks',
      'publish_message': 'messaging',
      'get_messages': 'messaging',
      'register_agent': 'agents',
      'agent_heartbeat': 'agents',
      'list_agents': 'agents',
      'check_salvage': 'salvage',
      'claim_salvage': 'salvage',
      'start_tunnel': 'tunnel',
      'stop_tunnel': 'tunnel',
      'list_tunnels': 'tunnel',
      'scan_project': 'scan',
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

    const unmapped = [];
    for (const tool of mcpTools) {
      const expectedFeature = toolFeatureMap[tool];
      if (!expectedFeature) {
        unmapped.push(`"${tool}" -- no mapping defined in test (add to toolFeatureMap)`);
        continue;
      }
      if (!featureNames.includes(expectedFeature)) {
        unmapped.push(`"${tool}" maps to feature "${expectedFeature}" which does not exist in manifest`);
      }
    }

    if (unmapped.length > 0) {
      const msg = [
        '',
        'ORPHAN MCP TOOLS: These tools cannot be mapped to a manifest feature:',
        '',
        ...unmapped.map(u => `  ${u}`),
        '',
      ].join('\n');

      expect(unmapped).toEqual([]);
    }
  });
});

// ============================================================================
// Completions --> Manifest (every manifest CLI command in all 3 shells)
// ============================================================================

describe('Completions parity: manifest CLI commands in all three shells', () => {
  let bashCommands;
  let zshCommands;
  let fishCommands;
  let manifestCliCommands;

  beforeAll(() => {
    const bashContent = readFileSync(join(ROOT, 'completions', 'port-daddy.bash'), 'utf-8');
    const zshContent = readFileSync(join(ROOT, 'completions', 'port-daddy.zsh'), 'utf-8');
    const fishContent = readFileSync(join(ROOT, 'completions', 'port-daddy.fish'), 'utf-8');

    bashCommands = extractBashCompletionCommands(bashContent);
    zshCommands = extractZshCompletionCommands(zshContent);
    fishCommands = extractFishCompletionCommands(fishContent);
    manifestCliCommands = extractManifestCliCommands(manifest);
  });

  it('should find completion commands in all three shells', () => {
    expect(bashCommands.length).toBeGreaterThan(20);
    expect(zshCommands.length).toBeGreaterThan(20);
    expect(fishCommands.length).toBeGreaterThan(20);
  });

  it('every manifest CLI command should appear in bash completions', () => {
    const missing = [];
    for (const { command, feature } of manifestCliCommands) {
      if (!bashCommands.includes(command)) {
        missing.push(`"${command}"  (feature: "${feature}")`);
      }
    }

    if (missing.length > 0) {
      expect(missing).toEqual([]);
    }
  });

  it('every manifest CLI command should appear in zsh completions', () => {
    const missing = [];
    for (const { command, feature } of manifestCliCommands) {
      if (!zshCommands.includes(command)) {
        missing.push(`"${command}"  (feature: "${feature}")`);
      }
    }

    if (missing.length > 0) {
      expect(missing).toEqual([]);
    }
  });

  it('every manifest CLI command should appear in fish completions', () => {
    const missing = [];
    for (const { command, feature } of manifestCliCommands) {
      if (!fishCommands.includes(command)) {
        missing.push(`"${command}"  (feature: "${feature}")`);
      }
    }

    if (missing.length > 0) {
      expect(missing).toEqual([]);
    }
  });
});

// ============================================================================
// Manifest self-consistency checks
// ============================================================================

describe('Manifest self-consistency', () => {
  it('every feature should have a non-empty description', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!feature.description || typeof feature.description !== 'string' || feature.description.trim() === '') {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every feature should have a cli array', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!Array.isArray(feature.cli)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every feature should have a routes array', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!Array.isArray(feature.routes)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every feature should have a completions array', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!Array.isArray(feature.completions)) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every feature with routes should have at least one route', () => {
    const features = Object.entries(manifest.features).filter(
      ([, f]) => f.routes && f.routes.length > 0
    );
    // At least 15 features should have routes
    expect(features.length).toBeGreaterThan(14);
  });

  it('manifest route format should be "METHOD /path"', () => {
    const invalid = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!feature.routes) continue;
      for (const route of feature.routes) {
        if (!/^(GET|POST|PUT|DELETE|PATCH)\s+\//.test(route)) {
          invalid.push(`${name}: "${route}"`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('no duplicate routes across features', () => {
    const seen = new Map(); // "METHOD /path" -> feature name
    const duplicates = [];

    for (const [featureName, feature] of Object.entries(manifest.features)) {
      if (!feature.routes) continue;
      for (const routeStr of feature.routes) {
        const [method, ...pathParts] = routeStr.split(' ');
        const normalized = `${method.toUpperCase()} ${normalizePath(pathParts.join(' '))}`;

        if (seen.has(normalized)) {
          duplicates.push(`${normalized} -- in both "${seen.get(normalized)}" and "${featureName}"`);
        } else {
          seen.set(normalized, featureName);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('no duplicate CLI commands across features', () => {
    const seen = new Map(); // command -> feature name
    const duplicates = [];

    for (const [featureName, feature] of Object.entries(manifest.features)) {
      if (!feature.cli) continue;
      for (const cmd of feature.cli) {
        if (seen.has(cmd)) {
          duplicates.push(`"${cmd}" -- in both "${seen.get(cmd)}" and "${featureName}"`);
        } else {
          seen.set(cmd, featureName);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

// ============================================================================
// Route count sanity check
// ============================================================================

describe('Route coverage sanity checks', () => {
  it('manifest should cover a minimum number of routes', () => {
    const manifestRoutes = extractManifestRoutes(manifest);
    // We know there are 40+ routes in the codebase
    expect(manifestRoutes.length).toBeGreaterThan(35);
  });

  it('server should have a minimum number of routes', () => {
    expect(serverRoutes.length).toBeGreaterThan(35);
  });

  it('manifest route count should be close to server route count', () => {
    const manifestRoutes = extractManifestRoutes(manifest);
    // Allow some margin because the manifest may combine or alias routes,
    // but they should not diverge by more than 30%
    const ratio = manifestRoutes.length / serverRoutes.length;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });
});
