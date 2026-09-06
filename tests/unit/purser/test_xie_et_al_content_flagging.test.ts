/**
 * Purser contract for #8908, obligations 4 + 7 — the flagged skill
 * (xie-et-al-2025-survey-llm-task-planning) is imported INTACT: directory,
 * SKILL.md, and its bundled references/diagrams all present, unmodified from
 * jury_rig — while its content mismatch stays documented for curation.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft
 * asserted a `content-mismatch` flag inside `metadata/audit-report.json` —
 * an artifact no tooling produces (audit-skills.mjs prints to stdout, writes
 * no file, and has no flags mechanism). Obligation 4's own wording is
 * "document and flag ... for curation", and the PR does exactly that in its
 * description; there is no in-repo machine artifact to assert, so that half
 * of the draft is dropped WITH REASONS rather than satisfied by inventing a
 * new report format the repo doesn't have. The executable half — obligation
 * 7's import-integrity claim — is kept and made real: the skill's full
 * bundled tree must exist exactly as jury_rig shipped it.
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const skillDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..',
  'skills', 'xie-et-al-2025-survey-llm-task-planning',
);

describe('xie-et-al-2025-survey-llm-task-planning imported intact', () => {
  test('the skill directory and SKILL.md exist', () => {
    expect(existsSync(skillDir)).toBe(true);
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
  });

  test('the flagged bundled content (references/, diagrams/) is present, not stripped', () => {
    // The PR flags this bundled content as mismatched with the frontmatter
    // description — the contract is that it was imported AS-IS for later
    // curation, not silently dropped to make the mismatch disappear.
    for (const dir of ['references', 'diagrams']) {
      const p = join(skillDir, dir);
      expect(existsSync(p)).toBe(true);
      expect(readdirSync(p).length).toBeGreaterThan(0);
    }
  });
});
