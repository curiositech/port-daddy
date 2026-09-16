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
 *   - ClaudeCliSquidAdapter is the PRIME path. Claude Code's hook surface is
 *     CONFIRMED and fires on this repo. New installs deliberately register only
 *     UserPromptSubmit plus direct-edit PreToolUse; observational PostToolUse is
 *     retained as a supported legacy event, not as installed topology.
 *   - GeminiSquidAdapter is now IMPLEMENTED. The Gemini CLI (v0.36.0) ships a
 *     Claude-compatible hook engine: settings.json `hooks` keyed by the Gemini
 *     event names (`BeforeTool`/`AfterTool`/`BeforeAgent`) with the same
 *     `{matcher, hooks:[{type:"command", command, timeout}]}` shape, regex
 *     matchers over Gemini tool names and exit-2-blocks semantics. injectHooks
 *     registers BeforeAgent plus direct-edit BeforeTool only;
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
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  AGY_TOOL_MATCHER,
  CLAUDE_TOOL_MATCHER,
  CODEX_PD_MARKER,
  GEMINI_TOOL_MATCHER,
  codexHooksTomlBlock,
  removeJsonHooks,
  stripCodexHooksTomlBlock,
} from './hook-shape.js';
import { resolveSquidAsset, squidAssetCandidates } from './assets.js';

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

export type SquidHookPurpose = 'prompt' | 'preTool' | 'postTool' | 'stop' | 'preCompact';

export interface SquidHookMetadata {
  purpose: SquidHookPurpose;
  displayName: string;
  description: string;
  privacy: string;
}

export const SQUID_HOOK_PRIVACY_NOTICE =
  'Port Daddy hooks run locally. They do not log or retain user transcripts. ' +
  'They read lifecycle event JSON only to surface coordination context, block unsafe/conflicting tool use, ' +
  'and read compact cumulative coordination facts. Any future transcript sync must be opt-in and encrypted.';

export const SQUID_HOOK_METADATA: Record<SquidHookPurpose, SquidHookMetadata> = {
  prompt: {
    purpose: 'prompt',
    displayName: 'Port Daddy pre-turn briefing (local)',
    description:
      'Reads local Port Daddy inbox, alert, and pheromone signals for this repo and may add a short coordination briefing to the next turn.',
    privacy: 'Does not store the prompt or transcript.',
  },
  preTool: {
    purpose: 'preTool',
    displayName: 'Port Daddy L2 edit gate (local)',
    description:
      'Checks local Port Daddy locks and file-claim state before file-mutating tools, honoring the repo suggestibility dial: advisory, warn, or enforce.',
    privacy: 'Does not send tool input off-machine.',
  },
  postTool: {
    purpose: 'postTool',
    displayName: 'Port Daddy legacy post-tool coordination trace (local)',
    description:
      'Legacy compatibility tentacle for retained installs and debug history; new installs use cumulative session claims and notes instead.',
    privacy: 'Does not retain full tool output or conversation transcripts.',
  },
  stop: {
    purpose: 'stop',
    displayName: 'Port Daddy end-of-turn SITREP check (local)',
    description:
      'Checks the final assistant message at end of turn for the repo’s required SITREP table, honoring the per-repo sitrep dial: off, suggest, or a single loop-guarded enforce block.',
    privacy: 'Reads only the final-message field from the lifecycle event; does not store the message or transcript.',
  },
  preCompact: {
    purpose: 'preCompact',
    displayName: 'Port Daddy cited compaction checkpoint (local)',
    description:
      'Before a verified Claude Code compaction, attempts an evidence-gated bounded lifecycle checkpoint; packet issuance is withheld unless the daemon has a provider-session binding, trusted measurement, current pd-plan, and complete tool-pair witness.',
    privacy: 'Does not copy the provider transcript; it sends only bounded lifecycle metadata to the local daemon.',
  },
};

// ─── Tentacle locations ───────────────────────────────────────────────────────

