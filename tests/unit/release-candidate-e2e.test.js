import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  REGISTERED_RELEASE_CANDIDATE_RUNNERS,
  assertOwnedSyntheticTree,
  findAuthorityArtifacts,
  loadReleaseCandidateMatrix,
  redactReleaseCandidateText,
  resolveDurableTestRoot,
  secretFreeBaseEnv,
  selectReleaseCandidateCases,
  validateReleaseCandidateMatrix,
} from '../../scripts/lib/release-candidate-e2e.mjs';

const repoRoot = process.cwd();
const matrixPath = join(repoRoot, 'tests', 'e2e', 'release-candidate.matrix.json');
const evidencePath = join(repoRoot, 'tests', 'e2e', 'evidence', 'installed-runtime-baseline-2026-09-05.json');
const runnerPath = join(repoRoot, 'scripts', 'e2e-release-candidate.mjs');
const singleBinaryBuilderPath = join(repoRoot, 'scripts', 'build-single-binary.mjs');

describe('release-candidate E2E contract', () => {
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
    expect(builder).toContain('const SELF_HOSTED_DAEMON_READINESS_TIMEOUT_MS = 120_000;');
    expect(builder).toContain('AbortSignal.timeout');
    expect(builder).toContain("'process-exited-before-readiness'");
    expect(builder).toContain('signalCode: child.signalCode');
    expect(builder).toContain('redacted: true');
    expect(builder).toContain('await stopSelfHostedDaemon(child);');
    expect(runner).toContain('const DAEMON_READINESS_TIMEOUT_MS = 120_000;');
    expect(runner).toContain("category: 'artifact-build'");
    expect(runner).toMatch(/manifest\.smoke\?\.status !== 'ok'/);
    expect(runner).not.toContain('PD_MATRIX_FILE');
    expect(runner).toContain('matrixEnvRequired: false');
    expect(runner).toContain('PORT_DADDY_DB: db');
    expect(runner).toContain('PORT_DADDY_TEST_DB: db');
    expect(runner).toContain('confirmedGone: true');
    expect(runner).toContain("throw new Error(`colliding daemon ${pid} remained alive after its exit receipt`)");
    expect(runner).not.toMatch(/child\.kill\('SIGKILL'\);\s*this\.activeChildren\.delete\(child\)/);
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
