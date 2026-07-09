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

// ─── Types ────────────────────────────────────────────────────────────────────

export type CliTubeTool = 'claude-code' | 'codex' | 'agy' | 'gemini' | 'groq' | 'grok';

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
  /** Per-spawn timeout (ms). Default 5 minutes. */
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
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
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

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEOUT_KILL_GRACE_MS = 5_000;

/**
 * The binary name used to invoke each tool. On this user's machine
 * `claude-code` is installed as `claude` (per `claude install`). Code
 * paths that need a different binary name set `PD_CLI_CLAUDE_CODE_BIN`
 * / `PD_CLI_CODEX_BIN` / the matching `PD_CLI_*_BIN`.
 */
const DEFAULT_BINARIES: Record<CliTubeTool, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  agy: 'agy',
  gemini: 'gemini',
  groq: 'groq',
  grok: 'grok',
};

// Environment override key per tool — operators can swap the binary
// without code edits (helpful for `claude-stable` vs `claude-beta`).
const BINARY_ENV_OVERRIDE: Record<CliTubeTool, string> = {
  'claude-code': 'PD_CLI_CLAUDE_CODE_BIN',
  codex: 'PD_CLI_CODEX_BIN',
  agy: 'PD_CLI_AGY_BIN',
  gemini: 'PD_CLI_GEMINI_BIN',
  groq: 'PD_CLI_GROQ_BIN',
  grok: 'PD_CLI_GROK_BIN',
};

// Auth-error sentinels we surface verbatim so the operator sees
// actionable guidance. The CLIs themselves are the source of truth for
// their auth flows; we just map their errors to a helpful next step.
const AUTH_NEXT_STEP: Record<CliTubeTool, string> = {
  'claude-code': 'Run `claude setup-token` or `claude auth` to authenticate.',
  codex: 'Set OPENAI_API_KEY in ~/.codex/config or `codex auth login`.',
  agy: 'Run `agy --print "hello"` once interactively to confirm authentication.',
  gemini: 'Run `gemini` once interactively to sign in, or set GEMINI_API_KEY.',
  groq: 'Run `groq` once interactively to sign in, or set GROQ_API_KEY.',
  grok: 'Run `grok` once interactively to sign in, or set GROK_API_KEY / XAI_API_KEY.',
};

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
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions',
  codexConfig?: string[],
  timeoutMs?: number,
): { args: string[]; stdin: string | null } {
  // A model equal to the backend/CLI's own name is a placeholder that leaked
  // from default resolution (backend "cli:claude-code" → model "claude-code").
  // The CLIs reject it with "model not supported". Map the placeholder to a real
  // per-CLI default so spawns get EXACT, billable telemetry instead of an
  // estimate (which the cost gate then rejects); for CLIs without a known good
  // default, drop `--model` so the CLI uses its authenticated account's default.
  //
  // `claude-cli` / `codex-cli` are the OTHER placeholder spelling: lib/spawner.ts
  // DEFAULT_MODELS maps `cli:claude-code` → "claude-cli" and `cli:codex` →
  // "codex-cli" ("the CLI manages its own model"). When that sentinel reaches
  // here as the model it must be treated as a placeholder too — otherwise
  // `claude --model claude-cli` fails with "model may not exist" and every
  // sentinel-model spawn dies (the bug that made cli:claude-code look broken).
  const PLACEHOLDER_MODELS = new Set([
    'claude-code', 'codex', 'agy', 'gemini', 'groq', 'grok',
    'claude-cli', 'codex-cli', 'agy-cli', 'agy-default', 'default', 'cli',
  ]);
  const CLI_DEFAULT_MODEL: Partial<Record<CliTubeTool, string>> = {
    'claude-code': 'sonnet', // a real Claude model the CLI + rate table both accept
  };
  const isPlaceholder = !model || PLACEHOLDER_MODELS.has(model);
  const effModel = isPlaceholder ? CLI_DEFAULT_MODEL[cli] : model;

  if (cli === 'claude-code') {
    // `claude -p` runs non-interactively. `--output-format stream-json
    // --verbose` emits one JSON object per line, including thinking /
    // tool_use / tool_result blocks, so the spawner can record the FULL
    // conversation (not just the final answer). The caller recovers the
    // final answer from the terminal `result` line (extractClaudeCodeFinal).
    // OAuth-safe: works with no ANTHROPIC_API_KEY (spawnViaCliTube strips it).
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (effModel) args.push('--model', effModel);
    // `--permission-mode acceptEdits` lets the spawned agent edit files in its
    // workdir without an interactive prompt (non-interactive `-p` runs would
    // otherwise block on the permission gate). Only forwarded when set, so the
    // default spawn keeps the CLI's default gating.
    if (permissionMode) args.push('--permission-mode', permissionMode);
    args.push(prompt);
    return { args, stdin: null };
  }

  if (cli === 'codex') {
    // `codex exec` is the non-interactive entry point. Mirror the
    // spawner's existing codex invocation: skip-git-repo-check +
    // full-auto + workspace-write sandbox so the tube wrapper behaves
    // like the codex backend operators are used to.
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--full-auto',
      '--sandbox', 'workspace-write',
      '--json',
    ];
    if (outputPath) args.push('--output-last-message', outputPath);
    if (effModel) args.push('--model', effModel);
    for (const config of normalizeCodexConfigOverrides(codexConfig)) {
      args.push('-c', config);
    }
    args.push(prompt);
    return { args, stdin: null };
  }

  if (cli === 'agy') {
    // `agy --print <prompt>` is the documented non-interactive surface. It
    // prints a final response to stdout and currently has no JSONL stream, so
    // Port Daddy records the prompt plus the final stdout/stderr transcript path
    // instead of claiming structured streaming.
    const args = ['--print'];
    if (effModel) args.push('--model', effModel);
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      args.push('--print-timeout', `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`);
    }
    args.push(prompt);
    return { args, stdin: null };
  }

  if (cli === 'gemini' || cli === 'groq' || cli === 'grok') {
    // All three agent CLIs share the claude-code-style headless surface:
    // `-p <prompt>` runs one non-interactive turn and prints the response
    // to stdout; `--model` overrides the model. (Gemini CLI, Groq Code
    // CLI, and Grok CLI all follow this convention.)
    const args = ['-p'];
    if (effModel) args.push('--model', effModel);
    args.push(prompt);
    return { args, stdin: null };
  }

  throw new Error(`unknown cli tool: ${cli}`);
}

