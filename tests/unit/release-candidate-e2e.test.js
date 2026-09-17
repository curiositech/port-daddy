import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  REGISTERED_RELEASE_CANDIDATE_RUNNERS,
  assertExecutableArtifact,
  assertOwnedSyntheticTree,
  closeServerBoundedly,
  findAuthorityArtifacts,
  isExpectedCollisionSocketError,
  loadReleaseCandidateMatrix,
  prepareOwnedPrivateDirectory,
  prepareReleaseCandidateRunDirectories,
  redactReleaseCandidateText,
  releaseCandidateIsolatedEnv,
  resolveDurableTestRoot,
  secretFreeBaseEnv,
  selectReleaseCandidateCases,
  validateReleaseCandidateMatrix,
  waitForChildExit,
} from '../../scripts/lib/release-candidate-e2e.mjs';

const repoRoot = process.cwd();
const matrixPath = join(repoRoot, 'tests', 'e2e', 'release-candidate.matrix.json');
const evidencePath = join(repoRoot, 'tests', 'e2e', 'evidence', 'installed-runtime-baseline-2026-09-05.json');
const runnerPath = join(repoRoot, 'scripts', 'e2e-release-candidate.mjs');
const singleBinaryBuilderPath = join(repoRoot, 'scripts', 'build-single-binary.mjs');
const compiledCliSurfacePath = join(repoRoot, 'scripts', 'e2e-compiled-cli-surface.sh');
const binarySoakPath = join(repoRoot, 'scripts', 'soak-binary.sh');

