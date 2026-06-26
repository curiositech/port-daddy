/**
 * The Cephalopod Adapter (ADR-0091, Giant Squid Harness)
 * ======================================================
 *
 * The Giant Squid does NOT run the agent loop — Anthropic / Google / OpenAI
 * already built optimized token-streaming + retry engines. The adapter's sole
 * job is to (a) sink our pd-hook-* tentacles into the vendor CLI's native hook
 * surface (`injectHooks`) and (b) spawn the vendor CLI on a task so those hooks
 * fire inside the vendor's own lifecycle (`spawnVoyage`).
 *
 * VERIFICATION SCOPE (honest, per the ADR — updated 2026-06-25):
 *   - ClaudeCliSquidAdapter is the PRIME path. Claude Code's hook surface
 *     (UserPromptSubmit / PreToolUse / PostToolUse, with `exit 2` blocking) is
 *     CONFIRMED and fires on this repo. This adapter is built end-to-end.
 *   - GeminiSquidAdapter is now IMPLEMENTED. The Gemini CLI (v0.36.0) ships a
 *     Claude-compatible hook engine: settings.json `hooks` keyed by the Gemini
 *     event names (`BeforeTool`/`AfterTool`/`BeforeAgent`) with the same
 *     `{matcher, hooks:[{type:"command", command, timeout}]}` shape, regex
 *     matchers over Gemini tool names (`replace|write_file|run_shell_command`),
 *     and exit-2-blocks semantics. injectHooks writes that native shape;
 *     spawnVoyage launches `gemini -p --approval-mode auto_edit` with PD_ACTOR /
 *     PD_FLEET injected. `verified` reflects exactly what was proved at build
 *     time (see the flag's comment below).
 *   - CodexSquidAdapter is now IMPLEMENTED. Codex CLI (v0.139.0) ships a hook
 *     engine (`[hooks]` in config.toml, `--dangerously-bypass-hook-trust` flag).
 *     injectHooks hand-emits valid TOML `[[hooks.PreToolUse]]` blocks;
 *     spawnVoyage launches `codex exec`. `verified` reflects exactly what was
 *     proved (see the flag's comment below). The tentacles answer Codex's
 *     deny-via-stdout-JSON contract in addition to Claude/Gemini exit-2.
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// ─── Interface (verbatim from ADR §3, plus a `verified` honesty flag) ─────────

export interface GiantSquidAdapter {
  /** Human name of the vendor ("claude-code", "codex", "gemini"). */
  providerName: string;
  /** The CLI binary that runs the loop ("claude", "codex", "gemini"). */
  binaryName: string;
  /**
   * Whether this adapter's hook surface is CONFIRMED to fire with the documented
   * semantics. `true` only for Claude Code in this slice. `false` adapters are
   * validate-then-add: injectHooks writes config, but spawnVoyage refuses to
   * claim a working harness.
   */
  verified: boolean;

  /** Sink the pd-hook-* tentacles into the vendor's native hook config. */
  injectHooks(workspaceRoot: string): Promise<void>;

  /** Spawn the vendor CLI on the task so the injected hooks fire. */
  spawnVoyage(taskDirective: string, opts?: SpawnVoyageOptions): Promise<VoyageResult>;
}

export interface SpawnVoyageOptions {
  /** Workspace to run in. Defaults to the one passed to injectHooks. */
  workspaceRoot?: string;
  /** Actor identity stamped into PD_ACTOR so the lock gate knows "self". */
  actor?: string;
  /** Per-fleet matrix shard, if any. */
  fleet?: string;
  /** Extra env for the child. */
  env?: Record<string, string>;
  /** Kill the voyage after this many ms. */
  timeoutMs?: number;
  /** Extra CLI args appended after the standard ones. */
  extraArgs?: string[];
}

export interface VoyageResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// ─── Tentacle locations ───────────────────────────────────────────────────────

const __adapter_dir = dirname(fileURLToPath(import.meta.url));

/** Absolute path to a pd-hook-* tentacle binary shipped in `bin/`. */
export function tentaclePath(name: 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool'): string {
  // lib/squid/adapter.ts → ../../bin/<name>
  return resolve(__adapter_dir, '..', '..', 'bin', name);
}

