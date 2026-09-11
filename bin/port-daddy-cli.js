#!/usr/bin/env node

// Thin shim — re-executes the TypeScript CLI via Node + tsx loader.
// This file exists because package.json "bin" requires a .js entry point,
// but the real CLI is written in TypeScript (port-daddy-cli.ts).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accessSync, constants, lstatSync } from 'node:fs';
import { homedir } from 'node:os';

// This plain-JS package entry cannot import TypeScript before starting tsx.
// Keep its filesystem-only gate fixture-equivalent to local-runtime-control.ts.
function localRuntimeEnabled() {
  const canonical = join(homedir(), '.port-daddy');
  const selected = process.env.PD_HOME ?? canonical;
  const roots = new Set([canonical, selected]);
  const inspected = new Set();
  const absent = (path) => {
    if (!isAbsolute(path)) return false;
    try {
      const parent = lstatSync(dirname(path));
      if (!parent.isDirectory() || parent.isSymbolicLink()) return false;
      accessSync(dirname(path), constants.R_OK | constants.X_OK);
      try { lstatSync(path); return false; }
      catch (error) { return error.code === 'ENOENT'; }
    } catch { return false; }
  };
  for (const root of roots) {
    if (!isAbsolute(root)) return false;
    inspected.add(join(root, 'HALT'));
    try {
      const stat = lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      accessSync(root, constants.R_OK | constants.X_OK);
    } catch (error) {
      if (error.code !== 'ENOENT' || !absent(root)) return false;
      continue;
    }
    if (!absent(join(root, 'HALT')) || !absent(join(root, 'hooks.disabled'))) return false;
  }
  const extra = process.env.PD_HALT_FILE;
  return extra === undefined || inspected.has(extra) || absent(extra);
}

const args = process.argv.slice(2);
const informationalOnly = args.length === 1 && ['--help', '--version'].includes(args[0]);
function requireRuntimeAdmission() {
  if (!informationalOnly && !localRuntimeEnabled()) {
    console.error('Port Daddy is Off or local control is unavailable. No CLI runtime was started.');
    process.exit(1);
  }
}
requireRuntimeAdmission();

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

// Loader resolution must not leave an earlier On observation as launch authority.
requireRuntimeAdmission();
const child = spawn(process.execPath, ['--import', tsxLoader, cliScript, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('error', (error) => {
  console.error(`Port Daddy CLI failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 1));