describe('release-candidate E2E contract', () => {
  test('the collision fixture classifies only peer-termination socket errors as expected', () => {
    expect(isExpectedCollisionSocketError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isExpectedCollisionSocketError(Object.assign(new Error('pipe'), { code: 'EPIPE' }))).toBe(true);
    expect(isExpectedCollisionSocketError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(isExpectedCollisionSocketError(null)).toBe(false);
  });

  test('the normative matrix is valid and every Phase-1 runner is registered', () => {
    const matrix = loadReleaseCandidateMatrix(matrixPath);
    expect(matrix.cases.length).toBeGreaterThanOrEqual(10);
    for (const testCase of matrix.cases) {
      expect(REGISTERED_RELEASE_CANDIDATE_RUNNERS.has(testCase.runner)).toBe(true);
      expect(testCase.proves.length).toBeGreaterThan(0);
      expect(testCase.doesNotProve.length).toBeGreaterThan(0);
    }
  });

  test('all reserved gates remain required, external, and impossible to satisfy with a skip', () => {
    const matrix = loadReleaseCandidateMatrix(matrixPath);
    const required = new Set([
      'app-pr-lifecycle-signatures',
      'relay-chartroom-auth-lifecycle',
      'brew-pristine-upgrade-migration',
      'installed-daemon-fleetbar',
      'installed-high-cardinality-client-stability',
      'porthole-safe-fixture',
      'cloudflare-staging-cost-observability',
    ]);
    expect(new Set(matrix.externalGates.map((gate) => gate.id))).toEqual(required);
    for (const gate of matrix.externalGates) {
      expect(gate.requiredForReleaseCandidate).toBe(true);
      expect(gate.phase1Claimed).toBe(false);
      expect(gate.status).toBe('separately-gated');
      if (gate.skipContract) expect(gate.skipContract.skipIsPass).toBe(false);
    }
  });

  test('validation rejects an invented runner, optional required gate, and pass-shaped skip', () => {
    const source = JSON.parse(readFileSync(matrixPath, 'utf8'));
    const invented = structuredClone(source);
    invented.cases[0].runner = 'wishfulThinking';
    expect(() => validateReleaseCandidateMatrix(invented)).toThrow(/runner is not registered/);

    const optional = structuredClone(source);
    optional.externalGates[0].requiredForReleaseCandidate = false;
    expect(() => validateReleaseCandidateMatrix(optional)).toThrow(/must remain required/);

    const skipped = structuredClone(source);
    skipped.externalGates[0].skipContract = { allowedReasons: ['convenience'], skipIsPass: true };
    expect(() => validateReleaseCandidateMatrix(skipped)).toThrow(/skip.*not a pass/i);
  });

  test('volatile installed observations live only in non-normative redacted evidence', () => {
    const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
    expect(JSON.stringify(matrix)).not.toContain('currentAggregateObservation');
    expect(JSON.stringify(matrix)).not.toContain('recentMacOSCrashCount');

    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    expect(evidence.normative).toBe(false);
    expect(evidence.mutableSnapshot).toBe(true);
    expect(evidence.evidencePolicy.rawSensitiveArtifactsIncluded).toBe(false);
    expect(evidence.interpretation).toMatch(/not a fixture/i);
  });

  test('redaction removes direct canaries, bearer tokens, assignments, JSON values, and private keys', () => {
    const canary = 'rc-direct-canary-123456789';
    const text = [
      canary,
      'Bearer abcdefghijklmnopqrstuvwxyz',
      'token zyxwvutsrqponmlkjihgfedcba',
      'MY_PASSWORD=correct-horse-battery-staple',
      '{"credential":"credential-value-123"}',
      '/Users/fixture-user/coding/tmp/private-layout',
      '-----BEGIN PRIVATE KEY-----\nfixture-private-material\n-----END PRIVATE KEY-----',
    ].join('\n');
    const redacted = redactReleaseCandidateText(text, [canary]);
    expect(redacted).not.toContain(canary);
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(redacted).not.toContain('zyxwvutsrqponmlkjihgfedcba');
    expect(redacted).not.toContain('correct-horse-battery-staple');
    expect(redacted).not.toContain('credential-value-123');
    expect(redacted).not.toContain('fixture-user');
    expect(redacted).not.toContain('fixture-private-material');
    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('token [REDACTED]');
  });

  test('durable-root policy rejects OS temp paths and the source checkout', () => {
    expect(() => resolveDurableTestRoot('/tmp/pd-rc-test', { home: homedir(), sourceRoot: repoRoot })).toThrow();
    expect(() => resolveDurableTestRoot('/private/tmp/pd-rc-test', { home: homedir(), sourceRoot: repoRoot })).toThrow();
    expect(() => resolveDurableTestRoot(join(repoRoot, '.scratch', 'pd-rc-test'), { home: homedir(), sourceRoot: repoRoot })).toThrow();
    expect(resolveDurableTestRoot(join(homedir(), 'coding', 'tmp', 'pd-rc-contract-safe'), {
      home: homedir(),
      sourceRoot: repoRoot,
    })).toBe(join(homedir(), 'coding', 'tmp', 'pd-rc-contract-safe'));
  });

  test('private runtime fixtures are created at 0700 and repair harness-owned permissive modes', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-private-dir-test-'));
    const fresh = join(fixture, 'fresh', 'pd-home');
    const permissive = join(fixture, 'permissive');
    try {
      expect(prepareOwnedPrivateDirectory(fresh)).toBe(fresh);
      expect(statSync(fresh).mode & 0o777).toBe(0o700);

      mkdirSync(permissive, { mode: 0o755 });
      chmodSync(permissive, 0o755);
      expect(statSync(permissive).mode & 0o777).toBe(0o755);
      prepareOwnedPrivateDirectory(permissive);
      expect(statSync(permissive).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('every inherited release-candidate directory exists privately before a shard starts', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-run-dirs-test-'));
    try {
      expect(prepareReleaseCandidateRunDirectories(fixture)).toBe(fixture);
      for (const name of ['build-home', 'build-scratch', 'control', 'tmp']) {
        expect(statSync(join(fixture, name)).isDirectory()).toBe(true);
        expect(statSync(join(fixture, name)).mode & 0o777).toBe(0o700);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('child-exit proof settles for fast failures and remains readable after close', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], {
      stdio: 'ignore',
      env: secretFreeBaseEnv(),
    });
    await expect(waitForChildExit(child, 2_000)).resolves.toMatchObject({ code: 7, signal: null });
    await expect(waitForChildExit(child, 2_000)).resolves.toMatchObject({ code: 7, signal: null });
  });

  test('bounded server cleanup rejects instead of leaving the suite await unsettled', async () => {
    const neverCloses = { close() {} };
    await expect(closeServerBoundedly(neverCloses, 10, 'stuck fixture')).rejects.toThrow(
      /stuck fixture did not close within 10ms/,
    );
  });

  test('bounded server cleanup preserves callback and synchronous close errors', async () => {
    const callbackError = new Error('callback close failed');
    const callbackFailure = {
      close(callback) {
        callback(callbackError);
      },
    };
    await expect(closeServerBoundedly(callbackFailure, 1_000, 'callback fixture')).rejects.toThrow(
      /callback close failed/,
    );

    const synchronousFailure = {
      close() {
        throw new Error('synchronous close failed');
      },
    };
    await expect(closeServerBoundedly(synchronousFailure, 1_000, 'synchronous fixture')).rejects.toThrow(
      /synchronous close failed/,
    );
  });

  test('bounded fixture cleanup destroys tracked accepted sockets before closing the listener', async () => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    expect(typeof address).toBe('object');
    const client = createConnection(address.port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    expect(sockets.size).toBe(1);
    const clientClosed = new Promise((resolve) => client.once('close', resolve));
    await expect(closeServerBoundedly(server, 1_000, 'tracked fixture', sockets)).resolves.toBeUndefined();
    await clientClosed;
    expect(sockets.size).toBe(0);
    expect(client.destroyed).toBe(true);
  });

  test('the build environment uses private key storage without ambient credentials or canonical Keychain access', () => {
    const root = join(homedir(), 'coding', 'tmp', 'pd-rc-private-env-test');
    const env = releaseCandidateIsolatedEnv(root, {
      PORT_DADDY_RESOURCE_DIR: join(root, 'resources'),
    }, {
      env: {
        CI: '1',
        PATH: '/usr/bin:/bin',
        CARGO_HOME: '/fixture/cargo',
        RUSTUP_HOME: '/fixture/rustup',
        GITHUB_TOKEN: 'must-not-survive',
      },
      home: '/fixture/home',
    });

    expect(env.PD_HOME).toBe(join(root, 'control'));
    expect(env.HOME).toBe(join(root, 'build-home'));
    expect(env.PORT_DADDY_DISABLE_KEYCHAIN).toBe('1');
    expect(env.PORT_DADDY_RESOURCE_DIR).toBe(join(root, 'resources'));
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CARGO_HOME).toBe('/fixture/cargo');
    expect(env.RUSTUP_HOME).toBe('/fixture/rustup');
  });

  test.each([
    ['HOME', '/operator/home'],
    ['USERPROFILE', '/operator/home'],
    ['PD_HOME', '/operator/home/.port-daddy'],
    ['PD_SCRATCH_ROOT', '/operator/scratch'],
    ['TMPDIR', '/operator/tmp'],
    ['PORT_DADDY_DISABLE_KEYCHAIN', '0'],
    ['PORT_DADDY_DB', '/operator/registry.db'],
  ])('rejects the unapproved release-candidate environment override %s', (name, value) => {
    const root = join(homedir(), 'coding', 'tmp', 'pd-rc-private-env-test');
    expect(() => releaseCandidateIsolatedEnv(root, { [name]: value })).toThrow(
      `release-candidate environment override is not allowed: ${name}`,
    );
  });

  test.each([
    ['PD_E2E_BIN', '/operator/bin/port-daddy'],
    ['PORT_DADDY_RESOURCE_DIR', '/operator/resources'],
    ['SMOKE_SCRATCH_BASE', '/operator/scratch'],
    ['SOAK_PREFIX', '/operator/soak'],
  ])('rejects the allowed path override %s when it escapes its approved roots', (name, value) => {
    const root = join(homedir(), 'coding', 'tmp', 'pd-rc-private-env-test');
    expect(() => releaseCandidateIsolatedEnv(root, { [name]: value })).toThrow(
      `release-candidate path override escapes its approved roots: ${name}`,
    );
  });

  test('allows only the key assigned to an explicitly approved staged-artifact root', () => {
    const root = join(homedir(), 'coding', 'tmp', 'pd-rc-private-env-test');
    const staged = join(homedir(), 'coding', 'tmp', 'pd-rc-private-stage-test');
    const options = {
      approvedPathRootsByKey: {
        PORT_DADDY_RESOURCE_DIR: [staged],
      },
    };
    const env = releaseCandidateIsolatedEnv(root, { PORT_DADDY_RESOURCE_DIR: staged }, options);
    expect(env.PORT_DADDY_RESOURCE_DIR).toBe(staged);
    expect(() => releaseCandidateIsolatedEnv(root, { SMOKE_SCRATCH_BASE: join(staged, 'scratch') }, options)).toThrow(
      'release-candidate path override escapes its approved roots: SMOKE_SCRATCH_BASE',
    );
  });

  test('rejects a staged binary path whose symlink target escapes its approved root', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-path-escape-test-'));
    const root = join(fixture, 'run');
    const staged = join(fixture, 'stage');
    const outside = join(fixture, 'outside-port-daddy');
    const linkedBinary = join(staged, 'port-daddy');
    try {
      mkdirSync(root, { recursive: true });
      mkdirSync(staged, { recursive: true });
      writeFileSync(outside, 'x'.repeat(2048), { mode: 0o755 });
      symlinkSync(outside, linkedBinary);
      const options = { approvedPathRootsByKey: { PD_E2E_BIN: [staged] } };
      expect(() => releaseCandidateIsolatedEnv(root, { PD_E2E_BIN: linkedBinary }, options)).toThrow(
        'release-candidate path override escapes its approved roots: PD_E2E_BIN',
      );
      expect(() => assertExecutableArtifact(linkedBinary)).toThrow('artifact must not be a symbolic link');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('private runtime fixture preparation rejects a symlink without changing its target', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-private-link-test-'));
    const target = join(fixture, 'target');
    const link = join(fixture, 'link');
    try {
      mkdirSync(target, { mode: 0o755 });
      chmodSync(target, 0o755);
      symlinkSync(target, link);
      expect(() => prepareOwnedPrivateDirectory(link)).toThrow(/real directory/i);
      expect(statSync(target).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('cleanup proof rejects a symlink that escapes the owned synthetic root', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-realpath-test-'));
    const owned = join(fixture, 'owned');
    const sibling = join(fixture, 'sibling');
    mkdirSync(owned);
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'do-not-delete'), 'outside owned root\n');
    const link = join(owned, 'escape');
    symlinkSync(sibling, link);
    try {
      expect(() => assertOwnedSyntheticTree(owned)).toThrow(/escapes its owned root/);
    } finally {
      unlinkSync(link);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('stage containment rejects a nested resource symlink that escapes the artifact tree', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-nested-stage-link-test-'));
    const stage = join(fixture, 'stage');
    const resourceDir = join(stage, 'skills', 'port-daddy-agent-skill');
    const outside = join(fixture, 'outside-SKILL.md');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(outside, 'external resource\n');
    symlinkSync(outside, join(resourceDir, 'SKILL.md'));
    try {
      expect(() => assertOwnedSyntheticTree(stage)).toThrow(/escapes its owned root/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('authority detector reports matrix and database state but not ordinary package files', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-authority-test-'));
    try {
      mkdirSync(join(fixture, 'bin'));
      writeFileSync(join(fixture, 'bin', 'pd'), 'artifact\n');
      expect(findAuthorityArtifacts(fixture)).toEqual([]);
      writeFileSync(join(fixture, 'matrix.env'), 'PD_ALERT_TEST="fixture"\n');
      writeFileSync(join(fixture, 'port-daddy.db'), 'fixture\n');
      expect(findAuthorityArtifacts(fixture)).toEqual(['matrix.env', 'port-daddy.db']);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('case selection is deterministic and rejects cross-shard selectors', () => {
    const matrix = loadReleaseCandidateMatrix(matrixPath);
    const runtime = selectReleaseCandidateCases(matrix, { shard: 'runtime' });
    expect(runtime.map((testCase) => testCase.id)).toEqual([
      'runtime.transport-parity',
      'runtime.coordination-restart-repository-family',
      'runtime.synthetic-multi-client-pressure',
    ]);
    expect(() => selectReleaseCandidateCases(matrix, {
      shard: 'runtime',
      caseIds: ['hostile.secret-free-logs'],
    })).toThrow(/out-of-shard/);
  });

  test('dedicated CI builds once, fans out shards, and keeps scratch under the durable home', () => {
    const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'release-candidate-e2e.yml'), 'utf8');
    expect(workflow).toContain('merge_group:');
    expect(workflow).toContain('--build');
    expect(workflow).toContain('--target bun-linux-x64');
    expect(workflow).toContain('matrix:');
    expect(workflow).toContain('shard: [runtime, hostile, existing]');
    expect(workflow).toContain('$HOME/coding/tmp');
    expect(workflow).toContain('/home/runner/coding/tmp');
    expect(workflow).toContain('Upload sanitized artifact-build result');
    expect(workflow).toContain("if: always() && steps.artifact.outputs.results != ''");
    expect(workflow.indexOf('echo "results=$results" >> "$GITHUB_OUTPUT"')).toBeLessThan(
      workflow.indexOf('node scripts/e2e-release-candidate.mjs'),
    );
    expect(workflow).toContain('if-no-files-found: warn');
    expect(workflow).not.toContain('runner.temp');
    expect(workflow).not.toContain('mktemp');
  });

  test('release and E2E readiness share a bounded 120-second diagnostic contract', () => {
    const matrix = loadReleaseCandidateMatrix(matrixPath);
    const builder = readFileSync(singleBinaryBuilderPath, 'utf8');
    const runner = readFileSync(runnerPath, 'utf8');
    const compiledCli = readFileSync(join(repoRoot, 'scripts', 'e2e-compiled-cli-surface.sh'), 'utf8');
    expect(builder).toContain('const SELF_HOSTED_DAEMON_READINESS_TIMEOUT_MS = 120_000;');
    expect(builder).toContain('AbortSignal.timeout');
    expect(builder).toContain("'process-exited-before-readiness'");
    expect(builder).toContain('signalCode: child.signalCode');
    expect(builder).toContain('redacted: true');
    expect(builder).toContain('await stopSelfHostedDaemon(child);');
    expect(runner).toContain('const DAEMON_READINESS_TIMEOUT_MS = 120_000;');
    expect(runner).toContain('assertOwnedSyntheticTree(this.stagedDir);');
    expect(runner).toContain("category: 'artifact-build'");
    expect(runner).toMatch(/manifest\.smoke\?\.status !== 'ok'/);
    expect(runner).not.toContain('PD_MATRIX_FILE');
    expect(runner).toContain('matrixEnvRequired: false');
    expect(runner).toContain('PORT_DADDY_DB: db');
    expect(runner).toContain('PORT_DADDY_TEST_DB: db');
    expect(runner).toContain('prepareOwnedPrivateDirectory(path);');
    expect(runner).toContain('releaseCandidateIsolatedEnv(this.root, extra, {');
    expect(runner).toContain('PORT_DADDY_RESOURCE_DIR: [this.stagedDir]');
    expect(runner).toContain("claimPath: 'WORKTREE.md'");
    expect(runner).toMatch(/'files',\s+'add',\s+spec\.claimPath,\s+'--session',\s+spec\.sessionId,\s+'--json'/);
    const allBeginsComplete = runner.indexOf('// Start every repository-family session before adding claims.');
    const firstClaim = runner.indexOf("spec.claimPath,\n          '--session'");
    expect(allBeginsComplete).toBeGreaterThan(runner.indexOf('sessions.push({ ...spec, sessionId });'));
    expect(firstClaim).toBeGreaterThan(allBeginsComplete);
    expect(runner).toContain("PORT_DADDY_BIN_OVERRIDE: join(this.stagedDir, 'port-daddy')");
    expect(runner).toContain("'sitrep',\n          '--json'");
    expect(runner).toContain("await closeServerBoundedly(blocker, 3_000, 'collision listener', blockerSockets)");
    expect(runner).toContain('confirmedGone: true');
    expect(runner).toContain("throw new Error(`colliding daemon ${pid} remained alive after its exit receipt`)");
    expect(runner.match(/claimPath: 'README\.md'/g)).toHaveLength(2);
    expect(runner).toContain("['rev-parse', '--git-common-dir']");
    expect(runner).toContain('alpha linked session recorded the wrong worktree root');
    const sugarCli = readFileSync(join(repoRoot, 'cli', 'commands', 'sugar.ts'), 'utf8');
    const doneCall = sugarCli.slice(sugarCli.indexOf('const data = await pd.done('), sugarCli.indexOf("if (!data?.success)", sugarCli.indexOf('const data = await pd.done(')));
    expect(doneCall).toContain('sessionId:');
    expect(doneCall).not.toMatch(/^\s*agentId:/m);
    expect(runner).toContain('const blockerSockets = new Set();');
    expect(runner).toContain("socket.on('error', (error) => blockerSocketErrors.push(error));");
    expect(runner).toContain('!isExpectedCollisionSocketError(error)');
    expect(runner).not.toMatch(/child\.kill\('SIGKILL'\);\s*this\.activeChildren\.delete\(child\)/);
    expect(compiledCli).toContain('CLI_HOME="$SCRATCH/home"');
    expect(compiledCli).toMatch(/HOME="\$CLI_HOME" \\\nPORT_DADDY_NO_FLEET=1/);
    expect(compiledCli).toMatch(/PORT_DADDY_DB="\$TEST_DB" \\\n\s+PORT_DADDY_TEST_DB="\$TEST_DB" \\\n\s+PORT_DADDY_DISABLE_KEYCHAIN=1 \\\n\s+HOME="\$CLI_HOME"/);
    for (const id of [
      'runtime.transport-parity',
      'runtime.coordination-restart-repository-family',
      'runtime.synthetic-multi-client-pressure',
      'hostile.port-collision-recovery',
      'hostile.partial-failure-cleanup',
      'existing.bounded-packaged-soak',
    ]) {
      expect(matrix.cases.find((testCase) => testCase.id === id)?.timeoutSeconds).toBeGreaterThanOrEqual(150);
    }
  });

  test('compiled CLI smoke isolates state and proves safe-corral dry-run immutability', () => {
    const smoke = readFileSync(compiledCliSurfacePath, 'utf8');
    expect(smoke).toContain('CLI_HOME="$SCRATCH/home"');
    expect(smoke).toContain('chmod 700 "$SCRATCH" "$WORK" "$SNAP_ROOT" "$CLI_HOME"');
    expect(smoke).toContain('PD_HOME="$CLI_HOME"');
    expect(smoke).toContain('PORT_DADDY_TEST_DB="$TEST_DB"');
    expect(smoke).toContain('PORT_DADDY_DISABLE_KEYCHAIN=1');
    expect(smoke).toContain('__corral_fixture="$CLI_HOME/.env"');
    expect(smoke).toContain('__corral_before="$(cksum < "$__corral_fixture")"');
    expect(smoke).toContain('if __corral_out="$(cli safe corral --all 2>&1)"; then');
    expect(smoke).toContain('__corral_status=$?');
    expect(smoke).toContain('[ "$__corral_status" -eq 0 ]');
    expect(smoke).not.toContain('cli safe corral --all 2>/dev/null || true');
    expect(smoke).toContain('__corral_after="$(cksum < "$__corral_fixture")"');
    expect(smoke).toContain('[ "$__corral_before" = "$__corral_after" ]');
  });

  test('packaged-binary soak owns private test state without weakening Off admission', () => {
    const soak = readFileSync(binarySoakPath, 'utf8');
    expect(soak).toContain('chmod 700 "$SOAK_PREFIX"');
    expect(soak).toContain('mkdir -p "$SOAK_HOME" "$SOAK_PD_HOME"');
    expect(soak).toContain('chmod 700 "$SOAK_HOME" "$SOAK_PD_HOME"');
    expect(soak).toContain('HOME="$SOAK_HOME"');
    expect(soak).toContain('USERPROFILE="$SOAK_HOME"');
    expect(soak).toContain('PD_HOME="$SOAK_PD_HOME"');
    expect(soak).toContain('PORT_DADDY_DB="$TEST_DB"');
    expect(soak).toContain('PORT_DADDY_TEST_DB="$TEST_DB"');
    expect(soak).toContain('PORT_DADDY_DISABLE_KEYCHAIN=1');
    expect(soak).not.toContain('PORT_DADDY_ISOLATED_TEST');
  });

  test('stage-validation failure writes a failing result without inventing case passes', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-setup-failure-test-'));
    const root = join(fixture, 'run');
    const stagedDir = join(fixture, 'stage', 'Cellar', 'port-daddy', 'rc');
    const results = join(fixture, 'results.json');
    try {
      const run = spawnSync(process.execPath, [
        runnerPath,
        '--root', root,
        '--staged-dir', stagedDir,
        '--case', 'artifact.release-layout',
        '--results', results,
      ], { cwd: repoRoot, encoding: 'utf8', env: secretFreeBaseEnv() });
      expect(run.status).toBe(1);
      const rawResults = readFileSync(results, 'utf8');
      expect(rawResults).not.toContain('/Users/');
      const document = JSON.parse(rawResults);
      expect(document.setup).toMatchObject({ status: 'failed', category: 'artifact-stage-validation' });
      expect(document.cases).toEqual([]);
      expect(document.summary).toMatchObject({ passed: 0, failed: 1 });
    } finally {
      assertOwnedSyntheticTree(fixture);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

});
