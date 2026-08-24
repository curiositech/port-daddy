// tests/unit/purser/audit-citation-line-numbers.test.ts
//
// Obligation 4 of the #9764 contract, line-suffix half: a citation may carry
// `path:NN` or `path:NN-MM`; the audit strips the suffix before checking the
// tree, so a real file cited with a line number never reads as fabricated,
// while a fabricated path stays missing no matter what line it claims.
import {
  auditCitation,
  bareCitedPath,
  isPathShaped,
  type CitationEvidence,
} from '../../../apps/fleet-executor/src/citation-audit.ts';

const evidence: CitationEvidence = {
  treePaths: new Set<string>([
    'apps/fleet-executor/src/citation-audit.ts',
    'scripts/check-doc-citations.mjs',
  ]),
  changedPaths: new Set<string>(['docs/release-notes.md']),
};

describe('line-number suffixes in citations', () => {
  it('bareCitedPath strips :NN and :NN-MM, and leaves a bare path alone', () => {
    expect(bareCitedPath('apps/fleet-executor/src/citation-audit.ts:42')).toBe(
      'apps/fleet-executor/src/citation-audit.ts',
    );
    expect(bareCitedPath('apps/fleet-executor/src/citation-audit.ts:42-60')).toBe(
      'apps/fleet-executor/src/citation-audit.ts',
    );
    expect(bareCitedPath('apps/fleet-executor/src/citation-audit.ts')).toBe(
      'apps/fleet-executor/src/citation-audit.ts',
    );
  });

  it('a real path cited with a line number audits as real', () => {
    expect(auditCitation('apps/fleet-executor/src/citation-audit.ts:120', evidence)).toBe('real');
    expect(auditCitation('scripts/check-doc-citations.mjs:5-9', evidence)).toBe('real');
  });

  it('a changed file is trusted even when absent from the tree set', () => {
    // premise: the tree set genuinely lacks it — trust must come from changedPaths
    expect(evidence.treePaths!.has('docs/release-notes.md')).toBe(false);
    expect(auditCitation('docs/release-notes.md:3', evidence)).toBe('real');
  });

  it('a fabricated path stays missing regardless of its line suffix', () => {
    // premises: both are path-shaped, so they are in scope for the audit
    expect(isPathShaped('csp-validator.ts')).toBe(true);
    expect(isPathShaped('cli/visibility.py:12')).toBe(true);
    // literal fabricated paths from the 2026-08-23 fleet audit
    expect(auditCitation('csp-validator.ts', evidence)).toBe('missing');
    expect(auditCitation('cli/visibility.py:12', evidence)).toBe('missing');
  });

  it('prose concepts and suffix edge cases stay out of scope, failing open', () => {
    // premise: spaces make a concept not path-shaped
    expect(isPathShaped('the scope-honesty section')).toBe(false);
    expect(auditCitation('the scope-honesty section', evidence)).toBe('not-a-path');
    // Boundary pin: a slashless filename WITH a line suffix no longer ends in
    // its extension, so isPathShaped declines it and the audit returns
    // not-a-path — out of scope, kept, fail-open — rather than guessing.
    expect(isPathShaped('csp-validator.ts:88')).toBe(false);
    expect(auditCitation('csp-validator.ts:88', evidence)).toBe('not-a-path');
  });
});
