// Two numbers that used to live in more than one place, and now cannot
// disagree without this test noticing.
//
// 1. The pinned readers. Every page measurement the Book publishes -- the
//    8.0 pt foot threshold, the contrast of type over a plate, figcheck's
//    T1-T8 geometry, the margin column bounds -- is read out of PyMuPDF and
//    Pillow, so those versions are part of what the checks mean. They were
//    three literal `pip install 'pymupdf==...'` lines across two workflows,
//    held in step by a comment that asked the next editor to remember. One
//    of the three had already drifted unpinned once. The versions now live
//    in scripts/harbor-research/requirements-pdf.txt and the workflows
//    install from it; this test fails on any workflow that names one of
//    those packages inline again.
//
// 2. The edition count. whitepaper-build.yml uploads exactly the editions it
//    built and the cover-band job checks them with a matching --expect (one
//    today: the Book has one central edition, and the other two typographic
//    characters are switchable but unbuilt). Without the flag, an artifact
//    that arrived short passed over whatever went missing; with it, the count
//    is asserted -- but only as long as the two numbers stay equal, which is
//    what the last test here is for. Publish a second edition and this fails
//    until --expect moves with it.
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const REQUIREMENTS = 'scripts/harbor-research/requirements-pdf.txt';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const WORKFLOWS = ['whitepaper-build.yml', 'library-checks.yml'].map((name) => ({
  name,
  text: read(`.github/workflows/${name}`),
}));

/** Packages whose version defines what a page check means. */
const READERS = ['pymupdf', 'pillow', 'numpy', 'scipy'];

const runLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('pip install'));

describe('the readers every page measurement is taken with', () => {
  test('the pin file pins every reader to an exact version', () => {
    const pins = read(REQUIREMENTS)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      // `>=` or a bare name would let a patch release move a published
      // measurement without any commit saying so.
      expect(pin).toMatch(/^[a-z0-9_-]+==\d+\.\d+/i);
    }
    for (const reader of READERS) {
      expect(pins.some((pin) => pin.toLowerCase().startsWith(`${reader}==`))).toBe(true);
    }
  });

  test('no workflow installs a reader by name instead of from the pin file', () => {
    const offenders = [];
    for (const { name, text } of WORKFLOWS) {
      for (const line of runLines(text)) {
        for (const reader of READERS) {
          if (new RegExp(`\\b${reader}\\b`, 'i').test(line) && !line.includes(REQUIREMENTS)) {
            offenders.push(`${name}: ${line}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every job that runs a page check installs them', () => {
    // The pairing this asserts is the one that broke before: a job can call
    // a checker without installing what the checker reads, and the failure
    // then reads as an import error rather than as a missing pin.
    const CHECKERS = ['run_pdf_checks.py', 'figcheck.py', 'check_cover_title_band.py', 'margin_lint.py'];
    for (const { name, text } of WORKFLOWS) {
      const workflow = parseYaml(text);
      for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
        const steps = job.steps ?? [];
        const runs = steps.map((step) => step.run ?? '').join('\n');
        const callsAChecker = CHECKERS.some((checker) => runs.includes(checker));
        if (!callsAChecker) continue;
        expect(`${name} ${jobId}: ${runs.includes(REQUIREMENTS)}`).toBe(`${name} ${jobId}: true`);
      }
    }
  });
});

describe('the cover-band job checks every edition the build uploaded', () => {
  const workflow = parseYaml(read('.github/workflows/whitepaper-build.yml'));

  const uploadedEditions = () => {
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (step.with?.name === 'freshly-built-editions' && typeof step.with.path === 'string') {
          return step.with.path.split('\n').map((p) => p.trim()).filter(Boolean);
        }
      }
    }
    return [];
  };

  test('the build uploads a known, non-empty set of editions', () => {
    const editions = uploadedEditions();
    expect(editions.length).toBeGreaterThan(0);
    for (const edition of editions) expect(edition).toMatch(/\.pdf$/);
  });

  test('--expect equals the number of editions uploaded', () => {
    const runs = Object.values(workflow.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .map((step) => step.run ?? '')
      .filter((run) => run.includes('run_pdf_checks.py'));
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const match = run.match(/--expect\s+(\d+)/);
      // A page-check step with no --expect is the fail-open itself: it would
      // pass over whichever edition failed to arrive.
      expect(match).not.toBeNull();
      expect(Number(match[1])).toBe(uploadedEditions().length);
    }
  });
});
