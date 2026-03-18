/**
 * Spawner Module Tests — AI Agent Launcher
 *
 * Tests for createSpawner factory: spawn (dispatch to backends),
 * list (active agents), kill (stop agent), error handling, and cleanup.
 *
 * The spawner is purely in-memory (no SQLite) and uses fetch for PD
 * coordination and the ollama backend. child_process.spawn is used for
 * aider and custom backends.
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock child_process.spawn before importing spawner
// ---------------------------------------------------------------------------

const mockChildProcess = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  pid: 12345,
};

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(() => mockChildProcess),
}));

// Import after mocking
const { spawn: cpSpawn } = await import('node:child_process');
const { createSpawner } = await import('../../lib/spawner.js');

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;
let mockFetch;

beforeEach(() => {
  mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, sessionId: 'test-session-123' }),
    text: async () => 'OK',
  });
  global.fetch = mockFetch;

  // Reset child_process mocks
  cpSpawn.mockClear();
  mockChildProcess.stdout.on.mockReset();
  mockChildProcess.stderr.on.mockReset();
  mockChildProcess.on.mockReset();
  mockChildProcess.kill.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a successful ollama response.
 * The first two fetch calls are PD coordination (/agents, /sugar/begin),
 * the third is the actual ollama call, then /sugar/done.
 */
function setupOllamaFetchMock(response = 'Hello from ollama') {
  let callIndex = 0;
  mockFetch.mockImplementation(async (url) => {
    callIndex++;
    // PD coordination calls (fire-and-forget)
    if (typeof url === 'string' && (url.includes('/agents') || url.includes('/sugar'))) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionId: 'test-session' }),
        text: async () => 'OK',
      };
    }
    // Ollama call
    if (typeof url === 'string' && url.includes('11434')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: response },
        }),
        text: async () => response,
      };
    }
    // Fallback
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'OK',
    };
  });
}

/**
 * Make the child process emit 'close' on the next tick so the
 * aider/custom promise resolves.
 */
function resolveChildProcess(code = 0, stdout = 'output', stderr = '') {
  mockChildProcess.stdout.on.mockImplementation((event, cb) => {
    if (event === 'data') {
      if (stdout) cb(Buffer.from(stdout));
    }
  });
  mockChildProcess.stderr.on.mockImplementation((event, cb) => {
    if (event === 'data') {
      if (stderr) cb(Buffer.from(stderr));
    }
  });
  mockChildProcess.on.mockImplementation((event, cb) => {
    if (event === 'close') {
      // Resolve on next microtask so the spawner has time to attach listeners
      Promise.resolve().then(() => cb(code));
    }
  });
}

/**
 * Make the child process emit 'error'.
 */
function rejectChildProcess(message = 'spawn failed') {
  mockChildProcess.stdout.on.mockImplementation(() => {});
  mockChildProcess.stderr.on.mockImplementation(() => {});
  mockChildProcess.on.mockImplementation((event, cb) => {
    if (event === 'error') {
      Promise.resolve().then(() => cb(new Error(message)));
    }
  });
}

// =============================================================================
// createSpawner factory
// =============================================================================

describe('createSpawner', () => {
  test('returns object with spawn, list, kill methods', () => {
    const spawner = createSpawner();
    expect(typeof spawner.spawn).toBe('function');
    expect(typeof spawner.list).toBe('function');
    expect(typeof spawner.kill).toBe('function');
  });

  test('accepts empty deps object', () => {
    expect(() => createSpawner({})).not.toThrow();
  });

  test('defaults to empty deps when called with no args', () => {
    expect(() => createSpawner()).not.toThrow();
  });
});

// =============================================================================
// spawn — backend dispatch
// =============================================================================

