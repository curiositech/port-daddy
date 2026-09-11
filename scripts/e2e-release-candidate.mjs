#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { homedir, platform as hostPlatform, arch as hostArch } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedSyntheticTree,
  assertExecutableArtifact,
  canonicalRecordedCommonDir,
  findAuthorityArtifacts,
  loadReleaseCandidateMatrix,
  redactReleaseCandidateText,
  resolveDurableTestRoot,
  secretFreeBaseEnv,
  selectReleaseCandidateCases,
  sha256File,
  snapshotTreeMetadata,
} from './lib/release-candidate-e2e.mjs';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MATRIX = join(SOURCE_ROOT, 'tests', 'e2e', 'release-candidate.matrix.json');
const SECRET_FIXTURE = join(SOURCE_ROOT, 'tests', 'e2e', 'fixtures', 'emit-secret.mjs');
const CHILD_OUTPUT_LIMIT = 4 * 1024 * 1024;
const EXPECTED_BUN_VERSION = '1.2.21';
const DAEMON_READINESS_TIMEOUT_MS = 120_000;
const DAEMON_BOOT_LOG_LIMIT = 4_000;
const TENTACLES = [
  'pd-hook-prompt',
  'pd-hook-precompact',
  'pd-hook-pre-tool',
  'pd-hook-post-tool',
  'pd-hook-stop',
  'pd-statusline',
];

function parseArgs(argv) {
  const options = {
    build: false,
    caseIds: [],
    keep: false,
    list: false,
    shard: 'all',
    target: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };
    if (arg === '--build') options.build = true;
    else if (arg === '--case') options.caseIds.push(value());
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--manifest') options.manifest = value();
    else if (arg === '--results') options.results = value();
    else if (arg === '--root') options.root = value();
    else if (arg === '--shard') options.shard = value();
    else if (arg === '--staged-dir') options.stagedDir = value();
    else if (arg === '--target') options.target = value();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/e2e-release-candidate.mjs [options]

  --build                 Build and stage the host release artifact first
  --target <bun-target>   Explicit release target (defaults to this host)
  --staged-dir <path>     Staged release root; must be below ~/coding/tmp
  --root <path>           Isolated run root; must be below ~/coding/tmp
  --shard <name|all>      Run artifact, runtime, hostile, existing, or all
  --case <id>             Run one named case; repeatable
  --manifest <path>       Override the machine-readable matrix
  --results <path>        Write sanitized JSON results here
  --keep                  Preserve the isolated run root after success
  --list                  Print cases and external gates without running
`);
}

function defaultTarget() {
  if (hostPlatform() === 'darwin' && hostArch() === 'arm64') return 'bun-darwin-arm64';
  if (hostPlatform() === 'linux' && hostArch() === 'x64') return 'bun-linux-x64';
  throw new Error(`no release target mapping for ${hostPlatform()}-${hostArch()}; pass --target explicitly`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function processExited(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit) => {
    let timer;
    const done = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    child.once('exit', done);
    timer = setTimeout(() => {
      child.off('exit', done);
      resolveExit(null);
    }, timeoutMs);
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!Number.isSafeInteger(port)) throw new Error('could not reserve a loopback TCP port');
  return port;
}

function stableCaseSlug(id) {
  return id.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
}

function readJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return JSON (exit ${result.code})`);
  }
}

class ReleaseCandidateSuite {
  constructor(options, matrix, cases) {
    this.options = options;
    this.matrix = matrix;
    this.cases = cases;
    this.root = resolveDurableTestRoot(options.root, { home: homedir(), sourceRoot: SOURCE_ROOT });
    this.resultsPath = resolve(options.results || `${this.root}.results.json`);
    this.stagedDir = resolve(options.stagedDir || join(this.root, 'Cellar', 'port-daddy', 'rc'));
    resolveDurableTestRoot(this.stagedDir, { home: homedir(), sourceRoot: SOURCE_ROOT });
    this.logPath = join(this.root, 'logs', 'suite.log');
    this.knownSecrets = [];
    this.caseCounter = 0;
    this.activeChildren = new Set();
    this.results = [];
    this.startedAt = new Date().toISOString();
    this.checkoutBefore = null;
    this.stageBefore = null;
  }

  prepare() {
    if (existsSync(this.root)) {
      assertOwnedSyntheticTree(this.root);
      if (readdirSync(this.root).length > 0) throw new Error(`run root already exists and is not empty: ${this.root}`);
    } else {
      mkdirSync(this.root, { recursive: true });
    }
    mkdirSync(dirname(this.resultsPath), { recursive: true });
    mkdirSync(dirname(this.logPath), { recursive: true });
    mkdirSync(join(this.root, 'tmp'), { recursive: true });
    this.checkoutBefore = this.checkoutAuthoritySnapshot();
  }

  checkoutAuthoritySnapshot() {
    const paths = [
      '.portdaddy',
      'actor-credentials.json',
      'daemon.pid',
      'daemon.port',
      'matrix.env',
      'port-daddy.db',
      'port-registry.db',
    ];
    return Object.fromEntries(paths.map((path) => [path, snapshotTreeMetadata(join(SOURCE_ROOT, path))]));
  }

  appendLog(label, text, secrets = []) {
    const safe = redactReleaseCandidateText(text, [...this.knownSecrets, ...secrets]);
    if (!safe) return;
    const prefix = `[${new Date().toISOString()}] [${label}] `;
    const body = safe.split(/(?<=\n)/).map((line) => `${prefix}${line}`).join('');
    writeFileSync(this.logPath, body.endsWith('\n') ? body : `${body}\n`, { flag: 'a', mode: 0o600 });
  }

