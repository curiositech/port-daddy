import { jest } from '@jest/globals';

const mockExistsSync = jest.fn();
const mockStatSync = jest.fn();
const mockUnlinkSync = jest.fn();
const mockSpawnSync = jest.fn();
const actualFs = await import('node:fs');

jest.unstable_mockModule('node:fs', () => ({
  ...actualFs,
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  unlinkSync: mockUnlinkSync,
}));

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({
  resolveDaemonPort: () => 9876,
}));

const { diagnoseStartupBlockers } = await import('../../cli/utils/startup-doctor.js');

describe('startup doctor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });
    mockSpawnSync.mockImplementation((command, args) => {
      if (command === 'lsof') {
        return { stdout: 'p123\n', stderr: '', status: 0 };
      }
      if (command === 'ps') {
        return { stdout: 'node /Users/erichowens/coding/port-daddy/server.ts\n', stderr: '', status: 0 };
      }
      return { stdout: '', stderr: '', status: 0 };
    });
  });

  test('does not flag the healthy daemon on the active port as a zombie blocker', () => {
    const issues = diagnoseStartupBlockers(9876, { healthyDaemonPid: 123 });
    expect(issues).toEqual([]);
  });

  test('still flags stray port daddy listeners when they are not the healthy daemon pid', () => {
    const issues = diagnoseStartupBlockers(9876, { healthyDaemonPid: 456 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue: 'Zombie Port Daddy process',
      fixable: true,
    });
  });

  test('flags a dead port daddy process still owning the unix socket', () => {
    mockExistsSync.mockImplementation((path) => String(path).includes('daemon.sock'));
    mockSpawnSync.mockImplementation((command, args) => {
      if (command === 'lsof' && String(args[0]).includes('daemon.sock')) {
        return { stdout: 'p222\n', stderr: '', status: 0 };
      }
      if (command === 'lsof') {
        return { stdout: '', stderr: '', status: 0 };
      }
      if (command === 'ps') {
        return { stdout: 'node /Users/erichowens/coding/port-daddy/server.ts\n', stderr: '', status: 0 };
      }
      return { stdout: '', stderr: '', status: 0 };
    });

    const issues = diagnoseStartupBlockers(9876);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue: 'Zombie Port Daddy socket process',
      fixable: true,
    });
  });
});
