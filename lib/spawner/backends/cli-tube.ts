/**
 * CLI-tube backend — wrap a local agent CLI tool so it
 * looks like any other spawner backend.
 *
 * Economic motivation:
 *   A Claude Max subscriber ($200/mo flat) already has unmetered
 *   claude-code on their machine. Same shape for ChatGPT Pro + codex or
 *   other authenticated local agent CLIs such as agy.
 *   Routing fleet work through the local CLI means zero marginal cost
 *   for those operators — the daemon delegates to a process that
 *   doesn't bill per-token from this app's wallet.
 *
 * What this is:
 *   A child-process driver with optional tube transparency. The wrapper
 *   spawns the CLI in non-interactive mode, sends the prompt, collects
 *   stdout/stderr, and (optionally) publishes the result on a tube
 *   channel so any observer subscribed to `cli:<tool>:<id>` sees the
 *   exchange in real time.
 *
 * What this is NOT:
 *   A reimplementation of the CLI. We don't parse private CLI state; we
 *   invoke documented non-interactive surfaces and only parse streams that are
 *   explicitly documented/verified.
 *
 * Auth caveats (documented for operators):
 *   - `claude-code` is the user's local Claude Code CLI; on this machine
 *     the binary is `claude` (installed via `claude install`). If the
 *     user is not authenticated, the wrapper fails with a clear error
 *     telling them to run `claude auth` or `claude setup-token`.
 *   - `codex` is OpenAI's Codex CLI. Needs `OPENAI_API_KEY` or a
 *     ChatGPT Pro session. Same failure shape on missing auth.
 *
 * Wrapped CLIs run with `OTEL_SDK_DISABLED=true` and inherit a sanitized
 * env (the spawner's existing dotenv loader handles credential
 * surfacing).
 */

import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliBinarySearchPath, resolveCliBinary } from '../../cli-bin-dirs.js';
import type { CoastGuardReceipt } from '../../coast-guard.js';
import {
  withCoastGuard,
  type CoastGuardRun,
  type CoastGuardRunInput,
} from '../coast-guard-runner.js';
import {
  sameWorkspaceIdentity,
  type WorkspaceIdentity,
} from '../../workspace-identity.js';
import {
  buildCliTubeArgs,
  CLI_TUBE_PROVIDER_SPECS,
  CLI_TUBE_TOOLS,
  normalizeCodexConfigOverrides,
  type CliTubePermissionMode,
  type CliTubeProviderSpec,
  type CliTubeTool,
} from './cli-tube-provider-specs.js';
import {
  waitForCliChildProcess,
  type CliChildWaitResult,
} from './cli-tube-lifecycle.js';

export {
  CLI_TUBE_PROVIDER_SPECS,
  CLI_TUBE_TOOLS,
  normalizeCodexConfigOverrides,
};
export type { CliTubeProviderSpec, CliTubeTool };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CliTubeCoastGuardOptions {
  /** Durable agent identity recorded in the confinement receipt. */
  agentId?: string;
  /** Effective backend recorded in the confinement receipt. */
  backend?: string;
  /** Per-spawn Coast Guard controls. Enabled by default when omitted. */
  spec?: CoastGuardRunInput['spec'];
  /** Keys sourced from operator dotenv files and scrubbed from the child. */
  dotenvKeys?: CoastGuardRunInput['dotenvKeys'];
  /** Scope-derived filesystem write posture. */
  writePolicy?: CoastGuardRunInput['writePolicy'];
  /** Injectable policy environment for focused tests. */
  envSource?: CoastGuardRunInput['envSource'];
}

