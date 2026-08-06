const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../../');

describe('Bosun coverage verification', () => {
  test('rg -n -i bosun|pd-bosun returns zero matches', () => {
    try {
      execSync('rg -n -i "bosun|pd-bosun" install-daemon.ts', { cwd: REPO_ROOT });
      expect(true).toBe(false);
    } catch (e) {
      expect(e.status).toBe(1);
    }
  });

  test('no Bosun test cases in install-daemon-path.test.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../tests/unit/install-daemon-path.test.js'), 'utf8');
    expect(source).not.toMatch(/Bosun/);
  });

  test('no legacy Bosun commands in test files', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../tests/unit/no-legacy-bosun-command.test.js'), 'utf8');
    expect(source).not.toMatch(/install-bosun/);
  });
});