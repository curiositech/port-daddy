describe('isDaemonUnavailableError', () => {
  test('recognizes refused TCP connections', async () => {
    const { isDaemonUnavailableError } = await import('../../cli/utils/daemon-unavailable.js');

    expect(isDaemonUnavailableError(Object.assign(new Error('refused'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
    }))).toBe(true);
  });

  test('recognizes a missing Unix socket only when ENOENT came from connect', async () => {
    const { isDaemonUnavailableError } = await import('../../cli/utils/daemon-unavailable.js');

    expect(isDaemonUnavailableError(Object.assign(new Error('missing socket'), {
      code: 'ENOENT',
      syscall: 'connect',
    }))).toBe(true);
    expect(isDaemonUnavailableError(Object.assign(new Error('missing archive'), {
      code: 'ENOENT',
      syscall: 'open',
    }))).toBe(false);
    expect(isDaemonUnavailableError(Object.assign(new Error('missing input'), {
      code: 'ENOENT',
      syscall: 'stat',
    }))).toBe(false);
    expect(isDaemonUnavailableError(Object.assign(new Error('ambiguous missing path'), {
      code: 'ENOENT',
    }))).toBe(false);
  });

  test('recognizes transport errors wrapped as a cause', async () => {
    const { isDaemonUnavailableError } = await import('../../cli/utils/daemon-unavailable.js');
    const cause = Object.assign(new Error('missing socket'), {
      code: 'ENOENT',
      syscall: 'connect',
    });

    expect(isDaemonUnavailableError(new Error('request failed', { cause }))).toBe(true);
  });

  test('rejects unrelated values and terminates on cyclic causes', async () => {
    const { isDaemonUnavailableError } = await import('../../cli/utils/daemon-unavailable.js');
    const cyclic = { code: 'ENOENT' };
    cyclic.cause = cyclic;

    expect(isDaemonUnavailableError(new Error('ordinary failure'))).toBe(false);
    expect(isDaemonUnavailableError('ECONNREFUSED')).toBe(false);
    expect(isDaemonUnavailableError(cyclic)).toBe(false);
  });
});
