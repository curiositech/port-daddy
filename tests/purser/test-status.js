const { status } = require('../../install-daemon');
const { readFileSync } = require('fs');
const { join } = require('path');

jest.mock('fs');
jest.mock('path');

describe('status without Bosun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not check Bosun service state', () => {
    const source = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/statusBosunMacOS/);
    expect(source).not.toMatch(/statusBosunLinux/);
    expect(source).not.toMatch(/Bosun service:/);
  });

  test('status function has no Bosun logic', () => {
    const statusBody = source.slice(source.indexOf('function status(): void {'), source.indexOf('export function runInstallDaemonCli'));
    expect(statusBody).not.toContain('Bosun service:');
  });
});