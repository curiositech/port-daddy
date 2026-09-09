/**
 * tests/unit/purser/kernel-integration-content-coverage.test.ts
 *
 * This test validates that the “What it buys” placement of the Assurance Ladder
 * in the Single‑Writer Kernel chapter satisfies the contractual obligations:
 *
 * 1️⃣ Empirical reference verification – the five assurance modes are linked
 *    to Sheridan’s automation levels and the Common Criteria EALs via citations
 *    and bibliography aliases.
 *
 * 2️⃣ Theoretical differentiation – the ladder’s work‑factor semantics are
 *    distinguished from automation‑level and evaluation‑effort metrics.
 *
 * 3️⃣ Placement integration – the placement appears in the kernel chapter’s
 *    “What it buys” discussion and contains the required prose.
 *
 * 4️⃣ Documentation consistency – the justification wording is present verbatim.
 *
 * The test reads the relevant LaTeX source files directly from the repository
 * and checks for the presence of key strings and patterns.  It fails if any
 * required element is missing, thereby “grilling” the PR against the best‑case
 * interpretation of the contract.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Resolve the repository root (three levels up from this test file)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Paths to the relevant source files
const kernelPath = join(repoRoot, 'whitepaper', 'single-writer-kernel.tex');
const citeShortformsPath = join(
  repoRoot,
  'whitepaper',
  'figures',
  'pd-cite-shortforms.tex',
);

// Load file contents as UTF‑8 strings
const kernelContent = readFileSync(kernelPath, 'utf8');
const citeContent = readFileSync(citeShortformsPath, 'utf8');

// Normalise line endings for deterministic string checks
const normalize = (s: string) => s.replace(/\r\n/g, '\n');

const k = normalize(kernelContent);
const c = normalize(citeContent);

describe('Assurance Ladder placement in the Single‑Writer Kernel chapter', () => {
  /** 1️⃣ Empirical reference verification */
  test('cites Sheridan, Parasuraman and the Common Criteria', () => {
    // Combined citation referencing Sheridan/Verplank (1978) and Parasuraman (2000)
    expect(k).toContain('\\pdcite{sheridanverplank1978,parasuraman2000}');

    // Reference to the ISO/IEC Common Criteria entry
    expect(k).toContain('\\pdref{cciso15408}{ISO/IEC 15408-1:2022}');

    // Bibliography must be hooked up so the above citations resolve
    expect(k).toMatch(/\\bibliography\{[^}]*pd-bibliography[^}]*\}/);
  });

  /** 2️⃣ Theoretical differentiation – adversary work‑factor phrasing */
  test('explicitly states the ladder measures an adversary work‑factor', () => {
    const phrase =
      "That is an adversary's work factor, per mechanism, at run time";
    expect(k).toContain(phrase);
  });

  /** 3️⃣ Placement integration – required pdassurance tokens and examples */
  test('includes the five assurance‑mode tokens with concrete examples', () => {
    // All five tokens must appear at least once
    const tokens = ['Observed', 'Coordinated', 'Brokered', 'Confined', 'Attested'];
    tokens.forEach(tok => {
      expect(k).toContain(`\\pdassurance{${tok}}`);
    });

    // Concrete cross‑framework examples tying tokens to Sheridan levels/EALs
    expect(k).toContain('Sheridan level~10');
    expect(k).toContain('\\pdassurance{Observed}');
    expect(k).toContain('level~3');
    expect(k).toContain('\\pdassurance{Attested}');
    expect(k).toContain('EAL7');
    expect(k).toContain('unevaluated');
  });

  /** 4️⃣ Documentation consistency – boundary definition wording */
  test('contains the ladder boundary paragraph with exact required wording', () => {
    // Opening of the boundary macro
    expect(k).toContain(
      '\\pdboundary{The ladder is a design vocabulary, not a measured scale.',
    );

    // Verbatim fragments for each rung
    const rungFragments = [
      'nothing at \\pdassurance{Observed}',
      "client's willingness to declare at \\pdassurance{Coordinated}",
      'daemon‑owned broker at \\pdassurance{Brokered}',
      'operating system at \\pdassurance{Confined}',
      'measured environment and a conditional key release at \\pdassurance{Attested}',
    ];
    rungFragments.forEach(fragment => {
      expect(k).toContain(fragment);
    });
  });

  /** 5️⃣ Section location – “What it buys” discussion */
  test('the placement lives inside the “What it buys” discussion', () => {
    // The literal phrase should appear somewhere in the file (heading or body)
    expect(k).toMatch(/What it buys/);
  });

  /** 6️⃣ Citation‑alias definitions in pd‑cite‑shortforms.tex */
  test('pd‑cite‑shortforms defines the required citation aliases', () => {
    // Alias for Sheridan & Verplank (1978)
    expect(c).toMatch(
      /\\defcitealias\{sheridanverplank1978\}\{[^}]+\}/,
    );
    // Alias for Parasuraman (2000)
    expect(c).toMatch(
      /\\defcitealias\{parasuraman2000\}\{[^}]+\}/,
    );
    // Alias for the Common Criteria ISO/IEC entry
    expect(c).toMatch(
      /\\defcitealias\{cciso15408\}\{[^}]+\}/,
    );
  });
});