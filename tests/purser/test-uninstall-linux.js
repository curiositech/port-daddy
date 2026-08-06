const { uninstallLinux } = require('../../install-daemon');
const { existsSync, readFileSync, unlinkSync } = require('fs');
const { join } = require('path');

jest.mock('fs');
jest.mock('path');

describe('uninstallLinux without Bosun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not touch Bosun service files', () => {
    const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync');
    uninstallLinux();
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('BOSUN_SYSTEMD_UNIT'));
  });

  test('source code has no Bosun references', () => {
    const source = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/BOSUN_SYSTEMD_UNIT/);
    expect(source).not.toMatch(/uninstallBosunLinux/);
  });
});