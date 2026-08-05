import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockWatch = jest.fn(() => ({
  stop: jest.fn(),
}));
const mockCreateWatch = jest.fn(() => ({
  watch: mockWatch,
}));
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};
const mockAutoIdentityFromPackageJson = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:43121',
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/output.js', () => ({
  IS_TTY: false,
  relativeTime: jest.fn(() => '1s'),
}));

jest.unstable_mockModule('../../lib/watch.js', () => ({
  createWatch: mockCreateWatch,
}));

jest.unstable_mockModule('../../cli/commands/services.js', () => ({
  autoIdentityFromPackageJson: mockAutoIdentityFromPackageJson,
}));

const { handleWatch } = await import('../../cli/commands/spawn.js');

function response(ok, data, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
  };
}

describe('pd watch logical channel resolution', () => {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalOn = process.on;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    console.error = jest.fn();
    process.exit = jest.fn((code) => {
      throw new Error(`exit:${code}`);
    });
    process.on = jest.fn(() => process);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.exit = originalExit;
    console.error = originalError;
    process.on = originalOn;
  });

  test('resolves declared logical channels before starting watch', async () => {
    mockPdFetch.mockResolvedValueOnce(response(true, {
      success: true,
      channel: {
        logicalName: 'tauri:desktop',
        physicalName: 'br:repo1234:worka111:feature-a-123abc:tauri:desktop',
      },
    }));

    const run = handleWatch('tauri:desktop', { exec: 'echo hi', once: true });
    await jest.advanceTimersByTimeAsync(100);
    await run;

    expect(mockPdFetch.mock.calls[0][0]).toContain('/channels/resolve/tauri%3Adesktop?projectDir=');
    expect(mockWatch).toHaveBeenCalledWith(
      'br:repo1234:worka111:feature-a-123abc:tauri:desktop',
      expect.objectContaining({
        exec: 'echo hi',
        once: true,
        maxConcurrent: 3,
        timeout: 30000,
        minInterval: 0,
      })
    );
  });

  test('falls back to the raw channel when no declaration exists', async () => {
    mockPdFetch.mockResolvedValueOnce(response(false, {
      error: 'No declared channel found',
    }, 404));

    const run = handleWatch('legacy:raw', { exec: 'echo hi', once: true });
    await jest.advanceTimersByTimeAsync(100);
    await run;

    expect(mockWatch).toHaveBeenCalledWith(
      'legacy:raw',
      expect.objectContaining({ exec: 'echo hi', once: true })
    );
  });

  test('bypasses resolution when --raw-channel is set', async () => {
    const run = handleWatch('tauri:desktop', {
      exec: 'echo hi',
      once: true,
      'raw-channel': true,
    });
    await jest.advanceTimersByTimeAsync(100);
    await run;

    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(mockWatch).toHaveBeenCalledWith(
      'tauri:desktop',
      expect.objectContaining({ exec: 'echo hi', once: true })
    );
  });

  test('fails loudly when channel resolution errors', async () => {
    mockPdFetch.mockResolvedValueOnce(response(false, {
      error: 'database unavailable',
    }, 500));

    await expect(handleWatch('tauri:desktop', { exec: 'echo hi', once: true })).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith('database unavailable');
    expect(mockWatch).not.toHaveBeenCalled();
  });
});
