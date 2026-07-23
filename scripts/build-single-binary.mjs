#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT_DIR = resolve(new URL('..', import.meta.url).pathname);
const DIST_DIR = join(ROOT_DIR, 'dist');
const DEFAULT_OUTFILE = join(DIST_DIR, process.platform === 'win32' ? 'port-daddy.exe' : 'port-daddy');
const EMBEDDED_ASSETS_MODULE = join(DIST_DIR, 'embedded-public-assets.generated.js');
const EMBEDDED_NATIVE_CORE_MODULE = join(DIST_DIR, 'embedded-native-core.generated.js');

function readArg(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function launcherSource(binaryName) {
  return `#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

static int executable_path(char *buffer, size_t size) {
#ifdef __APPLE__
  uint32_t required = (uint32_t)size;
  if (_NSGetExecutablePath(buffer, &required) != 0) return -1;
  return 0;
#else
  ssize_t len = readlink("/proc/self/exe", buffer, size - 1);
  if (len < 0) return -1;
  buffer[len] = '\\0';
  return 0;
#endif
}

int main(int argc, char **argv) {
  char self[PATH_MAX];
  if (executable_path(self, sizeof(self)) != 0) {
    fprintf(stderr, "pd launcher: could not resolve executable path\\n");
    return 127;
  }

  char *slash = strrchr(self, '/');
  if (slash == NULL) {
    fprintf(stderr, "pd launcher: executable path has no directory: %s\\n", self);
    return 127;
  }

  char target[PATH_MAX];
  size_t dir_len = (size_t)(slash - self);
  int written = snprintf(target, sizeof(target), "%.*s/${binaryName}", (int)dir_len, self);
  if (written < 0 || (size_t)written >= sizeof(target)) {
    fprintf(stderr, "pd launcher: sibling binary path is too long\\n");
    return 127;
  }

  char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
  if (child_argv == NULL) {
    fprintf(stderr, "pd launcher: out of memory\\n");
    return 127;
  }

  child_argv[0] = target;
  for (int i = 1; i < argc; i += 1) {
    child_argv[i] = argv[i];
  }
  child_argv[argc] = NULL;

  setenv("PORT_DADDY_FORCE_TCP", "1", 1);
  execv(target, child_argv);
  fprintf(stderr, "pd launcher: failed to exec %s: %s\\n", target, strerror(errno));
  return 127;
}
`;
}

function writePdLauncher(launcherPath, binaryName) {
  const sourcePath = `${launcherPath}.launcher.c`;
  writeFileSync(sourcePath, launcherSource(binaryName));
  try {
    run('cc', [sourcePath, '-O2', '-o', launcherPath], { stdio: 'pipe' });
  } finally {
    rmSync(sourcePath, { force: true });
  }
  chmodSync(launcherPath, 0o755);
}

function targetPlatform(target) {
  if (!target) return process.platform;
  if (target.includes('darwin')) return 'darwin';
  if (target.includes('linux')) return 'linux';
  if (target.includes('windows')) return 'win32';
  return null;
}

function targetArch(target) {
  if (!target) return process.arch;
  if (target.includes('arm64')) return 'arm64';
  if (target.includes('x64')) return 'x64';
  return null;
}

function nativeCoreName(platform = process.platform) {
  if (platform === 'darwin') return 'libharbor_card_rs.dylib';
  if (platform === 'linux') return 'libharbor_card_rs.so';
  return null;
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

function posixPath(path) {
  return path.split(sep).join('/');
}

function contentTypeForPath(path) {
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.ts')) return 'text/plain; charset=utf-8';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  return 'application/octet-stream';
}

function writeEmbeddedAssetsModule() {
  const assetRoots = [
    join(ROOT_DIR, 'public', 'fleet-ui'),
    join(ROOT_DIR, 'public', 'samples'),
  ];
  const files = assetRoots.flatMap(collectFiles);
  if (files.length === 0) {
    throw new Error('No public assets found to embed in the single binary');
  }

  const routes = files.map((file) => {
    const publicPath = posixPath(relative(join(ROOT_DIR, 'public'), file));
    return `  ${JSON.stringify({
      path: `/${publicPath}`,
      type: contentTypeForPath(publicPath),
      dataBase64: readFileSync(file).toString('base64'),
    })},`;
  });

  writeFileSync(EMBEDDED_ASSETS_MODULE, [
    '// Generated by scripts/build-single-binary.mjs. Do not edit by hand.',
    'export const EMBEDDED_PUBLIC_ASSETS = [',
    ...routes,
    '];',
    'globalThis.__PORT_DADDY_EMBEDDED_PUBLIC_ASSETS__ = EMBEDDED_PUBLIC_ASSETS;',
    '',
  ].join('\n'));
  return files;
}

function writeEmbeddedNativeCoreModule(target) {
  const requestedPlatform = targetPlatform(target);
  const requestedArch = targetArch(target);
  const nativeName = nativeCoreName(requestedPlatform);

  if (!requestedPlatform || !requestedArch || !nativeName || requestedPlatform !== process.platform || requestedArch !== process.arch) {
    writeFileSync(EMBEDDED_NATIVE_CORE_MODULE, [
      '// Generated by scripts/build-single-binary.mjs. Do not edit by hand.',
      'export const EMBEDDED_NATIVE_CORE = null;',
      '',
    ].join('\n'));
    return {
      status: 'skipped',
      reason: requestedPlatform === process.platform && requestedArch === process.arch ? 'unsupported-platform' : 'cross-target build',
      targetPlatform: requestedPlatform,
      targetArch: requestedArch,
    };
  }

  run('bash', ['scripts/build-core.sh'], { stdio: 'inherit' });

  const corePath = join(DIST_DIR, 'core', nativeName);
  if (!existsSync(corePath)) {
    throw new Error(`Expected native core at ${corePath}`);
  }

  const asset = {
    name: nativeName,
    platform: process.platform,
    arch: requestedArch,
    sha256: sha256(corePath),
    dataBase64: readFileSync(corePath).toString('base64'),
  };

  writeFileSync(EMBEDDED_NATIVE_CORE_MODULE, [
    '// Generated by scripts/build-single-binary.mjs. Do not edit by hand.',
    `export const EMBEDDED_NATIVE_CORE = ${JSON.stringify(asset, null, 2)};`,
    'globalThis.__PORT_DADDY_EMBEDDED_NATIVE_CORE__ = EMBEDDED_NATIVE_CORE;',
    '',
  ].join('\n'));

  return {
    status: 'embedded',
    path: corePath,
    name: asset.name,
    platform: asset.platform,
    arch: asset.arch,
    sha256: asset.sha256,
    sizeBytes: statSync(corePath).size,
  };
}

/**
 * `bun build --compile` embeds onnxruntime-node's `.node` N-API binding and
 * extracts it to a fresh temp directory on first use — but its sibling
 * runtime library (`libonnxruntime.*.dylib` / `libonnxruntime.so.1`), linked
 * via a Mach-O/ELF `@rpath`-relative entry, is NOT extracted alongside it.
 * The result: `@huggingface/transformers`' local embedder fails every
 * daemon boot with "Library not loaded: @rpath/libonnxruntime.*.dylib".
 *
 * Fix: ship the real runtime library as a plain file next to the compiled
 * binary (onnxruntime-node ships prebuilt binaries for every platform, so
 * this works even cross-target) and point `DYLD_FALLBACK_LIBRARY_PATH` /
 * `LD_LIBRARY_PATH` at it at runtime (lib/semantic-resolver.ts) — dyld's
 * fallback path is consulted at the actual `dlopen()` call, so it works
 * regardless of where Bun's own extraction puts the `.node` binding.
 */
function packageOnnxRuntimeNative(target) {
  const requestedPlatform = targetPlatform(target);
  const requestedArch = targetArch(target);
  if (!requestedPlatform || !requestedArch) {
    return { status: 'skipped', reason: 'unresolvable target' };
  }
  if (requestedPlatform === 'win32') {
    return { status: 'skipped', reason: 'windows onnxruntime.dll is not @rpath-linked; not applicable' };
  }

  const sourceDir = join(ROOT_DIR, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', requestedPlatform, requestedArch);
  if (!existsSync(sourceDir)) {
    return { status: 'skipped', reason: `no onnxruntime-node binaries at ${sourceDir}` };
  }

  const destDir = join(DIST_DIR, 'native', 'onnxruntime-node', `${requestedPlatform}-${requestedArch}`);
  mkdirSync(destDir, { recursive: true });

  const runtimeLibFiles = readdirSync(sourceDir).filter(name => !name.endsWith('.node'));
  for (const name of runtimeLibFiles) {
    copyFileSync(join(sourceDir, name), join(destDir, name));
  }

  return {
    status: runtimeLibFiles.length > 0 ? 'packaged' : 'skipped',
    reason: runtimeLibFiles.length > 0 ? null : 'no runtime library files found alongside the .node binding',
    platform: requestedPlatform,
    arch: requestedArch,
    dir: destDir,
    files: runtimeLibFiles,
  };
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

async function waitForJson(url, child, stderrChunks, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // Retry until the self-hosted daemon is listening or exits.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  throw new Error(`single binary daemon smoke failed for ${url}${stderr ? `\n${stderr}` : ''}`);
}

async function waitForText(url, child, stderrChunks, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {
      // Retry until the self-hosted daemon is listening or exits.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  throw new Error(`single binary static smoke failed for ${url}${stderr ? `\n${stderr}` : ''}`);
}

async function smokeSelfHostedDaemon(outfile, companionFiles = []) {
  const port = await reservePort();
  const prefix = join(tmpdir(), `pd-sb-${process.pid}`);
  const isolatedBinDir = join(prefix, 'isolated-bin');
  const isolatedOutfile = join(isolatedBinDir, basename(outfile));
  const resourceDir = join(prefix, 'empty-resource-root');
  rmSync(prefix, { recursive: true, force: true });
  mkdirSync(isolatedBinDir, { recursive: true });
  mkdirSync(resourceDir, { recursive: true });
  copyFileSync(outfile, isolatedOutfile);
  chmodSync(isolatedOutfile, 0o755);
  for (const companion of companionFiles) {
    const isolatedCompanion = join(isolatedBinDir, basename(companion));
    copyFileSync(companion, isolatedCompanion);
    chmodSync(isolatedCompanion, statSync(companion).mode | 0o755);
  }

  const stderrChunks = [];
  const child = spawn(isolatedOutfile, ['__daemon'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT_DADDY_PREFIX: join(prefix, 'runtime'),
      PORT_DADDY_PORT: String(port),
      PORT_DADDY_NO_FLEET: '1',
      PORT_DADDY_NO_FLEETBAR: '1',
      PORT_DADDY_RESOURCE_DIR: resourceDir,
      PORT_DADDY_SILENT: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));

  try {
    const health = await waitForJson(`http://127.0.0.1:${port}/health`, child, stderrChunks);
    const arbiter = await waitForJson(`http://127.0.0.1:${port}/arbiter/status`, child, stderrChunks);
    const samples = await waitForJson(`http://127.0.0.1:${port}/samples/manifest.json`, child, stderrChunks);
    const fleetHtml = await waitForText(`http://127.0.0.1:${port}/fleet-ui/index.html`, child, stderrChunks);
    if (arbiter?.enforcerLoaded !== true || arbiter?.summary?.degradedRules !== 0) {
      throw new Error('single binary daemon smoke failed: embedded native Arbiter enforcer was not loaded cleanly');
    }
    if (!Number.isInteger(samples?.count) || samples.count < 1) {
      throw new Error('single binary daemon smoke failed: embedded sample manifest was missing files');
    }
    if (!fleetHtml.includes('<!doctype html>') && !fleetHtml.includes('<!DOCTYPE html>')) {
      throw new Error('single binary daemon smoke failed: embedded Fleet UI index was not HTML');
    }
    const cliAttention = run(isolatedOutfile, ['attention', '--agent', 'pd-single-binary-smoke-agent', '--json'], {
      timeout: 15_000,
      env: {
        PORT_DADDY_URL: `http://127.0.0.1:${port}`,
        PORT_DADDY_PORT_FILE: join(prefix, 'missing.port'),
        PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
      },
    });
    const attention = JSON.parse(cliAttention.stdout);
    if (attention?.success !== true || attention?.agentId !== 'pd-single-binary-smoke-agent') {
      throw new Error('single binary CLI smoke failed: pd attention did not return the expected summary');
    }
    const cliBareAttention = run(isolatedOutfile, ['attention', '--json'], {
      timeout: 15_000,
      env: {
        PD_AGENT_ID: 'pd-single-binary-smoke-agent',
        PORT_DADDY_URL: `http://127.0.0.1:${port}`,
        PORT_DADDY_PORT_FILE: join(prefix, 'missing.port'),
        PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
      },
    });
    const bareAttention = JSON.parse(cliBareAttention.stdout);
    if (bareAttention?.success !== true || bareAttention?.agentId !== 'pd-single-binary-smoke-agent') {
      throw new Error('single binary CLI smoke failed: bare pd attention did not return the expected summary');
    }
    return {
      status: health?.status ?? 'unknown',
      pid: health?.pid ?? null,
      arbiter: {
        enforcerLoaded: arbiter.enforcerLoaded,
        enforcedRules: arbiter.summary?.enforcedRules ?? null,
        degradedRules: arbiter.summary?.degradedRules ?? null,
      },
      isolatedBinaryDir: isolatedBinDir,
      samples: { count: samples.count },
      fleetUi: { indexHtmlBytes: Buffer.byteLength(fleetHtml) },
      cli: { attention: attention.success === true, bareAttention: bareAttention.success === true },
    };
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolveKill => child.once('exit', resolveKill));
    }
    rmSync(prefix, { recursive: true, force: true });
  }
}

mkdirSync(DIST_DIR, { recursive: true });

const requestedOutfile = resolve(readArg('--outfile') || DEFAULT_OUTFILE);
const target = readArg('--target');
const canSmokeTarget = !target || (targetPlatform(target) === process.platform && targetArch(target) === process.arch);
const needsPdLauncher = process.platform !== 'win32' && basename(requestedOutfile) === 'pd';
const binaryOutfile = needsPdLauncher ? join(dirname(requestedOutfile), 'port-daddy') : requestedOutfile;
const launcherOutfile = needsPdLauncher ? requestedOutfile : null;
const entrypointOutfile = launcherOutfile ?? binaryOutfile;
const companionFiles = launcherOutfile ? [binaryOutfile] : [];

run(process.execPath, ['scripts/build-public-samples.mjs'], { stdio: 'inherit' });
const embeddedNativeCore = writeEmbeddedNativeCoreModule(target);
const embeddedAssets = writeEmbeddedAssetsModule();
const onnxRuntimeNative = packageOnnxRuntimeNative(target);

if (canSmokeTarget && embeddedNativeCore.status !== 'embedded') {
  throw new Error(`Expected embedded native core for same-runner target ${target || 'host'}; got ${embeddedNativeCore.status}`);
}

const bunArgs = ['build', '--compile'];
if (target) bunArgs.push(`--target=${target}`);
bunArgs.push('bin/port-daddy-bundle.ts', '--outfile', binaryOutfile);

run('bun', bunArgs, { stdio: 'inherit' });

if (!existsSync(binaryOutfile)) {
  throw new Error(`Expected single binary at ${binaryOutfile}`);
}

if (launcherOutfile) {
  writePdLauncher(launcherOutfile, basename(binaryOutfile));
  if (!existsSync(launcherOutfile)) {
    throw new Error(`Expected pd launcher at ${launcherOutfile}`);
  }
}

let smoke = { status: 'skipped', reason: 'cross-target build' };
if (canSmokeTarget) {
  const smokePrefix = join(tmpdir(), `pd-single-binary-smoke-${process.pid}`);
  const result = run(entrypointOutfile, ['help'], {
    timeout: 15_000,
    env: {
      PORT_DADDY_URL: 'http://127.0.0.1:1',
      PORT_DADDY_SOCK: join(smokePrefix, 'missing.sock'),
      PORT_DADDY_PORT_FILE: join(smokePrefix, 'missing.port'),
    },
  });
  smoke = {
    status: 'ok',
    command: 'help',
    target: target || null,
    stdout: result.stdout.trim(),
    daemon: await smokeSelfHostedDaemon(entrypointOutfile, companionFiles),
  };
}

const manifest = {
  version: 1,
  artifact: 'port-daddy',
  entrypoint: 'bin/port-daddy-bundle.ts',
  outfile: entrypointOutfile,
  binaryOutfile,
  launcherOutfile,
  platform: process.platform,
  arch: process.arch,
  target: target || null,
  sizeBytes: statSync(binaryOutfile).size,
  sha256: sha256(binaryOutfile),
  launcherSha256: launcherOutfile ? sha256(launcherOutfile) : null,
  builtAt: new Date().toISOString(),
  builder: `bun ${bunArgs.join(' ')}`,
  bunVersion: run('bun', ['--version']).stdout.trim(),
  embeddedPublicAssets: embeddedAssets.length,
  embeddedNativeCore,
  onnxRuntimeNative,
  surfaces: {
    cli: 'bundled',
    daemon: 'self-hosted via hidden __daemon entrypoint; companion dist/daemon binary remains available for daemon-only installs',
    mcp: 'in-process stdio import',
    sdk: 'compiled client modules plus package exports in npm distribution',
    fleetUi: 'embedded in the executable through a generated asset table with external public/ fallback',
    publicSamples: 'embedded in the executable through a generated asset table; manifest generated before compile',
  },
  smoke,
};

const manifestPath = join(dirname(entrypointOutfile), 'port-daddy-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Single binary manifest: ${manifestPath}`);
