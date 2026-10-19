/**
 * Unit tests for `isFigureSurface` in scripts/lib/user-visible-surfaces.mjs.
 *
 * This function is the single place that decides a PR is figure/print territory,
 * and `check-pr-requirements.mjs` uses that answer to withdraw the `visual-exempt`
 * marker and demand a page-scale render instead. Getting it wrong in the lenient
 * direction is silent: the PR is simply never asked for the render, and the gate
 * reports success. That is the failure mode these cases exist for.
 *
 * tests/unit/check-pr-requirements.test.js drives the whole gate against committed
 * fixtures. It cannot enumerate path shapes, because each case costs a fixture and a
 * subprocess — so the classification rules themselves were unpinned. Anything below
 * that reads as a restatement of the implementation is deliberate: the near-misses
 * (`templates/` against `plates/`, capitalised trees) are the whole point, and the
 * source comments name them as the hazards this function was written around.
 */
import { describe, expect, test } from '@jest/globals';
import {
  FIGURE_DIR_RE,
  FIGURE_WORK_TREES,
  PLATE_DIR_RE,
  TYPESET_SOURCE_RE,
  isFigureSurface,
} from '../../scripts/lib/user-visible-surfaces.mjs';

describe('isFigureSurface — the enumerated work trees', () => {
  test('every tree in FIGURE_WORK_TREES classifies a file inside it', () => {
    // Pinned as a loop over the exported list rather than a literal copy, so a
    // tree added to the list without thought still has to hold the property.
    for (const tree of FIGURE_WORK_TREES) {
      expect(isFigureSurface(`${tree}some/file.md`)).toBe(true);
    }
  });

  test('the list is not empty, so the loop above is not vacuous', () => {
    expect(FIGURE_WORK_TREES.length).toBeGreaterThan(4);
  });

  test('a craft rule is figure territory even though it is not a drawing', () => {
    // A change to craft-rules.md changes what every figure is allowed to look
    // like; the only honest proof it is right is a rendered page.
    expect(isFigureSurface('skills/harbor-chartwork/references/craft-rules.md')).toBe(true);
    expect(isFigureSurface('skills/harbor-chartwork/scripts/tikz_precheck.py')).toBe(true);
  });
});

describe('isFigureSurface — any directory named figures, at any depth', () => {
  test.each([
    'whitepaper/figures/fig-a.tex',
    'docs/harbor-research/figures/fig-b.pdf',
    'docs/harbor-research/exposition/figures/plot.png',
  ])('%s is figure territory', (path) => {
    expect(isFigureSurface(path)).toBe(true);
  });

  test('a figures tree outside the enumerated list still matches', () => {
    // The shape rule exists so the enumerated list is not the only line of
    // defence against a figure tree created next month.
    expect(isFigureSurface('some/tree/invented/later/figures/x.svg')).toBe(true);
  });

  test('"figures" as a filename stem is not a directory and does not match', () => {
    expect(FIGURE_DIR_RE.test('docs/figures.md')).toBe(false);
  });
});

describe('isFigureSurface — plate directories versus the ~90 templates/ directories', () => {
  test.each([
    'website-v2/public/whitepaper/plates/p.png',
    'docs/pr-assets/swiss-plates/p.png',
    'scripts/whitepaper-plates/build.mjs',
  ])('%s is a plate directory', (path) => {
    expect(isFigureSurface(path)).toBe(true);
  });

  // "templates" contains the letters "plates". A looser pattern matches every
  // templates/ directory in the repo and makes this gate fire on unrelated work,
  // which is how an unbypassable guard gets switched off. The required hyphen and
  // the (^|/) anchor are what prevent it; nothing pinned that they do.
  test.each([
    'website-v2/src/templates/email.html',
    'app/templates/index.html',
    'x/my-templates/a.png',
  ])('%s is NOT a plate directory', (path) => {
    expect(PLATE_DIR_RE.test(path)).toBe(false);
    expect(isFigureSurface(path)).toBe(false);
  });

  test('a directory merely starting with "plates" is not a plate directory', () => {
    expect(isFigureSurface('docs/plates-of-food/x.png')).toBe(false);
  });

  test('a file named plates is not a plate directory', () => {
    expect(isFigureSurface('x/plates.md')).toBe(false);
  });
});

describe('isFigureSurface — typeset sources', () => {
  test('every .tex is a page someone has to look at, wherever it lives', () => {
    expect(isFigureSurface('a/b/c.tex')).toBe(true);
    expect(TYPESET_SOURCE_RE.test('anywhere.tex')).toBe(true);
  });

  test('the extension is matched case-insensitively', () => {
    expect(isFigureSurface('some/deep/path/notes.TEX')).toBe(true);
  });

  test('a name merely containing "tex" is not a typeset source', () => {
    expect(isFigureSurface('src/context.ts')).toBe(false);
    expect(isFigureSurface('docs/texture.md')).toBe(false);
  });
});

describe('isFigureSurface — case folding', () => {
  // Git stores paths case-sensitively, so `Figures/` and `figures/` are two
  // different directories. A contributor who capitalises one would otherwise
  // create a figure tree this rule cannot see — reopening, by an accident of
  // spelling, the exact gap the shape-based rules exist to close.
  // These three carry no `figures/` or `plates/` segment and no `.tex`, so the
  // only rule that can classify them is the work-tree match on the folded path.
  // Cases that DO contain `figures/` pass on FIGURE_DIR_RE's own `i` flag even
  // with the fold removed, which makes them useless as evidence for it — the
  // first draft of this file used exactly those and went green against a build
  // with `toLowerCase()` deleted.
  test.each([
    ['Skills/harbor-chartwork/references/craft-rules.md', 'a capitalised leading segment'],
    ['Whitepaper-foundlings/notes/x.md', 'a capitalised parked worktree'],
    ['skills/Harbor-Chartwork/references/craft-rules.md', 'a capitalised inner segment'],
  ])('%s (%s) is still figure territory', (path) => {
    expect(isFigureSurface(path)).toBe(true);
  });

  test.each([
    ['docs/Figures/fig-c.png', 'a capitalised figures directory'],
    ['docs/pr-assets/Swiss-Plates/p.png', 'a capitalised plates directory'],
  ])('%s (%s) is still figure territory', (path) => {
    expect(isFigureSurface(path)).toBe(true);
  });
});

describe('isFigureSurface — ordinary work is not figure territory', () => {
  // The negatives matter as much as the positives. A classifier that said yes to
  // everything would pass every test above and demand a page-scale render of a
  // dependency bump.
  test.each([
    'README.md',
    'src/index.ts',
    'scripts/check-pr-requirements.mjs',
    'docs/adr/0141-oidc-workload-identity-and-standing-operator-grant.md',
    'package.json',
    '.github/workflows/ci.yml',
    'apps/relay/src/oidc.ts',
  ])('%s is not figure territory', (path) => {
    expect(isFigureSurface(path)).toBe(false);
  });
});
