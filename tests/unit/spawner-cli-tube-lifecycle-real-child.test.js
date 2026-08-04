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
    for (const fileName of ['parent.pid', 'launcher.pid', 'survivor.pid']) {
      const pidFile = join(tempDir, fileName);
      if (existsSync(pidFile)) {
        killPid(Number(readFileSync(pidFile, 'utf8')));
      }
    }
  } catch { /* best effort cleanup */ }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('cli-tube real timeout lifecycle', () => {
  test('does not finalize a timed-out run until the CLI parent and inherited-stdio descendant are dead', async () => {
    const parentPidFile = join(tempDir, 'parent.pid');
    const survivorPidFile = join(tempDir, 'survivor.pid');

    const res = await spawnViaCliTube({
      cli: 'agy',
      prompt: 'hold open inherited stdout',
      timeoutMs: 250,
      env: {
        PD_PARENT_PID_FILE: parentPidFile,
        PD_SURVIVOR_PID_FILE: survivorPidFile,
      },
    });

    expect(res.error).toContain('agy timed out after 250ms');
    expect(existsSync(parentPidFile)).toBe(true);
    expect(existsSync(survivorPidFile)).toBe(true);
    const parentPid = Number(readFileSync(parentPidFile, 'utf8'));
    const survivorPid = Number(readFileSync(survivorPidFile, 'utf8'));
    await expectPidDead(parentPid);
    await expectPidDead(survivorPid);
  });

  test('kills an inherited-stdio descendant even when the CLI parent exits before timeout', async () => {
    const parentPidFile = join(tempDir, 'parent.pid');
    const launcherPidFile = join(tempDir, 'launcher.pid');
    const survivorPidFile = join(tempDir, 'survivor.pid');

    expect(process.env.PATH).toBe('/usr/bin:/bin');

    const res = await spawnViaCliTube({
      cli: 'agy',
      prompt: 'spawn survivor then exit parent',
      timeoutMs: 250,
      env: {
        PD_PARENT_PID_FILE: parentPidFile,
        PD_LAUNCHER_PID_FILE: launcherPidFile,
        PD_SURVIVOR_PID_FILE: survivorPidFile,
        PD_PARENT_EXITS_IMMEDIATELY: '1',
      },
    });

    expect(res.error).toContain('agy timed out after 250ms');
    expect(existsSync(parentPidFile)).toBe(true);
    expect(existsSync(launcherPidFile)).toBe(true);
    expect(existsSync(survivorPidFile)).toBe(true);
    const parentPid = Number(readFileSync(parentPidFile, 'utf8'));
    const launcherPid = Number(readFileSync(launcherPidFile, 'utf8'));
    const survivorPid = Number(readFileSync(survivorPidFile, 'utf8'));
    await expectPidDead(parentPid);
    await expectPidDead(launcherPid);
    await expectPidDead(survivorPid);
  });
});

function installEscapingAgy(dir) {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const file = join(binDir, 'agy');
  writeFileSync(file, `#!${process.execPath}
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');

const parentPidFile = process.env.PD_PARENT_PID_FILE;
const pidFile = process.env.PD_SURVIVOR_PID_FILE;
if (!parentPidFile || !pidFile) {
  console.error('missing PID file env');
  process.exit(2);
}

writeFileSync(parentPidFile, String(process.pid));
console.log('parent emitted before timeout');
process.on('SIGTERM', () => {});

if (process.env.PD_PARENT_EXITS_IMMEDIATELY === '1') {
  const launcher = spawn(process.execPath, ['-e', \`
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const pidFile = process.env.PD_SURVIVOR_PID_FILE;
setTimeout(() => {
  const survivor = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  writeFileSync(pidFile, String(survivor.pid));
  survivor.unref();
}, 50);
setTimeout(() => {}, 1000);
\`], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  if (process.env.PD_LAUNCHER_PID_FILE) {
    writeFileSync(process.env.PD_LAUNCHER_PID_FILE, String(launcher.pid));
  }
  launcher.unref();
  process.exit(0);
}

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

async function expectPidDead(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await isPidAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(await isPidAlive(pid), `PID ${pid} remained alive after process-tree cleanup`).toBe(false);
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