  async runCommand(command, args, options = {}) {
    const label = options.label || basename(command);
    const timeoutMs = options.timeoutMs || 30_000;
    const child = spawn(command, args, {
      cwd: options.cwd || SOURCE_ROOT,
      env: options.env || secretFreeBaseEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let stdoutPending = '';
    let stderrPending = '';
    let truncated = false;

    const collect = (channel, chunk) => {
      const raw = chunk.toString();
      if (channel === 'stdout') {
        if (Buffer.byteLength(stdout) < CHILD_OUTPUT_LIMIT) stdout += raw;
        else truncated = true;
        stdoutPending += raw;
      } else {
        if (Buffer.byteLength(stderr) < CHILD_OUTPUT_LIMIT) stderr += raw;
        else truncated = true;
        stderrPending += raw;
      }
      if (options.stream === false) return;
      const pending = channel === 'stdout' ? stdoutPending : stderrPending;
      const lastNewline = pending.lastIndexOf('\n');
      if (lastNewline < 0) return;
      const complete = pending.slice(0, lastNewline + 1);
      if (channel === 'stdout') stdoutPending = pending.slice(lastNewline + 1);
      else stderrPending = pending.slice(lastNewline + 1);
      const safe = redactReleaseCandidateText(complete, [...this.knownSecrets, ...(options.secrets || [])]);
      this.appendLog(`${label}:${channel}`, complete, options.secrets);
      (channel === 'stdout' ? process.stdout : process.stderr).write(safe);
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    const exit = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    }).finally(() => {
      clearTimeout(timer);
      this.activeChildren.delete(child);
    });

    if (stdoutPending) {
      this.appendLog(`${label}:stdout`, stdoutPending, options.secrets);
      if (options.stream !== false) process.stdout.write(redactReleaseCandidateText(stdoutPending, [...this.knownSecrets, ...(options.secrets || [])]));
    }
    if (stderrPending) {
      this.appendLog(`${label}:stderr`, stderrPending, options.secrets);
      if (options.stream !== false) process.stderr.write(redactReleaseCandidateText(stderrPending, [...this.knownSecrets, ...(options.secrets || [])]));
    }
    const result = { ...exit, stdout, stderr, timedOut, truncated };
    if (timedOut) throw new Error(`${label} exceeded ${timeoutMs}ms`);
    if (result.code !== 0 && !options.allowFailure) {
      const rawDetail = stderr || stdout;
      const boundedDetail = rawDetail.length <= 12_000
        ? rawDetail
        : `${rawDetail.slice(0, 2_000)}\n...[DIAGNOSTIC TRUNCATED]...\n${rawDetail.slice(-10_000)}`;
      const detail = redactReleaseCandidateText(boundedDetail, [...this.knownSecrets, ...(options.secrets || [])]);
      throw new Error(`${label} exited ${result.code ?? result.signal}: ${detail}`);
    }
    return result;
  }

  isolatedEnv(extra = {}) {
    return {
      ...secretFreeBaseEnv(),
      CI: process.env.CI || '1',
      CARGO_HOME: process.env.CARGO_HOME || join(homedir(), '.cargo'),
      HOME: join(this.root, 'build-home'),
      NO_COLOR: '1',
      PD_SCRATCH_ROOT: join(this.root, 'build-scratch'),
      RUSTUP_HOME: process.env.RUSTUP_HOME || join(homedir(), '.rustup'),
      TERM: 'dumb',
      TMPDIR: join(this.root, 'tmp'),
      USERPROFILE: join(this.root, 'build-home'),
      ...extra,
    };
  }

  async buildAndStage() {
    if (existsSync(this.stagedDir) && readdirSync(this.stagedDir).length > 0) {
      throw new Error(`refusing to overwrite non-empty staged directory: ${this.stagedDir}`);
    }
    if (existsSync(this.stagedDir)) assertOwnedSyntheticTree(this.stagedDir);
    let bunVersion;
    try {
      const bun = await this.runCommand('bun', ['--version'], {
        env: secretFreeBaseEnv(),
        label: 'bun-version',
        stream: false,
      });
      bunVersion = bun.stdout.trim();
    } catch (error) {
      throw new Error(`release artifact build requires Bun ${EXPECTED_BUN_VERSION} on PATH: ${error.message}`);
    }
    if (bunVersion !== EXPECTED_BUN_VERSION) {
      throw new Error(`release artifact build requires Bun ${EXPECTED_BUN_VERSION}; found ${bunVersion || 'unknown'}`);
    }
    mkdirSync(this.stagedDir, { recursive: true });
    mkdirSync(join(this.root, 'build-home'), { recursive: true });
    mkdirSync(join(this.root, 'build-scratch'), { recursive: true });
    const target = this.options.target || defaultTarget();
    console.log(`BUILD release artifact target=${target} stage=${this.stagedDir}`);
    await this.runCommand(process.execPath, [
      join(SOURCE_ROOT, 'scripts', 'build-single-binary.mjs'),
      `--target=${target}`,
      `--outfile=${join(this.stagedDir, 'pd')}`,
    ], {
      cwd: SOURCE_ROOT,
      env: this.isolatedEnv(),
      label: 'build-single-binary',
      timeoutMs: 20 * 60_000,
    });

    mkdirSync(join(this.stagedDir, 'bin'), { recursive: true });
    mkdirSync(join(this.stagedDir, 'hooks'), { recursive: true });
    mkdirSync(join(this.stagedDir, 'skills'), { recursive: true });
    mkdirSync(join(this.stagedDir, 'agents'), { recursive: true });
    for (const name of TENTACLES) {
      const destination = join(this.stagedDir, 'bin', name);
      cpSync(join(SOURCE_ROOT, 'bin', name), destination);
      chmodSync(destination, 0o755);
    }
    cpSync(join(SOURCE_ROOT, 'hooks', 'sessionstart-pilot.mjs'), join(this.stagedDir, 'hooks', 'sessionstart-pilot.mjs'));
    cpSync(join(SOURCE_ROOT, 'skills', 'port-daddy-agent-skill'), join(this.stagedDir, 'skills', 'port-daddy-agent-skill'), { recursive: true });
    cpSync(join(SOURCE_ROOT, 'agents', 'port-daddy-pilot'), join(this.stagedDir, 'agents', 'port-daddy-pilot'), { recursive: true });
  }

  validateStage() {
    const pd = assertExecutableArtifact(join(this.stagedDir, 'pd'));
    const companion = assertExecutableArtifact(join(this.stagedDir, 'port-daddy'));
    const manifestPath = join(this.stagedDir, 'port-daddy-manifest.json');
    if (!existsSync(manifestPath)) throw new Error(`compiled manifest missing: ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.smoke?.status !== 'ok') {
      throw new Error(`compiled artifact manifest does not carry a passing self-smoke receipt: ${manifest.smoke?.status || 'missing'}`);
    }
    for (const entry of this.matrix.artifactContract.releaseEntries) {
      if (!existsSync(join(this.stagedDir, entry))) throw new Error(`staged release entry missing: ${entry}`);
    }
    this.stageBefore = snapshotTreeMetadata(this.stagedDir);
    return {
      pd: { ...pd, path: join(this.stagedDir, 'pd') },
      companion: { ...companion, path: join(this.stagedDir, 'port-daddy') },
      manifestSha256: sha256File(manifestPath),
      target: manifest.target ?? null,
      version: manifest.version ?? null,
    };
  }

  caseRoot(testCase) {
    this.caseCounter += 1;
    const name = `${String(this.caseCounter).padStart(2, '0')}-${stableCaseSlug(testCase.id)}`;
    const path = join(this.root, 'c', name);
    mkdirSync(path, { recursive: true });
    return path;
  }

  runtimePaths(caseRoot, port) {
    const runtimeRoot = join(caseRoot, 'r');
    const home = join(caseRoot, 'h');
    const pdHome = join(caseRoot, 'p');
    const contextDir = join(caseRoot, 'x');
    const tmp = join(caseRoot, 't');
    const db = join(runtimeRoot, 'registry.db');
    for (const path of [runtimeRoot, home, pdHome, contextDir, tmp]) mkdirSync(path, { recursive: true });
    const sock = join(runtimeRoot, 'pd.sock');
    const env = {
      ...secretFreeBaseEnv(),
      CI: process.env.CI || '1',
      HOME: home,
      NODE_ENV: 'test',
      NO_COLOR: '1',
      PD_HOME: pdHome,
      PD_SCRATCH_ROOT: join(caseRoot, 'scratch'),
      PORT_DADDY_BIN_OVERRIDE: join(this.stagedDir, 'pd'),
      PORT_DADDY_CONTEXT_DIR: contextDir,
      PORT_DADDY_DB: db,
      PORT_DADDY_DISABLE_KEYCHAIN: '1',
      PORT_DADDY_HEARTBEAT_FILE: join(runtimeRoot, 'heartbeat'),
      PORT_DADDY_IPC: join(runtimeRoot, 'pd.ipc'),
      PORT_DADDY_NO_FLEET: '1',
      PORT_DADDY_NO_FLEETBAR: '1',
      PORT_DADDY_NO_RETRY: '1',
      PORT_DADDY_PID_FILE: join(runtimeRoot, 'daemon.pid'),
      PORT_DADDY_PORT: String(port),
      PORT_DADDY_PORT_FILE: join(runtimeRoot, 'daemon.port'),
      PORT_DADDY_PREFIX: runtimeRoot,
      PORT_DADDY_READY_FILE: join(runtimeRoot, 'daemon.ready'),
      PORT_DADDY_RESOURCE_DIR: this.stagedDir,
      PORT_DADDY_SILENT: '1',
      PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
      PORT_DADDY_SNAPSHOT_ROOT: join(caseRoot, 'snapshots'),
      PORT_DADDY_SOCK: sock,
      PORT_DADDY_TEST_DB: db,
      TERM: 'dumb',
      TMPDIR: tmp,
      USERPROFILE: home,
    };
    return { caseRoot, contextDir, env, home, pdHome, port, runtimeRoot, sock, tmp };
  }

  async startDaemon(runtime, label = 'daemon') {
    const child = spawn(join(this.stagedDir, 'pd'), ['__daemon'], {
      cwd: runtime.caseRoot,
      env: runtime.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeChildren.add(child);
    const daemon = { child, runtime, label, bootChunks: [], spawnError: null };
    const capture = (channel, chunk) => {
      const text = chunk.toString();
      daemon.bootChunks.push(`[${channel}] ${text}`);
      while (Buffer.byteLength(daemon.bootChunks.join('')) > CHILD_OUTPUT_LIMIT) daemon.bootChunks.shift();
      this.appendLog(`${label}:${channel}`, text);
    };
    child.stdout.on('data', (chunk) => capture('stdout', chunk));
    child.stderr.on('data', (chunk) => capture('stderr', chunk));
    child.once('error', (error) => {
      daemon.spawnError = error;
    });
    try {
      await this.waitForReady(daemon);
      return daemon;
    } catch (error) {
      if (daemon.child.pid === undefined) this.activeChildren.delete(daemon.child);
      else await this.stopDaemon(daemon, 'SIGKILL');
      throw error;
    }
  }

  daemonReadinessEvidence(daemon, { classification, startedAt, timeoutMs, attempts, lastError = null }) {
    const rawBootLog = daemon.bootChunks.join('');
    const redactedBootLog = redactReleaseCandidateText(rawBootLog, this.knownSecrets);
    return {
      category: 'daemon-readiness',
      classification,
      phase: 'daemon-boot-to-health',
      elapsedMs: Date.now() - startedAt,
      hardDeadlineMs: timeoutMs,
      attempts,
      lastError: lastError
        ? redactReleaseCandidateText(lastError instanceof Error ? lastError.message : String(lastError), this.knownSecrets)
        : null,
      process: {
        pid: daemon.child.pid ?? null,
        exitCode: daemon.child.exitCode,
        signalCode: daemon.child.signalCode,
        exited: daemon.child.exitCode !== null || daemon.child.signalCode !== null,
      },
      bootLog: {
        bytes: Buffer.byteLength(rawBootLog),
        redacted: true,
        truncated: redactedBootLog.length > DAEMON_BOOT_LOG_LIMIT,
        tail: redactedBootLog.slice(-DAEMON_BOOT_LOG_LIMIT),
      },
    };
  }

  async waitForReady(daemon, timeoutMs = DAEMON_READINESS_TIMEOUT_MS) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let attempts = 0;
    let lastError = null;
    while (Date.now() < deadline) {
      if (daemon.spawnError) {
        const evidence = this.daemonReadinessEvidence(daemon, {
          classification: 'process-spawn-failed',
          startedAt,
          timeoutMs,
          attempts,
          lastError: daemon.spawnError,
        });
        throw new Error(`${daemon.label} readiness failed: ${JSON.stringify(evidence)}`);
      }
      if (daemon.child.exitCode !== null || daemon.child.signalCode !== null) {
        const evidence = this.daemonReadinessEvidence(daemon, {
          classification: 'process-exited-before-readiness',
          startedAt,
          timeoutMs,
          attempts,
          lastError,
        });
        throw new Error(`${daemon.label} readiness failed: ${JSON.stringify(evidence)}`);
      }
      attempts += 1;
      try {
        const health = await this.requestJson(daemon.runtime, '/health', 'tcp', 1_000);
        if (health.statusCode === 200 && health.body?.pid === daemon.child.pid) {
          daemon.readiness = this.daemonReadinessEvidence(daemon, {
            classification: 'expected-initialization-complete',
            startedAt,
            timeoutMs,
            attempts,
          });
          return health.body;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(250);
    }
    const evidence = this.daemonReadinessEvidence(daemon, {
      classification: 'readiness-deadline-exceeded',
      startedAt,
      timeoutMs,
      attempts,
      lastError,
    });
    throw new Error(`${daemon.label} readiness failed: ${JSON.stringify(evidence)}`);
  }

  async stopDaemon(daemon, signal = 'SIGTERM') {
    if (!daemon?.child) return null;
    const child = daemon.child;
    const pid = child.pid ?? null;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    let exit = await processExited(child, signal === 'SIGKILL' ? 3_000 : 10_000);
    if (!exit && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      exit = await processExited(child, 3_000);
    }
    if (!exit) throw new Error(`${daemon.label} did not exit within the bounded cleanup window`);
    if (pid !== null) {
      try {
        process.kill(pid, 0);
        throw new Error(`${daemon.label} process ${pid} remained alive after exit receipt`);
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    this.activeChildren.delete(child);
    return { ...exit, confirmedGone: true };
  }

  requestJson(runtime, path, transport = 'tcp', timeoutMs = 10_000, init = {}) {
    return new Promise((resolveRequest, reject) => {
      const body = init.body === undefined ? null : JSON.stringify(init.body);
      const headers = { ...(init.headers || {}) };
      if (body !== null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(body);
      }
      const request = http.request({
        method: init.method || 'GET',
        path,
        timeout: timeoutMs,
        headers,
        ...(transport === 'unix'
          ? { socketPath: runtime.sock }
          : { host: '127.0.0.1', port: runtime.port }),
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            reject(new Error(`${transport} ${path} returned non-JSON HTTP ${response.statusCode}`));
            return;
          }
          resolveRequest({ statusCode: response.statusCode, body: parsed, bytes: Buffer.byteLength(text) });
        });
      });
      request.once('error', reject);
      request.once('timeout', () => request.destroy(new Error(`${transport} ${path} timed out`)));
      if (body !== null) request.write(body);
      request.end();
    });
  }

  async withDaemon(caseRoot, callback) {
    const port = await reservePort();
    const runtime = this.runtimePaths(caseRoot, port);
    const daemon = await this.startDaemon(runtime);
    try {
      return await callback(daemon, runtime);
    } finally {
      await this.stopDaemon(daemon);
    }
  }

  async runCli(runtime, cwd, args, { slot = 'rc-e2e', transport = 'unix', allowFailure = false } = {}) {
    const binary = transport === 'tcp'
      ? join(this.stagedDir, 'pd')
      : join(this.stagedDir, 'port-daddy');
    const env = {
      ...runtime.env,
      PORT_DADDY_CONTEXT_SLOT: slot,
      ...(transport === 'tcp' ? { PORT_DADDY_FORCE_TCP: '1' } : { PORT_DADDY_FORCE_TCP: '0' }),
    };
    return this.runCommand(binary, args, {
      allowFailure,
      cwd,
      env,
      label: `pd-${transport}-${args[0] || 'help'}`,
      stream: false,
      timeoutMs: 20_000,
    });
  }

  async artifactReleaseLayout(caseRoot) {
    const pd = assertExecutableArtifact(join(this.stagedDir, 'pd'));
    const companion = assertExecutableArtifact(join(this.stagedDir, 'port-daddy'));
    const batten = await this.runCommand(join(this.stagedDir, 'pd'), [
      'batten',
      'verify',
      '--staged-dir',
      this.stagedDir,
    ], {
      cwd: SOURCE_ROOT,
      env: this.isolatedEnv({ PORT_DADDY_RESOURCE_DIR: this.stagedDir }),
      label: 'batten-verify',
      timeoutMs: 60_000,
    });
    if (!/pass|verified|valid/i.test(batten.stdout)) throw new Error('batten verifier did not print a success verdict');
    return {
      artifactHashes: { pd: pd.sha256, companion: companion.sha256 },
      artifactBytes: { pd: pd.bytes, companion: companion.bytes },
      releaseEntries: this.matrix.artifactContract.releaseEntries,
      syntheticCellar: this.stagedDir.includes(`${sep}Cellar${sep}`),
      caseRoot: basename(caseRoot),
    };
  }

  async packageResourceDiscovery(caseRoot) {
    const stageBefore = snapshotTreeMetadata(this.stagedDir);
    await this.runCommand(process.execPath, [
      join(SOURCE_ROOT, 'scripts', 'smoke-squid-release.mjs'),
      join(this.stagedDir, 'pd'),
      this.stagedDir,
    ], {
      cwd: caseRoot,
      env: this.isolatedEnv({ TMPDIR: join(caseRoot, 'tmp') }),
      label: 'existing-squid-release-smoke',
      timeoutMs: 110_000,
    });
    const stageAfter = snapshotTreeMetadata(this.stagedDir);
    if (JSON.stringify(stageAfter) !== JSON.stringify(stageBefore)) {
      throw new Error('package resource smoke mutated the staged release tree');
    }
    const authority = findAuthorityArtifacts(this.stagedDir);
    if (authority.length) throw new Error(`authority state appeared in synthetic Cellar: ${authority.join(', ')}`);
    return {
      stagedTreeUnchanged: true,
      authorityArtifactsInCellar: 0,
      reusedSmoke: 'scripts/smoke-squid-release.mjs',
    };
  }

  async transportParity(caseRoot) {
    return this.withDaemon(caseRoot, async (daemon, runtime) => {
      const [tcpHealth, unixHealth, tcpVersion, unixVersion] = await Promise.all([
        this.requestJson(runtime, '/health', 'tcp'),
        this.requestJson(runtime, '/health', 'unix'),
        this.requestJson(runtime, '/version', 'tcp'),
        this.requestJson(runtime, '/version', 'unix'),
      ]);
      for (const response of [tcpHealth, unixHealth, tcpVersion, unixVersion]) {
        if (response.statusCode !== 200) throw new Error(`transport returned HTTP ${response.statusCode}`);
      }
      if (tcpHealth.body?.pid !== unixHealth.body?.pid || tcpHealth.body?.pid !== daemon.child.pid) {
        throw new Error('Unix and TCP health did not identify the same daemon process');
      }
      if (tcpVersion.body?.version !== unixVersion.body?.version) {
        throw new Error('Unix and TCP version payloads disagree');
      }
      const tcpCli = readJsonOutput(await this.runCli(runtime, caseRoot, ['status', '--json'], { transport: 'tcp' }), 'TCP CLI status');
      const unixCli = readJsonOutput(await this.runCli(runtime, caseRoot, ['status', '--json'], { transport: 'unix' }), 'Unix CLI status');
      return {
        pid: daemon.child.pid,
        readiness: daemon.readiness,
        version: tcpVersion.body.version,
        tcpBytes: tcpHealth.bytes,
        unixBytes: unixHealth.bytes,
        compiledCli: { tcp: tcpCli.success !== false, unix: unixCli.success !== false },
      };
    });
  }

  async createFixtureRepo(parent, name) {
    const repo = join(parent, name);
    mkdirSync(repo, { recursive: true });
    const env = secretFreeBaseEnv();
    await this.runCommand('git', ['init', '-b', 'main'], { cwd: repo, env, label: `git-init-${name}`, stream: false });
    await this.runCommand('git', ['config', 'user.name', 'Port Daddy RC Fixture'], { cwd: repo, env, label: `git-name-${name}`, stream: false });
    await this.runCommand('git', ['config', 'user.email', 'rc-fixture@invalid.example'], { cwd: repo, env, label: `git-email-${name}`, stream: false });
    writeFileSync(join(repo, 'README.md'), `# ${name}\n\nSynthetic release-candidate fixture.\n`);
    await this.runCommand('git', ['add', 'README.md'], { cwd: repo, env, label: `git-add-${name}`, stream: false });
    await this.runCommand('git', ['commit', '-m', `Initialize ${name}`], { cwd: repo, env, label: `git-commit-${name}`, stream: false });
    return repo;
  }

  async coordinationRestartRepositoryFamily(caseRoot) {
    const fixtures = join(caseRoot, 'fixtures');
    mkdirSync(fixtures, { recursive: true });
    const alpha = await this.createFixtureRepo(fixtures, 'alpha');
    const beta = await this.createFixtureRepo(fixtures, 'beta');
    const alphaLinked = join(fixtures, 'alpha-linked');
    await this.runCommand('git', ['worktree', 'add', '-b', 'rc-linked', alphaLinked], {
      cwd: alpha,
      env: secretFreeBaseEnv(),
      label: 'git-worktree-add-alpha',
      stream: false,
    });

    const port = await reservePort();
    const runtime = this.runtimePaths(caseRoot, port);
    let daemon = await this.startDaemon(runtime, 'coordination-daemon-before-crash');
    const beforeCrashReadiness = daemon.readiness;
    const matrixEnvFindings = () => findAuthorityArtifacts(caseRoot)
      .filter((path) => basename(path) === 'matrix.env');
    if (matrixEnvFindings().length > 0) {
      throw new Error('compiled product created matrix.env before any coordination journey');
    }
    const sessions = [];
    const specs = [
      { label: 'alpha-main', cwd: alpha, slot: 'alpha-main', allowMain: true },
      { label: 'alpha-linked', cwd: alphaLinked, slot: 'alpha-linked', allowMain: false },
      { label: 'beta-main', cwd: beta, slot: 'beta-main', allowMain: true },
    ];
    try {
      for (const spec of specs) {
        const beginArgs = [
          'begin',
          `RC fixture ${spec.label}`,
          '--identity',
          `port-daddy:rc-e2e:${spec.label}`,
          '--lifecycle',
          'durable',
          '--sidequest',
          'release-candidate synthetic fixture',
          '--json',
        ];
        if (spec.allowMain) beginArgs.splice(-1, 0, '--allow-main-worktree');
        const begin = readJsonOutput(await this.runCli(runtime, spec.cwd, beginArgs, { slot: spec.slot }), `begin ${spec.label}`);
        const sessionId = begin.sessionId || begin.id;
        if (!begin.success || typeof sessionId !== 'string') throw new Error(`begin ${spec.label} returned an incomplete receipt`);
        await this.runCli(runtime, spec.cwd, ['plan', 'set', `* [ ] verify ${spec.label}`], { slot: spec.slot });
        await this.runCli(runtime, spec.cwd, ['plan', 'check', '1'], { slot: spec.slot });
        const plan = await this.runCli(runtime, spec.cwd, ['plan', 'show'], { slot: spec.slot });
        if (!plan.stdout.includes(`* [x] verify ${spec.label}`)) throw new Error(`checked plan did not read back for ${spec.label}`);
        await this.runCli(runtime, spec.cwd, ['note', `RC evidence ${spec.label}`, '--type', 'evidence', '--json'], { slot: spec.slot });
        const claim = readJsonOutput(await this.runCli(runtime, spec.cwd, ['session', 'files', 'add', 'README.md', '--json'], { slot: spec.slot }), `claim ${spec.label}`);
        if (!claim.success || !claim.claimed?.includes('README.md')) throw new Error(`README claim did not land for ${spec.label}`);
        const sitrep = await this.runCli(runtime, spec.cwd, ['sitrep'], { slot: spec.slot });
        if (!sitrep.stdout.includes(sessionId)) throw new Error(`sitrep did not name ${spec.label}'s active session`);
        sessions.push({ ...spec, sessionId });
      }

      const beforeCrash = new Map();
      for (const spec of sessions) {
        const detail = await this.requestJson(runtime, `/sessions/${encodeURIComponent(spec.sessionId)}`, 'unix');
        if (detail.statusCode !== 200 || detail.body?.success !== true) {
          throw new Error(`session detail missing before restart for ${spec.label}`);
        }
        const session = detail.body.session;
        beforeCrash.set(spec.sessionId, {
          sessionId: session?.id,
          noteIds: (detail.body.notes || []).map((note) => String(note.id)).sort(),
          claimIds: (detail.body.files || []).map((file) => [
            file.sessionId,
            file.filePath,
            file.startLine ?? null,
            file.endLine ?? null,
            file.symbolPath ?? null,
            file.claimedAt,
          ].join(':')).sort(),
          noteCount: session?.noteCount,
          fileCount: session?.fileCount,
        });
      }

      const crashPid = daemon.child.pid;
      const crashExit = await this.stopDaemon(daemon, 'SIGKILL');
      if (!crashExit || crashExit.signal !== 'SIGKILL') throw new Error('forced daemon crash did not produce a SIGKILL receipt');
      daemon = await this.startDaemon(runtime, 'coordination-daemon-after-crash');
      const afterCrashReadiness = daemon.readiness;
      if (daemon.child.pid === crashPid) throw new Error('restart reused the crashed process id');

      const details = [];
      for (const spec of sessions) {
        const who = readJsonOutput(await this.runCli(runtime, spec.cwd, ['whoami', '--json'], { slot: spec.slot }), `whoami ${spec.label}`);
        if (who.sessionId !== spec.sessionId) throw new Error(`context readback drifted for ${spec.label}`);
        const plan = await this.runCli(runtime, spec.cwd, ['plan', 'show'], { slot: spec.slot });
        if (!plan.stdout.includes(`* [x] verify ${spec.label}`)) throw new Error(`plan did not survive restart for ${spec.label}`);
        const detail = await this.requestJson(runtime, `/sessions/${encodeURIComponent(spec.sessionId)}`, 'unix');
        if (detail.statusCode !== 200 || detail.body?.success !== true) throw new Error(`session detail missing after restart for ${spec.label}`);
        const session = detail.body.session;
        const noteBodies = (detail.body.notes || []).map((note) => note.content);
        const filePaths = (detail.body.files || []).map((file) => file.filePath || file.file_path || file.path);
        if (!noteBodies.includes(`RC evidence ${spec.label}`)) throw new Error(`note did not survive restart for ${spec.label}`);
        if (!filePaths.includes('README.md')) throw new Error(`claim did not survive restart for ${spec.label}`);
        if (!session?.metadata?.worktree) throw new Error(`worktree metadata missing for ${spec.label}`);
        const afterCrash = {
          sessionId: session.id,
          noteIds: (detail.body.notes || []).map((note) => String(note.id)).sort(),
          claimIds: (detail.body.files || []).map((file) => [
            file.sessionId,
            file.filePath,
            file.startLine ?? null,
            file.endLine ?? null,
            file.symbolPath ?? null,
            file.claimedAt,
          ].join(':')).sort(),
          noteCount: session.noteCount,
          fileCount: session.fileCount,
        };
        if (JSON.stringify(afterCrash) !== JSON.stringify(beforeCrash.get(spec.sessionId))) {
          throw new Error(`session/note/claim identities or totals changed across restart for ${spec.label}`);
        }
        details.push({ label: spec.label, sessionId: spec.sessionId, worktree: session.metadata.worktree });
      }

      const alphaMain = details.find((entry) => entry.label === 'alpha-main');
      const alphaWorktree = details.find((entry) => entry.label === 'alpha-linked');
      const betaMain = details.find((entry) => entry.label === 'beta-main');
      if (alphaMain.worktree.id === alphaWorktree.worktree.id) throw new Error('linked worktree did not receive a distinct worktree id');
      const alphaFamily = canonicalRecordedCommonDir(alphaMain.worktree);
      if (canonicalRecordedCommonDir(alphaWorktree.worktree) !== alphaFamily) throw new Error('linked worktree split from its repository family');
      if (canonicalRecordedCommonDir(betaMain.worktree) === alphaFamily) throw new Error('arbitrary fixture repositories collapsed into one family');
      if (matrixEnvFindings().length > 0) {
        throw new Error('compiled coordination created or required matrix.env for durable identity readback');
      }

      for (const spec of sessions) {
        await this.runCli(runtime, spec.cwd, [
          'done',
          `Result: ${spec.label} synthetic RC journey complete. not-applicable: fixture session only.`,
          '--status',
          'abandoned',
          '--json',
        ], { slot: spec.slot });
      }

      for (const repo of [alpha, alphaLinked, beta]) {
        const status = await this.runCommand('git', ['status', '--porcelain=v1'], {
          cwd: repo,
          env: secretFreeBaseEnv(),
          label: `git-status-${basename(repo)}`,
          stream: false,
        });
        if (status.stdout.trim()) throw new Error(`compiled coordination wrote into fixture checkout ${repo}: ${status.stdout}`);
        for (const authorityPath of ['.portdaddy/current.json', '.portdaddy/contexts', 'matrix.env', 'port-daddy.db', 'port-registry.db']) {
          if (existsSync(join(repo, authorityPath))) throw new Error(`authority state leaked into fixture checkout: ${authorityPath}`);
        }
      }

      return {
        crash: { pid: crashPid, signal: crashExit.signal },
        restartPid: daemon.child.pid,
        readiness: { beforeCrash: beforeCrashReadiness, afterRestart: afterCrashReadiness },
        sessions: details.map((entry) => ({ label: entry.label, sessionId: entry.sessionId, worktreeId: entry.worktree.id })),
        persistedIdentityTotals: [...beforeCrash.values()].map((snapshot) => ({
          sessionId: snapshot.sessionId,
          noteCount: snapshot.noteCount,
          noteIds: snapshot.noteIds,
          fileCount: snapshot.fileCount,
          claimCount: snapshot.claimIds.length,
        })),
        repositoryFamilies: { alphaShared: true, betaDistinct: true },
        matrixEnvArtifacts: 0,
        matrixEnvRequired: false,
        checkoutAuthorityArtifacts: 0,
      };
    } finally {
      await this.stopDaemon(daemon);
    }
  }

  async syntheticMultiClientPressure(caseRoot) {
    return this.withDaemon(caseRoot, async (daemon, runtime) => {
      const seedCount = 128;
      for (let index = 0; index < seedCount; index += 1) {
        const response = await this.requestJson(runtime, '/sessions', 'tcp', 5_000, {
          method: 'POST',
          body: {
            purpose: `rc-synthetic-session-${String(index).padStart(3, '0')}`,
            lifecycle: 'durable',
            metadata: { fixture: 'release-candidate', ordinal: index },
          },
        });
        if (response.statusCode !== 200 || response.body?.success !== true) {
          throw new Error(`synthetic registry seed ${index} failed with HTTP ${response.statusCode}`);
        }
      }

      const paths = [
        '/health',
        '/sessions?all=true&limit=2000',
        '/roadmap/items?status=all&limit=2000',
        '/galaxy/map?cluster=false&limit=200',
        '/fleet',
      ];
      const clients = 5;
      const cycles = 3;
      let globalInFlight = 0;
      let peakGlobalInFlight = 0;
      const perClientPeak = Array.from({ length: clients }, () => 0);
      const requestCounts = Object.fromEntries(paths.map((path) => [path, 0]));
      const failures = [];
      const started = Date.now();

      await Promise.all(Array.from({ length: clients }, async (_, client) => {
        let clientInFlight = 0;
        for (let cycle = 0; cycle < cycles; cycle += 1) {
          for (const path of paths) {
            clientInFlight += 1;
            globalInFlight += 1;
            perClientPeak[client] = Math.max(perClientPeak[client], clientInFlight);
            peakGlobalInFlight = Math.max(peakGlobalInFlight, globalInFlight);
            try {
              const response = await this.requestJson(runtime, path, 'tcp', 15_000);
              requestCounts[path] += 1;
              if (response.statusCode !== 200 || response.body?.success === false) {
                failures.push({ client, cycle, path, statusCode: response.statusCode });
              }
            } catch (error) {
              failures.push({ client, cycle, path, error: error instanceof Error ? error.message : String(error) });
            } finally {
              clientInFlight -= 1;
              globalInFlight -= 1;
            }
          }
        }
      }));
      if (failures.length) throw new Error(`synthetic multi-client reads failed: ${JSON.stringify(failures.slice(0, 5))}`);
      if (perClientPeak.some((peak) => peak !== 1)) throw new Error(`synthetic client overlap detected: ${perClientPeak.join(',')}`);
      if (daemon.child.exitCode !== null || daemon.child.signalCode !== null) throw new Error('daemon exited under synthetic multi-client pressure');
      const sessions = await this.requestJson(runtime, '/sessions?all=true&limit=2000', 'unix');
      const rows = sessions.body?.sessions;
      if (!Array.isArray(rows) || rows.length < seedCount) throw new Error(`only ${rows?.length ?? 0}/${seedCount} synthetic sessions read back`);
      return {
        seed: { kind: 'deterministic-metadata-only', sessions: seedCount },
        clients,
        cycles,
        requestCount: Object.values(requestCounts).reduce((sum, count) => sum + count, 0),
        requestCounts,
        perClientPeakInFlight: perClientPeak,
        peakGlobalInFlight,
        durationMs: Date.now() - started,
        postPressureSessionCount: rows.length,
        readiness: daemon.readiness,
      };
    });
  }

  async portCollisionRecovery(caseRoot) {
    const blocker = createServer((socket) => socket.end('occupied\n'));
    await new Promise((resolveListen, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolveListen);
    });
    const address = blocker.address();
    const port = typeof address === 'object' && address ? address.port : null;
    if (!Number.isSafeInteger(port)) throw new Error('collision fixture did not bind a TCP port');
    const runtime = this.runtimePaths(caseRoot, port);
    let child;
    let collisionExit = null;
    try {
      child = spawn(join(this.stagedDir, 'pd'), ['__daemon'], {
        cwd: caseRoot,
        env: runtime.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.activeChildren.add(child);
      child.stdout.on('data', (chunk) => this.appendLog('collision-daemon:stdout', chunk.toString()));
      child.stderr.on('data', (chunk) => this.appendLog('collision-daemon:stderr', chunk.toString()));
      collisionExit = await processExited(child, 15_000);
      if (!collisionExit) throw new Error('colliding daemon did not fail within 15 seconds');
      if (collisionExit.code === 0) throw new Error('colliding daemon reported success while the port was occupied');
    } finally {
      let cleanupError = null;
      if (child) {
        try {
          const pid = child.pid ?? null;
          if (!collisionExit && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          collisionExit ??= await processExited(child, 3_000);
          if (!collisionExit) throw new Error(`colliding daemon ${pid ?? 'unknown'} did not exit during bounded cleanup`);
          if (pid !== null) {
            try {
              process.kill(pid, 0);
              throw new Error(`colliding daemon ${pid} remained alive after its exit receipt`);
            } catch (error) {
              if (error?.code !== 'ESRCH') throw error;
            }
          }
          this.activeChildren.delete(child);
        } catch (error) {
          cleanupError = error;
        }
      }
      await new Promise((resolveClose) => blocker.close(resolveClose));
      if (cleanupError) throw cleanupError;
    }

    const cleanDaemon = await this.startDaemon(runtime, 'post-collision-daemon');
    try {
      const health = await this.requestJson(runtime, '/health', 'tcp');
      if (health.statusCode !== 200 || health.body?.pid !== cleanDaemon.child.pid) {
        throw new Error('daemon did not recover after collision listener released the port');
      }
      return { port, collisionRejected: true, postReleasePid: cleanDaemon.child.pid, readiness: cleanDaemon.readiness };
    } finally {
      await this.stopDaemon(cleanDaemon);
    }
  }

  async partialFailureCleanup(caseRoot) {
    const nested = join(caseRoot, 'injected');
    mkdirSync(nested, { recursive: true });
    const runtime = this.runtimePaths(nested, await reservePort());
    const daemon = await this.startDaemon(runtime, 'partial-failure-daemon');
    const pid = daemon.child.pid;
    let sawSentinel = false;
    try {
      throw new Error('INJECTED_RELEASE_CANDIDATE_FAILURE');
    } catch (error) {
      sawSentinel = error instanceof Error && error.message === 'INJECTED_RELEASE_CANDIDATE_FAILURE';
    } finally {
      await this.stopDaemon(daemon);
      assertOwnedSyntheticTree(nested);
      rmSync(nested, { recursive: true, force: true });
    }
    if (!sawSentinel) throw new Error('partial-failure sentinel was not observed');
    if (existsSync(nested)) throw new Error('partial-failure runtime directory survived cleanup');
    try {
      process.kill(pid, 0);
      throw new Error(`partial-failure daemon ${pid} survived cleanup`);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    return { injectedFailureObserved: true, processGone: true, runtimeRemoved: true, readiness: daemon.readiness };
  }

  async secretFreeLogs() {
    const secrets = [
      `ghp_${randomBytes(24).toString('hex')}`,
      `rc-password-${randomBytes(12).toString('hex')}`,
      `rc-credential-${randomBytes(12).toString('hex')}`,
    ];
    this.knownSecrets.push(...secrets);
    const before = existsSync(this.logPath) ? statSync(this.logPath).size : 0;
    const result = await this.runCommand(process.execPath, [SECRET_FIXTURE, ...secrets], {
      cwd: this.root,
      env: this.isolatedEnv(),
      label: 'hostile-secret-fixture',
      secrets,
      stream: false,
    });
    if (!secrets.every((secret) => `${result.stdout}\n${result.stderr}`.includes(secret))) {
      throw new Error('hostile fixture did not emit every secret canary into captured process memory');
    }
    const durable = readFileSync(this.logPath, 'utf8').slice(before);
    if (secrets.some((secret) => durable.includes(secret))) throw new Error('a secret canary reached the durable suite log');
    if (!durable.includes('[REDACTED]')) throw new Error('durable suite log did not record an explicit redaction marker');
    return { canaryCount: secrets.length, leakedCanaries: 0, durableRedactionMarkers: (durable.match(/\[REDACTED/g) || []).length };
  }

  async existingCompiledCliSurface(caseRoot) {
    await this.runCommand('bash', [join(SOURCE_ROOT, 'scripts', 'e2e-compiled-cli-surface.sh')], {
      cwd: SOURCE_ROOT,
      env: this.isolatedEnv({
        E2E_CLI_SURFACE_PORT: String(await reservePort()),
        PD_E2E_BIN: join(this.stagedDir, 'port-daddy'),
        SMOKE_SCRATCH_BASE: join(caseRoot, 'scratch'),
      }),
      label: 'existing-compiled-cli-surface',
      timeoutMs: 410_000,
    });
    return { reusedSmoke: 'scripts/e2e-compiled-cli-surface.sh', stagedBinary: 'port-daddy' };
  }

  async existingBoundedPackagedSoak(caseRoot) {
    await this.runCommand('bash', [
      join(SOURCE_ROOT, 'scripts', 'soak-binary.sh'),
      join(this.stagedDir, 'port-daddy'),
    ], {
      cwd: SOURCE_ROOT,
      env: this.isolatedEnv({
        SOAK_BOOT_GRACE: '120',
        SOAK_PORT: String(await reservePort()),
        SOAK_PREFIX: join(caseRoot, 'soak'),
        SOAK_SECONDS: '20',
        SOAK_WORKLOAD: '1',
      }),
      label: 'existing-bounded-packaged-soak',
      timeoutMs: 180_000,
    });
    return { reusedSmoke: 'scripts/soak-binary.sh', seconds: 20, productionStateClaimed: false };
  }

  async runCase(testCase) {
    const caseRoot = this.caseRoot(testCase);
    const started = Date.now();
    console.log(`\nCASE ${testCase.id}`);
    console.log(`  proves: ${testCase.proves.join(' ')}`);
    console.log(`  does not prove: ${testCase.doesNotProve.join(' ')}`);
    const runner = this[testCase.runner];
    if (typeof runner !== 'function') throw new Error(`matrix runner is not implemented: ${testCase.runner}`);
    try {
      const evidence = await runner.call(this, caseRoot, testCase);
      const result = {
        id: testCase.id,
        shard: testCase.shard,
        status: 'passed',
        durationMs: Date.now() - started,
        proves: testCase.proves,
        doesNotProve: testCase.doesNotProve,
        evidence,
      };
      this.results.push(result);
      console.log(`PASS ${testCase.id} (${result.durationMs}ms)`);
    } catch (error) {
      const safeError = redactReleaseCandidateText(error instanceof Error ? error.message : String(error), this.knownSecrets);
      const result = {
        id: testCase.id,
        shard: testCase.shard,
        status: 'failed',
        durationMs: Date.now() - started,
        proves: testCase.proves,
        doesNotProve: testCase.doesNotProve,
        error: safeError,
      };
      this.results.push(result);
      console.error(`FAIL ${testCase.id}: ${safeError}`);
    }
  }

  assertBoundaries() {
    assertOwnedSyntheticTree(this.root);
    const checkoutAfter = this.checkoutAuthoritySnapshot();
    if (JSON.stringify(checkoutAfter) !== JSON.stringify(this.checkoutBefore)) {
      throw new Error('suite changed authority-shaped state in the source checkout');
    }
    if (this.stageBefore) {
      const stageAfter = snapshotTreeMetadata(this.stagedDir);
      if (JSON.stringify(stageAfter) !== JSON.stringify(this.stageBefore)) {
        throw new Error('suite mutated its staged release artifacts');
      }
      const authority = findAuthorityArtifacts(this.stagedDir);
      if (authority.length) throw new Error(`authority state found in staged Cellar tree: ${authority.join(', ')}`);
    }
  }

  writeResults(artifact, boundaryError = null, setupError = null) {
    const externalGates = this.matrix.externalGates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      phase1Claimed: false,
      requiredForReleaseCandidate: gate.requiredForReleaseCandidate,
      currentAggregateStatus: gate.currentAggregateObservation?.status ?? 'unverified',
      skipContract: gate.skipContract ?? null,
    }));
    const document = {
      schemaVersion: 1,
      suite: this.matrix.suite,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      sourceRevision: this.sourceRevision,
      artifact,
      rootPolicy: '$HOME/coding/tmp',
      selectedShard: this.options.shard,
      cases: this.results,
      setup: setupError ?? { status: 'passed' },
      cleanup: this.cleanupEvidence ?? { status: 'not-run' },
      boundary: setupError
        ? { status: 'not-run' }
        : boundaryError
          ? { status: 'failed', error: boundaryError }
          : { status: 'passed' },
      externalGates,
      summary: {
        passed: this.results.filter((result) => result.status === 'passed').length,
        failed: this.results.filter((result) => result.status === 'failed').length
          + (boundaryError ? 1 : 0)
          + (setupError ? 1 : 0),
        externalNotClaimed: externalGates.length,
      },
    };
    const safe = redactReleaseCandidateText(`${JSON.stringify(document, null, 2)}\n`, this.knownSecrets);
    writeFileSync(this.resultsPath, safe, { mode: 0o600 });
    for (const secret of this.knownSecrets) {
      if (readFileSync(this.resultsPath, 'utf8').includes(secret)) throw new Error('secret canary reached results JSON');
    }
    return document;
  }

  async cleanup(force = false) {
    const children = [...this.activeChildren];
    const receipts = [];
    for (const child of children) {
      const pid = child.pid ?? null;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      const exit = await processExited(child, 3_000);
      if (!exit) throw new Error(`cleanup could not confirm exit for child ${pid ?? 'unknown'}`);
      if (pid !== null) {
        try {
          process.kill(pid, 0);
          throw new Error(`cleanup child ${pid} is still alive after exit receipt`);
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      receipts.push({ pid, code: exit.code, signal: exit.signal, confirmedGone: true });
      this.activeChildren.delete(child);
    }
    const shouldRemove = force
      || (!this.options.keep && !this.boundaryError && this.results.every((result) => result.status === 'passed'));
    if (shouldRemove) {
      assertOwnedSyntheticTree(this.root);
      rmSync(this.root, { recursive: true, force: true });
    }
    this.cleanupEvidence = {
      status: 'passed',
      observedActiveChildren: children.length,
      exitReceipts: receipts,
      rootRemoved: shouldRemove && !existsSync(this.root),
      rootPreservedForFailure: !shouldRemove && existsSync(this.root),
    };
    return this.cleanupEvidence;
  }

  async run() {
    this.prepare();
    const revision = await this.runCommand('git', ['rev-parse', 'HEAD'], {
      cwd: SOURCE_ROOT,
      env: secretFreeBaseEnv(),
      label: 'git-revision',
      stream: false,
    });
    this.sourceRevision = revision.stdout.trim();
    if (this.options.build) {
      try {
        await this.buildAndStage();
      } catch (error) {
        const setupError = {
          status: 'failed',
          category: 'artifact-build',
          error: redactReleaseCandidateText(error instanceof Error ? error.message : String(error), this.knownSecrets),
        };
        this.writeResults(null, null, setupError);
        console.error(`Setup failure results: ${this.resultsPath}`);
        throw error;
      }
    }
    let artifact;
    try {
      artifact = this.validateStage();
    } catch (error) {
      const setupError = {
        status: 'failed',
        category: 'artifact-stage-validation',
        error: redactReleaseCandidateText(error instanceof Error ? error.message : String(error), this.knownSecrets),
      };
      this.writeResults(null, null, setupError);
      console.error(`Setup failure results: ${this.resultsPath}`);
      throw error;
    }
    for (const testCase of this.cases) await this.runCase(testCase);
    let boundaryError = null;
    try {
      this.assertBoundaries();
    } catch (error) {
      boundaryError = redactReleaseCandidateText(error instanceof Error ? error.message : String(error), this.knownSecrets);
      console.error(`FAIL authority boundary: ${boundaryError}`);
    }
    this.boundaryError = boundaryError;
    try {
      await this.cleanup();
    } catch (error) {
      const cleanupError = redactReleaseCandidateText(error instanceof Error ? error.message : String(error), this.knownSecrets);
      this.cleanupEvidence = { status: 'failed', error: cleanupError };
      boundaryError = [boundaryError, `cleanup failed: ${cleanupError}`].filter(Boolean).join('; ');
      this.boundaryError = boundaryError;
    }
    const document = this.writeResults(artifact, boundaryError);
    console.log(`\nRESULT ${document.summary.failed === 0 ? 'PASS' : 'FAIL'}: ${document.summary.passed} passed, ${document.summary.failed} failed, ${document.summary.externalNotClaimed} external gates not claimed`);
    console.log(`Results: ${this.resultsPath}`);
    for (const gate of this.matrix.externalGates) {
      console.log(`EXTERNAL ${gate.id}: ${gate.status}; Phase 1 does not claim this gate`);
    }
    return document.summary.failed === 0 ? 0 : 1;
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return 0;
    }
    const matrixPath = resolve(options.manifest || DEFAULT_MATRIX);
    const matrix = loadReleaseCandidateMatrix(matrixPath);
    if (options.list) {
      for (const testCase of matrix.cases) {
        console.log(`CASE ${testCase.id} shard=${testCase.shard} required=${testCase.required}`);
        console.log(`  proves: ${testCase.proves.join(' ')}`);
        console.log(`  does not prove: ${testCase.doesNotProve.join(' ')}`);
      }
      for (const gate of matrix.externalGates) {
        console.log(`EXTERNAL ${gate.id} status=${gate.status} phase1Claimed=${gate.phase1Claimed}`);
      }
      return 0;
    }
    const cases = selectReleaseCandidateCases(matrix, { shard: options.shard, caseIds: options.caseIds });
    const suite = new ReleaseCandidateSuite(options, matrix, cases);
    return await suite.run();
  } catch (error) {
    console.error(`release-candidate E2E setup failed: ${redactReleaseCandidateText(error instanceof Error ? error.message : String(error))}`);
    return 1;
  }
}

process.exitCode = await main();