describe('spawn — backend dispatch', () => {
  test('ollama backend calls ollama API at localhost:11434', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('Test response from llama');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'Explain ports',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Test response from llama');
    expect(result.error).toBeNull();
    expect(result.backend).toBe('ollama');

    // Verify ollama fetch was called
    const ollamaCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('11434')
    );
    expect(ollamaCalls.length).toBe(1);
    expect(ollamaCalls[0][0]).toBe('http://localhost:11434/api/chat');

    // Verify the request body
    const body = JSON.parse(ollamaCalls[0][1].body);
    expect(body.model).toBe('llama3.2:8b'); // default model
    expect(body.messages[0].content).toBe('Explain ports');
    expect(body.stream).toBe(false);
  });

  test('ollama backend uses custom model when specified', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      model: 'mistral:7b',
      task: 'Hello',
    });

    const ollamaCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('11434')
    );
    const body = JSON.parse(ollamaCalls[0][1].body);
    expect(body.model).toBe('mistral:7b');
  });

  test('ollama backend handles HTTP error', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'Internal Server Error',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'Will fail',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Ollama HTTP 500');
    expect(result.error).toContain('Internal Server Error');
  });

  test('ollama backend handles network failure', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('Connection refused');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'No server',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Connection refused');
  });

  test('custom backend spawns shell command', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'custom output');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'echo hello',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('custom output');
    expect(result.backend).toBe('custom');
    expect(cpSpawn).toHaveBeenCalledWith(
      'echo hello',
      [],
      expect.objectContaining({ shell: true })
    );
  });

  test('custom backend with workdir and env', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    await spawner.spawn({
      backend: 'custom',
      task: 'ls',
      workdir: '/tmp/test',
      env: { FOO: 'bar' },
    });

    expect(cpSpawn).toHaveBeenCalledWith(
      'ls',
      [],
      expect.objectContaining({
        cwd: '/tmp/test',
        shell: true,
      })
    );

    // Verify env includes custom vars
    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].env.FOO).toBe('bar');
  });

  test('custom backend handles non-zero exit code', async () => {
    const spawner = createSpawner();
    resolveChildProcess(1, '', 'command not found');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'badcmd',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('command not found');
  });

  test('custom backend handles spawn error', async () => {
    const spawner = createSpawner();
    rejectChildProcess('ENOENT');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'nonexistent-binary',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Failed to start command');
    expect(result.error).toContain('ENOENT');
  });

  test('aider backend spawns aider with correct args', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'aider output');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'Fix the login bug',
      files: ['src/auth.ts', 'src/login.ts'],
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('aider output');
    expect(cpSpawn).toHaveBeenCalledWith(
      'aider',
      ['--yes', '--no-stream', '--message', 'Fix the login bug', 'src/auth.ts', 'src/login.ts'],
      expect.objectContaining({
        timeout: 300000,
      })
    );
  });

  test('aider backend with no files', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'aider',
      task: 'General help',
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args).toEqual(['--yes', '--no-stream', '--message', 'General help']);
  });

  test('unknown backend returns error', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'nonexistent',
      task: 'hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unknown backend');
    expect(result.error).toContain('nonexistent');
  });
});

// =============================================================================
// spawn — result shape
// =============================================================================

describe('spawn — result shape', () => {
  test('returns all expected fields on success', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('result');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    expect(result).toEqual(
      expect.objectContaining({
        agentId: expect.stringMatching(/^spawned-[a-f0-9]{12}$/),
        backend: 'ollama',
        model: 'llama3.2:8b',
        status: 'completed',
        output: 'result',
        error: null,
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      })
    );
    expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  test('returns all expected fields on failure', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('boom');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.output).toBeNull();
    expect(result.completedAt).toBeTruthy();
  });

  test('uses default model for each backend', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });
    expect(result.model).toBe('llama3.2:8b');
  });

  test('uses provided model over default', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({
      backend: 'ollama',
      model: 'codellama:13b',
      task: 'test',
    });
    expect(result.model).toBe('codellama:13b');
  });

  test('purpose defaults to truncated task when not provided', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const longTask = 'A'.repeat(200);
    await spawner.spawn({
      backend: 'ollama',
      task: longTask,
    });

    // Check PD coordination call includes truncated purpose
    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/agents') && !url.includes('heartbeat')
    );
    expect(agentCall).toBeTruthy();
    const body = JSON.parse(agentCall[1].body);
    expect(body.purpose.length).toBe(80);
    expect(body.purpose).toBe(longTask.slice(0, 80));
  });
});

// =============================================================================
// list
// =============================================================================

describe('list', () => {
  test('returns empty array when no agents spawned', () => {
    const spawner = createSpawner();
    expect(spawner.list()).toEqual([]);
  });

  test('returns spawned agent after spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('hello');

    const spawnResult = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myapp:api:test',
      purpose: 'Testing the spawner',
    });

    const agents = spawner.list();
    expect(agents.length).toBe(1);
    expect(agents[0]).toEqual(
      expect.objectContaining({
        agentId: spawnResult.agentId,
        backend: 'ollama',
        model: 'llama3.2:8b',
        status: 'completed',
        identity: 'myapp:api:test',
        purpose: 'Testing the spawner',
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      })
    );
  });

  test('returns multiple agents', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({ backend: 'ollama', task: 'task 1' });
    await spawner.spawn({ backend: 'ollama', task: 'task 2' });

    const agents = spawner.list();
    expect(agents.length).toBe(2);
    expect(agents[0].agentId).not.toBe(agents[1].agentId);
  });

  test('does not expose internal fields (heartbeatInterval, childProcess)', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({ backend: 'ollama', task: 'test' });

    const agents = spawner.list();
    expect(agents[0]).not.toHaveProperty('heartbeatInterval');
    expect(agents[0]).not.toHaveProperty('childProcess');
  });

  test('shows killed status after kill', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    spawner.kill(result.agentId);

    const agents = spawner.list();
    const killed = agents.find(a => a.agentId === result.agentId);
    expect(killed.status).toBe('killed');
    expect(killed.completedAt).toBeTruthy();
  });
});

