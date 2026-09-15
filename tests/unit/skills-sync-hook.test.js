/**
 * Integration guard for the every-turn skills-sync hook (operator directive
 * 2026-07-04): skills/ must stay synced with the agent-available skill set,
 * fanned out via scripts/sync-skills.ts, and that script must actually
 * resolve the repo catalog end-to-end.
 *
 * The 2026-07-04 wiring ran sync-skills.ts directly from a repository
 * UserPromptSubmit hook in .claude/settings.json. PR #10104 ("make disabled
 * hooks truly inert") briefly removed that repository hook registration
 * entirely while the halt directive was being worked out, because a raw
 * `npx tsx scripts/sync-skills.ts` command in settings.json could not check
 * the `~/.port-daddy/hooks.disabled` kill switch on its own. The hook has
 * since been restored, wrapped with an inline halt-marker check
 * (`[ -e "${PD_HOME:-$HOME/.port-daddy}/hooks.disabled" ] || npx tsx
 * scripts/sync-skills.ts ...`), so the wiring is present again and this guard
 * checks for that inline check rather than a bare invocation.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('skills sync hook', () => {
  test('settings.json wires UserPromptSubmit to sync-skills.ts, guarded by the hooks.disabled halt marker', () => {
    const settings = JSON.parse(
      readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'),
    );
    const entries = settings.hooks?.UserPromptSubmit ?? [];
    const commands = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? '');
    expect(
      commands.some(
        (c) => c.includes('scripts/sync-skills.ts')
          && c.includes('--scope user')
          && c.includes('hooks.disabled'),
      ),
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
