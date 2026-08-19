/**
 * Unit tests for `upsertPrBodySection` (src/github.ts) — the primitive that
 * writes the purser's steel-man contract into the reviewed PR's BODY (the PR
 * summary), per the 2026-08-19 operator mandate: the steel-man argument and
 * its obligations are the best chronology of what a PR should be, and an
 * agent maintains that chronology in the summary itself, edit-in-place.
 *
 * These tests drive the function against a fetch stub because the shared
 * harness's GET /pulls/{n} always serves an empty body — the replace-in-place
 * and author-prose-preservation properties need a body that persists.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { upsertPrBodySection } from '../src/github.js';

const START = '<!-- pd-purser:contract:start -->';
const END = '<!-- pd-purser:contract:end -->';

interface Recorded {
  patched: string | null;
}

/** Stub fetch: GET /pulls serves `body`; PATCH records what was written. */
function stubPr(body: string | null, opts: { failGet?: boolean; failPatch?: boolean } = {}): Recorded {
  const rec: Recorded = { patched: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        if (opts.failGet) return new Response('nope', { status: 500 });
        return new Response(JSON.stringify({ number: 7, body }), { status: 200 });
      }
      if (opts.failPatch) return new Response('nope', { status: 403 });
      rec.patched = (JSON.parse(String(init?.body)) as { body: string }).body;
      return new Response(JSON.stringify({ number: 7 }), { status: 200 });
    }),
  );
  return rec;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const upsert = (section: string) =>
  upsertPrBodySection('o', 'r', 7, START, END, section, 'tok');

describe('upsertPrBodySection', () => {
  it('appends the marked section to a body that lacks it, preserving the author prose', async () => {
    const rec = stubPr('## Summary\nThe author wrote this.');
    expect(await upsert('CONTRACT v1')).toBe(true);
    expect(rec.patched).toBe(
      `## Summary\nThe author wrote this.\n\n${START}\nCONTRACT v1\n${END}`,
    );
  });

  it('replaces ONLY the marked section when re-run — idempotent edit-in-place', async () => {
    const rec = stubPr(`author intro\n\n${START}\nCONTRACT v1\n${END}\n\nauthor outro`);
    expect(await upsert('CONTRACT v2')).toBe(true);
    expect(rec.patched).toContain('CONTRACT v2');
    expect(rec.patched).not.toContain('CONTRACT v1');
    expect(rec.patched).toContain('author intro');
    expect(rec.patched).toContain('author outro');
  });

  it('is a no-op (no PATCH) when the body already carries the identical section', async () => {
    const rec = stubPr(`${START}\nCONTRACT v1\n${END}`);
    expect(await upsert('CONTRACT v1')).toBe(true);
    expect(rec.patched).toBeNull();
  });

  it('handles a null/empty PR body by writing just the section', async () => {
    const rec = stubPr(null);
    expect(await upsert('CONTRACT v1')).toBe(true);
    expect(rec.patched).toBe(`${START}\nCONTRACT v1\n${END}`);
  });

  it('returns false (never throws) when the GET or PATCH fails — the caller transcripts it', async () => {
    stubPr('x', { failGet: true });
    expect(await upsert('C')).toBe(false);
    stubPr('x', { failPatch: true });
    expect(await upsert('C')).toBe(false);
  });

  it("refuses to write past GitHub's 65536-char body cap rather than truncating a human's prose", async () => {
    const rec = stubPr('a'.repeat(65_000));
    expect(await upsert('b'.repeat(2_000))).toBe(false);
    expect(rec.patched).toBeNull();
  });
});
