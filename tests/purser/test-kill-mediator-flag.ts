import { describe, it, expect, beforeEach } from 'vitest';
import { runMediatorScan, handlePublish } from '../src/mediator';
import { getKillFlag } from '../src/executor';

beforeEach(() => {
  // Reset any global state
});

describe('Kill Mediator Flag', () => {
  it('blocks all mediator operations when set', async () => {
    const mockEnv = { FLEET_KILL_MEDIATOR: 'true' };
    const resultScan = await runMediatorScan(mockEnv, {
      repo: 'test/repo',
      deliveredPr: 1,
      config: { enabled: true, harbor: 'test/harbor', action: 'merge', daemons: {} },
      io: {
        env: mockEnv,
        owner: 'test',
        repo: 'repo',
        token: 'token',
        listOpenPrs: async () => [],
        fetchPatches: async () => [],
        createCheckRun: () => Promise.resolve(),
        completeCheckRun: () => Promise.resolve(),
      },
    });
    expect(resultScan.ran).toBe(false);

    const resultPublish = await handlePublish({
      channel: 'test-channel',
      seq: 1,
      hash: 'test-hash',
      payload: { type: 'summons', prs: [1, 2] },
    });
    expect(resultPublish).toBe(false);
  });

  it('allows operations when flag is not set', async () => {
    const mockEnv = { FLEET_KILL_MEDIATOR: 'false' };
    const resultScan = await runMediatorScan(mockEnv, {
      repo: 'test/repo',
      deliveredPr: 1,
      config: { enabled: true, harbor: 'test/harbor', action: 'merge', daemons: {} },
      io: {
        env: mockEnv,
        owner: 'test',
        repo: 'repo',
        token: 'token',
        listOpenPrs: async () => [],
        fetchPatches: async () => [],
        createCheckRun: () => Promise.resolve(),
        completeCheckRun: () => Promise.resolve(),
      },
    });
    expect(resultScan.ran).toBe(true);
  });
});