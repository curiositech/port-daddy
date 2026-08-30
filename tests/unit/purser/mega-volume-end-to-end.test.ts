// tests/unit/purser/mega-volume-end-to-end.test.ts
import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse';

/**
 * Resolve the repository root from this file's location.
 * The test lives at <repo>/tests/unit/purser/mega-volume-end-to-end.test.ts
 */
const repoRoot = resolve(
  fileURLToPath(import.meta.url),
  '../../..',
);

/**
 * Paths that the build scripts operate on.
 */
const generateScript = join(repoRoot, 'scripts', 'generate-mega-whitepaper.mjs');
const buildScript = join(repoRoot, 'scripts', 'build-whitepapers.sh');
const referencePdf = join(
  repoRoot,
  'website-v2',
  'public',
  'whitepaper',
  'coordination-papers-mega-volume.pdf',
);

/**
 * Helper: compute SHA‑256 hex digest of a file.
 */
function sha256Hex(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Helper: obtain the number of pages in a PDF using `pdf-parse`.
 */
async function pdfPageCount(filePath: string): Promise<number> {
  const data = await pdfParse(readFileSync(filePath));
  return data.numpages;
}

/**
 * Run the full generation + build pipeline inside a temporary directory.
 * The scripts write the final PDF to the repository's public folder; we
 * copy that artefact into the temporary directory so the test can examine
 * it without polluting the source tree.
 */
function buildMegaVolume(tempDir: string): string {
  // 1️⃣ Generate the mega‑volume TeX source.
  execSync(`node ${generateScript}`, {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  // 2️⃣ Compile the TeX into a PDF.
  execSync(`bash ${buildScript}`, {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  // 3️⃣ Verify the PDF exists where the build script should have placed it.
  if (!existsSync(referencePdf)) {
    throw new Error(
      `Expected PDF not found after build: ${referencePdf}`,
    );
  }

  // 4️⃣ Copy the produced PDF into the isolated temporary directory.
  const destPdf = join(tempDir, 'coordination-papers-mega-volume.pdf');
  cpSync(referencePdf, destPdf);
  return destPdf;
}

describe('Mega‑volume end‑to‑end build', () => {
  // Create a temporary sandbox for the test run.
  const tempRoot = mkdtempSync(join(tmpdir(), 'mega-volume-e2e-'));

  afterAll(() => {
    // Clean up the temporary directory regardless of test outcome.
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('produces a PDF with the exact page count and SHA‑256 hash', async () => {
    // --------------------------------------------------------------------
    // Expected artefacts – derived from the repository‑bundled reference PDF.
    // --------------------------------------------------------------------
    const expectedPageCount = await pdfPageCount(referencePdf);
    const expectedSha = sha256Hex(referencePdf);

    // --------------------------------------------------------------------
    // Run the production pipeline and capture the generated artefact.
    // --------------------------------------------------------------------
    const generatedPdf = buildMegaVolume(tempRoot);

    // Sanity‑check that the file was indeed written.
    expect(existsSync(generatedPdf)).toBe(true);

    // --------------------------------------------------------------------
    // Validate the generated PDF against the reference expectations.
    // --------------------------------------------------------------------
    const actualPageCount = await pdfPageCount(generatedPdf);
    const actualSha = sha256Hex(generatedPdf);

    expect(actualPageCount).toBe(
      expectedPageCount,
      `PDF page count mismatch (expected ${expectedPageCount}, got ${actualPageCount})`,
    );

    expect(actualSha).toBe(
      expectedSha,
      `PDF SHA‑256 hash mismatch (expected ${expectedSha}, got ${actualSha})`,
    );
  });
});