/**
 * pd nightshift -- back-compat alias for `pd dispatch`.
 *
 * The verb was renamed in this PR (rename + ADR-0035 rebase). The legacy
 * noun is preserved for one minor version so cron jobs, zsh history, and
 * docs that reference `pd nightshift` keep working. The deprecation banner
 * is printed once per CLI invocation (not per command) so it does not spam
 * scripted callers.
 *
 * Subcommand mapping (legacy -> new):
 *   pd nightshift propose -> pd dispatch propose
 *   pd nightshift queue   -> pd dispatch queue
 *   pd nightshift list    -> pd dispatch list
 *   pd nightshift show    -> pd dispatch show
 *   pd nightshift run     -> pd dispatch run
 *   pd nightshift review  -> pd review
 *   pd nightshift cancel  -> pd dispatch cancel
 *
 * Some nightshift flag names also changed (--auto-queue -> --auto-claim,
 * --status -> --state). The alias rewrites those before delegating so old
 * invocations still work.
 */

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';
import { handleDispatch } from './dispatch.js';

const DEPRECATION_NOTE =
  '`pd nightshift` is renamed to `pd dispatch` (see ADR-0035). The legacy ' +
  'noun is kept for one minor version. Update your scripts and zsh history.';

function rewriteOptions(options: CLIOptions): CLIOptions {
  const out: CLIOptions = { ...options };
  // --auto-queue -> --auto-claim
  if (out['auto-queue'] !== undefined && out['auto-claim'] === undefined) {
    out['auto-claim'] = out['auto-queue'];
  }
  if (out.autoQueue !== undefined && out.autoClaim === undefined) {
    out.autoClaim = out.autoQueue;
  }
  // --status -> --state
  if (out.status !== undefined && out.state === undefined) {
    out.state = out.status;
  }
  return out;
}

export async function handleNightshift(args: string[], options: CLIOptions): Promise<void> {
  // Quiet/JSON callers don't get the deprecation banner -- it would corrupt
  // JSON output and noise up cron logs. Interactive callers do.
  if (!isQuiet(options) && !isJson(options)) {
    ui.warn(DEPRECATION_NOTE);
  }
  await handleDispatch(args, rewriteOptions(options));
}
