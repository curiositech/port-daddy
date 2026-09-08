import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
let logSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const { handleSitrep } = await import('../../cli/commands/sitrep.js');

function sitrepResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      summary: 'bounded',
      since_minutes: 60,
      since_ms: 0,
      activity: [],
      notes: [],
      salvage_queue: [],
      spawned_agents: [],
      approvals: [],
    }),
  };
}

beforeEach(() => {
  pdFetch.mockReset();
  pdFetch.mockResolvedValue(sitrepResponse());
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => logSpy.mockRestore());

describe('pd sitrep bounded query wiring', () => {
  test('forwards kebab-case limits and requests summary-only data for quiet mode', async () => {
    await handleSitrep({
      json: true,
      quiet: true,
      'limit-activity': 7,
      'limit-notes': 8,
      'limit-salvage': 9,
      'limit-salvage-notes': 2,
      'limit-spawned': 6,
    });

    expect(pdFetch).toHaveBeenCalledTimes(1);
    const target = new URL(pdFetch.mock.calls[0][0], 'http://local');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      limit_activity: '7',
      limit_notes: '8',
      limit_salvage: '9',
      limit_salvage_notes: '2',
      limit_spawned: '6',
      summary_only: '1',
    });
  });

  test('forwards camel-case SDK options through the same daemon contract', async () => {
    await handleSitrep({ json: true, limitActivity: 3, limitNotes: 4, limitSalvage: 5 });
    const target = new URL(pdFetch.mock.calls[0][0], 'http://local');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      limit_activity: '3',
      limit_notes: '4',
      limit_salvage: '5',
    });
  });
});