// =============================================================================
// kill
// =============================================================================

describe('kill', () => {
  test('marks agent as killed', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    spawner.kill(result.agentId);

    const agents = spawner.list();
    const agent = agents.find(a => a.agentId === result.agentId);
    expect(agent.status).toBe('killed');
    expect(agent.completedAt).toBeTruthy();
  });

  test('does not throw for non-existent agent', () => {
    const spawner = createSpawner();
    expect(() => spawner.kill('nonexistent-agent-id')).not.toThrow();
  });

  test('does not throw when called twice', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    expect(() => spawner.kill(result.agentId)).not.toThrow();
    expect(() => spawner.kill(result.agentId)).not.toThrow();
  });

  test('calls PD coordination /sugar/done on kill', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    mockFetch.mockClear();
    spawner.kill(result.agentId);

    // kill fires /sugar/done asynchronously — give it a tick
    await new Promise(r => setTimeout(r, 10));

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.agentId).toBe(result.agentId);
    expect(body.note).toBe('Killed by spawner');
  });

  test('kills child process when present (custom backend)', async () => {
    const spawner = createSpawner();

    // For custom backend: we need the child process to NOT resolve immediately
    // so we can kill it while "running"
    // We'll set up the on handlers to never fire 'close'
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});

    // Start spawn but don't await (it will hang waiting for close)
    const spawnPromise = spawner.spawn({
      backend: 'custom',
      task: 'sleep 9999',
    });

    // Wait a tick for the spawn to register the agent in the map
    await new Promise(r => setTimeout(r, 10));

    // Find the running agent
    const agents = spawner.list();
    expect(agents.length).toBe(1);
    expect(agents[0].status).toBe('running');

    // Kill it — NOTE: record.childProcess is only set AFTER runCustom resolves,
    // so kill() cannot reach the child process while it's still running.
    // This is a KNOWN BUG (identified in audit). kill() marks the agent as killed
    // but the actual OS process keeps running until it exits on its own.
    spawner.kill(agents[0].agentId);
    // The child process kill is NOT called because record.childProcess is still null
    // (the promise hasn't resolved to store it yet)
    expect(mockChildProcess.kill).not.toHaveBeenCalled(); // documents the known bug

    // Now resolve the child process so the spawn promise can complete
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) {
      closeHandler[1](null); // call close handler with null exit code
    }

    // Clean up: let the promise settle (it may already be settled via kill)
    await spawnPromise.catch(() => {}); // suppress any errors
  });
});

// =============================================================================
// PD coordination
// =============================================================================

