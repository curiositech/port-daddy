const { cleanStaleSockets } = require('../../install-daemon');
const { mockFs, mockExecSync } = require('../__mocks__/fs');

jest.mock('../../shared/paths.js', () => ({
  DEFAULT_SOCK: '/tmp/daemon.sock',
  DEFAULT_IPC: '/tmp/daemon.ipc'
}));

describe('Daemon cleanup verification', () => {
  beforeEach(() => {
    mockFs({
      '/tmp/daemon.sock': '',
      '/tmp/daemon.ipc': ''
    });
  });

  test('Cleans stale sockets using defined constants', () => {
    const unlinkSpy = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation();
    cleanStaleSockets();
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/daemon.sock');
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/daemon.ipc');
  });

  test('Ignores missing stale files', () => {
    mockFs({ '/tmp/daemon.sock': null, '/tmp/daemon.ipc': null });
    const unlinkSpy = jest.spyOn(require('fs'), 'unlinkSync').mockImplementation();
    cleanStaleSockets();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});