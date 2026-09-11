#!/usr/bin/env node

// Small launcher for the standalone selector. It deliberately bypasses the
// monolithic coordination CLI, so daemon freshness and startup cannot run.

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const binDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(binDir);
const compiled = join(root, 'dist', 'bin', 'jury-rig.js');
const source = join(binDir, 'jury-rig.ts');
const requireFromShim = createRequire(import.meta.url);
let childArgs;

if (existsSync(compiled)) {
  childArgs = [compiled, ...process.argv.slice(2)];
} else {
  try {
    childArgs = [
      '--import',
      pathToFileURL(requireFromShim.resolve('tsx/esm')).href,
      source,
      ...process.argv.slice(2),
    ];
  } catch (error) {
    console.error('Jury-rig could not find its compiled entry point or bundled tsx loader.');
    if (error instanceof Error && error.message) console.error(error.message);
    process.exit(1);
  }
}

const child = spawn(process.execPath, childArgs, { stdio: 'inherit', env: process.env });
child.on('error', (error) => {
  console.error(`Jury-rig failed to start: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
