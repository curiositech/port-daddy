import { describe, expect, test } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrintOnlyBookPaletteChange } from '../../scripts/lib/print-only-palette-change.mjs';

const baseCss = ':root,\n[data-theme="light"] {\n  --surface-base: #f2eee6;\n}\n';
const bookCss = baseCss.replace('  --surface-base:', '  /* Print edge only. */\n  --book-block-proof: #b33f35;\n  --surface-base:');
const repo = process.cwd();
const cssPath = 'website-v2/src/styles/tokens.semantic.css';
const body = readFileSync(join(repo, 'tests/fixtures/pr-requirements/figure-with-render.md'), 'utf8');

describe('exact Book print palette snapshot comparison', () => {
  test('adding, changing and deleting an explicit edge declaration preserves other CSS', () => {
    expect(isPrintOnlyBookPaletteChange(baseCss, bookCss)).toBe(true);
    expect(isPrintOnlyBookPaletteChange(bookCss, bookCss.replace('#b33f35', '#007d73'))).toBe(true);
    expect(isPrintOnlyBookPaletteChange(bookCss, baseCss)).toBe(true);
    expect(isPrintOnlyBookPaletteChange(baseCss, baseCss + '/* registry explanation */\n')).toBe(true);
  });

  test('balanced escaped strings preserve literal content and comment-like bytes', () => {
    const quoted = baseCss + String.raw`.label { content: "A \"quoted\" /* literal */"; }` + '\n';
    const after = quoted.replace('  --surface-base:', '  --book-block-proof: #b33f35;\n  --surface-base:');
    expect(isPrintOnlyBookPaletteChange(quoted, after)).toBe(true);
    expect(isPrintOnlyBookPaletteChange(quoted, after.replace('/* literal */', '/* changed */'))).toBe(false);
  });

  test.each([
    ['web token', bookCss.replace('#f2eee6', '#ffffff')],
    ['comment splitting token name', bookCss.replace('--surface-base', '--surface-/*x*/base')],
    ['selector', bookCss.replace(':root,', '.app,')],
    ['unknown Book role', bookCss.replace('--book-block-proof', '--book-block-new-role')],
    ['nonliteral value', bookCss.replace('#b33f35', 'var(--brand-primary)')],
    ['extra declaration', bookCss.replace('#b33f35;', '#b33f35; color: red;')],
    ['missing semicolon', bookCss.replace('#b33f35;', '#b33f35')],
    ['unclosed comment', bookCss + '/* unfinished'],
    ['unclosed block', bookCss.replace('}', '')],
    ['unclosed string', bookCss.replace('"light"', '"light')],
    ['quoted comment content', bookCss.replace('"light"', '"li/* not a comment */ght"')],
    ['quoted declaration content', bookCss.replace('"light"', '"--book-block-proof: #b33f35;"')],
    ['null snapshot', null],
    ['empty snapshot', ''],
  ])('%s fails closed', (_name, changed) => {
    expect(isPrintOnlyBookPaletteChange(baseCss, changed)).toBe(false);
  });
});

// Exercise the real guard and its merge-base/show reads in a tiny committed
// repository; no --changed prose can claim the CSS is a print-only edit.
function withRepo(afterCss, check, { noBase = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'print-requirements-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    for (const path of [
      'scripts/check-pr-requirements.mjs',
      'scripts/lib/user-visible-surfaces.mjs',
      'scripts/lib/print-only-palette-change.mjs',
    ]) {
      const dest = join(dir, path);
      mkdirSync(join(dest, '..'), { recursive: true });
      copyFileSync(join(repo, path), dest);
    }
    mkdirSync(join(dir, 'website-v2/src/styles'), { recursive: true });
    writeFileSync(join(dir, cssPath), baseCss);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'print guard test');
    git('add', '.');
    git('commit', '-qm', 'before');
    if (!noBase) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (afterCss === null) rmSync(join(dir, cssPath));
    else writeFileSync(join(dir, cssPath), afterCss);
    git('add', '-A');
    git('commit', '--allow-empty', '-qm', 'after');
    check((extra = [], content = body) => spawnSync('node', [
      join(dir, 'scripts/check-pr-requirements.mjs'), '--body', content,
      '--changed', [cssPath, 'whitepaper/example.tex', 'changelog.d/10308-book.md', ...extra].join(','),
    ], { cwd: dir, encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('source-bound print/app PR evidence classification', () => {
  test('Book tokens and exact supporting files accept static page renders', () => {
    withRepo(bookCss, (run) => {
      const result = run(['website-v2/docs/design/BRAND.md',
        'website-v2/scripts/check-figure-palette.mjs',
        'website-v2/src/figure-palette-guard.test.ts']);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    });
  });
  test('static support alone still requires a page render', () => {
    const result = spawnSync('node', [join(repo, 'scripts/check-pr-requirements.mjs'),
      '--body', body.replace(/!\[[^\]]*\]\([^)]*\)/g, ''), '--changed',
      'website-v2/scripts/check-figure-palette.mjs,changelog.d/10308-book.md'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/render/i);
    expect(result.stderr).not.toMatch(/GIF or screen recording/);
  });
  test('the print exemption remains forbidden even with a render', () => {
    withRepo(bookCss, (run) => {
      const result = run([], body + '\n<!-- visual-exempt: print only -->');
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/visual-exempt.*not available/);
    });
  });
  test.each([
    ['web token', bookCss.replace('#f2eee6', '#ffffff'), []],
    ['selector', bookCss.replace(':root,', '.app,'), []],
    ['mixed app component', bookCss, ['website-v2/src/components/Panel.tsx']],
    ['missing after snapshot', null, []],
  ])('%s still requires motion proof', (_name, after, extra) => {
    withRepo(after, (run) => {
      const result = run(extra);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/GIF or screen recording/);
    });
  });
  test('missing merge-base provenance still requires motion proof', () => {
    withRepo(bookCss, (run) => {
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/GIF or screen recording/);
    }, { noBase: true });
  });
});
