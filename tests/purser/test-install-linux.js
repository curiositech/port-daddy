const { installLinux } = require('../../install-daemon');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

jest.mock('fs');
jest.mock('path');

describe('installLinux without Bosun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not call installBosunLinux', () => {
    const mockInstallBosun = jest.spyOn(require('../../install-daemon'), 'installBosunLinux');
    installLinux({});
    expect(mockInstallBosun).not.toHaveBeenCalled();
  });

  test('source code has no Bosun references', () => {
    const source = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/installBosunLinux/);
    expect(source).not.toMatch(/BOSUN_SYSTEMD_UNIT/);
  });
});