import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

describe('continuous docs and atomic release governance', () => {
  test('every GitHub push wakes an undeduped low-tier Documentarian pass', () => {
    const fleet = parse(readFileSync('pd-fleet.yml', 'utf8')).fleet;
    const documentarian = fleet.agents.documentarian;
    expect(documentarian.trigger).toEqual(expect.arrayContaining([
      'github:curiositech/port-daddy:push',
      'promotion:release-surfaces',
    ]));
    expect(documentarian.model_tier).toBe('low');
    expect(documentarian.cooldown_ms).toBe(0);
    expect(documentarian.dedupe_window_ms).toBe(0);
    expect(documentarian.worktree).toBe(true);
    expect(documentarian.prompt).toContain('documentarian:push-reviewed');
    expect(documentarian.prompt).toMatch(/Read the\s+tuple back/);
    expect(fleet.channels['github:curiositech/port-daddy:push'].consumers).toContain('documentarian');
  });

  test('all release build lanes depend on the exact-tree review receipt gate', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toContain('release-doc-review:');
    expect(workflow).toContain('node scripts/check-release-doc-review.mjs');
    for (const job of ['build-binaries', 'build-fleetbar-preview', 'build-pd-console-app']) {
      const block = workflow.slice(workflow.indexOf(`  ${job}:`));
      expect(block.split('\n').slice(0, 5).join('\n')).toContain('needs: release-doc-review');
    }
    const homebrew = workflow.slice(workflow.indexOf('  update-homebrew:'));
    expect(homebrew).toContain('needs: [release-doc-review, build-binaries, build-fleetbar-preview]');
    expect(homebrew).toContain("needs.release-doc-review.result == 'success'");
  });
});
