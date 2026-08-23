import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareStableVersions,
  extractFormulaVersion,
  findVersionTransition,
  formulaMatchesRelease,
  HOMEBREW_TAP_TOKEN_SOURCE,
  parseStableVersion,
  RELEASE_TRAIN_TOKEN_SOURCE,
  selectTokenSource,
  selectVersionTransition,
  selectWorkingTokenSource,
  stableVersionFromTag,
  waitForFormula,
} from '../../scripts/release-workflow-state.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_HELPER = join(ROOT, 'scripts', 'release-workflow-state.mjs');
const readWorkflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

describe('release workflow topology contracts', () => {
  test('release publication is derived from merged tree state, not the PR head name', () => {
    const workflow = readWorkflow('release-train.yml');

    expect(workflow).toContain("github.event.pull_request.base.ref == 'main'");
    expect(workflow).toContain('Detect an unpublished merged release version');
    expect(workflow).toContain('git show-ref --verify --quiet "refs/tags/$tag"');
    expect(workflow).toContain('release-workflow-state.mjs find-transition "$version" "$range"');
    expect(workflow).toContain('release_sha=$release_sha');
    expect(workflow).toContain('ref: ${{ steps.release.outputs.release_sha }}');
    expect(workflow).toContain('steps.release.outputs.should_publish');
    expect(workflow).not.toContain("startsWith(github.event.pull_request.head.ref, 'release-train/')");
  });

  test('release mutation selects a live push-capable token while tap promotion needs no cross-repo credential', () => {
    const train = readWorkflow('release-train.yml');
    const release = readWorkflow('release.yml');
    const helper = readFileSync(STATE_HELPER, 'utf8');
    const unsafePresenceFallback = '${{ secrets.RELEASE_TRAIN_TOKEN || secrets.HOMEBREW_TAP_TOKEN }}';

    expect(train).not.toContain(unsafePresenceFallback);
    expect(train).toContain('Select a working release-mutation token');
    expect(train).toContain('Select a working release-publication token');
    expect(train.match(/release-workflow-state\.mjs \\\n\s+select-live-token/g)).toHaveLength(2);
    expect(train.match(/echo "source=\$token_source" >> "\$GITHUB_OUTPUT"/g)).toHaveLength(2);
    expect(helper).toContain("['api', `repos/${repository}`, '--jq', '.permissions.push // false']");
    expect(helper).toContain('delete childEnv.RELEASE_TRAIN_TOKEN');
    expect(helper).toContain('delete childEnv.HOMEBREW_TAP_TOKEN');
    expect(release).toContain('Wait for independently verified Homebrew promotion');
    expect(release).toContain('wait-for-formula "$EXPECTED_TAG" "$FORMULA_URL" "$GITHUB_RUN_ID"');
    expect(release).not.toContain('repository-dispatch');
    expect(release).not.toContain('HOMEBREW_TAP_TOKEN');
  });

  test('release archives carry provenance and do not rebuild retired Bosun', () => {
    const release = readWorkflow('release.yml');
    const binaryJob = release.slice(
      release.indexOf('  build-binaries:'),
      release.indexOf('  build-fleetbar-preview:'),
    );

    expect(binaryJob).toContain('attestations: write');
    expect(binaryJob).toContain('id-token: write');
    expect(binaryJob).toContain('uses: actions/attest-build-provenance@v3');
    expect(binaryJob).toContain('subject-path: dist/${{ matrix.artifact }}.tar.gz');
    expect(binaryJob).not.toContain('npm run build:bosun');
    expect(binaryJob).not.toContain('dtolnay/rust-toolchain');
  });

  test('the exact release binary loads ONNX again after macOS signing', () => {
    const release = readWorkflow('release.yml');
    const sign = release.indexOf('- name: Sign macOS binary (Developer ID)');
    const semanticSmoke = release.indexOf('- name: Smoke exact release semantic runtime (post-sign on macOS)');
    const soak = release.indexOf('- name: Soak the packaged binary (crash/wedge gate)');
    const bundle = readFileSync(join(ROOT, 'bin', 'port-daddy-bundle.ts'), 'utf8');
    const singleBuilder = readFileSync(join(ROOT, 'scripts', 'build-single-binary.mjs'), 'utf8');
    const daemonBuilder = readFileSync(join(ROOT, 'scripts', 'build-daemon-binary.mjs'), 'utf8');
    const entitlements = readFileSync(join(ROOT, 'scripts', 'entitlements', 'port-daddy.plist'), 'utf8');

    expect(sign).toBeGreaterThan(-1);
    expect(semanticSmoke).toBeGreaterThan(sign);
    expect(soak).toBeGreaterThan(semanticSmoke);
    expect(release.slice(semanticSmoke, soak)).toContain('PORT_DADDY_RESOURCE_DIR: ${{ github.workspace }}');
    expect(release.slice(semanticSmoke, soak)).toContain('dist/pd __semantic-runtime-check');
    expect(bundle).toContain("process.argv[2] === '__semantic-runtime-check'");
    expect(bundle).toContain("await import('onnxruntime-node')");
    expect(singleBuilder).toContain('prepareOnnxRuntimeNativeBinding');
    expect(daemonBuilder).toContain('prepareOnnxRuntimeNativeBinding');
    expect(daemonBuilder).toContain('outputRoot: DIST_DIR');
    expect(entitlements).not.toContain('com.apple.security.cs.allow-dyld-environment-variables');
  });

  test('doctor gate shortens Unix socket paths for deeply named worktrees', () => {
    const script = join(ROOT, 'scripts', 'ci-doctor-gate.sh');
    const shortRoot = '/Users/test/coding/tmp/pd-doctor-sockets';
    const deepRoot = `/Users/test/coding/tmp/${'deep-worktree-segment/'.repeat(5)}port-daddy`;
    const deep = spawnSync('bash', [script, '--print-socket-paths'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PD_DOCTOR_GATE_SOCKET_ROOT: deepRoot,
        PD_DOCTOR_GATE_SHORT_SOCKET_ROOT: shortRoot,
        PD_DOCTOR_GATE_PID_TOKEN: '4242',
      },
    });

    expect(deep.status).toBe(0);
    const [socketPath, ipcPath] = deep.stdout.trim().split('\n');
    expect(socketPath).toBe(`${shortRoot}/d.4242.sock`);
    expect(ipcPath).toBe(`${shortRoot}/i.4242.sock`);
    expect(socketPath.length).toBeLessThan(96);
    expect(ipcPath.length).toBeLessThan(96);

    const ordinaryRoot = '/Users/test/coding/port-daddy';
    const ordinary = spawnSync('bash', [script, '--print-socket-paths'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PD_DOCTOR_GATE_SOCKET_ROOT: ordinaryRoot,
        PD_DOCTOR_GATE_SHORT_SOCKET_ROOT: shortRoot,
        PD_DOCTOR_GATE_PID_TOKEN: '4242',
      },
    });
    expect(ordinary.status).toBe(0);
    expect(ordinary.stdout.trim().split('\n')).toEqual([
      `${ordinaryRoot}/.pdg.4242.sock`,
      `${ordinaryRoot}/.pdg.4242.ipc`,
    ]);
  });

  test('release discovery stays independent from the publishing credential', () => {
    const workflow = readWorkflow('release-train.yml');
    const firstCheckout = workflow.indexOf('- uses: actions/checkout@v4');
    const tokenCheck = workflow.indexOf('- name: Select a working release-mutation token');
    const dedicatedCheckout = workflow.indexOf('- name: Authenticate release mutation with the dedicated token');
    const fallbackCheckout = workflow.indexOf('- name: Authenticate release mutation with the fallback token');
    const openPr = workflow.indexOf('- name: Open the version-bump PR with auto-merge armed');

    expect(firstCheckout).toBeGreaterThan(-1);
    expect(tokenCheck).toBeGreaterThan(firstCheckout);
    expect(dedicatedCheckout).toBeGreaterThan(tokenCheck);
    expect(fallbackCheckout).toBeGreaterThan(dedicatedCheckout);
    expect(openPr).toBeGreaterThan(fallbackCheckout);
    expect(workflow.slice(firstCheckout, tokenCheck)).not.toContain('token:');
    const authenticatedPath = workflow.slice(tokenCheck, openPr);
    expect(authenticatedPath).toContain("steps.release_token.outputs.source == 'RELEASE_TRAIN_TOKEN'");
    expect(authenticatedPath).toContain("steps.release_token.outputs.source == 'HOMEBREW_TAP_TOKEN'");
    expect(authenticatedPath).toContain('token: ${{ secrets.RELEASE_TRAIN_TOKEN }}');
    expect(authenticatedPath).toContain('token: ${{ secrets.HOMEBREW_TAP_TOKEN }}');
    expect(authenticatedPath).not.toContain('token: ${{ steps.release_token.outputs');
  });

  test('release publication uses the probed source without moving secret values through outputs', () => {
    const workflow = readWorkflow('release-train.yml');
    const select = workflow.indexOf('- name: Select a working release-publication token');
    const dedicatedCheckout = workflow.indexOf('- name: Authenticate release publication with the dedicated token');
    const fallbackCheckout = workflow.indexOf('- name: Authenticate release publication with the fallback token');
    const publish = workflow.indexOf('- name: Tag the merged bump and publish the Release');

    expect(select).toBeGreaterThan(-1);
    expect(dedicatedCheckout).toBeGreaterThan(select);
    expect(fallbackCheckout).toBeGreaterThan(dedicatedCheckout);
    expect(publish).toBeGreaterThan(fallbackCheckout);
    const publicationPath = workflow.slice(select, publish);
    expect(publicationPath).toContain("steps.release_token.outputs.source == 'RELEASE_TRAIN_TOKEN'");
    expect(publicationPath).toContain("steps.release_token.outputs.source == 'HOMEBREW_TAP_TOKEN'");
    expect(publicationPath).toContain('token: ${{ secrets.RELEASE_TRAIN_TOKEN }}');
    expect(publicationPath).toContain('token: ${{ secrets.HOMEBREW_TAP_TOKEN }}');
    expect(publicationPath).not.toContain('token: ${{ steps.release_token.outputs');
    expect(workflow.slice(publish)).toContain('export GH_TOKEN="$RELEASE_TRAIN_TOKEN"');
    expect(workflow.slice(publish)).toContain('export GH_TOKEN="$HOMEBREW_TAP_TOKEN"');
  });

  test('release-triggered brew smoke waits for and resolves the exact formula version', () => {
    const workflow = readWorkflow('fresh-install.yml');
    const waitStep = workflow.indexOf('Wait for the tap formula to match this release');
    const installStep = workflow.indexOf('Install the fully qualified Homebrew formula');

    expect(waitStep).toBeGreaterThan(-1);
    expect(installStep).toBeGreaterThan(waitStep);
    expect(workflow).toContain('EXPECTED_TAG: ${{ github.event.release.tag_name }}');
    expect(workflow).toContain('wait-for-formula "$EXPECTED_TAG" "$FORMULA_URL" "$GITHUB_RUN_ID"');
    expect(workflow).toContain('brew info --json=v2 curiositech/tap/port-daddy');
    expect(workflow).toContain('if [ "$actual_version" != "$expected_version" ]');
  });
});

