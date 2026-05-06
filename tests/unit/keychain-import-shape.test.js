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

describe('lib/keychain.ts import shape (PR #20 regression guard)', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(KEYCHAIN_PATH, 'utf8');
  });

  test('uses namespace import for node:child_process, not named import', () => {
    // Allow type-only named imports if they ever become necessary.
    // Forbid value named imports of node:child_process (the broken form).
    const valueNamedImport = /import\s+\{[^}]*\}\s+from\s+['"]node:child_process['"]/;
    const typeOnlyNamedImport = /import\s+type\s+\{[^}]*\}\s+from\s+['"]node:child_process['"]/;

    const hasValueNamed = valueNamedImport.test(source) && !typeOnlyNamedImport.test(source);

    if (hasValueNamed) {
      const offending = source.match(valueNamedImport)?.[0] ?? '<unknown>';
      throw new Error(
        `lib/keychain.ts uses a named import from node:child_process: ${offending}\n` +
          'This regresses PR #20. Use namespace import instead:\n' +
          "  import * as childProcess from 'node:child_process';\n" +
          '  childProcess.execFileSync(...);',
      );
    }
    expect(hasValueNamed).toBe(false);
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
