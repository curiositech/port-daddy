import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('shared/code-hash', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pd-code-hash-'));
    mkdirSync(join(tempDir, 'lib'));
    mkdirSync(join(tempDir, 'routes'));
    mkdirSync(join(tempDir, 'shared'));
    mkdirSync(join(tempDir, 'routes', 'nested'));
    writeFileSync(join(tempDir, 'server.ts'), 'export const server = 1;\n');
    writeFileSync(join(tempDir, 'lib', 'alpha.ts'), 'export const alpha = 1;\n');
    writeFileSync(join(tempDir, 'routes', 'beta.ts'), 'export const beta = 1;\n');
    writeFileSync(join(tempDir, 'routes', 'nested', 'gamma.ts'), 'export const gamma = 1;\n');
    writeFileSync(join(tempDir, 'shared', 'delta.ts'), 'export const delta = 1;\n');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('changes when route or shared runtime files change', async () => {
    const { calculateRuntimeCodeHash } = await import('../../shared/code-hash.js');

    const before = calculateRuntimeCodeHash(tempDir);
    writeFileSync(join(tempDir, 'routes', 'beta.ts'), 'export const beta = 2;\n');
    const afterRouteChange = calculateRuntimeCodeHash(tempDir);
    expect(afterRouteChange).not.toBe(before);

    writeFileSync(join(tempDir, 'shared', 'delta.ts'), 'export const delta = 3;\n');
    const afterSharedChange = calculateRuntimeCodeHash(tempDir);
    expect(afterSharedChange).not.toBe(afterRouteChange);
  });

  test('lists runtime source files recursively and ignores unrelated files', async () => {
    const { listRuntimeSourceFiles } = await import('../../shared/code-hash.js');

    writeFileSync(join(tempDir, 'README.md'), '# ignored\n');
    const files = listRuntimeSourceFiles(tempDir);
    expect(files).toEqual([
      'lib/alpha.ts',
      'routes/beta.ts',
      'routes/nested/gamma.ts',
      'server.ts',
      'shared/delta.ts',
    ]);
  });
});
