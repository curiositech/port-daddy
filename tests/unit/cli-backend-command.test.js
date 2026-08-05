import { jest } from '@jest/globals';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const mockPdFetch = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://127.0.0.1:43121',
}));

// Capture ui.info / ui.error / ui.success calls without printing to the
// real terminal.
const uiCalls = { info: [], error: [], success: [], warn: [] };
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({
  info: (msg) => uiCalls.info.push(String(msg)),
  error: (msg) => uiCalls.error.push(String(msg)),
  success: (msg) => uiCalls.success.push(String(msg)),
  warn: (msg) => uiCalls.warn.push(String(msg)),
  canPrompt: () => false,
  select: () => Promise.resolve(undefined),
  intro: () => {},
  outro: () => {},
}));

const { handleBackend } = await import('../../cli/commands/backend.js');

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}

function captureStdout() {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return {
    lines,
    restore: () => {
      console.log = orig;
    },
  };
}

describe('pd backend list', () => {
  const persistPath = join(homedir(), '.port-daddy-cli-backend');
  let savedPersist;

  beforeEach(() => {
    jest.clearAllMocks();
    uiCalls.info = [];
    uiCalls.error = [];
    uiCalls.success = [];
    uiCalls.warn = [];
    // Don't clobber a real persisted choice.
    if (existsSync(persistPath)) {
      savedPersist = readFileSync(persistPath, 'utf-8');
      rmSync(persistPath);
    } else {
      savedPersist = null;
    }
    delete process.env.PD_USE_CLI_BACKEND;
  });

  afterEach(() => {
    if (existsSync(persistPath)) rmSync(persistPath);
    if (savedPersist != null) writeFileSync(persistPath, savedPersist);
  });

  test('emits machine-readable JSON when --json is set', async () => {
    mockPdFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        forcedCliBackend: null,
        pdUseCliBackend: null,
        backends: [
          {
            id: 'cli:claude-code',
            name: 'Claude Code (CLI)',
            costModel: 'subscription',
            framing: 'FREE — your Claude Max subscription',
            available: true,
            launchable: false,
            recommended: true,
            pdUseCliBackendValue: 'claude-code',
            isForcedByEnv: false,
            readinessStatus: 'manual_check',
          },
          {
            id: 'openai',
            name: 'OpenAI API',
            costModel: 'metered',
            framing: 'Metered API — pennies per spawn',
            available: false,
            launchable: false,
            recommended: false,
            readinessStatus: 'needs_setup',
          },
        ],
      }),
    );

    const cap = captureStdout();
    try {
      await handleBackend(['list'], { json: true });
    } finally {
      cap.restore();
    }
    const joined = cap.lines.join('\n');
    const parsed = JSON.parse(joined);
    expect(parsed.success).toBe(true);
    expect(parsed.backends).toHaveLength(2);
    // Subscription backend should be ranked first.
    expect(parsed.backends[0].id).toBe('cli:claude-code');
  });

  test('--available filters out backends that are not ready', async () => {
    mockPdFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        forcedCliBackend: null,
        backends: [
          { id: 'cli:claude-code', name: 'Claude Code', costModel: 'subscription', available: true, framing: 'FREE — Claude Max', pdUseCliBackendValue: 'claude-code' },
          { id: 'cli:codex', name: 'Codex', costModel: 'subscription', available: false, framing: 'FREE — ChatGPT Pro', pdUseCliBackendValue: 'codex' },
          { id: 'openai', name: 'OpenAI', costModel: 'metered', available: false, framing: 'Metered API' },
        ],
      }),
    );

    const cap = captureStdout();
    try {
      await handleBackend(['list'], { json: true, available: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.lines.join('\n'));
    expect(parsed.backends.map((b) => b.id)).toEqual(['cli:claude-code']);
  });

  test('falls back to the offline catalog when the daemon is unreachable', async () => {
    mockPdFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const cap = captureStdout();
    try {
      await handleBackend(['list'], { json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.lines.join('\n'));
    expect(parsed.backends.length).toBeGreaterThan(0);
    // Catalog should still contain the headline cli-tube backends.
    expect(parsed.backends.map((b) => b.id)).toEqual(
      expect.arrayContaining(['cli:claude-code', 'cli:codex']),
    );
    expect(
      parsed.backends.find((b) => b.id === 'cli:claude-code').readinessStatus,
    ).toBe('unknown');
  });
});

