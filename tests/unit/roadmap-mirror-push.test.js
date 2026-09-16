/**
 * Unit tests for lib/roadmap-mirror-push.ts — the producer for the relay's
 * roadmap mirror.
 *
 * WHAT THESE ARE FOR. The relay side of this (`PUT /v1/roadmap/snapshot`, the
 * D1 replica, migration `2026-08-22-roadmap-mirror.sql`) shipped in August and
 * is well covered by `apps/relay/tests/roadmap-mirror.test.ts`. What never
 * existed was anything that pushes to it, so the failure modes this file pins
 * are the ones that live entirely on the sending side and that the relay can
 * only answer for with a 4xx after the request is already spent:
 *
 *   - the watermark. `generatedAt` is the DAEMON's clock, and it is the only
 *     staleness signal the mirror has. Re-stamping it on the way out would make
 *     a two-week-old roadmap read as this minute's, which is worse than not
 *     pushing at all. The first test is the one that matters most here.
 *   - the status ladder. The daemon's `RoadmapStatus` and the mirror's CHECK
 *     constraint are the same five values today; if they ever diverge, the
 *     translation must name the offending item rather than let the relay refuse
 *     318 items over one of them.
 *   - the ceilings, restated locally so an operator reads the number.
 */

import { describe, it, expect } from '@jest/globals';
import {
  toMirrorPayload,
  checkMirrorPayloadFits,
  pushRoadmapMirror,
  normalizeRepoFullName,
  repoFromGitRemote,
  resolveMirrorRepo,
  MirrorTranslationError,
  MIRROR_MAX_ITEMS,
} from '../../lib/roadmap-mirror-push.js';

/** A snapshot in the exact shape `buildRoadmapSnapshot` and the committed file use. */
function snapshot(items, generatedAt = 1788149878497) {
  return { generatedAt, harbor: 'port-daddy', source: 'http://127.0.0.1:9876', count: items.length, items };
}

const ONE = [{ slug: 'roadmap-link-gate', status: 'now', summaryMd: 'Gate PRs on a roadmap link.' }];

describe('the watermark travels with the data', () => {
  it('carries the snapshot generatedAt through verbatim', () => {
    const payload = toMirrorPayload(snapshot(ONE, 1234567890123), 'curiositech/port-daddy');
    expect(payload.generatedAt).toBe(1234567890123);
  });

  it('does not re-stamp an old snapshot with the current clock', () => {
    // The fallback path pushes a snapshot exported days ago. If this ever
    // starts returning something near Date.now(), the mirror's staleness
    // subtraction silently reports every push as fresh.
    const twoWeeksAgo = Date.now() - 14 * 24 * 3600 * 1000;
    const payload = toMirrorPayload(snapshot(ONE, twoWeeksAgo), 'curiositech/port-daddy');
    expect(payload.generatedAt).toBe(twoWeeksAgo);
    expect(Date.now() - payload.generatedAt).toBeGreaterThan(13 * 24 * 3600 * 1000);
  });

  it('carries the harbor from the snapshot, not from a default', () => {
    const s = snapshot(ONE);
    s.harbor = 'some-other-harbor';
    expect(toMirrorPayload(s, 'curiositech/port-daddy').harbor).toBe('some-other-harbor');
  });
});

describe('status translation', () => {
  it('accepts all five lanes the mirror stores', () => {
    const items = ['now', 'backlog', 'parked', 'merge', 'done'].map((status, i) => ({
      slug: `item-${i}-slug`,
      status,
      summaryMd: '',
    }));
    expect(toMirrorPayload(snapshot(items), 'a/b').items).toHaveLength(5);
  });

  it('refuses a status the mirror cannot store, naming the item and the ladder', () => {
    const items = [...ONE, { slug: 'someday-item', status: 'someday', summaryMd: '' }];
    expect(() => toMirrorPayload(snapshot(items), 'a/b')).toThrow(MirrorTranslationError);
    try {
      toMirrorPayload(snapshot(items), 'a/b');
    } catch (err) {
      expect(err.message).toContain('someday-item');
      expect(err.message).toContain('someday');
      expect(err.message).toContain('backlog');
    }
  });

  it('refuses an item with no slug rather than sending a blank key', () => {
    expect(() => toMirrorPayload(snapshot([{ slug: '  ', status: 'now', summaryMd: 'x' }]), 'a/b')).toThrow(
      MirrorTranslationError,
    );
  });

  it('defaults a missing summary to empty rather than the string "undefined"', () => {
    const [item] = toMirrorPayload(snapshot([{ slug: 'no-summary-here', status: 'now' }]), 'a/b').items;
    expect(item.summaryMd).toBe('');
  });
});

describe('the relay ceilings, checked before a request is spent', () => {
  it('accepts the real committed snapshot size', () => {
    const items = Array.from({ length: 318 }, (_, i) => ({
      slug: `slug-number-${i}`,
      status: 'backlog',
      summaryMd: 'A summary of roughly the length the real export carries.',
    }));
    const fit = checkMirrorPayloadFits(toMirrorPayload(snapshot(items), 'a/b'));
    expect(fit.ok).toBe(true);
    expect(fit.bytes).toBeGreaterThan(0);
  });

  it('refuses more items than the relay would accept, naming the ceiling', () => {
    const items = Array.from({ length: MIRROR_MAX_ITEMS + 1 }, (_, i) => ({
      slug: `slug-number-${i}`,
      status: 'backlog',
      summaryMd: '',
    }));
    const fit = checkMirrorPayloadFits(toMirrorPayload(snapshot(items), 'a/b'));
    expect(fit.ok).toBe(false);
    expect(fit.reason).toContain(String(MIRROR_MAX_ITEMS));
    expect(fit.reason).toContain('TOO_MANY_ITEMS');
  });

  it('refuses a body over the byte ceiling even with few items', () => {
    const items = [{ slug: 'one-big-item', status: 'now', summaryMd: 'x'.repeat(3 * 1024 * 1024) }];
    const fit = checkMirrorPayloadFits(toMirrorPayload(snapshot(items), 'a/b'));
    expect(fit.ok).toBe(false);
    expect(fit.reason).toContain('PAYLOAD_TOO_LARGE');
  });
});

