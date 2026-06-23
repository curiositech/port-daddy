// ADR-0062: the upgrade trigger is a pure function over `brew outdated`'s stdout
// so it's testable without shelling out to brew. `brew outdated <formula>` prints
// the formula name (optionally with versions) when outdated, and nothing when
// current.
describe('cli/commands/self-update isUpgradeAvailable', () => {
  test('false when brew outdated prints nothing (current)', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('')).toBe(false);
    expect(isUpgradeAvailable('\n')).toBe(false);
    expect(isUpgradeAvailable('   \n  ')).toBe(false);
  });

  test('true when the formula name appears alone', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('port-daddy')).toBe(true);
    expect(isUpgradeAvailable('port-daddy\n')).toBe(true);
    expect(isUpgradeAvailable('  port-daddy  ')).toBe(true);
  });

  test('true with brew --verbose version columns', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('port-daddy (3.19.0) < 3.19.1')).toBe(true);
    expect(isUpgradeAvailable('port-daddy 3.19.0 3.19.1')).toBe(true);
  });

  test('false for unrelated formulae — no substring false-positives', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    // A different formula whose name merely starts the line should not trigger.
    expect(isUpgradeAvailable('port-daddy-contrib')).toBe(false);
    expect(isUpgradeAvailable('other-port-daddy')).toBe(false);
    expect(isUpgradeAvailable('node\nripgrep\nbun')).toBe(false);
  });

  test('true when port-daddy is one of several outdated formulae', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('node\nport-daddy\nripgrep')).toBe(true);
    expect(isUpgradeAvailable('node (1) < 2\nport-daddy (3.19.0) < 3.19.1')).toBe(true);
  });

  // REGRESSION: brew prints the TAP-QUALIFIED name for a tapped formula in a
  // non-TTY pipe (exactly the unattended freshness tick's context). The original
  // matcher only accepted the bare "port-daddy", so every tick after a release
  // logged "already current" and never upgraded. These must all be true.
  test('true for the tap-qualified name brew actually emits (the real-world bug)', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('curiositech/tap/port-daddy')).toBe(true);
    expect(isUpgradeAvailable('curiositech/tap/port-daddy\n')).toBe(true);
    expect(isUpgradeAvailable('curiositech/tap/port-daddy (3.20.0) < 3.21.0')).toBe(true);
    expect(isUpgradeAvailable('node\ncuriositech/tap/port-daddy\nripgrep')).toBe(true);
  });

  test('tap-qualified matching does not false-positive on unrelated tapped formulae', async () => {
    const { isUpgradeAvailable } = await import('../../cli/commands/self-update.js');
    expect(isUpgradeAvailable('curiositech/tap/port-daddy-contrib')).toBe(false);
    expect(isUpgradeAvailable('someuser/tap/other-port-daddy')).toBe(false);
    expect(isUpgradeAvailable('curiositech/tap/windags')).toBe(false);
  });
});

describe('cli/commands/self-update parseInstalledVersion', () => {
  test('extracts the version from brew list --versions output', async () => {
    const { parseInstalledVersion } = await import('../../cli/commands/self-update.js');
    expect(parseInstalledVersion('port-daddy 3.21.0')).toBe('3.21.0');
    expect(parseInstalledVersion('port-daddy 3.21.0\n')).toBe('3.21.0');
    // multiple kegs installed → brew lists them all; take the last (newest).
    expect(parseInstalledVersion('port-daddy 3.20.0 3.21.0')).toBe('3.21.0');
  });

  test('null when the formula is absent or output is empty', async () => {
    const { parseInstalledVersion } = await import('../../cli/commands/self-update.js');
    expect(parseInstalledVersion('')).toBe(null);
    expect(parseInstalledVersion('node 22.0.0\nripgrep 14.1.0')).toBe(null);
  });
});
