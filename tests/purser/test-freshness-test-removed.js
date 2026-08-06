import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const CLI_FRESHNESS_TEST = join(__dirname, '../../tests/unit/cli-freshness.test.js');

describe('freshness test removal verification', () => {
  test('should not contain install-bosun freshness check test', () => {
    const content = readFileSync(CLI_FRESHNESS_TEST, 'utf-8');
    expect(content).not.toContain("'skips freshness checks for install-bosun'");
    expect(content).not.toContain('Homebrew');
  });
});