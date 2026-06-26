import { planRelease, runRelease, signingPreflight, releaseDocsPreflight, SIGN_ENV } from '../../shared/release.js';

describe('planRelease', () => {
  test('darwin cut contains daemon + core + fleetbar with their build scripts', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc1234', platform: 'darwin' });
    expect(plan.tier).toBe('stable');
    expect(plan.outDir).toBe('dist/release/4.0.0');
    expect(plan.artifacts.map((a) => a.kind)).toEqual(['daemon', 'core', 'fleetbar']);
    const daemon = plan.artifacts.find((a) => a.kind === 'daemon');
    expect(daemon.build).toEqual({ cmd: 'node', args: ['scripts/build-daemon-binary.mjs'] });
    expect(daemon.output).toBe('dist/daemon/port-daddy-daemon');
    expect(plan.artifacts.find((a) => a.kind === 'core').output).toBe('dist/core/libharbor_card_rs.dylib');
    // fleetbar is told to write into the release dir
    expect(plan.artifacts.find((a) => a.kind === 'fleetbar').build.args).toContain('dist/release/4.0.0');
  });

  // Regression: package-fleetbar.sh writes PortDaddy-FleetBar-macOS-<arch>.zip,
  // NOT "FleetBar.app.zip". The earlier hardcoded name made a real cut ENOENT
  // when runRelease tried to hash a file the script never produced. The artifact
  // `output` must equal what the script writes, and the build must pin the name.
  test('fleetbar artifact name/output match the package script output (arch-aware, env-pinned)', () => {
    const arm = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin', arch: 'arm64' });
    const fb = arm.artifacts.find((a) => a.kind === 'fleetbar');
    expect(fb.name).toBe('PortDaddy-FleetBar-macOS-arm64.zip');
    // output is exactly outDir/name — the thing runRelease will hashFile().
    expect(fb.output).toBe('dist/release/4.0.0/PortDaddy-FleetBar-macOS-arm64.zip');
    // the build pins the script's zip name so the two can never drift.
    expect(fb.build.env).toEqual({ PORT_DADDY_FLEETBAR_ZIP: 'PortDaddy-FleetBar-macOS-arm64.zip' });

    // node `x64` maps to `uname -m` `x86_64`, matching the shell script.
    const intel = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin', arch: 'x64' });
    expect(intel.artifacts.find((a) => a.kind === 'fleetbar').name).toBe('PortDaddy-FleetBar-macOS-x86_64.zip');
  });

  test('linux uses .so and marks nothing signable (no codesign)', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'linux' });
    expect(plan.artifacts.find((a) => a.kind === 'core').output.endsWith('.so')).toBe(true);
    expect(plan.artifacts.every((a) => a.signable === false)).toBe(true);
  });
});

describe('runRelease', () => {
  function deps(overrides = {}) {
    const calls = { exec: [], collected: [], signed: [], manifest: null, logs: [] };
    return {
      calls,
      d: {
        exec: (cmd, args) => calls.exec.push(`${cmd} ${args.join(' ')}`),
        hashFile: (p) => ({ sha256: 'h_' + p.replace(/\W/g, ''), bytes: p.length }),
        collect: (from, name) => (calls.collected.push([from, name]), `dist/release/X/${name}`),
        sign: (p) => (calls.signed.push(p), true),
        writeManifest: (path, m) => { calls.manifest = { path, m }; },
        log: (msg) => calls.logs.push(msg),
        now: () => 1000,
        ...overrides,
      },
    };
  }

  test('builds every artifact, collects+hashes, writes manifest (unsigned by default)', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin' });
    const { calls, d } = deps();
    const m = runRelease(plan, d);

    expect(calls.exec).toHaveLength(3); // ran all three build scripts
    expect(calls.collected.map((c) => c[1])).toEqual(['port-daddy-daemon', 'libharbor_card_rs.dylib']); // fleetbar self-places
    expect(m.signed).toBe(false);
    expect(m.artifacts).toHaveLength(3);
    expect(m.artifacts.every((a) => a.sha256 && a.bytes > 0 && a.signed === false)).toBe(true);
    expect(calls.manifest.path).toBe('dist/release/4.0.0/manifest.json');
    expect(calls.signed).toHaveLength(0); // no signing requested
  });

  test('--sign signs every signable artifact and marks the cut signed', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin' });
    const { calls, d } = deps();
    const m = runRelease(plan, d, { sign: true });
    expect(calls.signed).toHaveLength(3); // all signable on darwin
    expect(m.signed).toBe(true);
    expect(m.artifacts.every((a) => a.signed)).toBe(true);
  });

  test('a failed signature leaves the cut UNSIGNED (honest)', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin' });
    const { d } = deps({ sign: () => false });
    const m = runRelease(plan, d, { sign: true });
    expect(m.signed).toBe(false);
    expect(m.artifacts.every((a) => a.signed === false)).toBe(true);
  });

  test('a build failure aborts the cut (no manifest written)', () => {
    const plan = planRelease({ version: '4.0.0', gitSha: 'abc', platform: 'darwin' });
    const { calls, d } = deps({ exec: () => { throw new Error('cargo build failed'); } });
    expect(() => runRelease(plan, d)).toThrow('cargo build failed');
    expect(calls.manifest).toBeNull();
  });
});

