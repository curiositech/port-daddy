import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { runInNewContext } from 'node:vm';
import { parse as parseYaml } from 'yaml';
import {
  compareStableVersions,
  extractFormulaVersion,
  findLatestStableTag,
  findVersionTransition,
  formulaMatchesRelease,
  GITHUB_PERMISSION_PROBE_TIMEOUT_MS,
  HOMEBREW_TAP_TOKEN_SOURCE,
  latestStableTag,
  parseStableVersion,
  probeRepositoryPush,
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
    expect(workflow).toContain('const peeled = await tagTarget(tag)');
    expect(workflow).toContain('release-workflow-state.mjs find-transition "$version" "$range"');
    expect(workflow).toContain('release_sha=$release_sha');
    expect(workflow).toContain('ref: ${{ steps.release.outputs.release_sha }}');
    expect(workflow).toContain('steps.publication.outputs.should_publish');
    expect(workflow).not.toContain("startsWith(github.event.pull_request.head.ref, 'release-train/')");
    expect(workflow).toContain('if (needed) await assertNotSuperseded(tag)');
    expect(workflow).not.toContain("git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1");
  });

  test('only the existing repository-scoped App can mutate the train; relay helpers stay intact', () => {
    const train = parseYaml(readWorkflow('release-train.yml'));
    for (const [name, job] of Object.entries(train.jobs)) {
      expect(job.permissions.contents).toBe('read');
      expect(job.timeout_minutes ?? job['timeout-minutes']).toBeLessThanOrEqual(30);
      const mint = job.steps.find((step) => step.id === 'app');
      expect(mint.uses).toBe('actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1');
      expect(mint.with.owner).toBe('${{ github.repository_owner }}');
      expect(mint.with.repositories).toBe('${{ github.event.repository.name }}');
      expect(mint.with['permission-contents']).toBe('write');
      expect(mint.with['skip-token-revoke']).toBe(false);
      expect(mint.with['permission-pull-requests']).toBe(name === 'cut' ? 'write' : undefined);
      expect(mint.with['permission-workflows']).toBe(name === 'cut' ? undefined : '${{ steps.publication.outputs.workflows }}');
      expect(job.outputs).toBeUndefined();
      for (const step of job.steps.filter((step) => step.uses === 'actions/checkout@v4')) {
        expect(step.with['persist-credentials']).toBe(false);
      }
    }
    expect(readWorkflow('release-train.yml')).not.toMatch(/RELEASE_TRAIN_TOKEN|HOMEBREW_TAP_TOKEN|select-live-token/);
    for (const job of Object.values(train.jobs)) {
      expect(job.steps.find((step) => step.id === 'publish').run).not.toMatch(/['"]--(?:admin|force)['"]/);
    }
    const helper = readFileSync(STATE_HELPER, 'utf8');
    expect(helper).toContain('delete childEnv.RELEASE_TRAIN_TOKEN');
    expect(helper).toContain('delete childEnv.HOMEBREW_TAP_TOKEN');
    const release = readWorkflow('release.yml');
    expect(release).toContain('Wait for independently verified Homebrew promotion');
    expect(release).toContain('wait-for-formula "$EXPECTED_TAG" "$FORMULA_URL" "$GITHUB_RUN_ID"');
    expect(release).not.toContain('repository-dispatch');
    expect(release).not.toContain('HOMEBREW_TAP_TOKEN');
  });

  test('current release documentation uses App-only authority without rewriting historical changelog', () => {
    const releasing = readFileSync(join(ROOT, 'docs', 'RELEASING.md'), 'utf8');
    expect(releasing).toContain('RELEASE_TRAIN_APP_PRIVATE_KEY');
    expect(releasing).toContain('3810450');
    expect(releasing).toContain('cleanup UNCONFIRMED');
    expect(releasing).not.toContain('falls back automatically');
    expect(releasing).toContain('publication through ambient or personal Git/`gh` credentials');
    expect(releasing).toContain('Every GitHub write');
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('RELEASE_TRAIN_TOKEN');
    expect(changelog).toContain('HOMEBREW_TAP_TOKEN');
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

  test('discovery is read-only and both authenticated phases bind their exact source', () => {
    const jobs = parseYaml(readWorkflow('release-train.yml')).jobs;
    expect(jobs.cut.steps.find((step) => step.name === 'Pin the exact measured source').with.ref)
      .toBe('${{ steps.measure.outputs.discovery_sha }}');
    expect(jobs['tag-and-publish'].steps.find((step) => step.name === 'Pin the exact version transition').with.ref)
      .toBe('${{ steps.release.outputs.release_sha }}');
    expect(jobs.cut.steps.find((step) => step.id === 'hold').env.GH_TOKEN).toBe('${{ github.token }}');
    expect(jobs.cut.steps.find((step) => step.id === 'existing').env.GH_TOKEN).toBe('${{ github.token }}');
    expect(jobs['tag-and-publish'].steps.find((step) => step.id === 'publication').env.GH_TOKEN).toBe('${{ github.token }}');
    for (const job of Object.values(jobs)) {
      expect(job.steps.find((step) => step.id === 'publish').env.GH_TOKEN).toBe('${{ steps.app.outputs.token }}');
      expect(job.steps.find((step) => step.id === 'publish').run).not.toContain('RELEASE_TRAIN_APP_PRIVATE_KEY');
    }
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

describe('release changelog discovery with real Git and bash pipefail', () => {
  const version = '3.31.0';
  const heading = `## [${version}] - 2026-09-02`;

  function withReleaseFixture(changelog, verify) {
    const scratchRoot = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'release-changelog-stream-test-'));
    // This is an isolated synthetic repository, never the caller's Git identity,
    // selectors, hooks, credentials, or Port Daddy session.
    const env = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Synthetic release actor', GIT_AUTHOR_EMAIL: 'release@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic release actor', GIT_COMMITTER_EMAIL: 'release@example.invalid' };
    const git = (args) => {
      const result = spawnSync('git', args, { cwd: scratch, env, encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0) throw new Error('Synthetic Git setup failed: ' + args[0]);
      return result.stdout.trim();
    };
    try {
      const template = join(scratch, 'empty-template');
      mkdirSync(template);
      mkdirSync(join(scratch, 'scripts'));
      writeFileSync(join(scratch, 'package.json'), JSON.stringify({ version }));
      writeFileSync(join(scratch, 'scripts', 'release-workflow-state.mjs'), readFileSync(STATE_HELPER));
      if (changelog !== null) writeFileSync(join(scratch, 'CHANGELOG.md'), changelog);
      git(['init', '--quiet', '--template=' + template]);
      git(['add', 'package.json', 'scripts/release-workflow-state.mjs', ...(changelog === null ? [] : ['CHANGELOG.md'])]);
      git(['commit', '--quiet', '-m', 'synthetic version transition']);
      const sha = git(['rev-parse', 'HEAD']);
      const output = join(scratch, 'step-output');
      const step = parseYaml(readWorkflow('release-train.yml')).jobs['tag-and-publish'].steps
        .find((candidate) => candidate.id === 'release');
      const run = (script = step.run) => spawnSync('bash', ['-c', script], {
        cwd: scratch, env: { ...env, MERGE_SHA: sha, GITHUB_OUTPUT: output },
        encoding: 'utf8', timeout: 30_000,
      });
      verify({ run, sha, readOutput: () => existsSync(output) ? readFileSync(output, 'utf8') : '' });
    } finally {
      rmSync(scratch, { recursive: true });
    }
  }

  test('a large matching blob succeeds where early-exit grep SIGPIPEs the real producer', () => {
    const changelog = heading + '\n' + 'Synthetic retained release history.\n'.repeat(131_072);
    withReleaseFixture(changelog, ({ run, sha, readOutput }) => {
      const legacy = run('set -o pipefail\ngit show "$MERGE_SHA:CHANGELOG.md" | grep -Fq "## [3.31.0] -"');
      expect(legacy.status).toBe(141);
      const actual = run(); // Execute the complete YAML discovery block, not a copied predicate.
      expect(actual.status).toBe(0);
      expect(actual.stderr).toBe('');
      expect(readOutput()).toBe(`version=${version}\ntag=v${version}\nrelease_sha=${sha}\n`);
    });
  });

  test('an absent dated header still fails without producing release outputs', () => {
    withReleaseFixture('# Synthetic changelog without this version\n', ({ run, readOutput }) => {
      const actual = run();
      expect(actual.status).toBe(1);
      expect(actual.stdout).toContain('Exact version transition lacks its dated changelog.');
      expect(readOutput()).toBe('');
    });
  });

  test('a genuine git-show read failure still fails without producing release outputs', () => {
    withReleaseFixture(null, ({ run, readOutput }) => {
      const actual = run();
      expect(actual.status).toBe(1);
      expect(actual.stderr).toContain('CHANGELOG.md');
      expect(actual.stdout).toContain('Exact version transition lacks its dated changelog.');
      expect(readOutput()).toBe('');
    });
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
    expect(parseStableVersion('3.29.0')).toEqual([3n, 29n, 0n]);
    expect(stableVersionFromTag('v3.29.0')).toBe('3.29.0');
    for (const invalid of [
      '3.29',
      '3.29.0-rc.1',
      'v3.29.0',
      '03.29.0',
      '3.029.0',
      '3.29.00',
      '',
    ]) {
      expect(() => parseStableVersion(invalid)).toThrow('not a stable x.y.z version');
    }
    for (const invalid of [
      '3.29.0',
      'v3.29',
      'v3.29.0-rc.1',
      'v03.29.0',
      'v3.029.0',
      'v3.29.00',
      '',
    ]) {
      expect(() => stableVersionFromTag(invalid)).toThrow('not a stable vx.y.z tag');
    }
  });

  test('compares all three numeric version components', () => {
    expect(compareStableVersions('3.29.0', '3.28.99')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.1', '3.29.0')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.0', '3.29.0')).toBe(0);
    expect(compareStableVersions('3.28.99', '3.29.0')).toBeLessThan(0);
    expect(
      compareStableVersions('9007199254740992.0.0', '9007199254740993.0.0'),
    ).toBeLessThan(0);
  });

  test('selects the newest stable tag after excluding prereleases first', () => {
    expect(latestStableTag([
      'v3.30.1',
      'v3.30.2',
      'v3.30.2-rc.1',
      'v3.29.9',
    ])).toBe('v3.30.2');
    expect(latestStableTag(['v3.30.2-rc.1', 'v3.30.2-beta.1'])).toBe(null);
    expect(latestStableTag([
      'v9007199254740992.0.0',
      'v9007199254740993.0.0',
      'v09007199254740994.0.0',
    ])).toBe('v9007199254740993.0.0');
  });

  test('queries git with the exact tag-list contract and returns no prerelease-only fallback', () => {
    const calls = [];
    const outputs = [
      'v3.30.1\nv3.30.2-rc.1\nv3.29.9',
      'v3.30.2-rc.1\nv3.30.2-beta.1',
    ];
    const git = (args) => {
      calls.push(args);
      return outputs.shift();
    };

    expect(findLatestStableTag(git)).toBe('v3.30.1');
    expect(findLatestStableTag(git, 'v3.30.*')).toBe(null);
    expect(calls).toEqual([
      ['tag', '--list', 'v*'],
      ['tag', '--list', 'v3.30.*'],
    ]);
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

    let deniedError;
    try {
      selectWorkingTokenSource('dead-a', 'dead-b', () => false);
    } catch (error) {
      deniedError = error;
    }
    expect(deniedError).toBeInstanceOf(Error);
    expect(deniedError.message).toBe(
      'neither RELEASE_TRAIN_TOKEN nor HOMEBREW_TAP_TOKEN can push to the repository',
    );
    expect(deniedError.stack).toContain('selectWorkingTokenSource');
    expect(() => selectWorkingTokenSource('', '', () => true)).toThrow(
      'neither RELEASE_TRAIN_TOKEN nor HOMEBREW_TAP_TOKEN can push',
    );
    expect(() => selectWorkingTokenSource('train-secret', '', null)).toThrow(
      'canPush probe must be a function',
    );
  });

  test('live repository permission probe is bounded and isolates each candidate secret', () => {
    let invocation;
    const allowed = probeRepositoryPush(
      'candidate-secret',
      RELEASE_TRAIN_TOKEN_SOURCE,
      'curiositech/port-daddy',
      (...args) => {
        invocation = args;
        return 'true\n';
      },
    );

    expect(allowed).toBe(true);
    expect(invocation[0]).toBe('gh');
    expect(invocation[1]).toEqual([
      'api',
      'repos/curiositech/port-daddy',
      '--jq',
      '.permissions.push // false',
    ]);
    expect(invocation[2]).toMatchObject({
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GITHUB_PERMISSION_PROBE_TIMEOUT_MS,
    });
    expect(invocation[2].env.GH_TOKEN).toBe('candidate-secret');
    expect(invocation[2].env.RELEASE_TRAIN_TOKEN).toBeUndefined();
    expect(invocation[2].env.HOMEBREW_TAP_TOKEN).toBeUndefined();
  });

  test('a real child-process timeout fails the probe closed and emits a sanitized warning', () => {
    const warning = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let configuredTimeout;
    try {
      const allowed = probeRepositoryPush(
        'candidate-secret',
        RELEASE_TRAIN_TOKEN_SOURCE,
        'curiositech/port-daddy',
        (_file, _args, options) => {
          configuredTimeout = options.timeout;
          const child = spawnSync(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1_000)'],
            { ...options, env: {}, timeout: 25 },
          );
          if (child.error) throw child.error;
          return child.stdout.toString();
        },
      );

      expect(allowed).toBe(false);
      expect(configuredTimeout).toBe(GITHUB_PERMISSION_PROBE_TIMEOUT_MS);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(
        '::warning::RELEASE_TRAIN_TOKEN probe failed',
      ));
      expect(warning.mock.calls.flat().join('')).not.toContain('candidate-secret');
    } finally {
      warning.mockRestore();
    }
  });
});


// Execute the actual inline Node programs with synthetic GitHub and process boundaries.
// No credentials, publication, repository clone, workflow dispatch or network calls.
const train = () => parseYaml(readWorkflow('release-train.yml'));
const nodeProgram = (job, selector) => {
  const step = train().jobs[job].steps.find((item) => item.id === selector || item.name === selector);
  const match = /node <<'NODE'\n([\s\S]*?)\nNODE(?:\n|$)/.exec(step.run);
  if (!match) throw new Error('Missing executable inline Node block: ' + selector);
  return match[1];
};
const SOURCE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const TARGET = '3'.repeat(40);
const DEFAULT = '4'.repeat(40);
const TAG_OBJECT = '5'.repeat(40);
const WORKFLOW_A = '6'.repeat(40);
const WORKFLOW_B = '7'.repeat(40);
const REPO = 'fixture/repository';
const BOT = { id: 42, login: 'port-daddy[bot]', type: 'Bot' };
const SECRET = 'synthetic-token-do-not-print';

async function executeTrain(job, selector, options = {}) {
  const calls = [];
  const commands = [];
  const messages = [];
  const files = new Map();
  const state = {
    branch: null, prs: [], tag: null, release: null, queue: null,
    committed: false, cleanupStatus: 204, workflowsDiffer: false, ...options,
  };
  const env = {
    GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: 'synthetic-run-10',
    GITHUB_STEP_SUMMARY: 'summary', GITHUB_OUTPUT: 'output',
    GH_TOKEN: SECRET, APP_SLUG: 'port-daddy', INSTALLATION_ID: '123',
    RELEASE_APP_ID: '3810450', RELEASE_APP_KEY: 'synthetic-private-key-do-not-print',
    DISCOVERY_SHA: SOURCE, NEXT: '3.31.0', LATEST_TAG: 'v3.30.6',
    RELEASE_SHA: TARGET, TAG: 'v3.31.0', WORKFLOWS_PERMISSION: '',
    ...options.env,
  };
  // A run step never receives the private key in Actions. Only its dedicated
  // configuration check does, and neither operation passes it to children.
  if (selector !== 'Require approved App configuration') delete env.RELEASE_APP_KEY;
  const processStub = { env, exitCode: 0 };
  const response = (status, json = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
  const fetchStub = async (url, config) => {
    const path = new URL(url).pathname + new URL(url).search;
    const method = config.method ?? 'GET';
    const body = config.body ? JSON.parse(config.body) : undefined;
    calls.push({ path, method, body, config });
    expect(config.redirect).toBe('error');
    expect(config.signal).toBeDefined();
    if (options.intercept) {
      const replacement = await options.intercept({ path, method, body, state, response });
      if (replacement !== undefined) return replacement;
    }
    if (path === '/installation/token') {
      if (state.cleanupStatus === 'network') throw new Error(SECRET);
      return response(state.cleanupStatus);
    }
    if (path === '/installation/repositories?per_page=100') {
      return response(200, state.installation ?? { total_count: 1, repositories: [{ full_name: REPO }] });
    }
    if (path === '/users/port-daddy%5Bbot%5D') return response(200, state.bot ?? BOT);
    if (path === '/repos/' + REPO) return response(200, { default_branch: 'main' });
    if (path.startsWith('/repos/' + REPO + '/tags?')) return response(200, (state.remoteTags ?? ['v3.30.6']).map((name) => ({ name })));
    if (path.startsWith('/repos/' + REPO + '/releases?')) return response(200, state.remoteReleases ?? []);
    if (path === '/repos/' + REPO + '/commits/main') return response(200, { sha: DEFAULT });
    if (path.includes('/git/commits/')) return response(200, { tree: { sha: path.endsWith(TARGET) ? 'a'.repeat(40) : 'b'.repeat(40) } });
    if (path.includes('/git/trees/')) {
      const sha = path.split('/').pop();
      if (sha === 'a'.repeat(40) || sha === 'b'.repeat(40)) return response(200, {
        tree: [{ path: '.github', type: 'tree', sha: sha === 'a'.repeat(40) ? 'c'.repeat(40) : 'd'.repeat(40) }],
      });
      if (sha === 'c'.repeat(40) || sha === 'd'.repeat(40)) return response(200, {
        tree: [{ path: 'workflows', type: 'tree', sha: state.workflowsDiffer && sha === 'd'.repeat(40) ? WORKFLOW_B : WORKFLOW_A }],
      });
      throw new Error('Unexpected tree fixture');
    }
    if (path.includes('/git/ref/heads/')) return state.branch ? response(200, { object: { sha: state.branch } }) : response(404);
    if (path.startsWith('/repos/' + REPO + '/pulls?')) return response(200, state.prs);
    if (path === '/repos/' + REPO + '/pulls' && method === 'POST') {
      state.prs = [{
        number: 17, state: 'open', user: BOT,
        head: { sha: HEAD, ref: 'release-train/v3.31.0', repo: { full_name: REPO } },
        base: { ref: 'main' },
      }];
      if (state.ambiguousPr) throw new Error(SECRET);
      return response(201, state.prs[0]);
    }
    if (path === '/graphql') return response(200, { data: { repository: { pullRequest: {
      headRefOid: HEAD, state: 'OPEN', autoMergeRequest: state.autoMerge ?? null,
      mergeQueueEntry: state.queue, reviewThreads: {
        nodes: state.unresolved ? [{ isResolved: false }] : [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    } } } });
    if (path.includes('/git/ref/tags/')) return state.tag ? response(200, {
      object: state.annotated === false ? { type: 'commit', sha: state.tag } : { type: 'tag', sha: TAG_OBJECT },
    }) : response(404);
    if (path === '/repos/' + REPO + '/git/tags/' + TAG_OBJECT) return response(200, { object: { type: 'commit', sha: state.tag } });
    if (path === '/repos/' + REPO + '/git/tags' && method === 'POST') return response(201, { sha: TAG_OBJECT });
    if (path === '/repos/' + REPO + '/git/refs' && method === 'POST') {
      state.tag = TARGET;
      if (state.ambiguousTag) throw new Error(SECRET);
      return response(201, { object: { sha: TAG_OBJECT } });
    }
    if (path.includes('/releases/tags/')) return state.release ? response(200, state.release) : response(404);
    if (path === '/repos/' + REPO + '/releases' && method === 'POST') {
      state.release = { id: 91, tag_name: 'v3.31.0', draft: false, prerelease: false, published_at: '2026-09-02T00:00:00Z' };
      if (state.ambiguousRelease) throw new Error(SECRET);
      return response(201, state.release);
    }
    throw new Error('Unexpected synthetic HTTP request: ' + method + ' ' + path);
  };
  const execFileSync = (file, args, config) => {
    commands.push({ file, args, config });
    expect(config.stdio).toEqual(['ignore', 'pipe', 'ignore']);
    expect(config.timeout).toBe(120_000);
    if (options.runCommand) {
      const replacement = options.runCommand({ file, args, config, state });
      if (replacement !== undefined) return replacement;
    }
    if (file === 'git' && args[0] === 'rev-parse') {
      return (job === 'cut' ? state.committed ? HEAD : state.checkoutSource ?? SOURCE : state.checkoutSource ?? TARGET) + '\n';
    }
    if (file === 'git' && args[0] === 'commit') state.committed = true;
    if (file === 'git' && args[0] === 'push') {
      if (!state.pushDenied) state.branch = state.pushHead ?? HEAD;
      if (state.ambiguousPush || state.pushDenied) throw new Error(SECRET);
    }
    if (file === 'gh') {
      if (!state.queueDenied) state.queue = { id: 'synthetic-queue-entry' };
      if (state.ambiguousQueue || state.queueDenied) throw new Error(SECRET);
    }
    if (file === 'node' && args.includes('latest-stable-tag')) return state.latest ?? 'v3.30.6';
    return '';
  };
  await runInNewContext(nodeProgram(job, selector), {
    process: processStub, Buffer, Date, AbortSignal, fetch: fetchStub,
    console: { log: (line) => messages.push(line), error: (line) => messages.push(line) },
    require: (name) => {
      if (name === 'node:child_process') return { execFileSync };
      if (name === 'node:fs') return { appendFileSync: (path, text) => files.set(path, (files.get(path) ?? '') + text) };
      throw new Error('Unexpected require: ' + name);
    },
  });
  const output = [...messages, ...files.values()].join('\n');
  expect(output).not.toContain(SECRET);
  expect(output).not.toContain('synthetic-private-key-do-not-print');
  const writes = calls.filter((call) => call.method !== 'GET' && call.path !== '/installation/token' && call.path !== '/graphql');
  return { state, calls, commands, output, files, code: processStub.exitCode, writes };
}

describe('executable App-only release train', () => {
  test.each(['', 'wrong-app'])('missing or wrong approved configuration stops with no publication: %s', async (id) => {
    const result = await executeTrain('cut', 'Require approved App configuration', { env: { RELEASE_APP_ID: id } });
    expect(result.code).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.output).toContain('configuration provisioning is separate work');
  });

  test('missing private key fails before token creation; approved configuration is only a preflight', async () => {
    const missing = await executeTrain('cut', 'Require approved App configuration', { env: { RELEASE_APP_KEY: '' } });
    expect(missing.code).toBe(1);
    const configured = await executeTrain('cut', 'Require approved App configuration');
    expect(configured.code).toBe(0);
    expect(configured.calls).toHaveLength(0);
  });

  test.each([
    { hold: 'true', commits: '2', open: '0', next: '' },
    { hold: 'false', commits: '0', open: undefined, next: '' },
    { hold: 'false', commits: '2', open: '1', next: '' },
  ])('hold, unchanged and existing-PR decisions cannot enter App phase: %j', (scenario) => {
    const steps = { hold: { outputs: { held: scenario.hold } }, measure: { outputs: { commits: scenario.commits } },
      existing: { outputs: { open: scenario.open } }, version: { outputs: { next: scenario.next } } };
    const job = train().jobs.cut;
    const version = job.steps.find((step) => step.id === 'version');
    expect(Function('steps', 'return (' + version.if + ')')(steps)).toBe(false);
    for (const step of job.steps.slice(job.steps.findIndex((step) => step.name === 'Require approved App configuration'))) {
      expect(Function('steps', 'return (' + step.if + ')')(steps)).toBe(false);
    }
  });

  test.each([401, 403, 429])('invalid/revoked/insufficient App authority HTTP%s performs no publication', async (status) => {
    const result = await executeTrain('cut', 'publish', {
      intercept: ({ path, response }) => path.startsWith('/installation/repositories') ? response(status, { secret: SECRET }) : undefined,
    });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
    expect(result.commands).toHaveLength(0);
    expect(result.output).toContain('HTTP ' + status);
  });

  test.each([
    { env: { APP_SLUG: 'another-app' } },
    { bot: { ...BOT, type: 'User' } },
    { installation: { total_count: 2, repositories: [{ full_name: REPO }, { full_name: 'other/repo' }] } },
  ])('bot and repository scope witnesses precede all publication: %j', async (options) => {
    const result = await executeTrain('cut', 'publish', options);
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
    expect(result.commands).toHaveLength(0);
  });

  test('later main cannot replace the exact measured checkout', async () => {
    const result = await executeTrain('cut', 'publish', { checkoutSource: DEFAULT });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
    expect(result.commands.some((command) => command.args[0] === 'push')).toBe(false);
  });

  test.each([403, 429, 'network'])('a branch read %s is not absence and cannot authorize creation', async (status) => {
    const result = await executeTrain('cut', 'publish', {
      intercept: ({ path, response }) => {
        if (!path.includes('/git/ref/heads/')) return undefined;
        if (status === 'network') throw new Error(SECRET);
        return response(status);
      },
    });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
    expect(result.commands.some((command) => command.args[0] === 'push')).toBe(false);
  });

  test('an existing branch is never regenerated or force pushed', async () => {
    const result = await executeTrain('cut', 'publish', { branch: DEFAULT });
    expect(result.code).toBe(1);
    expect(result.commands.some((command) => command.args[0] === 'checkout' || command.args[0] === 'push')).toBe(false);
  });

  test('lost push, PR and queue responses use witnesses without replaying any mutation', async () => {
    const result = await executeTrain('cut', 'publish', { ambiguousPush: true, ambiguousPr: true, ambiguousQueue: true });
    expect(result.code).toBe(0);
    expect(result.commands.filter((command) => command.args[0] === 'push')).toHaveLength(1);
    expect(result.commands.find((command) => command.args[0] === 'push').args)
      .toEqual(['push', '--force-with-lease=refs/heads/release-train/v3.31.0:', 'origin', 'HEAD:refs/heads/release-train/v3.31.0']);
    expect(result.commands.find((command) => command.args[0] === 'push').config.env)
      .toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '', GIT_TERMINAL_PROMPT: '0' });
    expect(result.writes.filter((call) => call.path.endsWith('/pulls'))).toHaveLength(1);
    const merge = result.commands.filter((command) => command.file === 'gh');
    expect(merge).toHaveLength(1);
    expect(merge[0].args).toContain('--match-head-commit');
    expect(merge[0].args).toContain(HEAD);
    expect(result.output).toContain('"status":"queued"');
    expect(result.output).toContain('"confirmed-204"');
    for (const command of result.commands.filter((item) => ['npm', 'npx', 'node'].includes(item.file))) {
      expect(command.config.env.GH_TOKEN).toBeUndefined();
      expect(command.config.env.GITHUB_TOKEN).toBeUndefined();
      expect(command.config.env.RELEASE_APP_KEY).toBeUndefined();
    }
    const commit = result.commands.find((command) => command.args[0] === 'commit');
    expect(commit.config.env.GIT_AUTHOR_EMAIL).toBe('42+port-daddy[bot]@users.noreply.github.com');
  });

  test('unresolved review threads leave the published PR waiting, never bypass the queue', async () => {
    const result = await executeTrain('cut', 'publish', { unresolved: true });
    expect(result.code).toBe(0);
    expect(result.state.prs).toHaveLength(1);
    expect(result.commands.filter((command) => command.file === 'gh')).toHaveLength(0);
    expect(result.output).toContain('waiting-for-review-thread-resolution');
  });

  test('a changed push head cannot create a PR', async () => {
    const result = await executeTrain('cut', 'publish', { pushHead: DEFAULT });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
  });

  test('real Git: an ancestor branch appearing after discovery is not fast-forwarded or given a PR', async () => {
    const scratchRoot = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'release-train-create-only-test-'));
    const remote = join(scratch, 'remote.git');
    const worker = join(scratch, 'worker');
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Synthetic test actor', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic test actor', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
    const git = (args, cwd = scratch, allowedFailure = false) => {
      const result = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
      if (result.status !== 0 && !allowedFailure) throw new Error('Synthetic git command failed: ' + args[0]);
      return result;
    };
    try {
      git(['init', '--bare', remote]);
      git(['clone', remote, worker]);
      git(['checkout', '-b', 'main'], worker);
      git(['commit', '--allow-empty', '-m', 'synthetic discovery source'], worker);
      const ancestor = git(['rev-parse', 'HEAD'], worker).stdout.trim();
      git(['push', 'origin', 'HEAD:refs/heads/main'], worker);
      git(['commit', '--allow-empty', '-m', 'synthetic generated release'], worker);
      const generated = git(['rev-parse', 'HEAD'], worker).stdout.trim();
      const ref = 'refs/heads/release-train/v3.31.0';
      expect(git(['ls-remote', 'origin', ref], worker).stdout.trim()).toBe('');
      const control = 'refs/heads/synthetic-plain-push-control';
      git(['update-ref', control, ancestor], remote);
      expect(git(['push', 'origin', 'HEAD:' + control], worker).status).toBe(0);
      expect(git(['rev-parse', control], remote).stdout.trim()).toBe(generated);
      let reads = 0;
      let pushed;
      const result = await executeTrain('cut', 'publish', {
        intercept: ({ path, response }) => {
          if (!path.includes('/git/ref/heads/')) return undefined;
          reads++;
          if (reads === 1) return response(404);
          return response(200, { object: { sha: git(['rev-parse', ref], remote).stdout.trim() } });
        },
        runCommand: ({ file, args }) => {
          if (file !== 'git' || args[0] !== 'push') return undefined;
          // Another actor creates the ancestor ref after the read-only 404.
          git(['update-ref', ref, ancestor], remote);
          pushed = git(args, worker, true); // actual workflow arguments, real Git CAS
          if (pushed.status !== 0) throw new Error('synthetic push refused');
          return pushed.stdout;
        },
      });
      expect(pushed.status).not.toBe(0);
      expect(git(['rev-parse', ref], remote).stdout.trim()).toBe(ancestor);
      expect(generated).not.toBe(ancestor);
      expect(result.code).toBe(1);
      expect(result.writes).toHaveLength(0);
      expect(result.state.prs).toHaveLength(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('an existing exact stable Release is a read-only no-op without App configuration', async () => {
    const result = await executeTrain('tag-and-publish', 'publication', {
      tag: TARGET, release: { id: 91, tag_name: 'v3.31.0', draft: false, prerelease: false, published_at: '2026-09-02' },
      env: { GH_TOKEN: 'synthetic-readonly-token', RELEASE_APP_ID: '', APP_SLUG: '' },
    });
    expect(result.code).toBe(0);
    expect(result.writes).toHaveLength(0);
    expect(result.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(result.files.get('output')).toContain('should_publish=false');
  });

  test('a tag without a Release is incomplete and needs publication', async () => {
    const result = await executeTrain('tag-and-publish', 'publication', { tag: TARGET });
    expect(result.code).toBe(0);
    expect(result.files.get('output')).toContain('should_publish=true');
    expect(result.writes).toHaveLength(0);
  });

  test.each(['publication', 'publish'])('old exact tag with missing Release cannot supersede a newer stable version: %s', async (selector) => {
    const result = await executeTrain('tag-and-publish', selector, { tag: TARGET, remoteTags: ['v3.31.0', 'v9.0.0'] });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
    expect(result.files.get('output') ?? '').not.toContain('should_publish=true');
  });

  test('equal partial-tag version is allowed, but an independently newer published Release also blocks', async () => {
    const equal = await executeTrain('tag-and-publish', 'publish', { tag: TARGET, remoteTags: ['v3.31.0'] });
    expect(equal.code).toBe(0);
    expect(equal.writes).toHaveLength(1);
    const newer = await executeTrain('tag-and-publish', 'publish', {
      tag: TARGET, remoteTags: ['v3.31.0'],
      remoteReleases: [{ tag_name: 'v9.0.0', draft: false, prerelease: false, published_at: '2026-09-02' }],
    });
    expect(newer.code).toBe(1);
    expect(newer.writes).toHaveLength(0);
  });

  test('a newer stable version appearing after tag creation prevents the Release POST', async () => {
    let reads = 0;
    const result = await executeTrain('tag-and-publish', 'publish', {
      intercept: ({ path, response }) => {
        if (!path.startsWith('/repos/' + REPO + '/tags?')) return undefined;
        return response(200, [{ name: ++reads === 1 ? 'v3.30.6' : 'v9.0.0' }]);
      },
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('"phase":"tag"');
    expect(result.writes.filter((call) => call.path.endsWith('/releases'))).toHaveLength(0);
  });

  test('remote version enumeration follows pages and refuses incomplete pagination', async () => {
    const paged = await executeTrain('tag-and-publish', 'publication', {
      tag: TARGET,
      intercept: ({ path, response }) => path.endsWith('/tags?per_page=100&page=1')
        ? response(200, Array.from({ length: 100 }, () => ({ name: 'v1.0.0' })))
        : path.endsWith('/tags?per_page=100&page=2') ? response(200, [{ name: 'v9.0.0' }]) : undefined,
    });
    expect(paged.code).toBe(1);
    expect(paged.writes).toHaveLength(0);
    const overflow = await executeTrain('tag-and-publish', 'publish', {
      tag: TARGET,
      intercept: ({ path, response }) => path.includes('/tags?')
        ? response(200, Array.from({ length: 100 }, () => ({ name: 'v1.0.0' }))) : undefined,
    });
    expect(overflow.code).toBe(1);
    expect(overflow.calls.filter((call) => call.path.includes('/tags?'))).toHaveLength(10);
    expect(overflow.writes).toHaveLength(0);
  });

  test('workflow permission compares the target with current default-branch trees', async () => {
    const same = await executeTrain('tag-and-publish', 'publication');
    const different = await executeTrain('tag-and-publish', 'publication', { workflowsDiffer: true });
    expect(same.files.get('output')).toContain('workflows=\n');
    expect(different.files.get('output')).toContain('workflows=write\n');
    expect(different.calls.some((call) => call.path.endsWith('/commits/main'))).toBe(true);
  });

  test('default-branch workflow drift cannot silently widen the minted token', async () => {
    const result = await executeTrain('tag-and-publish', 'publish', { workflowsDiffer: true });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
  });

  test.each([403, 429, 'network'])('a tag read %s is never permission to create it', async (status) => {
    const result = await executeTrain('tag-and-publish', 'publish', {
      intercept: ({ path, response }) => {
        if (!path.includes('/git/ref/tags/')) return undefined;
        if (status === 'network') throw new Error(SECRET);
        return response(status);
      },
    });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
  });

  test('a conflicting peeled tag wins over a superficially matching Release target_commitish', async () => {
    const result = await executeTrain('tag-and-publish', 'publication', {
      tag: DEFAULT, release: { tag_name: 'v3.31.0', target_commitish: TARGET, draft: false, prerelease: false, published_at: '2026-09-02' },
    });
    expect(result.code).toBe(1);
    expect(result.writes).toHaveLength(0);
  });

  test('ambiguous tag and Release creation read back exact state without replay', async () => {
    const result = await executeTrain('tag-and-publish', 'publish', { ambiguousTag: true, ambiguousRelease: true });
    expect(result.code).toBe(0);
    expect(result.writes.map((call) => call.path)).toEqual([
      '/repos/' + REPO + '/git/tags', '/repos/' + REPO + '/git/refs', '/repos/' + REPO + '/releases',
    ]);
    expect(result.writes.find((call) => call.path.endsWith('/releases')).body.make_latest).toBe('true');
    expect(result.output).toContain('"phase":"release"');
    expect(result.output).toContain('"target":"' + TARGET + '"');
  });

  test('partial tag-only state creates only the missing Release', async () => {
    const result = await executeTrain('tag-and-publish', 'publish', { tag: TARGET });
    expect(result.code).toBe(0);
    expect(result.writes.map((call) => call.path)).toEqual(['/repos/' + REPO + '/releases']);
  });

  test.each([204, 401, 'network'])('cleanup %s preserves publication receipts and never replays writes', async (cleanupStatus) => {
    for (const job of ['cut', 'tag-and-publish']) {
      const result = await executeTrain(job, 'publish', { cleanupStatus });
      expect(result.code).toBe(cleanupStatus === 204 ? 0 : 1);
      expect(result.output).toContain(job === 'cut' ? '"phase":"pr"' : '"phase":"release"');
      expect(result.calls.filter((call) => call.path === '/installation/token')).toHaveLength(1);
      expect(result.writes).toHaveLength(job === 'cut' ? 1 : 3);
      if (cleanupStatus !== 204) {
        expect(result.output).toContain('Publication may already have succeeded');
        expect(result.output).toContain('token cleanup UNCONFIRMED');
      }
    }
  });

  test('a denied Release POST leaves the confirmed tag receipt and does not report success', async () => {
    const result = await executeTrain('tag-and-publish', 'publish', {
      intercept: ({ path, method, response }) => path.endsWith('/releases') && method === 'POST' ? response(403) : undefined,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('"phase":"tag"');
    expect(result.output).not.toContain('"status":"published"');
    expect(result.writes.filter((call) => call.path.endsWith('/releases'))).toHaveLength(1);
  });
});
