/**
 * Deep Recursive Scanner
 *
 * Scans a project directory recursively to find ALL services,
 * including those nested in monorepo workspaces or subdirectories.
 *
 * Replaces the shallow detect+init workflow with one smart command.
 * Discovery fills in gaps; .portdaddyrc always wins.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve, relative } from 'node:path';
import type { DetectedStack } from '../shared/types.js';
import { detectStack } from './detect.js';
import { detectWorkspaceConfig, suggestNames, mergeWithConfig } from './discover.js';
import type { DiscoveredService } from './discover.js';
import { loadConfig } from './config.js';
import type { PortDaddyRcConfig } from './config.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_DEPTH = 5;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target',
  'vendor', '.output', '.nuxt', '.svelte-kit', '.parcel-cache',
  '.webpack', 'bower_components', '.idea', '.vscode'
]);

// =============================================================================
// Types
// =============================================================================

interface ScannedService extends DiscoveredService {
  relativePath: string;
}

interface NameSuggestion {
  project: string;
  stack: string;
  context: string;
  full: string;
}

interface ScanResult {
  project: string;
  root: string;
  type: 'single' | 'monorepo' | 'multi';
  workspaceType: 'workspaces' | 'pnpm' | 'lerna' | null;
  services: Record<string, ScannedService>;
  suggestions: Record<string, NameSuggestion>;
  existingConfig: PortDaddyRcConfig | null;
  serviceCount: number;
  guidance: string[];
}

interface ScanOptions {
  useBranch?: boolean;
}

interface GuidanceContext {
  services: Record<string, ScannedService>;
  existingConfig: PortDaddyRcConfig | null;
  type: string;
  projectName: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Read and parse JSON, returning null on failure.
 */
function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Derive a short service name from a directory and its package.json.
 */
function deriveName(dir: string, rootDir: string): string {
  const pkg = readJson(join(dir, 'package.json')) as Record<string, unknown> | null;
  if (pkg?.name) {
    return (pkg.name as string).replace(/^@[^/]+\//, '');
  }
  // Use relative path from root, replacing separators with dashes
  const rel = relative(rootDir, dir);
  return rel ? rel.replace(/[\\/]/g, '-') : basename(resolve(dir));
}

/**
 * Build a dev command from package.json scripts or stack defaults.
 */
function buildDevCommand(dir: string, stack: DetectedStack): string | null {
  const pkg = readJson(join(dir, 'package.json')) as Record<string, unknown> | null;
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (scripts?.dev) {
    return 'npm run dev';
  }
  return stack.devCmd || null;
}

/**
 * Walk directory tree recursively, collecting services.
 */
function walkDir(
  dir: string,
  rootDir: string,
  depth: number,
  workspaceDirs: Set<string>
): Record<string, ScannedService> {
  if (depth > MAX_DEPTH) return {};

  const services: Record<string, ScannedService> = {};

  // Skip if this exact dir was already handled via workspace detection
  const absDir = resolve(dir);
  if (workspaceDirs.has(absDir) && depth > 0) return {};

  // Try to detect a stack at this directory
  const stack = detectStack(dir);
  if (stack && depth > 0) {
    // Don't detect at root level during recursion — root is handled separately
    const name = deriveName(dir, rootDir);
    services[name] = {
      dir: absDir,
      relativePath: relative(rootDir, dir) || '.',
      stack,
      dev: buildDevCommand(dir, stack),
      health: stack.healthPath || '/',
      preferredPort: stack.defaultPort
    };
  }

  // Recurse into subdirectories
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return services;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }

    const sub = walkDir(full, rootDir, depth + 1, workspaceDirs);
    Object.assign(services, sub);
  }

  return services;
}

/**
 * Expand workspace globs to a Set of absolute directory paths.
 */
function expandWorkspacePaths(rootDir: string, patterns: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const clean = pattern.replace(/\/?[*]+$/, '');
    const base = join(rootDir, clean);
    if (!existsSync(base)) continue;

    try {
      if (statSync(base).isDirectory()) {
        // If pattern had a glob, expand children
        if (pattern.includes('*')) {
          for (const entry of readdirSync(base)) {
            const full = resolve(join(base, entry));
            try {
              if (statSync(full).isDirectory()) {
                dirs.add(full);
              }
            } catch { /* skip */ }
          }
        } else {
          dirs.add(resolve(base));
        }
      }
    } catch { /* skip */ }
  }
  return dirs;
}

// =============================================================================
// Exported Functions
// =============================================================================

/**
 * Deep-scan a project directory.
 *
 * Algorithm:
 *   1. Check for monorepo workspaces (reuse discover.js)
 *   2. Walk directory tree recursively (max depth 5)
 *   3. Deduplicate (workspace-declared wins over recursively-found)
 *   4. For each service: derive name, suggested identity, dev command
 *   5. Load any existing .portdaddyrc, note differences
 *   6. Generate guidance (what to do next)
 */
