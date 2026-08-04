#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT_DIR, 'dist', 'daemon');
const OUTFILE = join(DIST_DIR, platform() === 'win32' ? 'port-daddy-daemon.exe' : 'port-daddy-daemon');
const MANIFEST = join(DIST_DIR, 'manifest.json');
const ENTRYPOINT = 'bin/port-daddy-daemon-bundle.ts';
const args = new Set(process.argv.slice(2));

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error([`${command} ${commandArgs.join(' ')} failed`, stderr, stdout].filter(Boolean).join('\n'));
  }
  return result.stdout ?? '';
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(port, child, stderrChunks) {
  const deadline = Date.now() + 15000;
  const url = `http://127.0.0.1:${port}/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body?.status === 'ok') return body;
      }
    } catch {
      // Retry until the process is listening or exits.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  throw new Error(`daemon binary smoke test failed for ${url}${stderr ? `\n${stderr}` : ''}`);
}

async function smokePublicSamples(port) {
  const sampleManifest = join(ROOT_DIR, 'public', 'samples', 'manifest.json');
  if (!existsSync(sampleManifest)) return null;
  const res = await fetch(`http://127.0.0.1:${port}/samples/manifest.json`);
  if (!res.ok) {
    throw new Error(`sample manifest smoke test failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!Number.isInteger(body?.count) || body.count < 1) {
    throw new Error('sample manifest smoke test failed: manifest did not include bundled files');
  }
  return { count: body.count };
}

function smokeIntegrityHelper(dbPath) {
  const result = spawnSync(OUTFILE, ['__db_integrity_check', dbPath], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PORT_DADDY_DB_INTEGRITY_CHILD: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`compiled integrity helper failed: ${result.stderr?.trim() || `exit ${result.status}`}`);
  }
  const proof = JSON.parse(result.stdout.trim());
  if (proof?.schema !== 'port-daddy.db-integrity-proof.v1' || proof?.result !== 'ok') {
    throw new Error('compiled integrity helper did not return a valid proof');
  }
  return { schema: proof.schema, result: proof.result };
}

async function smokeBinary() {
  const port = await reservePort();
  const prefix = join(tmpdir(), `port-daddy-daemon-smoke-${process.pid}`);
  rmSync(prefix, { recursive: true, force: true });
  mkdirSync(prefix, { recursive: true });

  const stderrChunks = [];
  const child = spawn(OUTFILE, [], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT_DADDY_PREFIX: prefix,
      PORT_DADDY_PORT: String(port),
      PORT_DADDY_NO_FLEET: '1',
      PORT_DADDY_NO_FLEETBAR: '1',
      PORT_DADDY_RESOURCE_DIR: ROOT_DIR,
      PORT_DADDY_SILENT: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));

  try {
    const health = await waitForHealth(port, child, stderrChunks);
    const samples = await smokePublicSamples(port);
    const integrity = smokeIntegrityHelper(join(prefix, 'port-daddy.db'));
    return { health, samples, integrity };
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolveKill => child.once('exit', resolveKill));
    }
    rmSync(prefix, { recursive: true, force: true });
  }
}

const bunVersion = run('bun', ['--version']).trim();
mkdirSync(DIST_DIR, { recursive: true });
run('bun', ['build', '--compile', ENTRYPOINT, '--outfile', OUTFILE], { stdio: 'inherit' });

let smoke = null;
if (!args.has('--no-smoke')) {
  smoke = await smokeBinary();
}

const stats = statSync(OUTFILE);
writeFileSync(MANIFEST, `${JSON.stringify({
  version: 1,
  artifact: basename(OUTFILE),
  platform: platform(),
  arch: arch(),
  sizeBytes: stats.size,
  sha256: sha256(OUTFILE),
  builtAt: new Date().toISOString(),
  builder: `bun build --compile ${ENTRYPOINT}`,
  bunVersion,
  resourceRootEnv: 'PORT_DADDY_RESOURCE_DIR',
  sqliteBackend: 'bun:sqlite',
  smoke: smoke ? {
    status: smoke.health.status,
    pid: smoke.health.pid ?? null,
    samples: smoke.samples,
    integrity: smoke.integrity,
  } : null,
}, null, 2)}\n`);

console.log(`Built daemon binary: ${OUTFILE}`);
console.log(`Wrote manifest: ${MANIFEST}`);
