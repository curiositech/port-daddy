#!/usr/bin/env node

/** Standalone Jury-rig entry point: no daemon discovery or Port Daddy CLI boot. */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runStandaloneJuryRig,
  standaloneWarmupArguments,
} from '../lib/jury-rig-standalone.js';

const argv = process.argv.slice(2);

runStandaloneJuryRig(argv)
  .then(() => {
    if (process.exitCode && process.exitCode !== 0) return;
    const warmArgs = standaloneWarmupArguments(argv);
    if (!warmArgs) return;
    const currentEntry = fileURLToPath(import.meta.url);
    const workerEntry = currentEntry.endsWith('.ts')
      ? join(dirname(currentEntry), 'jury-rig.js')
      : currentEntry;
    const worker = spawn(process.execPath, [workerEntry, ...warmArgs], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, JURY_RIG_BACKGROUND_WARM: '1' },
    });
    worker.unref();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