export function scanProject(dir: string, options: ScanOptions = {}): ScanResult {
  const rootDir = resolve(dir);

  // 1. Check for workspace config
  const workspaceConfig = detectWorkspaceConfig(rootDir);
  const workspaceDirs = workspaceConfig.type
    ? expandWorkspacePaths(rootDir, workspaceConfig.patterns)
    : new Set<string>();

  // 2. Detect stack at root level
  const rootStack = detectStack(rootDir);
  const services: Record<string, ScannedService> = {};

  if (rootStack) {
    const name = deriveName(rootDir, rootDir);
    services[name] = {
      dir: rootDir,
      relativePath: '.',
      stack: rootStack,
      dev: buildDevCommand(rootDir, rootStack),
      health: rootStack.healthPath || '/',
      preferredPort: rootStack.defaultPort
    };
  }

  // 3. Scan workspace dirs explicitly
  for (const wsDir of workspaceDirs) {
    const stack = detectStack(wsDir);
    if (!stack) continue;

    const name = deriveName(wsDir, rootDir);
    if (!services[name]) {
      services[name] = {
        dir: wsDir,
        relativePath: relative(rootDir, wsDir),
        stack,
        dev: buildDevCommand(wsDir, stack),
        health: stack.healthPath || '/',
        preferredPort: stack.defaultPort
      };
    }
  }

  // 4. Recursive walk for anything missed
  const walked = walkDir(rootDir, rootDir, 0, workspaceDirs);
  for (const [name, svc] of Object.entries(walked)) {
    if (!services[name]) {
      services[name] = svc;
    }
  }

  // 5. Derive project type
  const type: 'single' | 'monorepo' | 'multi' = workspaceConfig.type
    ? 'monorepo'
    : Object.keys(services).length > 1 ? 'multi' : 'single';

  // 6. Generate name suggestions
  const suggestions = suggestNames(services, rootDir, options);

  // 7. Load existing config for diff
  let existingConfig: PortDaddyRcConfig | null = null;
  try {
    existingConfig = loadConfig(rootDir);
  } catch { /* no existing config */ }

  // 8. Build project metadata
  const pkg = readJson(join(rootDir, 'package.json')) as Record<string, unknown> | null;
  const projectName = ((pkg?.name as string) || basename(rootDir))
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();

  return {
    project: projectName,
    root: rootDir,
    type,
    workspaceType: workspaceConfig.type,
    services,
    suggestions,
    existingConfig,
    serviceCount: Object.keys(services).length,
    guidance: generateGuidance({
      services,
      existingConfig,
      type,
      projectName
    })
  };
}

/**
 * Generate contextual next-step guidance based on scan results.
 */
export function generateGuidance(ctx: GuidanceContext): string[] {
  const { services, existingConfig, type } = ctx;
  const count = Object.keys(services).length;
  const lines: string[] = [];

  if (count === 0) {
    lines.push('No services detected. Port Daddy looks for known frameworks');
    lines.push('(Next.js, Express, FastAPI, Docker, Go, etc.).');
    lines.push('');
    lines.push('You can manually create a .portdaddyrc:');
    lines.push('  $ port-daddy init');
    return lines;
  }

  if (existingConfig) {
    const existingCount = Object.keys(existingConfig.services || {}).length;
    if (existingCount < count) {
      lines.push(`Found ${count} services (config has ${existingCount}).`);
      lines.push('Scan will update .portdaddyrc with newly discovered services.');
    } else {
      lines.push(`Config is up to date (${existingCount} services).`);
    }
  } else {
    lines.push(`Discovered ${count} service${count > 1 ? 's' : ''} in ${type} project.`);
    lines.push('Saving .portdaddyrc with discovered services.');
  }

  lines.push('');
  lines.push('Next: $ port-daddy up');

  return lines;
}

/**
 * Build a .portdaddyrc config object from scan results.
 */
export function buildConfigFromScan(scanResult: ScanResult): Record<string, unknown> {
  const { project, services, suggestions } = scanResult;

  const configServices: Record<string, Record<string, unknown>> = {};
  for (const [name, svc] of Object.entries(services)) {
    const suggestion = suggestions[name];
    configServices[name] = {
      dev: svc.dev,
      preferredPort: svc.preferredPort,
      health: svc.health,
      _detected: svc.stack.name,
      _dir: svc.relativePath
    };
    if (suggestion) {
      configServices[name]._identity = suggestion.full;
    }
  }

  // Determine port range from services
  const ports = Object.values(services).map(s => s.preferredPort).filter(Boolean);
  const minPort = ports.length ? Math.min(...ports) : 3100;
  const maxPort = ports.length ? Math.max(...ports) + 49 : 3199;

  const config: Record<string, unknown> = {
    project,
    portRange: [minPort, maxPort],
    services: configServices
  };

  // Merge with existing config if present (existing config wins)
  if (scanResult.existingConfig) {
    const merged = mergeWithConfig(config, scanResult.existingConfig as unknown as Record<string, unknown>);
    // Preserve portRange from existing config (config wins over discovery)
    if (scanResult.existingConfig.portRange) {
      merged.portRange = scanResult.existingConfig.portRange;
    }
    // Preserve project name from existing config
    if (scanResult.existingConfig.project) {
      merged.project = scanResult.existingConfig.project;
    }
    return merged;
  }

  return config;
}
