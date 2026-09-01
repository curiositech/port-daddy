/**
 * Purser contract for #8908, obligations 1–2 — every imported skill meets the
 * governance parser's standards (appears in the audit with a well-formed
 * record) and `audit-skills.mjs` completes with zero hard failures.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft began
 * with a top-level `await fs.readdir(...)` without ever importing `fs` (or
 * defining `skillsDir`) — ReferenceError before any assertion ran. The
 * obligation is about what the GOVERNANCE TOOL reports, so this rewrite runs
 * the real `scripts/audit-skills.mjs --json` and asserts (a) exit 0 — the
 * "zero hard failures" bar the PR's own test plan claims — and (b) each of
 * the 14 imported skills appears in the report with the standard record
 * shape (path, class, missing[], reference flags), i.e. the parser accepted
 * its frontmatter rather than skipping or erroring on it.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const IMPORTED_SKILLS = [
  'cognitive-task-analysis',
  'dag-chain-decomposition',
  'dag-confidence-scorer',
  'dag-executor',
  'dag-fast-decomposition',
  'dag-orchestrator',
  'dag-output-validator',
  'dag-semantic-matcher',
  'dag-visual-editor-design',
  'expert-task-analysis',
  'hypertree-planning',
  'kieras-goms-for-task-analysis',
  'stanton-2006-hierarchical-task-analysis',
  'xie-et-al-2025-survey-llm-task-planning',
];

describe('audit-skills governance report covers the jury_rig import', () => {
  const result = spawnSync('node', [join(repoRoot, 'scripts', 'audit-skills.mjs'), '--json'], {
    encoding: 'utf-8',
    cwd: repoRoot,
  });

  test('audit-skills.mjs exits 0 — zero hard failures with the import present', () => {
    expect(result.status).toBe(0);
  });

  test('all 14 imported skills appear in the report with well-formed records', () => {
    const report = JSON.parse(result.stdout);
    expect(Array.isArray(report.skills)).toBe(true);
    for (const name of IMPORTED_SKILLS) {
      const record = report.skills.find(
        (s: any) => s.path === `skills/${name}/SKILL.md`,
      );
      expect(record).toBeDefined();
      // The standard field profile every audited skill carries: the parser
      // read the frontmatter and classified it rather than erroring out.
      expect(typeof record.class).toBe('string');
      expect(Array.isArray(record.missing)).toBe(true);
      expect(typeof record.hasReferences).toBe('boolean');
    }
  });
});