/**
 * Absolute path to a pd-hook-* tentacle binary. Resolves across the layouts we
 * actually ship in, because a compiled single-file `pd` binary has a SYNTHETIC
 * `import.meta.url` — the old `../../bin` walk from it collapsed to a bogus
 * `/bin/pd-hook-*`. We therefore prefer the running binary's own directory
 * (where the release tarball co-locates the tentacles next to `pd`, exactly as
 * it does `pd-bosun`), then a `bin/` beside it, then the dev-from-source path.
 */
export function tentaclePath(name: 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool' | 'pd-hook-stop' | 'pd-hook-precompact'): string {
  const found = resolveSquidAsset(join('bin', name));
  if (found) return found;
  // Nothing found — return the installed-layout path so the error names the
  // place a user would actually look, not a bogus `/bin/...`.
  return squidAssetCandidates(join('bin', name))[0];
}

/**
 * Stable hook command path written into vendor lifecycle configuration.
 *
 * `tentaclePath()` locates the versioned release asset so it can be staged;
 * lifecycle configuration must never retain that packaging path. Homebrew
 * removes old Cellar directories during upgrade, while this user-owned shim is
 * replaced atomically by every successful Squid repair.
 *
 * @param name Hook executable whose durable command interface is required.
 * @param pdHome Port Daddy state root that owns the stable shim directory.
 * @returns Absolute, upgrade-stable path for provider lifecycle configuration.
 */
export function hookCommandPath(
  name: 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool' | 'pd-hook-stop' | 'pd-hook-precompact',
  pdHome = process.env.PD_HOME?.trim() || join(homedir(), '.port-daddy'),
): string {
  return join(pdHome, 'bin', name);
}

