const fs = require('fs');
const path = require('path');

const INSTALL_DAEMON_PATH = path.join(__dirname, '../../install-daemon.ts');
const SHARED_DAEMON_BINARY = path.join(__dirname, '../../shared/daemon-binary.js');

describe('Bosun filesystem verification', () => {
  test('install-daemon.ts has no Bosun comments or logs', () => {
    const source = fs.readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/\/\/\s*Bosun/);
    expect(source).not.toMatch(/console\.warn\(.*bosun.*\)/);
  });

  test('shared/daemon-binary.js has no Bosun references', () => {
    const source = fs.readFileSync(SHARED_DAEMON_BINARY, 'utf8');
    expect(source).not.toMatch(/bosun|pd-bosun/i);
  });
});