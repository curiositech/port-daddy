// tests/unit/purser/pdf_rendering_checks.test.ts
/**
 * Unit tests for the PDF rendering integrity checks performed by
 * `scripts/harbor-research/run_pdf_checks.py`.
 *
 * The contract (see PR #10097) requires the CI job to:
 *   • Detect margin‑collision via baseline comparison,
 *   • Detect off‑paper text by rebasing coordinates against an enlarged mediabox,
 *   • Detect footer intrusions (type‑over‑artwork).
 *
 * These tests run the Python script against fixture PDFs that each trigger one
 * of the three failure modes, plus a clean PDF for the happy‑path.
 *
 * The repository uses Jest with ESM (`type: "module"`), so `__dirname` is not
 * available. We derive it from `import.meta.url`.
 */

import { execFile } from 'child_process';
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
} from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Derive __dirname in an ESM context.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Executes the PDF‑check script.
 *
 * @param pdfDir   Directory containing the PDF(s) to inspect.
 * @param expectCount Optional expected number of pages (passed through `--expect`).
 * @returns Promise resolving to the exit code, stdout and stderr.
 */
function runPdfChecks(
  pdfDir: string,
  expectCount?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const scriptPath = resolve(
      __dirname,
      '../../../scripts/harbor-research/run_pdf_checks.py',
    );

    const args = [scriptPath, '--pdf-dir', pdfDir];
    if (expectCount !== undefined) {
      args.push('--expect', String(expectCount));
    }

    execFile('python3', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      // When the process exits non‑zero, `error` is an instance of `Error`
      // with a `code` property (the exit status). Otherwise it is `null`.
      const code = error && typeof (error as any).code === 'number'
        ? (error as any).code
        : 0;
      resolvePromise({ code, stdout, stderr });
    });
  });
}

// Path to the PDF fixtures shipped with the repository.
const fixturesDir = resolve(
  __dirname,
  '../../../tests/harbor-research/fixtures',
);

describe('PDF rendering integrity checks (run_pdf_checks.py)', () => {
  // Helper to create a temporary directory, copy a fixture PDF in, run the checks,
  // and then clean up the temp folder.
  async function withTempPdf(
    fixtureName: string,
    expectCount?: number,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const tmpDir = mkdtempSync(resolve(os.tmpdir(), `pdf-test-${fixtureName}-`));
    const src = resolve(fixturesDir, fixtureName);
    const dst = resolve(tmpDir, fixtureName);
    copyFileSync(src, dst);
    try {
      return await runPdfChecks(tmpDir, expectCount);
    } finally {
      // Ensure the temporary directory is removed even if the test fails.
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // Happy‑path: a well‑formed PDF should pass with exit code 0.
  // -------------------------------------------------------------------------
  test('passes a clean PDF without reporting any errors', async () => {
    const result = await withTempPdf('clean.pdf');
    expect(result.code).toBe(0);
    // The script prints a short summary; ensure no failure keywords appear.
    expect(result.stdout).not.toMatch(/error|fail|margin|off[- ]paper|footer/i);
  });

  // -------------------------------------------------------------------------
  // Margin collision detection (baseline comparison).
  // -------------------------------------------------------------------------
  test('detects margin‑collision via baseline comparison', async () => {
    const result = await withTempPdf('margin_collision.pdf');
    expect(result.code).not.toBe(0);
    // The script tags the finding with “margin” in its message.
    expect(result.stdout).toMatch(/margin.*collision/i);
  });

  // -------------------------------------------------------------------------
  // Off‑paper text detection (mediabox rebasing).
  // -------------------------------------------------------------------------
  test('detects off‑paper text by rebasing mediabox coordinates', async () => {
    const result = await withTempPdf('off_paper_text.pdf');
    expect(result.code).not.toBe(0);
    // The script reports “off‑paper” or “outside” in its diagnostic.
    expect(result.stdout).toMatch(/off[- ]paper|outside.*page/i);
  });

  // -------------------------------------------------------------------------
  // Footer intrusion detection (type over artwork).
  // -------------------------------------------------------------------------
  test('detects footer intrusion where type overlaps the printed footer', async () => {
    const result = await withTempPdf('footer_intrusion.pdf');
    expect(result.code).not.toBe(0);
    // The script includes “footer” in its output for this condition.
    expect(result.stdout).toMatch(/footer.*intrusion/i);
  });
});