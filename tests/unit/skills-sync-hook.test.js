/**
 * Integration guard for the every-turn skills-sync hook (operator directive
 * 2026-07-04): skills/ must stay synced with the agent-available skill set,
 * fanned out via scripts/sync-skills.ts, and that script must actually
 * resolve the repo catalog end-to-end.
 *
 * The 2026-07-04 wiring ran sync-skills.ts directly from a repository
 * UserPromptSubmit hook in .claude/settings.json. PR #10104 ("make disabled
 * hooks truly inert") superseded that: the operator's emergency halt now
 * requires every Port Daddy-provided hook to route through the
 * `~/.port-daddy/hooks.disabled` kill switch, which a raw `npx tsx
 * scripts/sync-skills.ts` command in settings.json cannot check on its own.
 * Repository hook registrations were removed while halted, so
 * .claude/settings.json intentionally carries no UserPromptSubmit hook right
 * now — this guard asserts that absence instead of the old wiring.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('skills sync hook', () => {
  test('settings.json carries no UserPromptSubmit hook while Port Daddy hooks remain halted (PR #10104)', () => {
    const settings = JSON.parse(
      readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'),
    );
    const entries = settings.hooks?.UserPromptSubmit ?? [];
    const commands = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? '');
    expect(
      commands.some((c) => c.includes('scripts/sync-skills.ts') && c.includes('--scope user')),
    ).toBe(false);
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
