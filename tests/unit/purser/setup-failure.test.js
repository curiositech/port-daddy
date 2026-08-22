describe('spawnViaCliTube – synchronous spawn throw', () => {
  test('returns receipt and cleans up temp dir', async () => {
    // withCoastGuard succeeds
    mockWithCoastGuard.mockImplementationOnce(async (input) => ({
      cmd: '/usr/bin/sandbox-wrapper',
      args: ['--', input.cmd, ...input.args],
      env: { ...input.env, PD_TEST_CONFINED: '1' },
      receipt: () => mockCoastGuardReceipt,
      dispose: mockCoastGuardDispose,
    }));
    // spawn throws
    const { spawn } = await import('node:child_process');
    spawn.mockImplementationOnce(() => { throw new Error('spawn error'); });

    const res = await spawnViaCliTube({ cli: 'claude-code', prompt: 'test' });

    expect(res.error).toContain('Failed to spawn /usr/bin/sandbox-wrapper (Coast Guard wrapper for "/usr/bin/claude"): spawn error');
    expect(res.exitCode).toBe(1);
    expect(res.coastGuardReceipt).toEqual(mockCoastGuardReceipt);
    // rmSync called
    const { rmSync } = await import('node:fs');
    expect(rmSync).toHaveBeenCalledWith('/tmp/test-tempdir', { recursive: true, force: true });
    // dispose called
    expect(mockCoastGuardDispose).toHaveBeenCalledTimes(1);
  });
});