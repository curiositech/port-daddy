import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MATRIX_SCHEMA_VERSION = 1;
export const PHASE_ONE_STATUS = 'automated';
export const EXTERNAL_GATE_STATUS = 'separately-gated';

const REQUIRED_EXTERNAL_GATES = new Set([
  'app-pr-lifecycle-signatures',
  'relay-chartroom-auth-lifecycle',
  'brew-pristine-upgrade-migration',
  'installed-daemon-fleetbar',
  'installed-high-cardinality-client-stability',
  'porthole-safe-fixture',
  'cloudflare-staging-cost-observability',
]);

export const REGISTERED_RELEASE_CANDIDATE_RUNNERS = new Set([
  'artifactReleaseLayout',
  'packageResourceDiscovery',
  'transportParity',
  'coordinationRestartRepositoryFamily',
  'syntheticMultiClientPressure',
  'portCollisionRecovery',
  'partialFailureCleanup',
  'secretFreeLogs',
  'existingCompiledCliSurface',
  'existingBoundedPackagedSoak',
]);

const AUTHORITY_NAMES = new Set([
  'actor-credentials.json',
  'current.json',
  'daemon.pid',
  'daemon.port',
  'matrix.env',
  'port-daddy.db',
  'port-daddy.db-shm',
  'port-daddy.db-wal',
  'port-registry.db',
  'port-registry.db-shm',
  'port-registry.db-wal',
]);

/** Read and validate the release-candidate matrix used by both CI and the runner. */
export function loadReleaseCandidateMatrix(path) {
  const matrix = JSON.parse(readFileSync(path, 'utf8'));
  validateReleaseCandidateMatrix(matrix);
  return matrix;
}

/**
 * Fail closed when the matrix could turn absent external proof into a fake pass.
 * The detailed behavior assertions stay data so later gates can consume them.
 */
