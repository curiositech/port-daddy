/**
 * Per-user CLI install dirs shared by the readiness gate
 * (lib/backend-readiness.ts) and the spawn path
 * (lib/spawner/backends/cli-tube.ts).
 *
 * The daemon runs under launchd with a bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so agent CLIs installed per-user are
 * invisible unless every code path that locates or spawns them augments
 * PATH with the same locations. Keeping the list in one module guarantees
 * readiness and spawn agree — a binary the gate found is findable at spawn
 * time, and vice versa.
 *
 * Operators whose CLI lives somewhere unusual set PD_CLI_BIN_DIRS
 * (PATH-delimiter-separated: ':' on POSIX, ';' on Windows) instead of touching
 * launchd's PATH. Computed per-call so the override is honored at runtime
 * (and testable).
 */

import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
// Namespace import (not a named `readdirSync`) so test suites that partially
// mock node:fs don't fail at ESM bind time on a missing named export — the
// property is read at call time, inside the try/catch below.
import * as nodeFs from 'node:fs';

export interface CliBinaryResolution {
  command: string;
  found: boolean;
  source: 'override' | 'discovered' | 'unresolved';
  override?: string;
  warning?: string;
}

/**
 * Node version-manager bin dirs. npm-global CLIs (codex, grok, …) install into
 * the ACTIVE node's bin, which under nvm/volta/fnm is a version-specific path
 * NOT on launchd's bare PATH and NOT a fixed location — so a hardcoded
 * `~/.codex/bin` misses a codex installed via `npm i -g`. Enumerate the
 * version dirs so the daemon finds them. Fail-soft: missing manager → [].
 */
function nodeVersionManagerBinDirs(home: string): string[] {
  const dirs: string[] = [];
  // nvm: ~/.nvm/versions/node/<ver>/bin  (newest first so the active-ish wins)
  try {
    const root = join(home, '.nvm', 'versions', 'node');
    for (const ver of nodeFs.readdirSync(root).sort().reverse()) {
      dirs.push(join(root, ver, 'bin'));
    }
  } catch { /* no nvm */ }
  // volta + fnm shim dirs (fixed locations)
  dirs.push(join(home, '.volta', 'bin'));
  dirs.push(join(home, '.fnm', 'aliases', 'default', 'bin'));
  return dirs;
}

export function cliBinDirs(): string[] {
  const home = process.env.HOME || homedir() || '';
  const override = process.env.PD_CLI_BIN_DIRS
    ? process.env.PD_CLI_BIN_DIRS.split(delimiter).filter(Boolean)
    : [];
  const homeDirs = home ? [
    join(home, '.local', 'bin'), // claude-code + many per-user installs
    join(home, '.claude', 'local'), // claude-code alternate install path
    join(home, '.codex', 'bin'), // codex (native installer)
    ...nodeVersionManagerBinDirs(home), // codex/grok via `npm i -g` under nvm/volta/fnm
  ] : [];
  return dedupe([
    ...override,
    ...homeDirs,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]);
}

export function cliBinarySearchPath(basePath = process.env.PATH || ''): string {
  return dedupe([
    ...basePath.split(delimiter).filter(Boolean),
    ...cliBinDirs(),
  ]).join(delimiter);
}

export function resolveCliBinary(
  defaultCommand: string,
  opts: { envOverride?: string; basePath?: string } = {},
): CliBinaryResolution {
  const override = opts.envOverride ? process.env[opts.envOverride] : undefined;
  const expandedOverride = override ? expandHome(override) : undefined;
  if (expandedOverride) {
    const resolvedOverride = findExecutableOnPath(expandedOverride, opts.basePath);
    if (resolvedOverride) {
      return {
        command: resolvedOverride,
        found: true,
        source: 'override',
        override,
      };
    }
  }

  const discovered = findExecutableOnPath(defaultCommand, opts.basePath);
  if (discovered) {
    const warning = expandedOverride
      ? `Configured ${opts.envOverride}=${override} is not executable; using discovered ${defaultCommand} at ${discovered}.`
      : undefined;
    return {
      command: discovered,
      found: true,
      source: 'discovered',
      override,
      warning,
    };
  }

  const warning = expandedOverride
    ? `Configured ${opts.envOverride}=${override} is not executable and no ${defaultCommand} binary was found in PATH or standard user CLI dirs.`
    : undefined;
  return {
    command: expandedOverride || defaultCommand,
    found: false,
    source: 'unresolved',
    override,
    warning,
  };
}

function findExecutableOnPath(command: string, basePath = process.env.PATH || ''): string | null {
  const expanded = expandHome(command);
  if (expanded.includes('/') || expanded.includes('\\') || isAbsolute(expanded)) {
    return isExecutableFile(expanded) ? expanded : null;
  }

  for (const dir of cliBinarySearchPath(basePath).split(delimiter).filter(Boolean)) {
    const candidate = join(dir, expanded);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function isExecutableFile(path: string): boolean {
  try {
    nodeFs.accessSync(path, nodeFs.constants.X_OK);
    const st = nodeFs.statSync(path);
    return st.isFile();
  } catch {
    return false;
  }
}

function expandHome(path: string): string {
  if (path === '~') return process.env.HOME || homedir() || path;
  if (path.startsWith('~/')) {
    const home = process.env.HOME || homedir() || '';
    return home ? join(home, path.slice(2)) : path;
  }
  return path;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