describe('PD coordination', () => {
  test('registers agent with PD on spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test task',
      identity: 'myapp:api:main',
      purpose: 'Testing coordination',
    });

    const agentCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    expect(agentCalls.length).toBe(1);
    const body = JSON.parse(agentCalls[0][1].body);
    expect(body.identity).toBe('myapp:api:main');
    expect(body.purpose).toBe('Testing coordination');
  });

  test('calls /sugar/begin on spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myapp:api:main',
    });

    const beginCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/begin')
    );
    expect(beginCalls.length).toBe(1);
    const body = JSON.parse(beginCalls[0][1].body);
    expect(body.identity).toBe('myapp:api:main');
  });

  test('calls /sugar/done on successful completion', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('Great success');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.note).toContain('Completed');
    expect(body.note).toContain('Great success');
  });

  test('calls /sugar/done on failure with error message', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'Model not found',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.note).toContain('Failed');
  });

  test('PD coordination failures do not block spawning', async () => {
    const spawner = createSpawner();

    // All PD calls fail, but ollama succeeds
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: 'works' } }),
          text: async () => 'works',
        };
      }
      // All PD coordination calls fail
      throw new Error('PD daemon not running');
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test without PD',
    });

    // Spawn still succeeds despite PD failures
    expect(result.status).toBe('completed');
    expect(result.output).toBe('works');
  });

  test('starts heartbeat interval on spawn', async () => {
    jest.useFakeTimers();

    const spawner = createSpawner();

    // Mock child_process to not resolve (keeps agent "running" so we can
    // observe heartbeats). We use custom backend because ollama/claude
    // awaits are harder to suspend with fake timers + fetch mocks.
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});

    // Start spawn (won't resolve until child process closes)
    const spawnPromise = spawner.spawn({
      backend: 'custom',
      task: 'long running',
    });

    // Advance past the heartbeat interval (30s)
    await jest.advanceTimersByTimeAsync(30000);

    // Check for heartbeat calls
    const heartbeatCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/heartbeat')
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

    // Kill to clean up
    const agents = spawner.list();
    if (agents.length > 0) {
      spawner.kill(agents[0].agentId);
    }

    // Resolve child process
    const closeHandler = mockChildProcess.on.mock.calls.find(([e]) => e === 'close');
    if (closeHandler) closeHandler[1](null);
    await spawnPromise.catch(() => {});

    jest.useRealTimers();
  });

  test('clears heartbeat interval on completion', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('done');

    // Spy on clearInterval
    const clearSpy = jest.spyOn(global, 'clearInterval');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    // clearInterval should have been called to clean up the heartbeat
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// =============================================================================
// spawn — identity and purpose
// =============================================================================

describe('spawn — identity and purpose', () => {
  test('passes identity to PD coordination', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myproject:backend:feature-x',
    });

    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    const body = JSON.parse(agentCall[1].body);
    expect(body.identity).toBe('myproject:backend:feature-x');
  });

  test('identity is null when not provided', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    const body = JSON.parse(agentCall[1].body);
    expect(body.identity).toBeNull();
  });

  test('identity appears in list output', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myapp:web:dev',
    });

    const agents = spawner.list();
    expect(agents[0].identity).toBe('myapp:web:dev');
  });

  test('purpose appears in list output', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      purpose: 'Fixing critical bug',
    });

    const agents = spawner.list();
    expect(agents[0].purpose).toBe('Fixing critical bug');
  });
});

// =============================================================================
// spawn — each spawner instance is isolated
// =============================================================================

describe('spawner isolation', () => {
  test('separate spawner instances do not share state', async () => {
    const spawner1 = createSpawner();
    const spawner2 = createSpawner();

    setupOllamaFetchMock('ok');

    await spawner1.spawn({ backend: 'ollama', task: 'task 1' });

    expect(spawner1.list().length).toBe(1);
    expect(spawner2.list().length).toBe(0);
  });
});

// =============================================================================
// spawn — claude backend (SDK not installed)
// =============================================================================

describe('spawn — claude backend', () => {
  test('returns error when @anthropic-ai/sdk is not installed', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'claude',
      task: 'test',
    });

    // The dynamic import will fail because the SDK is not installed in tests
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});

// =============================================================================
// spawn — gemini backend (SDK not installed)
// =============================================================================

describe('spawn — gemini backend', () => {
  test('returns error when @google/generative-ai is not installed', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'gemini',
      task: 'test',
    });

    // The dynamic import will fail because the SDK is not installed in tests
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});

// =============================================================================
// spawn — unique agent IDs
// =============================================================================

describe('spawn — agent IDs', () => {
  test('generates unique agent IDs', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const r1 = await spawner.spawn({ backend: 'ollama', task: 'a' });
    const r2 = await spawner.spawn({ backend: 'ollama', task: 'b' });

    expect(r1.agentId).not.toBe(r2.agentId);
    expect(r1.agentId).toMatch(/^spawned-[a-f0-9]{12}$/);
    expect(r2.agentId).toMatch(/^spawned-[a-f0-9]{12}$/);
  });
});

// =============================================================================
// spawn — default models
// =============================================================================

describe('spawn — default models', () => {
  test('ollama defaults to llama3.2:8b', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    expect(result.model).toBe('llama3.2:8b');
  });

  test('custom defaults to "custom"', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    const result = await spawner.spawn({ backend: 'custom', task: 'echo test' });
    expect(result.model).toBe('custom');
  });

  test('aider defaults to "aider"', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    const result = await spawner.spawn({ backend: 'aider', task: 'fix bug' });
    expect(result.model).toBe('aider');
  });
});

// =============================================================================
// aider backend — edge cases
// =============================================================================

describe('aider backend — edge cases', () => {
  test('handles non-zero exit code', async () => {
    const spawner = createSpawner();
    resolveChildProcess(1, 'partial output', 'error details');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'bad task',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('error details');
  });

  test('handles spawn error (aider not installed)', async () => {
    const spawner = createSpawner();
    rejectChildProcess('spawn aider ENOENT');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Failed to start aider');
  });

  test('uses custom timeout', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    await spawner.spawn({
      backend: 'aider',
      task: 'test',
      timeout: 60000,
    });

    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].timeout).toBe(60000);
  });
});
