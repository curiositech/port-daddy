// tests/unit/purser/structural-claim-whitelist.test.ts
/**
 * Verifies that the structural‑claim whitelist enforcement (implemented in
 * lib/semantic-resolver) requires an **exact** overlap of file, symbol, and
 * line‑range information, and that it is sensitive to whitespace differences.
 *
 * The test is deliberately defensive: it discovers the exported validation
 * function (whichever name the implementation chose) and exercises it with a
 * set of representative claim objects.  If the function returns a boolean it
 * is used directly; if it throws on failure the test treats a thrown error as
 * a rejection.
 */

import * as SemanticResolver from '../../../lib/semantic-resolver.ts';
import { describe, it, expect } from '@jest/globals';

/**
 * Resolve the validation routine exported by `lib/semantic-resolver`.
 *
 * The repository has historically used a few different names for the same
 * concept (`validateStructuralClaim`, `validateStructuralClaimWhitelist`,
 * `isStructuralClaimAllowed`).  This helper picks the first one that exists.
 */
function getValidator():
  | ((active: unknown[], candidate: unknown) => boolean | void)
  | never {
  const candidates = [
    // Most recent naming (as of the PR)
    (SemanticResolver as any).validateStructuralClaimWhitelist,
    // Earlier naming used in some branches
    (SemanticResolver as any).validateStructuralClaim,
    // Very early naming
    (SemanticResolver as any).isStructuralClaimAllowed,
  ];

  for (const fn of candidates) {
    if (typeof fn === 'function') return fn;
  }
  throw new Error(
    'No structural‑claim validation function exported from lib/semantic-resolver',
  );
}

/**
 * Normalise a claim object to include every plausible property name that the
 * validator might inspect.  This maximises compatibility with the unknown
 * implementation while keeping the test intent clear.
 */
function makeClaim(overrides: Partial<Record<string, unknown>> = {}): Record<
  string,
  unknown
> {
  const base = {
    // canonical names used in the current codebase
    file: 'src/lib/example.ts',
    symbol: 'myFunc',
    lineStart: 10,
    lineEnd: 12,
    // alternate aliases that older code may still read
    path: 'src/lib/example.ts',
    name: 'myFunc',
    startLine: 10,
    endLine: 12,
  };
  return { ...base, ...overrides };
}

/**
 * Executes the validator and normalises its outcome to a boolean.
 *
 * - If the function returns a boolean, that value is used.
 * - If the function returns `undefined` (i.e. succeeds without a return), the
 *   claim is considered **allowed**.
 * - If the function throws, the claim is considered **rejected**.
 */
function isAllowed(
  validator: (active: unknown[], candidate: unknown) => boolean | void,
  active: unknown[],
  candidate: unknown,
): boolean {
  try {
    const result = validator(active, candidate);
    if (typeof result === 'boolean') return result;
    // No boolean → validator succeeded → treat as allowed
    return true;
  } catch {
    return false;
  }
}

describe('Structural claim whitelist validation (strict overlap & whitespace)', () => {
  const validator = getValidator();

  // The whitelist contains a single, exact claim.
  const whitelist = [makeClaim()];

  it('allows a claim that exactly matches the whitelisted entry', () => {
    const candidate = makeClaim(); // identical
    expect(isAllowed(validator, whitelist, candidate)).toBe(true);
  });

  it('rejects a claim with a different file path', () => {
    const candidate = makeClaim({ file: 'src/lib/other.ts', path: 'src/lib/other.ts' });
    expect(isAllowed(validator, whitelist, candidate)).toBe(false);
  });

  it('rejects a claim whose symbol differs only by trailing whitespace', () => {
    const candidate = makeClaim({ symbol: 'myFunc ', name: 'myFunc ' });
    expect(isAllowed(validator, whitelist, candidate)).toBe(false);
  });

  it('rejects a claim with a mismatched line‑range start', () => {
    const candidate = makeClaim({ lineStart: 11, startLine: 11 });
    expect(isAllowed(validator, whitelist, candidate)).toBe(false);
  });

  it('rejects a claim with a mismatched line‑range end', () => {
    const candidate = makeClaim({ lineEnd: 13, endLine: 13 });
    expect(isAllowed(validator, whitelist, candidate)).toBe(false);
  });

  it('rejects a claim that matches file and symbol but has any line‑range difference', () => {
    const candidate = makeClaim({ lineStart: 10, lineEnd: 13 });
    expect(isAllowed(validator, whitelist, candidate)).toBe(false);
  });
});