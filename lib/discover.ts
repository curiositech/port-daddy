/**
 * Service Discovery Module
 *
 * Auto-discovers services in a project directory using framework detection.
 * Handles single projects and monorepos (npm/yarn/pnpm workspaces, lerna).
 * Generates semantic identity suggestions from directory/package metadata.
 *
 * Discovery fills in gaps; .portdaddyrc always wins.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DetectedStack } from '../shared/types.js';
import { detectStack } from './detect.js';

// =============================================================================
// Types
// =============================================================================

interface WorkspaceConfig {
  type: 'workspaces' | 'pnpm' | 'lerna' | null;
  patterns: string[];
}

export interface DiscoveredService {
  dir: string;
  stack: DetectedStack;
  dev: string | null;
  health: string;
  preferredPort: number;
  [key: string]: unknown;
}

interface NameSuggestion {
  project: string;
  stack: string;
  context: string;
  full: string;
}

interface SuggestNamesOptions {
  useBranch?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Read and parse JSON from a file, returning null on failure.
 */
function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Expand simple globs (e.g. "packages/*") to actual directories.
 * Supports trailing /* only — no ** or complex patterns.
 */
function expandWorkspaceGlobs(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const clean = pattern.replace(/\/?\*$/, '');
    const base = join(rootDir, clean);
    if (!existsSync(base)) continue;

    try {
      const entries = readdirSync(base);
      for (const entry of entries) {
        const full = join(base, entry);
        try {
          if (statSync(full).isDirectory() && existsSync(join(full, 'package.json'))) {
            dirs.push(full);
          }
        } catch { /* skip unreadable entries */ }
      }
    } catch { /* skip unreadable dirs */ }
  }
  return dirs;
}

// =============================================================================
// Exported Functions
// =============================================================================

/**
 * Detect workspace roots for a monorepo.
 * Checks npm/yarn workspaces, pnpm-workspace.yaml, and lerna.json.
 */
export function detectWorkspaceConfig(dir: string): WorkspaceConfig {
  // npm/yarn workspaces in package.json
  const pkg = readJson(join(dir, 'package.json')) as Record<string, unknown> | null;
  if (pkg?.workspaces) {
    const workspaces = pkg.workspaces;
    const patterns = Array.isArray(workspaces)
      ? workspaces as string[]
      : ((workspaces as Record<string, unknown>).packages as string[] || []);
    return { type: 'workspaces', patterns };
  }

  // pnpm-workspace.yaml
  const pnpmPath = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    try {
      const content = readFileSync(pnpmPath, 'utf8');
      // Simple YAML parsing for packages list — avoids a yaml dependency
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)*)/);
      if (match) {
        const patterns = match[1]
          .split('\n')
          .map(line => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
          .filter(Boolean);
        return { type: 'pnpm', patterns };
      }
    } catch { /* fall through */ }
  }

  // lerna.json
  const lernaPath = join(dir, 'lerna.json');
  if (existsSync(lernaPath)) {
    const lerna = readJson(lernaPath) as Record<string, unknown> | null;
    if (lerna?.packages) {
      return { type: 'lerna', patterns: lerna.packages as string[] };
    }
  }

  return { type: null, patterns: [] };
}

/**
 * Discover all services in a project directory.
 */
