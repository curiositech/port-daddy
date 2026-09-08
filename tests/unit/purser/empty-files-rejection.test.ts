// the complete contents of tests/unit/purser/empty-files-rejection.test.ts
import { jest } from '@jest/globals';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('empty --files rejection', () => {
  // Path to the project root from this test file
  const ROOT = join(import.meta.dirname, '..', '..', '..');

  // Mock process.exit so that if any code calls it we get an exception
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code}) called`);
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  test('handleBegin throws error with exact message and does not call process.exit', async () => {
    const { handleBegin } = await import('../../../cli/commands/sugar.js');
    await expect(handleBegin('x', [], { files: [] })).rejects.toThrow(
      '--files requires at least one path',
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('CLI exits with code 1 when invoked with empty --files', () => {
    const result = spawnSync(process.execPath, [
      join(ROOT, 'bin/port-daddy-cli.js'),
      'begin',
      'x',
      '--files',
      '',
    ], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        CI: '1',
        PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
        NO_COLOR: '1',
        PORT_DADDY_URL: 'http://127.0.0.1:1',
      },
    });

    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/--files requires at least one path/);
  });
});