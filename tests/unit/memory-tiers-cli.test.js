import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

let logSpy;
let errorSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const {
  handleMemory,
  handleMemoryTiers,
  handleMemoryTier,
  handleMemorySummary,
  TIER_TABLE,
} = await import('../../cli/commands/memory.js');

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

/**
 * Stub fetchers for each construct so collectRows() resolves to a known set
 * of counts. Order of mockResolvedValueOnce matches the order constructs are
 * iterated in TIER_TABLE, and the number of mocks per construct matches the
 * number of HTTP calls that construct's fetcher actually makes against the
 * daemon. Both note rows share ONE bounded snapshot/partition request.
 *
 * Wire shapes here mirror what the live daemon actually emits (see
 * routes/resurrection.ts, routes/notes.ts, etc). Mocking the wrong shape was
 * how PR #114's salvageable-sessions bug shipped green; this stub mirrors
 * production.
 */
function stubAllCounts(counts) {
  pdFetch.mockReset();
  for (const construct of TIER_TABLE.map((r) => r.construct)) {
    if (construct === 'archived-notes') continue;
    const count = counts[construct];
    if (count === '__err__') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ error: 'forced failure' }, false, 500));
      continue;
    }
    if (construct === 'blobs') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ total: count }));
    } else if (construct === 'episodic-memory') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ total: count }));
    } else if (construct === 'salvageable-sessions') {
      // Daemon shape: { success, agents: [...], count: N }.
      pdFetch.mockResolvedValueOnce(jsonResponse({
        success: true,
        agents: new Array(count).fill({}),
        count,
      }));
    } else if (construct === 'active-sessions') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ sessions: new Array(count).fill({}) }));
    } else if (construct === 'active-file-claims') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ claims: new Array(count).fill({}) }));
    } else if (construct === 'active-notes') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ success: true, total: count,
        beforeSinceTotal: counts['archived-notes'], count: Math.min(1, count), notes: [] }));
    } else {
      pdFetch.mockResolvedValueOnce(jsonResponse({}));
    }
  }
}

beforeEach(() => {
  pdFetch.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
});

afterAll(() => {
  exit.mockRestore();
});

function lastJsonLog() {
  for (const call of logSpy.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    try {
      return JSON.parse(arg);
    } catch {
      // not JSON, keep looking
    }
  }
  throw new Error('no JSON output captured');
}

describe('TIER_TABLE shape', () => {
  test('every row has the four required fields', () => {
    for (const row of TIER_TABLE) {
      expect(typeof row.construct).toBe('string');
      expect(['Core', 'Recall', 'Archival', 'Recall→Archival']).toContain(row.tier);
      expect(typeof row.eviction).toBe('string');
      expect(typeof row.access).toBe('string');
    }
  });

  test('construct names are unique', () => {
    const names = TIER_TABLE.map((r) => r.construct);
    expect(new Set(names).size).toBe(names.length);
  });

  test('covers the canonical constructs from ADR-0035', () => {
    const expected = [
      'active-sessions',
      'active-file-claims',
      'active-notes',
      'archived-notes',
      'blobs',
      'episodic-memory',   // renamed from 'skill-index' — that row was the
                           // episodic-memory total mislabeled. See PR #114
                           // finding 2. A dedicated 'skill-index' construct
                           // will be added when /skill-index/count lands.
      'salvageable-sessions',
    ];
    for (const e of expected) {
      expect(TIER_TABLE.some((r) => r.construct === e)).toBe(true);
    }
  });
});