const CODEX_CONFIG_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAX_CODEX_CONFIG_OVERRIDES = 32;
const MAX_CODEX_CONFIG_OVERRIDE_LENGTH = 512;

export function normalizeCodexConfigOverrides(configs: readonly string[] | undefined | null): string[] {
  const normalized: string[] = [];
  for (const raw of configs ?? []) {
    if (typeof raw !== 'string') continue;
    const config = raw.trim();
    if (!config) continue;
    if (normalized.length >= MAX_CODEX_CONFIG_OVERRIDES) {
      throw new Error(`Too many Codex config overrides; maximum is ${MAX_CODEX_CONFIG_OVERRIDES}`);
    }
    if (config.length > MAX_CODEX_CONFIG_OVERRIDE_LENGTH || /[\0\r\n]/.test(config)) {
      throw new Error(`Invalid Codex config override "${config}": value is too long or contains a control character`);
    }
    const separator = config.indexOf('=');
    const key = separator > 0 ? config.slice(0, separator).trim() : '';
    if (!key || !CODEX_CONFIG_KEY.test(key)) {
      throw new Error(`Invalid Codex config override "${config}": expected key=value with a simple key`);
    }
    normalized.push(config);
  }
  return normalized;
}

/**
 * Drive a local CLI tool, optionally publishing the exchange on a tube
 * channel for observers. Returns the captured output.
 *
 * Failure modes the caller can expect:
 *   - exit code 0 + non-empty output → success
 *   - exit code != 0 with auth-related stderr → wrapped as auth error
 *     and the wrapper's `nextStep` hint is included in `error`
 *   - timeout → SIGTERM then SIGKILL after 5s; `error` reports timeout
 *   - binary not found → ENOENT-style error; no retry
 */
