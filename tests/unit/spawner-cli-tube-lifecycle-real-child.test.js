/**
 * Real child-process lifecycle tests for cli-tube timeout handling.
 *
 * These intentionally avoid the node:child_process mock used by
 * spawner-cli-tube-backend.test.js. The regression under audit is process-tree
 * truth: forced settlement must not mark a timed-out CLI run final while an
 * inherited-stdio descendant from that same invocation is still alive.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { spawnViaCliTube } = await import('../../lib/spawner/backends/cli-tube.js');

jest.setTimeout(20_000);

let tempDir;
let originalAgyBin;
let originalPath;
let originalCliBinDirs;

beforeAll(() => {
  originalAgyBin = process.env.PD_CLI_AGY_BIN;
  originalPath = process.env.PATH;
  originalCliBinDirs = process.env.PD_CLI_BIN_DIRS;
});

afterAll(() => {
  restoreEnv('PD_CLI_AGY_BIN', originalAgyBin);
  restoreEnv('PATH', originalPath);
  restoreEnv('PD_CLI_BIN_DIRS', originalCliBinDirs);
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pd-cli-tube-real-child-'));
  process.env.PD_CLI_AGY_BIN = installEscapingAgy(tempDir);
  process.env.PATH = '/usr/bin:/bin';
  delete process.env.PD_CLI_BIN_DIRS;
});

afterEach(() => {
  try {
    const pidFile = join(tempDir, 'survivor.pid');
    if (existsSync(pidFile)) {
      killPid(Number(readFileSync(pidFile, 'utf8')));
    }
  } catch { /* best effort cleanup */ }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('cli-tube real timeout lifecycle', () => {
  test('does not finalize a timed-out run while an inherited-stdio descendant is still alive', async () => {
    const pidFile = join(tempDir, 'survivor.pid');

    const res = await spawnViaCliTube({
      cli: 'agy',
      prompt: 'hold open inherited stdout',
      timeoutMs: 250,
      env: { PD_SURVIVOR_PID_FILE: pidFile },
    });

    expect(res.error).toContain('agy timed out after 250ms');
    expect(existsSync(pidFile)).toBe(true);
    const survivorPid = Number(readFileSync(pidFile, 'utf8'));
    expect(await isPidAlive(survivorPid)).toBe(false);
  });
});

function installEscapingAgy(dir) {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const file = join(binDir, 'agy');
  writeFileSync(file, `#!${process.execPath}
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');

const pidFile = process.env.PD_SURVIVOR_PID_FILE;
if (!pidFile) {
  console.error('missing PD_SURVIVOR_PID_FILE');
  process.exit(2);
}

console.log('parent emitted before timeout');
process.on('SIGTERM', () => {});

const survivor = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
  detached: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
writeFileSync(pidFile, String(survivor.pid));
survivor.unref();

setInterval(() => {}, 1000);
`);
  chmodSync(file, 0o755);
  return file;
}

async function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
