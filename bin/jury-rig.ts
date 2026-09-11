#!/usr/bin/env node

/** Standalone Jury-rig entry point: no daemon discovery or Port Daddy CLI boot. */

import { runStandaloneJuryRig } from '../lib/jury-rig-standalone.js';

runStandaloneJuryRig(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