export interface CliTubeOptions {
  /** Which local CLI to drive. */
  cli: CliTubeTool;
  /** Prompt to send to the CLI. */
  prompt: string;
  /**
   * Optional override of the tube channel name where the wrapper
   * publishes output for any subscribed observer. Defaults to
   * `cli:<tool>:<uuid>`. Pass `null` to suppress publishing.
   */
  tube?: string | null;
  /**
   * Optional wall-clock deadline (ms) for the CLI invocation. When omitted,
   * NO deadline is enforced — the child may run indefinitely (still
   * externally observable via `onStreamLine` and the tube channel while it
   * runs). When set, the full process tree gets SIGTERM at the deadline and
   * SIGKILL after a grace period, with honest `timedOut` evidence in the
   * result. This is the CLI's own process deadline, distinct from any
   * transport/network timeout a caller may apply separately.
   */
  timeoutMs?: number;
  /** Working directory for the child process. */
  cwd?: string;
  /** Extra env vars to inject (merged on top of process.env). */
  env?: Record<string, string | undefined>;
  /**
   * Optional model override. Forwarded to the CLI when supported
   * (`--model` for claude-code, codex, agy, and other compatible CLIs).
   */
  model?: string;
  /**
   * Raw Codex CLI config overrides, forwarded as repeated `-c key=value`
   * arguments. Kept Codex-specific so other CLI backends cannot accidentally
   * inherit OpenAI-only configuration names.
   */
  codexConfig?: string[];
  /**
   * Optional tube client. When provided, the wrapper publishes the
   * final output on `tube`. When omitted, no publishing happens — the
   * wrapper is still callable, just without transparency.
   */
  tubeClient?: TubeClientLike;
  /** Optional sender label for tube publishes. */
  tubeSender?: string;
  /** Hook for tests / observers to capture the underlying ChildProcess. */
  onChild?: (child: ChildProcess) => void;
  /**
   * Live per-line hook. Streaming CLI backends emit JSONL on stdout (claude-code
   * `stream-json`, codex `--json`); stdout arrives in arbitrary chunks that may
   * split a line or carry several. This hook is called ONCE per COMPLETE line
   * (newline-terminated) as it arrives — so the caller can map each event to a
   * live transcript delta the cockpit sees mid-run, instead of waiting for the
   * full `rawStdout` at completion. A trailing partial line (no terminating
   * newline) is flushed when the child closes. Fail-soft: a throwing hook is
   * swallowed so it can never break the spawn.
   */
  onStreamLine?: (line: string) => void;
  /**
   * Optional permission mode forwarded to claude-code as `--permission-mode
   * <mode>` (only when set). `acceptEdits` lets a spawned agent edit files in
   * its workdir non-interactively; `bypassPermissions` removes all gating.
   * Unset = the CLI's default (interactive prompts), preserving prior behavior.
   * Ignored for CLIs that don't support the flag.
   */
  permissionMode?: CliTubePermissionMode;
  /** Validated harness-owned session id for native resume. */
  resumeSessionId?: string;
  /** Canonical workspace identity rechecked immediately before child spawn. */
  workspaceIdentity?: WorkspaceIdentity;
  /**
   * Receipt metadata and policy controls for Coast Guard. The wrapper itself is
   * not optional: every CLI child is routed through Coast Guard, even when this
   * object is omitted. An explicit `spec.coastGuard:false` is preserved as an
   * honest operator opt-out and produces an unconfined receipt.
   */
  coastGuard?: CliTubeCoastGuardOptions;
}

export interface CliTubeResult {
  output: string;
  exitCode: number;
  error: string | null;
  tube: string | null;
  /** Wall-clock duration of the CLI invocation in ms. */
  durationMs: number;
  /** Unmodified stdout. For codex (`--json`) and claude-code (`stream-json`)
   *  this is the JSONL event stream the caller parses into full-depth
   *  transcript turns; `output` is the extracted final answer. */
  rawStdout: string;
  /** Honest confinement receipt for an attempted child launch. */
  coastGuardReceipt: CoastGuardReceipt | null;
}

/**
 * Minimal shape of a tube client. Matches `TubeClient` from
 * `lib/tube.ts` but lives here as a local interface so the cli-tube
 * backend can be loaded without dragging the full tube module in
 * environments where the daemon isn't reachable.
 */
