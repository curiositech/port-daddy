import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const NO_LEGACY_BOSUN_TEST = join(__dirname, '../../tests/unit/no-legacy-bosun-command.test.js');

describe('public CLI surface inspection', () => {
  test('should include daemon.ts and freshness.ts in inspection surface', () => {
    const content = readFileSync(NO_LEGACY_BOSUN_TEST, 'utf-8');
    expect(content).toContain("'cli/commands/daemon.ts'");
    expect(content).toContain("'cli/utils/freshness.ts'");
  });
});