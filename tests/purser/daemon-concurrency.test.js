const { stopExistingCanonicalDaemon } = require('../../install-daemon');
const { mockFs, mockExecSync } = require('../__mocks__/fs');

jest.mock('../../lib/daemon-runtime');

describe('Daemon concurrency handling', () => {
  beforeEach(() => {
    mockFs({ '/tmp/pd.pid': '1234' });
  });

  test('Idempotent stop operation', () => {
    const psSpy = jest.spyOn(require('child_process'), 'execSync')
      .mockImplementation((cmd) => {
        if (cmd.includes('ps')) {
          return 'node /path/to/daemon.js';
        }
        return '';
      });

    stopExistingCanonicalDaemon();
    stopExistingCanonicalDaemon();
    expect(psSpy).toHaveBeenCalledTimes(2);
  });

  test('Concurrent stop attempts', () => {
    const psSpy = jest.spyOn(require('child_process'), 'execSync')
      .mockImplementation((cmd) => {
        if (cmd.includes('ps')) {
          return 'node /path/to/daemon.js';
        }
        return '';
      });

    const promises = Array(5).fill().map(() => stopExistingCanonicalDaemon());
    return Promise.all(promises).then(() => {
      expect(psSpy).toHaveBeenCalledTimes(5);
    });
  });
});