export interface TubeClientLike {
  publish: (
    channel: string,
    payload: unknown,
    opts?: { sender?: string },
  ) => Promise<{ ok: boolean; id?: number; error?: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_KILL_GRACE_MS = 5_000;
const TIMEOUT_KILL_CLOSE_DEADLINE_MS = 1_000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pick a fresh tube channel name for one invocation. Format keeps it
 * scannable in `pd tube list`:  `cli:<tool>:<short-uuid>`.
 */
export function generateTubeChannel(cli: CliTubeTool): string {
  const short = randomUUID().split('-')[0];
  return `cli:${cli}:${short}`;
}

/**
 * Build the argv for invoking the CLI. Pure — no side effects, easy to
 * unit-test.
 */
export function buildArgs(
  cli: CliTubeTool,
  prompt: string,
  outputPath?: string,
  model?: string,
  permissionMode?: CliTubePermissionMode,
  codexConfig?: string[],
  timeoutMs?: number,
  resumeSessionId?: string,
): { args: string[]; stdin: string | null } {
  return buildCliTubeArgs(cli, {
    prompt,
    outputPath,
    model,
    permissionMode,
    codexConfig,
    timeoutMs,
    resumeSessionId,
  });
}

/**
 * Drive a local CLI tool, optionally publishing the exchange on a tube
 * channel for observers. Returns the captured output.
 *
 * Failure modes the caller can expect:
 *   - exit code 0 + non-empty output → success
 *   - exit code != 0 with auth-related stderr → wrapped as auth error
 *     and the wrapper's `nextStep` hint is included in `error`
 *   - no `timeoutMs` (deadline) supplied → no deadline enforced; the child
 *     runs until it exits on its own, however long that takes
 *   - explicit `timeoutMs` (deadline) reached → SIGTERM then SIGKILL after
 *     5s; `error` reports the deadline miss
 *   - binary not found → ENOENT-style error; no retry
 */
export async function spawnViaCliTube(
  opts: CliTubeOptions,
): Promise<CliTubeResult> {
  const cli = opts.cli;
  const provider = (CLI_TUBE_PROVIDER_SPECS as Partial<Record<string, CliTubeProviderSpec<CliTubeTool>>>)[cli];
  if (!provider) {
    return {
      output: '',
      exitCode: 127,
      error: `Unknown CLI tube tool "${String(cli)}". Supported tools: ${CLI_TUBE_TOOLS.join(', ')}.`,
      tube: null,
      durationMs: 0,
      rawStdout: '',
      coastGuardReceipt: null,
    };
  }
  // Binary override is OPERATOR-scoped: read PD_CLI_*_BIN from process.env
  // only, never from per-spawn opts.env/spec.env — a caller-supplied env
  // must not be able to redirect which executable runs.
  // Empty or malformed PATH is acceptable here: cliBinarySearchPath filters
  // blank entries and appends PD_CLI_BIN_DIRS plus the standard user CLI dirs.
  const operatorPath = process.env.PATH ?? '';
  const resolution = resolveCliBinary(provider.defaultBinary, {
    envOverride: provider.binaryEnvOverride,
    basePath: operatorPath,
  });
  const fallbackToDefaultCommand = provider.stalePathOverrideFallback === 'default-command'
    && !resolution.found
    && isPathLikeCliOverride(resolution.override);
  const binary = fallbackToDefaultCommand ? provider.defaultBinary : resolution.command;
  if (!resolution.found && !fallbackToDefaultCommand) {
    const reason = resolution.warning || `${provider.defaultBinary} binary was not found in PATH or standard user CLI dirs.`;
    return {
      output: '',
      exitCode: 127,
      error: `${cli} CLI binary unavailable: ${reason} ${provider.authNextStep}`,
      tube: null,
      durationMs: 0,
      rawStdout: '',
      coastGuardReceipt: null,
    };
  }
  // Augment PATH with the same per-user install dirs backend-readiness checks.
  // The binary command itself comes from the same resolver readiness uses:
  // an executable operator override wins, a stale override falls back to the
  // discovered default, and per-spawn opts.env cannot redirect executable choice.
  const basePath = fallbackToDefaultCommand ? operatorPath : ((opts.env?.PATH as string | undefined) ?? operatorPath);
  const augmentedPath = cliBinarySearchPath(basePath);
  const env = {
    ...process.env,
    ...(opts.env || {}),
    PATH: augmentedPath,
    OTEL_SDK_DISABLED: 'true',
  } as Record<string, string>;
  for (const key of provider.stripEnvKeys ?? []) {
    delete env[key];
  }
  // No fallback: an absent deadline means no deadline. `deadlineMs` stays
  // `undefined` all the way down to `waitForCliChildProcess`, which then
  // schedules neither a termination timer nor process-tree polling.
  const deadlineMs = opts.timeoutMs;
  const tubeChannel = opts.tube === null ? null : (opts.tube ?? generateTubeChannel(cli));

  // For codex, we use --output-last-message to capture a clean final
  // payload (just like the spawner.ts codex backend already does). Scratch
  // goes under ~/.port-daddy (NOT the OS temp dir, which macOS purges on a
  // timer and could yank the file out from under an in-flight run).
  let tempDir: string | null = null;
  let outputPath: string | undefined;
  if (provider.outputCapture === 'last-message-file') {
    const scratchRoot = join(homedir(), '.port-daddy', 'cli-tube-scratch');
    mkdirSync(scratchRoot, { recursive: true });
    tempDir = mkdtempSync(join(scratchRoot, 'codex-'));
    outputPath = join(tempDir, 'last-message.txt');
  }

  const { args } = provider.buildArgs({
    prompt: opts.prompt,
    outputPath,
    model: opts.model,
    permissionMode: opts.permissionMode,
    codexConfig: opts.codexConfig,
    timeoutMs: deadlineMs,
    resumeSessionId: opts.resumeSessionId,
  });

  const startedAt = Date.now();

  if (
    opts.resumeSessionId
    && (
      !opts.workspaceIdentity
      || !opts.cwd
      || !sameWorkspaceIdentity(opts.cwd, opts.workspaceIdentity)
    )
  ) {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    return {
      output: '',
      exitCode: 1,
      error: 'Native resume blocked: canonical workspace identity changed before child launch.',
      tube: tubeChannel,
      durationMs: Date.now() - startedAt,
      rawStdout: '',
      coastGuardReceipt: null,
    };
  }

  const cwd = opts.cwd || process.cwd();
  let cg: CoastGuardRun;
  try {
    cg = await withCoastGuard({
      agentId: opts.coastGuard?.agentId || opts.tubeSender || `cli-tube/${cli}`,
      backend: opts.coastGuard?.backend || `cli:${cli}`,
      cmd: binary,
      args,
      env,
      workdir: cwd,
      spec: opts.coastGuard?.spec,
      dotenvKeys: opts.coastGuard?.dotenvKeys,
      writePolicy: opts.coastGuard?.writePolicy,
      envSource: opts.coastGuard?.envSource,
    });
  } catch (err) {
    // Coast Guard preparation itself failed (e.g. the in-process egress meter
    // couldn't bind a loopback port, or the workdir tripped the SBPL-injection
    // guard) before any child was spawned. No handle exists to dispose here —
    // withCoastGuard is responsible for tearing down its own partial state on
    // this path — but the codex scratch tempDir is ours and must not leak, and
    // the caller must still get a structured CliTubeResult, not a rejection.
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return {
      output: '',
      exitCode: 1,
      error: `Coast Guard confinement setup failed for ${binary}: ${(err as Error).message}`,
      tube: tubeChannel,
      durationMs: Date.now() - startedAt,
      rawStdout: '',
      coastGuardReceipt: null,
    };
  }

  let child: ChildProcess;
  try {
    child = spawnChild(cg.cmd, cg.args, {
      cwd,
      env: cg.env,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const coastGuardReceipt = cg.receipt();
    cg.dispose();
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    const attempted = cg.cmd === binary ? cg.cmd : `${cg.cmd} (Coast Guard wrapper for "${binary}")`;
    return {
      output: '',
      exitCode: 1,
      error: `Failed to spawn ${attempted}: ${(err as Error).message}`,
      tube: tubeChannel,
      durationMs: Date.now() - startedAt,
      rawStdout: '',
      coastGuardReceipt,
    };
  }
  try { opts.onChild?.(child); } catch { /* observer hooks never own child liveness */ }

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  // Live per-line dispatch. stdout arrives in arbitrary chunks (a chunk may
  // split a JSONL line or carry several), so buffer partial lines and emit each
  // COMPLETE (newline-terminated) line to onStreamLine as it lands. The
  // trailing partial (if any) is flushed on close. Fail-soft: a throwing hook
  // never breaks the spawn.
  const emitLine = opts.onStreamLine;
  let lineBuffer = '';
  function pumpStdout(text: string): void {
    if (!emitLine) return;
    lineBuffer += text;
    let nl: number;
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      try { emitLine(line); } catch { /* hook must never break the spawn */ }
    }
  }
  function flushStdout(): void {
    if (!emitLine) return;
    if (lineBuffer.length > 0) {
      const line = lineBuffer;
      lineBuffer = '';
      try { emitLine(line); } catch { /* swallow */ }
    }
  }

  const onStdoutData = (d: Buffer): void => {
    const text = d.toString();
    stdoutChunks.push(text);
    pumpStdout(text);
  };
  const onStderrData = (d: Buffer): void => {
    stderrChunks.push(d.toString());
  };

  child.stdout?.on('data', onStdoutData);
  child.stderr?.on('data', onStderrData);

  let result: CliChildWaitResult;
  let coastGuardReceipt: CoastGuardReceipt;
  try {
    result = await waitForCliChildProcess(child, {
      deadlineMs,
      killGraceMs: TIMEOUT_KILL_GRACE_MS,
      killCloseDeadlineMs: TIMEOUT_KILL_CLOSE_DEADLINE_MS,
    });
  } finally {
    child.stdout?.off('data', onStdoutData);
    child.stderr?.off('data', onStderrData);
    coastGuardReceipt = cg.receipt();
    cg.dispose();
  }

  // Flush any trailing partial line (a final JSONL line without a terminating
  // newline) so the last event is still delivered live.
  flushStdout();

  const durationMs = Date.now() - startedAt;
  const rawStdout = stdoutChunks.join('');
  const stderrText = stderrChunks.join('');

  // Codex: prefer the `--output-last-message` file (clean final
  // payload) and fall back to sanitized stdout.
  let cleanOutput = rawStdout;
  if (provider.outputCapture === 'last-message-file' && outputPath && existsSync(outputPath)) {
    try {
      const fileOut = readFileSync(outputPath, 'utf8').trim();
      if (fileOut) cleanOutput = fileOut;
    } catch { /* fall through to stdout */ }
  }

  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  let error: string | null = null;
  if (result.spawnErr) {
    if (result.spawnErr.includes('ENOENT') || result.spawnErr.includes('not found')) {
      error = `${cli} binary "${binary}" not found on PATH. Install it and retry. ${provider.authNextStep}`;
    } else if (result.timedOut) {
      error = `${cli} timed out after ${deadlineMs}ms: ${result.spawnErr}`;
    } else {
      error = `Failed to spawn ${binary}: ${result.spawnErr}`;
    }
  } else if (result.timedOut) {
    const detail = formatCliErrorDetail(stderrText || rawStdout);
    error = `${cli} timed out after ${deadlineMs}ms${detail ? `: ${detail}` : ''}`;
  } else if (result.code !== 0) {
    const failureText = stderrText || rawStdout;
    const failureLc = failureText.toLowerCase();
    if (failureLc.includes('unauthorized') || failureLc.includes('not authenticated') || failureLc.includes('please log in') || failureLc.includes('api key')) {
      error = `${cli} authentication failed. ${provider.authNextStep} (${stderrText ? 'stderr' : 'stdout'}: ${formatCliErrorDetail(failureText)})`;
    } else {
      const detail = formatCliErrorDetail(failureText);
      error = `${cli} exited with code ${result.code}${detail ? `: ${detail}` : ''}`;
    }
  } else if (provider.emptySuccess === 'fail' && !rawStdout.trim() && !stderrText.trim()) {
    const emptySuccessError = provider.emptySuccessError ?? `${cli} produced no stdout or stderr.`;
    error = `${emptySuccessError} ${provider.authNextStep}`;
  }

  // Optional: publish the result on the tube so subscribed observers
  // see what came out. Failures here never block the spawn — tube
  // publish is best-effort transparency.
  if (tubeChannel && opts.tubeClient) {
    try {
      await opts.tubeClient.publish(
        tubeChannel,
        {
          v: 1,
          kind: 'cli-tube.result',
          cli,
          ok: error === null,
          output: cleanOutput,
          error,
          durationMs,
        },
        { sender: opts.tubeSender || `cli-tube/${cli}` },
      );
    } catch { /* swallow publish errors */ }
  }

  return {
    output: cleanOutput,
    exitCode: result.code,
    error,
    tube: tubeChannel,
    durationMs,
    rawStdout,
    coastGuardReceipt,
  };
}

function isPathLikeCliOverride(value: string | undefined): boolean {
  return !!value && (value.startsWith('~') || value.includes('/') || value.includes('\\'));
}

function formatCliErrorDetail(text: string): string {
  const trimmed = text.trim();
  const max = 1_200;
  if (trimmed.length <= max) return trimmed;
  return `[truncated ${trimmed.length - max} chars] ${trimmed.slice(-max)}`;
}

// ─── Convenience: factory bound to a specific CLI ────────────────────────────

/**
 * Build a per-CLI spawn function. Mirrors the cloudflare/openai
 * adapter shape so the spawner registry can store them uniformly.
 */
export function createCliTubeBackend(opts: { cli: CliTubeTool }) {
  return (
    invocation: Omit<CliTubeOptions, 'cli'>,
  ): Promise<CliTubeResult> => spawnViaCliTube({ ...invocation, cli: opts.cli });
}
