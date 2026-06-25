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
 * VERIFICATION SCOPE (honest, per the ADR):
 *   - ClaudeCliSquidAdapter is the PRIME path. Claude Code's hook surface
 *     (UserPromptSubmit / PreToolUse / PostToolUse, with `exit 2` blocking) is
 *     CONFIRMED and fires on this repo. This adapter is built end-to-end.
 *   - CodexSquidAdapter / GeminiSquidAdapter are VALIDATE-THEN-ADD skeletons.
 *     They write a plausible config (config.toml / .gemini/settings.json) but
 *     their synchronous, exit-code-respecting hook parity is UNVERIFIED. Each
 *     marks itself `verified: false` and spawnVoyage throws until validated, so
 *     nothing here can be mistaken for a working cross-vendor harness.
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

// ─── CodexSquidAdapter — VALIDATE-THEN-ADD skeleton (UNVERIFIED) ──────────────

export class CodexSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'codex';
  readonly binaryName = 'codex';
  /** Codex hook parity (synchronous, exit-2-respecting) is NOT yet verified. */
  readonly verified = false;

  /**
   * Writes a Codex `config.toml` hook block referencing the tentacles. The TOML
   * key names below are a PLAUSIBLE mapping, not a confirmed schema — Codex's
   * actual hook surface must be validated before this is trusted. Marked clearly
   * so a reader cannot mistake it for a working integration.
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    const cfgPath = join(workspaceRoot, '.codex', 'config.toml');
    mkdirSync(dirname(cfgPath), { recursive: true });
    const prompt = tentaclePath('pd-hook-prompt');
    const pre = tentaclePath('pd-hook-pre-tool');
    const post = tentaclePath('pd-hook-post-tool');
    const block = [
      '# Port Daddy Giant Squid Harness tentacles (ADR-0091).',
      '# VALIDATE-THEN-ADD: Codex hook parity is UNVERIFIED. Do not rely on this',
      "# blocking tools via exit 2 until Codex's synchronous hook surface is",
      '# confirmed. The key names here are a plausible mapping only.',
      '[hooks]',
      `user_prompt_submit = "${prompt}"`,
      `pre_tool_use = "${pre}"`,
      `post_tool_use = "${post}"`,
      '',
    ].join('\n');
    const existing = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
    if (!existing.includes('Giant Squid Harness tentacles')) {
      writeFileSync(cfgPath, existing + (existing ? '\n' : '') + block, { mode: 0o644 });
    }
  }

  async spawnVoyage(): Promise<VoyageResult> {
    throw new Error(
      '[squid/adapter] CodexSquidAdapter.spawnVoyage is validate-then-add: Codex hook ' +
        'parity is unverified. Validate Codex config.toml hooks (synchronous + exit-2) ' +
        'before enabling. Refusing to claim a working harness.',
    );
  }
}

// ─── GeminiSquidAdapter — VALIDATE-THEN-ADD skeleton (UNVERIFIED) ─────────────

export class GeminiSquidAdapter implements GiantSquidAdapter {
  readonly providerName = 'gemini';
  readonly binaryName = 'gemini';
  /** Gemini hook parity is NOT yet verified. */
  readonly verified = false;

  /**
   * Writes a `.gemini/settings.json` hook block referencing the tentacles. The
   * JSON shape is a PLAUSIBLE mapping, not a confirmed schema. Marked clearly.
   */
  async injectHooks(workspaceRoot: string): Promise<void> {
    assertTentaclesPresent();
    const cfgPath = join(workspaceRoot, '.gemini', 'settings.json');
    mkdirSync(dirname(cfgPath), { recursive: true });
    let cfg: Record<string, unknown> = {};
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
      } catch {
        cfg = {};
      }
    }
    cfg['_pd_squid_note'] =
      'VALIDATE-THEN-ADD: Gemini hook parity (synchronous, exit-2) is UNVERIFIED (ADR-0091).';
    cfg['hooks'] = {
      userPromptSubmit: tentaclePath('pd-hook-prompt'),
      preToolUse: tentaclePath('pd-hook-pre-tool'),
      postToolUse: tentaclePath('pd-hook-post-tool'),
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o644 });
  }

  async spawnVoyage(): Promise<VoyageResult> {
    throw new Error(
      '[squid/adapter] GeminiSquidAdapter.spawnVoyage is validate-then-add: Gemini hook ' +
        'parity is unverified. Validate .gemini/settings.json hooks (synchronous + exit-2) ' +
        'before enabling. Refusing to claim a working harness.',
    );
  }
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
