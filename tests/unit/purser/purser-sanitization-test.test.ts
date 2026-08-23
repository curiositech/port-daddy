// tests/unit/purser/purser-sanitization-test.test.ts
//
// Obligation 2 of the #9764 contract: an UNFENCED model response is accepted
// as an authored test file only when it BEGINS like a source file. A body-wide
// scan alone is defeatable from the inside — chain-of-thought quotes the very
// `import` lines and `expect(...)` calls it is drafting — which is how two
// live #9370 runs committed deliberation transcripts as .test.ts files.
import {
  extractCodeFence,
  startsLikeSource,
} from '../../../apps/fleet-executor/src/purser-authoring.ts';

describe('unfenced authoring fallback: first-line source gate', () => {
  const deliberation = [
    'We need to write a test file that verifies the citation audit.',
    "The file should start with import { auditFindings } from './citation-audit.js';",
    'and then assert expect(result.audited).toBe(false); for the null-tree case.',
  ].join('\n');

  it('premise: the deliberation quotes enough code to pass a body-wide scan', () => {
    // These are exactly the signals a whole-body scan hunts for, carried
    // INSIDE prose — so only the first-line gate can tell this apart from a
    // real file.
    expect(/\bexpect\s*\(/.test(deliberation)).toBe(true);
    expect(deliberation).toContain('import {');
    expect(deliberation.startsWith('We need')).toBe(true);
  });

  it('rejects unfenced chain-of-thought that quotes code from the inside', () => {
    expect(startsLikeSource(deliberation)).toBe(false);
    expect(extractCodeFence(deliberation)).toBeNull();
  });

  it('accepts a real unfenced source file', () => {
    const source = [
      "import { readFileSync } from 'node:fs';",
      '',
      'export function loadFixture(path: string): string {',
      "  return readFileSync(path, 'utf8');",
      '}',
    ].join('\n');
    expect(startsLikeSource(source)).toBe(true);
    expect(extractCodeFence(source)).toBe(source);
  });

  it('first-line gate: comment and declaration openers pass, narration fails', () => {
    expect(startsLikeSource('// pinned regression for the citation audit\nconst x = 1;')).toBe(true);
    expect(startsLikeSource('const findings = [];\nexport default findings;')).toBe(true);
    expect(startsLikeSource('First, let us think about what the test needs.')).toBe(false);
  });
});
