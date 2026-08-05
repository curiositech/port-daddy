describe('cli/utils/freshness', () => {
  test('skips freshness checks for daemon-management and background commands', async () => {
    const { shouldCheckDaemonFreshness } = await import('../../cli/utils/freshness.js');

    expect(shouldCheckDaemonFreshness('watch')).toBe(false);
    expect(shouldCheckDaemonFreshness('spawn')).toBe(false);
    expect(shouldCheckDaemonFreshness('fleet')).toBe(false);
    expect(shouldCheckDaemonFreshness('daemon')).toBe(false);
    expect(shouldCheckDaemonFreshness('version')).toBe(false);
    expect(shouldCheckDaemonFreshness('claim')).toBe(true);
  });

  test('skips freshness checks for install-freshness (brew post_install runs network-sandboxed)', async () => {
    const { shouldCheckDaemonFreshness } = await import('../../cli/utils/freshness.js');

    // Regression: v3.25.1 shipped install-freshness without this skip entry.
    // Homebrew's post_install hook has no network access, so the freshness
    // probe's daemon fetch failed with ECONNREFUSED/ENOENT, and the CLI's
    // top-level error handler misread that as "the daemon isn't running" —
    // triggering an auto-start-and-retry loop that made a working,
    // network-free launchd install report failure.
    expect(shouldCheckDaemonFreshness('install-freshness')).toBe(false);
    expect(shouldCheckDaemonFreshness('install')).toBe(false);
    expect(shouldCheckDaemonFreshness('uninstall')).toBe(false);
  });

  test('skips freshness checks when direct mode is requested', async () => {
    const { shouldCheckDaemonFreshness } = await import('../../cli/utils/freshness.js');

    expect(shouldCheckDaemonFreshness('find', ['find', 'api', '--direct'])).toBe(false);
  });

  test('treats named profiles and explicit URLs as owned daemon targets', async () => {
    const { hasExplicitDaemonTarget } = await import('../../cli/utils/freshness.js');

    expect(hasExplicitDaemonTarget({ PORT_DADDY_PROFILE: 'cli-linework' })).toBe(true);
    expect(hasExplicitDaemonTarget({ PORT_DADDY_URL: 'http://127.0.0.1:3180' })).toBe(true);
    expect(hasExplicitDaemonTarget({ PD_URL: 'http://127.0.0.1:3180' })).toBe(true);
    expect(hasExplicitDaemonTarget({ PORT_DADDY_SKIP_FRESHNESS_CHECK: '1' })).toBe(true);
    expect(hasExplicitDaemonTarget({})).toBe(false);
  });

  test('only allows auto-restart for interactive commands against the same install dir', async () => {
    const { shouldAutoRestartDaemonForFreshness } = await import('../../cli/utils/freshness.js');

    expect(shouldAutoRestartDaemonForFreshness({
      daemonInstallDir: '/Users/erichowens/coding/port-daddy',
      localInstallDir: '/Users/erichowens/coding/port-daddy',
      isInteractive: true,
    })).toBe(true);

    expect(shouldAutoRestartDaemonForFreshness({
      daemonInstallDir: '/Users/erichowens/port-daddy-stable',
      localInstallDir: '/Users/erichowens/coding/port-daddy',
      isInteractive: true,
    })).toBe(false);

    expect(shouldAutoRestartDaemonForFreshness({
      daemonInstallDir: '/Users/erichowens/coding/port-daddy',
      localInstallDir: '/Users/erichowens/coding/port-daddy',
      isInteractive: false,
    })).toBe(false);
  });
});
