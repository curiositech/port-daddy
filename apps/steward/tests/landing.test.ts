/**
 * Landing-primitive tests: the protected-path predicate, the files read, and
 * the squash-merge executor's never-throw contract — every failure path must
 * come back as an honest `{landed: false, reason}` the deck log can print.
 */

import { describe, it, expect } from 'vitest';
import {
  fetchPrFiles,
  isProtectedPr,
  landPr,
  landFailKey,
  shipItKey,
  PROTECTED_PATHS,
} from '../src/landing.js';

describe('isProtectedPr — the surfaces where a merge changes who can do what', () => {
  it('flags every protected prefix, files-under-directories included', () => {
    for (const p of PROTECTED_PATHS) {
      expect(isProtectedPr([`${p}${p.endsWith('/') ? 'deep/file.ts' : ''}`])).toBe(true);
    }
    expect(isProtectedPr(['src/ok.ts', '.github/workflows/ci.yml'])).toBe(true);
  });

  it('passes ordinary code paths, near-misses included', () => {
    expect(isProtectedPr(['apps/steward/src/tick.ts', 'docs/plans/THE_FULL_WHEEL.md'])).toBe(false);
    // Near-miss: auth.test.ts does not start with the protected auth.ts path.
    expect(isProtectedPr(['apps/relay/src/auth.test.ts'])).toBe(false);
  });

  it('an empty file list is not protected', () => {
    expect(isProtectedPr([])).toBe(false);
  });
});

describe('storage key vocabulary', () => {
  it('grant and fail keys are per-PR and prefix-scannable', () => {
    expect(shipItKey(41)).toBe('shipit:41');
    expect(landFailKey(41)).toBe('landfails:41');
  });
});

describe('fetchPrFiles — one page, at landing time only', () => {
  it('maps filenames and throws on a non-OK read', async () => {
    const ok = async () =>
      new Response(JSON.stringify([{ filename: 'a.ts' }, { filename: 'b.ts' }]), { status: 200 });
    expect(await fetchPrFiles('o', 'r', 1, 'tok', ok)).toEqual(['a.ts', 'b.ts']);
    await expect(
      fetchPrFiles('o', 'r', 1, 'tok', async () => new Response('x', { status: 502 })),
    ).rejects.toThrow('502');
  });
});

describe('landPr — squash only, never throws', () => {
  it('a merged response returns the sha', async () => {
    let sentBody = '';
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 'land-tok',
      fetchImpl: async (url, init) => {
        expect(url).toContain('/pulls/9/merge');
        sentBody = String(init?.body);
        return new Response(JSON.stringify({ sha: 'abc123', merged: true }), { status: 200 });
      },
    });
    expect(r).toMatchObject({ landed: true, sha: 'abc123' });
    expect(JSON.parse(sentBody)).toEqual({ merge_method: 'squash' });
  });

  it.each([
    [405, 'Merge commits are not allowed on this repository.'],
    [409, 'Head branch was modified.'],
    [403, 'Resource not accessible by personal access token'],
  ])('a %s failure returns an honest reason carrying the status', async (status, message) => {
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 't',
      fetchImpl: async () => new Response(JSON.stringify({ message }), { status }),
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain(String(status));
    expect(r.reason).toContain(message);
  });

  it('a network-level throw is caught into a reason, never rethrown', async () => {
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 't',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('ECONNRESET');
  });
});
