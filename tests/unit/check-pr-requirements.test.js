/**
 * Regression test for scripts/check-pr-requirements.mjs — the machine half of the
 * PR contract (AGENTS.md § Pull Request Operating Procedure + § Visual artifacts for
 * UI diffs). Pins the structural gate against committed fixtures: a full body passes,
 * a thin body fails naming the weak sections, and a visual-surface diff fails unless
 * it ships a screenshot + a motion artifact (or is explicitly visual-exempt).
 *
 * Rule (4) — a user-visible diff must add a `changelog.d/` fragment — was added
 * later. The cases below that are ABOUT rules 1-3 therefore carry a fragment path in
 * their `--changed` list so rule (4) is satisfied for the right reason and cannot mask
 * the behaviour under test. Rule (4)'s own RED/GREEN cases live in
 * tests/unit/changelog-fragments.test.js.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-pr-requirements.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'pr-requirements', name);

/** Run the guard with explicit args; return { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-pr-requirements guard', () => {
  test('no PR context is a no-op (exit 0)', () => {
    const { code, stdout } = run('--changed', 'lib/relay-client.ts');
    expect(code).toBe(0);
    expect(stdout).toMatch(/no PR context/);
  });

  test('a full body with summary + test plan passes (non-visual diff)', () => {
    const { code, stdout } = run('--body-file', fixture('good-body.md'), '--changed', 'lib/relay-client.ts,changelog.d/9900-relay.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a thin summary + checkbox-only test plan fails, naming both', () => {
    const { code, stderr } = run('--body-file', fixture('thin-body.md'), '--changed', 'lib/relay-client.ts');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Summary is too thin/);
    expect(stderr).toMatch(/Test Plan is too thin/);
  });

  test('a missing summary heading fails', () => {
    const { code, stderr } = run('--body', '## Test Plan\n\nRan the whole suite and exercised every edge case I could think of here.', '--changed', 'lib/foo.ts');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Missing a `## Summary`/);
  });

  test('a visual-surface diff with no artifacts fails', () => {
    const { code, stderr } = run('--body-file', fixture('visual-no-artifacts.md'), '--changed', 'fleet-config-ui/src/HealthPane.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
    expect(stderr).toMatch(/screenshot/);
    expect(stderr).toMatch(/GIF or screen recording/);
  });

  test('a visual-surface diff WITH screenshot + GIF passes', () => {
    const { code, stdout } = run('--body-file', fixture('visual-with-artifacts.md'), '--changed', 'fleet-config-ui/src/HealthPane.tsx,changelog.d/9901-health-pane.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a committed image + committed gif in the diff satisfies the visual rule', () => {
    const { code } = run(
      '--body-file', fixture('visual-no-artifacts.md'),
      '--changed', 'fleet-config-ui/src/HealthPane.tsx,fleet-config-ui/docs/pane.png,fleet-config-ui/docs/pane.gif,changelog.d/9902-pane.md',
    );
    expect(code).toBe(0);
  });

  test('visual-exempt marker bypasses only the visual rule', () => {
    const { code, stdout } = run('--body-file', fixture('visual-exempt.md'), '--changed', 'fleet-config-ui/src/types.ts,changelog.d/9903-types.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('pr-requirements-exempt marker skips the whole gate', () => {
    const { code, stdout } = run('--body', 'whatever <!-- pr-requirements-exempt: dependabot bump -->', '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(0);
    expect(stdout).toMatch(/skipping/);
  });

  // Regression: hasMarker() used a loose substring match, so the PR template's own
  // guidance comment (which names `visual-exempt`) silently exempted EVERY PR.
  test('the PR template guidance comment does NOT auto-exempt the visual gate', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '<!--',
      '  Not a visual change? Replace this section body with exactly:',
      '  <!-- visual-exempt: <one-line reason> -->',
      '-->',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  // Regression: the changelog-fragment rule (rule 4) must not be disabled by the
  // PR template's OWN text. An earlier draft pasted a live `<!-- changelog-exempt:
  // <reason> -->` EXAMPLE into a checklist line; the comment scanner matched it as
  // a real marker, so every PR opened from the template auto-exempted the changelog
  // gate (and a live `pr-requirements-exempt` would have skipped the whole gate).
  // The template must describe every marker in prose, never as a live comment.
  test('the real PR template does NOT self-exempt any gate', () => {
    const template = join(repo, '.github', 'PULL_REQUEST_TEMPLATE.md');
    const { code, stdout, stderr } = run('--body-file', template, '--changed', 'lib/relay-client.ts');
    // Not skipped whole-gate (no live pr-requirements-exempt), and the changelog
    // rule actually fires for a user-visible change with no fragment.
    expect(code).toBe(1);
    expect(stdout).not.toMatch(/skipping/);
    expect(stderr).toMatch(/adds no changelog fragment/);
  });

  test('an exempt marker with no reason does not count', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many inputs here.\n<!-- visual-exempt -->';
    const { code, stderr } = run('--body', body, '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  // Regression: hasMarker() matched `\S` against the RAW comment, and `\S` matched
  // the `-` of the closing `-->`. So `<!-- visual-exempt: -->` — a marker with a
  // completely empty reason — exempted the gate, defeating the "auditable, not
  // blank" property the source comment claims. The colon-less `<!-- visual-exempt -->`
  // form was already covered by the test above, which is how this one survived.
  test('an exempt marker with a colon but an EMPTY reason does not count', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many inputs here.\n<!-- visual-exempt: -->';
    const { code, stderr } = run('--body', body, '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  test('a real reason still exempts (the fix does not break the marker)', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many different inputs here today.\n<!-- visual-exempt: type-only change, nothing renders differently -->';
    const { code, stdout } = run('--body', body, '--changed', 'website-v2/src/x.tsx,changelog.d/9905-x.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a heading inside a fenced code block does not truncate the Test Plan', () => {
    const body = [
      '## Summary',
      'A genuine summary with plenty of words to satisfy the floor cleanly here.',
      '## Test Plan',
      '```sh',
      '# Test Plan output below',
      'npm test # 1255 passed across the whole suite here',
      '```',
      'All green; exercised the empty-input and oversize-input edges too.',
    ].join('\n');
    const { code, stdout } = run('--body', body, '--changed', 'lib/x.ts,changelog.d/9904-x.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('an opaque GitHub attachment link counts as a screenshot but not as motion', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '![shot](https://github.com/curiositech/port-daddy/assets/1/abc-uuid)',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/GIF or screen recording/);
    expect(stderr).not.toMatch(/screenshot \(image\)/);
  });

  // --- Rule 3b: figure/print territory ---------------------------------------
  //
  // #10190 (three new Book figures) and #10191 (fifteen restyled Book figures)
  // both passed every check in this repo while shipping no image of the thing
  // they changed, both by writing `<!-- visual-exempt: ... -->`. Entirely visual
  // work took the marker that exists to say "there is no visual change here".
  // The cases below pin the rule that closes it AND the scope that keeps the
  // marker valid where it is legitimate.
  describe('figure/print territory', () => {
    // The exact shape of #10190: whitepaper sources + a figure fragment, and a
    // visual-exempt marker in place of a picture.
    const FIGURE_DIFF = 'website-v2/public/whitepaper/figures/fig-bc-delta-threshold.tex,website-v2/public/whitepaper/harbor-economy.tex,changelog.d/9910-figures.md';

    test('a whitepaper diff with visual-exempt FAILS, and the error says what to do instead', () => {
      const { code, stderr } = run('--body-file', fixture('figure-visual-exempt.md'), '--changed', FIGURE_DIFF);
      expect(code).toBe(1);
      expect(stderr).toMatch(/`visual-exempt` is not available/);
      expect(stderr).toMatch(/figure or print territory/);
      // The message must teach the convention, not merely refuse.
      expect(stderr).toMatch(/1\.0× \/ 150 dpi/);
      expect(stderr).toMatch(/phone PDF viewer/);
      // ...and name the accepted forms concretely.
      expect(stderr).toMatch(/markdown image/);
      expect(stderr).toMatch(/GitHub Actions run or artifact URL/);
    });

    test('the same body with a page-scale render in Visual Proof PASSES', () => {
      const { code, stdout } = run('--body-file', fixture('figure-with-render.md'), '--changed', FIGURE_DIFF);
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
    });

    test('a CI-artifact link to published renders PASSES', () => {
      const body = [
        '## Summary',
        'Restyle fifteen Book figures onto the shared style names so one edition override reaches all of them.',
        '## Test Plan',
        'Compiled all 37 fragments under both preambles; 74 compiles and zero failures, then rendered fifteen of them.',
        '## Visual Proof',
        'Before/after contact sheet at 1.0x / 150 dpi, published by the figure gates:',
        'https://github.com/curiositech/port-daddy/actions/runs/1234567890',
      ].join('\n');
      const { code, stdout } = run('--body', body, '--changed', 'whitepaper/figures/fig-swk-stack-map.tex');
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
    });

    // The scope test: the hatch stays valid where it is legitimate. A pure CI /
    // script change touches no figure path, so `visual-exempt` still works —
    // this is #10186's shape, and this very PR's shape.
    test('a PR touching no figure path keeps visual-exempt (pure CI / script change)', () => {
      const body = [
        '## Summary',
        'Add a repo-root Node script that finds committed assets nothing references, plus its mutation test.',
        '## Test Plan',
        'node --test scripts/check-orphan-assets.test.mjs — 20 of 20 pass, covering both directions of the mutation table.',
        '<!-- visual-exempt: a Node script, its test and two CI steps; no rendered surface changes -->',
      ].join('\n');
      const { code, stdout } = run(
        '--body', body,
        '--changed', 'scripts/check-orphan-assets.mjs,scripts/check-orphan-assets.test.mjs,.github/workflows/library-checks.yml',
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
    });

    // Rule 3b must not be satisfiable by an empty gesture. Each of these is a
    // Visual Proof section that LOOKS filled in and contains no picture.
    test('a Visual Proof section of "N/A" + a bare checkbox + an empty bullet FAILS', () => {
      const { code, stderr } = run('--body-file', fixture('figure-empty-gesture.md'), '--changed', FIGURE_DIFF);
      expect(code).toBe(1);
      expect(stderr).toMatch(/carries no render a reviewer can open/);
      expect(stderr).toMatch(/"N\/A", a bare checkbox, an empty bullet/);
    });

    // The case both #10190 and #10191 actually shipped: an articulate account of
    // having looked at the pixels, with figcheck and ink_audit output, and no
    // picture. A claim about looking is not a thing to look at.
    test('prose about rendering, with figcheck and ink_audit output, is NOT evidence', () => {
      const { code, stderr } = run('--body-file', fixture('figure-prose-only.md'), '--changed', FIGURE_DIFF);
      expect(code).toBe(1);
      expect(stderr).toMatch(/carries no render a reviewer can open/);
    });

    test('a missing Visual Proof section FAILS on a figure diff', () => {
      const body = [
        '## Summary',
        'Redraw the stack map around the provides/assumes relation so the bracket stops straddling two bands.',
        '## Test Plan',
        'Compiled under both preambles and ran figcheck T1 through T8; all clean at page scale.',
      ].join('\n');
      const { code, stderr } = run('--body', body, '--changed', 'whitepaper/figures/fig-swk-stack-map.tex');
      expect(code).toBe(1);
      expect(stderr).toMatch(/no `## Visual Proof` section at all/);
    });

    // A render somewhere else in the body is not proof: the section is where a
    // reviewer looks, and a stray badge or logo elsewhere must not clear the bar.
    test('an image OUTSIDE the Visual Proof section does not satisfy the rule', () => {
      const body = [
        '## Summary',
        'Redraw the stack map around the provides/assumes relation so the bracket stops straddling two bands.',
        '![build badge](https://img.shields.io/badge/build-passing.svg)',
        '## Test Plan',
        'Compiled under both preambles and ran figcheck T1 through T8; all clean at page scale.',
        '## Visual Proof',
        'Rendered at 150 dpi and inspected by eye; nothing regressed.',
      ].join('\n');
      const { code, stderr } = run('--body', body, '--changed', 'whitepaper/figures/fig-swk-stack-map.tex');
      expect(code).toBe(1);
      expect(stderr).toMatch(/carries no render a reviewer can open/);
    });

    // A printed page has nothing to record. Rule 3 must not demand a GIF of it —
    // `website-v2/public/whitepaper/` matches VISUAL_SURFACE_RE, so without the
    // subtraction this body would fail for a missing "GIF or screen recording".
    test('a printed page is never asked for a GIF or screen recording', () => {
      const { code, stdout, stderr } = run('--body-file', fixture('figure-with-render.md'), '--changed', FIGURE_DIFF);
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
      expect(stderr).not.toMatch(/GIF or screen recording/);
    });

    // The marker is void on a mixed diff too — otherwise a PR that touches a
    // figure AND a pane could still exempt the pane half.
    test('visual-exempt is void for the app-surface half of a mixed diff', () => {
      const { code, stderr } = run(
        '--body-file', fixture('figure-visual-exempt.md'),
        '--changed', 'whitepaper/figures/fig-swk-stack-map.tex,fleet-config-ui/src/HealthPane.tsx,changelog.d/9911-mixed.md',
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/`visual-exempt` is not available/);
      expect(stderr).toMatch(/Visual surface changed/);
      expect(stderr).toMatch(/GIF or screen recording/);
    });

    // The template now names `visual-exempt` several times in prose to explain
    // that it is unavailable here. If any of that were written as a LIVE comment
    // the guidance would become the marker, and every PR opened from the template
    // would report the very error the text is warning about. Same failure mode as
    // the two self-exemption regressions above, one level more embarrassing.
    test('the real PR template does not self-trigger the figure rule', () => {
      const template = join(repo, '.github', 'PULL_REQUEST_TEMPLATE.md');
      const { code, stderr } = run('--body-file', template, '--changed', 'whitepaper/figures/fig-swk-stack-map.tex');
      expect(code).toBe(1);
      // It fails for the honest reason — an unfilled template has no render —
      // and NOT because the template's own prose read as a live marker.
      expect(stderr).toMatch(/carries no render a reviewer can open/);
      expect(stderr).not.toMatch(/`visual-exempt` is not available/);
    });

    // The territory is defined by shape, not by an enumerated tree alone — a new
    // `figures/` or plate directory is in scope the day it is created.
    test.each([
      ['a figures/ directory at any depth', 'docs/harbor-research/exposition/figures/FIGURE-REGISTER.md'],
      ['a plate directory', 'website-v2/public/whitepaper/plates/swiss/chapter-swk.jpg'],
      ['a hyphenated plate pipeline', 'scripts/whitepaper-plates/plates_pipeline.py'],
      ['any .tex file', 'docs/harbor-research/tex/appendix.tex'],
      ['the chartwork skill', 'skills/harbor-chartwork/scripts/tikz_precheck.py'],
      ['the figure-system skill', 'skills/whitepaper-figure-system/references/semantic-figure-atlas.md'],
    ])('%s is figure territory', (_label, path) => {
      const { code, stderr } = run('--body-file', fixture('figure-visual-exempt.md'), '--changed', `${path},changelog.d/9912-x.md`);
      expect(code).toBe(1);
      expect(stderr).toMatch(/`visual-exempt` is not available/);
    });

    // ...and `templates/` contains the letters "plates". A looser plate pattern
    // matches every one of the ~90 template directories in this repo, which
    // would make the rule fire on skill scaffolding that renders nothing.
    test.each([
      ['a templates/ directory is NOT a plate directory', 'skills/agent-pr-authoring/templates/pr-body.md'],
      ['a repo-root templates/ directory is not either', 'templates/agent-brief.md'],
    ])('%s', (_label, path) => {
      const { code, stdout } = run('--body-file', fixture('figure-visual-exempt.md'), '--changed', path);
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
    });
  });

  test('an .avif still does not satisfy the motion requirement', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '![shot](docs/pane.avif)',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/GIF or screen recording/);
  });
});
