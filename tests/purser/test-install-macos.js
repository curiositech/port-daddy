const { installMacOS } = require('../../install-daemon');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

jest.mock('fs');
jest.mock('path');

describe('installMacOS without Bosun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not call installBosunMacOS', () => {
    const mockInstallBosun = jest.spyOn(require('../../install-daemon'), 'installBosunMacOS');
    installMacOS({});
    expect(mockInstallBosun).not.toHaveBeenCalled();
  });

  test('does not modify Bosun-specific paths', () => {
    const mockWriteFileSync = jest.spyOn(require('fs'), 'writeFileSync');
    installMacOS({});
    expect(mockWriteFileSync).not.toHaveBeenCalledWith(expect.stringContaining('BOSUN_PLIST_PATH'));
  });

  test('source code has no Bosun references', () => {
    const source = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/installBosunMacOS/);
    expect(source).not.toMatch(/BOSUN_PLIST_PATH/);
  });
});