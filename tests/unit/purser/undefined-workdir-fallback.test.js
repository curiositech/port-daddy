test('preserves an explicit workdir byte-for-byte', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      status: 'completed',
      agentId: 'spawned-explicit-workdir',
      backend: 'custom',
      model: 'custom',
      output: 'done',
    }));

    const workdir = '/Users/example/Project With Spaces/../exact-input';
    await handleSpawn(['review the diff'], {
      backend: 'custom',
      budget: '0.75',
      quiet: true,
      workdir,
    });

    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body.workdir).toBe(workdir);
  });