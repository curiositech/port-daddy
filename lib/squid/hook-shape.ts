/**
 * lib/squid/hook-shape.ts — SINGLE SOURCE OF TRUTH for the per-CLI hook shapes
 * the Giant Squid Harness injects.
 *
 * Both injection paths import from here so they can NEVER drift:
 *   - the squid ADAPTER (headless spawn: `claude -p`, `gemini -p`, `codex exec`,
 *     `agy -p`) — lib/squid/adapter.ts
 *   - the interactive INSTALLER (`pd hooks install`) — cli/commands/hooks-install.ts
 *
 * The values below (event names, tool matchers, the Codex TOML block + marker)
 * are the canonical shapes verified against each vendor's hook engine. If a
 * vendor changes its surface, change it HERE once — every injector follows.
 *
 * What differs between the two injectors is ONLY the tentacle PATHS (the adapter
 * points at the repo `bin/`; the installer points at the staged
 * `~/.port-daddy/bin/` gate wrappers) — so every builder takes a path resolver.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Tentacle identity ────────────────────────────────────────────────────────

export const TENTACLES = ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'] as const;
export type TentacleName = (typeof TENTACLES)[number];

/** Marker substring present in every command we write — used for idempotent dedupe. */
export const PD_HOOK_MARKER = 'pd-hook-';

/**
 * A resolver mapping a tentacle (built-in OR plugin) name to the absolute
 * command string to invoke. Widened to `string` (not just `TentacleName`) so
 * the same resolver serves discovered plugin hooks — see PluginHookSpec below.
 */
export type TentacleResolver = (name: string) => string;

// ─── Plugin hook discovery ─────────────────────────────────────────────────
//
// The 3 built-in tentacles above are wired by literal name everywhere (adapter
// injectHooks bodies, stageTentacles, this file's builders) — that contract is
// unchanged. This section is the EXTENSION point: any additional executable
// dropped into the same bin/ directory as the built-ins, paired with a
// `<name>.hook.json` sidecar declaring which lifecycle event it binds to, is
// discovered here and folded into every builder below, without editing this
// repo's source. See docs/architecture/squid-hook-plugin-system.md.

export type HookPurpose = 'prompt' | 'preTool' | 'postTool';

export interface PluginHookSpec {
  /** File name in bin/, e.g. "pd-hook-lint-gate". Always starts with "pd-hook-". */
  name: string;
  /** Which lifecycle point this plugin binds to. */
  purpose: HookPurpose;
  displayName: string;
  description: string;
  privacy: string;
}

const PLUGIN_SIDECAR_SUFFIX = '.hook.json';

function isBuiltinTentacle(name: string): boolean {
  return (TENTACLES as readonly string[]).includes(name);
}

/**
 * Scan `binDir` for plugin tentacles: a `<pd-hook-name>.hook.json` sidecar
 * declaring `{ "purpose": "prompt"|"preTool"|"postTool", "displayName"?,
 * "description"?, "privacy"? }` next to an executable `<pd-hook-name>` file in
 * the same directory. The 3 built-in tentacles are excluded even if they grew
 * a sidecar (they're wired by the fixed TENTACLES contract, not discovery).
 *
 * A sidecar with no matching binary, invalid JSON, or a missing/invalid
 * "purpose" is skipped with a console warning rather than thrown — one broken
 * plugin declaration must not take down the built-in tentacles or the other
 * plugins. An unreadable binDir (fresh checkout, no bin/ yet) returns [].
 */
export function discoverPluginHooks(binDir: string): PluginHookSpec[] {
  let entries: string[];
  try {
    entries = readdirSync(binDir);
  } catch {
    return [];
  }
  const discovered: PluginHookSpec[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(PLUGIN_SIDECAR_SUFFIX)) continue;
    const name = entry.slice(0, -PLUGIN_SIDECAR_SUFFIX.length);
    if (!name.startsWith(PD_HOOK_MARKER) || isBuiltinTentacle(name)) continue;

    const binPath = join(binDir, name);
    if (!existsSync(binPath)) {
      console.error(`[squid/hook-shape] ${entry} has no matching binary at ${binPath} — skipping`);
      continue;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(binDir, entry), 'utf8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`[squid/hook-shape] ${entry} is not valid JSON — skipping (${(err as Error).message})`);
      continue;
    }

    const purpose = raw.purpose;
    if (purpose !== 'prompt' && purpose !== 'preTool' && purpose !== 'postTool') {
      console.error(`[squid/hook-shape] ${entry} has no valid "purpose" (prompt|preTool|postTool) — skipping`);
      continue;
    }

    discovered.push({
      name,
      purpose,
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : `Plugin hook: ${name}`,
      description:
        typeof raw.description === 'string' && raw.description
          ? raw.description
          : `Custom Giant Squid tentacle (${name}) — no description declared in ${entry}.`,
      privacy:
        typeof raw.privacy === 'string' && raw.privacy
          ? raw.privacy
          : 'Not declared in the plugin manifest — review the plugin source before trusting it with tool-call data.',
    });
  }
  return discovered;
}

