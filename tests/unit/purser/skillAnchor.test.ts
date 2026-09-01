// tests/unit/purser/skillAnchor.test.ts
import { lstat, readlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repository root from this test file.
 * The test lives at <repo>/tests/unit/purser/skillAnchor.test.ts,
 * so we need to go three levels up.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/* -------------------------------------------------------------------------
 *  Paths & expectations
 * ----------------------------------------------------------------------- */
const RULES_DIR = path.join(REPO_ROOT, '.cursor', 'rules');
const RULE_FILE = 'port-daddy-agent-skill.md';
const RULE_PATH = path.join(RULES_DIR, RULE_FILE);

/**
 * The contract states that the rule should be a symlink pointing at the
 * canonical skill definition.  In the repository the canonical location is
 * under `skills/port-daddy-agent-skill/SKILL.md`.  The absolute path may
 * differ on a developer's machine, so we allow an environment override.
 */
const DEFAULT_EXPECTED_TARGET = path.join(
  REPO_ROOT,
  'skills',
  'port-daddy-agent-skill',
  'SKILL.md',
);
const EXPECTED_TARGET = process.env.EXPECTED_TARGET ?? DEFAULT_EXPECTED_TARGET;

/* -------------------------------------------------------------------------
 *  Test suite
 * ----------------------------------------------------------------------- */
describe('Port Daddy Agent skill anchor (.cursor rule)', () => {
  test('rule file exists and is a symbolic link', async () => {
    const stats = await lstat(RULE_PATH);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  test('symlink resolves to the expected target', async () => {
    const linkTarget = await readlink(RULE_PATH);

    // Resolve relative symlinks to an absolute path for comparison.
    const resolvedTarget = path.isAbsolute(linkTarget)
      ? path.normalize(linkTarget)
      : path.normalize(path.resolve(path.dirname(RULE_PATH), linkTarget));

    const expected = path.normalize(EXPECTED_TARGET);
    expect(resolvedTarget).toBe(expected);
  });

  test('cursor rules engine can discover the rule file', async () => {
    const entries = await readdir(RULES_DIR);
    expect(entries).toContain(RULE_FILE);
  });
});