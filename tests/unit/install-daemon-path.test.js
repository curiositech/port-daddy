import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('daemon installer service PATH', () => {
  test('keeps the Codex app CLI visible to the macOS LaunchAgent', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    expect(source).toContain('/Applications/Codex.app/Contents/Resources');
    expect(source).toContain('servicePath(dirname(TSX_PATH), dirname(NODE_PATH))');
  });
});
