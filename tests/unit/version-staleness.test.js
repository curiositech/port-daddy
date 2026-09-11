/**
 * Unit tests for lib/version-staleness.ts — the passive once/day staleness nudge
 * (ADR-0054 Phase 2). It reuses lib/latest-manifest.ts for the feed schema +
 * semver math; these tests cover the thin throttle/nudge layer it adds. All
 * network / clock / state are injected, so they touch neither the network nor
 * ~/.port-daddy.
 */

describe('version-staleness: behind + nudge', () => {
  test('isBehind reuses latest-manifest semver (numeric, prerelease, fail-soft)', async () => {
    const { isBehind } = await import('../../lib/version-staleness.js');
    expect(isBehind('3.9.0', '3.10.0')).toBe(true); // numeric, not lexicographic
    expect(isBehind('3.18.0', '4.0.0')).toBe(true);
    expect(isBehind('3.18.0', '3.18.0')).toBe(false);
    expect(isBehind('3.19.0', '3.18.0')).toBe(false); // ahead
    expect(isBehind('3.14.1-rc.1', '3.14.1')).toBe(true); // prerelease behind release
    // Never throws on unknown/unparseable — degrades to "not behind".
    expect(isBehind(null, '3.18.0')).toBe(false);
    expect(isBehind('3.18.0', null)).toBe(false);
    expect(isBehind('garbage', '3.18.0')).toBe(false);
  });

  test('formatStalenessNudge points at the existing `pd upgrade`', async () => {
    const { formatStalenessNudge } = await import('../../lib/version-staleness.js');
    expect(formatStalenessNudge('3.19.0', '3.22.0')).toBe(
      'pd 3.19.0 installed; 3.22.0 available — run `pd upgrade` to update',
    );
  });

  test('resolveFeedUrl honors PORT_DADDY_LATEST_FEED, else the canonical feed', async () => {
    const { resolveFeedUrl } = await import('../../lib/version-staleness.js');
    const { DEFAULT_LATEST_FEED_URL } = await import('../../lib/latest-manifest.js');
    const orig = process.env.PORT_DADDY_LATEST_FEED;
    try {
      delete process.env.PORT_DADDY_LATEST_FEED;
      expect(resolveFeedUrl()).toBe(DEFAULT_LATEST_FEED_URL);
      process.env.PORT_DADDY_LATEST_FEED = 'https://example.test/feed.json';
      expect(resolveFeedUrl()).toBe('https://example.test/feed.json');
    } finally {
      if (orig === undefined) delete process.env.PORT_DADDY_LATEST_FEED;
      else process.env.PORT_DADDY_LATEST_FEED = orig;
    }
  });
});

describe('version-staleness: fetchLatestFeedVersion', () => {
  const validManifest = (version) => ({
    schema: 1,
    version,
    releasedAt: '2026-06-23T00:00:00Z',
    artifacts: [],
  });

  test('returns the feed version on a valid feed', async () => {
    const { fetchLatestFeedVersion } = await import('../../lib/version-staleness.js');
    const fetchImpl = async () => ({ ok: true, json: async () => validManifest('3.22.0') });
    expect(await fetchLatestFeedVersion({ fetchImpl })).toBe('3.22.0');
  });

  test('returns null on non-2xx', async () => {
    const { fetchLatestFeedVersion } = await import('../../lib/version-staleness.js');
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    expect(await fetchLatestFeedVersion({ fetchImpl })).toBeNull();
  });

  test('returns null on a malformed feed (schema validation via parseLatestManifest)', async () => {
    const { fetchLatestFeedVersion } = await import('../../lib/version-staleness.js');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ not: 'a manifest' }) });
    expect(await fetchLatestFeedVersion({ fetchImpl })).toBeNull();
  });

  test('returns null (never throws) when fetch rejects', async () => {
    const { fetchLatestFeedVersion } = await import('../../lib/version-staleness.js');
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    expect(await fetchLatestFeedVersion({ fetchImpl })).toBeNull();
  });
});

