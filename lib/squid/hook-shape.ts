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

export const TENTACLES = ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool', 'pd-hook-stop', 'pd-hook-precompact'] as const;
export type TentacleName = (typeof TENTACLES)[number];

/**
 * Tentacles registered in agent hook lifecycles.
 *
 * `pd-hook-post-tool` remains staged so older installs and retained debug logs
 * can be inspected and removed safely, but it is deliberately not registered.
 * A synchronous process after every tool multiplied a parallel Codex batch into
 * a visible queue and duplicated the cumulative evidence already carried by
 * session claims and notes.
 *
 * `pd-hook-stop` (ADR-0092 L4 closeout gate) IS registered: it fires once per
 * turn on each vendor's end-of-turn event, verifies the standing SITREP
 * contract the prompt tentacle compels, and is loop-guarded twice over
 * (stop_hook_active plus a one-shot per-session marker), so it cannot fan out
 * the way per-tool observation did.
 */
export const REGISTERED_TENTACLES = ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-stop'] as const;

/** Claude Code alone has the verified PreCompact lifecycle event in this slice. */
export const CLAUDE_REGISTERED_TENTACLES = [...REGISTERED_TENTACLES, 'pd-hook-precompact'] as const;

/**
 * A lifecycle-shaped `interactive:<provider>` label is not enough to mint or
 * replay a context-compaction packet. This is the shared issuance authority
 * for the hook installer, direct packet builder, and durable replay paths.
 * Add a provider only alongside a verified native lifecycle witness and its
 * daemon-owned usage/tool-pair evidence contract.
 */
export const INTERACTIVE_COMPACTION_PACKET_PROVIDERS = ['claude'] as const;

export function supportsInteractiveCompactionPacketProvider(provider: string): boolean {
  return (INTERACTIVE_COMPACTION_PACKET_PROVIDERS as readonly string[]).includes(provider.toLowerCase());
}

/**
 * Provider-specific wiring authority. Do not infer a PreCompact event merely
 * because a provider accepts some other lifecycle hook syntax.
 */
export function registeredTentaclesForProvider(
  provider: 'claude' | 'codex' | 'gemini' | 'agy',
): readonly TentacleName[] {
  return provider === 'claude' ? CLAUDE_REGISTERED_TENTACLES : REGISTERED_TENTACLES;
}

/** Every interactive hook must either finish or become visibly overdue within one second. */
export const SQUID_HOOK_DEADLINE_MS = 1_000;

/** Marker substring present in every command we write — used for idempotent dedupe. */
export const PD_HOOK_MARKER = 'pd-hook-';

/** A resolver mapping a tentacle name to the absolute command string to invoke. */
export type TentacleResolver = (name: TentacleName) => string;

// ─── JSON hook shape (Claude Code / Gemini / agy all use this nesting) ────────

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}
export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

/** Canonical single-matcher entry (matcher omitted entirely when undefined). */
export function hookEntry(command: string, matcher?: string, timeout?: number): HookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    // No statusMessage: a successful no-op hook is intentionally invisible.
    // Actionable context/blocking still arrives through stdout/stderr.
    hooks: [{ type: 'command', command, ...(timeout ? { timeout } : {}) }],
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

export const CLAUDE_EVENTS = {
  prompt: 'UserPromptSubmit',
  preTool: 'PreToolUse',
  postTool: 'PostToolUse',
  stop: 'Stop',
  // Verified lifecycle event; see ADR-0091 and the vendor reference linked in
  // the adapter. Do not infer equivalent names for other vendors.
  preCompact: 'PreCompact',
} as const;
export const CLAUDE_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

// ─── Gemini CLI (native event names) ──────────────────────────────────────────

export const GEMINI_EVENTS = { prompt: 'BeforeAgent', preTool: 'BeforeTool', postTool: 'AfterTool', stop: 'AfterAgent' } as const;
export const GEMINI_TOOL_MATCHER = 'replace|write_file|edit';

// ─── Antigravity (agy) — Claude-shaped engine, broad matcher ─────────────────

export const AGY_EVENTS = { prompt: 'UserPromptSubmit', preTool: 'PreToolUse', postTool: 'PostToolUse', stop: 'Stop' } as const;
export const AGY_TOOL_MATCHER =
  'Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch';

