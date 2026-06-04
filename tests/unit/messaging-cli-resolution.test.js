import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockResolveTarget = jest.fn(() => ({ host: '127.0.0.1', port: 9876 }));
const mockHttpRequest = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
};
const mockCanPrompt = jest.fn(() => false);
const mockPromptText = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
  resolveTarget: mockResolveTarget,
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/prompt.js', () => ({
  canPrompt: mockCanPrompt,
  promptText: mockPromptText,
}));

jest.unstable_mockModule('node:http', () => ({
  default: {
    request: mockHttpRequest,
  },
  request: mockHttpRequest,
}));

const { handlePub, handleSub, handleChannels } = await import('../../cli/commands/messaging.js');

function response(ok, data, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    headers: {},
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    },
  };
}

describe('messaging CLI channel resolution', () => {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  });

  test('handlePub resolves a declared logical channel before publishing', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(true, {
        success: true,
        channel: {
          logicalName: 'tauri:desktop',
          physicalName: 'br:repo1234:worka111:feature-a-123abc:tauri:desktop',
        },
      }))
      .mockResolvedValueOnce(response(true, { success: true, id: 42 }));

    await handlePub('tauri:desktop', '{"ok":true}', {});

    expect(mockPdFetch.mock.calls[0][0]).toContain('/channels/resolve/tauri%3Adesktop?projectDir=');
    expect(mockPdFetch.mock.calls[1][0]).toBe(
      'http://localhost:9876/msg/br%3Arepo1234%3Aworka111%3Afeature-a-123abc%3Atauri%3Adesktop'
    );
    expect(mockUi.success).toHaveBeenCalledWith(expect.stringContaining('tauri:desktop'));
  });

  test('handlePub falls back to the raw channel when no declaration exists', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(false, {
        error: 'No declared channel found',
      }, 404))
      .mockResolvedValueOnce(response(true, { success: true, id: 7 }));

    await handlePub('legacy:raw', '{"ok":true}', {});

    expect(mockPdFetch.mock.calls[1][0]).toBe('http://localhost:9876/msg/legacy%3Araw');
  });

  test('handlePub bypasses resolution when --raw-channel is set', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, { success: true, id: 9 }));

    await handlePub('tauri:desktop', '{"ok":true}', { 'raw-channel': true });

    expect(mockPdFetch).toHaveBeenCalledTimes(1);
    expect(mockPdFetch.mock.calls[0][0]).toBe('http://localhost:9876/msg/tauri%3Adesktop');
  });

  test('handleChannels clear resolves declared logical channels before deleting', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response(true, {
        success: true,
        channel: {
          logicalName: 'tauri:desktop',
          physicalName: 'br:repo1234:worka111:feature-a-123abc:tauri:desktop',
        },
      }))
      .mockResolvedValueOnce(response(true, { success: true, deleted: 3 }));

    await handleChannels('clear', ['tauri:desktop'], {});

    expect(mockPdFetch.mock.calls[1][0]).toBe(
      'http://localhost:9876/msg/br%3Arepo1234%3Aworka111%3Afeature-a-123abc%3Atauri%3Adesktop'
    );
    expect(mockPdFetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  test('handleSub resolves declared logical channels before opening SSE', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      channel: {
        logicalName: 'tauri:desktop',
        physicalName: 'br:repo1234:worka111:feature-a-123abc:tauri:desktop',
      },
    }));

    let endHandler = null;
    mockHttpRequest.mockImplementation((opts, callback) => {
      const res = {
        statusCode: 200,
        setEncoding: jest.fn(),
        on(event, handler) {
          if (event === 'end') endHandler = handler;
          return this;
        },
      };
      callback(res);

      const req = {
        on: jest.fn(() => req),
        end: jest.fn(() => {
          if (endHandler) endHandler();
        }),
      };
      return req;
    });

    await expect(handleSub('tauri:desktop', {})).rejects.toThrow('exit:0');

    expect(mockResolveTarget).toHaveBeenCalled();
    expect(mockHttpRequest.mock.calls[0][0]).toMatchObject({
      path: '/msg/br%3Arepo1234%3Aworka111%3Afeature-a-123abc%3Atauri%3Adesktop/subscribe',
    });
    expect(mockUi.info).toHaveBeenCalledWith(expect.stringContaining('tauri:desktop'));
  });
});
