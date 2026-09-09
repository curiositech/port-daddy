// tests/unit/purser/explicit-justification-strawman.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve the LaTeX source files that should contain the required prose.
const kernelPath = fileURLToPath(
  new URL('../../../whitepaper/single-writer-kernel.tex', import.meta.url),
);
const pedagogyPath = fileURLToPath(
  new URL('../../../whitepaper/figures/pd-pedagogy.tex', import.meta.url),
);

// Load the files as UTF‑8 strings. If the files cannot be read the test suite will
// fail immediately, signalling a repository‑structure problem.
const kernelTex = readFileSync(kernelPath, 'utf8');
const pedagogyTex = readFileSync(pedagogyPath, 'utf8');

/**
 * Helper that performs a case‑insensitive substring check and produces a helpful
 * Jest assertion message.
 */
function expectToContain(
  source: string,
  substring: string,
  sourceLabel: string,
) {
  const normalizedSource = source.toLowerCase();
  const normalizedSub = substring.toLowerCase();
  expect(normalizedSource).toContain(
    normalizedSub,
    `${sourceLabel} must contain the exact phrase "${substring}"`,
  );
}

describe('Assurance Ladder documentation integrity', () => {
  test('explicit justification phrase is present in the kernel whitepaper', () => {
    // Contract requirement: the prose must state the justification
    // “nothing at Observed, a client's willingness at Coordinated…”.
    const phrase =
      "nothing at Observed, a client's willingness at Coordinated";
    expectToContain(kernelTex, phrase, 'single-writer-kernel.tex');
  });

  test('the kernel whitepaper references Sheridan and Common Criteria', () => {
    // Both frameworks must be mentioned explicitly.
    expect(kernelTex).toMatch(
      /Sheridan/i,
      'single-writer-kernel.tex must mention Sheridan',
    );
    expect(kernelTex).toMatch(
      /Common Criteria/i,
      'single-writer-kernel.tex must mention Common Criteria',
    );
  });

  test('the kernel whitepaper enumerates the five assurance ladder modes', () => {
    // The five modes are expected to be listed by name; we check for each.
    const modes = [
      'Observed',
      'Coordinated',
      'Managed',
      'Assured',
      'Verified',
    ];
    for (const mode of modes) {
      expectToContain(
        kernelTex,
        mode,
        `single-writer-kernel.tex (assurance mode "${mode}")`,
      );
    }
  });

  test('the pedagogy figure reinforces the same justification', () => {
    const phrase =
      "nothing at Observed, a client's willingness at Coordinated";
    expectToContain(pedagogyTex, phrase, 'pd-pedagogy.tex');
    // Also ensure the figure mentions the two external frameworks.
    expect(pedagogyTex).toMatch(
      /Sheridan/i,
      'pd-pedagogy.tex must mention Sheridan',
    );
    expect(pedagogyTex).toMatch(
      /Common Criteria/i,
      'pd-pedagogy.tex must mention Common Criteria',
    );
  });
});