describe('signingPreflight', () => {
  const identity = 'Developer ID Application: Curiositech LLC (P5H9P59X2M)';

  test('darwin with identity + notary profile is good to go (will notarize)', () => {
    const pre = signingPreflight({
      platform: 'darwin',
      env: { [SIGN_ENV.identity]: identity, [SIGN_ENV.notaryProfile]: 'pd-notary' },
    });
    expect(pre.ok).toBe(true);
    expect(pre.willNotarize).toBe(true);
    expect(pre.reason).toBeUndefined();
  });

  test('darwin with identity + SKIP_NOTARIZE=1 signs without a notary profile', () => {
    const pre = signingPreflight({
      platform: 'darwin',
      env: { [SIGN_ENV.identity]: identity, [SIGN_ENV.skipNotarize]: '1' },
    });
    expect(pre.ok).toBe(true);
    expect(pre.willNotarize).toBe(false);
  });

  test('missing identity fails fast', () => {
    const pre = signingPreflight({ platform: 'darwin', env: {} });
    expect(pre.ok).toBe(false);
    expect(pre.reason).toContain(SIGN_ENV.identity);
  });

  test('identity present but notary profile missing (and not skipping) fails fast', () => {
    const pre = signingPreflight({ platform: 'darwin', env: { [SIGN_ENV.identity]: identity } });
    expect(pre.ok).toBe(false);
    expect(pre.reason).toContain(SIGN_ENV.notaryProfile);
    // The reason should also point at the SKIP_NOTARIZE escape hatch.
    expect(pre.reason).toContain(SIGN_ENV.skipNotarize);
  });

  test('non-darwin can never sign, even with creds set', () => {
    const pre = signingPreflight({
      platform: 'linux',
      env: { [SIGN_ENV.identity]: identity, [SIGN_ENV.notaryProfile]: 'pd-notary' },
    });
    expect(pre.ok).toBe(false);
    expect(pre.reason).toContain('darwin');
  });

  test('whitespace-only identity is treated as unset', () => {
    const pre = signingPreflight({
      platform: 'darwin',
      env: { [SIGN_ENV.identity]: '   ', [SIGN_ENV.notaryProfile]: 'pd-notary' },
    });
    expect(pre.ok).toBe(false);
    expect(pre.reason).toContain(SIGN_ENV.identity);
  });
});

describe('releaseDocsPreflight', () => {
  const changelogFor = (v) => `# Changelog\n\n## [Unreleased]\n\n## [${v}] - 2026-06-26\n\n### Added\n- thing\n`;
  const readmeFor = (v) => `# ⚓ Port Daddy (v${v})\n\nAuthoritative port manager.\n`;

  test('fresh CHANGELOG section + README title pass', () => {
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog: changelogFor('3.23.0'), readme: readmeFor('3.23.0') });
    expect(pre.ok).toBe(true);
    expect(pre.problems).toEqual([]);
    expect(pre.reason).toBeUndefined();
  });

  test('notes still under [Unreleased] (no dated version section) fails', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\n### Added\n- thing\n';
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog, readme: readmeFor('3.23.0') });
    expect(pre.ok).toBe(false);
    expect(pre.problems).toHaveLength(1);
    expect(pre.problems[0]).toMatch(/CHANGELOG\.md/);
    expect(pre.reason).toContain('3.23.0');
  });

  test('a version section without a date does not count', () => {
    const changelog = '# Changelog\n\n## [3.23.0]\n\n### Added\n- thing\n';
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog, readme: readmeFor('3.23.0') });
    expect(pre.ok).toBe(false);
    expect(pre.problems[0]).toMatch(/YYYY-MM-DD/);
  });

  test('stale README title (previous version) fails', () => {
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog: changelogFor('3.23.0'), readme: readmeFor('3.13.0') });
    expect(pre.ok).toBe(false);
    expect(pre.problems).toHaveLength(1);
    expect(pre.problems[0]).toMatch(/README\.md/);
  });

  test('both stale → both problems reported', () => {
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog: changelogFor('3.22.0'), readme: readmeFor('3.13.0') });
    expect(pre.ok).toBe(false);
    expect(pre.problems).toHaveLength(2);
  });

  test('missing files are reported, not treated as fresh', () => {
    const pre = releaseDocsPreflight({ version: '3.23.0', changelog: null, readme: null });
    expect(pre.ok).toBe(false);
    expect(pre.problems).toHaveLength(2);
    expect(pre.problems.join(' ')).toMatch(/missing or unreadable/);
  });

  test('a prerelease version matches its own dated section (dot/dash escaped)', () => {
    const pre = releaseDocsPreflight({
      version: '3.23.0-rc.1',
      changelog: changelogFor('3.23.0-rc.1'),
      readme: readmeFor('3.23.0-rc.1'),
    });
    expect(pre.ok).toBe(true);
  });
});
