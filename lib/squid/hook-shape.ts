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

// ─── Tentacle identity ────────────────────────────────────────────────────────

export const TENTACLES = ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'] as const;
export type TentacleName = (typeof TENTACLES)[number];

/** Marker substring present in every command we write — used for idempotent dedupe. */
export const PD_HOOK_MARKER = 'pd-hook-';

/** A resolver mapping a tentacle name to the absolute command string to invoke. */
export type TentacleResolver = (name: TentacleName) => string;

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
  return {
    ...(matcher ? { matcher } : {}),
    // No statusMessage: a successful no-op hook is intentionally invisible.
    // Actionable context/blocking still arrives through stdout/stderr.
    hooks: [{ type: 'command', command }],
  };
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

/** Build the JSON {event -> entries} hook map for a given vendor + path resolver. */
export function buildJsonHookMap(
  vendor: 'claude' | 'gemini' | 'agy',
  resolve: TentacleResolver,
): Record<string, HookMatcher[]> {
  const ev = vendor === 'gemini' ? GEMINI_EVENTS : vendor === 'agy' ? AGY_EVENTS : CLAUDE_EVENTS;
  const matcher = vendor === 'gemini' ? GEMINI_TOOL_MATCHER : vendor === 'agy' ? AGY_TOOL_MATCHER : CLAUDE_TOOL_MATCHER;
  return {
    [ev.prompt]: [hookEntry(resolve('pd-hook-prompt'))],
    [ev.preTool]: [hookEntry(resolve('pd-hook-pre-tool'), matcher)],
    [ev.postTool]: [hookEntry(resolve('pd-hook-post-tool'), matcher)],
  };
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
  const withoutMarkedBlocks: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && line.includes(CODEX_PD_MARKER)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.includes(CODEX_PD_END_MARKER)) {
        skipping = false;
        continue;
      }
      // Legacy marked blocks had no end fence. Stop at the first unrelated
      // top-level table instead of looking for an end marker somewhere else in
      // the file (which could belong to a newer second block and swallow user
      // configuration between the two).
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && !trimmed.startsWith('[[hooks.')) {
        skipping = false;
        withoutMarkedBlocks.push(line);
      }
      continue;
    }
    withoutMarkedBlocks.push(line);
  }

  // The oldest installer emitted hook tables without any marker comment. A
  // later fenced install therefore left both sets live. Remove only complete
  // hook groups whose command entries are all Port Daddy tentacles; mixed or
  // user-authored groups are preserved byte-for-byte.
  const unmarked = withoutMarkedBlocks;
  const out: string[] = [];
  const parentTable = /^\s*\[\[hooks\.[^.\]\s]+\]\]\s*$/;
  for (let i = 0; i < unmarked.length;) {
    if (!parentTable.test(unmarked[i])) {
      out.push(unmarked[i]);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < unmarked.length) {
      const trimmed = unmarked[end].trim();
      if (parentTable.test(unmarked[end])) break;
      if (trimmed.startsWith('[') && !trimmed.startsWith('[[hooks.')) break;
      end += 1;
    }
    const group = unmarked.slice(i, end);
    const commands = group
      .map((entry) => entry.match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/)?.[1])
      .filter((entry): entry is string => typeof entry === 'string');
    if (commands.length === 0 || !commands.every((command) => command.includes(PD_HOOK_MARKER))) {
      out.push(...group);
    }
    i = end;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
}

function tomlString(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Hand-emit Codex's `[hooks]` TOML block. All three handlers are synchronous:
 * current Codex parses `async = true` but skips that handler entirely. Shape
 * verified against Codex v0.144.4 and shared by both installation paths.
 */
export function codexHooksTomlBlock(
  resolve: TentacleResolver,
  options: CodexHooksTomlOptions = {},
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
  L.push('timeout = 1');
  L.push('async = false');
  L.push('');
  L.push('[[hooks.PreToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PreToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-pre-tool'))}`);
  L.push('timeout = 1');
  L.push('async = false');
  L.push('');
  L.push('[[hooks.PostToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PostToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-post-tool'))}`);
  L.push('timeout = 1');
  L.push('async = false');
  L.push(`# ${CODEX_PD_END_MARKER}`);
  L.push('');
  return L.join('\n');
}
