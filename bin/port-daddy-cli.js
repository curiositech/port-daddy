#!/usr/bin/env node

// Thin shim — re-executes the TypeScript CLI via Node + tsx loader.
// This file exists because package.json "bin" requires a .js entry point,
// but the real CLI is written in TypeScript (port-daddy-cli.ts).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromShim = createRequire(import.meta.url);
const cliScript = join(__dirname, 'port-daddy-cli.ts');
let tsxLoader;

try {
  tsxLoader = pathToFileURL(requireFromShim.resolve('tsx/esm')).href;
} catch (error) {
  console.error('Port Daddy CLI could not find its bundled tsx loader.');
  console.error('Reinstall Port Daddy or run npm install in the Port Daddy install root.');
  if (error instanceof Error && error.message) {
    console.error(error.message);
  }
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', tsxLoader, cliScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});

child.on('error', (error) => {
  console.error(`Port Daddy CLI failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 1));