/** Build the JSON {event -> entries} hook map for a given vendor + path resolver. */
export function buildJsonHookMap(
  vendor: 'claude' | 'gemini' | 'agy',
  resolve: TentacleResolver,
): Record<string, HookMatcher[]> {
  const ev = vendor === 'gemini' ? GEMINI_EVENTS : vendor === 'agy' ? AGY_EVENTS : CLAUDE_EVENTS;
  const matcher = vendor === 'gemini' ? GEMINI_TOOL_MATCHER : vendor === 'agy' ? AGY_TOOL_MATCHER : CLAUDE_TOOL_MATCHER;
  // Claude and Antigravity express hook timeouts in seconds; Gemini CLI uses
  // milliseconds. Sources (verified 2026-08-21):
  // https://code.claude.com/docs/en/hooks#command-hook-fields
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
  // https://www.agy.dev/docs/ide/hooks/
  const timeout = vendor === 'gemini' ? SQUID_HOOK_DEADLINE_MS : SQUID_HOOK_DEADLINE_MS / 1_000;
  // Claude alone gets the daemon-witnessed turn-start refresh. It is an
  // explicit argument on the existing prompt tentacle, not an inferred
  // cross-vendor lifecycle capability or a second packaged binary.
  const promptCommand = vendor === 'claude'
    ? `${resolve('pd-hook-prompt')} --interactive-context-pressure`
    : resolve('pd-hook-prompt');
  const hooks: Record<string, HookMatcher[]> = {
    [ev.prompt]: [hookEntry(promptCommand, undefined, timeout)],
    [ev.preTool]: [hookEntry(resolve('pd-hook-pre-tool'), matcher, timeout)],
    // End-of-turn SITREP closeout gate fires unconditionally — no tool matcher.
    [ev.stop]: [hookEntry(resolve('pd-hook-stop'), undefined, timeout)],
  };
  if (vendor === 'claude') {
    hooks[CLAUDE_EVENTS.preCompact] = [hookEntry(resolve('pd-hook-precompact'), undefined, timeout)];
  }
  return hooks;
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
  'apply_patch|Edit|Write|edit|write|str_replace_editor';

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
  for (let i = 0; i < lines.length;) {
    if (!lines[i].includes(CODEX_PD_MARKER)) {
      withoutMarkedBlocks.push(lines[i]);
      i += 1;
      continue;
    }

    // A current fenced block is safe to remove exactly. For an old unfenced
    // marker, remove only the marker (and its leading comments), then let the
    // conservative group pass below distinguish all-PD groups from user hooks.
    // This prevents a legacy block from swallowing a later [[hooks.*]] group.
    let endFence = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (lines[j].includes(CODEX_PD_MARKER)) break;
      if (trimmed.startsWith('[') && !trimmed.startsWith('[[hooks.')) break;
      if (lines[j].includes(CODEX_PD_END_MARKER)) {
        endFence = j;
        break;
      }
    }
    if (endFence >= 0) {
      i = endFence + 1;
      continue;
    }

    i += 1;
    while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith('#'))) i += 1;
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
    const commandAssignments = group.filter((entry) => /^\s*command\s*=/.test(entry)).length;
    const commands = group
      .map((entry) => entry.match(/^\s*command\s*=\s*["']([^"']+)["']\s*$/)?.[1])
      .filter((entry): entry is string => typeof entry === 'string');
    const allCommandsRecognized = commandAssignments === commands.length;
    if (
      commands.length === 0 ||
      !allCommandsRecognized ||
      !commands.every((command) => command.includes(PD_HOOK_MARKER))
    ) {
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
 * Hand-emit Codex's deliberately small `[hooks]` TOML block. The turn briefing
 * and direct-edit gate are synchronous because they can affect the current
 * decision. There is no PostToolUse handler: current Codex skips async command
 * hooks, and a synchronous observational process per tool created unbounded UI
 * fan-out without adding a blocking decision. Shape verified against Codex
 * v0.144.4 and shared by both installation paths.
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
  L.push('# Per-tool PostToolUse tracing is intentionally retired; claims and notes are cumulative.');
  L.push('# Stop is synchronous so pd-hook-stop can verify the end-of-turn SITREP once');
  L.push('# per turn (exit 2 + the directive on stderr; loop-guarded by stop_hook_active');
  L.push('# plus a one-shot per-session marker).');
  L.push('');
  L.push('[[hooks.UserPromptSubmit]]');
  L.push('[[hooks.UserPromptSubmit.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-prompt'))}`);
  L.push(`timeout = ${SQUID_HOOK_DEADLINE_MS / 1_000}`);
  L.push('async = false');
  L.push('');
  L.push('[[hooks.PreToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PreToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-pre-tool'))}`);
  L.push(`timeout = ${SQUID_HOOK_DEADLINE_MS / 1_000}`);
  L.push('async = false');
  L.push('');
  L.push('[[hooks.Stop]]');
  L.push('[[hooks.Stop.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(resolve('pd-hook-stop'))}`);
  L.push(`timeout = ${SQUID_HOOK_DEADLINE_MS / 1_000}`);
  L.push('async = false');
  L.push(`# ${CODEX_PD_END_MARKER}`);
  L.push('');
  return L.join('\n');
}
