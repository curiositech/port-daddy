/**
 * Source files must remain TEXT to git.
 *
 * A literal NUL byte in a source file is legal TypeScript and compiles fine,
 * so nothing catches it -- but git then classifies the file as binary. The
 * consequences are all silent:
 *
 *   - `git diff` prints `Bin 7463 -> 9147 bytes` instead of a line diff, so a
 *     reviewer sees a size delta and no code.
 *   - `git blame` has nothing to attribute.
 *   - `grep` / ripgrep skip the file by default, so a search for a symbol
 *     defined there returns NOTHING and reads exactly like "not used anywhere".
 *
 * This has happened twice in this repo, both times from using a raw NUL as a
 * join separator (a reasonable instinct -- NUL cannot appear in a path or an
 * identifier). The fix is always the same: write the six-character ESCAPE
 * `\u0000` in the source. The runtime string is identical; only the bytes on
 * disk differ.
 *
 * Asserted as a test rather than a lint rule because the failure mode is that
 * tooling goes quiet, and a linter is tooling.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('source stays greppable', () => {
  it('no fleet-executor source file contains a raw NUL byte', () => {
    const root = join(__dirname, '..');
    const offenders = sourceFiles(join(root, 'src'))
      .concat(sourceFiles(join(root, 'tests')))
      .filter(f => readFileSync(f, 'utf8').includes('\u0000'))
      .map(f => f.slice(root.length + 1));

    expect(
      offenders,
      `These files contain a literal NUL byte, so git treats them as binary and ` +
        `grep skips them. Write the escape \\u0000 in the source instead -- the ` +
        `runtime string is unchanged.`,
    ).toEqual([]);
  });
});
