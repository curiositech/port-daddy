/**
 * CLI self-speech liveness (ADR-0045 — loud-fail doctrine turned on our own tools).
 *
 * The failure this exists to catch: a tool we depend on produces ZERO output
 * where output was expected. That is a LIVENESS FAILURE of the tool, not "no
 * results" — and it must be detected immediately, not inferred after an hour of
 * confusion. It bit us hard: the bun-compiled `pd` emits nothing when its stdout
 * is captured (piped/non-TTY) in agent-sandbox exec contexts, so every fleet
 * agent capturing `pd` output got silence and silently fell back to guesswork.
 *
 * The rule: SILENCE IS NOT SUCCESS. An invocation that should speak and returns
 * empty stdout is a mute-tool liveness failure. Detect it (a) at launch via a
 * self-probe before trusting the tool, and (b) in the moment when any expected-
 * to-speak command returns nothing — then fail loud and route around it (daemon
 * HTTP, which is not mute) rather than relying on the mute channel.
 *
 * This module is split: a PURE classifier (exhaustively testable) + a thin probe
 * that actually spawns the CLI. Callers inject the spawn so it stays testable.
 */

/** Sentinel a canary invocation is expected to echo to stdout. */
export const CLI_CANARY_SENTINEL = 'PD_CLI_SPEAKS_OK';

export interface SelfSpeechCapture {
  /** Captured stdout (what a consumer piping the CLI would receive). */
  stdout: string;
  /** Captured stderr, for diagnostics. */
  stderr?: string;
  /** Exit code, null if the process was killed / never exited. */
  code: number | null;
  /** True if the probe itself failed to spawn (binary missing, etc.). */
  spawnFailed?: boolean;
}

export interface SelfSpeechVerdict {
  /** Did the tool actually produce the output we expected? */
  speaks: boolean;
  reason: string;
  /** When mute: the action that routes around the dead channel. */
  remediation?: string;
}

/**
 * PURE: classify a capture as speaking or mute. `expect` is a substring the
 * output must contain (e.g. a version string, or the canary sentinel). The
 * cardinal check is simply: non-empty stdout containing what we asked for.
 * Empty stdout — REGARDLESS of exit code — is mute. (We've seen exit 0 with
 * zero bytes and exit 1 with zero bytes; both are mute.)
 */
export function classifySelfSpeech(capture: SelfSpeechCapture, expect?: string): SelfSpeechVerdict {
  if (capture.spawnFailed) {
    return {
      speaks: false,
      reason: 'CLI failed to spawn (binary missing or not executable)',
      remediation: 'install/repair the CLI; until then coordinate via the daemon HTTP routes',
    };
  }
  const out = (capture.stdout || '').trim();
  if (out.length === 0) {
    return {
      speaks: false,
      reason: `CLI produced ZERO stdout (exit ${capture.code}) — it is mute when its output is captured`,
      remediation: 'do NOT trust the CLI in this context; coordinate via the daemon HTTP routes (curl the daemon loopback URL from PORT_DADDY_URL / shared daemon-discovery). This is an environment×runtime stdio failure, not "no results".',
    };
  }
  if (expect && !out.includes(expect)) {
    return {
      speaks: false,
      reason: `CLI spoke but did not echo the expected token "${expect}" (got ${out.length} bytes)`,
      remediation: 'verify the canary command + CLI version; treat as suspect until it round-trips',
    };
  }
  return { speaks: true, reason: `CLI spoke (${out.length} bytes${expect ? `, contains "${expect}"` : ''})` };
}

export interface ProbeDeps {
  /**
   * Spawn the CLI and return its capture. Injected so the probe is testable and
   * runtime-agnostic. Real callers pass a child_process-based implementation
   * that runs `<cliPath> <args>` with PIPED stdio (the exact mode that exposes
   * the muteness — a TTY would mask it).
   */
  run: (cliPath: string, args: string[]) => Promise<SelfSpeechCapture>;
}

/**
 * Probe whether the CLI speaks when its stdout is captured. Defaults to the
 * cheapest always-output command (`--version`). Returns the verdict; callers
 * decide whether to fail-loud / route around. Never throws — a thrown spawn is
 * folded into a mute verdict (a probe that can't run is, itself, mute).
 */
export async function probeCliSelfSpeech(
  cliPath: string,
  deps: ProbeDeps,
  opts: { args?: string[]; expect?: string } = {},
): Promise<SelfSpeechVerdict> {
  const args = opts.args ?? ['--version'];
  try {
    const capture = await deps.run(cliPath, args);
    return classifySelfSpeech(capture, opts.expect);
  } catch (err) {
    return {
      speaks: false,
      reason: `self-speech probe threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'treat the CLI as mute; coordinate via the daemon HTTP routes',
    };
  }
}