describe('pd backend use', () => {
  const persistPath = join(homedir(), '.port-daddy-cli-backend');
  let savedPersist;

  beforeEach(() => {
    jest.clearAllMocks();
    uiCalls.info = [];
    uiCalls.error = [];
    uiCalls.success = [];
    if (existsSync(persistPath)) {
      savedPersist = readFileSync(persistPath, 'utf-8');
      rmSync(persistPath);
    } else {
      savedPersist = null;
    }
  });

  afterEach(() => {
    if (existsSync(persistPath)) rmSync(persistPath);
    if (savedPersist != null) writeFileSync(persistPath, savedPersist);
  });

  test('emits an export line for claude-code and persists the choice', async () => {
    const cap = captureStdout();
    try {
      await handleBackend(['use', 'claude-code'], {});
    } finally {
      cap.restore();
    }
    expect(cap.lines[0]).toBe('export PD_USE_CLI_BACKEND=claude-code');
    expect(existsSync(persistPath)).toBe(true);
    expect(readFileSync(persistPath, 'utf-8').trim()).toBe('claude-code');
  });

  test('accepts the short codex form as the ChatGPT Pro CLI backend', async () => {
    const cap = captureStdout();
    try {
      await handleBackend(['use', 'codex'], {});
    } finally {
      cap.restore();
    }
    expect(cap.lines[0]).toBe('export PD_USE_CLI_BACKEND=codex');
    expect(readFileSync(persistPath, 'utf-8').trim()).toBe('codex');
  });

  test('accepts the catalog id form (cli:codex) as well as the env value form', async () => {
    const cap = captureStdout();
    try {
      await handleBackend(['use', 'cli:codex'], {});
    } finally {
      cap.restore();
    }
    expect(cap.lines[0]).toBe('export PD_USE_CLI_BACKEND=codex');
  });

  test('use none clears the persisted selection and unsets the env var', async () => {
    writeFileSync(persistPath, 'claude-code\n');
    const cap = captureStdout();
    try {
      await handleBackend(['use', 'none'], {});
    } finally {
      cap.restore();
    }
    expect(cap.lines[0]).toBe('unset PD_USE_CLI_BACKEND');
    expect(existsSync(persistPath)).toBe(false);
  });

  test('rejects backends without a pdUseCliBackend value', async () => {
    const orig = process.exitCode;
    const cap = captureStdout();
    try {
      await handleBackend(['use', 'openai'], {});
    } finally {
      cap.restore();
    }
    expect(process.exitCode).toBe(1);
    expect(uiCalls.error.some((m) => m.includes('No CLI-routable backend'))).toBe(true);
    process.exitCode = orig;
  });
});

describe('pd backend adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uiCalls.info = [];
    uiCalls.error = [];
  });

  test('prints the generated N:N contract without contacting the daemon', async () => {
    const cap = captureStdout();
    try {
      await handleBackend(['adapters'], { json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.lines.join('\n'));
    expect(parsed.success).toBe(true);
    expect(parsed.probe).toBeNull();
    expect(parsed.adapters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'codex-cli',
        backendIds: ['cli:codex', 'codex'],
        resume: 'session',
      }),
      expect.objectContaining({
        family: 'ollama',
        resume: 'handoff-only',
      }),
    ]));
    expect(mockPdFetch).not.toHaveBeenCalled();
  });
});

describe('pd backend cost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uiCalls.info = [];
    uiCalls.error = [];
  });

  test('--today queries the 24h window and groups by backend', async () => {
    mockPdFetch.mockResolvedValue(
      jsonResponse({
        since: 86_400,
        totals: { totalUsd: 1.42, spawnCount: 12 },
        byBackend: [
          { backend: 'openai', totalUsd: 1.2, spawnCount: 8 },
          { backend: 'cli:claude-code', totalUsd: 0.01, spawnCount: 4 },
          { backend: 'cloudflare', totalUsd: 0.21, spawnCount: 0 },
        ],
      }),
    );

    const cap = captureStdout();
    try {
      await handleBackend(['cost'], { today: true, json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.lines.join('\n'));
    expect(parsed.window).toBe('today');
    expect(parsed.sinceSecs).toBe(86_400);
    expect(parsed.byBackend[0].backend).toBe('openai');
    // mockPdFetch must have been called with the right since query.
    expect(mockPdFetch).toHaveBeenCalledWith('/metrics/cost?since=86400');
  });

  test('--week uses a 7-day window', async () => {
    mockPdFetch.mockResolvedValue(
      jsonResponse({ since: 7 * 86_400, totals: { totalUsd: 0 }, byBackend: [] }),
    );
    const cap = captureStdout();
    try {
      await handleBackend(['cost'], { week: true, json: true });
    } finally {
      cap.restore();
    }
    expect(mockPdFetch).toHaveBeenCalledWith(`/metrics/cost?since=${7 * 86_400}`);
  });
});