export function validateReleaseCandidateMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new Error('release-candidate matrix must be a JSON object');
  }
  if (matrix.schemaVersion !== MATRIX_SCHEMA_VERSION) {
    throw new Error(`release-candidate matrix schemaVersion must be ${MATRIX_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(matrix.cases) || matrix.cases.length === 0) {
    throw new Error('release-candidate matrix must declare at least one Phase-1 case');
  }
  if (!Array.isArray(matrix.externalGates) || matrix.externalGates.length === 0) {
    throw new Error('release-candidate matrix must reserve external gates');
  }

  const ids = new Set();
  for (const testCase of matrix.cases) {
    validateIdentifier(testCase?.id, 'case');
    if (ids.has(testCase.id)) throw new Error(`duplicate release-candidate id: ${testCase.id}`);
    ids.add(testCase.id);
    if (testCase.phase !== 1 || testCase.status !== PHASE_ONE_STATUS || testCase.required !== true) {
      throw new Error(`${testCase.id} must be a required automated Phase-1 case`);
    }
    validateClaimList(testCase.proves, `${testCase.id}.proves`);
    validateClaimList(testCase.doesNotProve, `${testCase.id}.doesNotProve`);
    validateIdentifier(testCase.shard, `${testCase.id}.shard`);
    if (!REGISTERED_RELEASE_CANDIDATE_RUNNERS.has(testCase.runner)) {
      throw new Error(`${testCase.id}.runner is not registered: ${String(testCase.runner)}`);
    }
    if (!Number.isSafeInteger(testCase.timeoutSeconds) || testCase.timeoutSeconds < 1) {
      throw new Error(`${testCase.id}.timeoutSeconds must be a positive integer`);
    }
  }

  const externalIds = new Set();
  for (const gate of matrix.externalGates) {
    validateIdentifier(gate?.id, 'external gate');
    if (ids.has(gate.id) || externalIds.has(gate.id)) {
      throw new Error(`duplicate release-candidate id: ${gate.id}`);
    }
    externalIds.add(gate.id);
    if (gate.phase1Claimed !== false || gate.status !== EXTERNAL_GATE_STATUS) {
      throw new Error(`${gate.id} must be explicitly separately gated and not claimed by Phase 1`);
    }
    if (gate.requiredForReleaseCandidate !== true) {
      throw new Error(`${gate.id} must remain required for a release candidate`);
    }
    if (gate.skipContract && gate.skipContract.skipIsPass !== false) {
      throw new Error(`${gate.id} skipContract must state that a skip is not a pass`);
    }
    validateClaimList(gate.acceptance, `${gate.id}.acceptance`);
    if (gate.evidencePolicy?.rawSensitiveArtifacts !== false) {
      throw new Error(`${gate.id} must forbid raw sensitive artifacts`);
    }
  }
  for (const id of REQUIRED_EXTERNAL_GATES) {
    if (!externalIds.has(id)) throw new Error(`release-candidate matrix is missing external gate ${id}`);
  }
  return matrix;
}

function validateIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(value)) {
    throw new Error(`${label} id must use lowercase alphanumerics, dots, or hyphens`);
  }
}

function validateClaimList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

/** Select a deterministic shard/case subset without weakening required status. */
export function selectReleaseCandidateCases(matrix, { shard = 'all', caseIds = [] } = {}) {
  const requested = new Set(caseIds);
  const selected = matrix.cases.filter((testCase) => (
    (shard === 'all' || testCase.shard === shard)
    && (requested.size === 0 || requested.has(testCase.id))
  ));
  if (requested.size > 0) {
    const found = new Set(selected.map((testCase) => testCase.id));
    const missing = [...requested].filter((id) => !found.has(id));
    if (missing.length) throw new Error(`unknown or out-of-shard case(s): ${missing.join(', ')}`);
  }
  if (selected.length === 0) throw new Error(`no release-candidate cases selected for shard ${shard}`);
  return selected;
}

/**
 * Resolve a test-owned root and enforce the machine-wide durability boundary.
 * This intentionally rejects OS temp directories and source checkouts.
 */
export function resolveDurableTestRoot(candidate, { home = homedir(), sourceRoot } = {}) {
  const durableBase = resolve(home, 'coding', 'tmp');
  const root = resolve(candidate || join(durableBase, `pd-release-candidate-${process.pid}`));
  if (!isWithin(root, durableBase) || root === durableBase) {
    throw new Error(`E2E root must be a child of ${durableBase}; got ${root}`);
  }
  for (const forbidden of ['/tmp', '/private/tmp']) {
    if (root === forbidden || root.startsWith(`${forbidden}${sep}`)) {
      throw new Error(`E2E root must not use ${forbidden}`);
    }
  }
  if (sourceRoot && (isWithin(root, resolve(sourceRoot)) || isWithin(resolve(sourceRoot), root))) {
    throw new Error(`E2E root must be disjoint from the source checkout ${resolve(sourceRoot)}`);
  }
  const physicalBase = physicalPath(durableBase);
  const physicalRoot = physicalPath(root);
  if (!isWithin(physicalRoot, physicalBase) || physicalRoot === physicalBase) {
    throw new Error(`E2E root resolves outside the durable base ${physicalBase}: ${physicalRoot}`);
  }
  if (sourceRoot) {
    const physicalSource = physicalPath(sourceRoot);
    if (isWithin(physicalRoot, physicalSource) || isWithin(physicalSource, physicalRoot) || physicalRoot === physicalSource) {
      throw new Error(`E2E root resolves into the source checkout ${physicalSource}`);
    }
  }
  return root;
}

/**
 * Prepare a private directory owned by the synthetic release-candidate harness.
 * Unlike runtime key storage, the harness may repair this directory because it
 * created and exclusively owns the whole fixture tree.
 */
export function prepareOwnedPrivateDirectory(path) {
  const resolved = resolve(path);
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const before = lstatSync(resolved);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`private fixture path must be a real directory: ${resolved}`);
  }
  chmodSync(resolved, 0o700);
  const after = lstatSync(resolved);
  if (!after.isDirectory() || after.isSymbolicLink() || (after.mode & 0o777) !== 0o700) {
    throw new Error(`private fixture directory must have mode 0700: ${resolved}`);
  }
  return resolved;
}

/** Prepare every private directory inherited by a release-candidate child. */
export function prepareReleaseCandidateRunDirectories(root) {
  const resolvedRoot = resolve(root);
  for (const name of ['build-home', 'build-scratch', 'control', 'tmp']) {
    prepareOwnedPrivateDirectory(join(resolvedRoot, name));
  }
  return resolvedRoot;
}

/**
 * Wait for a spawned fixture to terminate without missing a fast `close`
 * event. Some launchers fail before Node records an `exitCode`, so listening
 * only for `exit` can leave a top-level release-candidate await unresolved.
 */
export function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, rejectExit) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      child.off('exit', done);
      child.off('close', done);
      child.off('error', failed);
    };
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectExit(error);
      else resolveExit(value);
    };
    const done = (code, signal) => finish({ code, signal });
    const failed = (error) => finish(null, error);
    child.once('exit', done);
    child.once('close', done);
    child.once('error', failed);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** Close a fixture server with an explicit deadline so cleanup always settles. */
export function closeServerBoundedly(server, timeoutMs = 3_000, label = 'fixture server', sockets = []) {
  return new Promise((resolveClose, rejectClose) => {
    let settled = false;
    let timer;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) rejectClose(error);
      else resolveClose();
    };
    timer = setTimeout(
      () => finish(new Error(`${label} did not close within ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      for (const socket of sockets) socket.destroy();
      server.close((error) => finish(error || null));
    } catch (error) {
      finish(error);
    }
  });
}

