const fs = require('fs');
const path = require('path');

const INSTALL_DAEMON_PATH = path.join(__dirname, '../../install-daemon.ts');
const TEST_FILES = [
  path.join(__dirname, '../../tests/unit/install-daemon-path.test.js'),
  path.join(__dirname, '../../tests/unit/no-legacy-bosun-command.test.js')
];

describe('Bosun removal verification', () => {
  test('install-daemon.ts has no Bosun functions', () => {
    const source = fs.readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/installBosunMacOS/);
    expect(source).not.toMatch(/generateBosunPlist/);
    expect(source).not.toMatch(/statusBosunMacOS/);
    expect(source).not.toMatch(/resolveBosunBinaryPath/);
  });

  test('install-daemon.ts has no bosun/pd-bosun string literals', () => {
    const source = fs.readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/bosun|pd-bosun/i);
  });

  test('test files have no Bosun references', () => {
    for (const file of TEST_FILES) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/bosun|pd-bosun/i);
      expect(source).not.toMatch(/installBosun/);
      expect(source).not.toMatch(/statusBosun/);
    }
  });

  test('no Bosun-related imports in install-daemon.ts', () => {
    const source = fs.readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/resolveBosunBinaryPath/);
    expect(source).not.toMatch(/BOSUN_BINARY_PATH/);
  });
});