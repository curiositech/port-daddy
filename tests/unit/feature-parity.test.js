/**
 * Feature Parity Enforcement Tests
 *
 * Reads features.manifest.json and verifies every declared surface ACTUALLY
 * exists in the corresponding source file. This is the "launch blocker" —
 * if you add a feature to the manifest, it MUST have all surfaces wired up
 * before the test suite will pass.
 *
 * Unlike bijective-parity.test.js (which checks CLI↔completions↔routes),
 * this test validates the MANIFEST CONTRACT: what you declared vs what exists.
 *
 * Philosophy: The manifest is the promise. The source files are the proof.
 * This test enforces the promise.
 *
 * Run with: NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/feature-parity.test.js --no-coverage
 */

import { describe, it, test, expect } from '@jest/globals';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ==========================================================================
// Source file cache — read once, share across tests
// ==========================================================================

function readSource(relativePath) {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf8');
}

// Read all source files eagerly (synchronous reads, needed at describe-time for test.each)
const manifest = JSON.parse(readSource('features.manifest.json'));
const cliSource = readSource('bin/port-daddy-cli.ts');
const sdkSource = readSource('lib/client.ts');
const routesIndex = readSource('routes/index.ts');
const bashCompletions = readSource('completions/port-daddy.bash');
const zshCompletions = readSource('completions/port-daddy.zsh');
const fishCompletions = readSource('completions/port-daddy.fish');
const readmeContent = readSource('README.md');
const sdkDocsContent = readSource('docs/sdk.md');

// Combine all route source files for pattern matching
const routeSources = [];
for (const f of ['routes/index.ts', 'server.ts']) {
  const content = readSource(f);
  if (content) routeSources.push(content);
}
const routeDir = join(ROOT, 'routes');
if (existsSync(routeDir)) {
  for (const f of readdirSync(routeDir)) {
    if (f.endsWith('.ts') || f.endsWith('.js')) {
      const content = readSource(`routes/${f}`);
      if (content) routeSources.push(content);
    }
  }
}
const allRouteSource = routeSources.join('\n');

// ==========================================================================
// Helpers
// ==========================================================================

/**
 * Extract ALL_COMMANDS array from CLI source (canonical command list).
 */
