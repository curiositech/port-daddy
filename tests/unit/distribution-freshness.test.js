/**
 * Distribution Freshness Tests - Multi-surface drift detection
 *
 * Port Daddy is distributed across multiple surfaces. Each teaches agents and
 * users how to use the tool. If any surface drifts behind, users get outdated
 * instructions and the product looks amateur.
 *
 * Surfaces checked:
 *   1. package.json          — npm version (source of truth)
 *   2. mcp/server.ts         — MCP server version + instructions
 *   3. .claude-plugin/plugin.json — Claude plugin version
 *   4. mcp-server.json       — Static MCP discovery manifest
 *   5. skills/port-daddy-cli/SKILL.md — Distributed agentic skill
 *   6. skills/.../references/ — API reference, SDK reference
 *   7. README.md             — npm README
 *
 * Philosophy: Tests should YELL when you ship a version bump without updating
 * all surfaces. Better to fail CI than to ship stale docs.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

// ============================================================================
// Helpers
// ============================================================================

function readFile(relativePath) {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

function readJSON(relativePath) {
  const content = readFile(relativePath);
  if (!content) return null;
  return JSON.parse(content);
}

// ============================================================================
// Source of truth
// ============================================================================

let pkgVersion;
let mcpServerSource;
let pluginJson;
let mcpManifest;
let skillContent;
let apiReference;
let sdkReference;
let readmeContent;
let featuresManifest;
let dashboardContent;

beforeAll(() => {
  pkgVersion = readJSON('package.json')?.version;
  mcpServerSource = readFile('mcp/server.ts');
  pluginJson = readJSON('.claude-plugin/plugin.json');
  mcpManifest = readJSON('mcp-server.json');
  skillContent = readFile('skills/port-daddy-cli/SKILL.md');
  dashboardContent = readFile('public/index.html');
  apiReference = readFile('skills/port-daddy-cli/references/api-reference.md');
  sdkReference = readFile('skills/port-daddy-cli/references/sdk-reference.md');
  readmeContent = readFile('README.md');
  featuresManifest = readJSON('features.manifest.json');
});

// ============================================================================
// 1. Version consistency — all surfaces must match package.json
// ============================================================================

describe('Version consistency', () => {
  it('package.json version is semver', () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('MCP server version matches package.json', () => {
    // Extracts version from: { name: 'port-daddy', version: 'X.Y.Z' }
    const match = mcpServerSource.match(/version:\s*['"](\d+\.\d+\.\d+)['"]/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe(pkgVersion);
  });

  it('.claude-plugin/plugin.json version matches package.json', () => {
    expect(pluginJson).not.toBeNull();
    expect(pluginJson.version).toBe(pkgVersion);
  });

  it('mcp-server.json version matches package.json', () => {
    expect(mcpManifest).not.toBeNull();
    expect(mcpManifest.version).toBe(pkgVersion);
  });
});

// ============================================================================
// 2. MCP server has instructions — agents need workflow guidance
// ============================================================================

describe('MCP server instructions', () => {
  it('MCP server constructor includes instructions field', () => {
    expect(mcpServerSource).toMatch(/instructions\s*:/);
  });

  it('instructions mention begin_session as recommended workflow', () => {
    // The instructions should guide agents toward sugar commands
    expect(mcpServerSource).toMatch(/begin_session/);
    expect(mcpServerSource).toMatch(/end_session_full/);
  });

  it('instructions mention key concepts (identities, salvage, file claims)', () => {
    // Instructions should teach the core workflow, not just list tools
    const instructionsMatch = mcpServerSource.match(/instructions:\s*\[[\s\S]*?\]\.join/);
    expect(instructionsMatch).not.toBeNull();
    const instructionsBlock = instructionsMatch[0];
    expect(instructionsBlock).toMatch(/identity|identities/i);
    expect(instructionsBlock).toMatch(/salvage|resurrection/i);
    expect(instructionsBlock).toMatch(/file.*claim|claim.*file/i);
  });
});

// ============================================================================
// 3. Distributed skill (SKILL.md) — must teach current workflow
// ============================================================================

describe('Distributed skill freshness', () => {
  it('SKILL.md exists', () => {
    expect(skillContent).not.toBeNull();
  });

  it('SKILL.md has frontmatter with name and description', () => {
    expect(skillContent).toMatch(/^---\nname:\s*\S+/);
    expect(skillContent).toMatch(/description:\s*.+/);
  });

  // ── Sugar commands are the primary workflow ──────────────────────────
  it('SKILL.md teaches sugar commands (pd begin / pd done)', () => {
    expect(skillContent).toMatch(/pd begin/);
    expect(skillContent).toMatch(/pd done/);
  });

  it('SKILL.md teaches pd whoami', () => {
    expect(skillContent).toMatch(/pd whoami/);
  });

  it('SKILL.md teaches pd with-lock', () => {
    expect(skillContent).toMatch(/pd with-lock|with-lock/);
  });

  // ── Key features from manifest must appear in skill ──────────────────
  it('SKILL.md mentions salvage workflow', () => {
    expect(skillContent).toMatch(/salvage/i);
  });

  it('SKILL.md mentions file ownership checking', () => {
    expect(skillContent).toMatch(/who-owns|who_owns|file.*claim/i);
  });

  it('SKILL.md mentions semantic identity format', () => {
    expect(skillContent).toMatch(/project:stack:context/);
  });

  it('SKILL.md mentions port claiming', () => {
    expect(skillContent).toMatch(/pd claim/);
  });

  // ── v3.4+ features must be present ────────────────────────────────
  it('SKILL.md mentions DNS records', () => {
    expect(skillContent).toMatch(/dns/i);
  });

  it('SKILL.md mentions integration signals', () => {
    expect(skillContent).toMatch(/integration.*ready|integration.*needs/i);
  });

  it('SKILL.md mentions briefing', () => {
    expect(skillContent).toMatch(/briefing/i);
  });

  // ── Anti-patterns: skill must NOT use outdated patterns ─────────────
  it('SKILL.md does NOT teach the old 3-command ceremony as primary', () => {
    // The old ceremony: register + session start + session end separately
    // It's fine if these appear as "manual API" fallback, but "pd begin"
    // should appear BEFORE any manual registration commands
    const beginIndex = skillContent.indexOf('pd begin');
    const registerIndex = skillContent.indexOf('pd agent register');
    if (registerIndex !== -1) {
      expect(beginIndex).toBeLessThan(registerIndex);
    }
  });
});

// ============================================================================
// 4. Skill reference files — must cover sugar endpoints/methods
// ============================================================================

describe('Skill API reference freshness', () => {
  it('API reference exists', () => {
    expect(apiReference).not.toBeNull();
  });

  it('API reference documents sugar endpoints', () => {
    expect(apiReference).toMatch(/POST \/sugar\/begin/);
    expect(apiReference).toMatch(/POST \/sugar\/done/);
    expect(apiReference).toMatch(/GET \/sugar\/whoami/);
  });

  it('API reference documents DNS endpoints', () => {
    expect(apiReference).toMatch(/dns/i);
  });

  it('API reference uses correct HTTP methods (POST /claim, not POST /claim/:id)', () => {
    // v3.4 changed: id goes in body, not URL
    expect(apiReference).toMatch(/POST \/claim\b/);
    expect(apiReference).toMatch(/DELETE \/release\b/);
    // Should NOT have old pattern
    expect(apiReference).not.toMatch(/POST \/claim\/:/);
  });

  it('API reference documents agent heartbeat as POST (not PUT)', () => {
    expect(apiReference).toMatch(/POST \/agents\/:.*\/heartbeat/);
  });
});

describe('Skill SDK reference freshness', () => {
  it('SDK reference exists', () => {
    expect(sdkReference).not.toBeNull();
  });

  it('SDK reference documents sugar methods (begin, done, whoami)', () => {
    expect(sdkReference).toMatch(/pd\.begin/);
    expect(sdkReference).toMatch(/pd\.done/);
    expect(sdkReference).toMatch(/pd\.whoami/);
  });
});

// ============================================================================
// 5. Claude plugin manifest — structural checks
// ============================================================================

describe('Claude plugin manifest', () => {
  it('plugin.json exists with required fields', () => {
    expect(pluginJson).not.toBeNull();
    expect(pluginJson.name).toBe('port-daddy');
    expect(pluginJson.skills).toContain('port-daddy-cli');
  });

  it('marketplace.json exists and references plugin', () => {
    const marketplace = readJSON('.claude-plugin/marketplace.json');
    expect(marketplace).not.toBeNull();
    expect(marketplace.plugins).toBeInstanceOf(Array);
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 6. MCP manifest (mcp-server.json) — discovery metadata
// ============================================================================

describe('MCP server manifest', () => {
  it('mcp-server.json exists with correct name', () => {
    expect(mcpManifest).not.toBeNull();
    expect(mcpManifest.name).toBe('port-daddy');
  });

  it('mcp-server.json has transport config', () => {
    expect(mcpManifest.transport).toBeDefined();
    expect(mcpManifest.transport.type).toBe('stdio');
  });
});

// ============================================================================
// 7. package.json files array — everything that ships must be listed
// ============================================================================

describe('npm package includes distribution files', () => {
  it('package.json files array includes skills/', () => {
    const pkg = readJSON('package.json');
    expect(pkg.files).toContain('skills/');
  });

  it('package.json files array includes .claude-plugin/', () => {
    const pkg = readJSON('package.json');
    expect(pkg.files).toContain('.claude-plugin/');
  });

  it('package.json files array includes mcp/', () => {
    const pkg = readJSON('package.json');
    expect(pkg.files).toContain('mcp/');
  });

  it('package.json files array includes completions/', () => {
    const pkg = readJSON('package.json');
    expect(pkg.files).toContain('completions/');
  });
});

// ============================================================================
// 8. Cross-surface feature coverage — features in manifest should appear
//    across distribution surfaces
// ============================================================================

describe('Cross-surface feature coverage', () => {
  // Features that MUST appear in the distributed skill
  const SKILL_REQUIRED_FEATURES = [
    'claim',     // port claiming is core
    'sessions',  // session management
    'locks',     // distributed locks
    'salvage',   // agent resurrection
    'sugar',     // compound commands (v3.5+)
  ];

  it.each(SKILL_REQUIRED_FEATURES)(
    'feature "%s" from manifest is taught in SKILL.md',
    (feature) => {
      expect(featuresManifest.features[feature]).toBeDefined();

      // Check that at least one CLI command from this feature appears in the skill
      const cliCommands = featuresManifest.features[feature].cli || [];
      const anyMentioned = cliCommands.some(cmd =>
        skillContent.includes(cmd) || skillContent.includes(`pd ${cmd}`)
      );
      expect(anyMentioned).toBe(true);
    }
  );

  // Features with docs.readme === true MUST appear in the API reference
  it('features with docs.readme=true have routes in API reference', () => {
    const missing = [];
    for (const [name, feature] of Object.entries(featuresManifest.features)) {
      if (!feature.routes || feature.routes.length === 0) continue;
      // Only hard-require features that explicitly declare docs.readme: true
      if (feature.docs?.readme !== true) continue;

      const anyDocumented = feature.routes.some(route => {
        // Parse "POST /sugar/begin" → method + path
        const methodMatch = route.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)/);
        if (!methodMatch) return false;
        const [, method, path] = methodMatch;
        // Build a regex that matches the path with any param names
        // e.g. /services/:param/endpoints/:param → /services/:[^/]+/endpoints/:[^/]+
        const pathPattern = path.replace(/:[^/]+/g, ':[^/]+');
        const fullPattern = new RegExp(`${method}\\s+${pathPattern}`);
        // Also check just the static path segments (e.g. /sugar/begin)
        const staticPath = path.replace(/:[^/]+/g, '').replace(/\/+/g, '/');
        return fullPattern.test(apiReference) || apiReference.includes(staticPath);
      });
      if (!anyDocumented) {
        missing.push(`${name}: ${feature.routes[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ============================================================================
// 9. README — must not lag behind on core messaging
// ============================================================================

describe('README freshness', () => {
  it('README.md exists', () => {
    expect(readmeContent).not.toBeNull();
  });

  it('README mentions sugar commands if manifest says docs.readme=true', () => {
    const sugar = featuresManifest.features?.sugar;
    if (sugar?.docs?.readme === true) {
      // If sugar is marked as needing README docs, it MUST appear
      expect(readmeContent).toMatch(/pd begin|begin.*session|sugar/i);
    }
    // If docs.readme is false/undefined, sugar is still new — no README requirement yet
  });

  it('README mentions agent/plugin/skill integration', () => {
    // README should tell users how agents can use Port Daddy
    // Could be MCP, plugin, skill — any agentic integration surface
    expect(readmeContent).toMatch(/mcp|MCP|plugin|skill|agent/i);
  });
});

// ============================================================================
// 10. Dashboard — must not use stale API patterns or miss key features
// ============================================================================

describe('Dashboard freshness', () => {
  it('dashboard file exists', () => {
    expect(dashboardContent).not.toBeNull();
  });

  it('dashboard does NOT use old /claim/:id URL pattern', () => {
    // v3.4 changed to POST /claim with id in body
    // Old pattern: fetch(API + '/claim/' + id, { method: 'POST' })
    // New pattern: fetch(API + '/claim', { body: JSON.stringify({ id }) })
    // Negative lookbehind excludes /resurrection/claim/ which is a valid route
    const oldClaimPattern = /(?<!resurrection)\/claim\/['"` ]*\+|(?<!resurrection)\/claim\/['"]\s*\+/;
    expect(dashboardContent).not.toMatch(oldClaimPattern);
  });

  it('dashboard does NOT use old /release/:id URL pattern', () => {
    // v3.4 changed to DELETE /release with id in body
    const oldReleasePattern = /\/release\/['"` ]*\+|\/release\/['"]\s*\+|fetch\([^)]*\/release\/(?!['"])/;
    expect(dashboardContent).not.toMatch(oldReleasePattern);
  });

  it('dashboard fetches from key API endpoints', () => {
    // Core endpoints every dashboard must hit
    expect(dashboardContent).toMatch(/\/health/);
    expect(dashboardContent).toMatch(/\/services/);
    expect(dashboardContent).toMatch(/\/agents/);
    expect(dashboardContent).toMatch(/\/sessions/);
    expect(dashboardContent).toMatch(/\/locks/);
  });

  it('dashboard has sections for core features', () => {
    // Check for presence of key feature sections (by ID, class, or text)
    expect(dashboardContent).toMatch(/services|Services/);
    expect(dashboardContent).toMatch(/agents|Agents/);
    expect(dashboardContent).toMatch(/sessions|Sessions/);
    expect(dashboardContent).toMatch(/salvage|Salvage|resurrection/i);
    expect(dashboardContent).toMatch(/locks|Locks/);
  });

  it('dashboard has sections for v3.4+ features', () => {
    expect(dashboardContent).toMatch(/dns|DNS/i);
    expect(dashboardContent).toMatch(/activity|Activity/i);
  });

  it('dashboard uses auto-refresh / polling', () => {
    // Dashboard should poll for live data
    expect(dashboardContent).toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
