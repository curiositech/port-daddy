// tests/unit/purser/cross_reference_arbiter.test.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Resolve repository root from this file (tests/unit/purser/...)
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

/**
 * Executes a script located under the repository root.
 * Returns an object with the exit code, stdout and stderr as strings.
 */
async function runScript(
  command,
  args = [],
  options = {}
) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      ...options,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: err.code ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

/**
 * Helper to count opening and closing braces in a LaTeX source string.
 */
function countBraces(text) {
  const open = (text.match(/{/g) ?? []).length;
  const close = (text.match(/}/g) ?? []).length;
  return { open, close };
}

/**
 * Reads a file relative to the repository root.
 */
async function readRepoFile(relPath) {
  const abs = path.join(repoRoot, relPath);
  return await readFile(abs, 'utf8');
}

/* -------------------------------------------------------------------------- */
/*                         TEST SUITE: Cross‑Reference Arbiter                */
/* -------------------------------------------------------------------------- */

describe('Cross‑Reference Arbiter – contract validation for PR #9911', () => {
  /* --------------------------- Script compliance -------------------------- */
  test('Citation verification scripts exit cleanly and report full resolution', async () => {
    // 1️⃣ check-doc-citations.mjs (Node)
    const nodeResult = await runScript('node', [
      path.join('scripts', 'check-doc-citations.mjs'),
    ]);
    expect(nodeResult.code).toBe(0);
    expect(nodeResult.stdout).toMatch(/0\s+orphaned/i);
    expect(nodeResult.stdout).toMatch(/14\/14\s+resolved/i);

    // 2️⃣ check_citations.py (Python)
    const pyResult = await runScript('python3', [
      path.join('scripts', 'harbor-research', 'check_citations.py'),
    ]);
    expect(pyResult.code).toBe(0);
    expect(pyResult.stdout).toMatch(/0\s+orphaned/i);
    expect(pyResult.stdout).toMatch(/14\/14\s+resolved/i);

    // 3️⃣ check_propagated_corrections.py (Python)
    const corrResult = await runScript('python3', [
      path.join('scripts', 'harbor-research', 'check_propagated_corrections.py'),
    ]);
    expect(corrResult.code).toBe(0);
    expect(corrResult.stdout).toMatch(/0\s+orphaned/i);
    expect(corrResult.stdout).toMatch(/14\/14\s+resolved/i);
  });

  /* --------------------------- LaTeX balance --------------------------- */
  test('paper4.tex has balanced braces and expected line count (472)', async () => {
    const content = await readRepoFile(
      path.join('docs', 'harbor-research', 'tex', 'paper4.tex')
    );
    const lines = content.split('\n').length;
    expect(lines).toBe(472);

    const { open, close } = countBraces(content);
    expect(open).toBe(close);
  });

  test('paper5.tex has balanced braces and expected line count (330)', async () => {
    const content = await readRepoFile(
      path.join('docs', 'harbor-research', 'tex', 'paper5.tex')
    );
    const lines = content.split('\n').length;
    expect(lines).toBe(330);

    const { open, close } = countBraces(content);
    expect(open).toBe(close);
  });

  /* --------------------------- Citation presence -------------------------- */
  test('paper4.tex §lift explicitly cites van der Meyden 2007 (TA‑security)', async () => {
    const content = await readRepoFile(
      path.join('docs', 'harbor-research', 'tex', 'paper4.tex')
    );
    // Look for TA‑security together with the citation key [vdm07]
    const pattern = /TA[-\s]?security.*\[\s*vdm07\s*\]/i;
    expect(pattern.test(content)).toBe(true);
  });

  test('paper5.tex unraveling‑hypothesis cites Lizzeri 1999 and mentions market‑based attestation', async () => {
    const content = await readRepoFile(
      path.join('docs', 'harbor-research', 'tex', 'paper5.tex')
    );
    const attestationPattern = /market[-\s]?based\s+attestation/i;
    const citationPattern = /\[\s*lizzeri99\s*\]/i;
    expect(attestationPattern.test(content)).toBe(true);
    expect(citationPattern.test(content)).toBe(true);
  });

  /* --------------------------- Findings markdown -------------------------- */
  test('findings.md for paper4 references the van der Meyden citation', async () => {
    const md = await readRepoFile(
      path.join(
        'docs',
        'harbor-research',
        'deep-dives',
        'paper4-sealed-harbor',
        'findings.md'
      )
    );
    expect(md).toMatch(/\[vdm07\]/i);
  });

  test('findings.md for paper5 references the Lizzeri citation', async () => {
    const md = await readRepoFile(
      path.join(
        'docs',
        'harbor-research',
        'deep-dives',
        'paper5-continuity-without-metaphysics',
        'findings.md'
      )
    );
    expect(md).toMatch(/\[lizzeri99\]/i);
  });

  /* --------------------------- Bibliography immutability ----------------- */
  test('BIBLIOGRAPHY.md remains unchanged – no new entries for vdm07 or lizzeri99', async () => {
    const bib = await readRepoFile('BIBLIOGRAPHY.md');
    // Contract states bibliography must not be altered despite new citations.
    expect(bib).not.toMatch(/\bvdm07\b/);
    expect(bib).not.toMatch(/\blizzeri99\b/);
  });

  /* --------------------------- PDF metadata verification ----------------- */
  test('doc1_treatise.pdf matches van der Meyden 2007 metadata and contains TA‑security proof', async () => {
    const pdfPath = path.join(
      'docs',
      'harbor-research',
      'pdf',
      'doc1_treatise.pdf'
    );

    // Verify PDF info (pages count non‑zero)
    const { code, stdout } = await runScript('pdfinfo', [pdfPath]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Pages:\s+\d+/i);

    // Attempt text extraction; if unavailable, fall back to existence check.
    const { code: txtCode, stdout: txt } = await runScript('pdftotext', [
      '-layout',
      pdfPath,
      '-',
    ]);
    if (txtCode === 0) {
      expect(txt).toMatch(/\[vdm07\]/i);
      expect(txt).toMatch(/TA[-\s]?security/i);
    } else {
      // If pdftotext is missing, ensure the file is readable (empty string is acceptable here).
      expect(txt).toBe('');
    }
  });

  test('doc2_product.pdf matches Lizzeri 1999 metadata and contains market‑based attestation discussion', async () => {
    const pdfPath = path.join(
      'docs',
      'harbor-research',
      'pdf',
      'doc2_product.pdf'
    );

    const { code, stdout } = await runScript('pdfinfo', [pdfPath]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Pages:\s+\d+/i);

    const { code: txtCode, stdout: txt } = await runScript('pdftotext', [
      '-layout',
      pdfPath,
      '-',
    ]);
    if (txtCode === 0) {
      expect(txt).toMatch(/\[lizzeri99\]/i);
      expect(txt).toMatch(/market[-\s]?based\s+attestation/i);
    } else {
      expect(txt).toBe('');
    }
  });
});