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

describe('landPr — enqueue only, never throws', () => {
  it('ENQUEUES rather than merging, and guards with the head it judged', async () => {
    // THE CORRECTION THIS PR EXISTS FOR. A direct merge on a queue-protected
    // repo is rejected outright (405 "Pull Request is in the merge queue") and,
    // where it would succeed, bypasses the protection it is supposed to obey.
    // The mutation name and the expectedHeadOid guard are BOTH asserted: the
    // guard is what stops the seat landing a commit it never reviewed if the
    // author pushes between verdict and enqueue.
    const sent: string[] = [];
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 'land-tok',
      fetchImpl: async (url, init) => {
        expect(String(url)).toContain('/graphql');
        const body = String(init?.body);
        sent.push(body);
        if (body.includes('pullRequest(number:')) {
          return new Response(
            JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_node1', headRefOid: 'deadbeefcafe' } } } }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: { position: 3, state: 'QUEUED' } } } }),
          { status: 200 },
        );
      },
    });

    expect(r.landed).toBe(true);
    expect(r.sha).toBe('deadbeefcafe');
    expect(r.reason).toContain('enqueued at position 3');
    // Never the REST merge verb.
    expect(sent.join(' ')).not.toContain('merge_method');
    const mutation = sent[1] ?? '';
    expect(mutation).toContain('enqueuePullRequest');
    // The head the lookup returned is the head the guard uses.
    expect(JSON.parse(mutation).variables).toMatchObject({ id: 'PR_node1', head: 'deadbeefcafe' });
  });

  it('refuses to claim a landing when the enqueue returns no queue entry', async () => {
    // A 200 with neither an entry nor an error is not success. Recording it as
    // one would put a landing in the merge ledger that never happened — the
    // single worst lie this seat could tell.
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 't',
      fetchImpl: async (_url, init) =>
        String(init?.body).includes('pullRequest(number:')
          ? new Response(JSON.stringify({ data: { repository: { pullRequest: { id: 'x', headRefOid: 'h' } } } }), { status: 200 })
          : new Response(JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: null } } }), { status: 200 }),
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('no merge-queue entry');
  });

  it('treats a GraphQL 200-with-errors as failure, not success', async () => {
    // GraphQL signals failure two ways — a bad status, and a 200 carrying an
    // `errors` array. Honouring only the first is the classic route to
    // recording a landing that never happened.
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 't',
      fetchImpl: async (_url, init) =>
        String(init?.body).includes('pullRequest(number:')
          ? new Response(JSON.stringify({ data: { repository: { pullRequest: { id: 'x', headRefOid: 'h' } } } }), { status: 200 })
          : new Response(
              JSON.stringify({ errors: [{ message: 'Head branch was modified' }] }),
              { status: 200 },
            ),
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('Head branch was modified');
  });

  it.each([
    [403, 'Resource not accessible by personal access token'],
    [502, 'Server Error'],
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

  it('reports a PR that cannot be resolved instead of enqueuing blind', async () => {
    const r = await landPr({
      owner: 'o',
      repo: 'r',
      prNumber: 9,
      token: 't',
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: { repository: { pullRequest: null } } }), { status: 200 }),
    });
    expect(r.landed).toBe(false);
    expect(r.reason).toContain('#9 not found');
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