export async function spawnViaCliTube(
  opts: CliTubeOptions,
): Promise<CliTubeResult> {
  const cli = opts.cli;
  // Binary override is OPERATOR-scoped: read PD_CLI_*_BIN from process.env
  // only, never from per-spawn opts.env/spec.env — a caller-supplied env
  // must not be able to redirect which executable runs.
  // Empty or malformed PATH is acceptable here: cliBinarySearchPath filters
  // blank entries and appends PD_CLI_BIN_DIRS plus the standard user CLI dirs.
  const operatorPath = process.env.PATH ?? '';
  const resolution = resolveCliBinary(DEFAULT_BINARIES[cli], {
    envOverride: BINARY_ENV_OVERRIDE[cli],
    basePath: operatorPath,
  });
  const fallbackToDefaultCommand = cli === 'claude-code'
    && !resolution.found
    && isPathLikeCliOverride(resolution.override);
  const binary = fallbackToDefaultCommand ? DEFAULT_BINARIES[cli] : resolution.command;
  if (!resolution.found && !fallbackToDefaultCommand) {
    const reason = resolution.warning || `${DEFAULT_BINARIES[cli]} binary was not found in PATH or standard user CLI dirs.`;
    return {
      output: '',
      exitCode: 127,
      error: `${cli} CLI binary unavailable: ${reason}`,
      tube: null,
      durationMs: 0,
      rawStdout: '',
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
  // claude-code manages its own OAuth (Claude Max). An ANTHROPIC_API_KEY in
  // the environment overrides OAuth and breaks auth ("Invalid API key"), so
  // strip it for this CLI — mirrors runClaudeCli's handling.
  if (cli === 'claude-code') {
    delete env.ANTHROPIC_API_KEY;
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tubeChannel = opts.tube === null ? null : (opts.tube ?? generateTubeChannel(cli));

  // For codex, we use --output-last-message to capture a clean final
  // payload (just like the spawner.ts codex backend already does). Scratch
  // goes under ~/.port-daddy (NOT the OS temp dir, which macOS purges on a
  // timer and could yank the file out from under an in-flight run).
  let tempDir: string | null = null;
  let outputPath: string | undefined;
  if (cli === 'codex') {
    const scratchRoot = join(homedir(), '.port-daddy', 'cli-tube-scratch');
    mkdirSync(scratchRoot, { recursive: true });
    tempDir = mkdtempSync(join(scratchRoot, 'codex-'));
    outputPath = join(tempDir, 'last-message.txt');
  }

  const { args } = buildArgs(cli, opts.prompt, outputPath, opts.model, opts.permissionMode, opts.codexConfig, timeoutMs);

  const startedAt = Date.now();

  const child = spawnChild(binary, args, {
    cwd: opts.cwd || process.cwd(),
    env,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  opts.onChild?.(child);

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

  child.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    stdoutChunks.push(text);
    pumpStdout(text);
  });
  child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d.toString()));

  const result = await new Promise<{ code: number; timedOut: boolean; spawnErr: string | null }>((resolve) => {
    let settled = false;
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let forcedResolveTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (code: number, spawnErr: string | null = null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (forcedResolveTimer) clearTimeout(forcedResolveTimer);
      resolve({ code, timedOut, spawnErr });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalCliChildProcess(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        signalCliChildProcess(child, 'SIGKILL');
        forcedResolveTimer = setTimeout(() => {
          detachCliChildProcess(child);
          settle(-1);
        }, 1_000);
        forcedResolveTimer.unref?.();
      }, TIMEOUT_KILL_GRACE_MS);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.on('close', (code) => {
      settle(typeof code === 'number' ? code : -1);
    });
    child.on('error', (err) => {
      settle(-1, err.message);
    });
  });

  // Flush any trailing partial line (a final JSONL line without a terminating
  // newline) so the last event is still delivered live.
  flushStdout();

  const durationMs = Date.now() - startedAt;
  const rawStdout = stdoutChunks.join('');
  const stderrText = stderrChunks.join('');

  // Codex: prefer the `--output-last-message` file (clean final
  // payload) and fall back to sanitized stdout.
  let cleanOutput = rawStdout;
  if (cli === 'codex' && outputPath && existsSync(outputPath)) {
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
      error = `${cli} binary "${binary}" not found on PATH. Install it and retry. ${AUTH_NEXT_STEP[cli]}`;
    } else {
      error = `Failed to spawn ${binary}: ${result.spawnErr}`;
    }
  } else if (result.timedOut) {
    const detail = formatCliErrorDetail(stderrText || rawStdout);
    error = `${cli} timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ''}`;
  } else if (result.code !== 0) {
    const failureText = stderrText || rawStdout;
    const failureLc = failureText.toLowerCase();
    if (failureLc.includes('unauthorized') || failureLc.includes('not authenticated') || failureLc.includes('please log in') || failureLc.includes('api key')) {
      error = `${cli} authentication failed. ${AUTH_NEXT_STEP[cli]} (${stderrText ? 'stderr' : 'stdout'}: ${formatCliErrorDetail(failureText)})`;
    } else {
      const detail = formatCliErrorDetail(failureText);
      error = `${cli} exited with code ${result.code}${detail ? `: ${detail}` : ''}`;
    }
  } else if (cli === 'agy' && !rawStdout.trim() && !stderrText.trim()) {
    error = `agy produced no stdout or stderr in print mode. ${AUTH_NEXT_STEP.agy}`;
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
  };
}

function isPathLikeCliOverride(value: string | undefined): boolean {
  return !!value && (value.startsWith('~') || value.includes('/') || value.includes('\\'));
}

function signalCliChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back for non-detached or mocked processes.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best effort; timeout handling owns the final result.
  }
}

function detachCliChildProcess(child: ChildProcess): void {
  try { child.stdout?.destroy(); } catch {}
  try { child.stderr?.destroy(); } catch {}
  try { child.unref?.(); } catch {}
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