export function isWithin(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** A collision probe may be reset by the daemon after it discovers the port is occupied. */
export function isExpectedCollisionSocketError(error) {
  const code = error && typeof error === 'object' ? error.code : null;
  return code === 'ECONNRESET' || code === 'EPIPE';
}

/** Resolve a possibly-not-yet-created path through its nearest real parent. */
export function physicalPath(path) {
  let cursor = resolve(path);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  const physicalParent = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return resolve(physicalParent, ...suffix);
}

/**
 * Prove every real path and symlink target in a deletion tree stays beneath
 * the suite-owned root. Call immediately before recursive cleanup.
 */
export function assertOwnedSyntheticTree(root, { home = homedir() } = {}) {
  const lexicalRoot = resolve(root);
  if (!existsSync(lexicalRoot)) return { root: lexicalRoot, entries: 0 };
  if (lstatSync(lexicalRoot).isSymbolicLink()) {
    throw new Error(`owned synthetic root must not be a symlink: ${lexicalRoot}`);
  }
  const physicalRoot = realpathSync(lexicalRoot);
  const physicalBase = physicalPath(resolve(home, 'coding', 'tmp'));
  if (!isWithin(physicalRoot, physicalBase)) {
    throw new Error(`owned synthetic root resolves outside ${physicalBase}: ${physicalRoot}`);
  }
  let entries = 0;
  const visit = (path) => {
    entries += 1;
    const info = lstatSync(path);
    const physical = realpathSync(path);
    if (physical !== physicalRoot && !isWithin(physical, physicalRoot)) {
      throw new Error(`synthetic cleanup path escapes its owned root: ${path} -> ${physical}`);
    }
    if (info.isDirectory() && !info.isSymbolicLink()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    }
  };
  visit(lexicalRoot);
  return { root: physicalRoot, entries };
}

/** Produce stable, content-addressed evidence without exposing file bodies. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Scrub known secret carriers and caller-provided canaries before any child
 * output reaches a durable log or result file.
 */
export function redactReleaseCandidateText(input, secrets = []) {
  let text = String(input ?? '');
  for (const secret of [...new Set(secrets.filter((value) => typeof value === 'string' && value.length >= 4))]) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/-----BEGIN [^-\r\n]*(?:PRIVATE|SECRET) KEY-----[\s\S]*?-----END [^-\r\n]*(?:PRIVATE|SECRET) KEY-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED GITHUB TOKEN]')
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '$1 [REDACTED]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/("(?:token|secret|password|credential|privateKey)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/\/Users\/[^/\s"'`)]+/g, '~')
    .replace(/\/home\/[^/\s"'`)]+/g, '~');
}

/** Return only environment variables that cannot carry ambient credentials. */
export function secretFreeBaseEnv(env = process.env) {
  const keep = new Set([
    'CI',
    'COLORTERM',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'NO_COLOR',
    'PATH',
    'SHELL',
    'TERM',
    'TZ',
    'USER',
  ]);
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => keep.has(name) && typeof value === 'string'));
}

const RELEASE_CANDIDATE_EXTRA_ENV_KEYS = new Set([
  'E2E_CLI_SURFACE_PORT',
  'PD_E2E_BIN',
  'PORT_DADDY_RESOURCE_DIR',
  'SMOKE_SCRATCH_BASE',
  'SOAK_BOOT_GRACE',
  'SOAK_PORT',
  'SOAK_PREFIX',
  'SOAK_SECONDS',
  'SOAK_WORKLOAD',
]);

const RELEASE_CANDIDATE_EXTRA_PATH_KEYS = new Set([
  'PD_E2E_BIN',
  'PORT_DADDY_RESOURCE_DIR',
  'SMOKE_SCRATCH_BASE',
  'SOAK_PREFIX',
]);

