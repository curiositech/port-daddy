import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  assertExecutableArtifact,
  assertOwnedSyntheticTree,
  prepareOwnedPrivateDirectory,
  releaseCandidateIsolatedEnv,
} from '../../scripts/lib/release-candidate-e2e.mjs';

describe('release-candidate environment isolation', () => {
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
});
