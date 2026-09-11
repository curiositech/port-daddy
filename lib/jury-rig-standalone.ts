/** Daemon-free argument parsing and dispatch for the standalone Jury-rig tool. */

import { parseArgs } from 'node:util';
import { handleJuryRig } from '../cli/commands/skill-graft.js';
import type { CLIOptions } from '../cli/types.js';

export interface StandaloneJuryRigArguments {
  positional: string[];
  options: CLIOptions & { invocation: 'jury-rig' };
}

export function parseStandaloneJuryRigArguments(argv: string[]): StandaloneJuryRigArguments {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: 'string' },
      dir: { type: 'string' },
      'db-dir': { type: 'string' },
      limit: { type: 'string' },
      'shortlist-limit': { type: 'string' },
      'top-limit': { type: 'string' },
      'body-chars': { type: 'string' },
      'max-skills': { type: 'string' },
      json: { type: 'boolean', short: 'j' },
      quiet: { type: 'boolean', short: 'q' },
      all: { type: 'boolean' },
      'local-only': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const positional = parsed.values.help ? ['help'] : parsed.positionals;
  if (positional[0] === 'bootstrap') {
    throw new Error('The standalone jury-rig executable does not expose Port Daddy machine-bootstrap operations.');
  }
  return {
    positional,
    options: { ...parsed.values, invocation: 'jury-rig' },
  };
}

export async function runStandaloneJuryRig(
  argv: string[],
  handler: (positional: string[], options: CLIOptions) => Promise<void> = handleJuryRig,
): Promise<void> {
  const { positional, options } = parseStandaloneJuryRigArguments(argv);
  await handler(positional.length > 0 ? positional : ['help'], options);
}

/**
 * Build the detached local warm command after a discovery call. The worker is
 * deliberately a separate process: search output returns immediately, while
 * SQLite's existing lease and per-row checkpoints serialize and resume the
 * expensive catalog build out of band.
 */
export function standaloneWarmupArguments(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] | null {
  if (env.JURY_RIG_BACKGROUND_WARM === '1' || env.JURY_RIG_DISABLE_BACKGROUND_WARM === '1') return null;
  const { positional, options } = parseStandaloneJuryRigArguments(argv);
  const operation = positional[0] || 'help';
  if (['help', 'warm', 'refresh', 'reference', 'ref', 'bootstrap', 'query'].includes(operation)) return null;

  const warm = ['warm', '--local-only', '--all', '--quiet'];
  for (const key of ['root', 'dir', 'db-dir'] as const) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) warm.push(`--${key}`, value);
  }
  return warm;
}