describe('pd memory tiers --json', () => {
  test('emits stable schema with tier, construct, count, eviction, access', async () => {
    stubAllCounts({
      'active-sessions': 3,
      'active-file-claims': 47,
      'active-notes': 12,
      'archived-notes': 8412,
      blobs: 142,
      'episodic-memory': 891,
      'salvageable-sessions': 4,
    });

    await handleMemoryTiers({ json: true });

    const out = lastJsonLog();
    expect(Array.isArray(out.rows)).toBe(true);
    expect(out.rows.length).toBe(TIER_TABLE.length);
    for (const row of out.rows) {
      expect(typeof row.construct).toBe('string');
      expect(typeof row.tier).toBe('string');
      expect(typeof row.eviction).toBe('string');
      expect(typeof row.access).toBe('string');
      if (row.count !== undefined) {
        expect(typeof row.count).toBe('number');
      } else {
        expect(typeof row.countError).toBe('string');
      }
    }
    const sessionsRow = out.rows.find((r) => r.construct === 'active-sessions');
    expect(sessionsRow.tier).toBe('Core');
    expect(sessionsRow.count).toBe(3);
  });

  test('records countError without aborting when an endpoint fails', async () => {
    stubAllCounts({
      'active-sessions': 1,
      'active-file-claims': '__err__',
      'active-notes': 5,
      'archived-notes': 100,
      blobs: 10,
      'episodic-memory': 50,
      'salvageable-sessions': 2,
    });

    await handleMemoryTiers({ json: true });

    const out = lastJsonLog();
    const claimsRow = out.rows.find((r) => r.construct === 'active-file-claims');
    expect(claimsRow.count).toBeUndefined();
    expect(typeof claimsRow.countError).toBe('string');
    expect(out.rows.find((r) => r.construct === 'blobs').count).toBe(10);
  });
});

describe('pd memory tier <construct>', () => {
  test('--json returns the row for a known construct without HTTP calls', async () => {
    await handleMemoryTier('active-file-claims', { json: true });
    expect(pdFetch).not.toHaveBeenCalled();
    const out = lastJsonLog();
    expect(out.construct).toBe('active-file-claims');
    expect(out.tier).toBe('Core');
  });

  test('--quiet prints just the tier name', async () => {
    await handleMemoryTier('archived-notes', { quiet: true });
    expect(logSpy).toHaveBeenCalledWith('Archival');
  });

  test('unknown construct exits with code 1', async () => {
    await expect(handleMemoryTier('not-a-thing', {})).rejects.toThrow(/process\.exit/);
  });

  test('missing construct argument exits with code 1', async () => {
    await expect(handleMemoryTier(undefined, {})).rejects.toThrow(/process\.exit/);
  });
});

describe('pd memory summary --json', () => {
  test('rolls up counts per tier and lists constructs in each', async () => {
    stubAllCounts({
      'active-sessions': 3,
      'active-file-claims': 47,
      'active-notes': 12,
      'archived-notes': 8412,
      blobs: 142,
      'episodic-memory': 891,
      'salvageable-sessions': 4,
    });

    await handleMemorySummary({ json: true });

    const out = lastJsonLog();
    expect(Array.isArray(out.tiers)).toBe(true);

    const core = out.tiers.find((t) => t.tier === 'Core');
    expect(core).toBeDefined();
    expect(core.count).toBe(3 + 47);
    expect(core.constructs.sort()).toEqual(['active-file-claims', 'active-sessions']);

    const archival = out.tiers.find((t) => t.tier === 'Archival');
    expect(archival.count).toBe(8412 + 142 + 891);
    expect(archival.constructs.sort()).toEqual(['archived-notes', 'blobs', 'episodic-memory']);

    const recall = out.tiers.find((t) => t.tier === 'Recall');
    expect(recall.count).toBe(12);

    const salvage = out.tiers.find((t) => t.tier === 'Recall→Archival');
    expect(salvage.count).toBe(4);
  });
});

describe('pd memory dispatcher', () => {
  test('delegates to handleMemoryTiers for "tiers"', async () => {
    stubAllCounts({
      'active-sessions': 0,
      'active-file-claims': 0,
      'active-notes': 0,
      'archived-notes': 0,
      blobs: 0,
      'episodic-memory': 0,
      'salvageable-sessions': 0,
    });
    await handleMemory(['tiers'], { json: true });
    const out = lastJsonLog();
    expect(Array.isArray(out.rows)).toBe(true);
  });

  test('delegates to handleMemoryTier for "tier <name>"', async () => {
    await handleMemory(['tier', 'blobs'], { json: true });
    const out = lastJsonLog();
    expect(out.construct).toBe('blobs');
    expect(out.tier).toBe('Archival');
  });

  test('rejects unknown subcommands', async () => {
    await expect(handleMemory(['nonsense'], {})).rejects.toThrow(/process\.exit/);
  });

  test('no arg delegates to legacy episodic-memory handler (backward compat)', async () => {
    // PR #114 review finding 4: `pd memory` (no args) historically defaulted
    // to `episodes` and exited 0. The earlier dispatcher broke this. Now it
    // delegates to handleEpisodicMemory; the call should reach pdFetch on the
    // /memory/episodes endpoint, not bail to printUsage.
    pdFetch.mockResolvedValueOnce(jsonResponse({ episodes: [], total: 0 }));
    await handleMemory([], { json: true });
    expect(pdFetch).toHaveBeenCalled();
    const url = pdFetch.mock.calls[0][0];
    expect(String(url)).toMatch(/\/memory\/episodes/);
  });
});