// ─── JSON hook shape (Claude Code / Gemini / agy all use this nesting) ────────

export interface HookCommand {
  type: 'command';
  command: string;
}
export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

/** Canonical single-matcher entry (matcher omitted entirely when undefined). */
export function hookEntry(command: string, matcher?: string): HookMatcher {
  return { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] };
}

/** True if any hook in the entry points at one of our tentacles. */
export function isPdEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      h &&
      typeof h === 'object' &&
      typeof (h as { command?: unknown }).command === 'string' &&
      (h as { command: string }).command.includes(PD_HOOK_MARKER),
  );
}

/** Idempotent upsert of a {event -> entries} map into a JSON config object. */
export function upsertJsonHookMap(
  config: Record<string, unknown>,
  hookMap: Record<string, HookMatcher[]>,
): Record<string, unknown> {
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  const hooks = config.hooks as Record<string, unknown>;
  for (const [event, entries] of Object.entries(hookMap)) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const preserved = existing.filter((e) => !isPdEntry(e)); // keep user-authored hooks
    hooks[event] = [...preserved, ...entries];
  }
  return config;
}

/** Remove every Port Daddy entry from a JSON config object. Returns true if changed. */
export function removeJsonHooks(config: Record<string, unknown>): boolean {
  if (!config.hooks || typeof config.hooks !== 'object') return false;
  const hooks = config.hooks as Record<string, unknown>;
  let changed = false;
  for (const [event, val] of Object.entries(hooks)) {
    if (!Array.isArray(val)) continue;
    const preserved = (val as unknown[]).filter((e) => !isPdEntry(e));
    if (preserved.length !== val.length) changed = true;
    if (preserved.length === 0) delete hooks[event];
    else hooks[event] = preserved;
  }
  return changed;
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

export const CLAUDE_EVENTS = { prompt: 'UserPromptSubmit', preTool: 'PreToolUse', postTool: 'PostToolUse' } as const;
export const CLAUDE_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

// ─── Gemini CLI (native event names) ──────────────────────────────────────────

export const GEMINI_EVENTS = { prompt: 'BeforeAgent', preTool: 'BeforeTool', postTool: 'AfterTool' } as const;
export const GEMINI_TOOL_MATCHER = 'replace|write_file|edit|run_shell_command';

// ─── Antigravity (agy) — Claude-shaped engine, broad matcher ─────────────────

export const AGY_EVENTS = { prompt: 'UserPromptSubmit', preTool: 'PreToolUse', postTool: 'PostToolUse' } as const;
export const AGY_TOOL_MATCHER =
  'Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch';

/**
 * Build the JSON {event -> entries} hook map for a given vendor + path
 * resolver. `plugins` (from discoverPluginHooks) are appended as additional
 * matcher-group entries under whichever event their declared purpose maps to
 * — the 3 built-in entries are always present and unchanged, so this is
 * purely additive and a no-plugins call produces the exact same map as before.
 */
export function buildJsonHookMap(
  vendor: 'claude' | 'gemini' | 'agy',
  resolve: TentacleResolver,
  plugins: PluginHookSpec[] = [],
): Record<string, HookMatcher[]> {
  const ev = vendor === 'gemini' ? GEMINI_EVENTS : vendor === 'agy' ? AGY_EVENTS : CLAUDE_EVENTS;
  const matcher = vendor === 'gemini' ? GEMINI_TOOL_MATCHER : vendor === 'agy' ? AGY_TOOL_MATCHER : CLAUDE_TOOL_MATCHER;
  const map: Record<string, HookMatcher[]> = {
    [ev.prompt]: [hookEntry(resolve('pd-hook-prompt'))],
    [ev.preTool]: [hookEntry(resolve('pd-hook-pre-tool'), matcher)],
    [ev.postTool]: [hookEntry(resolve('pd-hook-post-tool'), matcher)],
  };
  for (const plugin of plugins) {
    const event = ev[plugin.purpose];
    const pluginMatcher = plugin.purpose === 'prompt' ? undefined : matcher;
    map[event] = [...(map[event] ?? []), hookEntry(resolve(plugin.name), pluginMatcher)];
  }
  return map;
}

// ─── Codex CLI (TOML, hand-emitted — no TOML lib) ─────────────────────────────

/** Idempotency marker — IDENTICAL to the squid adapter so the two never double-inject. */
export const CODEX_PD_MARKER = 'Port Daddy Giant Squid Harness tentacles';
/**
 * End fence closing our TOML block, so removal never touches user tables below
 * it. Deliberately does NOT contain CODEX_PD_MARKER as a substring — the
 * adapter and tests count marker occurrences for idempotency.
 */
export const CODEX_PD_END_MARKER = 'PD_SQUID_TENTACLES_END';
export const CODEX_TOOL_MATCHER =
  'Bash|apply_patch|Edit|Write|edit|write|str_replace_editor|shell|shell_command|exec_command|unified_exec|run_shell_command';

export interface CodexHooksTomlOptions {
  comments?: string[];
}

/**
 * Remove the Port Daddy block while preserving every unrelated TOML table.
 * Fenced current blocks are exact. Legacy unfenced blocks stop at the next
 * non-hook top-level table because their hook tables cannot be distinguished
 * from adjacent user-authored hook tables after the fact.
 */
export function stripCodexHooksTomlBlock(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  let fenced = false;
  for (const line of lines) {
    if (!skipping && line.includes(CODEX_PD_MARKER)) {
      skipping = true;
      fenced = text.includes(CODEX_PD_END_MARKER);
      continue;
    }
    if (skipping) {
      if (fenced) {
        if (line.includes(CODEX_PD_END_MARKER)) skipping = false;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && !trimmed.startsWith('[[hooks.') && !trimmed.startsWith('[hooks')) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
}

function tomlString(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const CODEX_EVENT_TABLE: Record<HookPurpose, string> = {
  prompt: 'UserPromptSubmit',
  preTool: 'PreToolUse',
  postTool: 'PostToolUse',
};

/**
 * Hand-emit Codex's `[hooks]` TOML block. All three handlers are synchronous:
 * current Codex parses `async = true` but skips that handler entirely. Shape
 * verified against Codex v0.144.4 and shared by both installation paths.
 * `plugins` (from discoverPluginHooks) each get an additional `[[hooks.<Event>]]`
 * block at their declared purpose's event — purely additive, so a no-plugins
 * call emits byte-identical output to before.
 */
export function codexHooksTomlBlock(
  resolve: TentacleResolver,
  options: CodexHooksTomlOptions = {},
  plugins: PluginHookSpec[] = [],
): string {
  const L: string[] = [];
  L.push(`# ${CODEX_PD_MARKER}.`);
  for (const comment of options.comments ?? []) {
    L.push(`# ${comment.replace(/[\r\n]+/g, ' ')}`);
  }
  L.push('# PreToolUse is synchronous so pd-hook-pre-tool can BLOCK a foreign-locked');
  L.push('# file (exit 2 + stderr, OR exit 0 + permissionDecision:"deny" JSON on stdout).');
  L.push('# Codex skips async command hooks, so PostToolUse is synchronous too.');
  L.push('');
  L.push('[[hooks.UserPromptSubmit]]');
  L.push('[[hooks.UserPromptSubmit.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-prompt'))}`);
  L.push('timeout = 10');
  L.push('async = false');
  L.push('');
  L.push('[[hooks.PreToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PreToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-pre-tool'))}`);
  L.push('timeout = 10');
  L.push('async = false');
  L.push('');
  L.push('[[hooks.PostToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PostToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-post-tool'))}`);
  L.push('timeout = 10');
  L.push('async = false');
  for (const plugin of plugins) {
    const event = CODEX_EVENT_TABLE[plugin.purpose];
    L.push('');
    L.push(`# Plugin tentacle: ${plugin.name} — ${plugin.displayName}`);
    L.push(`[[hooks.${event}]]`);
    if (plugin.purpose !== 'prompt') {
      L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
    }
    L.push(`[[hooks.${event}.hooks]]`);
    L.push('type = "command"');
    L.push(`command = ${tomlString(resolve(plugin.name))}`);
    L.push('timeout = 10');
    L.push('async = false');
  }
  L.push(`# ${CODEX_PD_END_MARKER}`);
  L.push('');
  return L.join('\n');
}
