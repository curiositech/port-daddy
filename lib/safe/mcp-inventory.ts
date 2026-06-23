/**
 * lib/safe/mcp-inventory.ts — A7, the MCP / skill supply-chain inventory
 * (ADR-0088 Phase A).
 *
 * Enumerate configured MCP servers across `.mcp.json`, `~/.cursor/mcp.json`, and
 * the Claude config, then flag any server whose `command` is an UNPINNED
 * `npx`/`uvx` fetch — the typosquat / tool-poisoning vector.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  DETECTION IS STRUCTURED FIELD INSPECTION — NOT NLP.
 * ════════════════════════════════════════════════════════════════════════
 * The flag is decided by inspecting the `command` string and the `args` ARRAY
 * (structured fields the operator controls), never by classifying free text. We
 * look at: is the launcher `npx`/`uvx`? does its package argument carry a pinned
 * `@version` (or `==version` for uvx `--from`)? That is a field-format check on a
 * structured config value — the allowed kind of exact match — not a keyword list
 * over a description.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  McpServerEntry,
  McpInventoryResult,
  McpConfigSource,
  McpFlagReason,
} from './types.js';

/** Injectable fs for tests. */
export interface McpInventoryDeps {
  readFile?: (path: string) => string | null;
  exists?: (path: string) => boolean;
  home?: string;
  /** Extra config paths to inventory (e.g. a project workdir `.mcp.json`). */
  extraConfigPaths?: { path: string; source: McpConfigSource }[];
}

/** The well-known MCP config locations, with their source tag. */
export function defaultConfigPaths(
  home: string,
): { path: string; source: McpConfigSource }[] {
  return [
    { path: join(home, '.mcp.json'), source: 'project-mcp-json' },
    { path: join(home, '.cursor', 'mcp.json'), source: 'cursor-mcp-json' },
    { path: join(home, '.claude.json'), source: 'claude-config' },
    { path: join(home, '.claude', 'settings.json'), source: 'claude-config' },
    {
      path: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      source: 'claude-config',
    },
  ];
}

// ── Structured command-array inspection ──────────────────────────────────────

/**
 * Decide whether an npx invocation is UNPINNED. Structured: walk the args array,
 * skip npx flags (`-y`, `--yes`, `-p`/`--package` take the next token as the
 * pkg), find the first package spec, and check it carries an `@version` pin.
 *
 * `npx @scope/pkg`            → unpinned (no @version after the name)
 * `npx @scope/pkg@1.2.3`      → pinned
 * `npx -y pkg@^1`             → pinned (a range is still a pin vs nothing)
 * `npx ./local` / abs path    → not a registry fetch → not flagged
 */
export function npxIsUnpinned(args: string[]): boolean {
  const pkg = firstPackageArg(args, 'npx');
  if (pkg == null) return false; // no registry package → nothing to pin
  return !hasNpmVersionPin(pkg);
}

/**
 * Decide whether a uvx invocation is UNPINNED. uvx pins via `pkg==1.2.3` or via
 * `--from 'pkg==1.2.3'`. Structured walk of the args array.
 */
export function uvxIsUnpinned(args: string[]): boolean {
  // `--from <spec>` carries the pin when present.
  const fromIdx = args.findIndex((a) => a === '--from' || a === '-f');
  if (fromIdx >= 0 && args[fromIdx + 1]) {
    return !hasUvxVersionPin(args[fromIdx + 1]);
  }
  const pkg = firstPackageArg(args, 'uvx');
  if (pkg == null) return false;
  return !hasUvxVersionPin(pkg);
}

/** Flags whose NEXT token is the package, not the package itself. */
const FLAGS_TAKING_VALUE = new Set(['-p', '--package', '--from', '-f', '--with']);
/** Boolean flags that consume no value. */
const BOOLEAN_FLAGS = new Set(['-y', '--yes', '-q', '--quiet', '--silent']);

/** First registry-package argument, skipping launcher flags. Pure. */
function firstPackageArg(args: string[], launcher: 'npx' | 'uvx'): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (FLAGS_TAKING_VALUE.has(a)) {
      // The value is the package spec (e.g. `-p pkg@1`, `--from pkg==1`).
      const val = args[i + 1];
      if (val == null) return null;
      if (isPathSpec(val)) return null;
      return val;
    }
    if (BOOLEAN_FLAGS.has(a)) continue;
    if (a.startsWith('-')) continue; // unknown flag — skip conservatively
    // First non-flag token is the package spec.
    if (isPathSpec(a)) return null; // local path / url → not a registry fetch
    return a;
  }
  return null;
}