/** Assert the tentacles exist and are executable; throws a clear error if not. */
export function assertTentaclesPresent(): void {
  for (const name of ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'] as const) {
    const p = tentaclePath(name);
    if (!existsSync(p)) {
      throw new Error(`[squid/adapter] missing tentacle binary: ${p}`);
    }
    // Best-effort: ensure +x (a fresh checkout may have lost the mode bit).
    try {
      chmodSync(p, 0o755);
    } catch {
      /* non-fatal */
    }
  }
}

// ─── Shared spawn helper ──────────────────────────────────────────────────────

function runCli(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
): Promise<VoyageResult> {
  return new Promise((resolveP) => {
    let child: ChildProcess;
    try {
      child = spawnChild(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolveP({ code: 127, stdout: '', stderr: String((err as Error).message) });
      return;
    }
    let out = '';
    let errOut = '';
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }, timeoutMs);
    }
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (errOut += d.toString()));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolveP({ code: 127, stdout: out, stderr: errOut + String(err.message) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolveP({ code, stdout: out, stderr: errOut });
    });
  });
}

// ─── Claude Code hooks settings shape ─────────────────────────────────────────

interface ClaudeHookCommand {
  type: 'command';
  command: string;
}
interface ClaudeHookMatcher {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [k: string]: unknown;
}

/** A tentacle command shaped for a Claude Code settings.json hook entry. */
function claudeHookEntry(command: string, matcher?: string): ClaudeHookMatcher {
  return { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] };
}

// ─── ClaudeCliSquidAdapter — THE PRIME PATH (verified) ────────────────────────

export class ClaudeCliSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'claude-code';
  readonly binaryName = 'claude';
  readonly verified = true;

  private lastWorkspace?: string;

  /**
   * Merge our three tentacles into the workspace's `.claude/settings.json` under
   * `hooks.{UserPromptSubmit,PreToolUse,PostToolUse}`, pointing at the ABSOLUTE
   * pd-hook-* binaries. Existing non-PD hooks are preserved; our entries are
   * upserted idempotently (re-running injectHooks does not duplicate them).
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    this.lastWorkspace = workspaceRoot;

    const settingsPath = join(workspaceRoot, '.claude', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });

    let settings: ClaudeSettings = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
      } catch {
        // Corrupt settings → start clean rather than crash. The vendor loop must
        // boot even if a previous writer left junk (ADR fail-open posture).
        settings = {};
      }
    }
    settings.hooks ??= {};

    const wanted: Record<string, ClaudeHookMatcher> = {
      // UserPromptSubmit has no tool matcher — it always fires.
      UserPromptSubmit: claudeHookEntry(tentaclePath('pd-hook-prompt')),
      // PreToolUse / PostToolUse match the file-mutating tools we gate on.
      PreToolUse: claudeHookEntry(tentaclePath('pd-hook-pre-tool'), 'Edit|Write|MultiEdit|NotebookEdit'),
      PostToolUse: claudeHookEntry(tentaclePath('pd-hook-post-tool'), 'Edit|Write|MultiEdit|NotebookEdit'),
    };

    for (const [event, entry] of Object.entries(wanted)) {
      const cmd = entry.hooks[0].command;
      const existing = settings.hooks[event] ?? [];
      // Drop any prior PD tentacle entry for this event (idempotent upsert).
      const pruned = existing.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('pd-hook-')),
      );
      pruned.push(entry);
      settings.hooks[event] = pruned;
      void cmd;
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o644 });
  }

  /**
   * Spawn `claude -p <directive>` in the workspace so the injected hooks fire
   * inside Claude Code's own lifecycle. We pass `--output-format json` for exact
   * usage (matching lib/spawner.ts runClaudeCli) and strip ANTHROPIC_API_KEY so
   * the Max OAuth seat is used (zero-marginal-cost Prime, ADR G4).
   *
   * NOTE: this is the SAME launch contract as lib/spawner.ts::runClaudeCli — the
   * harness reuses that path; the only addition is injectHooks() ran first so the
   * tentacles are wired. The wiring (a single injection call site) is added in
   * lib/spawner.ts behind `spec.injectSquidHooks`.
   */
  async spawnVoyage(taskDirective: string, opts: SpawnVoyageOptions = {}): Promise<VoyageResult> {
    const cwd = opts.workspaceRoot ?? this.lastWorkspace;
    if (!cwd) {
      throw new Error('[squid/adapter] spawnVoyage: no workspaceRoot (call injectHooks first or pass one)');
    }
    assertTentaclesPresent();

    const args = ['-p', '--output-format', 'json', taskDirective, ...(opts.extraArgs ?? [])];

    // Strip ANTHROPIC_API_KEY so the CLI uses its own OAuth (Max seat) — see
    // lib/spawner.ts runClaudeCli for the same rationale.
    const { ANTHROPIC_API_KEY: _drop, ...baseEnv } = process.env;
    const homeBin = join(process.env.HOME || '', '.local', 'bin');
    const curPath = process.env.PATH || '';
    const augmentedPath = curPath.includes('.local/bin') ? curPath : `${homeBin}:${curPath}`;

    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      PATH: augmentedPath,
      // The lock gate needs to know who "self" is so an agent isn't blocked on
      // its own lock; the prompt/post hooks stamp pheromones with this actor.
      ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
      ...(opts.fleet ? { PD_FLEET: opts.fleet } : {}),
      ...(opts.env ?? {}),
    };

    return runCli(this.binaryName, args, cwd, env, opts.timeoutMs);
  }
}

