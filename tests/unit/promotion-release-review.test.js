import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  buildEmissionPlan,
  buildPromotionReviewPayload,
  buildPromotionReviewTuple,
  summarizeChangedFiles,
} from '../../scripts/emit-promotion-release-review.mjs';

const ROOT = join(import.meta.dirname, '..', '..');

describe('promotion release-surface review', () => {
  test('payload names the release surfaces that must be checked before live truth moves', () => {
    const payload = buildPromotionReviewPayload({
      devDir: ROOT,
      stableDir: '/tmp/port-daddy-stable',
      project: 'port-daddy',
      sourceSha: 'abc1234',
      stableSha: 'def5678',
      channel: 'promotion:release-surfaces',
      changedFiles: ['lib/client.ts', 'skills/port-daddy-agent-skill/SKILL.md'],
    });

    expect(payload.type).toBe('promotion.release_surfaces.review_requested');
    expect(payload.project).toBe('port-daddy');
    expect(payload.sourceSha).toBe('abc1234');
    expect(payload.stableSha).toBe('def5678');
    expect(payload.surfaces).toEqual(expect.arrayContaining([
      'README.md',
      'website-v2',
      'website tutorials',
      'CLI help and completions',
      'SDK reference',
      'skills/port-daddy-agent-skill',
    ]));
    expect(payload.changedFiles).toEqual(['skills/port-daddy-agent-skill/SKILL.md', 'lib/client.ts']);
    expect(payload.changedFileCount).toBe(2);
    expect(payload.changedFilesTruncated).toBe(false);
    expect(payload.ignoredChangedFileCount).toBe(0);
    expect(payload.guidance.join('\n')).toMatch(/Do not spawn additional agents/);
  });

  test('changed-file summaries filter generated artifacts and cap payload size', () => {
    const summary = summarizeChangedFiles([
      'README.md',
      'core/pd-barnacle/target/release/pd-barnacle',
      'node_modules/pkg/index.js',
      'skills/port-daddy-agent-skill/SKILL.md',
      'website-v2/dist/assets/app.js',
    ], 1);

    expect(summary.changedFiles).toEqual(['README.md']);
    expect(summary.changedFileCount).toBe(2);
    expect(summary.changedFilesTruncated).toBe(true);
    expect(summary.ignoredChangedFileCount).toBe(3);
  });

  test('emission plan uses tuples and pub/sub instead of directly spawning agents', () => {
    const plan = buildEmissionPlan({
      devDir: ROOT,
      stableDir: '/tmp/port-daddy-stable',
      project: 'port-daddy',
      sourceSha: 'abc1234',
      stableSha: 'def5678',
      channel: 'promotion:release-surfaces',
      changedFiles: ['README.md'],
      ttlMs: 12345,
      sender: 'test-promoter',
    });

    expect(plan.harbor).toBe('port-daddy:fleet');
    expect(plan.ttlMs).toBe(12345);
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toMatchObject({
      name: 'tuple',
      command: 'pd',
      args: expect.arrayContaining(['tuple', 'out', '--harbor', 'port-daddy:fleet', '--ttl', '12345', '--as', 'test-promoter']),
    });
    expect(plan.commands[1]).toMatchObject({
      name: 'publish',
      command: 'pd',
      args: expect.arrayContaining(['pub', 'promotion:release-surfaces', '--sender', 'test-promoter', '--signal', 'pan-pan']),
    });
    expect(plan.commands.map((command) => command.args.slice(0, 2))).toEqual([
      ['tuple', 'out'],
      ['pub', 'promotion:release-surfaces'],
    ]);
  });

  test('tuple starts with a stable promotion release-surface pattern', () => {
    const tuple = buildPromotionReviewTuple({
      project: 'port-daddy',
      sourceSha: 'abc1234',
      sourceBranch: 'main',
      stableSha: 'def5678',
      devDir: ROOT,
      stableDir: '/tmp/port-daddy-stable',
      surfaces: ['README.md'],
      changedFiles: ['README.md'],
    });

    expect(tuple[0]).toBe('promotion:release-surfaces');
    expect(tuple[1]).toBe('port-daddy');
    expect(tuple[2]).toBe('abc1234');
    expect(tuple[3]).toMatchObject({
      sourceBranch: 'main',
      stableSha: 'def5678',
      surfaces: ['README.md'],
      changedFiles: ['README.md'],
    });
  });

  test('promote-stable emits review before merging into stable', () => {
    const script = readFileSync(join(ROOT, 'scripts/promote-stable.sh'), 'utf8');

    const reviewIndex = script.indexOf('emit-promotion-release-review.mjs');
    const mergeIndex = script.indexOf('git merge main');

    expect(reviewIndex).toBeGreaterThan(-1);
    expect(mergeIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeLessThan(mergeIndex);
    expect(script).toMatch(/PORT_DADDY_PROMOTION_REVIEW_ONLY/);
    expect(script).toMatch(/PORT_DADDY_PROMOTION_REVIEW_REQUIRED/);
  });

  test('promote-stable treats global npm link as best-effort', () => {
    const script = readFileSync(join(ROOT, 'scripts/promote-stable.sh'), 'utf8');

    expect(script).toContain('npm link');
    expect(script).toContain('WARNING: npm link failed');
    expect(script).toContain('continuing with direct stable daemon paths');
  });

  test('Port Daddy fleet wakes documentarian from promotion review with spawn controls', () => {
    const yaml = parseYaml(readFileSync(join(ROOT, 'pd-fleet.yml'), 'utf8'));
    const documentarian = yaml.fleet.agents.documentarian;

    expect(documentarian.trigger).toBe('promotion:release-surfaces');
    expect(documentarian.singleton).toBe(true);
    expect(documentarian.cooldown_ms).toBeGreaterThan(0);
    expect(documentarian.dedupe_window_ms).toBeGreaterThan(0);
    expect(documentarian.backoff_base_ms).toBeGreaterThan(0);
    expect(documentarian.backoff_max_ms).toBeGreaterThan(documentarian.backoff_base_ms);
    expect(yaml.fleet.channels['promotion:release-surfaces'].external_producer).toBe('scripts/promote-stable.sh');
    expect(yaml.fleet.channels['promotion:release-surfaces'].consumers).toContain('documentarian');
    expect(yaml.fleet.channels['git:committed'].consumers).not.toContain('documentarian');
  });
});
