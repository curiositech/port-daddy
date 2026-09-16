/**
 * CI regiment: no raw `stdin.isTTY` interactivity check in CLI source.
 *
 * WHY: under the `bun build --compile` binary the operator runs, the stream
 * flag `process.stdin.isTTY` is unreliable — it can be undefined/false on a
 * REAL terminal. Keying interactivity off it caused three shipped regressions:
 * `pd secret set` silently no-op'd (#205), `pd tube --send` hung forever, and
 * `pd feedback`/`pd tutorial` mis-detected the terminal.
 *
 * RULE: CLI code must decide interactivity via the kernel-level helpers in
 * `cli/utils/tty.ts` (`isStdinInteractive` / `readLineFromControllingTerminal`),
 * never by reading `stdin.isTTY` directly. The canonical predicate uses
 * `tty.isatty(0)` with the stream flag only as a fallback.
 *
 * The literal `stdin.isTTY` may appear ONLY in `cli/utils/tty.ts` (the helper
 * that owns the fallback) and in this guard. If you have a legitimate new case,
 * route it through the helper — do not add an allow entry without a reason.
 */
import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_DIR = join(REPO_ROOT, 'cli');

// Only the canonical TTY helper may reference the raw stream flag (as fallback).
const ALLOWED_FILES = new Set([
  'cli/utils/tty.ts',
]);

// `stdin.isTTY` in any form — `process.stdin.isTTY`, `input.stdin.isTTY`, etc.
const FORBIDDEN_PATTERN = /stdin\.isTTY/;

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.build']);

function isTestFile(name) {
  return /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(name);
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      if (isTestFile(e.name)) continue;
      const ext = e.name.slice(e.name.lastIndexOf('.'));
      if (!INCLUDE_EXTS.has(ext)) continue;
      yield { path: full, rel: relative(REPO_ROOT, full) };
    }
  }
}

export function findRawStdinIsTTYOffenders() {
  const offenders = [];
  for (const { path, rel } of walk(CLI_DIR)) {
    if (ALLOWED_FILES.has(rel)) continue;
    let content;
    try { content = readFileSync(path, 'utf-8'); }
    catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Skip prose: JSDoc/block-comment lines and full-line `//` comments. The
      // bug is described in many doc comments; only real CODE matters here.
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      // Drop any trailing line comment so an explanatory `// ...stdin.isTTY...`
      // after real code doesn't trip the guard.
      const code = lines[i].split('//')[0];
      if (FORBIDDEN_PATTERN.test(code)) {
        offenders.push({ path: rel, lineNumber: i + 1, line: trimmed });
      }
    }
  }
  return offenders;
}

describe('no-raw-stdin-istty', () => {
  test('no CLI source decides interactivity via raw stdin.isTTY', () => {
    const offenders = findRawStdinIsTTYOffenders();
    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
      throw new Error(
        `Found ${offenders.length} raw stdin.isTTY check(s) in CLI source:\n${detail}\n\n` +
        `stdin.isTTY is unreliable under the bun-compiled binary. Use\n` +
        `isStdinInteractive() / readLineFromControllingTerminal() from cli/utils/tty.ts instead.\n` +
        `The raw flag may live ONLY in cli/utils/tty.ts (the fallback owner).`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