// ─── Gemini hooks settings shape ──────────────────────────────────────────────

// The Gemini CLI (v0.36.0) hook engine maps Claude event names to its own and
// reads settings.json `hooks` keyed by the GEMINI event names, with the SAME
// per-event array of `{ matcher, hooks: [{ type:"command", command, timeout }] }`
// that Claude uses. Confirmed by reading the installed bundle's EVENT_MAPPING +
// TOOL_NAME_MAPPING + migrateClaudeHooks (gemini.js @ ~255485):
//   PreToolUse → BeforeTool, PostToolUse → AfterTool, UserPromptSubmit → BeforeAgent
//   Edit → replace, Write → write_file, Bash → run_shell_command, ...
const GEMINI_EVENT = {
  prompt: 'BeforeAgent',
  preTool: 'BeforeTool',
  postTool: 'AfterTool',
} as const;

/** Regex matcher over GEMINI tool names that mutate files or run shell. */
const GEMINI_TOOL_MATCHER = 'replace|write_file|edit|run_shell_command';

// ─── GeminiSquidAdapter — IMPLEMENTED ─────────────────────────────────────────

export class GeminiSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'gemini';
  readonly binaryName = 'gemini';
  /**
   * VALIDATION STATE (set 2026-06-25, honestly):
   *   `true` here means the hook CONTRACT is proven: the Gemini-format event
   *   JSON the CLI sends a BeforeTool hook is fed to pd-hook-pre-tool and the
   *   tentacle EXIT-2-BLOCKS a foreign-locked file (contract-simulated, see
   *   scripts/squid-selftest.sh "Gemini" cases + tests/unit/squid-harness).
   *   The native CLI hook SURFACE (settings.json `hooks` keyed by BeforeTool/
   *   AfterTool/BeforeAgent with this matcher shape) is confirmed by reading the
   *   installed gemini v0.36.0 bundle. A full live end-to-end "gemini actually
   *   blocked the edit" run was NOT captured non-interactively in this slice;
   *   that is the remaining gap, called out in the harness report. So we set
   *   `verified=false` until a live block is captured — the tentacle contract is
   *   proven but the live CLI loop is not yet, and this flag must mean "live".
   */
  readonly verified = false;

  private lastWorkspace?: string;

  /**
   * Merge the three tentacles into `.gemini/settings.json` under
   * `hooks.{BeforeAgent,BeforeTool,AfterTool}` using Gemini's native event names
   * and a regex matcher over Gemini tool names. Non-PD hooks are preserved; PD
   * entries are upserted idempotently (mirrors the Claude adapter).
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    this.lastWorkspace = workspaceRoot;

    const cfgPath = join(workspaceRoot, '.gemini', 'settings.json');
    mkdirSync(dirname(cfgPath), { recursive: true });

    let cfg: Record<string, unknown> = {};
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
      } catch {
        cfg = {}; // corrupt → start clean rather than crash (fail-open posture)
      }
    }

    const hooks = (cfg['hooks'] as Record<string, ClaudeHookMatcher[]>) ?? {};
    const wanted: Record<string, ClaudeHookMatcher> = {
      [GEMINI_EVENT.prompt]: claudeHookEntry(tentaclePath('pd-hook-prompt')),
      [GEMINI_EVENT.preTool]: claudeHookEntry(tentaclePath('pd-hook-pre-tool'), GEMINI_TOOL_MATCHER),
      [GEMINI_EVENT.postTool]: claudeHookEntry(tentaclePath('pd-hook-post-tool'), GEMINI_TOOL_MATCHER),
    };
    for (const [event, entry] of Object.entries(wanted)) {
      const existing = hooks[event] ?? [];
      const pruned = existing.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('pd-hook-')),
      );
      pruned.push(entry);
      hooks[event] = pruned;
    }
    cfg['hooks'] = hooks;

    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o644 });
  }

  /**
   * Spawn `gemini -p <directive> --approval-mode auto_edit` so the injected hooks
   * fire inside Gemini's own lifecycle. Gemini does NOT natively set PD_ACTOR /
   * PD_FLEET, so we inject them via the child env — the lock gate reads them to
   * know "self".
   */
  async spawnVoyage(taskDirective: string, opts: SpawnVoyageOptions = {}): Promise<VoyageResult> {
    const cwd = opts.workspaceRoot ?? this.lastWorkspace;
    if (!cwd) {
      throw new Error('[squid/adapter] gemini spawnVoyage: no workspaceRoot (call injectHooks first or pass one)');
    }
    assertTentaclesPresent();

    // -p = non-interactive (headless); auto_edit auto-approves edit tools so the
    // voyage runs unattended but still routes every tool through the hook gate.
    const args = ['-p', taskDirective, '--approval-mode', 'auto_edit', ...(opts.extraArgs ?? [])];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
      ...(opts.fleet ? { PD_FLEET: opts.fleet } : {}),
      ...(opts.env ?? {}),
    };

    return runCli(this.binaryName, args, cwd, env, opts.timeoutMs);
  }
}

