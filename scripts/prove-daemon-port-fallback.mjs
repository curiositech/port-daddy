#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.argv[2] || 'dist/daemon/port-daddy-daemon');
if (!existsSync(binary)) throw new Error(`daemon binary not found: ${binary}`);

const scratchRoot = join(homedir(), 'coding', 'tmp');
mkdirSync(scratchRoot, { recursive: true });
const runtimeDir = mkdtempSync(join(scratchRoot, 'pd-daemon-fallback-proof-'));
const portFile = join(runtimeDir, 'daemon.port');
const foreign = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('foreign listener');
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const listen = () => new Promise((done, reject) => {
  foreign.once('error', reject);
  foreign.listen(0, '127.0.0.1', done);
});
const closeForeign = () => new Promise((done) => foreign.close(() => done()));

let daemon = null;
let stderr = '';
try {
  await listen();
  const address = foreign.address();
  if (!address || typeof address === 'string') throw new Error('foreign listener did not publish a TCP port');
  const preferredPort = address.port;

  const env = { ...process.env };
  for (const key of ['PD_URL', 'PORT_DADDY_URL', 'PORT_DADDY_SOCK', 'PORT_DADDY_PORT_FILE']) delete env[key];
  Object.assign(env, {
    NODE_ENV: 'production',
    PORT_DADDY_PREFIX: runtimeDir,
    PORT_DADDY_PROFILE: 'fallback-proof',
    PORT_DADDY_PORT: String(preferredPort),
    PORT_DADDY_NO_FLEET: '1',
    PORT_DADDY_NO_FLEETBAR: '1',
  });

  daemon = spawn(binary, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  daemon.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  daemon.stdout.on('data', () => {});

  const deadline = Date.now() + 90_000;
  let boundPort = null;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) throw new Error(`daemon exited ${daemon.exitCode} before publishing a port\n${stderr}`);
    try {
      const parsed = Number.parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        boundPort = parsed;
        break;
      }
    } catch {
      // Startup is still in progress.
    }
    await sleep(100);
  }
  if (!boundPort) throw new Error(`daemon did not publish a port within 90s\n${stderr}`);
  if (boundPort === preferredPort) throw new Error('daemon claimed the occupied preferred port');

  const healthResponse = await fetch(`http://127.0.0.1:${boundPort}/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  const health = await healthResponse.json();
  if (!healthResponse.ok || health.status !== 'ok' || health.daemon?.port !== boundPort) {
    throw new Error(`health did not advertise the published fallback port: ${JSON.stringify(health)}`);
  }

  console.log(JSON.stringify({
    success: true,
    preferredPortOccupied: preferredPort,
    publishedPort: boundPort,
    daemonPid: daemon.pid,
    version: health.version,
  }));
} finally {
  if (daemon && daemon.exitCode === null) {
    daemon.kill('SIGTERM');
    await Promise.race([
      new Promise((done) => daemon.once('close', done)),
      sleep(10_000).then(() => { if (daemon.exitCode === null) daemon.kill('SIGKILL'); }),
    ]);
  }
  await closeForeign().catch(() => {});
  rmSync(runtimeDir, { recursive: true, force: true });
}