// =============================================================================
// JSON schema snapshots — closure for PR #114 finding 5.
// =============================================================================
describe('--json schema snapshots', () => {
  const KEY_COUNTS = {
    'active-sessions': 1,
    'active-file-claims': 2,
    'active-notes': 3,
    'archived-notes': 4,
    blobs: 5,
    'episodic-memory': 6,
    'salvageable-sessions': 7,
  };

  test('pd memory tiers --json shape is stable', async () => {
    stubAllCounts(KEY_COUNTS);
    await handleMemoryTiers({ json: true });
    const out = lastJsonLog();
    expect(Object.keys(out).sort()).toEqual(['rows']);
    expect(Array.isArray(out.rows)).toBe(true);
    for (const row of out.rows) {
      // Top-level keys must be a subset of the documented schema; no extras.
      const allowed = new Set(['construct', 'tier', 'eviction', 'access', 'count', 'countError']);
      for (const k of Object.keys(row)) expect(allowed.has(k)).toBe(true);
      expect(typeof row.construct).toBe('string');
      expect(['Core', 'Recall', 'Archival', 'Recall→Archival']).toContain(row.tier);
      expect(typeof row.eviction).toBe('string');
      expect(typeof row.access).toBe('string');
      expect((row.count === undefined) !== (row.countError === undefined)).toBe(true); // exactly one
    }
  });

  test('pd memory tier <construct> --json shape is stable', async () => {
    await handleMemoryTier('active-file-claims', { json: true });
    const out = lastJsonLog();
    expect(Object.keys(out).sort()).toEqual(['access', 'construct', 'eviction', 'tier']);
    expect(out.construct).toBe('active-file-claims');
    expect(out.tier).toBe('Core');
  });

  test('pd memory summary --json shape is stable', async () => {
    stubAllCounts(KEY_COUNTS);
    await handleMemorySummary({ json: true });
    const out = lastJsonLog();
    expect(Object.keys(out).sort()).toEqual(['tiers']);
    expect(Array.isArray(out.tiers)).toBe(true);
    for (const t of out.tiers) {
      const allowed = new Set(['tier', 'count', 'constructs', 'errors']);
      for (const k of Object.keys(t)) expect(allowed.has(k)).toBe(true);
      expect(['Core', 'Recall', 'Archival', 'Recall→Archival']).toContain(t.tier);
      expect(Array.isArray(t.constructs)).toBe(true);
      expect(Array.isArray(t.errors)).toBe(true);
    }
  });
});

// =============================================================================
// Recall/Archival partition invariant — explicit closure for PR #114 finding 3.
// =============================================================================
describe('Recall/Archival partition invariant', () => {
  test('recall_count + archival_count = total_count over the same fixture', async () => {
    // Pick deliberately non-round counts so a silent bug couldn't accidentally
    // satisfy the invariant.
    const active = 17;
    const archived = 6391;
    stubAllCounts({
      'active-sessions': 0,
      'active-file-claims': 0,
      'active-notes': active,
      'archived-notes': archived,
      blobs: 0,
      'episodic-memory': 0,
      'salvageable-sessions': 0,
    });
    await handleMemoryTiers({ json: true });
    const out = lastJsonLog();
    const recallRow = out.rows.find((r) => r.construct === 'active-notes');
    const archivalRow = out.rows.find((r) => r.construct === 'archived-notes');
    expect(recallRow.count).toBe(active);
    expect(archivalRow.count).toBe(archived);
    expect(recallRow.count + archivalRow.count).toBe(active + archived);
  });
});
