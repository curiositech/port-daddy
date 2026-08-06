import { execSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_EXECUTABLE = join(__dirname, '../../bin/port-daddy-cli.ts');

describe('install-bosun command not found', () => {
  test('should throw error when invoking install-bosun', () => {
    expect(() => {
      execSync(`node ${CLI_EXECUTABLE} install-bosun`, { stdio: 'pipe' });
    }).toThrow();
  });
});