export function discoverServices(dir: string): { type: 'single' | 'monorepo'; services: Record<string, DiscoveredService> } {
  const workspaces = detectWorkspaceConfig(dir);

  if (workspaces.type) {
    // Monorepo: scan each workspace package
    const expanded = expandWorkspaceGlobs(dir, workspaces.patterns);
    const services: Record<string, DiscoveredService> = {};

    for (const wsDir of expanded) {
      const stack = detectStack(wsDir);
      if (!stack) continue;

      const pkg = readJson(join(wsDir, 'package.json')) as Record<string, unknown> | null;
      const name = (pkg?.name as string)?.replace(/^@[^/]+\//, '') || basename(wsDir);

      services[name] = {
        dir: wsDir,
        stack,
        dev: buildDevCommand(pkg, stack),
        health: stack.healthPath || '/',
        preferredPort: stack.defaultPort
      };
    }

    return { type: 'monorepo', services };
  }

  // Single project
  const stack = detectStack(dir);
  if (!stack) {
    return { type: 'single', services: {} };
  }

  const pkg = readJson(join(dir, 'package.json')) as Record<string, unknown> | null;
  const name = (pkg?.name as string) || basename(resolve(dir));
  const shortName = name.replace(/^@[^/]+\//, '');

  const services: Record<string, DiscoveredService> = {
    [shortName]: {
      dir,
      stack,
      dev: buildDevCommand(pkg, stack),
      health: stack.healthPath || '/',
      preferredPort: stack.defaultPort
    }
  };

  return { type: 'single', services };
}

/**
 * Build the dev command from package.json scripts or stack defaults.
 * Prefers npm script "dev" if it exists, otherwise uses stack detection.
 */
function buildDevCommand(pkg: Record<string, unknown> | null, stack: DetectedStack): string | null {
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (scripts?.dev) {
    return `npm run dev`;
  }
  return stack.devCmd || null;
}

/**
 * Get the current git branch name safely.
 * Uses execFileSync (not execSync) to avoid shell injection.
 */
function getGitBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Suggest semantic identity names for discovered services.
 */
export function suggestNames(
  services: Record<string, DiscoveredService>,
  dir: string,
  options: SuggestNamesOptions = {}
): Record<string, NameSuggestion> {
  const pkg = readJson(join(dir, 'package.json')) as Record<string, unknown> | null;
  const project = ((pkg?.name as string) || basename(resolve(dir)))
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();

  let context = 'main';
  if (options.useBranch) {
    const branch = getGitBranch(dir);
    if (branch && branch !== 'main' && branch !== 'master') {
      context = branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    }
  }

  const suggestions: Record<string, NameSuggestion> = {};
  for (const [name, svc] of Object.entries(services)) {
    const stackType = inferStackType(svc.stack);

    suggestions[name] = {
      project,
      stack: stackType,
      context,
      full: `${project}:${stackType}:${context}`
    };
  }

  // Disambiguate colliding identities using service name as context.
  // e.g. two Cloudflare Workers both getting :worker:main → :worker:redirect + :worker:reminders
  const seen = new Map<string, string[]>();
  for (const [name, s] of Object.entries(suggestions)) {
    if (!seen.has(s.full)) seen.set(s.full, []);
    seen.get(s.full)!.push(name);
  }
  for (const names of seen.values()) {
    if (names.length > 1) {
      for (const name of names) {
        const svcContext = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        suggestions[name] = {
          ...suggestions[name],
          context: svcContext,
          full: `${suggestions[name].project}:${suggestions[name].stack}:${svcContext}`
        };
      }
    }
  }

  return suggestions;
}

/**
 * Infer the stack type name (frontend/api/worker/static) from framework detection.
 */
function inferStackType(stack: DetectedStack | null): string {
  if (!stack) return 'app';

  const frontendFrameworks = [
    'Next.js', 'Nuxt', 'SvelteKit', 'Remix', 'Astro', 'Vite',
    'Create React App', 'Angular', 'Vue CLI'
  ];
  const backendFrameworks = [
    'Express', 'Fastify', 'Hono', 'NestJS', 'FastAPI', 'Flask', 'Django', 'Go', 'Rust'
  ];
  const workerFrameworks = ['Cloudflare Workers'];
  const containerFrameworks = ['Docker'];
  const staticFrameworks = ['http-server', 'serve'];

  if (frontendFrameworks.includes(stack.name)) return 'frontend';
  if (backendFrameworks.includes(stack.name)) return 'api';
  if (workerFrameworks.includes(stack.name)) return 'worker';
  if (containerFrameworks.includes(stack.name)) return 'container';
  if (staticFrameworks.includes(stack.name)) return 'static';
  return 'app';
}

/**
 * Merge discovered services with .portdaddyrc config.
 * Config always wins — discovery fills in gaps.
 */
export function mergeWithConfig(
  discovered: Record<string, unknown>,
  config: Record<string, unknown> | null
): Record<string, unknown> {
  if (!config || !config.services) {
    return discovered;
  }

  const merged: Record<string, unknown> = { ...discovered };
  const configServices = config.services as Record<string, Record<string, unknown>>;

  for (const [name, svcConfig] of Object.entries(configServices)) {
    if (merged[name]) {
      // Config overrides discovery, but discovery fills gaps
      merged[name] = {
        ...(merged[name] as Record<string, unknown>),
        ...svcConfig
      };
    } else {
      // Config defines a service not found by discovery
      merged[name] = svcConfig;
    }
  }

  return merged;
}
