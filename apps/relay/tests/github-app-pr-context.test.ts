/**
 * Tests for the fleet run page's live PR-context reads (src/github-app.ts):
 * getPrMeta (title/size) and getPrDiff (unified diff, media-type Accept
 * header). Both take a token directly — no JWT/App-auth simulation needed,
 * unlike getRepoToken's installation-token minting path.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPrMeta, getPrDiff } from '../src/github-app.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    return handler(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('getPrMeta', () => {
  it('returns title/size/url from the PR JSON', async () => {
    stubFetch(url => {
      expect(url).toBe('https://api.github.com/repos/octo/widgets/pulls/7');
      return Response.json({
        title: 'Fix the purser hallucination bug',
        body: 'details',
        additions: 40,
        deletions: 5,
        changed_files: 3,
        html_url: 'https://github.com/octo/widgets/pull/7',
      });
    });
    const meta = await getPrMeta('octo', 'widgets', 7, 'tok');
    expect(meta).toEqual({
      title: 'Fix the purser hallucination bug',
      body: 'details',
      additions: 40,
      deletions: 5,
      changedFiles: 3,
      htmlUrl: 'https://github.com/octo/widgets/pull/7',
    });
  });

  it('returns null on a non-2xx response', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));
    expect(await getPrMeta('octo', 'widgets', 7, 'tok')).toBeNull();
  });

  it('returns null when the response has no title (malformed/unexpected shape)', async () => {
    stubFetch(() => Response.json({ additions: 1 }));
    expect(await getPrMeta('octo', 'widgets', 7, 'tok')).toBeNull();
  });

  it('defaults body to null and htmlUrl to a derived URL when GitHub omits them', async () => {
    stubFetch(() => Response.json({ title: 'x', additions: 0, deletions: 0, changed_files: 0 }));
    const meta = await getPrMeta('octo', 'widgets', 9, 'tok');
    expect(meta?.body).toBeNull();
    expect(meta?.htmlUrl).toBe('https://github.com/octo/widgets/pull/9');
  });
});

describe('getPrDiff', () => {
  const DIFF = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';

  it('requests the diff media type and returns the full text untruncated', async () => {
    const mock = stubFetch((url, init) => {
      expect(url).toBe('https://api.github.com/repos/octo/widgets/pulls/7');
      expect((init?.headers as Record<string, string>)?.Accept).toBe('application/vnd.github.v3.diff');
      return new Response(DIFF, { status: 200 });
    });
    const diff = await getPrDiff('octo', 'widgets', 7, 'tok');
    expect(diff).toEqual({ text: DIFF, truncated: false });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('truncates a diff larger than the bound and marks it truncated', async () => {
    const huge = 'x'.repeat(250_000);
    stubFetch(() => new Response(huge, { status: 200 }));
    const diff = await getPrDiff('octo', 'widgets', 7, 'tok');
    expect(diff?.truncated).toBe(true);
    expect(diff?.text.length).toBeLessThan(huge.length);
  });

  it('returns null on a non-2xx response', async () => {
    stubFetch(() => new Response('nope', { status: 403 }));
    expect(await getPrDiff('octo', 'widgets', 7, 'tok')).toBeNull();
  });

  it('returns null instead of throwing when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await getPrDiff('octo', 'widgets', 7, 'tok')).toBeNull();
  });
});