function extractCLICommands() {
  const match = cliSource.match(
    /const ALL_COMMANDS\s*(?::\s*string\[\])?\s*=\s*\[([\s\S]*?)\]/
  );
  if (!match) return [];
  return match[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
}

// ==========================================================================
// Test Group 1: Manifest Structure Validation
// ==========================================================================

describe('Manifest Structure', () => {
  it('features.manifest.json exists and parses', () => {
    expect(manifest).not.toBeNull();
    expect(manifest.features).toBeDefined();
    expect(typeof manifest.features).toBe('object');
  });

  it('every feature has required surface declarations', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      const requiredKeys = ['description', 'cli', 'sdk', 'routes', 'completions', 'docs'];
      for (const key of requiredKeys) {
        if (!(key in feature)) {
          missing.push(`${name} missing "${key}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('cli, sdk, routes, completions are arrays', () => {
    const violations = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (!Array.isArray(feature.cli)) violations.push(`${name}.cli is not an array`);
      if (!Array.isArray(feature.sdk)) violations.push(`${name}.sdk is not an array`);
      if (!Array.isArray(feature.routes)) violations.push(`${name}.routes is not an array`);
      if (!Array.isArray(feature.completions)) violations.push(`${name}.completions is not an array`);
    }
    expect(violations).toEqual([]);
  });

  it('docs has readme and sdk boolean fields', () => {
    const violations = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      if (typeof feature.docs !== 'object') {
        violations.push(`${name}.docs is not an object`);
        continue;
      }
      if (typeof feature.docs.readme !== 'boolean') {
        violations.push(`${name}.docs.readme is not a boolean`);
      }
      if (typeof feature.docs.sdk !== 'boolean') {
        violations.push(`${name}.docs.sdk is not a boolean`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ==========================================================================
// Test Group 2: CLI Parity — manifest.cli[] ⊆ ALL_COMMANDS
// ==========================================================================

describe('CLI Parity (manifest → source)', () => {
  const cliCommands = new Set(extractCLICommands());

  // Build test cases: for each feature with cli declarations, verify each command exists
  const cliTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    for (const cmd of feature.cli || []) {
      cliTestCases.push({ feature: name, command: cmd });
    }
  }

  if (cliTestCases.length > 0) {
    test.each(cliTestCases)(
      'feature "$feature" CLI command "$command" exists in ALL_COMMANDS',
      ({ command }) => {
        expect(cliCommands.has(command)).toBe(true);
      }
    );
  }

  it('has at least 30 CLI test cases from manifest', () => {
    expect(cliTestCases.length).toBeGreaterThanOrEqual(30);
  });
});

// ==========================================================================
// Test Group 3: SDK Parity — manifest.sdk[] ⊆ SDK methods
// ==========================================================================

describe('SDK Parity (manifest → source)', () => {
  const sdkTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    for (const method of feature.sdk || []) {
      sdkTestCases.push({ feature: name, method });
    }
  }

  if (sdkTestCases.length > 0) {
    test.each(sdkTestCases)(
      'feature "$feature" SDK method "$method" exists in lib/client.ts',
      ({ method }) => {
        // Check if the method exists as a method definition (async or sync, with optional generics)
        const asyncRegex = new RegExp(`async\\s+${method}\\s*[<(]`);
        const syncRegex = new RegExp(`\\b${method}\\s*[<(].*[):].*(Subscription|HeartbeatHandle|void)`, 's');
        const methodExists = asyncRegex.test(sdkSource) || syncRegex.test(sdkSource);
        expect(methodExists).toBe(true);
      }
    );
  }

  it('has at least 30 SDK test cases from manifest', () => {
    expect(sdkTestCases.length).toBeGreaterThanOrEqual(30);
  });
});

// ==========================================================================
// Test Group 4: Route Parity — manifest.routes[] appear in route files
// ==========================================================================

describe('Route Parity (manifest → source)', () => {
  const routeTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    for (const route of feature.routes || []) {
      routeTestCases.push({ feature: name, route });
    }
  }

  if (routeTestCases.length > 0) {
    test.each(routeTestCases)(
      'feature "$feature" route "$route" is registered in route source',
      ({ route }) => {
        // Parse "POST /sugar/begin" → method=post, path=/sugar/begin
        const match = route.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)/);
        expect(match).not.toBeNull();
        const [, method, path] = match;

        // Replace :param with a flexible regex
        const pathRegex = path
          .replace(/:[^/]+/g, '[^/]+')  // :param → [^/]+
          .replace(/\//g, '\\/');        // / → \/

        // Check that the method+path appears in route source
        // Route files use: router.get('/path', ...) or app.post('/path', ...)
        const quote = "['\"\\x60]"; // match single, double, or backtick
        const routePattern = new RegExp(
          '\\.' + method.toLowerCase() + '\\s*\\(\\s*' + quote + '/?' + pathRegex.replace(/^\\\//, '') + quote,
          'i'
        );

        // Also check for the path string anywhere in the route sources
        // (some routes are defined with string templates or variables)
        const pathExists = routePattern.test(allRouteSource) ||
          allRouteSource.includes(path) ||
          allRouteSource.includes(path.replace(/:[^/]+/g, ':'));

        expect(pathExists).toBe(true);
      }
    );
  }

  it('has at least 40 route test cases from manifest', () => {
    expect(routeTestCases.length).toBeGreaterThanOrEqual(40);
  });
});

// ==========================================================================
// Test Group 5: Completions Parity — manifest.completions[] ⊆ all 3 shells
// ==========================================================================

describe('Completions Parity (manifest → shells)', () => {
  const completionTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    for (const cmd of feature.completions || []) {
      completionTestCases.push({ feature: name, command: cmd });
    }
  }

  if (completionTestCases.length > 0) {
    describe('Bash completions', () => {
      test.each(completionTestCases)(
        'feature "$feature" completion "$command" exists in bash',
        ({ command }) => {
          expect(bashCompletions).toContain(command);
        }
      );
    });

    describe('Zsh completions', () => {
      test.each(completionTestCases)(
        'feature "$feature" completion "$command" exists in zsh',
        ({ command }) => {
          expect(zshCompletions).toContain(command);
        }
      );
    });

    describe('Fish completions', () => {
      test.each(completionTestCases)(
        'feature "$feature" completion "$command" exists in fish',
        ({ command }) => {
          expect(fishCompletions).toContain(command);
        }
      );
    });
  }

  it('has at least 30 completion test cases from manifest', () => {
    expect(completionTestCases.length).toBeGreaterThanOrEqual(30);
  });
});

// ==========================================================================
// Test Group 6: README Parity — features with docs.readme=true
// ==========================================================================

describe('README Parity (manifest → docs)', () => {
  const readmeTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    if (feature.docs?.readme === true) {
      readmeTestCases.push({
        feature: name,
        description: feature.description,
        cliCommands: feature.cli || [],
      });
    }
  }

  if (readmeTestCases.length > 0) {
    test.each(readmeTestCases)(
      'feature "$feature" (docs.readme=true) is mentioned in README.md',
      ({ feature, cliCommands }) => {
        // The feature name OR at least one of its CLI commands must appear in README
        const featureMentioned = readmeContent.toLowerCase().includes(feature.toLowerCase());
        const anyCmdMentioned = cliCommands.some(cmd =>
          readmeContent.includes(`pd ${cmd}`) || readmeContent.includes(cmd)
        );
        expect(featureMentioned || anyCmdMentioned).toBe(true);
      }
    );
  }

  it('has at least 15 features requiring README docs', () => {
    expect(readmeTestCases.length).toBeGreaterThanOrEqual(15);
  });
});

// ==========================================================================
// Test Group 7: SDK Docs Parity — features with docs.sdk=true
// ==========================================================================

describe('SDK Docs Parity (manifest → docs/sdk.md)', () => {
  const sdkDocsTestCases = [];
  for (const [name, feature] of Object.entries(manifest?.features || {})) {
    if (feature.docs?.sdk === true && (feature.sdk || []).length > 0) {
      sdkDocsTestCases.push({
        feature: name,
        methods: feature.sdk,
      });
    }
  }

  if (sdkDocsTestCases.length > 0) {
    test.each(sdkDocsTestCases)(
      'feature "$feature" (docs.sdk=true) has at least one SDK method in docs/sdk.md',
      ({ methods }) => {
        if (!sdkDocsContent) {
          expect(sdkDocsContent).not.toBeNull();
          return;
        }
        const anyMentioned = methods.some(method => sdkDocsContent.includes(method));
        expect(anyMentioned).toBe(true);
      }
    );
  }
});

// ==========================================================================
// Test Group 8: Manifest Completeness — every route module has a manifest entry
// ==========================================================================

describe('Manifest Completeness', () => {
  it('every createXxxRoutes() call in routes/index.ts maps to a manifest feature', () => {
    const routeModuleMatches = routesIndex.matchAll(/create(\w+)Routes/g);
    const routeModules = [...routeModuleMatches].map(m => m[1].toLowerCase());

    // Map route module names to manifest feature names
    const ROUTE_MODULE_TO_FEATURE = {
      services: 'services',
      messaging: 'messaging',
      locks: 'locks',
      agents: 'agents',
      health: 'health',
      activity: 'activity',
      webhooks: 'webhooks',
      config: 'system',
      projects: 'projects',
      sessions: 'sessions',
      info: 'system',
      resurrection: 'salvage',
      changelog: 'changelog',
      tunnel: 'tunnel',
      dns: 'dns',
      briefing: 'briefing',
      sugar: 'sugar',
      launchhints: 'launch_hints',
      spawn: 'spawn',
      harbors: 'harbors',
    };

    const unmapped = routeModules.filter(mod => {
      const featureName = ROUTE_MODULE_TO_FEATURE[mod];
      if (!featureName) return true;
      return !manifest.features[featureName];
    });

    expect(unmapped).toEqual([]);
  });

  it('manifest feature count reflects current feature scope', () => {
    const featureCount = Object.keys(manifest.features).length;
    // Port Daddy has 25+ features as of v3.7
    expect(featureCount).toBeGreaterThanOrEqual(25);
  });
});

// ==========================================================================
// Test Group 9: CLI ↔ Completions Consistency (manifest-driven)
// ==========================================================================

describe('CLI ↔ Completions Consistency (manifest-driven)', () => {
  it('every manifest CLI command that has a completion also has the CLI wired', () => {
    const inconsistencies = [];

    for (const [name, feature] of Object.entries(manifest.features)) {
      for (const cmd of feature.completions || []) {
        if (!feature.cli.includes(cmd)) {
          inconsistencies.push(`${name}: "${cmd}" in completions but not in cli`);
        }
      }
    }

    expect(inconsistencies).toEqual([]);
  });

  it('every multi-char manifest CLI command has a matching completion entry', () => {
    const mismatches = [];
    for (const [name, feature] of Object.entries(manifest.features)) {
      for (const cmd of feature.cli || []) {
        // Single-letter aliases (b, c, f, l, n, p, r, s, u, d, w) may be omitted from completions
        if (cmd.length <= 1) continue;
        if (!feature.completions.includes(cmd)) {
          mismatches.push(`${name}: CLI "${cmd}" missing from completions`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

// ==========================================================================
// Test Group 10: Surface Count Summary
// ==========================================================================

describe('Surface Count Summary', () => {
  it('total manifest-declared CLI commands >= 50', () => {
    let count = 0;
    for (const feature of Object.values(manifest.features)) {
      count += (feature.cli || []).length;
    }
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('total manifest-declared SDK methods >= 40', () => {
    let count = 0;
    for (const feature of Object.values(manifest.features)) {
      count += (feature.sdk || []).length;
    }
    expect(count).toBeGreaterThanOrEqual(40);
  });

  it('total manifest-declared routes >= 50', () => {
    let count = 0;
    for (const feature of Object.values(manifest.features)) {
      count += (feature.routes || []).length;
    }
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('total manifest-declared completion commands >= 40', () => {
    let count = 0;
    for (const feature of Object.values(manifest.features)) {
      count += (feature.completions || []).length;
    }
    expect(count).toBeGreaterThanOrEqual(40);
  });
});
