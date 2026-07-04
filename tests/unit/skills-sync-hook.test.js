/**
 * Integration guard for the every-turn skills-sync hook (operator directive
 * 2026-07-04): the repo's .claude/settings.json must carry a UserPromptSubmit
 * hook that fans skills/ out to the agent runtimes via scripts/sync-skills.ts,
 * and that script must actually resolve the repo catalog end-to-end.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

const REPO = join(__dirname, '..', '..');

describe('skills sync hook', () => {
  test('settings.json wires sync-skills into UserPromptSubmit', () => {
    const settings = JSON.parse(
      readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'),
    );
    const entries = settings.hooks?.UserPromptSubmit ?? [];
    const commands = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? '');
    expect(
      commands.some((c) => c.includes('scripts/sync-skills.ts') && c.includes('--scope user')),
    ).toBe(true);
  });

  test('sync-skills resolves the repo catalog into a fresh base (integration)', () => {
    // A throwaway base dir proves the full pipeline (catalog discovery, union
    // resolution, symlink planning) works without touching the real $HOME.
    const base = mkdtempSync(join(os.tmpdir(), 'pd-skill-sync-'));
    try {
      execFileSync(
        'npx',
        ['tsx', 'scripts/sync-skills.ts', '--scope', 'user', '--base', base],
        { cwd: REPO, encoding: 'utf8', timeout: 120_000 },
      );
      // Assert against the filesystem, not the summary JSON (whose shape is
      // environment-dependent): the run must have materialized real links
      // under the throwaway base, including the repo's first-party skill.
      const { readdirSync, lstatSync } = require('node:fs');
      const linkDir = join(base, '.claude', 'skills');
      const entries = readdirSync(linkDir);
      expect(entries.length).toBeGreaterThan(10);
      expect(entries).toContain('port-daddy-agent-skill');
      expect(lstatSync(join(linkDir, 'port-daddy-agent-skill')).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
