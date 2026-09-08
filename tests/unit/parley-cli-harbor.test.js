import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
const readCurrentContext = jest.fn();
const ui = { error: jest.fn() };
let logSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({ readCurrentContext }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ui);

const { handleParley } = await import('../../cli/commands/parley.js');

function response(data, ok = true) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

beforeEach(() => {
  pdFetch.mockReset();
  readCurrentContext.mockReset();
  ui.error.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('pd parley --harbor propagation', () => {
  test('show carries the configured harbor with the read receipt query', async () => {
    pdFetch.mockResolvedValueOnce(response({
      success: true,
      receiptRecorded: true,
      summary: { parley: { parleyId: 'parley-nonfleet' }, turns: [], receipts: [] },
    }));

    await handleParley(['show', 'parley-nonfleet'], {
      as: 'agent-b',
      harbor: 'parley-route-nonfleet',
      json: true,
    });

    expect(pdFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/parley/parley-nonfleet?as=agent-b&harbor=parley-route-nonfleet',
    );
  });

  test('response and resolve carry the configured harbor in their mutation bodies', async () => {
    pdFetch
      .mockResolvedValueOnce(response({ success: true, status: { status: 'SUMMONED' } }))
      .mockResolvedValueOnce(response({ success: true, outcome: { status: 'COLLAPSED' } }));

    await handleParley(['respond', 'parley-nonfleet'], {
      as: 'agent-a',
      harbor: 'parley-route-nonfleet',
      performative: 'propose',
      content: 'use the configured harbor',
      json: true,
    });
    await handleParley(['resolve', 'parley-nonfleet'], {
      as: 'operator',
      harbor: 'parley-route-nonfleet',
      status: 'COLLAPSED',
      json: true,
    });

    expect(JSON.parse(pdFetch.mock.calls[0][1].body)).toMatchObject({
      parleyId: 'parley-nonfleet',
      party: 'agent-a',
      harbor: 'parley-route-nonfleet',
    });
    expect(JSON.parse(pdFetch.mock.calls[1][1].body)).toMatchObject({
      parleyId: 'parley-nonfleet',
      resolvedBy: 'operator',
      harbor: 'parley-route-nonfleet',
    });
  });
});
