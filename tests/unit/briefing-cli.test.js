import { jest } from '@jest/globals';

const pdFetch = jest.fn();
jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ pdFetch, PORT_DADDY_URL: 'http://briefing.invalid' }));
const { handleBriefing } = await import('../../cli/commands/briefing.js');

describe('briefing CLI request parity', () => {
  let output;
  beforeEach(() => {
    pdFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, briefing: {}, briefingPath: '/fixture/.portdaddy' }) });
    output = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { output.mockRestore(); });

  test('JSON with omitted project uses query-only detection and does not POST', async () => {
    await handleBriefing({ json: true, dir: '/fixture/nested space' });
    expect(pdFetch).toHaveBeenCalledWith('http://briefing.invalid/briefing?projectRoot=%2Ffixture%2Fnested%20space');
  });

  test.each(['auto', 'team:app'])('JSON keeps explicit project %s literal', async project => {
    await handleBriefing({ json: true, dir: '/fixture', project });
    expect(pdFetch).toHaveBeenCalledWith(`http://briefing.invalid/briefing/${encodeURIComponent(project)}?projectRoot=%2Ffixture`);
  });

  test('JSON sends the caller cwd when --dir is absent', async () => {
    await handleBriefing({ json: true });
    expect(pdFetch).toHaveBeenCalledWith(`http://briefing.invalid/briefing?projectRoot=${encodeURIComponent(process.cwd())}`);
  });

  test('write mode preserves the same target directory and explicit project', async () => {
    await handleBriefing({ quiet: true, dir: '/fixture', project: 'auto', full: true });
    expect(pdFetch).toHaveBeenCalledWith('http://briefing.invalid/briefing', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ projectRoot: '/fixture', project: 'auto', full: true }),
    }));
  });
});
