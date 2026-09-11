import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTrustedShipContract,
  fetchPRContext,
  PullRequestDiffFetchError,
  MAX_FILES_BYTES,
  type PRFile,
} from '../src/github.js';

/** Stub the GitHub Contents response with the supplied decoded contract text. */
function stubTrustedContract(contract: string): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async () => new Response(
    JSON.stringify({ encoding: 'base64', content: btoa(contract) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTrustedShipContract', () => {
  it.each(['', ' \t\n'])('rejects a 200 payload whose decoded contract is only whitespace', async contract => {
    const fetcher = stubTrustedContract(contract);

    await expect(
      fetchTrustedShipContract('curiositech', 'port-daddy', 'code-reviewer', 'main', 'token'),
    ).rejects.toThrow('fleet/ships/code-reviewer.md returned an empty contract');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/curiositech/port-daddy/contents/fleet/ships/code-reviewer.md?ref=main',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('returns a nonblank trusted contract verbatim', async () => {
    stubTrustedContract('## Reviewer contract\n\nFind concrete defects.\n');

    await expect(
      fetchTrustedShipContract('curiositech', 'port-daddy', 'code-reviewer', 'main', 'token'),
    ).resolves.toBe('## Reviewer contract\n\nFind concrete defects.\n');
  });
});

// ---------------------------------------------------------------------------
// fetchPRContext / raw-diff 406 fallback

const OWNER = 'curiositech';
const REPO = 'port-daddy';
const PR_NUMBER = 10077;
const PR_URL = `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}`;

const MINIMAL_EVENT_PAYLOAD = {
  number: PR_NUMBER,
  title: 'event title (must not win over the live PR)',
  body: 'event body',
  head: { sha: 'HEADSHA', ref: 'feat/widget' },
  base: { sha: 'BASESHA', ref: 'main' },
};

function livePrJson(): Response {
  return new Response(
    JSON.stringify({
      title: 'Add widget frobbing',
      body: 'Frobs the widget.',
      user: { login: 'a-human', type: 'User' },
      state: 'open',
      merged: false,
      head: { sha: 'HEADSHA', ref: 'feat/widget' },
      base: { sha: 'BASESHA', ref: 'main' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function makeFile(over: Partial<PRFile> & { filename: string }): PRFile {
  return { status: 'modified', additions: 1, deletions: 0, ...over };
}

/** Build a router-style fetch mock keyed on URL + the request's Accept header. */
function routedFetch(
  routes: Array<{
    match: (url: string, accept: string | undefined) => boolean;
    respond: () => Response;
  }>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const accept = headers.Accept;
    const route = routes.find(r => r.match(url, accept));
    if (!route) throw new Error(`unmocked fetch: ${url} (Accept: ${accept})`);
    return route.respond();
  });
}

describe('fetchPRContext raw-diff 406 fallback', () => {
  it('reconstructs a diff from every /files page when the raw diff is refused with 406', async () => {
    // 100 files on page 1 (a full page — /files must be walked past it),
    // 1 file on page 2 (the short page that ends pagination).
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeFile({ filename: `src/page1-file-${i}.ts`, patch: `@@ -1,1 +1,1 @@\n-old${i}\n+new${i}` }));
    const page2 = [makeFile({ filename: 'src/page2-file.ts', patch: '@@ -1,1 +1,1 @@\n-oldTail\n+newTail' })];

    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('not acceptable', { status: 406 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files') && url.includes('page=2'),
        respond: () => new Response(JSON.stringify(page2), { status: 200 }),
      },
      {
        match: url => url.includes('/files') && url.includes('page=1'),
        respond: () => new Response(JSON.stringify(page1), { status: 200 }),
      },
      // The concurrent (non-paginated) /files fetch that fetchPRContext also
      // issues; its result is unused on the reconstruction path.
      {
        match: url => url.includes('/files'),
        respond: () => new Response(JSON.stringify(page1), { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const ctx = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token');

    expect(ctx.diffSource).toBe('reconstructed-from-files');
    expect(ctx.diff).toContain('diff --git a/src/page1-file-0.ts b/src/page1-file-0.ts');
    expect(ctx.diff).toContain('+new0');
    expect(ctx.diff).toContain('diff --git a/src/page2-file.ts b/src/page2-file.ts');
    expect(ctx.diff).toContain('+newTail');
    expect(ctx.files).toHaveLength(101);
    expect(ctx.filesTruncated).toBe(false);
  });

  it('still throws PullRequestDiffFetchError on a non-406 failure', async () => {
    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('server error', { status: 500 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files'),
        respond: () => new Response(JSON.stringify([]), { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const err = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token').catch(e => e);
    expect(err).toBeInstanceOf(PullRequestDiffFetchError);
    expect((err as PullRequestDiffFetchError).status).toBe(500);
  });

  it('marks a patchless binary file with a "Binary files" marker rather than dropping it', async () => {
    const files = [
      makeFile({ filename: 'assets/logo.png', additions: 0, deletions: 0 }), // no `patch`
      makeFile({ filename: 'src/a.ts', patch: '@@ -1,1 +1,1 @@\n-old\n+new' }),
    ];

    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('not acceptable', { status: 406 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files'),
        respond: () => new Response(JSON.stringify(files), { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const ctx = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token');

    expect(ctx.diff).toContain('Binary files a/assets/logo.png and b/assets/logo.png differ');
    expect(ctx.diff).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(ctx.diffSource).toBe('reconstructed-from-files');
  });

  it('stops at the page ceiling and says so rather than reporting a whole diff', async () => {
    // Every page comes back full, so pagination never reaches a short page and
    // the walk runs out at MAX_RECONSTRUCT_FILE_PAGES. The danger this pins is
    // not the stopping — it is stopping QUIETLY: a diff that looks complete but
    // is missing everything past the ceiling would have the reviewer read a
    // fraction of the PR and call it reviewed. filesTruncated must be true.
    let pagesServed = 0;
    const fullPage = (page: number) =>
      Array.from({ length: 100 }, (_, i) =>
        makeFile({
          filename: `src/p${page}-f${i}.ts`,
          patch: `@@ -1,1 +1,1 @@\n-old${page}_${i}\n+new${page}_${i}`,
        }));

    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('not acceptable', { status: 406 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files') && url.includes('page='),
        respond: () => {
          pagesServed += 1;
          return new Response(JSON.stringify(fullPage(pagesServed)), { status: 200 });
        },
      },
      {
        match: url => url.includes('/files'),
        respond: () => new Response(JSON.stringify(fullPage(0)), { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const ctx = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token');

    expect(ctx.diffSource).toBe('reconstructed-from-files');
    expect(ctx.filesTruncated).toBe(true);
    // The walk stops; it does not keep asking GitHub for pages forever.
    expect(pagesServed).toBeLessThanOrEqual(40);
    expect(ctx.files.length).toBeGreaterThan(0);
  });

  it('treats a /files page that overruns MAX_FILES_BYTES as truncated, not as valid JSON', async () => {
    // readTextCapped stops reading at the byte ceiling, which leaves a JSON
    // fragment behind. Parsing that fragment would either throw or — worse, if
    // the cut happened to land somewhere parseable — yield a short file list
    // that looks like the whole PR. Either way the answer is the same: the walk
    // gives up on this page and marks the result truncated.
    const oversized = Array.from({ length: 100 }, (_, i) =>
      makeFile({
        filename: `src/huge-${i}.ts`,
        patch: `@@ -1,1 +1,1 @@\n-${'x'.repeat(60_000)}\n+${'y'.repeat(60_000)}`,
      }));
    const body = JSON.stringify(oversized);
    expect(body.length).toBeGreaterThan(MAX_FILES_BYTES);

    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('not acceptable', { status: 406 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files'),
        respond: () => new Response(body, { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const ctx = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token');

    expect(ctx.diffSource).toBe('reconstructed-from-files');
    expect(ctx.filesTruncated).toBe(true);
  });

  it('reports diffSource "raw" when the raw diff endpoint succeeds', async () => {
    const fetcher = routedFetch([
      {
        match: (url, accept) => url === PR_URL && accept === 'application/vnd.github.v3.diff',
        respond: () => new Response('diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new', { status: 200 }),
      },
      { match: url => url === PR_URL, respond: livePrJson },
      {
        match: url => url.includes('/files'),
        respond: () => new Response(JSON.stringify([makeFile({ filename: 'src/a.ts' })]), { status: 200 }),
      },
    ]);
    vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);

    const ctx = await fetchPRContext(OWNER, REPO, PR_NUMBER, MINIMAL_EVENT_PAYLOAD, 'token');

    expect(ctx.diffSource).toBe('raw');
    expect(ctx.diff).toContain('diff --git a/src/a.ts b/src/a.ts');
  });
});
