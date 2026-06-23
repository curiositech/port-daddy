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
});
