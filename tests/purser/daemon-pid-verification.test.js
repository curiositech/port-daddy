const { readPublishedPidFile, stopExistingCanonicalDaemon } = require('../../install-daemon');
const { mockFs, mockExecSync } = require('../__mocks__/fs');

jest.mock('../../lib/daemon-runtime');

describe('Daemon PID verification', () => {
  beforeEach(() => {
    mockFs({
      '/tmp/pd.pid': '1234',
      '/tmp/daemon.sock': '',
      '/tmp/daemon.ipc': ''
    });
    jest.clearAllMocks();
  });

  test('Stops only the strictly published daemon PID', () => {
    const mockPs = jest.spyOn(require('child_process'), 'execSync')
      .mockImplementation((cmd) => {
        if (cmd.includes('ps')) {
          return 'node /path/to/daemon.js';
        }
        return '';
      });

    stopExistingCanonicalDaemon();
    expect(mockPs).toHaveBeenCalledWith('ps -p 1234 -o command=');
    expect(mockPs).not.toHaveBeenCalledWith('lsof');
  });

  test('Ignores non-daemon processes in PID file', () => {
    mockFs({ '/tmp/pd.pid': '5678' });
    const mockPs = jest.spyOn(require('child_process'), 'execSync')
      .mockImplementation((cmd) => {
        if (cmd.includes('ps')) {
          return 'python3 /other/script.py';
        }
        return '';
      });

    stopExistingCanonicalDaemon();
    expect(mockPs).toHaveBeenCalledWith('ps -p 5678 -o command=');
  });

  test('Handles missing PID file gracefully', () => {
    mockFs({ '/tmp/pd.pid': null });
    stopExistingCanonicalDaemon();
    expect(console.error).not.toHaveBeenCalled();
  });
});