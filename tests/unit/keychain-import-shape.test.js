// Regression test for the PR #20 / PR #31 incident.
//
// PR #20 (merge 3320cba0, 2026-05-05) regressed `lib/keychain.ts` from a
// namespace import to a named import of node:child_process. Under
// @swc/jest's ESM transform, the named-import form fails at module-link
// time with:
//
//   SyntaxError: The requested module 'node:child_process' does not
//   provide an export named 'execFileSync'
//
// Every unit-test platform CI run on main went red until PR #31 reverted
// it. This test pins the namespace pattern in place so the regression
// can't silently land again. It is intentionally narrow - other files
// in the repo use named imports from node:child_process and pass CI;
// only `lib/keychain.ts` is on a critical-enough import path that
// @swc/jest's ESM output broke against the real builtin's exports.
//
// If this test trips, do NOT change the assertion; instead restore the
// namespace pattern in lib/keychain.ts:
//
//   import * as childProcess from 'node:child_process';
//   childProcess.execFileSync(...);

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KEYCHAIN_PATH = join(__dirname, '..', '..', 'lib', 'keychain.ts');

function hasValueNamedSpecifier(importKind, specifierList) {
  if (importKind) return false;
  return specifierList.split(',').some((specifier) => {
    const cleaned = specifier.trim();
    return cleaned.length > 0 && !/^type\b/.test(cleaned);
  });
}

function findValueNamedChildProcessImports(source) {
  const statementRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]node:child_process['"]/g;
  const offenders = [];
  let m;
  while ((m = statementRe.exec(source)) !== null) {
    if (hasValueNamedSpecifier(m[1], m[2])) offenders.push(m[0]);
  }
  return offenders;
}

describe('lib/keychain.ts import shape (PR #20 regression guard)', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(KEYCHAIN_PATH, 'utf8');
  });

  test('uses namespace import for node:child_process, not named import', () => {
    // Per-statement scan, not per-file. The earlier whole-file form
    // (`valueNamed && !typeOnly`) cleared to false if any unrelated
    // `import type { ... } from 'node:child_process'` lived in the same
    // file — letting the actual regression slip through. Classify each
    // statement independently instead.
    const offenders = findValueNamedChildProcessImports(source);

    if (offenders.length > 0) {
      throw new Error(
        `lib/keychain.ts uses a value named import from node:child_process: ${offenders[0]}\n` +
          'This regresses PR #20. Use the namespace import instead.',
      );
    }
    expect(offenders).toEqual([]);
  });

  test('does not flag erased type-only named imports', () => {
    expect(
      findValueNamedChildProcessImports(`
        import type { ChildProcess } from 'node:child_process';
        import { type ChildProcessByInlineSpecifier } from 'node:child_process';
      `),
    ).toEqual([]);

    expect(
      findValueNamedChildProcessImports(`
        import { type ChildProcessByInlineSpecifier, execFileSync } from 'node:child_process';
      `),
    ).toHaveLength(1);
  });

  test('imports node:child_process as a namespace and uses it through the namespace', () => {
    const namespaceImport = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]node:child_process['"]/;
    const match = source.match(namespaceImport);
    expect(match).not.toBeNull();
    const nsName = match[1];
    // At least one call site should go through the namespace, otherwise the
    // import is dead and a future cleanup might "simplify" it back to named.
    const callPattern = new RegExp(`${nsName}\\.(execFileSync|spawnSync|spawn|exec|execFile|fork|execSync)\\b`);
    expect(callPattern.test(source)).toBe(true);
  });
});
