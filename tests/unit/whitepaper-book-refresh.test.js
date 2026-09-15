import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

// The Book (coordination-papers-mega-volume.pdf) is collated from every
// chapter, so any chapter edit moves it. While PR runs committed it, all 23
// open whitepaper PRs on 2026-09-14 carried a diff on that one ~9 MiB binary,
// plus publication-digests.json and whitePapers.ts, which only record its size
// and page count. This repository merges by REBASE with linear history, and
// replaying a binary commit onto a moved base cannot merge -- so one landing
// conflicted the other 22 and the cluster could only be drained by hand.
//
// These tests pin the three properties that keep that from coming back.

const workflow = readFileSync(
  new URL('../../.github/workflows/whitepaper-build.yml', import.meta.url),
  'utf8',
);

const BOOK = 'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf';

function stepNamed(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`whitepaper-build.yml has no step named "${name}"`);
  const next = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
}

describe('whitepaper-build keeps the Book out of ordinary diffs', () => {
  test('an ordinary run restores the Book instead of staging it', () => {
    const step = stepNamed('Keep the Book out of the diff unless this run is its refresh');
    expect(step).toContain(`book=${BOOK}`);
    expect(step).toContain('git checkout -- "$book"');
    // The restore must be gated on the refresh flag, not on the event name --
    // a PR, a branch push and a plain dispatch are all ordinary runs.
    expect(step).toContain('if [ "$REFRESHING_BOOK" = "true" ]');
    expect(step).toMatch(/REFRESHING_BOOK:.*inputs\.refresh_book/);
  });

  test('the Book is still built and still judged, so the render stays proven', () => {
    // Restoring the artifact must not become "stop building it": the cover-band
    // job judges the page this run made, and a Book that no longer compiles has
    // to fail here rather than at release.
    const upload = stepNamed('Hand the freshly built Book to the type-over-art check');
    expect(upload).toContain(BOOK);
    expect(upload).toContain('if-no-files-found: error');

    // The restore runs after the upload, or the cover check would judge the
    // committed (stale) Book and report a green it had not earned.
    expect(workflow.indexOf('name: freshly-built-editions')).toBeLessThan(
      workflow.indexOf('Keep the Book out of the diff unless this run is its refresh'),
    );
  });

  test('refresh_book is the only path that publishes a Book, and never on main', () => {
    expect(workflow).toMatch(/refresh_book:\n\s+description:/);
    const decision = stepNamed('Decide whether this run has derived output to own');
    expect(decision).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.refresh_book && github.ref_name != 'main'",
    );
  });

  test('chapter PDFs are deliberately left alone', () => {
    // Only the Book is frozen. A chapter PDF is chapter-scoped: two PRs collide
    // on one only by editing the same chapter, which is a real conflict a
    // person should see rather than a derived-artifact race.
    const step = stepNamed('Keep the Book out of the diff unless this run is its refresh');
    const restored = step.match(/git checkout -- "\$book"/g) ?? [];
    expect(restored).toHaveLength(1);
    expect(step).not.toContain('website-v2/public/whitepaper/*.pdf');
  });
});
