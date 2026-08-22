/**
 * Purser contract for #7504, obligations 3, 8, 10 — the README stays inside
 * its 300-line budget, the command/permission-tier reference tables have
 * moved OUT of the README, and the opening accurately reflects
 * docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. FAILED TO LOAD. `__dirname` does not exist in this repo's test
 *      runtime (jest runs .ts tests as ESM), so the suite crashed before a
 *      single assertion. Repaired with the repo-standard
 *      `dirname(fileURLToPath(import.meta.url))`.
 *   2. WRONG DEPTH. Paths used `../../../../` — four levels up from
 *      tests/unit/purser/ is OUTSIDE the repository. Three levels is the
 *      repo root.
 *   3. TOOTHLESS HEADING REGEX. `/##\s*Command\s*Index\b/i` never matched
 *      the pre-#7504 heading `## 🗂 Command Index` (the emoji sits between
 *      `##` and the words), so the "must not contain a Command Index
 *      section" assertion passed on the OLD 1,046-line README too — a gate
 *      that cannot fail is not a gate. Repaired to `/^##.*command index/im`
 *      (and the same for the CLI Permission Tiers table), verified to FAIL
 *      against the pre-#7504 README and PASS after it.
 *   4. FANTASY DESTINATION. The draft demanded a `docs/*command*` file
 *      containing a `## Command Index` heading. #7504 moved the lookup
 *      surface to `pd help` — generated from the same registry the CLI
 *      dispatches on, precisely so it cannot drift — not to a hand-written
 *      docs file that would drift exactly like the README did. The repaired
 *      assertion checks the real destination: the README points readers at
 *      `pd help`.
 *   5. FANTASY PHRASE. The draft demanded the literal phrase "one durable
 *      truth" in BOTH files. The README says "one durable record" (its own
 *      voice), and in the architecture doc the phrase is line-wrapped
 *      ("one durable\ntruth"), so the draft's regex failed there as well.
 *      The repaired alignment check normalizes whitespace and asserts the
 *      real shared identity: the architecture doc's kernel sentence ("one
 *      durable truth"), and the README opening's restatement of it — one
 *      durable record/truth plus the enforced boundary that refuses.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from '@jest/globals';

const here = dirname(fileURLToPath(import.meta.url));
const readmePath = join(here, '../../../README.md');
const archPath = join(here, '../../../docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md');

/**
 * Helper: read file as array of lines
 */
function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

describe('README length & structure', () => {
  it('must be <= 300 lines', () => {
    const lines = readLines(readmePath);
    expect(lines.length).toBeLessThanOrEqual(300);
  });

  it('must not contain the Command Index or CLI Permission Tiers reference sections', () => {
    const content = readFileSync(readmePath, 'utf8');
    // `.*` between `##` and the words: the pre-#7504 headings carried emoji
    // (`## 🗂 Command Index`, `## 🔐 CLI Permission Tiers`) — a regex that
    // cannot match the thing it forbids proves nothing.
    expect(/^##.*command index/im.test(content)).toBe(false);
    expect(/^##.*cli permission tiers/im.test(content)).toBe(false);
  });

  it('points command lookup at pd help, generated from the registry it documents', () => {
    const content = readFileSync(readmePath, 'utf8');
    // The reference tables did not vanish — they moved to `pd help`, which is
    // generated from cli/permission-tiers.ts and therefore cannot drift. The
    // README must tell the reader so.
    expect(content).toMatch(/`pd help/);
    // And the tier vocabulary is still explained where the capability map is.
    expect(content).toMatch(/permission tier/i);
  });

  it('opening aligns with the architecture doc: one durable truth behind one enforced boundary', () => {
    const readme = readFileSync(readmePath, 'utf8');
    // Normalize hard wraps: the architecture doc writes "one durable\ntruth".
    const arch = readFileSync(archPath, 'utf8').replace(/\s+/g, ' ');
    expect(arch).toMatch(/one daemon owns one durable truth/i);

    // The README's opening restates the same identity in its own voice:
    // one daemon, one durable record of who is doing what, one enforced
    // boundary that refuses. Feature-list openings (the pre-#7504 README)
    // contain none of these.
    const opening = readme.split(/\r?\n/).slice(0, 40).join('\n');
    expect(opening).toMatch(/one durable (record|truth)/i);
    expect(opening).toMatch(/enforced boundary|write boundary/i);
    expect(opening).toMatch(/refuses/i);
  });
});