// ─── CodexSquidAdapter — IMPLEMENTED ──────────────────────────────────────────

export class CodexSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'codex';
  readonly binaryName = 'codex';
  /**
   * VALIDATION STATE (set 2026-06-25, honestly):
   *   The Codex CLI (v0.139.0) exposes a hook engine (`[hooks]` in config.toml,
   *   `--dangerously-bypass-hook-trust` flag confirmed in `codex exec --help`).
   *   pd-hook-pre-tool answers Codex's deny contract: when invoked with a Codex
   *   event (`toolName`/`toolInput`) it emits exit-0 + stdout
   *   `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":
   *   "deny",...}}` (Codex's documented gate) — proven contract-simulated in the
   *   selftest. A full live `codex exec` block run was NOT captured in this slice
   *   (hook trust + a live model turn are required), so `verified` stays `false`:
   *   the flag is reserved to mean "live block captured".
   */
  readonly verified = false;

  private lastWorkspace?: string;

  /**
   * Merge the tentacles into `.codex/config.toml` `[hooks]` using Codex's
   * `[[hooks.<Event>]]` (matcher) + `[[hooks.<Event>.hooks]]` (type/command/
   * timeout/async) schema. No TOML library is available, so we hand-emit a valid
   * block and only append it once (idempotent on the marker comment).
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    this.lastWorkspace = workspaceRoot;

    const cfgPath = join(workspaceRoot, '.codex', 'config.toml');
    mkdirSync(dirname(cfgPath), { recursive: true });

    const block = codexHooksTomlBlock({
      prompt: tentaclePath('pd-hook-prompt'),
      pre: tentaclePath('pd-hook-pre-tool'),
      post: tentaclePath('pd-hook-post-tool'),
    });

    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
    if (existing.includes(CODEX_PD_MARKER)) {
      return; // already injected — idempotent
    }
    writeFileSync(cfgPath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + block, {
      mode: 0o644,
    });
  }

  /**
   * Spawn `codex exec <directive>` (the non-interactive subcommand) so the
   * injected hooks fire inside Codex's own lifecycle. Codex does NOT natively set
   * PD_ACTOR / PD_FLEET; we inject them via the child env. `--cd <cwd>` pins the
   * workspace and `--skip-git-repo-check` lets a scratch workdir run.
   */
  async spawnVoyage(taskDirective: string, opts: SpawnVoyageOptions = {}): Promise<VoyageResult> {
    const cwd = opts.workspaceRoot ?? this.lastWorkspace;
    if (!cwd) {
      throw new Error('[squid/adapter] codex spawnVoyage: no workspaceRoot (call injectHooks first or pass one)');
    }
    assertTentaclesPresent();

    const args = ['exec', '--cd', cwd, '--skip-git-repo-check', taskDirective, ...(opts.extraArgs ?? [])];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
      ...(opts.fleet ? { PD_FLEET: opts.fleet } : {}),
      ...(opts.env ?? {}),
    };

    return runCli(this.binaryName, args, cwd, env, opts.timeoutMs);
  }
}

