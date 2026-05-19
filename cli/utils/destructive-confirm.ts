/**
 * Destructive-action confirmation helper.
 *
 * Every command classified as `destructive` in cli/permission-tiers.ts MUST
 * route through requireConfirmation() before performing its side effect. The
 * contract is:
 *
 *   - If the caller passes `--yes` / `-y`, or env `PORT_DADDY_YES=1`,
 *     return `true` immediately. An audit-trail summary is always printed to
 *     stderr (so logs still record what was authorized).
 *
 *   - If stderr is a TTY and prompting is allowed, prompt with the impact
 *     summary and return based on the user's answer.
 *
 *   - Else (non-TTY, no `--yes`): return `false`. The caller should exit 130
 *     (SIGINT-style "cancelled by user"); see DESTRUCTIVE_EXIT_CODE below.
 *
 * The `summary` should be impact-specific:
 *   "Salvage will release 3 file claims and 12 notes from session abc-123."
 *   "Salvage will dismiss agent xyz from the queue — context will not be retrievable."
 *
 * NOT acceptable:
 *   "Are you sure?"  (no impact summary)
 *   "This is destructive."  (no specifics)
 */

/** Exit code recommended for callers when confirmation is refused. */
export const DESTRUCTIVE_EXIT_CODE = 130;

/**
 * Default TTY-aware prompting detector. Mirrors cli/utils/ui.ts::canPrompt
 * but is inlined here to avoid a hard import dependency on ui.ts — tests
 * that mock ui.ts (especially the agents/spawn/fleet/messaging CLI tests)
 * don't have to know this module exists.
 */
function defaultCanPrompt(): boolean {
  return Boolean(process.stderr.isTTY)
    && !process.env.CI
    && !process.env.PORT_DADDY_NON_INTERACTIVE;
}

/**
 * Default prompt implementation. Loaded lazily so test mocks of ui.ts don't
 * trip on a top-level import — and so this module can be required from
 * environments (e.g. bundled bun binaries) where the @clack runtime might
 * not yet be initialized.
 */
async function defaultPrompt(message: string): Promise<boolean> {
  const ui = await import('./ui.js');
  return ui.confirm(message, false);
}

export interface ConfirmOptions {
  /**
   * Impact-specific one-line summary printed to the user (and audit log).
   * Must describe WHAT will be released/removed and WHOSE work is affected.
   */
  summary: string;

  /**
   * Parsed CLI args / options object. We look at the `yes` and `y` keys,
   * plus the `PORT_DADDY_YES` env var, to decide whether to bypass the
   * interactive prompt.
   *
   * Accepting `unknown` keeps the helper friendly to both the strict CLI
   * options type and ad-hoc Record<string, unknown> handlers.
   */
  args?: Record<string, unknown>;

  /**
   * Optional override for the canPrompt detector. Tests inject a stub here
   * so we can simulate TTY behaviour without forking.
   */
  canPrompt?: () => boolean;

  /**
   * Optional override for the confirm prompt. Tests inject a stub here.
   * Real callers should leave it undefined.
   */
  prompt?: (message: string) => Promise<boolean>;

  /**
   * Optional override for the stderr writer. Tests inject a stub.
   */
  writeStderr?: (msg: string) => void;

  /**
   * Optional override for the env reader. Tests inject a stub.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Determine whether a destructive action should proceed. ALWAYS prints the
 * impact summary to stderr (TTY or not, --yes or not) so the audit trail is
 * intact.
 */
export async function requireConfirmation(opts: ConfirmOptions): Promise<boolean> {
  const args = opts.args ?? {};
  const env = opts.env ?? process.env;
  const writeStderr = opts.writeStderr ?? ((msg: string) => process.stderr.write(msg));
  const canPrompt = opts.canPrompt ?? defaultCanPrompt;
  const prompt = opts.prompt ?? defaultPrompt;

  // Always emit an audit-trail line BEFORE any decision.
  writeStderr(`destructive: ${opts.summary}\n`);

  const bypass =
    args.yes === true ||
    args.y === true ||
    typeof args.yes === 'string' ||
    typeof args.y === 'string' ||
    env.PORT_DADDY_YES === '1' ||
    env.PORT_DADDY_YES === 'true';

  if (bypass) {
    writeStderr('destructive: confirmation bypassed via --yes / PORT_DADDY_YES\n');
    return true;
  }

  if (!canPrompt()) {
    writeStderr('destructive: refusing in non-interactive mode. Re-run with --yes to proceed.\n');
    return false;
  }

  const answer = await prompt(`Proceed? — ${opts.summary}`);
  if (!answer) {
    writeStderr('destructive: cancelled by user\n');
    return false;
  }
  writeStderr('destructive: confirmed by user\n');
  return true;
}

/**
 * Convenience wrapper: run an async action only after confirmation. On
 * refusal, exits with DESTRUCTIVE_EXIT_CODE. Returns the action's return
 * value on confirmation.
 *
 * Use this for top-level command handlers where exit-on-refusal is desired.
 * Use `requireConfirmation` directly when the caller wants to handle the
 * refusal itself (e.g. to keep a single CLI process alive across multiple
 * destructive subcommands).
 */
export async function withConfirmation<T>(
  opts: ConfirmOptions,
  action: () => Promise<T>
): Promise<T> {
  const ok = await requireConfirmation(opts);
  if (!ok) {
    process.exit(DESTRUCTIVE_EXIT_CODE);
  }
  return action();
}
