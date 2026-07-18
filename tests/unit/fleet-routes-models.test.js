import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockAssessBackendReadiness = jest.fn(async (backend) => ({
  backend,
  status: backend === 'claude-cli' ? 'manual_check' : 'ready',
  summary: `${backend} summary`,
  nextStep: backend === 'claude-cli' ? 'Run claude once interactively.' : undefined,
  credentialKeys: backend === 'claude' ? ['ANTHROPIC_API_KEY'] : [],
  credentialAlternates: backend === 'gemini' ? ['GOOGLE_API_KEY'] : [],
  setupLinks: backend === 'cloudflare'
    ? [{ label: 'Create pd-ai-stack token', url: 'https://dash.cloudflare.com/?to=/:account/api-tokens', kind: 'token_template' }]
    : [],
  setupCommand: backend === 'claude' ? "printf '\\nANTHROPIC_API_KEY=<paste-value>\\n' >> ~/.port-daddy-env\npd restart" : `setup ${backend}`,
  setupFiles: backend === 'claude' ? ['~/.port-daddy-env', '.env.local', '.env'] : [],
  restartRequired: backend === 'claude',
}));
const mockSaveManagedSecret = jest.fn((key) => ({ key, storedAt: 'keychain', encryptedAtRest: true }));
const mockManagedSecretStorageStatus = jest.fn(() => ({
  available: true,
  storage: 'keychain',
  encryptedAtRest: true,
  location: 'macOS Keychain',
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

jest.unstable_mockModule('../../lib/secret-env.js', () => ({
  saveManagedSecret: mockSaveManagedSecret,
  managedSecretStorageStatus: mockManagedSecretStorageStatus,
  // getSecret is reached transitively via lib/llm-call.ts → fleet-engine →
  // routes/fleet. Default to undefined (no managed secret stored).
  getSecret: jest.fn(() => undefined),
}));

const { fleetPlugin } = await import('../../routes/fleet.js');

function commitTempRepo(projectDir) {
  spawnSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectDir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Port Daddy Test'], { cwd: projectDir, stdio: 'ignore' });
  spawnSync('git', ['add', '.'], { cwd: projectDir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: projectDir, stdio: 'ignore' });
}

describe('fleet routes /fleet/models', () => {
  const tempDirs = [];

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({
      async json() {
        return {
          models: [{ name: 'llama3.1:8b' }, { name: 'qwen2.5-coder:7b' }],
        };
      },
    }));
  });

  afterEach(() => {
    while (tempDirs.length) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('returns supported backends with readiness metadata', async () => {
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet/models' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.backends).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'claude-cli',
        supported: true,
        readinessStatus: 'manual_check',
        readinessSummary: 'claude-cli summary',
        readinessNextStep: 'Run claude once interactively.',
      }),
      expect.objectContaining({
        id: 'codex',
        supported: true,
        models: ['gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.4'],
        modelTiers: { low: 'gpt-5.4-mini', mid: 'gpt-5.3-codex', high: 'gpt-5.4' },
        readinessStatus: 'ready',
        readinessSummary: 'codex summary',
        setupCommand: 'setup codex',
        adapter: expect.objectContaining({
          family: 'codex-cli',
          resume: expect.objectContaining({ native: true, scope: 'session' }),
        }),
      }),
      expect.objectContaining({
        id: 'claude',
        credentialKeys: ['ANTHROPIC_API_KEY'],
        setupFiles: ['~/.port-daddy-env', '.env.local', '.env'],
        restartRequired: true,
      }),
      expect.objectContaining({
        id: 'gemini',
        credentialAlternates: ['GOOGLE_API_KEY'],
      }),
      expect.objectContaining({
        id: 'cloudflare',
        models: [
          '@cf/zai-org/glm-4.7-flash',
          '@cf/openai/gpt-oss-120b',
          '@cf/moonshotai/kimi-k2-instruct',
          '@cf/qwen/qwen3-30b-a3b-fp8',
          '@cf/nvidia/nemotron-3-120b-a12b',
          '@cf/meta/llama-4-scout-17b-16e-instruct',
        ],
        modelTiers: {
          low: '@cf/zai-org/glm-4.7-flash',
          mid: '@cf/openai/gpt-oss-120b',
          high: '@cf/moonshotai/kimi-k2-instruct',
        },
        setupLinks: [expect.objectContaining({ label: 'Create pd-ai-stack token' })],
        adapter: expect.objectContaining({
          family: 'cloudflare-workers-ai',
          resume: expect.objectContaining({ native: false, scope: 'none' }),
        }),
      }),
      expect.objectContaining({
        id: 'ollama',
        supported: true,
        models: ['llama3.1:8b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b'],
        modelTiers: { low: 'qwen2.5-coder:7b', mid: 'llama3.1:8b', high: 'qwen2.5-coder:14b' },
        readinessStatus: 'ready',
        readinessSummary: 'ollama summary',
        adapter: expect.objectContaining({
          family: 'ollama',
          spawn: expect.objectContaining({ transport: 'model-server-http' }),
        }),
      }),
      expect.objectContaining({
        id: 'aider',
        models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5'],
        modelTiers: { low: 'gpt-4.1-mini', mid: 'gpt-4.1', high: 'gpt-5' },
      }),
      expect.objectContaining({
        id: 'custom',
        models: ['custom-low', 'custom-mid', 'custom-high'],
        modelTiers: { low: 'custom-low', mid: 'custom-mid', high: 'custom-high' },
      }),
    ]));

    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude-cli');
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('codex');
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('ollama');

    await app.close();
  });

  test('POST /fleet/backend-secrets saves allowed keys without echoing values', async () => {
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/backend-secrets',
      payload: {
        backend: 'cloudflare',
        values: {
          CLOUDFLARE_ACCOUNT_ID: 'acct-123',
          CLOUDFLARE_API_TOKEN: 'token-123',
        },
      },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      success: true,
      backend: 'cloudflare',
      savedKeys: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      encryptedAtRest: true,
    }));
    expect(JSON.stringify(body)).not.toContain('token-123');
    expect(mockSaveManagedSecret).toHaveBeenCalledWith('CLOUDFLARE_ACCOUNT_ID', 'acct-123');
    expect(mockSaveManagedSecret).toHaveBeenCalledWith('CLOUDFLARE_API_TOKEN', 'token-123');

    await app.close();
  });

  test('POST /fleet/backend-secrets rejects keys outside the backend allowlist', async () => {
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [] };
          },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/backend-secrets',
      payload: {
        backend: 'cloudflare',
        values: {
          ANTHROPIC_API_KEY: 'wrong-provider',
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Unsupported secret key');
    expect(mockSaveManagedSecret).not.toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'wrong-provider');

    await app.close();
  });

  test('POST /fleet/config/:project/runtime applies only a ready runtime and clears fallbacks', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-fleet-runtime-'));
    tempDirs.push(projectDir);
    const configPath = join(projectDir, 'pd-fleet.yml');
    writeFileSync(configPath, `fleet:
  name: demo
  limits:
    budget_usd_per_day: 2
  agents:
    qa:
      trigger: git:committed
      backend: ollama
      model: qwen2.5-coder:7b
      fallbacks:
        - backend: claude-cli
      prompt: review
    spider:
      schedule: "0 */2 * * *"
      backend: codex
      model: gpt-5.4-mini
      prompt: connect
    gardener:
      trigger: cleanup
      backend: custom
      prompt: ./scripts/gardener.sh
`, 'utf-8');
    commitTempRepo(projectDir);

    const reload = jest.fn();
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [{ project: 'demo', projectDir }] };
          },
          reload,
        },
        projects: {
          get() { return null; },
          getByPath() { return null; },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/config/demo/runtime',
      payload: {
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        clearFallbacks: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      backend: 'cloudflare',
      updatedAgents: ['qa', 'spider'],
      skippedAgents: ['gardener'],
    }));
    const yaml = readFileSync(configPath, 'utf-8');
    expect(yaml).toContain('backend: cloudflare');
    expect(yaml).toContain('model: "@cf/qwen/qwen3-30b-a3b-fp8"');
    expect(yaml).toContain('gardener:');
    expect(yaml).toContain('backend: custom');
    expect(yaml).toContain('prompt: ./scripts/gardener.sh');
    expect(yaml).not.toContain('backend: ollama');
    expect(yaml).not.toContain('fallbacks:');
    expect(reload).toHaveBeenCalled();

    await app.close();
  });

  test('POST /fleet/config/:project/runtime preserves fallbacks unless explicitly cleared', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-fleet-runtime-fallbacks-'));
    tempDirs.push(projectDir);
    const configPath = join(projectDir, 'pd-fleet.yml');
    writeFileSync(configPath, `fleet:
  name: demo
  agents:
    qa:
      trigger: git:committed
      backend: ollama
      model: qwen2.5-coder:7b
      fallbacks:
        - backend: claude-cli
      prompt: review
`, 'utf-8');
    commitTempRepo(projectDir);

    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [{ project: 'demo', projectDir }] };
          },
          reload: jest.fn(),
        },
        projects: {
          get() { return null; },
          getByPath() { return null; },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/config/demo/runtime',
      payload: {
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      success: true,
      clearFallbacks: false,
      updatedAgents: ['qa'],
      skippedAgents: [],
    }));
    const yaml = readFileSync(configPath, 'utf-8');
    expect(yaml).toContain('fallbacks:');
    expect(yaml).toContain('backend: claude-cli');

    await app.close();
  });

  test('POST /fleet/config/:project/runtime rejects backends that are not ready', async () => {
    mockAssessBackendReadiness.mockResolvedValueOnce({
      backend: 'codex',
      status: 'manual_check',
      summary: 'Codex auth needs interactive verification',
      nextStep: 'Run codex exec once.',
    });

    const projectDir = mkdtempSync(join(tmpdir(), 'pd-fleet-runtime-blocked-'));
    tempDirs.push(projectDir);
    writeFileSync(join(projectDir, 'pd-fleet.yml'), `fleet:
  name: demo
  agents:
    qa:
      trigger: git:committed
      backend: cloudflare
      prompt: review
`, 'utf-8');
    commitTempRepo(projectDir);

    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        fleetDaemon: {
          getStatus() {
            return { fleets: [{ project: 'demo', projectDir }] };
          },
          reload: jest.fn(),
        },
        projects: {
          get() { return null; },
          getByPath() { return null; },
        },
        messaging: {
          subscribe() {
            return null;
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/fleet/config/demo/runtime',
      payload: { backend: 'codex', model: 'gpt-5.4-mini' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Backend "codex" is not ready');

    await app.close();
  });
});