describe('release workflow state', () => {
  test('CLI rejects malformed workflow inputs with a non-zero exit', () => {
    const badVersion = spawnSync(process.execPath, [STATE_HELPER, 'validate-version', '3.29']);
    const badTag = spawnSync(process.execPath, [STATE_HELPER, 'validate-tag', '3.29.0']);
    const validTag = spawnSync(process.execPath, [STATE_HELPER, 'validate-tag', 'v3.29.0']);
    const missingTokens = spawnSync(process.execPath, [STATE_HELPER, 'require-token', 'false', 'false']);

    expect(badVersion.status).toBe(1);
    expect(badTag.status).toBe(1);
    expect(validTag.status).toBe(0);
    expect(validTag.stdout.toString()).toBe('3.29.0\n');
    expect(missingTokens.status).toBe(1);
  });

  test('accepts only plain stable versions and v-prefixed stable tags', () => {
    expect(parseStableVersion('3.29.0')).toEqual([3, 29, 0]);
    expect(stableVersionFromTag('v3.29.0')).toBe('3.29.0');
    for (const invalid of ['3.29', '3.29.0-rc.1', 'v3.29.0', '']) {
      expect(() => parseStableVersion(invalid)).toThrow('not a stable x.y.z version');
    }
    for (const invalid of ['3.29.0', 'v3.29', 'v3.29.0-rc.1', '']) {
      expect(() => stableVersionFromTag(invalid)).toThrow('not a stable vx.y.z tag');
    }
  });

  test('compares all three numeric version components', () => {
    expect(compareStableVersions('3.29.0', '3.28.99')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.1', '3.29.0')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.0', '3.29.0')).toBe(0);
    expect(compareStableVersions('3.28.99', '3.29.0')).toBeLessThan(0);
  });

  test('selects the exact first version transition instead of a later carrier commit', () => {
    const candidates = [
      { sha: 'bump', version: '3.29.0', parentVersion: '3.28.0' },
      { sha: 'carrier', version: '3.29.0', parentVersion: '3.29.0' },
    ];
    expect(selectVersionTransition('3.29.0', candidates)).toBe('bump');
    expect(() => selectVersionTransition('3.30.0', candidates)).toThrow('could not locate');
  });

  test('reads candidate package states through the same git boundary the workflow calls', () => {
    const responses = new Map([
      ['rev-list --reverse v3.28.0..head -- package.json', 'bump\ncarrier'],
      ['show bump:package.json', '{"version":"3.29.0"}'],
      ['show bump^:package.json', '{"version":"3.28.0"}'],
      ['show carrier:package.json', '{"version":"3.29.0"}'],
      ['show carrier^:package.json', '{"version":"3.29.0"}'],
    ]);
    const git = (args) => responses.get(args.join(' ')) ?? '';
    expect(findVersionTransition('3.29.0', 'v3.28.0..head', git)).toBe('bump');
  });

  test('fails transparently for an invalid git range or malformed package state', () => {
    const invalidRange = () => { throw new Error('bad revision'); };
    expect(() => findVersionTransition('3.29.0', 'missing..head', invalidRange)).toThrow('bad revision');

    const malformedPackage = (args) => {
      if (args[0] === 'rev-list') return 'broken';
      if (args[1] === 'broken:package.json') return '{not-json';
      return '';
    };
    expect(() => findVersionTransition('3.29.0', 'base..head', malformedPackage)).toThrow(SyntaxError);
  });

  test('matches only the formula version declaration for the exact release tag', () => {
    const formula = 'class PortDaddy < Formula\n  version "3.29.0"\nend\n';
    expect(extractFormulaVersion(formula)).toBe('3.29.0');
    expect(formulaMatchesRelease(formula, 'v3.29.0')).toBe(true);
    expect(formulaMatchesRelease(formula, 'v3.30.0')).toBe(false);
    expect(formulaMatchesRelease('desc "version 3.29.0"\n', 'v3.29.0')).toBe(false);
  });

  test('formula polling survives network and content failures before exact success', async () => {
    const outcomes = [
      new Error('network down'),
      'not a formula',
      'version "3.28.0"\n',
      'version "3.29.0"\n',
    ];
    const requests = [];
    const delays = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return { ok: true, status: 200, text: async () => outcome };
    };

    await expect(waitForFormula({
      tag: 'v3.29.0',
      formulaUrl: 'https://example.test/port-daddy.rb',
      runId: 'run-42',
      attempts: 4,
      delayMs: 5,
      fetchImpl,
      sleep: async (delay) => delays.push(delay),
    })).resolves.toBe('3.29.0');
    expect(requests).toHaveLength(4);
    expect(requests[3].searchParams.get('attempt')).toBe('4');
    expect(requests[3].searchParams.get('run')).toBe('run-42');
    expect(delays).toEqual([5, 5, 5]);
  });

  test('formula polling rejects malformed tags and persistent network failure', async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      throw new Error('offline');
    };
    const common = {
      formulaUrl: 'https://example.test/port-daddy.rb',
      attempts: 2,
      delayMs: 0,
      fetchImpl,
      sleep: async () => {},
    };

    await expect(waitForFormula({ ...common, tag: 'v3.29' })).rejects.toThrow('not a stable vx.y.z tag');
    expect(fetchCalls).toBe(0);
    await expect(waitForFormula({ ...common, tag: 'v3.29.0' })).rejects.toThrow(
      'tap formula did not reach v3.29.0 after 2 attempts',
    );
    expect(fetchCalls).toBe(2);

    const staleFetch = async () => ({ ok: true, status: 200, text: async () => 'version "3.28.0"\n' });
    await expect(waitForFormula({ ...common, tag: 'v3.29.0', fetchImpl: staleFetch })).rejects.toThrow(
      'tap formula did not reach v3.29.0 after 2 attempts',
    );
  });

  test('token selection prefers the train credential, falls back, and fails closed', () => {
    expect(selectTokenSource('true', 'true')).toBe('RELEASE_TRAIN_TOKEN');
    expect(selectTokenSource('false', 'true')).toBe('HOMEBREW_TAP_TOKEN');
    expect(() => selectTokenSource('false', 'false')).toThrow('neither RELEASE_TRAIN_TOKEN');
    expect(() => selectTokenSource('yes', 'false')).toThrow('must be true or false');
  });

  test('live token selection executes preferred, fallback, probe-error, and fail-closed paths', () => {
    const calls = [];
    const preferred = selectWorkingTokenSource('train-secret', 'tap-secret', (token, source) => {
      calls.push([token, source]);
      return true;
    });
    expect(preferred).toBe(RELEASE_TRAIN_TOKEN_SOURCE);
    expect(calls).toEqual([['train-secret', RELEASE_TRAIN_TOKEN_SOURCE]]);

    calls.length = 0;
    const fallback = selectWorkingTokenSource('stale-secret', 'tap-secret', (token, source) => {
      calls.push([token, source]);
      return source === HOMEBREW_TAP_TOKEN_SOURCE;
    });
    expect(fallback).toBe(HOMEBREW_TAP_TOKEN_SOURCE);
    expect(calls).toEqual([
      ['stale-secret', RELEASE_TRAIN_TOKEN_SOURCE],
      ['tap-secret', HOMEBREW_TAP_TOKEN_SOURCE],
    ]);

    const afterProbeError = selectWorkingTokenSource('broken-secret', 'tap-secret', (_token, source) => {
      if (source === RELEASE_TRAIN_TOKEN_SOURCE) throw new Error('GitHub unavailable');
      return true;
    });
    expect(afterProbeError).toBe(HOMEBREW_TAP_TOKEN_SOURCE);

    expect(() => selectWorkingTokenSource('dead-a', 'dead-b', () => false)).toThrow(
      'neither RELEASE_TRAIN_TOKEN nor HOMEBREW_TAP_TOKEN can push',
    );
    expect(() => selectWorkingTokenSource('', '', () => true)).toThrow(
      'neither RELEASE_TRAIN_TOKEN nor HOMEBREW_TAP_TOKEN can push',
    );
    expect(() => selectWorkingTokenSource('train-secret', '', null)).toThrow(
      'canPush probe must be a function',
    );
  });
});
