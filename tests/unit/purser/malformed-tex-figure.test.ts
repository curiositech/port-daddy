// tests/unit/purser/malformed-tex-figure.test.ts
import { spawnSync } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ES‑module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to execute the Python coverage checker
function runChecker(atlasPath: string, texRoot: string) {
  const scriptPath = resolve(
    __dirname,
    '../../skills/whitepaper-figure-system/scripts/check_atlas_coverage.py'
  );

  // Prefer python3, fall back to python if unavailable
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  return spawnSync(pythonCmd, [scriptPath, '--atlas', atlasPath, '--root', texRoot], {
    encoding: 'utf-8',
  });
}

// Minimal TeX source exercising custom macros and nested figures
const TEX_CONTENT = `
\\documentclass{article}
\\usepackage{graphicx}
% Custom macro that expands to a figure environment
\\newcommand{\\myfig}[1]{%
  \\begin{figure}
    \\centering
    \\includegraphics{#1}
    \\caption{Custom macro figure}
    \\label{fig:custom}
  \\end{figure}%
}
\\begin{document}
% Figure via custom macro
\\myfig{image1.png}

% Nested figure environments (outer contains inner)
\\begin{figure}
  \\centering
  \\includegraphics{image2.png}
  \\caption{Outer figure}
  \\label{fig:outer}
  \\begin{figure}
    \\centering
    \\includegraphics{image3.png}
    \\caption{Inner figure}
    \\label{fig:inner}
  \\end{figure}
\\end{figure}
\\end{document}
`;

// Helper to create a temporary workspace with given atlas entries
async function withTempWorkspace(
  atlasIds: string[],
  testFn: (atlasPath: string, texRoot: string) => void | Promise<void>
) {
  const workDir = await mkdtemp(join(tmpdir(), 'purser-test-'));
  try {
    // Write the TeX file
    const texRoot = join(workDir, 'tex');
    await writeFile(texRoot, TEX_CONTENT, 'utf-8');

    // Write a tiny atlas containing the supplied IDs (one per line)
    const atlasPath = join(workDir, 'atlas.md');
    const atlasContent = `# Test Semantic Figure Atlas\n${atlasIds.join('\n')}\n`;
    await writeFile(atlasPath, atlasContent, 'utf-8');

    await testFn(atlasPath, workDir);
  } finally {
    // Clean up the temporary directory recursively
    await rm(workDir, { recursive: true, force: true });
  }
}

describe('check_atlas_coverage.py – malformed / non‑standard figure handling', () => {
  test('recognises custom‑macro and nested figures when all IDs are present', async () => {
    const requiredIds = ['fig:custom', 'fig:outer', 'fig:inner'];
    await withTempWorkspace(requiredIds, (atlasPath, texRoot) => {
      const result = runChecker(atlasPath, texRoot);
      // The script should exit cleanly (code 0) and produce no error output
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  test('fails when an ID from a nested/custom figure is missing from the atlas', async () => {
    // Omit the inner‑figure ID on purpose
    const presentIds = ['fig:custom', 'fig:outer'];
    await withTempWorkspace(presentIds, (atlasPath, texRoot) => {
      const result = runChecker(atlasPath, texRoot);
      // Non‑zero exit status indicates drift detection
      expect(result.status).not.toBe(0);
      // The missing ID should be mentioned in stdout/stderr
      const output = (result.stdout ?? '') + (result.stderr ?? '');
      expect(output).toMatch(/fig:inner/);
    });
  });
});