// ─── Codex TOML emitter (no TOML dep available) ───────────────────────────────

const CODEX_PD_MARKER = 'Port Daddy Giant Squid Harness tentacles (ADR-0091)';

/** Codex tool-name regex covering edit + shell tools (Codex tool naming). */
const CODEX_TOOL_MATCHER = 'apply_patch|edit|write|str_replace_editor|shell|run_shell_command';

/** TOML basic-string escape (backslash + double-quote). */
function tomlString(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Hand-emit a valid Codex `[hooks]` TOML block. Codex's schema (v0.139.0):
 *   [[hooks.PreToolUse]]            # array-of-tables, one per matcher group
 *   matcher = "<regex>"
 *   [[hooks.PreToolUse.hooks]]      # the commands to run for that group
 *   type = "command"
 *   command = "<abs path>"
 *   timeout = 10
 *   async = false                   # PreToolUse must be SYNC to block
 * PostToolUse is async (fire-and-forget pheromone). UserPromptSubmit is sync.
 */
function codexHooksTomlBlock(t: { prompt: string; pre: string; post: string }): string {
  const L: string[] = [];
  L.push(`# ${CODEX_PD_MARKER}.`);
  L.push('# PreToolUse is synchronous so pd-hook-pre-tool can BLOCK a foreign-locked');
  L.push('# file (exit 2 + stderr, OR exit 0 + permissionDecision:"deny" JSON on stdout).');
  L.push('# PostToolUse is async (pheromone append). UserPromptSubmit is sync (envelope).');
  L.push('');
  // UserPromptSubmit (sync)
  L.push('[[hooks.UserPromptSubmit]]');
  L.push('[[hooks.UserPromptSubmit.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(t.prompt)}`);
  L.push('timeout = 10');
  L.push('async = false');
  L.push('');
  // PreToolUse (sync, the enforced gate)
  L.push('[[hooks.PreToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PreToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(t.pre)}`);
  L.push('timeout = 10');
  L.push('async = false');
  L.push('');
  // PostToolUse (async pheromone)
  L.push('[[hooks.PostToolUse]]');
  L.push(`matcher = ${tomlString(CODEX_TOOL_MATCHER)}`);
  L.push('[[hooks.PostToolUse.hooks]]');
  L.push('type = "command"');
  L.push(`command = ${tomlString(t.post)}`);
  L.push('timeout = 10');
  L.push('async = true');
  L.push('');
  return L.join('\n');
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/** All adapters. Only `verified` ones are safe to spawn through today. */
export function squidAdapters(): GiantSquidAdapter[] {
  return [new ClaudeCliSquidAdapter(), new CodexSquidAdapter(), new GeminiSquidAdapter()];
}

/** The guarantee-bearing Prime adapter (Claude Max seat). */
export function primeAdapter(): ClaudeCliSquidAdapter {
  return new ClaudeCliSquidAdapter();
}