describe('version-staleness: evaluateStaleness throttle', () => {
  const inMemory = (initial) => {
    let store = initial;
    return {
      readState: () => store,
      writeState: (s) => {
        store = s;
      },
      get: () => store,
    };
  };

  test('fetches and flags behind when no cache exists', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory(null);
    let fetched = 0;
    const result = await evaluateStaleness({
      current: '3.19.0',
      now: () => 1000,
      fetchLatest: async () => {
        fetched++;
        return '3.22.0';
      },
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(fetched).toBe(1);
    expect(result.behind).toBe(true);
    expect(result.source).toBe('network');
    expect(result.nudge).toBe('pd 3.19.0 installed; 3.22.0 available — run `pd upgrade` to update');
    expect(state.get()).toEqual({ checkedAt: 1000, latest: '3.22.0' });
  });

  test('answers from cache without fetching inside the throttle window', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory({ checkedAt: 1000, latest: '3.22.0' });
    let fetched = 0;
    const result = await evaluateStaleness({
      current: '3.19.0',
      now: () => 1000 + 60_000,
      throttleMs: 24 * 60 * 60 * 1000,
      fetchLatest: async () => {
        fetched++;
        return '3.99.0';
      },
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(fetched).toBe(0);
    expect(result.source).toBe('cache');
    expect(result.behind).toBe(true);
    expect(result.latest).toBe('3.22.0');
  });

  test('re-fetches once the throttle window has elapsed', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory({ checkedAt: 1000, latest: '3.22.0' });
    let fetched = 0;
    const result = await evaluateStaleness({
      current: '3.19.0',
      now: () => 1000 + 25 * 60 * 60 * 1000,
      throttleMs: 24 * 60 * 60 * 1000,
      fetchLatest: async () => {
        fetched++;
        return '3.23.0';
      },
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(fetched).toBe(1);
    expect(result.source).toBe('network');
    expect(result.latest).toBe('3.23.0');
  });

  test('force bypasses a fresh cache', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory({ checkedAt: 1000, latest: '3.22.0' });
    let fetched = 0;
    const result = await evaluateStaleness({
      current: '3.19.0',
      force: true,
      now: () => 1001,
      fetchLatest: async () => {
        fetched++;
        return '3.24.0';
      },
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(fetched).toBe(1);
    expect(result.latest).toBe('3.24.0');
  });

  test('a failed fetch still records the attempt (throttles retries) and does not nag', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory(null);
    const result = await evaluateStaleness({
      current: '3.19.0',
      now: () => 5000,
      fetchLatest: async () => null,
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(result.behind).toBe(false);
    expect(result.source).toBe('none');
    expect(result.nudge).toBeUndefined();
    expect(state.get()).toEqual({ checkedAt: 5000, latest: null });
  });

  test('not behind when up to date', async () => {
    const { evaluateStaleness } = await import('../../lib/version-staleness.js');
    const state = inMemory(null);
    const result = await evaluateStaleness({
      current: '3.22.0',
      now: () => 1,
      fetchLatest: async () => '3.22.0',
      readState: state.readState,
      writeState: state.writeState,
    });
    expect(result.behind).toBe(false);
    expect(result.nudge).toBeUndefined();
  });
});

describe('version-staleness: state file round-trip', () => {
  test('write then read returns the same state', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { readUpdateCheckState, writeUpdateCheckState } = await import('../../lib/version-staleness.js');
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.pd-staleness-test-'));
    const file = path.join(dir, 'update-check.json');
    try {
      writeUpdateCheckState({ checkedAt: 123, latest: '3.22.0' }, file);
      expect(readUpdateCheckState(file)).toEqual({ checkedAt: 123, latest: '3.22.0' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('read returns null for a missing or malformed file', async () => {
    const path = await import('node:path');
    const os = await import('node:os');
    const { readUpdateCheckState } = await import('../../lib/version-staleness.js');
    expect(readUpdateCheckState(path.join(os.homedir(), 'definitely-missing-staleness.json'))).toBeNull();
  });
});

describe('staleness-nudge: gating', () => {
  test('skips meta/unsafe commands, opt-out, quiet, and non-TTY', async () => {
    const { shouldNudgeStaleness } = await import('../../cli/utils/staleness-nudge.js');
    const origTTY = process.stderr.isTTY;
    const origOptOut = process.env.PORT_DADDY_NO_UPDATE_CHECK;
    try {
      process.stderr.isTTY = true;
      delete process.env.PORT_DADDY_NO_UPDATE_CHECK;

      expect(shouldNudgeStaleness('claim', false)).toBe(true);
      expect(shouldNudgeStaleness('status', false)).toBe(true);
      expect(shouldNudgeStaleness('version', false)).toBe(false);
      expect(shouldNudgeStaleness('self-update', false)).toBe(false); // it's about to auto-upgrade
      expect(shouldNudgeStaleness('upgrade', false)).toBe(false); // the explicit upgrade command
      expect(shouldNudgeStaleness('completion', false)).toBe(false);
      expect(shouldNudgeStaleness('mcp', false)).toBe(false);
      expect(shouldNudgeStaleness('learn', false)).toBe(false);
      expect(shouldNudgeStaleness('tutorial', false)).toBe(false);
      expect(shouldNudgeStaleness('--version', false)).toBe(false);
      expect(shouldNudgeStaleness('claim', true)).toBe(false); // quiet

      process.env.PORT_DADDY_NO_UPDATE_CHECK = '1';
      expect(shouldNudgeStaleness('claim', false)).toBe(false); // opt-out

      delete process.env.PORT_DADDY_NO_UPDATE_CHECK;
      process.stderr.isTTY = false;
      expect(shouldNudgeStaleness('claim', false)).toBe(false); // non-TTY
    } finally {
      process.stderr.isTTY = origTTY;
      if (origOptOut === undefined) delete process.env.PORT_DADDY_NO_UPDATE_CHECK;
      else process.env.PORT_DADDY_NO_UPDATE_CHECK = origOptOut;
    }
  });
});
