// tests/unit/purser/epistemic-semantic-alignment.test.ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/**
 * Resolve a path relative to the repository root.
 * The test file lives in <repo>/tests/unit/purser/, so three `..` get us to the root.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/* -------------------------------------------------------------------------- */
/* Helper utilities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Load a text file as a UTF‑8 string.
 */
async function loadText(relativePath: string): Promise<string> {
  const abs = resolve(repoRoot, relativePath);
  return await readFile(abs, { encoding: 'utf8' });
}

/**
 * Parse the mega‑volume manifest (YAML) and extract an ordered list of chapter
 * titles. The manifest is expected to contain a top‑level `chapters` array,
 * where each entry has a `title` property (string). If the shape differs we
 * fall back to a best‑effort extraction from the editorial architecture.
 */
async function extractChapterTitles(): Promise<string[]> {
  const manifestRaw = await loadText('docs/harbor-research/mega-volume-epistemic-manifest.yaml');
  const manifest = yaml.load(manifestRaw) as Record<string, unknown>;

  // Preferred shape: { chapters: [{ title: "…" }, …] }
  if (Array.isArray((manifest as any).chapters)) {
    return (manifest as any).chapters
      .map((c: any) => c?.title)
      .filter((t: any) => typeof t === 'string') as string[];
  }

  // Fallback: pull headings from the editorial architecture markdown.
  const archRaw = await loadText('docs/harbor-research/mega-volume-editorial-architecture.md');
  const headingLines = archRaw.split('\n').filter(l => l.startsWith('#'));
  // Strip leading # characters and trim.
  return headingLines.map(l => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
}

/**
 * Normalise a LaTeX macro call for comparison – collapse whitespace inside
 * braces and trim surrounding spaces.
 */
function normaliseMacroCall(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Test suite                                                                  */
/* -------------------------------------------------------------------------- */

describe('Epistemic‑semantic alignment of the mega‑volume', () => {
  let chapterTitles: string[];
  let rootTex: string;
  let buildScript: string;

  beforeAll(async () => {
    // Load everything once – Jest will run the suite in a single process.
    chapterTitles = await extractChapterTitles();
    rootTex = await loadText('website-v2/public/whitepaper/coordination-papers-mega-volume.tex');
    buildScript = await loadText('scripts/build-whitepapers.sh');
  });

  test('manifest‑derived chapters appear with opening and handoff macros in the generated LaTeX', () => {
    expect(chapterTitles.length).toBeGreaterThan(
      0,
      'The manifest (or architecture) should define at least one chapter.'
    );

    for (const title of chapterTitles) {
      const opening = `\\pdchapteropening{${title}}`;
      const handoff = `\\pdchapterhandoff{${title}}`;

      const hasOpening = rootTex.includes(opening);
      const hasHandOff = rootTex.includes(handoff);

      expect(hasOpening).toBe(
        true,
        `Missing opening macro for chapter “${title}”. Expected LaTeX to contain: ${opening}`
      );
      expect(hasHandOff).toBe(
        true,
        `Missing handoff macro for chapter “${title}”. Expected LaTeX to contain: ${handoff}`
      );
    }
  });

  test('the LaTeX output does not contain the stripped editorial‑plate validation', () => {
    const forbidden = '\\validateEditorialPlate';
    expect(rootTex.includes(forbidden)).toBe(
      false,
      `Found forbidden macro ${forbidden} – the generator must strip validateEditorialPlate logic.`
    );
  });

  test('the root LaTeX file inputs the seams file and excludes jacket/inside‑jacket/coda art', async () => {
    // Ensure the seams tex is explicitly included.
    const seamsInclude = '\\input{coordination-papers-mega-volume-seams.tex}';
    expect(rootTex.includes(seamsInclude)).toBe(
      true,
      `Root LaTeX should include the seams file via \\input. Expected line: ${seamsInclude}`
    );

    // The build script must not list the excluded artefacts.
    const excludedPatterns = ['jacket', 'inside-jacket', 'coda-art', 'coda_art', 'codaArt'];
    for (const pat of excludedPatterns) {
      expect(buildScript).not.toMatch(
        new RegExp(pat, 'i'),
        `build-whitepapers.sh must not reference "${pat}" – those artefacts are excluded by contract.`
      );
    }

    // The build script should reference the seams tex.
    expect(buildScript).toMatch(
      /coordination-papers-mega-volume-seams\.tex/,
      'build-whitepapers.sh should load coordination-papers-mega-volume-seams.tex as per contract.'
    );
  });

  test('the generated PDF (if present) matches the expected page count', async () => {
    // This test is defensive – the PDF may not be built in CI, but if it exists
    // we can check its page count via the `pdfinfo` CLI (which ships with poppler).
    const pdfPath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf');

    // Attempt to read the file; if it does not exist we skip the assertion.
    try {
      await readFile(pdfPath);
    } catch {
      // PDF not generated in this environment – consider the test passed.
      return;
    }

    // Spawn a child process to query page count.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = await import('node:child_process');
    const execPromise = (cmd: string, args: string[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(cmd, args, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      });

    const { stdout } = await execPromise('pdfinfo', [pdfPath]);
    const match = stdout.match(/Pages:\s+(\d+)/);
    const pages = match ? parseInt(match[1], 10) : null;

    expect(pages).toBe(
      270,
      `The mega‑volume PDF must be exactly 270 pages; got ${pages ?? 'unknown'}.`
    );
  });
});