/** Assert the tentacles exist and are executable; throws a clear error if not. */
export function assertTentaclesPresent(): void {
  for (const name of ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool', 'pd-hook-stop', 'pd-hook-precompact'] as const) {
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

export interface SquidProviderHookDiagnosis {
  providerName: string;
  binaryName: string;
  configPath: string;
  ok: boolean;
  detail: string;
  hint: string;
}

function hasPortDaddyHook(group: ClaudeHookMatcher | undefined, purpose: SquidHookPurpose): boolean {
  if (!group?.hooks?.some((hook) => hook.command?.includes(hookCommandPath(commandForPurpose(purpose))))) {
    return false;
  }
  const meta = SQUID_HOOK_METADATA[purpose];
  return group.name === meta.displayName && group.description === meta.description && group.privacy === meta.privacy;
}

function commandForPurpose(purpose: SquidHookPurpose): 'pd-hook-prompt' | 'pd-hook-pre-tool' | 'pd-hook-post-tool' | 'pd-hook-stop' | 'pd-hook-precompact' {
  if (purpose === 'prompt') return 'pd-hook-prompt';
  if (purpose === 'preTool') return 'pd-hook-pre-tool';
  if (purpose === 'stop') return 'pd-hook-stop';
  if (purpose === 'preCompact') return 'pd-hook-precompact';
  return 'pd-hook-post-tool';
}

function readJsonConfig(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function diagnoseJsonHookFile(
  providerName: string,
  binaryName: string,
  configPath: string,
  events: Record<string, SquidHookPurpose>,
): SquidProviderHookDiagnosis {
  const cfg = readJsonConfig(configPath);
  const hint = 'Run: pd squid on';
  if (!cfg) {
    return { providerName, binaryName, configPath, ok: false, detail: 'hook config missing or invalid JSON', hint };
  }

  const hooks = cfg.hooks as Record<string, ClaudeHookMatcher[]> | undefined;
  if (!hooks || typeof hooks !== 'object') {
    return { providerName, binaryName, configPath, ok: false, detail: 'no hooks block found', hint };
  }

  const missing: string[] = [];
  for (const [event, purpose] of Object.entries(events)) {
    const group = (hooks[event] ?? []).find((candidate) =>
      candidate.hooks?.some((hook) => hook.command?.includes(commandForPurpose(purpose))),
    );
    if (!hasPortDaddyHook(group, purpose)) {
      missing.push(`${event}:${SQUID_HOOK_METADATA[purpose].displayName}`);
    }
  }

  if (missing.length > 0) {
    return {
      providerName,
      binaryName,
      configPath,
      ok: false,
      detail: `missing or stale Port Daddy hook metadata: ${missing.join(', ')}`,
      hint,
    };
  }

  return {
    providerName,
    binaryName,
    configPath,
    ok: true,
    detail: `${Object.keys(events).length} local hooks installed with privacy metadata`,
    hint,
  };
}

function diagnoseCodexHookFile(workspaceRoot: string): SquidProviderHookDiagnosis {
  const configPath = join(workspaceRoot, '.codex', 'config.toml');
  const hint = 'Run: pd squid on';
  if (!existsSync(configPath)) {
    return { providerName: 'codex', binaryName: 'codex', configPath, ok: false, detail: 'hook config missing', hint };
  }
  const text = readFileSync(configPath, 'utf8');
  const required = [
    CODEX_PD_MARKER,
    SQUID_HOOK_PRIVACY_NOTICE,
    SQUID_HOOK_METADATA.prompt.displayName,
    SQUID_HOOK_METADATA.preTool.displayName,
    SQUID_HOOK_METADATA.stop.displayName,
    hookCommandPath('pd-hook-prompt'),
    hookCommandPath('pd-hook-pre-tool'),
    hookCommandPath('pd-hook-stop'),
  ];
  const missing = required.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    return {
      providerName: 'codex',
      binaryName: 'codex',
      configPath,
      ok: false,
      detail: 'missing or stale Port Daddy hook TOML block/metadata',
      hint,
    };
  }
  return {
    providerName: 'codex',
    binaryName: 'codex',
    configPath,
    ok: true,
    detail: '3 decision-bearing local hooks installed with privacy comments',
    hint,
  };
}

export function diagnoseSquidHookInstall(workspaceRoot: string): SquidProviderHookDiagnosis[] {
  return [
    diagnoseJsonHookFile('claude-code', 'claude', join(workspaceRoot, '.claude', 'settings.json'), {
      UserPromptSubmit: 'prompt',
      PreToolUse: 'preTool',
      Stop: 'stop',
      PreCompact: 'preCompact',
    }),
    diagnoseCodexHookFile(workspaceRoot),
    diagnoseJsonHookFile('gemini', 'gemini', join(workspaceRoot, '.gemini', 'settings.json'), {
      [GEMINI_EVENT.prompt]: 'prompt',
      [GEMINI_EVENT.preTool]: 'preTool',
      [GEMINI_EVENT.stop]: 'stop',
    }),
    diagnoseJsonHookFile('antigravity', 'agy', join(AGY_GEMINI_DIR(), 'hooks.json'), {
      UserPromptSubmit: 'prompt',
      PreToolUse: 'preTool',
      Stop: 'stop',
    }),
  ];
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
  name?: string;
  description?: string;
  privacy?: string;
  matcher?: string;
  hooks: ClaudeHookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [k: string]: unknown;
}

/** A tentacle command shaped for a Claude Code settings.json hook entry. */
function claudeHookEntry(command: string, purpose: SquidHookPurpose, matcher?: string): ClaudeHookMatcher {
  const meta = SQUID_HOOK_METADATA[purpose];
  return {
    name: meta.displayName,
    description: meta.description,
    privacy: meta.privacy,
    ...(matcher ? { matcher } : {}),
    // A no-op hook should not paint the UI on every prompt/edit. Actual
    // conflicts and coordination context still surface through the tentacle.
    hooks: [{ type: 'command', command }],
  };
}

// ─── ClaudeCliSquidAdapter — THE PRIME PATH (verified) ────────────────────────

export class ClaudeCliSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'claude-code';
  readonly binaryName = 'claude';
  readonly verified = true;

  private lastWorkspace?: string;

  /**
   * Merge the turn briefing and direct-edit gate into the workspace's
   * `.claude/settings.json`, pointing at absolute pd-hook-* binaries. Existing
   * non-PD hooks are preserved; every older PD PostToolUse entry is removed so
   * reinjection also migrates the noisy three-hook topology.
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
    removeJsonHooks(settings as Record<string, unknown>);

    const wanted: Record<string, ClaudeHookMatcher> = {
      // UserPromptSubmit has no tool matcher — it always fires.
      // Claude-only turn-time context-pressure refresh. The prompt tentacle
      // admits its bounded directive as additionalContext; PreCompact itself
      // cannot deliver systemMessage/continue.
      UserPromptSubmit: claudeHookEntry(`${hookCommandPath('pd-hook-prompt')} --interactive-context-pressure`, 'prompt'),
      // Only a decision-bearing direct edit earns a synchronous tool hook.
      PreToolUse: claudeHookEntry(hookCommandPath('pd-hook-pre-tool'), 'preTool', CLAUDE_TOOL_MATCHER),
      // End-of-turn SITREP closeout gate (ADR-0092 L4); loop-guarded in the tentacle.
      Stop: claudeHookEntry(hookCommandPath('pd-hook-stop'), 'stop'),
      // Claude Code alone has a verified PreCompact lifecycle event. This
      // tentacle is intentionally absent from Codex, Gemini, and agy configs.
      PreCompact: claudeHookEntry(hookCommandPath('pd-hook-precompact'), 'preCompact'),
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
//   PreToolUse → BeforeTool, UserPromptSubmit → BeforeAgent
//   Edit → replace, Write → write_file, Bash → run_shell_command, ...
const GEMINI_EVENT = {
  prompt: 'BeforeAgent',
  preTool: 'BeforeTool',
  postTool: 'AfterTool',
  stop: 'AfterAgent',
} as const;

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
   * Merge the turn briefing and direct-edit gate into `.gemini/settings.json`
   * under Gemini's native event names. Shell execution is excluded because the
   * gate cannot derive a canonical target from it; matching it only creates a
   * no-op process. Older PD AfterTool entries are removed during migration.
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
    cfg['hooks'] = hooks;
    removeJsonHooks(cfg);
    const wanted: Record<string, ClaudeHookMatcher> = {
      [GEMINI_EVENT.prompt]: claudeHookEntry(hookCommandPath('pd-hook-prompt'), 'prompt'),
      [GEMINI_EVENT.preTool]: claudeHookEntry(hookCommandPath('pd-hook-pre-tool'), 'preTool', GEMINI_TOOL_MATCHER),
      // Gemini's native end-of-turn event; the tentacle reads prompt_response.
      [GEMINI_EVENT.stop]: claudeHookEntry(hookCommandPath('pd-hook-stop'), 'stop'),
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
   * VALIDATION STATE (updated 2026-06-26, honestly — `verified` means "a LIVE
   * codex BLOCK of a foreign-locked edit was captured end-to-end"):
   *
   * PROVEN LIVE this slice (codex v0.139.0, real ~/.codex):
   *   - `codex exec --dangerously-bypass-hook-trust --skip-git-repo-check -C <dir>
   *     "<prompt>"` runs non-interactively with stdin closed (no hang). The
   *     `--dangerously-bypass-hook-trust` warning fires; this is the exact argv
   *     spawnVoyage now emits.
   *   - codex exec DOES fire plugin hooks: SessionStart / UserPromptSubmit /
   *     PostToolUse / Stop were observed firing on a real `codex exec` run (the
   *     trusted security-guidance/remember plugin hooks). So the hook lifecycle is
   *     live under exec, not interactive-only.
   *   - codex's apply_patch tool_input is { command:["apply_patch","<patch>"] }
   *     with the path INSIDE the patch body (no file_path) — confirmed from the
   *     binary AND a live `codex exec --json` file_change item. pd-hook-pre-tool
   *     now harvests that path and BLOCKS it (proven by direct tentacle tests +
   *     jest + selftest). THIS WAS THE REAL GAP and it is closed.
   *
   * NOT proven live this slice (why `verified` stays FALSE):
   *   - A full "codex exec actually refused the apply_patch on a foreign-locked
   *     file" capture. Reason: codex only RUNS hooks it has DISCOVERED into
   *     config.toml [hooks.state] (discovery happens via the interactive TUI
   *     trust flow). In an isolated CODEX_HOME the pd-squid plugin installed +
   *     enabled but its hooks were never discovered (no [hooks.state] written),
   *     so PreToolUse never fired there; and installing the code-executing hook
   *     plugin into the user's REAL ~/.codex was (correctly) refused as
   *     unauthorized persistence. So the tentacle's block is proven; the live
   *     codex-side refusal is not yet captured. `verified` is reserved for that.
   */
  readonly verified = false;

  private lastWorkspace?: string;

  /**
   * Merge the turn briefing and direct-edit gate into `.codex/config.toml`
   * `[hooks]` using Codex's
   * `[[hooks.<Event>]]` (matcher) + `[[hooks.<Event>.hooks]]` (type/command/
   * timeout/async) schema. No TOML library is available, so we hand-emit a valid
   * block and only append it once (idempotent on the marker comment).
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    this.lastWorkspace = workspaceRoot;

    const cfgPath = join(workspaceRoot, '.codex', 'config.toml');
    mkdirSync(dirname(cfgPath), { recursive: true });

    const block = codexHooksTomlBlock((name) => hookCommandPath(name), {
      comments: [
        `Privacy: ${SQUID_HOOK_PRIVACY_NOTICE}`,
        `${SQUID_HOOK_METADATA.prompt.displayName}: ${SQUID_HOOK_METADATA.prompt.description}`,
        `${SQUID_HOOK_METADATA.preTool.displayName}: ${SQUID_HOOK_METADATA.preTool.description}`,
        `${SQUID_HOOK_METADATA.stop.displayName}: ${SQUID_HOOK_METADATA.stop.description}`,
      ],
    });

    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
    const base = stripCodexHooksTomlBlock(existing).replace(/\s*$/, '');
    const next = `${base}${base ? '\n\n' : ''}${block}`;
    if (next === existing) return;
    writeFileSync(cfgPath, next, {
      mode: 0o644,
    });
  }

  /**
   * Spawn `codex exec <directive>` (the non-interactive subcommand) so the
   * injected hooks fire inside Codex's own lifecycle. Codex does NOT natively set
   * PD_ACTOR / PD_FLEET; we inject them via the child env.
   *
   * Flags (verified against codex v0.139.0 `codex exec --help` on 2026-06-25):
   *   --dangerously-bypass-hook-trust : Codex gates hooks behind PERSISTED trust
   *       (config.toml [hooks.state].<id>.trusted_hash + enabled). An untrusted
   *       hook is silently NOT run — which is exactly why the harness's tentacles
   *       must be force-trusted for an unattended voyage. This is the LEGITIMATE,
   *       documented automation bypass ("Intended only for automation that
   *       already vets hook sources") — the harness vets its own pd-hook-* tentacle
   *       sources, so we pass it so PreToolUse can actually fire and BLOCK.
   *   -C <cwd>            : pin the working root (the long form of --cd).
   *   --skip-git-repo-check : let a scratch / non-git workspace run.
   *
   * stdin contract (verified): `codex exec "<prompt>"` with the prompt as a
   * POSITIONAL arg still tries to read stdin ("Reading additional input from
   * stdin...") and HANGS if stdin is a live TTY/pipe. runCli already spawns with
   * stdio[0]='ignore' (an effective `</dev/null`), so the child sees EOF on stdin
   * immediately and does not block. The directive is therefore passed positionally
   * (NOT on stdin) and stdin is closed — the documented non-interactive form.
   */
  async spawnVoyage(taskDirective: string, opts: SpawnVoyageOptions = {}): Promise<VoyageResult> {
    const cwd = opts.workspaceRoot ?? this.lastWorkspace;
    if (!cwd) {
      throw new Error('[squid/adapter] codex spawnVoyage: no workspaceRoot (call injectHooks first or pass one)');
    }
    assertTentaclesPresent();

    const args = [
      'exec',
      '--dangerously-bypass-hook-trust', // vetted-automation bypass so our tentacles run
      '-C',
      cwd,
      '--skip-git-repo-check',
      taskDirective, // positional prompt; stdin is closed by runCli (stdio[0]='ignore')
      ...(opts.extraArgs ?? []),
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
      ...(opts.fleet ? { PD_FLEET: opts.fleet } : {}),
      ...(opts.env ?? {}),
    };

    return runCli(this.binaryName, args, cwd, env, opts.timeoutMs);
  }
}

// ─── AntigravitySquidAdapter (agy) — IMPLEMENTED ──────────────────────────────

// Antigravity ("agy", v1.0.12) is the live replacement for the tier-dead `gemini`
// CLI. It OAuths to ~/.gemini and ships its OWN hook engine — NOT the Gemini-CLI
// settings.json `hooks` block. Reverse-engineering the agy binary established:
//   - agy parses a Claude-shaped `hooks.json` via an internal JSONHookSpec loader
//     ("Loaded hooks.json from %s: %d named hooks" / "failed to parse hooks.json
//     at %s"). The hook event vocabulary it carries is Claude-compatible:
//     PreToolUse / PostToolUse, tool_name, file_path, matcher (all present as
//     binary strings).
//   - agy AUTO-LOADS a `hooks.json` (binary string "auto-loaded/hooks.json") from
//     a customization path rooted at GeminiDir (~/.gemini), and ALSO discovers
//     per-extension hook files (e.g. ~/.gemini/extensions/<ext>/hooks/before-tool.js).
//   - agy's BLOCK contract (verified from its own bundled `scout-block.js`
//     PreToolUse hook): stdin event { toolName, toolInput }; deny via stdout JSON
//     { hookSpecificOutput: { hookEventName:"PreToolUse", decision:"block",
//     message } }. pd-hook-pre-tool's camelCase branch now emits BOTH decision:
//     "block"+message AND permissionDecision:"deny"+reason, so the same tentacle
//     satisfies agy and Codex at once.
//
// injectHooks writes the Claude-shaped hooks.json to ~/.gemini/hooks.json (the
// auto-loaded GeminiDir path). spawnVoyage runs `agy -p "<directive>"
// --dangerously-skip-permissions` (non-interactive print + auto-approve so tool
// use proceeds and routes through the hook gate).
const AGY_GEMINI_DIR = () => process.env.GEMINI_DIR || join(homedir(), '.gemini');

interface AgyHooksFile {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [k: string]: unknown;
}

export class AntigravitySquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'antigravity';
  readonly binaryName = 'agy';
  /**
   * VALIDATION STATE (set 2026-06-26, honestly — `verified` means "a LIVE agy
   * BLOCK of a foreign-locked edit was captured end-to-end"):
   *
   * PROVEN this slice:
   *   - agy DOES ship a Claude-shaped JSON hook engine (PreToolUse/PostToolUse,
   *     tool_name/file_path/matcher, decision:"block"+message OR exit-2) — proven
   *     by reverse-engineering the agy v1.0.12 binary AND reading agy's own
   *     bundled gemini-kit `scout-block.js` blocking hook (same hookSpecificOutput
   *     shape). The tentacle emits exactly that block contract.
   *   - The auto-loaded hooks.json path is ~/.gemini/hooks.json (GeminiDir).
   *
   * NOT proven live this slice (why `verified` stays FALSE):
   *   - A full "agy actually refused the edit" capture. agy's `-p` print mode on
   *     this machine repeatedly reinterpreted a direct "edit this file" directive
   *     as a research task and NEVER invoked a file-write tool, so no PreToolUse
   *     event was ever generated for the hook to block. The block contract is
   *     proven against agy's own hook format; the live agy-side refusal was not
   *     captured. `verified` is reserved for that live capture.
   */
  readonly verified = false;

  private lastWorkspace?: string;

  /**
   * Write the turn briefing and direct-edit gate into ~/.gemini/hooks.json
   * (agy's auto-loaded GeminiDir hooks file). Existing non-PD hooks are
   * preserved and legacy PD PostToolUse entries are removed. NOTE: unlike the
   * workspace-scoped Claude/Gemini/Codex adapters,
   * agy's auto-load is HOME-scoped, so this touches ~/.gemini — callers that need
   * isolation should back it up first (the live-test harness does).
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    this.lastWorkspace = workspaceRoot;

    const cfgPath = join(AGY_GEMINI_DIR(), 'hooks.json');
    mkdirSync(dirname(cfgPath), { recursive: true });

    let cfg: AgyHooksFile = {};
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as AgyHooksFile;
      } catch {
        cfg = {}; // corrupt → start clean rather than crash (fail-open posture)
      }
    }

    const hooks = cfg.hooks ?? {};
    cfg.hooks = hooks;
    removeJsonHooks(cfg as Record<string, unknown>);
    // agy uses the Claude event names in its JSON hook engine (PreToolUse/
    // PostToolUse/UserPromptSubmit), matched on its OWN tool names plus the
    // Claude/Gemini ones, so we cast a wide matcher.
    const wanted: Record<string, ClaudeHookMatcher> = {
      UserPromptSubmit: claudeHookEntry(hookCommandPath('pd-hook-prompt'), 'prompt'),
      PreToolUse: claudeHookEntry(hookCommandPath('pd-hook-pre-tool'), 'preTool', AGY_TOOL_MATCHER),
      // Registered for parity, but agy's camelCase Stop payload is OBSERVE-ONLY
      // in the tentacle (no final-message field, no loop guard, may not fire).
      Stop: claudeHookEntry(hookCommandPath('pd-hook-stop'), 'stop'),
    };
    for (const [event, entry] of Object.entries(wanted)) {
      const existing = hooks[event] ?? [];
      const pruned = existing.filter((g) => !g.hooks?.some((h) => h.command?.includes('pd-hook-')));
      pruned.push(entry);
      hooks[event] = pruned;
    }
    cfg.hooks = hooks;

    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o644 });
  }

  /**
   * Spawn `agy -p "<directive>" --dangerously-skip-permissions` so tool calls run
   * non-interactively and route through the injected hooks. agy does NOT natively
   * set PD_ACTOR / PD_FLEET; we inject them via the child env (the lock gate reads
   * PD_ACTOR to know "self"). `-p` = single-prompt print mode; the skip-permissions
   * flag auto-approves tool actions so the voyage runs unattended.
   */
  async spawnVoyage(taskDirective: string, opts: SpawnVoyageOptions = {}): Promise<VoyageResult> {
    const cwd = opts.workspaceRoot ?? this.lastWorkspace;
    if (!cwd) {
      throw new Error('[squid/adapter] agy spawnVoyage: no workspaceRoot (call injectHooks first or pass one)');
    }
    assertTentaclesPresent();

    const args = ['-p', taskDirective, '--dangerously-skip-permissions', ...(opts.extraArgs ?? [])];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.actor ? { PD_ACTOR: opts.actor } : {}),
      ...(opts.fleet ? { PD_FLEET: opts.fleet } : {}),
      ...(opts.env ?? {}),
    };

    return runCli(this.binaryName, args, cwd, env, opts.timeoutMs);
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/** All adapters. Only `verified` ones are safe to spawn through today. */
export function squidAdapters(): GiantSquidAdapter[] {
  return [
    new ClaudeCliSquidAdapter(),
    new CodexSquidAdapter(),
    new GeminiSquidAdapter(),
    new AntigravitySquidAdapter(),
  ];
}

/** The guarantee-bearing Prime adapter (Claude Max seat). */
export function primeAdapter(): ClaudeCliSquidAdapter {
  return new ClaudeCliSquidAdapter();
}
