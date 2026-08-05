import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

describe('continuous documentation governance', () => {
  test('every GitHub push launches an undeduped low-tier Documentarian pass', () => {
    const fleet = parse(readFileSync('pd-fleet.yml', 'utf8')).fleet;
    const documentarian = fleet.agents.documentarian;

    expect(documentarian.trigger).toBe('github:webhook:push');
    expect(documentarian.model_tier).toBe('low');
    expect(documentarian.singleton).toBe(false);
    expect(documentarian.cooldown_ms).toBe(0);
    expect(documentarian.dedupe_window_ms).toBe(0);
    expect(documentarian.worktree).toBe(true);
    expect(documentarian.prompt).toContain('documentarian:push-reviewed:<source-sha>');
    expect(documentarian.prompt).toMatch(/Read the tuple back/);
    expect(documentarian.prompt).toContain('release-review-gate.mjs record-documentarian');
    expect(documentarian.prompt).toMatch(/CLEAN maps\s+to success; drift maps to failure/i);
    expect(documentarian.prompt).toMatch(/description must contain the full\s+source SHA/i);
    expect(fleet.channels['github:webhook:push'].consumers).toContain('documentarian');
    expect(fleet.channels['promotion:release-surfaces']).toBeUndefined();
    expect(JSON.stringify(fleet)).not.toContain('scripts/promote-stable.sh');
  });

  test('continuous pass explicitly keeps the major release review independent', () => {
    const fleet = parse(readFileSync('pd-fleet.yml', 'utf8')).fleet;
    const prompt = fleet.agents.documentarian.prompt;

    expect(prompt).toMatch(/does not replace the\s+exact-SHA steelman, countercase, and adversarial guide review/i);
    expect(prompt).toMatch(/missing or mismatched\s+evidence blocks Homebrew publication/i);
  });
});