/** Build the private environment shared by release-candidate build and run phases. */
export function releaseCandidateIsolatedEnv(
  root,
  extra = {},
  { env = process.env, home = homedir(), approvedPathRootsByKey = {} } = {},
) {
  const resolvedRoot = resolve(root);
  for (const [name, value] of Object.entries(extra)) {
    if (!RELEASE_CANDIDATE_EXTRA_ENV_KEYS.has(name)) {
      throw new Error(`release-candidate environment override is not allowed: ${name}`);
    }
    if (RELEASE_CANDIDATE_EXTRA_PATH_KEYS.has(name)) {
      const resolvedValue = typeof value === 'string' ? resolve(value) : null;
      const physicalValue = resolvedValue === null ? null : physicalPath(resolvedValue);
      const approvedRoots = [resolvedRoot, ...(approvedPathRootsByKey[name] || [])].map((path) => ({
        lexical: resolve(path),
        physical: physicalPath(path),
      }));
      const isApproved = resolvedValue !== null && approvedRoots.some(
        (approvedRoot) =>
          (resolvedValue === approvedRoot.lexical || isWithin(resolvedValue, approvedRoot.lexical))
          && (physicalValue === approvedRoot.physical || isWithin(physicalValue, approvedRoot.physical)),
      );
      if (!isApproved) {
        throw new Error(`release-candidate path override escapes its approved roots: ${name}`);
      }
    }
  }
  return {
    ...secretFreeBaseEnv(env),
    ...extra,
    CI: 'true',
    CARGO_HOME: env.CARGO_HOME || join(home, '.cargo'),
    HOME: join(resolvedRoot, 'build-home'),
    NODE_ENV: 'test',
    NO_COLOR: '1',
    PD_SCRATCH_ROOT: join(resolvedRoot, 'build-scratch'),
    PD_HOME: join(resolvedRoot, 'control'),
    PORT_DADDY_ISOLATED_TEST: '1',
    PORT_DADDY_ISOLATED_TEST_CONTROL_ROOT: join(resolvedRoot, 'control'),
    RUSTUP_HOME: env.RUSTUP_HOME || join(home, '.rustup'),
    TERM: 'dumb',
    TMPDIR: join(resolvedRoot, 'tmp'),
    USERPROFILE: join(resolvedRoot, 'build-home'),
    // A private PD_HOME must never consult or mutate the operator's canonical
    // Keychain identity. Its mandatory note key is generated inside PD_HOME.
    PORT_DADDY_DISABLE_KEYCHAIN: '1',
  };
}

/**
 * Metadata-only tree snapshot. It never reads file content, which keeps an
 * operator context or credential file out of test memory and artifacts.
 */
export function snapshotTreeMetadata(root) {
  const resolved = resolve(root);
  if (!existsSync(resolved)) return [];
  const rows = [];
  const visit = (path) => {
    const info = lstatSync(path);
    const rel = relative(resolved, path) || '.';
    rows.push({
      path: rel,
      kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : 'file',
      size: info.size,
      mode: info.mode & 0o777,
      mtimeMs: Math.trunc(info.mtimeMs),
    });
    if (info.isDirectory() && !info.isSymbolicLink()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    }
  };
  visit(resolved);
  return rows;
}

/** Identify runtime authority artifacts under a checkout or package keg. */
export function findAuthorityArtifacts(root) {
  const resolved = resolve(root);
  if (!existsSync(resolved)) return [];
  const findings = [];
  const visit = (path) => {
    const info = lstatSync(path);
    const name = path.split(sep).at(-1);
    const rel = relative(resolved, path) || '.';
    if (AUTHORITY_NAMES.has(name) || rel.includes(`${sep}contexts${sep}`) || rel.endsWith(`${sep}contexts`)) {
      findings.push(rel);
    }
    if (info.isDirectory() && !info.isSymbolicLink()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    }
  };
  visit(resolved);
  return findings.sort();
}

/** Assert a file is executable and large enough to be a real release payload. */
export function assertExecutableArtifact(path, minBytes = 1024) {
  if (!existsSync(path)) throw new Error(`required artifact is missing: ${path}`);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`artifact must not be a symbolic link: ${path}`);
  const info = statSync(path);
  if (!info.isFile() || info.size < minBytes) throw new Error(`artifact is not a non-empty file: ${path}`);
  if ((info.mode & 0o111) === 0) throw new Error(`artifact is not executable: ${path}`);
  return { bytes: info.size, sha256: sha256File(path) };
}

/** Canonicalize the recorded git common-dir without reading repository data. */
export function canonicalRecordedCommonDir(worktree) {
  if (!worktree || typeof worktree.root !== 'string' || typeof worktree.commonDir !== 'string') {
    throw new Error('session worktree metadata is incomplete');
  }
  const candidate = resolve(worktree.root, worktree.commonDir);
  return existsSync(candidate) ? realpathSync(candidate) : candidate;
}
