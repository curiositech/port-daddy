import { existsSync, readdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { basename, dirname, join } from 'node:path';

export type DaemonLaunchMode = 'binary' | 'source' | 'self';

export interface DaemonLaunchCommand {
  mode: DaemonLaunchMode;
  program: string;
  args: string[];
  env?: Record<string, string>;
  binaryPath: string;
  sourceServerPath: string;
  sourceTsxPath: string;
  pathDirs: string[];
  reason: string;
}

export function daemonBinaryName(os: NodeJS.Platform = platform()): string {
  return os === 'win32' ? 'port-daddy-daemon.exe' : 'port-daddy-daemon';
}

/**
 * Resolve the packaged ONNX Runtime directory for one compiled executable.
 *
 * Why this resolver exists: release archives put `native/` beside the executable, while source builds
 * put it below `dist/`. Keeping both layouts here prevents daemon launchers,
 * installers, and semantic code from independently guessing the cargo path.
 *
 * @param resourceDir Distribution root published to the daemon.
 * @param executablePath Compiled executable that will load ONNX Runtime.
 * @param os Target operating system.
 * @param cpu Target CPU architecture.
 * @returns Existing packaged runtime directory, or null for source-only runs.
 */
export function resolveOnnxRuntimeNativeLibraryDir(
  resourceDir: string,
  executablePath: string,
  os: NodeJS.Platform = platform(),
  cpu: string = process.arch,
): string | null {
  if (os !== 'darwin' && os !== 'linux') return null;
  const platformArch = `${os}-${cpu}`;
  const candidates = [
    join(resourceDir, 'dist', 'native', 'onnxruntime-node', platformArch),
    join(resourceDir, 'native', 'onnxruntime-node', platformArch),
    join(dirname(executablePath), 'native', 'onnxruntime-node', platformArch),
  ];
  return candidates.find(candidate => isOnnxRuntimeNativeLibraryDir(candidate, os)) ?? null;
}

/**
 * Verify that a loader-path entry contains the platform's ONNX shared library.
 * Why this verifier exists: named profiles may supply an equivalent versioned
 * runtime root. This accepts those roots while rejecting unrelated
 * existing directories that would still fail the native import.
 *
 * @param directory Candidate dynamic-loader directory.
 * @param os Target operating system.
 * @returns True only when the expected ONNX shared-library filename is present.
 */
export function isOnnxRuntimeNativeLibraryDir(
  directory: string,
  os: NodeJS.Platform = platform(),
): boolean {
  try {
    const names = readdirSync(directory);
    if (os === 'darwin') {
      return names.some(name => /^libonnxruntime(?:\.[\d.]+)?\.dylib$/.test(name));
    }
    if (os === 'linux') {
      return names.some(name => /^libonnxruntime\.so(?:\.[\d.]+)?$/.test(name));
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Build the dynamic-loader environment required before a compiled daemon
 * process starts. macOS dyld and the Linux ELF loader read these values at
 * process admission; assigning process.env later cannot repair a failed
 * `dlopen()`. That timing constraint is why launch commands, rather than the
 * lazy semantic loader, own this environment.
 *
 * @param resourceDir Distribution root published to the daemon.
 * @param executablePath Compiled executable that will load ONNX Runtime.
 * @param env Parent environment whose existing loader path must be preserved.
 * @param os Target operating system.
 * @param cpu Target CPU architecture.
 * @returns Empty object when no packaged runtime applies, otherwise one loader variable.
 */
export function resolveOnnxRuntimeNativeLaunchEnv(
  resourceDir: string,
  executablePath: string,
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
  cpu: string = process.arch,
): Record<string, string> {
  const nativeDir = resolveOnnxRuntimeNativeLibraryDir(resourceDir, executablePath, os, cpu);
  if (!nativeDir) return {};
  const variable = os === 'darwin' ? 'DYLD_FALLBACK_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const existing = env[variable]?.trim();
  const entries = existing?.split(':').filter(Boolean) ?? [];
  const value = entries.includes(nativeDir)
    ? existing as string
    : [nativeDir, ...entries].join(':');
  return { [variable]: value };
}

export function sourceDaemonFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORT_DADDY_ALLOW_SOURCE_DAEMON === '1' || env.PORT_DADDY_DEV_SOURCE_DAEMON === '1';
}

export function selfDaemonLaunchAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORT_DADDY_CAN_SELF_DAEMON === '1';
}

export function isBunVirtualPath(path: string): boolean {
  return path.includes('/$bunfs/') || path.startsWith('/$bunfs/') || path.startsWith('$bunfs/');
}

/**
 * Pure detection helper for `bun build --compile` runtime context.
 *
 * Why this exists as its own function (not a closure over `process` / `import.meta`):
 * `import.meta.url` may be inlined at build time by bun's bundler, so a check
 * that *only* reads `import.meta.url` can wrongly return false at runtime
 * inside the compiled binary. That regression (issue #86, "fixed" in 3.14.1
 * but still observed in the field) bypassed the re-exec branch and tried to
 * spawn `node_modules/.bin/tsx` from inside the bun bundle, producing
 * `ENOENT: posix_spawn '/node_modules/.bin/tsx'`.
 *
 * The multi-signal probe: `process.versions.bun` is necessary but not
 * sufficient (source-mode bun also sets it). Then any one of:
 *   - `importMetaUrl` contains `/$bunfs/` (works when bun preserves it)
 *   - `errorStack` contains `/$bunfs/` (always reflects runtime paths)
 *   - `execPath` basename is not `bun` or `node` (compiled binaries name themselves)
 *
 * Tested via `tests/unit/daemon-bun-detection.test.js`.
 */
export interface BunRuntimeSignals {
  versionsBun: string | undefined;
  importMetaUrl: string;
  errorStack: string;
  execPath: string;
}

// Source-mode interpreter names. Anything else with process.versions.bun set
// is treated as a `bun build --compile` bundle by the third signal. We allow
// versioned bun (Homebrew @-formulae create `bun-1.3.14` symlinks) and the
// other shapes a developer might invoke: `bunx`, `node`, `tsx`. If a new
// interpreter ships, we'd rather false-negative here (and surface as the
// original ENOENT spawn error) than infinite-re-exec on the basename signal.
const INTERPRETER_BASENAME_RE = /^(bun(?:-[\w.+\-]+)?|bunx|node|tsx)$/i;

export function isBunCompiledRuntime(signals: BunRuntimeSignals): boolean {
  if (!signals.versionsBun) return false;
  if (isBunVirtualPath(signals.importMetaUrl)) return true;
  if (isBunVirtualPath(signals.errorStack)) return true;
  const execBase = (signals.execPath || '').split(/[\\/]/).pop()?.replace(/\.exe$/i, '') || '';
  // Empty basename (process.execPath was missing/blank) is not a positive
  // signal — return false rather than misclassifying a partial signal bag.
  if (execBase === '') return false;
  if (!INTERPRETER_BASENAME_RE.test(execBase)) return true;
  return false;
}

/**
 * Environment required by Port Daddy's pinned Bun 1.2.21 runtime to avoid the
 * concurrent JSC crash family tracked in #676. JavaScriptCore reads these
 * values only when the child process starts, so every long-lived Bun child
 * must inherit them. Set PORT_DADDY_JSC_SAFE_MODE=0 to opt out.
 */
export function jscSafeModeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (env.PORT_DADDY_JSC_SAFE_MODE === '0') return {};
  return {
    BUN_JSC_useConcurrentGC: '0',
    BUN_JSC_useConcurrentJIT: '0',
  };
}

/**
 * Merge one or more child environments and apply the JSC mitigation last.
 * The exact opt-out is read from the fully merged environment, so a named
 * profile may disable safe mode deliberately while ordinary overlays cannot
 * accidentally restore the crash-prone concurrent settings.
 */
export function mergeJscSafeModeEnv(
  ...sources: Array<NodeJS.ProcessEnv | undefined>
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {};
  for (const source of sources) {
    if (source) Object.assign(merged, source);
  }
  return { ...merged, ...jscSafeModeEnv(merged) };
}

/**
 * One-shot guard so the unconventional-layout warning doesn't spam
 * stderr every time the resolver is called (CLI invocations chain
 * through it many times per command).
 */
let warnedUnconventionalLayout = false;

export function resolveDistributionRoot(
  moduleDir: string,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  const explicit = env.PORT_DADDY_RESOURCE_DIR?.trim();
  if (explicit) return explicit;
  // A compiled `bun build --compile` binary reports `__dirname` as a bun-virtual path OR,
  // on some builds, literally `/` — so `join(__dirname,'..','..')` collapses to `/`. Treating
  // `/` as a real distribution root made everything resolve under the filesystem root
  // (`resolvedRoot=/`, `expectedBinary=/dist/daemon/...` MISSING) — which reported a green
  // "Resource directory" check AND broke `pd setup` (it looked for `/node_modules/.bin/tsx`).
  // `/` is never a real Port Daddy root: fall through to execPath-based resolution.
  if (moduleDir !== '/' && !isBunVirtualPath(moduleDir)) return moduleDir;

  const execDir = dirname(execPath);
  const parentDir = dirname(execDir);
  if (basename(execDir) === 'daemon' && basename(parentDir) === 'dist') {
    return dirname(parentDir);
  }
  if (basename(execDir) === 'dist') {
    return parentDir;
  }

  // Unconventional layout (user-built binary, non-Homebrew install
  // location, cross-target build dropped outside `dist/`). Falling
  // back to `process.cwd()` is wrong — it'd land on whatever
  // directory the operator was in when launchd fired the daemon and
  // attempt to write the DB there. Use `execDir` instead: it at
  // least relates to where the binary actually lives. Warn so the
  // operator can set PORT_DADDY_RESOURCE_DIR explicitly if they
  // care about a different layout. The warning fires once per
  // process — `pd doctor` check 13 also surfaces this for free.
  if (!warnedUnconventionalLayout) {
    warnedUnconventionalLayout = true;
    console.warn(
      `[port-daddy] resolveDistributionRoot: bun virtual-fs binary at ${execPath} ` +
      `lives in an unconventional layout (neither dist/daemon/ nor dist/). ` +
      `Falling back to ${execDir}. ` +
      `Set PORT_DADDY_RESOURCE_DIR to silence this warning and pin the asset root.`,
    );
  }
  return execDir;
}

export function daemonBinaryPath(rootDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PORT_DADDY_DAEMON_BINARY?.trim();
  if (explicit) return explicit;
  return join(rootDir, 'dist', 'daemon', daemonBinaryName());
}

/**
 * True when `path` names a regular file (not a directory, not missing). Used to
 * disambiguate the flat bosun binary `<root>/pd-bosun` from the source-tree
 * `core/pd-bosun/` DIRECTORY of the same leaf name.
 */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the Bosun supervisor binary (core/pd-bosun) for a given distribution
 * root, in canonical-first order (2026-07-14 halt-mandate):
 *
 *   1. `<root>/pd-bosun` — the FLAT path the release tarball unpacks to
 *      (release.yml stages `dist/pd-bosun` and packs it at the tar root next to
 *      `pd`/`port-daddy`). This is the CANONICAL installed supervisor. It is
 *      only accepted when it is a regular file, so a source checkout — whose
 *      `<root>/pd-bosun` does NOT exist but whose `core/pd-bosun/` is a
 *      DIRECTORY — never mistakes the crate dir for the binary.
 *   2. `<root>/dist/core/pd-bosun` — a `npm run build:bosun:dist` output (dev).
 *   3. `<root>/core/target/release/pd-bosun` — a raw `cargo build` release
 *      artifact in a source checkout. NOTE: `core/` is a Cargo WORKSPACE, so a
 *      member build (`--manifest-path core/pd-bosun/Cargo.toml`) outputs to the
 *      SHARED workspace target dir `core/target/release`, NOT a per-crate
 *      `core/pd-bosun/target`. The legacy code pointed at the per-crate path,
 *      which never existed for a workspace build — a root cause of bosun never
 *      shipping. The per-crate path is kept as a last-ditch fallback.
 *
 * The daemon installer and `pd doctor` both call this so they never disagree
 * about WHICH bosun binary supervises — the stale-`dist/`-copy split-brain the
 * mandate calls out.
 */
export function resolveBosunBinaryPath(rootDir: string): string {
  const installed = join(rootDir, 'pd-bosun');
  if (isRegularFile(installed)) return installed;
  // Homebrew (and any bin/-layout install) lands the watchdog next to `pd` at
  // `<root>/bin/pd-bosun`, NOT flat at the distribution root. Without these two
  // candidates a brew install's resolver returned a non-existent flat path, so
  // `pd doctor` reported "pd-bosun binary not built" and `install-bosun` could
  // not locate the supervisor to wire it — even though the binary shipped.
  const binInstalled = join(rootDir, 'bin', 'pd-bosun');
  if (isRegularFile(binInstalled)) return binInstalled;
  const libexecInstalled = join(rootDir, 'libexec', 'bin', 'pd-bosun');
  if (isRegularFile(libexecInstalled)) return libexecInstalled;
  const distBinary = join(rootDir, 'dist', 'core', 'pd-bosun');
  if (existsSync(distBinary)) return distBinary;
  const workspaceTarget = join(rootDir, 'core', 'target', 'release', 'pd-bosun');
  if (existsSync(workspaceTarget)) return workspaceTarget;
  return join(rootDir, 'core', 'pd-bosun', 'target', 'release', 'pd-bosun');
}

export function resolveDaemonLaunchCommand(
  rootDir: string,
  options: { env?: NodeJS.ProcessEnv; allowSourceFallback?: boolean } = {},
): DaemonLaunchCommand {
  const env = options.env ?? process.env;
  const binaryPath = daemonBinaryPath(rootDir, env);
  const sourceTsxPath = join(rootDir, 'node_modules', '.bin', 'tsx');
  const sourceServerPath = join(rootDir, 'server.ts');

  /**
   * Compose the environment shared by every compiled launch mode.
   *
   * Why this closure exists: explicit, discovered, and self-hosted binaries
   * must not drift on the resource root or native loader contract.
   *
   * @param resourceDir Distribution root published to the child.
   * @param executablePath Compiled executable selected for the child.
   * @returns Resource and native-loader variables to merge at spawn time.
   */
  const compiledEnv = (resourceDir: string, executablePath: string): Record<string, string> => ({
    PORT_DADDY_RESOURCE_DIR: resourceDir,
    ...resolveOnnxRuntimeNativeLaunchEnv(resourceDir, executablePath, env),
  });

  if (env.PORT_DADDY_DAEMON_BINARY?.trim() && existsSync(binaryPath)) {
    return {
      mode: 'binary',
      program: binaryPath,
      args: [],
      env: compiledEnv(rootDir, binaryPath),
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(binaryPath)],
      reason: 'explicit daemon binary found',
    };
  }

  if (selfDaemonLaunchAllowed(env)) {
    const resourceDir = resolveDistributionRoot(rootDir, env);
    return {
      mode: 'self',
      program: process.execPath,
      args: ['__daemon'],
      env: compiledEnv(resourceDir, process.execPath),
      binaryPath: process.execPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(process.execPath)],
      reason: 'single binary can self-host daemon',
    };
  }

  if (existsSync(binaryPath)) {
    return {
      mode: 'binary',
      program: binaryPath,
      args: [],
      env: compiledEnv(rootDir, binaryPath),
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(binaryPath)],
      reason: 'daemon binary found',
    };
  }

  const allowSource = options.allowSourceFallback ?? sourceDaemonFallbackAllowed(env);
  if (allowSource) {
    return {
      mode: 'source',
      program: sourceTsxPath,
      args: [sourceServerPath],
      binaryPath,
      sourceServerPath,
      sourceTsxPath,
      pathDirs: [dirname(sourceTsxPath)],
      reason: 'source fallback explicitly allowed',
    };
  }

  throw new Error(
    `Port Daddy daemon binary missing at ${binaryPath}. ` +
    'Build it with `npm run build:daemon:dist`, or set PORT_DADDY_ALLOW_SOURCE_DAEMON=1 for a development-only source daemon.',
  );
}
