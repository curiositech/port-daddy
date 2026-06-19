import { planRelease, runRelease } from '../../shared/release.js';

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
