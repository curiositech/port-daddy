#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT_DIR, 'dist', 'daemon');
const OUTFILE = join(DIST_DIR, platform() === 'win32' ? 'port-daddy-daemon.exe' : 'port-daddy-daemon');
const MANIFEST = join(DIST_DIR, 'manifest.json');
const args = new Set(process.argv.slice(2));

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
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

async function smokeBinary() {
  const port = await reservePort();
  const scratchRoot = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const prefix = join(scratchRoot, `port-daddy-daemon-smoke-${process.pid}`);
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
    return { health, samples };
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolveKill => child.once('exit', resolveKill));
    }
    rmSync(prefix, { recursive: true, force: true });
  }
}

function smokeDbIntegrityHelper() {
  const scratchRoot = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const root = join(scratchRoot, `port-daddy-integrity-smoke-${process.pid}`);
  const dbPath = join(root, 'registry.db');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  try {
    run('bun', ['-e', [
      'import { Database } from "bun:sqlite";',
      'const db = new Database(process.env.PD_INTEGRITY_SMOKE_DB);',
      'db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT)");',
      'db.query("INSERT INTO smoke(value) VALUES (?)").run("ok");',
      'db.close();',
    ].join(' ')], {
      env: { PD_INTEGRITY_SMOKE_DB: dbPath },
      timeout: 10_000,
    });
    const result = spawnSync(OUTFILE, ['__db_integrity_check', dbPath], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      env: { ...process.env, PORT_DADDY_DB_INTEGRITY_CHILD: '1' },
      timeout: 15_000,
    });
    if (result.status !== 0) {
      const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status ?? 'unknown'}`;
      throw new Error(`daemon DB-integrity helper smoke failed: ${detail}`);
    }
    let proof;
    try { proof = JSON.parse(result.stdout.trim()); }
    catch (error) { throw new Error(`daemon DB-integrity helper emitted invalid JSON: ${error.message}`); }
    if (proof?.schema !== 'port-daddy.db-integrity-proof.v1'
      || proof?.result !== 'ok'
      || resolve(proof?.dbPath || '') !== resolve(dbPath)) {
      throw new Error('daemon DB-integrity helper returned an invalid proof');
    }
    return { result: proof.result, schema: proof.schema };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const bunVersion = run('bun', ['--version']).trim();
mkdirSync(DIST_DIR, { recursive: true });
run('bun', ['build', '--compile', 'server.ts', '--outfile', OUTFILE], { stdio: 'inherit' });

// Always exercise the daemon-only artifact's hidden helper. `pd dev up` skips
// the full HTTP smoke for speed, but must never skip the entrypoint that guards
// a production-sized registry from recursive self-spawn.
const integrityHelperSmoke = smokeDbIntegrityHelper();

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
  builder: 'bun build --compile server.ts',
  bunVersion,
  resourceRootEnv: 'PORT_DADDY_RESOURCE_DIR',
  sqliteBackend: 'bun:sqlite',
  integrityHelperSmoke,
  smoke: smoke ? {
    status: smoke.health.status,
    pid: smoke.health.pid ?? null,
    samples: smoke.samples,
  } : null,
}, null, 2)}\n`);

console.log(`Built daemon binary: ${OUTFILE}`);
console.log(`Wrote manifest: ${MANIFEST}`);
