/**
 * Tests for the cloud skill graft (src/skill-graft.ts): trusted-branch fetch of
 * skills/<id>/SKILL.md, per-run caching, the 3-per-ship cap, ~6KB truncation,
 * slug validation, and the unknown-id → `missing` (warning, never failure)
 * contract.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSkillGraftCache,
  MAX_GRAFTS_PER_SHIP,
  SKILL_GRAFT_CHAR_LIMIT,
} from '../src/skill-graft.js';

function fetcher(files: Record<string, string>) {
  return vi.fn(async (path: string) => files[path] ?? null);
}

describe('createSkillGraftCache', () => {
  it('grafts a known skill under a "## Grafted skill: <id>" heading', async () => {
    const fetchFile = fetcher({ 'skills/steel-man-argument/SKILL.md': '# Steel-man\n\nDo the thing.' });
    const cache = createSkillGraftCache(fetchFile);
    const g = await cache.graftFor(['steel-man-argument']);
    expect(g.loaded).toEqual(['steel-man-argument']);
    expect(g.missing).toEqual([]);
    expect(g.text).toContain('## Grafted skill: steel-man-argument');
    expect(g.text).toContain('Do the thing.');
    expect(fetchFile).toHaveBeenCalledWith('skills/steel-man-argument/SKILL.md');
  });

  it('unknown ids land in `missing` and never throw (warning contract)', async () => {
    const cache = createSkillGraftCache(fetcher({}));
    const g = await cache.graftFor(['nope-not-a-skill']);
    expect(g.loaded).toEqual([]);
    expect(g.missing).toEqual(['nope-not-a-skill']);
    expect(g.text).toBe('');
  });

  it('a throwing fetcher degrades to missing (a graft can never crash a run)', async () => {
    const cache = createSkillGraftCache(async () => {
      throw new Error('network down');
    });
    const g = await cache.graftFor(['a-skill']);
    expect(g.missing).toEqual(['a-skill']);
    expect(g.text).toBe('');
  });

  it('caps at MAX_GRAFTS_PER_SHIP ids and dedupes', async () => {
    const files: Record<string, string> = {};
    for (const id of ['a', 'b', 'c', 'd']) files[`skills/${id}/SKILL.md`] = `skill ${id}`;
    const fetchFile = fetcher(files);
    const cache = createSkillGraftCache(fetchFile);
    const g = await cache.graftFor(['a', 'a', 'b', 'c', 'd']);
    expect(MAX_GRAFTS_PER_SHIP).toBe(3);
    expect(g.loaded).toEqual(['a', 'b', 'c']); // deduped, capped — 'd' never fetched
    expect(fetchFile).not.toHaveBeenCalledWith('skills/d/SKILL.md');
  });

  it('caches per run: two ships grafting the same skill fetch it once', async () => {
    const fetchFile = fetcher({ 'skills/x/SKILL.md': 'body' });
    const cache = createSkillGraftCache(fetchFile);
    await cache.graftFor(['x']);
    await cache.graftFor(['x']);
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it('caches misses too — an unknown id is fetched once, not per ship', async () => {
    const fetchFile = fetcher({});
    const cache = createSkillGraftCache(fetchFile);
    await cache.graftFor(['ghost']);
    await cache.graftFor(['ghost']);
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it('truncates an oversized skill to ~6KB with an honest marker', async () => {
    const big = 'a'.repeat(SKILL_GRAFT_CHAR_LIMIT * 3);
    const cache = createSkillGraftCache(fetcher({ 'skills/big/SKILL.md': big }));
    const g = await cache.graftFor(['big']);
    expect(g.text.length).toBeLessThan(SKILL_GRAFT_CHAR_LIMIT + 200);
    expect(g.text).toContain(`truncated at ${SKILL_GRAFT_CHAR_LIMIT} chars`);
  });

  it('rejects path-traversal-shaped ids without ever fetching (config is not a path oracle)', async () => {
    const fetchFile = fetcher({ 'skills/../secrets/SKILL.md': 'evil' });
    const cache = createSkillGraftCache(fetchFile);
    const g = await cache.graftFor(['../secrets', 'a/b', '.hidden']);
    expect(g.loaded).toEqual([]);
    expect(g.missing).toEqual(['../secrets', 'a/b', '.hidden']);
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('the default purser graft skills exist in this repo (skills/<id>/SKILL.md)', async () => {
    // Pin the wiring to reality: the ids fleet.ts grafts by default must point
    // at real files in this repository, or the default is a silent no-op.
    const { PURSER_DEFAULT_GRAFT } = await import('../src/fleet.js');
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    for (const id of PURSER_DEFAULT_GRAFT) {
      const body = await readFile(`${root}/skills/${id}/SKILL.md`, 'utf8');
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