/** True when a spec is a local path or URL (not a bare registry package). */
function isPathSpec(spec: string): boolean {
  return (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('~') ||
    /^[a-z]+:\/\//i.test(spec) ||
    spec.endsWith('.tgz') ||
    spec.endsWith('.tar.gz')
  );
}

/**
 * Does an npm package spec carry a version pin? `pkg@1.2.3`, `@scope/pkg@1.2.3`,
 * `pkg@^1`, `pkg@latest`. The leading `@` of a scope is NOT a version separator —
 * so we look for an `@version` AFTER the (optionally-scoped) name.
 */
export function hasNpmVersionPin(spec: string): boolean {
  // Strip a leading scope `@scope/` so its `@` isn't mistaken for a version.
  const afterScope = spec.startsWith('@') ? spec.replace(/^@[^/]+\//, '') : spec;
  // A version pin is an `@<something>` in the remaining name. `pkg@1`, `pkg@latest`.
  return /@[^@/]+$/.test(afterScope);
}

/** Does a uvx package spec carry a version pin? `pkg==1.2.3`, `pkg>=1`. */
export function hasUvxVersionPin(spec: string): boolean {
  return /(==|>=|<=|~=|!=|@)[^\s]+$/.test(spec);
}

/**
 * Inspect one server's command + args and return the structural flags. Pure.
 * The `command` may be the launcher directly (`"command": "npx"`) or a path
 * whose basename is the launcher.
 */
export function inspectServerCommand(
  command: string | null,
  args: string[],
): McpFlagReason[] {
  if (!command) return [];
  const launcher = command.split('/').pop() ?? command;
  const flags: McpFlagReason[] = [];
  if (launcher === 'npx' && npxIsUnpinned(args)) flags.push('unpinned-npx');
  if (launcher === 'uvx' && uvxIsUnpinned(args)) flags.push('unpinned-uvx');
  // `command: "node"` running an `npx`-style fetch is not expressible here;
  // when the command itself IS the package fetch tool we catch it above.
  return flags;
}

// ── Config parsing ───────────────────────────────────────────────────────────

/**
 * Extract the `mcpServers` map from a parsed config object, tolerating the
 * several shapes in the wild: top-level `mcpServers`, Claude's nested
 * `mcpServers`, or a project `.mcp.json` whose root IS the server map. Defensive
 * — returns an empty map on any unexpected shape.
 */
export function extractServers(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    return obj.mcpServers as Record<string, unknown>;
  }
  // A `.mcp.json` whose values all look like server entries (have a `command`).
  const looksLikeServerMap = Object.values(obj).some(
    (v) => v && typeof v === 'object' && 'command' in (v as object),
  );
  if (looksLikeServerMap) return obj;
  return {};
}

/** Parse one config file's servers into entries. Defensive against bad JSON. */
export function parseConfigFile(
  configPath: string,
  source: McpConfigSource,
  content: string,
): McpServerEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const servers = extractServers(parsed);
  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const command = typeof r.command === 'string' ? r.command : null;
    const args = Array.isArray(r.args)
      ? r.args.filter((a): a is string => typeof a === 'string')
      : [];
    entries.push({
      name,
      source,
      configPath,
      command,
      args,
      flags: inspectServerCommand(command, args),
    });
  }
  return entries;
}

/**
 * Inventory all configured MCP servers + flag unpinned npx/uvx fetches.
 * Read-only. Injectable fs for tests; defaults to the real fs over the
 * well-known config locations.
 */
export function inventoryMcp(deps: McpInventoryDeps = {}): McpInventoryResult {
  const home = deps.home ?? process.env.HOME ?? '';
  const exists = deps.exists ?? ((p: string) => existsSync(p));
  const readFile =
    deps.readFile ??
    ((p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    });

  const paths = [...defaultConfigPaths(home), ...(deps.extraConfigPaths ?? [])];
  const servers: McpServerEntry[] = [];
  const configsScanned: string[] = [];
  for (const { path, source } of paths) {
    if (!exists(path)) continue;
    const content = readFile(path);
    if (content == null) continue;
    configsScanned.push(path);
    servers.push(...parseConfigFile(path, source, content));
  }
  return { servers, configsScanned };
}