describe('repository naming', () => {
  it('accepts owner/name and rejects everything else', () => {
    expect(normalizeRepoFullName('curiositech/port-daddy')).toBe('curiositech/port-daddy');
    expect(normalizeRepoFullName(' curiositech/port-daddy ')).toBe('curiositech/port-daddy');
    for (const bad of ['port-daddy', 'a/b/c', '/b', 'a/', '', null, undefined, '../etc/passwd']) {
      expect(normalizeRepoFullName(bad)).toBeNull();
    }
  });

  it('refuses a dot-leading segment, which is a traversal shape in a URL path', () => {
    expect(normalizeRepoFullName('../curiositech')).toBeNull();
    expect(normalizeRepoFullName('curiositech/..')).toBeNull();
  });

  it('reads owner/name out of both SSH and HTTPS remotes', () => {
    expect(repoFromGitRemote('git@github.com:curiositech/port-daddy.git')).toBe('curiositech/port-daddy');
    expect(repoFromGitRemote('https://github.com/curiositech/port-daddy.git')).toBe('curiositech/port-daddy');
    expect(repoFromGitRemote('https://github.com/curiositech/port-daddy')).toBe('curiositech/port-daddy');
    expect(repoFromGitRemote('not a url')).toBeNull();
    expect(repoFromGitRemote(null)).toBeNull();
  });
});

  // The rule the push handler used to carry inline, where no test could reach
  // it without an account, a daemon and a git remote. It is the branch that
  // decides whose board this roadmap lands on, so it is worth being able to
  // state in four cases rather than inferring it from a comment.
  describe('which repository a push is for', () => {
    const REMOTE = 'git@github.com:someone-else/their-repo.git';

    it('takes what the operator named, and never looks at the remote', () => {
      expect(resolveMirrorRepo('curiositech/port-daddy', REMOTE))
        .toEqual({ repo: 'curiositech/port-daddy' });
    });

    it('falls back to the remote only when the operator named nothing', () => {
      expect(resolveMirrorRepo(null, REMOTE)).toEqual({ repo: 'someone-else/their-repo' });
      expect(resolveMirrorRepo('   ', REMOTE)).toEqual({ repo: 'someone-else/their-repo' });
    });

    it('fails on an unusable name rather than pushing to the remote instead', () => {
      // The one that matters. A typo'd --repo silently resolving to the origin
      // remote would mirror this roadmap over another repository's board and
      // print a success line while doing it.
      for (const typo of ['port-dady', 'curiositech/port-daddy/extra', '../etc/passwd', 'a/']) {
        expect(resolveMirrorRepo(typo, REMOTE)).toEqual({ repo: null, reason: 'named-unusable' });
      }
    });

    it('says which failure it was when there is no name and no readable remote', () => {
      expect(resolveMirrorRepo(null, null)).toEqual({ repo: null, reason: 'no-remote' });
      expect(resolveMirrorRepo(null, 'not a url')).toEqual({ repo: null, reason: 'no-remote' });
    });
  });


describe('the push itself', () => {
  function capturingFetch(response) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      return response;
    };
    return { impl, calls };
  }

  it('PUTs to /v1/roadmap/snapshot with the bearer token and the JSON body', async () => {
    const { impl, calls } = capturingFetch({ ok: true, status: 200, text: async () => '{"itemCount":1}' });
    const payload = toMirrorPayload(snapshot(ONE), 'curiositech/port-daddy');
    const result = await pushRoadmapMirror({
      relayUrl: 'https://relay.portdaddy.dev/',
      token: 'pdu_test',
      payload,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://relay.portdaddy.dev/v1/roadmap/snapshot');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers.Authorization).toBe('Bearer pdu_test');
    expect(JSON.parse(calls[0].init.body).repoFullName).toBe('curiositech/port-daddy');
    expect(result.ok).toBe(true);
    expect(result.body.itemCount).toBe(1);
  });

  it('returns a refusal rather than throwing, and surfaces the relay error code', async () => {
    const { impl } = capturingFetch({ ok: false, status: 413, text: async () => '{"error":"TOO_MANY_ITEMS"}' });
    const result = await pushRoadmapMirror({
      relayUrl: 'https://relay.portdaddy.dev',
      token: 'pdu_test',
      payload: toMirrorPayload(snapshot(ONE), 'a/b'),
      fetchImpl: impl,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(413);
    expect(result.error).toBe('TOO_MANY_ITEMS');
  });

  it('survives a non-JSON body without losing the status', async () => {
    const { impl } = capturingFetch({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' });
    const result = await pushRoadmapMirror({
      relayUrl: 'https://relay.portdaddy.dev',
      token: 'pdu_test',
      payload: toMirrorPayload(snapshot(ONE), 'a/b'),
      fetchImpl: impl,
    });
    expect(result.status).toBe(502);
    expect(result.body).toBeNull();
    expect(result.error).toBeNull();
  });
});
