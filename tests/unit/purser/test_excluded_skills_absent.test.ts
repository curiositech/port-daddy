/**
 * Purser contract for #8908, obligation 5 — the two platform-specific skills
 * the PR names as excluded (airflow-dag-orchestrator,
 * android-background-task-specialist) must actually be absent from the
 * catalog.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft read
 * `metadata/audit-report.json` — a file no tooling in this repo produces
 * (`audit-skills.mjs` prints markdown or `--json` to STDOUT and writes
 * nothing) — so the suite crashed at import time. The catalog IS the
 * `skills/` directory; absence is checked there directly, alongside the
 * positive control that the import itself landed (an absent-because-nothing-
 * was-imported repo would vacuously pass the exclusion check).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');

describe('excluded platform-specific skills are omitted from the catalog', () => {
  test.each(['airflow-dag-orchestrator', 'android-background-task-specialist'])(
    '%s is not in skills/',
    (name) => {
      expect(existsSync(join(skillsDir, name))).toBe(false);
    },
  );

  test('positive control: the import itself is present (exclusion is a choice, not an empty repo)', () => {
    expect(existsSync(join(skillsDir, 'hypertree-planning', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'dag-chain-decomposition', 'SKILL.md'))).toBe(true);
  });
});
