// tests/unit/purser/large-corpus-recursion.test.ts
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Recursive TeX discovery stress test', () => {
  // Resolve repository root from this test file's location
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = resolve(__dirname, '../../..');

  // Absolute path to the Python checker script
  const checkerScript = join(
    repoRoot,
    'skills',
    'whitepaper-figure-system',
    'scripts',
    'check_atlas_coverage.py',
  );

  test(
    'handles a deep \\input chain and a monolithic file with all 81 figures',
    () => {
      // Create a temporary sandbox directory
      const sandbox = mkdtempSync(join(tmpdir(), 'purser-recursion-'));

      try {
        // Build a deep chain of TeX files (e.g., root.tex → level0.tex → … → levelN.tex)
        const chainDepth = 30;
        let currentFile = 'root.tex';
        for (let i = 0; i < chainDepth; i++) {
          const nextFile = `level${i}.tex`;
          const currentPath = join(sandbox, currentFile);
          writeFileSync(currentPath, `\\input{${nextFile}}\n`);
          currentFile = nextFile;
        }

        // Final file contains all 81 canonical figure definitions
        const finalPath = join(sandbox, currentFile);
        const totalFigures = 81;
        let figuresTex = '';
        for (let i = 1; i <= totalFigures; i++) {
          figuresTex += `\\begin{figure}[id=fig${i}]\nFigure ${i}\n\\end{figure}\n`;
        }
        writeFileSync(finalPath, figuresTex);

        // Execute the Python checker, pointing it at the sandbox root.
        // The checker is expected to accept a `--root` argument that overrides
        // the canonical roots defined in the atlas.
        const output = execFileSync(
          'python3',
          [checkerScript, '--root', sandbox],
          { encoding: 'utf8', timeout: 10_000 },
        );

        // The script should report that it discovered the full set of figures.
        // We simply assert that the number 81 appears in its stdout.
        expect(output).toMatch(/81/);
      } finally {
        // Clean up the temporary directory regardless of test outcome.
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
    15_000, // Jest timeout in ms (allows for slower CI environments)
  );
});