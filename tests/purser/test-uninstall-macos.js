const { uninstallMacOS } = require('../../install-daemon');
const { existsSync, readFileSync, unlinkSync } = require('fs');
const { join } = require('path');

jest.mock('fs');
jest.mock('path');

describe('uninstallMacOS without Bosun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not touch Bosun service files', () => {
    const mockUnlinkSync = jest.spyOn(require('fs'), 'unlinkSync');
    uninstallMacOS();
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('BOSUN_PLIST_PATH'));
  });

  test('source code has no Bosun references', () => {
    const source = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/BOSUN_PLIST_PATH/);
    expect(source).not.toMatch(/uninstallBosunMacOS/);
  });
});