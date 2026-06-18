/**
 * CLI-tube backend — wrap a local CLI tool (claude-code or codex) so it
 * looks like any other spawner backend.
 *
 * Economic motivation:
 *   A Claude Max subscriber ($200/mo flat) already has unmetered
 *   claude-code on their machine. Same shape for ChatGPT Pro + codex.
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
 *   A reimplementation of the CLI. We don't parse claude-code's
 *   internal protocol or codex's session state — we just invoke them.
 *
 * Auth caveats (documented for operators):
 *   - `claude-code` is the user's local Claude Code CLI; on this machine
 *     the binary is `claude` (installed via `claude install`). If the
 *     user is not authenticated, the wrapper fails with a clear error
 *     telling them to run `claude auth` or `claude setup-token`.
 *   - `codex` is OpenAI's Codex CLI. Needs `OPENAI_API_KEY` or a
 *     ChatGPT Pro session. Same failure shape on missing auth.
 *
 * Both CLIs run with `OTEL_SDK_DISABLED=true` and inherit a sanitized
 * env (the spawner's existing dotenv loader handles credential
 * surfacing).
 */

import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CliTubeTool = 'claude-code' | 'codex';

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
   * (`--model` for claude-code, `--model` for codex).
   */
  model?: string;
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
}

export interface CliTubeResult {
  output: string;
  exitCode: number;
  error: string | null;
  tube: string | null;
  /** Wall-clock duration of the CLI invocation in ms. */
  durationMs: number;
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

/**
 * The binary name used to invoke each tool. On this user's machine
 * `claude-code` is installed as `claude` (per `claude install`). Code
 * paths that need a different binary name set `PD_CLI_CLAUDE_CODE_BIN`
 * / `PD_CLI_CODEX_BIN`.
 */
const DEFAULT_BINARIES: Record<CliTubeTool, string> = {
  'claude-code': 'claude',
  codex: 'codex',
};

// Environment override key per tool — operators can swap the binary
// without code edits (helpful for `claude-stable` vs `claude-beta`).
const BINARY_ENV_OVERRIDE: Record<CliTubeTool, string> = {
  'claude-code': 'PD_CLI_CLAUDE_CODE_BIN',
  codex: 'PD_CLI_CODEX_BIN',
};

// Auth-error sentinels we surface verbatim so the operator sees
// actionable guidance. The CLIs themselves are the source of truth for
// their auth flows; we just map their errors to a helpful next step.
const AUTH_NEXT_STEP: Record<CliTubeTool, string> = {
  'claude-code': 'Run `claude setup-token` or `claude auth` to authenticate.',
  codex: 'Set OPENAI_API_KEY in ~/.codex/config or `codex auth login`.',
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
): { args: string[]; stdin: string | null } {
  if (cli === 'claude-code') {
    // `claude -p <prompt>` runs non-interactively and prints the
    // response to stdout. We pass --output-format=text for stable
    // parsing; JSON-streaming is reserved for future bidirectional
    // tube wiring.
    const args = ['-p', '--output-format=text'];
    if (model) args.push('--model', model);
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
    if (model) args.push('--model', model);
    args.push(prompt);
    return { args, stdin: null };
  }

  throw new Error(`unknown cli tool: ${cli}`);
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
  const env = { ...process.env, ...(opts.env || {}), OTEL_SDK_DISABLED: 'true' } as Record<string, string>;
  const binary = env[BINARY_ENV_OVERRIDE[cli]] || DEFAULT_BINARIES[cli];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tubeChannel = opts.tube === null ? null : (opts.tube ?? generateTubeChannel(cli));

  // For codex, we use --output-last-message to capture a clean final
  // payload (just like the spawner.ts codex backend already does).
  let tempDir: string | null = null;
  let outputPath: string | undefined;
  if (cli === 'codex') {
    tempDir = mkdtempSync(join(tmpdir(), `pd-cli-tube-codex-`));
    outputPath = join(tempDir, 'last-message.txt');
  }

  const { args } = buildArgs(cli, opts.prompt, outputPath, opts.model);

  const startedAt = Date.now();

  const child = spawnChild(binary, args, {
    cwd: opts.cwd || process.cwd(),
    env,
    detached: false,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  opts.onChild?.(child);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d.toString()));
  child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d.toString()));

  const result = await new Promise<{ code: number; timedOut: boolean; spawnErr: string | null }>((resolve) => {
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : -1, timedOut, spawnErr: null });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, timedOut: false, spawnErr: err.message });
    });
  });

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
    error = `${cli} timed out after ${timeoutMs}ms${stderrText ? `: ${stderrText.trim()}` : ''}`;
  } else if (result.code !== 0) {
    const stderrLc = stderrText.toLowerCase();
    if (stderrLc.includes('unauthorized') || stderrLc.includes('not authenticated') || stderrLc.includes('please log in') || stderrLc.includes('api key')) {
      error = `${cli} authentication failed. ${AUTH_NEXT_STEP[cli]} (stderr: ${stderrText.trim()})`;
    } else {
      error = `${cli} exited with code ${result.code}${stderrText ? `: ${stderrText.trim()}` : ''}`;
    }
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
  };
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
