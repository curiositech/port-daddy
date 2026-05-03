import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';

const fetchMock = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: fetchMock,
  PORT_DADDY_URL: 'http://test.local',
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => ({
  error: (msg) => {
    throw new Error(`ui.error: ${msg}`);
  },
  dim: (s) => s,
  bold: (s) => s,
  green: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
}));

const { handleCockpit } = await import('../../cli/commands/cockpit.js');

function mockResponse({ ok = true, body }) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe('pd cockpit missions CLI', () => {
  let logs;
  let originalLog;

  beforeEach(() => {
    fetchMock.mockReset();
    logs = [];
    originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test('no flags hits /cockpit/missions and prints grouped summary', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        body: {
          success: true,
          intake: {
            projectDir: '/tmp/x',
            sources: ['docs/recovery/CURRENT-WORK.md'],
            missing: [],
            generatedAt: 1,
            missions: [
              {
                id: 'cockpit-mission-intake',
                title: 'Cockpit mission intake',
                status: 'uncommitted',
                source: 'docs/recovery/CURRENT-WORK.md',
                sourceAnchor: '#cockpit-mission-intake',
                summary: 'foo',
                evidence: [],
                files: ['lib/cockpit-missions.ts'],
                updatedAt: 1,
              },
              {
                id: 'phase-1',
                title: 'Phase 1',
                status: 'blocked',
                source: '.cartographer/status.md',
                sourceAnchor: '#phase-1',
                summary: 'bar',
                evidence: [],
                files: [],
                updatedAt: 1,
              },
            ],
          },
          count: 2,
        },
      }),
    );
    await handleCockpit(['missions'], {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://test.local/cockpit/missions');
    const out = logs.join('\n');
    expect(out).toMatch(/COCKPIT/);
    expect(out).toMatch(/\[UNCOMMITTED\]/);
    expect(out).toMatch(/\[BLOCKED\]/);
    expect(out).toMatch(/lib\/cockpit-missions\.ts/);
  });

  test('builds query string from flags', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        body: {
          success: true,
          intake: { projectDir: '/p', sources: [], missing: [], missions: [], generatedAt: 0 },
          count: 0,
        },
      }),
    );
    await handleCockpit(['missions'], {
      project: '/some/dir',
      status: 'blocked,uncommitted',
      limit: 5,
    });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('projectDir=%2Fsome%2Fdir');
    expect(url).toContain('status=blocked%2Cuncommitted');
    expect(url).toContain('limit=5');
  });

  test('--json prints raw envelope', async () => {
    const payload = {
      success: true,
      intake: { projectDir: '/p', sources: [], missing: [], missions: [], generatedAt: 0 },
      count: 0,
    };
    fetchMock.mockResolvedValue(mockResponse({ body: payload }));
    await handleCockpit(['missions'], { json: true });
    const out = logs.join('\n');
    expect(out).toContain('"success": true');
    expect(out).toContain('"intake"');
  });

  test('default subcommand is missions', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        body: {
          success: true,
          intake: { projectDir: '/p', sources: [], missing: [], missions: [], generatedAt: 0 },
          count: 0,
        },
      }),
    );
    await handleCockpit([], {});
    expect(fetchMock).toHaveBeenCalled();
  });

  test('unknown subcommand exits with error', async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    try {
      await expect(handleCockpit(['weird'], {})).rejects.toThrow();
    } finally {
      exitMock.mockRestore();
    }
  });
});
