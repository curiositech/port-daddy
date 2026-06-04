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
 * iterated in TIER_TABLE.
 */
function stubAllCounts(counts) {
  pdFetch.mockReset();
  for (const construct of TIER_TABLE.map((r) => r.construct)) {
    const count = counts[construct];
    if (count === '__err__') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ error: 'forced failure' }, false, 500));
    } else if (construct === 'archived-notes' || construct === 'blobs') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ total: count }));
    } else if (construct === 'skill-index') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ total: count }));
    } else if (construct === 'salvageable-sessions') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ pending: new Array(count).fill({}) }));
    } else if (construct === 'active-sessions') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ sessions: new Array(count).fill({}) }));
    } else if (construct === 'active-file-claims') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ claims: new Array(count).fill({}) }));
    } else if (construct === 'active-notes') {
      pdFetch.mockResolvedValueOnce(jsonResponse({ notes: new Array(count).fill({}) }));
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

  test('covers the seven canonical constructs from ADR-0035', () => {
    const expected = [
      'active-sessions',
      'active-file-claims',
      'active-notes',
      'archived-notes',
      'blobs',
      'skill-index',
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
      'skill-index': 891,
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
      'skill-index': 50,
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
      'skill-index': 891,
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
    expect(archival.constructs.sort()).toEqual(['archived-notes', 'blobs', 'skill-index']);

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
      'skill-index': 0,
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

  test('no arg prints usage and exits', async () => {
    await expect(handleMemory([], {})).rejects.toThrow(/process\.exit/);
  });
});
